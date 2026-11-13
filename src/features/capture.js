// RR Launcher — CAPTURE (processus principal) : captures d'écran, clips vidéo, galerie, raccourcis.
//
//  - Capture : desktopCapturer (écran sous le curseur — en jeu le curseur est dans la fenêtre du jeu —,
//    sinon écran principal) → PNG dans <dossier>/<Nom du jeu>/. Dossier par défaut : Images\RR Launcher.
//  - Clip : fenêtre cachée (capture/recorder.html) getUserMedia(chromeMediaSource 'desktop') + MediaRecorder
//    WebM (VP9 sinon VP8, ~8 Mb/s, 30 i/s, son du système sous Windows si possible), 5 min maximum.
//    Les morceaux arrivent toutes les secondes et sont écrits au fil de l'eau (rien en mémoire).
//    Pas de « 30 dernières secondes » : les morceaux d'un MediaRecorder (timeslice) ne sont pas lisibles
//    séparément (seul le 1er porte l'en-tête WebM et une image clé) ; un tampon circulaire propre demanderait
//    de relancer des enregistreurs en boucle et de remuxer — non fait.
//  - Retour discret : jamais de mise au premier plan. Son + toast côté renderer (x:capture:done) et,
//    launcher masqué, notification Windows silencieuse.
//  - Galerie : rr://capture/<dossier>/<fichier> (restreint au dossier de captures, Range pour les vidéos),
//    miniatures JPEG dans DATA/capture/thumbs.
//  - Déclencheurs : x:capture:shot / x:capture:clip (menu en jeu), Ctrl+Alt+S / Ctrl+Alt+R (globalShortcut),
//    manette (hub 'pad:combo' émis par src/guide.js via main.js).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const { BrowserWindow, desktopCapturer, screen, globalShortcut, Notification, nativeImage, dialog, shell, net } = require('electron');
const U = require('./capture/util');

const MAX_CLIP_MS = 5 * 60 * 1000;
const KEYS = { shot: 'CommandOrControl+Alt+S', clip: 'CommandOrControl+Alt+R' };

function init(ctx) {
  const { app, ipcMain, store, hub, running, DATA, send, findGame, getWin, log } = ctx;
  const S = () => store.data.settings;
  const THUMBS = path.join(DATA, 'capture', 'thumbs');
  store.data.capture ||= { folders: {} }; // gameId -> nom du dossier (garde le dossier si le jeu est renommé)
  store.data.capture.folders ||= {};
  // Réglages par défaut (actifs) : posés ici pour que les interrupteurs des réglages les affichent « oui »
  for (const k of ['padShortcuts', 'captureShare', 'captureKeys', 'clipAudio']) if (S()[k] === undefined) S()[k] = true;
  if (process.platform === 'win32') { try { app.setAppUserModelId('fr.robinrahoual.rrlauncher'); } catch {} } // notifications Windows

  const root = () => {
    const d = S().captureDir;
    return d && path.isAbsolute(d) ? d : path.join(app.getPath('pictures'), 'RR Launcher');
  };
  const curGame = () => { const id = [...running.keys()].pop(); return id ? findGame(id) || { id, name: 'Jeu' } : null; };
  function folderOf(g, create) {
    if (!g) return 'Autres';
    let f = store.data.capture.folders[g.id];
    if (!f) {
      f = U.safeName(g.name);
      if (create) { store.data.capture.folders[g.id] = f; store.save?.(); }
    }
    return f;
  }
  const relOf = (full) => path.relative(root(), full).split(path.sep).join('/');
  const urlOf = (rel, v) => `rr://capture/${rel.split('/').map(encodeURIComponent).join('/')}${v ? `?v=${Math.round(v)}` : ''}`;

  // ---------------------------------------------------------------- Retour discret
  function notify(title, body) {
    const w = getWin();
    const visible = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized();
    if (visible) return; // le renderer affiche un toast
    try { if (Notification.isSupported()) new Notification({ title, body, silent: true }).show(); } catch (e) { log(`capture : notification ${e.message}`); }
  }

  // ---------------------------------------------------------------- Écran visé
  function targetDisplay() {
    try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay(); }
    catch { return screen.getPrimaryDisplay(); }
  }
  async function screenSource(display, thumb) {
    const size = thumb || { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    if (!list.length) throw new Error('aucun écran disponible');
    return list.find((s) => s.display_id && s.display_id === String(display.id)) || list[0];
  }

  // ---------------------------------------------------------------- Miniatures
  const thumbPath = (full) => path.join(THUMBS, crypto.createHash('sha1').update(full).digest('hex').slice(0, 20) + '.jpg');
  function writeThumb(full, img) {
    try {
      if (!img || img.isEmpty()) return;
      fs.mkdirSync(THUMBS, { recursive: true });
      fs.writeFileSync(thumbPath(full), img.resize({ width: 480, quality: 'good' }).toJPEG(80));
    } catch (e) { log(`capture : miniature ${e.message}`); }
  }

  // ---------------------------------------------------------------- Capture d'écran
  let shooting = false;
  async function shot({ delay = 0, origin = 'menu' } = {}) {
    if (shooting) return { ok: false, error: 'Capture déjà en cours' };
    shooting = true;
    try {
      if (delay) await new Promise((r) => setTimeout(r, Math.min(2000, delay)));
      const g = curGame();
      const src = await screenSource(targetDisplay());
      const img = src.thumbnail;
      if (!img || img.isEmpty()) throw new Error('image vide (jeu en plein écran exclusif ?)');
      const dir = path.join(root(), folderOf(g, true));
      fs.mkdirSync(dir, { recursive: true });
      const file = U.freePath(dir, `${g ? U.safeName(g.name) : 'Capture'} ${U.fileStamp()}`, '.png');
      fs.writeFileSync(file, img.toPNG());
      writeThumb(file, img);
      log(`capture : ${file} (${origin})`);
      const info = { ok: true, kind: 'image', id: g?.id || null, game: g?.name || null, file: path.basename(file), rel: relOf(file) };
      send('x:capture:done', info);
      notify('Capture enregistrée', g ? g.name : path.basename(file));
      return info;
    } catch (e) {
      log(`capture : échec ${e.message}`);
      send('x:capture:done', { ok: false, kind: 'image', error: e.message });
      notify('Capture impossible', e.message);
      return { ok: false, error: e.message };
    } finally { shooting = false; }
  }

  // ---------------------------------------------------------------- Clips
  let rec = null; // { win, stream, file, start, game, timer, bytes, stopping, thumb }
  const recState = () => (rec ? { recording: true, start: rec.start, max: MAX_CLIP_MS, id: rec.game?.id || null, game: rec.game?.name || null } : { recording: false });
  function broadcast() { send('x:capture:rec', recState()); }

  async function startClip({ delay = 0 } = {}) {
    if (rec) return { ok: false, error: 'Enregistrement déjà en cours' };
    if (delay) await new Promise((r) => setTimeout(r, Math.min(2000, delay)));
    const g = curGame();
    let src;
    const display = targetDisplay();
    try { src = await screenSource(display, { width: 640, height: 360 }); }
    catch (e) { return fail(e); }
    const dir = path.join(root(), folderOf(g, true));
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return fail(e); }
    const file = U.freePath(dir, `${g ? U.safeName(g.name) : 'Clip'} ${U.fileStamp()}`, '.webm');
    const w = new BrowserWindow({
      show: false, width: 320, height: 200, skipTaskbar: true, focusable: false,
      webPreferences: { preload: path.join(__dirname, 'capture', 'recorder-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: 'rr-capture' },
    });
    rec = { win: w, stream: fs.createWriteStream(file), file, start: Date.now(), game: g, bytes: 0, stopping: false, thumb: src.thumbnail };
    rec.stream.on('error', (e) => log(`capture : écriture clip ${e.message}`));
    w.on('closed', () => { if (rec && rec.win === w && !rec.done) finishClip('fenêtre fermée'); });
    try {
      await w.loadFile(path.join(__dirname, 'capture', 'recorder.html'));
      const dw = Math.round(display.size.width * display.scaleFactor), dh = Math.round(display.size.height * display.scaleFactor);
      w.webContents.send('rec:start', { sourceId: src.id, audio: process.platform === 'win32' && S().clipAudio !== false, fps: 30, bitrate: 8e6, width: Math.min(dw, 3840), height: Math.min(dh, 2160) });
    } catch (e) { finishClip(e.message); return fail(e); }
    rec.timer = setTimeout(() => stopClip('durée maximale'), MAX_CLIP_MS);
    log(`capture : clip démarré ${file}`);
    broadcast();
    notify('Enregistrement démarré', `${g ? g.name + ' · ' : ''}5 min maximum`);
    return { ok: true, recording: true };
    function fail(e) {
      log(`capture : clip impossible ${e.message}`);
      send('x:capture:done', { ok: false, kind: 'video', error: e.message });
      notify('Enregistrement impossible', e.message);
      return { ok: false, error: e.message };
    }
  }
  function stopClip(reason = 'arrêt') {
    if (!rec || rec.stopping) return { ok: !!rec };
    rec.stopping = true;
    clearTimeout(rec.timer);
    try { rec.win.webContents.send('rec:stop'); } catch {}
    rec.killTimer = setTimeout(() => finishClip(`${reason} (délai dépassé)`), 5000); // l'enregistreur ne répond plus
    rec.reason = reason;
    return { ok: true };
  }
  function finishClip(err) {
    const r = rec;
    if (!r || r.done) return;
    r.done = true;
    rec = null;
    clearTimeout(r.timer); clearTimeout(r.killTimer);
    try { if (!r.win.isDestroyed()) r.win.destroy(); } catch {}
    r.stream.end(() => {
      const ok = r.bytes > 0;
      if (!ok) { try { fs.unlinkSync(r.file); } catch {} }
      else writeThumb(r.file, r.thumb);
      const secs = Math.round((Date.now() - r.start) / 1000);
      log(`capture : clip ${ok ? 'enregistré' : 'vide'} ${r.file} (${secs} s, ${r.bytes} o${err ? ', ' + err : ''})`);
      send('x:capture:done', ok
        ? { ok: true, kind: 'video', id: r.game?.id || null, game: r.game?.name || null, file: path.basename(r.file), rel: relOf(r.file), seconds: secs, audio: r.audio }
        : { ok: false, kind: 'video', error: err || 'aucune image reçue' });
      notify(ok ? 'Clip enregistré' : 'Enregistrement impossible', ok ? `${r.game?.name || path.basename(r.file)} · ${secs} s` : err || 'aucune image reçue');
      broadcast();
    });
    broadcast();
  }
  const fromRec = (e) => rec && !rec.win.isDestroyed() && e.sender === rec.win.webContents;
  ipcMain.on('capture-rec:chunk', (e, buf) => {
    if (!fromRec(e) || !buf) return;
    const b = Buffer.from(buf);
    rec.bytes += b.length;
    rec.stream.write(b);
  });
  ipcMain.on('capture-rec:info', (e, info) => { if (fromRec(e)) { rec.audio = !!info?.audio; log(`capture : enregistreur ${info?.mime || '?'}${info?.audio ? ' + son' : ' (vidéo seule)'}${info?.audioError ? ' — son : ' + info.audioError : ''}`); } });
  ipcMain.on('capture-rec:done', (e, info) => { if (fromRec(e)) finishClip(info?.error || null); });
  function toggleClip(opts) { return rec ? stopClip() : startClip(opts); }
  hub.on('session:end', () => { if (rec && running.size === 0) stopClip('fin de partie'); });

  // ---------------------------------------------------------------- Raccourcis clavier globaux
  let keysOn = false;
  function applyKeys() {
    const want = S().captureKeys !== false;
    if (want === keysOn) return;
    if (want) {
      // N'écrase pas un raccourci déjà pris (Ctrl+Alt+L du launcher ou une autre application)
      for (const [k, acc] of Object.entries(KEYS)) {
        try {
          if (globalShortcut.isRegistered(acc)) { log(`capture : ${acc} déjà utilisé`); continue; }
          if (!globalShortcut.register(acc, () => (k === 'shot' ? shot({ origin: 'clavier' }) : toggleClip()))) log(`capture : ${acc} refusé par le système`);
        } catch (e) { log(`capture : ${acc} ${e.message}`); }
      }
    } else for (const acc of Object.values(KEYS)) { try { globalShortcut.unregister(acc); } catch {} }
    keysOn = want;
  }
  app.whenReady().then(applyKeys);

  // ---------------------------------------------------------------- Manette (src/guide.js → main.js → hub)
  hub.on('pad:combo', (name) => {
    if (S().padShortcuts === false || !running.size) return;
    if (name === 'capture') shot({ origin: 'manette' });
    else if (name === 'share' && S().captureShare !== false) shot({ origin: 'share' });
    else if (name === 'clip') toggleClip();
  });

  // ---------------------------------------------------------------- rr://capture/<dossier>/<fichier>[?thumb=1]
  ctx.protoRoute?.('capture', async (req, u) => {
    const rel = decodeURIComponent(u.pathname);
    const full = U.resolveRel(root(), rel);
    if (!full || !fs.existsSync(full)) return new Response('Not found', { status: 404 });
    if (u.searchParams.get('thumb')) {
      const t = thumbPath(full);
      if (!fs.existsSync(t) && U.IMAGE.test(full)) writeThumb(full, nativeImage.createFromPath(full));
      if (fs.existsSync(t)) return net.fetch(pathToFileURL(t).toString());
      return new Response('Not found', { status: 404 });
    }
    if (!U.VIDEO.test(full)) return net.fetch(pathToFileURL(full).toString());
    // Vidéo : réponses partielles (Range) pour la lecture
    const size = fs.statSync(full).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    let start = 0, end = size - 1, status = 200;
    if (m && size) {
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2] || 0));
      end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      status = 206;
    }
    const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(size ? Readable.toWeb(fs.createReadStream(full, { start, end })) : '', { status, headers });
  });

  // ---------------------------------------------------------------- IPC
  ipcMain.handle('x:capture:shot', (_e, o = {}) => shot({ delay: Number(o.delay) || 0, origin: o.origin || 'menu' }));
  ipcMain.handle('x:capture:clip', (_e, o = {}) => toggleClip({ delay: Number(o.delay) || 0 }));
  ipcMain.handle('x:capture:state', () => ({ ...recState(), dir: root(), keys: KEYS }));
  ipcMain.handle('x:capture:refresh', () => { applyKeys(); return { keys: keysOn }; });
  ipcMain.handle('x:capture:list', (_e, id) => {
    const g = findGame(id);
    if (!g) return { items: [], dir: root() };
    const folder = folderOf(g, false);
    const dir = path.join(root(), folder);
    const items = U.listMedia(dir).map((x) => {
      const rel = `${folder}/${x.file}`;
      return { ...x, rel, url: urlOf(rel, x.mtime), thumb: `${urlOf(rel, x.mtime)}${x.mtime ? '&' : '?'}thumb=1` };
    });
    return { items, dir, folder };
  });
  ipcMain.handle('x:capture:delete', async (_e, rel) => {
    const full = U.resolveRel(root(), rel);
    if (!full || !fs.existsSync(full)) return { ok: false, error: 'Fichier introuvable' };
    try { await shell.trashItem(full); } catch { try { fs.unlinkSync(full); } catch (e) { return { ok: false, error: e.message }; } }
    try { fs.unlinkSync(thumbPath(full)); } catch {}
    return { ok: true };
  });
  ipcMain.handle('x:capture:openFolder', async (_e, id) => {
    const g = id ? findGame(id) : null;
    const dir = g ? path.join(root(), folderOf(g, false)) : root();
    const target = fs.existsSync(dir) ? dir : root();
    try { fs.mkdirSync(target, { recursive: true }); } catch {}
    const err = await shell.openPath(target);
    return { ok: !err, error: err || null, dir: target };
  });
  ipcMain.handle('x:capture:pickDir', async () => {
    const w = getWin();
    const r = await dialog.showOpenDialog(w, { title: 'Dossier des captures', defaultPath: root(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, dir: root() };
    S().captureDir = r.filePaths[0];
    ctx.commit?.();
    return { ok: true, dir: root() };
  });
  ipcMain.handle('x:capture:resetDir', () => { S().captureDir = ''; ctx.commit?.(); return { dir: root() }; });
}

module.exports = { init };

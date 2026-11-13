// Module MEDIA (main) : vidéos de présentation (Steam ou fichier local), musique (dossier utilisateur ou par jeu).
// Fichiers : MEDIA/<gameId>/trailer.(mp4|webm|m4v), MEDIA/<gameId>/music.(mp3|ogg|flac|m4a|…),
// marqueur MEDIA/<gameId>/trailer.none (JSON { t }) = pas de vidéo trouvée, on ne retente pas avant 7 jours.
// Canaux : x:media:trailer, x:media:info, x:media:cached, x:media:pickTrailer, x:media:pickMusic, x:media:remove,
//          x:media:pickMusicDir, x:media:musicList, x:media:track ; évènement x:media:ready { id, file }.
const fs = require('fs');
const path = require('path');

const VIDEO_EXT = ['.mp4', '.webm', '.m4v'];
const AUDIO_EXT = ['.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.wav'];
const AUDIO_MIME = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav' };
const MAX_VIDEO = 60 * 1024 * 1024; // 60 Mo
const MAX_TRACK = 80 * 1024 * 1024; // un morceau envoyé au renderer
const RETRY_MS = 7 * 24 * 3600 * 1000;
const UA = 'RR-Launcher/1.x (+media)';

/** Choisit une URL vidéo progressive (mp4 puis webm, 480p de préférence) dans `movies` de l'appdetails Steam. */
function pickMovieUrls(movies) {
  if (!Array.isArray(movies)) return [];
  const list = [...movies].sort((a, b) => (b?.highlight ? 1 : 0) - (a?.highlight ? 1 : 0));
  const out = [];
  for (const m of list) {
    for (const [fmt, q] of [['mp4', '480'], ['webm', '480'], ['mp4', 'max'], ['webm', 'max']]) {
      const u = m?.[fmt]?.[q];
      if (typeof u === 'string' && /^https:\/\//.test(u)) out.push({ url: u, ext: fmt === 'webm' ? '.webm' : '.mp4' });
    }
    if (out.length) break; // une seule bande-annonce (la mise en avant si possible)
  }
  // Entrées récentes en HLS / DASH seulement (hls_h264, dash_av1…) : pas de flux progressif → ignorées
  return out;
}

const findFile = (dir, base, exts) => {
  for (const e of exts) if (fs.existsSync(path.join(dir, base + e))) return base + e;
  return null;
};

function init(ctx) {
  const { ipcMain, store, MEDIA, send, findGame, commit, getWin, log } = ctx;
  const { net, dialog } = require('electron');
  const gdir = (id) => path.join(MEDIA, path.basename(String(id)));
  const trailerOf = (id) => findFile(gdir(id), 'trailer', VIDEO_EXT);
  const musicOf = (id) => findFile(gdir(id), 'music', AUDIO_EXT);
  const markerFresh = (id) => {
    try { const { t } = JSON.parse(fs.readFileSync(path.join(gdir(id), 'trailer.none'), 'utf8')); return Date.now() - t < RETRY_MS; } catch { return false; }
  };
  const writeMarker = (id) => { try { fs.mkdirSync(gdir(id), { recursive: true }); fs.writeFileSync(path.join(gdir(id), 'trailer.none'), JSON.stringify({ t: Date.now() })); } catch { /* ignore */ } };
  const clearOld = (id, base, exts) => { for (const e of exts) fs.rmSync(path.join(gdir(id), base + e), { force: true }); };

  // ---- Téléchargement en arrière-plan (un à la fois, jamais bloquant pour l'UI)
  const queue = [];
  const pending = new Set();
  let busy = false;

  async function download(url, dest) {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_VIDEO) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new Error(`trop lourd (${Math.round(len / 1048576)} Mo)`); }
    const part = dest + '.part';
    const out = fs.createWriteStream(part);
    let n = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > MAX_VIDEO) { await reader.cancel(); throw new Error('trop lourd'); }
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      if (n < 50 * 1024) throw new Error('fichier vide');
      fs.renameSync(part, dest);
    } catch (e) {
      out.destroy(); fs.rmSync(part, { force: true });
      throw e;
    }
  }

  async function fetchTrailer(id) {
    const g = findGame(id);
    if (!g?.appid) return writeMarker(id);
    let movies = null;
    try {
      const res = await net.fetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(g.appid)}&l=french&filters=movies`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      movies = json?.[g.appid]?.data?.movies || json?.[String(g.appid)]?.data?.movies;
    } catch (e) { log(`media : appdetails ${g.appid} : ${e.message}`); return; } // erreur réseau : pas de marqueur, on retentera
    for (const { url, ext } of pickMovieUrls(movies)) {
      try {
        fs.mkdirSync(gdir(id), { recursive: true });
        await download(url, path.join(gdir(id), 'trailer' + ext));
        fs.rmSync(path.join(gdir(id), 'trailer.none'), { force: true });
        log(`media : bande-annonce ${g.name} (${ext})`);
        send('x:media:ready', { id, file: 'trailer' + ext });
        return;
      } catch (e) { log(`media : vidéo ${g.appid} : ${e.message}`); }
    }
    writeMarker(id);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const id = queue.shift();
      try { await fetchTrailer(id); } catch (e) { log(`media : ${e.message}`); }
      pending.delete(id);
    }
    busy = false;
  }

  ipcMain.handle('x:media:trailer', (_e, id) => {
    if (!findGame(id)) return { none: true };
    const file = trailerOf(id);
    if (file) return { file, v: fs.statSync(path.join(gdir(id), file)).mtimeMs | 0 };
    if (!findGame(id).appid || markerFresh(id)) return { none: true };
    if (!pending.has(id)) { pending.add(id); queue.unshift(id); setImmediate(pump); }
    return { pending: true };
  });

  ipcMain.handle('x:media:info', (_e, id) => (findGame(id) ? { trailer: trailerOf(id), music: musicOf(id) } : {}));

  // Vidéos déjà en cache (économiseur d'écran)
  ipcMain.handle('x:media:cached', () => store.data.games.map((g) => ({ id: g.id, file: trailerOf(g.id) })).filter((x) => x.file));

  async function pickInto(id, base, exts, title, filterName) {
    const g = findGame(id);
    if (!g) return null;
    const r = await dialog.showOpenDialog(getWin(), { title, properties: ['openFile'], filters: [{ name: filterName, extensions: exts.map((e) => e.slice(1)) }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const ext = path.extname(r.filePaths[0]).toLowerCase();
    if (!exts.includes(ext)) return null;
    fs.mkdirSync(gdir(id), { recursive: true });
    clearOld(id, base, exts);
    fs.copyFileSync(r.filePaths[0], path.join(gdir(id), base + ext));
    return { file: base + ext, v: Date.now() | 0 };
  }
  ipcMain.handle('x:media:pickTrailer', (_e, id) => pickInto(id, 'trailer', VIDEO_EXT, 'Choisir une vidéo', 'Vidéos'));
  ipcMain.handle('x:media:pickMusic', (_e, id) => pickInto(id, 'music', AUDIO_EXT, 'Choisir une musique', 'Musiques'));
  ipcMain.handle('x:media:remove', (_e, { id, kind }) => {
    if (!findGame(id) || !['trailer', 'music'].includes(kind)) return false;
    clearOld(id, kind, kind === 'trailer' ? VIDEO_EXT : AUDIO_EXT);
    if (kind === 'trailer') writeMarker(id); // retiré volontairement : ne pas re-télécharger tout de suite
    return true;
  });

  // ---- Dossier de musique : seuls les fichiers audio de premier niveau de CE dossier sont lisibles
  const musicDir = () => store.data.settings.mediaMusicDir || '';
  const listTracks = () => {
    const d = musicDir();
    if (!d) return [];
    try { return fs.readdirSync(d, { withFileTypes: true }).filter((f) => f.isFile() && AUDIO_EXT.includes(path.extname(f.name).toLowerCase())).map((f) => f.name).sort(); } catch { return []; }
  };
  ipcMain.handle('x:media:pickMusicDir', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Dossier de musique', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.data.settings.mediaMusicDir = r.filePaths[0];
    store.data.settings.mediaMusicSource = 'folder';
    commit();
    return { dir: r.filePaths[0], count: listTracks().length };
  });
  ipcMain.handle('x:media:musicList', () => listTracks());
  ipcMain.handle('x:media:track', (_e, q = {}) => {
    let full = null;
    if (q.gameId) { const f = findGame(q.gameId) && musicOf(q.gameId); if (f) full = path.join(gdir(q.gameId), f); }
    else if (q.name && listTracks().includes(q.name)) full = path.join(musicDir(), q.name);
    if (!full) return null;
    try {
      if (fs.statSync(full).size > MAX_TRACK) return null;
      return { mime: AUDIO_MIME[path.extname(full).toLowerCase()] || 'audio/mpeg', data: fs.readFileSync(full) };
    } catch { return null; }
  });
}

module.exports = { init, pickMovieUrls };

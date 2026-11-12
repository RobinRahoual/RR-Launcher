// RR Launcher — processus principal Electron
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { JsonStore } = require('./store');
const meta = require('./metadata');
const { autoUpdater } = require('electron-updater');

protocol.registerSchemesAsPrivileged([
  { scheme: 'rr', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (process.env.RR_DATA) app.setPath('userData', process.env.RR_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const DATA = app.getPath('userData');
const MEDIA = path.join(DATA, 'media');
const store = new JsonStore(path.join(DATA, 'library.json'), {
  games: [],
  settings: {
    sgdbKey: '',
    fullscreen: true,
    minimizeOnLaunch: true,
    sounds: true,
    caseStyle: 'red', // red | black | blue | auto
    sort: 'recent', // recent | name | added | playtime
  },
});

meta.setLogFile(path.join(DATA, 'metadata.log'));

let win = null;
const running = new Map(); // id -> { child, start }

// ---------- Fenêtre ----------
function createWindow() {
  const s = store.data.settings;
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 560,
    frame: false,
    fullscreen: !!s.fullscreen,
    backgroundColor: '#07070f',
    show: false,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    title: 'RR Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.show(); if (!s.fullscreen) win.maximize(); });
  // Capture d'écran automatique (tests uniquement)
  if (process.env.RR_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      const shots = process.env.RR_SHOT.split(',');
      for (const spec of shots) {
        const [file, js, wait] = spec.split('|');
        if (js) await win.webContents.executeJavaScript(js).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, Number(wait || 2500)));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(file, img.toPNG());
      }
      app.quit();
    });
  }
  win.on('enter-full-screen', () => send('win:fullscreen', true));
  win.on('leave-full-screen', () => send('win:fullscreen', false));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle('rr', (req) => {
    // rr://media/<gameId>/<fichier>
    const u = new URL(req.url);
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (u.hostname !== 'media' || parts.length !== 2) return new Response('Not found', { status: 404 });
    const [id, file] = parts.map((p) => path.basename(p));
    const full = path.join(MEDIA, id, file);
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();
  setupUpdater();
});
app.on('window-all-closed', () => app.quit());

// ---------- Bibliothèque ----------
const games = () => store.data.games;
const findGame = (id) => games().find((g) => g.id === id);
const publicState = () => ({ games: games(), settings: store.data.settings, running: [...running.keys()] });
function commit() {
  store.save();
  send('lib:changed', publicState());
}

// Devine le nom du jeu depuis l'exécutable.
const GENERIC = /^(launcher|game|start|play|setup|bootstrap|unity|unreal|engine|client|win64|x64|binaries|bin|shipping|release|app)$/i;
function cleanName(s) {
  return s
    .replace(/\.(exe|lnk|url|bat|cmd)$/i, '')
    .replace(/[-_ ](win64|win32|x64|x86|shipping|dx11|dx12|vulkan|launcher)\b/gi, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function folderGuess(exePath) {
  const parts = exePath.split(/[\\/]/).filter(Boolean);
  const exe = cleanName(parts.pop() || '');
  if (exe && !GENERIC.test(exe.replace(/\s/g, '')) && exe.length > 2) return exe;
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = cleanName(parts[i]);
    if (c && !GENERIC.test(c.replace(/\s/g, '')) && !/^(common|steamapps|games?|program files.*|[a-z]:)$/i.test(c)) return c;
  }
  return exe || 'Nouveau jeu';
}
function guessName(exePath) {
  return new Promise((resolve) => {
    const fallback = folderGuess(exePath);
    if (process.platform !== 'win32' || !/\.exe$/i.test(exePath)) return resolve(fallback);
    const ps = `$v=(Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo; @{p=$v.ProductName;d=$v.FileDescription} | ConvertTo-Json -Compress`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(fallback);
      try {
        const { p, d } = JSON.parse(stdout.trim());
        const bad = (x) => !x || x.length < 3 || /unreal|unity|bootstrap|launcher|engine|microsoft|\.exe/i.test(x);
        resolve(!bad(p) ? p.trim() : !bad(d) ? d.trim() : fallback);
      } catch { resolve(fallback); }
    });
  });
}

ipcMain.handle('lib:get', () => publicState());

ipcMain.handle('game:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir l’exécutable du jeu',
    properties: ['openFile'],
    filters: [{ name: 'Jeux', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'Tous', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const exePath = r.filePaths[0];
  return { exePath, name: await guessName(exePath) };
});

ipcMain.handle('game:inspect', async (_e, exePath) => ({ exePath, name: await guessName(exePath) }));

ipcMain.handle('meta:search', async (_e, term) => {
  try { return { ok: true, results: await meta.search(term, store.data.settings) }; }
  catch (e) { return { ok: false, error: String(e.message || e), results: [] }; }
});

async function applyMetadata(game, match) {
  const dir = path.join(MEDIA, game.id);
  const progress = (msg) => send('game:progress', { id: game.id, msg });
  try {
    if (!match) {
      progress('Recherche du jeu…');
      const res = await meta.search(game.name, store.data.settings).catch(() => []);
      match = res[0] || { source: 'none', name: game.name };
      meta.log(`recherche auto « ${game.name} » → ${res.length} résultat(s), choisi : ${match.source} ${match.name}`);
    }
    // Téléchargement dans un dossier temporaire : on ne remplace les anciens visuels que si on en a trouvé.
    const tmp = dir + '.new';
    fs.rmSync(tmp, { recursive: true, force: true });
    const info = await meta.fetchAll(match, tmp, store.data.settings, progress);
    const found = info.media.cover || info.media.hero || info.media.header || info.media.logo;
    if (found || !fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (fs.existsSync(tmp)) fs.renameSync(tmp, dir);
    } else {
      fs.rmSync(tmp, { recursive: true, force: true });
      info.media = game.media || {};
      info.screenshots = game.screenshots || [];
      info.color = game.color;
    }
    Object.assign(game, info, { name: game.customName ? game.name : info.name || game.name });
    game.metaStatus = game.media.cover || game.media.hero || game.media.header ? 'ok' : 'none';
  } catch (e) {
    game.metaStatus = 'none';
    progress('Erreur : ' + (e.message || e));
  }
  game.mediaVersion = Date.now();
  commit();
  send('game:progress', { id: game.id, done: true });
  return game;
}

ipcMain.handle('game:add', async (_e, { exePath, name, match }) => {
  const existing = games().find((g) => g.exePath.toLowerCase() === exePath.toLowerCase());
  if (existing) return { ok: false, error: 'Ce jeu est déjà dans ta bibliothèque.', id: existing.id };
  const game = {
    id: crypto.randomUUID().slice(0, 8),
    name: name || folderGuess(exePath),
    exePath,
    args: '',
    addedAt: Date.now(),
    lastPlayed: 0,
    playtime: 0,
    playCount: 0,
    favorite: false,
    media: {},
    screenshots: [],
    metaStatus: 'loading',
  };
  games().push(game);
  commit();
  applyMetadata(game, match); // en arrière-plan, la progression est envoyée au rendu
  return { ok: true, id: game.id };
});

ipcMain.handle('game:refetch', async (_e, { id, match }) => {
  const g = findGame(id);
  if (!g) return null;
  g.metaStatus = 'loading';
  commit();
  return applyMetadata(g, match);
});

ipcMain.handle('game:update', (_e, { id, patch }) => {
  const g = findGame(id);
  if (!g) return null;
  const allowed = ['name', 'args', 'favorite', 'exePath'];
  for (const k of allowed) if (k in patch) g[k] = patch[k];
  if ('name' in patch) g.customName = true;
  commit();
  return g;
});

ipcMain.handle('game:remove', (_e, id) => {
  store.data.games = games().filter((g) => g.id !== id);
  fs.rmSync(path.join(MEDIA, path.basename(id)), { recursive: true, force: true });
  commit();
  return true;
});

ipcMain.handle('game:setImage', async (_e, { id, kind }) => {
  const g = findGame(id);
  if (!g || !['cover', 'hero', 'logo'].includes(kind)) return null;
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir une image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const dir = path.join(MEDIA, g.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${kind}-custom${path.extname(src).toLowerCase()}`;
  fs.copyFileSync(src, path.join(dir, file));
  g.media = { ...g.media, [kind]: file };
  if (kind === 'cover') g.color = meta.dominantColor(path.join(dir, file)) || g.color;
  g.mediaVersion = Date.now();
  commit();
  return g;
});

ipcMain.handle('game:openFolder', (_e, id) => {
  const g = findGame(id);
  if (g) shell.showItemInFolder(g.exePath);
});

// ---------- Lancement ----------
function splitArgs(s = '') {
  return (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
}

function finishSession(id) {
  const r = running.get(id);
  if (!r) return;
  running.delete(id);
  const g = findGame(id);
  if (g) g.playtime = (g.playtime || 0) + Math.round((Date.now() - r.start) / 1000);
  commit();
  send('game:running', { id, running: false });
  if (store.data.settings.minimizeOnLaunch && win && running.size === 0) {
    win.restore();
    win.focus();
  }
}

ipcMain.handle('game:launch', async (_e, id) => {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'Jeu introuvable.' };
  if (running.has(id)) return { ok: false, error: 'Le jeu est déjà lancé.' };
  if (!fs.existsSync(g.exePath)) return { ok: false, error: 'Fichier introuvable : ' + g.exePath };

  g.lastPlayed = Date.now();
  g.playCount = (g.playCount || 0) + 1;
  const ext = path.extname(g.exePath).toLowerCase();
  const cwd = path.dirname(g.exePath);

  const onStarted = () => {
    commit();
    send('game:running', { id, running: true });
    if (store.data.settings.minimizeOnLaunch) setTimeout(() => win && win.minimize(), 600);
  };

  // Raccourcis : on laisse Windows les ouvrir (pas de suivi du temps de jeu).
  if (ext === '.lnk' || ext === '.url') {
    const err = await shell.openPath(g.exePath);
    if (err) return { ok: false, error: err };
    commit();
    if (store.data.settings.minimizeOnLaunch) setTimeout(() => win && win.minimize(), 600);
    return { ok: true, tracked: false };
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = ext === '.bat' || ext === '.cmd'
        ? spawn('cmd.exe', ['/c', g.exePath, ...splitArgs(g.args)], { cwd, detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(g.exePath, splitArgs(g.args), { cwd, detached: true, stdio: 'ignore' });
    } catch (e) {
      return resolve({ ok: false, error: String(e.message || e) });
    }
    let settled = false;
    child.once('spawn', () => {
      settled = true;
      running.set(id, { child, start: Date.now() });
      child.unref();
      onStarted();
      resolve({ ok: true, tracked: true });
    });
    child.once('exit', () => finishSession(id));
    child.once('error', async (e) => {
      if (settled) return;
      settled = true;
      // Jeux qui exigent les droits admin (erreur 740) : on passe par le shell (UAC).
      const err = await shell.openPath(g.exePath);
      if (!err) { onStarted(); resolve({ ok: true, tracked: false }); }
      else resolve({ ok: false, error: e.message || err });
    });
  });
});

// ---------- Réglages / fenêtre ----------
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(store.data.settings, patch);
  if ('fullscreen' in patch && win) win.setFullScreen(!!patch.fullscreen);
  commit();
  return store.data.settings;
});
ipcMain.handle('win:toggleFullscreen', () => {
  if (!win) return;
  const fs_ = !win.isFullScreen();
  win.setFullScreen(fs_);
  store.data.settings.fullscreen = fs_;
  store.save();
  return fs_;
});
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:openExternal', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Mises à jour automatiques (GitHub Releases) ----------
const update = { state: 'idle', version: null, progress: 0, error: null };
function updateSend(patch) {
  Object.assign(update, patch);
  send('update:status', { ...update, current: app.getVersion() });
}
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => updateSend({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => updateSend({ state: 'downloading', version: i.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => updateSend({ state: 'uptodate' }));
  autoUpdater.on('download-progress', (p) => updateSend({ state: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => updateSend({ state: 'ready', version: i.version, progress: 100 }));
  autoUpdater.on('error', (e) => updateSend({ state: 'error', error: String(e?.message || e).slice(0, 200) }));
  const check = () => { if (running.size === 0) autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 4000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:get', () => ({ ...update, current: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ...update, state: 'dev', current: app.getVersion() };
  try { await autoUpdater.checkForUpdates(); } catch (e) { updateSend({ state: 'error', error: String(e.message || e) }); }
  return { ...update, current: app.getVersion() };
});
ipcMain.handle('update:install', () => {
  if (update.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true));
});

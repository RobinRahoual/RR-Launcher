// RR Launcher — processus principal Electron
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu, Tray, nativeImage, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { JsonStore } = require('./store');
const meta = require('./metadata');
const scanner = require('./scanner');
const { BY_ID, platformForFile, detectEmulator, publicPlatforms, romExtensions } = require('./platforms');
const { autoUpdater } = require('electron-updater');
const guide = require('./guide'); // GUIDE : bouton Xbox / PS / Home (natif optionnel)
const padwake = require('./padwake'); // WAKE : manette allumée → launcher au premier plan

protocol.registerSchemesAsPrivileged([
  { scheme: 'rr', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }, // CAPTURE : stream (lecture des clips)
]);

if (process.env.RR_DATA) app.setPath('userData', process.env.RR_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const DATA = app.getPath('userData');
const MEDIA = path.join(DATA, 'media');
const PLATFORM_MEDIA = path.join(MEDIA, '_platforms');
const DEFAULT_SETTINGS = {
  sgdbKey: '',
  tgdbKey: '',
  fullscreen: true,
  hideOnLaunch: true, // masquer le launcher pendant le jeu, le réafficher à la fin
  closeToTray: true, // la croix / Alt+F4 envoie le launcher dans la zone de notification
  openAtLogin: false,
  sounds: true,
  volume: 0.7,
  caseStyle: 'blue', // boîtes PC : red | black | blue | auto
  theme: 'light', // light | dark | system
  sort: 'recent',
  emulators: {}, // platformId -> { path, args, name }
  platformImages: {}, // platformId -> fichier
  platformLogos: {}, // platformId -> fichier (téléchargé localement, jamais dans le dépôt)
  platformLogoFails: {}, // platformId -> date (ms) du dernier échec ; nouvel essai après 24 h
  logosVersion: 0, // version de l'algorithme / de la liste de logos ayant rempli platformLogos
  guideButton: true, // GUIDE : le bouton Xbox / PS / Home de la manette ouvre le launcher (menu en jeu)
  wakeOnPad: true, // WAKE : allumer / brancher une manette ouvre le launcher s'il est masqué ou réduit
};
const store = new JsonStore(path.join(DATA, 'library.json'), { games: [], settings: DEFAULT_SETTINGS });
store.data.settings = { ...DEFAULT_SETTINGS, ...store.data.settings };
store.data.settings.platformLogos ||= {};
store.data.settings.platformLogoFails ||= {};
// Logos de consoles : si la liste ou l'algorithme a changé, on oublie les logos téléchargés
// (et les échecs mémorisés), sauf les logos choisis par l'utilisateur.
if (store.data.settings.logosVersion !== meta.LOGOS_VERSION) {
  const s = store.data.settings;
  const kept = {};
  for (const [id, f] of Object.entries(s.platformLogos)) if (typeof f === 'string' && f.includes('-custom-')) kept[id] = f;
  s.platformLogos = kept;
  s.platformLogoFails = {};
  s.logosVersion = meta.LOGOS_VERSION;
  store.save();
}
// 1.5 : nouvelle palette (bleu #3C91E6) — les boîtes PC rouges par défaut passent en bleu, une seule fois
if (!store.data.settings.paletteV2) {
  if (store.data.settings.caseStyle === 'red') store.data.settings.caseStyle = 'blue';
  store.data.settings.paletteV2 = true;
  store.save();
}
if ('minimizeOnLaunch' in store.data.settings) { store.data.settings.hideOnLaunch = store.data.settings.minimizeOnLaunch; delete store.data.settings.minimizeOnLaunch; }
// Migration 1.0.x → 1.1 : plateforme et type de lancement
for (const g of store.data.games) {
  if (!g.platform) g.platform = 'pc';
  if (!g.kind) g.kind = g.romPath ? 'rom' : 'exe';
}

meta.setLogFile(path.join(DATA, 'metadata.log'));

const startHidden = process.argv.includes('--hidden');
let win = null;
let tray = null;
let quitting = false;
const running = new Map(); // id -> { start, child?, watchDir?, timer? }
const protoRoutes = {}; // CAPTURE : hôte rr://<hôte>/… → gestionnaire fourni par un module (ctx.protoRoute)

// ---------------------------------------------------------------- Fenêtre
function createWindow() {
  const s = store.data.settings;
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 560,
    frame: false,
    fullscreen: !!s.fullscreen,
    backgroundColor: (s.theme === 'dark' || (s.theme === 'system' && nativeTheme.shouldUseDarkColors)) ? '#101010' : '#FFFFFF',
    show: false,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    title: 'RR Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (startHidden) return;
    win.show();
    if (!s.fullscreen) win.maximize();
  });
  win.on('close', (e) => {
    if (!quitting && store.data.settings.closeToTray) { e.preventDefault(); hideToTray(); }
  });
  win.on('enter-full-screen', () => send('win:fullscreen', true));
  win.on('leave-full-screen', () => send('win:fullscreen', false));
  win.on('show', () => { send('win:visible', true); updatePadWake(); });
  win.on('focus', () => recheckSessions());
  win.on('hide', () => { send('win:visible', false); updatePadWake(); });
  // WAKE : réduite / restaurée → (dés)active la surveillance des manettes
  win.on('minimize', () => updatePadWake());
  win.on('restore', () => updatePadWake());
  // GUIDE : « toujours au premier plan » n'est que temporaire (pour passer devant un jeu)
  win.on('blur', () => { if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Capture d'écran automatique (tests uniquement)
  if (process.env.RR_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      for (const spec of process.env.RR_SHOT.split(/,(?=\/)/)) {
        const [file, js, wait] = spec.split('|');
        if (js) await win.webContents.executeJavaScript(js).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, Number(wait || 2500)));
        fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      }
      quitting = true;
      app.quit();
    });
  }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (store.data.settings.fullscreen && !win.isFullScreen()) win.setFullScreen(true);
}
// WAKE : ramène VRAIMENT le launcher au premier plan (fin de partie, manette allumée).
// Sous Windows une application en arrière-plan ne peut pas voler le premier plan (la fenêtre reste
// derrière ou clignote dans la barre des tâches) : show + restore + plein écran si réglé, puis
// « toujours au premier plan » temporaire (~1,5 s) et focusWindow natif (AttachThreadInput + astuce Alt).
let wakeTopTimer = null;
function bringToFront(reason, extra = {}) {
  if (!win || win.isDestroyed()) return;
  const wasHidden = !win.isVisible();
  const wasFront = !wasHidden && !win.isMinimized() && win.isFocused();
  showWindow(); // restore + show + focus + plein écran si réglé
  if (!wasFront) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    const n = winNative();
    if (n) {
      try { n.allowForeground(); if (!win.isFocused()) n.focusWindow(n.hwndOf(win.getNativeWindowHandle())); }
      catch (e) { meta.log(`premier plan : ${e.message}`); }
    }
    clearTimeout(wakeTopTimer);
    wakeTopTimer = setTimeout(() => {
      // le menu en jeu garde « toujours au premier plan » tant qu'il est ouvert (voir guide:ingame)
      if (win && !win.isDestroyed() && win.isAlwaysOnTop() && !ingameOpen) win.setAlwaysOnTop(false);
    }, 1500);
  }
  send('win:wake', { reason, wasHidden, wasFront, ...extra });
}
function hideToTray() {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  win.hide();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'icon.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('RR Launcher');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  refreshTrayMenu();
}
function refreshTrayMenu() {
  if (!tray) return;
  const recent = [...store.data.games].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir RR Launcher', click: showWindow },
    { type: 'separator' },
    ...(recent.length ? [{ label: 'Récents', enabled: false }, ...recent.map((g) => ({ label: g.name, click: () => launchGame(g.id) })), { type: 'separator' }] : []),
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; guideWatch.stop(); guideWatch.setConnect(false); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  protocol.handle('rr', (req) => {
    // rr://media/<gameId|_platforms>/<fichier>
    const u = new URL(req.url);
    if (protoRoutes[u.hostname]) return protoRoutes[u.hostname](req, u); // CAPTURE : routes des modules (rr://capture/…)
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (u.hostname !== 'media' || parts.length !== 2) return new Response('Not found', { status: 404 });
    const [id, file] = parts.map((p) => path.basename(p));
    const full = path.join(MEDIA, id, file);
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();
  loadFeatures();
  createTray();
  setupUpdater();
  // Raccourci global pour faire revenir le launcher depuis n'importe où
  // (pendant un jeu, il ouvre aussi le menu en jeu, comme le bouton Guide)
  try { globalShortcut.register('CommandOrControl+Alt+L', () => summon('shortcut')); } catch { /* déjà pris */ }
  applyLoginItem();
  updateGuideWatch();
  // WAKE : démarrage avec --hidden (« Lancer au démarrage de Windows ») : fenêtre jamais montrée → surveillance active
  // (sinon l'événement « show » de la fenêtre s'en charge)
  if (startHidden) updatePadWake();
});
app.on('window-all-closed', () => { if (quitting) app.quit(); });

function applyLoginItem() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.data.settings.openAtLogin, args: ['--hidden'] });
}

// ---------------------------------------------------------------- Bibliothèque
const games = () => store.data.games;
const findGame = (id) => games().find((g) => g.id === id);
const publicState = () => ({
  games: games(),
  settings: store.data.settings,
  running: [...running.keys()],
  platforms: publicPlatforms(),
  version: app.getVersion(),
});
let commitTimer = null;
function commit() {
  store.save();
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => { send('lib:changed', publicState()); refreshTrayMenu(); }, 60);
}

const GENERIC = /^(launcher|game|start|play|setup|bootstrap|unity|unreal|engine|client|win64|x64|binaries|bin|shipping|release|app|eboot)$/i;
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
    if (c && !GENERIC.test(c.replace(/\s/g, '')) && !/^(common|steamapps|games?|jeux|usrdir|ps3_game|program files.*|[a-z]:)$/i.test(c)) return c;
  }
  return exe || 'Nouveau jeu';
}
async function guessName(file, platform) {
  if (platform && platform !== 'pc') {
    if (/eboot\.bin$/i.test(file)) {
      const sfo = path.join(path.dirname(path.dirname(file)), 'PARAM.SFO');
      const t = await scanner.readSfoTitle(sfo);
      if (t) return t;
      return folderGuess(path.dirname(path.dirname(path.dirname(file))));
    }
    if (/\.exe$/i.test(file)) return exeProductName(file);
    return scanner.cleanRomName(file);
  }
  return exeProductName(file);
}
function exeProductName(exePath) {
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

const PICK_FILTERS = () => [
  { name: 'Jeux et ROMs', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd', 'bin', ...romExtensions()] },
  { name: 'Tous les fichiers', extensions: ['*'] },
];
async function inspectFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let platform = platformForFile(file);
  if (!platform || platform === 'unknown') platform = ['exe', 'lnk', 'url', 'bat', 'cmd'].includes(ext) ? 'pc' : (platform === 'unknown' ? 'ps2' : 'pc');
  const isRom = !['exe', 'lnk', 'url', 'bat', 'cmd'].includes(ext);
  return { path: file, platform, isRom, ambiguous: platformForFile(file) === 'unknown', name: await guessName(file, platform) };
}
ipcMain.handle('game:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choisir le jeu (.exe) ou la ROM', properties: ['openFile'], filters: PICK_FILTERS() });
  if (r.canceled || !r.filePaths[0]) return null;
  return inspectFile(r.filePaths[0]);
});
ipcMain.handle('game:inspect', (_e, file) => inspectFile(file));

ipcMain.handle('meta:search', async (_e, { term, platform }) => {
  try { return { ok: true, results: await meta.search(term, store.data.settings, BY_ID[platform] || BY_ID.pc) }; }
  catch (e) { return { ok: false, error: String(e.message || e), results: [] }; }
});

// ---------- Récupération des métadonnées (file d'attente) ----------
async function applyMetadata(game, match) {
  const dir = path.join(MEDIA, game.id);
  const progress = (msg) => send('game:progress', { id: game.id, msg });
  const platform = BY_ID[game.platform] || BY_ID.pc;
  try {
    if (!match) {
      if (game.appid) match = { source: 'steam', appid: game.appid, name: game.name };
      else if (platform.id !== 'pc') match = { source: 'auto', name: game.name };
      else {
        progress('Recherche du jeu…');
        const res = await meta.search(game.name, store.data.settings, platform).catch(() => []);
        const norm = meta.normalize;
        match = res.find((r) => norm(r.name) === norm(game.name)) || res[0] || { source: 'none', name: game.name };
        meta.log(`recherche auto « ${game.name} » → ${res.length} résultat(s), choisi : ${match.source} ${match.name}`);
      }
    }
    const tmp = dir + '.new';
    fs.rmSync(tmp, { recursive: true, force: true });
    const info = await meta.fetchAll(match, tmp, store.data.settings, progress, { platform, romPath: game.romPath });
    const found = info.media.cover || info.media.hero || info.media.header || info.media.logo;
    if (found || !fs.existsSync(dir)) {
      fs.rmSync(dir + '.keep', { recursive: true, force: true });
      if (fs.existsSync(dir)) fs.renameSync(dir, dir + '.keep');
      if (fs.existsSync(tmp)) fs.renameSync(tmp, dir);
    } else {
      fs.rmSync(tmp, { recursive: true, force: true });
      info.media = game.media || {};
      info.screenshots = game.screenshots || [];
      info.color = game.color;
    }
    // Pour les jeux Steam importés, le nom Steam fait foi ; sinon on garde le nom choisi.
    const keepName = game.customName || (platform.id !== 'pc' && match.source !== 'wiki');
    // Les images choisies à la main sont conservées
    const custom = Object.fromEntries(Object.entries(game.media || {}).filter(([, f]) => f && /-custom-/.test(f)));
    if (Object.keys(custom).length && fs.existsSync(dir)) {
      for (const f of Object.values(custom)) {
        const from = path.join(dir + '.keep', f);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, f));
      }
    }
    fs.rmSync(dir + '.keep', { recursive: true, force: true });
    info.media = { ...info.media, ...custom };
    Object.assign(game, info, { name: keepName ? game.name : info.name || game.name });
    if (info.appid && game.kind !== 'steam') game.appid = info.appid;
    game.metaStatus = game.media.cover || game.media.hero || game.media.header ? 'ok' : 'none';
  } catch (e) {
    game.metaStatus = 'none';
    meta.log(`applyMetadata ${game.name} : ${e.message}`);
  }
  game.mediaVersion = Date.now();
  commit();
  send('game:progress', { id: game.id, done: true });
  return game;
}
const queue = [];
let active = 0;
function enqueue(game, match) {
  return new Promise((resolve) => {
    queue.push({ game, match, resolve });
    pump();
  });
}
function pump() {
  while (active < 2 && queue.length) {
    const { game, match, resolve } = queue.shift();
    active++;
    applyMetadata(game, match).then(resolve).finally(() => { active--; pump(); });
  }
}

function newGame(data) {
  return {
    id: crypto.randomUUID().slice(0, 8),
    name: data.name || 'Nouveau jeu',
    platform: data.platform || 'pc',
    kind: data.kind || 'exe',
    source: data.source || 'manual',
    exePath: data.exePath || '',
    romPath: data.romPath || '',
    installDir: data.installDir || '',
    launchUri: data.launchUri || '',
    appid: data.appid || null,
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
}
function gameKey(g) {
  if (g.kind === 'steam') return 'steam:' + g.appid;
  return (g.romPath || g.exePath || g.launchUri || '').toLowerCase();
}
function alreadyHave(item) {
  const k = gameKey(item);
  return games().some((g) => gameKey(g) === k || (item.installDir && g.installDir && g.installDir.toLowerCase() === item.installDir.toLowerCase()));
}

ipcMain.handle('game:add', async (_e, { file, name, platform, match }) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  const isExe = ['exe', 'lnk', 'url', 'bat', 'cmd'].includes(ext);
  const data = isExe ? { kind: 'exe', exePath: file } : { kind: 'rom', romPath: file };
  if (alreadyHave(data)) return { ok: false, error: 'Ce jeu est déjà dans ta bibliothèque.' };
  const game = newGame({ ...data, name, platform, installDir: isExe ? path.dirname(file) : '' });
  if (match && match.source !== 'none' && platform !== 'pc') game.customName = !!name;
  games().push(game);
  commit();
  enqueue(game, match);
  return { ok: true, id: game.id };
});

ipcMain.handle('games:addMany', async (_e, items) => {
  const added = [];
  for (const it of items) {
    if (alreadyHave(it)) continue;
    const g = newGame(it);
    games().push(g);
    added.push(g);
  }
  commit();
  for (const g of added) enqueue(g, null);
  return { ok: true, count: added.length };
});

ipcMain.handle('game:refetch', async (_e, { id, match }) => {
  const g = findGame(id);
  if (!g) return null;
  g.metaStatus = 'loading';
  commit();
  return enqueue(g, match);
});

ipcMain.handle('games:refetchAll', () => {
  for (const g of games()) { g.metaStatus = 'loading'; enqueue(g, null); }
  commit();
  return games().length;
});

ipcMain.handle('game:update', (_e, { id, patch }) => {
  const g = findGame(id);
  if (!g) return null;
  for (const k of ['name', 'args', 'favorite', 'exePath', 'romPath', 'platform']) if (k in patch) g[k] = patch[k];
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
  if (!g || !['cover', 'hero', 'logo', 'back'].includes(kind)) return null;
  const r = await dialog.showOpenDialog(win, { title: 'Choisir une image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const dir = path.join(MEDIA, g.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${kind}-custom-${Date.now()}${path.extname(src).toLowerCase()}`;
  fs.copyFileSync(src, path.join(dir, file));
  g.media = { ...g.media, [kind]: file };
  if (kind === 'cover') g.color = meta.dominantColor(path.join(dir, file)) || g.color;
  g.mediaVersion = Date.now();
  commit();
  return g;
});

ipcMain.handle('game:openFolder', (_e, id) => {
  const g = findGame(id);
  const target = g && (g.romPath || g.exePath || g.installDir);
  if (target) shell.showItemInFolder(target);
});

// ---------------------------------------------------------------- Images de consoles
const platformFetching = new Map();
ipcMain.handle('platform:image', async (_e, id) => {
  const s = store.data.settings;
  const known = s.platformImages[id];
  if (known && fs.existsSync(path.join(PLATFORM_MEDIA, known))) return known;
  const p = BY_ID[id];
  if (!p || !p.wiki) return null;
  if (!platformFetching.has(id)) {
    platformFetching.set(id, meta.platformImage(p.wiki, PLATFORM_MEDIA, id).catch((e) => { meta.log(`console ${id}: ${e.message}`); return null; }));
  }
  const file = await platformFetching.get(id);
  platformFetching.delete(id);
  if (file) { s.platformImages[id] = file; store.save(); }
  return file;
});
const logoFetching = new Map();
const LOGO_RETRY_MS = 24 * 3600 * 1000;
ipcMain.handle('platform:logo', async (_e, id) => {
  const s = store.data.settings;
  const known = s.platformLogos[id];
  if (known && fs.existsSync(path.join(PLATFORM_MEDIA, known))) return known;
  const p = BY_ID[id];
  if (!p || (!p.wiki && !(p.logos || []).length)) return null;
  const failedAt = s.platformLogoFails[id];
  if (failedAt && Date.now() - failedAt < LOGO_RETRY_MS) return null; // échec récent : on réessaiera plus tard
  if (!logoFetching.has(id)) {
    logoFetching.set(id, meta.platformLogo(p, PLATFORM_MEDIA).catch((e) => { meta.log(`logo ${id}: ${e.message}`); return null; }));
  }
  const file = await logoFetching.get(id);
  logoFetching.delete(id);
  if (file) { s.platformLogos[id] = file; delete s.platformLogoFails[id]; }
  else { if (known && !known.includes('-custom-')) delete s.platformLogos[id]; s.platformLogoFails[id] = Date.now(); }
  store.save();
  return file || null;
});
ipcMain.handle('platform:setLogo', async (_e, id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Logo de la console (PNG transparent conseillé)', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'svg', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(PLATFORM_MEDIA, { recursive: true });
  const file = `${id}-logo-custom-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
  fs.copyFileSync(r.filePaths[0], path.join(PLATFORM_MEDIA, file));
  store.data.settings.platformLogos[id] = file;
  delete store.data.settings.platformLogoFails[id];
  commit();
  return file;
});
ipcMain.handle('platform:setImage', async (_e, id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Image de la console (PNG détouré conseillé)', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(PLATFORM_MEDIA, { recursive: true });
  const file = `${id}-custom-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
  fs.copyFileSync(r.filePaths[0], path.join(PLATFORM_MEDIA, file));
  store.data.settings.platformImages[id] = file;
  commit();
  return file;
});

// ---------------------------------------------------------------- Émulateurs
ipcMain.handle('emu:pick', async (_e, platformId) => {
  const p = BY_ID[platformId];
  if (!p) return null;
  const r = await dialog.showOpenDialog(win, { title: `Émulateur pour ${p.name}`, properties: ['openFile'], filters: [{ name: 'Programmes', extensions: ['exe', 'bat', 'cmd'] }, { name: 'Tous', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const preset = detectEmulator(file).find((d) => d.platform === platformId);
  const conf = { path: file, args: preset?.args || '"{rom}"', name: preset?.emulator || path.basename(file, path.extname(file)) };
  store.data.settings.emulators[platformId] = conf;
  commit();
  return conf;
});
ipcMain.handle('emu:set', (_e, { platformId, conf }) => {
  if (conf) store.data.settings.emulators[platformId] = { ...store.data.settings.emulators[platformId], ...conf };
  else delete store.data.settings.emulators[platformId];
  commit();
  return store.data.settings.emulators[platformId] || null;
});
ipcMain.handle('emu:applyDetected', (_e, list) => {
  const emus = store.data.settings.emulators;
  let n = 0;
  for (const e of list) for (const m of e.matches) {
    if (!emus[m.platform]) { emus[m.platform] = { path: e.path, args: m.args, name: m.emulator }; n++; }
  }
  commit();
  return n;
});

// ---------------------------------------------------------------- Scan
let scanCancel = false;
ipcMain.handle('scan:pickFolders', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossiers à scanner', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('scan:cancel', () => { scanCancel = true; });
ipcMain.handle('scan:run', async (_e, { mode, folders }) => {
  scanCancel = false;
  const progress = (p) => send('scan:progress', p);
  let res = { items: [], emulators: [] };
  try {
    if (mode === 'steam') res = await scanner.scanSteam();
    else if (mode === 'epic') res = await scanner.scanEpic();
    else if (mode === 'gog') res = await scanner.scanGog();
    else if (mode === 'launchers') {
      const all = await Promise.all([scanner.scanSteam(), scanner.scanEpic(), scanner.scanGog()]);
      res = { ok: all.some((a) => a.ok), items: all.flatMap((a) => a.items || []), error: all.every((a) => !a.ok) ? 'Aucun launcher trouvé (Steam, Epic, GOG).' : null };
    } else {
      const roots = mode === 'pc' ? await scanner.listDrives() : folders || [];
      res = await scanner.scanFolders(roots, { wholePc: mode === 'pc', onProgress: progress, isCancelled: () => scanCancel });
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e), items: [], emulators: [] };
  }
  const items = (res.items || []).map((it, i) => ({ ...it, key: i, exists: alreadyHave(it) }));
  return { ok: res.ok !== false || items.length > 0, error: res.error, items, emulators: res.emulators || [], cancelled: !!res.cancelled, dirs: res.dirs };
});

// ---------------------------------------------------------------- Lancement & sessions
function splitArgs(s = '') {
  return (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
}

// Nombre de processus dont l'exécutable est dans `dir` (Windows).
// Nombre de processus dont l'exécutable est dans `dir` (-1 = inconnu).
// 1) natif (koffi) : voit aussi les jeux lancés en administrateur ; 2) repli PowerShell.
function normDir(dir) { return path.resolve(String(dir || '')).replace(/[\\/]+$/, '').toLowerCase(); }
function countProcessesIn(dir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !dir) return resolve(0);
    const d = normDir(dir) + '\\';
    const n = winNative();
    if (n) {
      try {
        const procs = n.listProcesses();
        return resolve(procs.filter((p) => p.pid !== process.pid && p.path && p.path.toLowerCase().startsWith(d)).length);
      } catch (e) { meta.log(`suivi : liste native des processus : ${e.message}`); }
    }
    // StartsWith plutôt que -like : les crochets des noms de dossiers ([DODI]…) sont des jokers pour -like
    const lit = d.replace(/'/g, "''");
    const ps = `@(Get-CimInstance Win32_Process -Property ExecutablePath | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith('${lit}') }).Count`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true }, (err, out) => {
      resolve(err ? -1 : parseInt(String(out).trim() || '0', 10) || 0);
    });
  });
}
// Un dossier trop large (racine d'un disque, Program Files, profil, Bureau, dossier Steam…) contient
// d'autres programmes qui tournent en permanence : la session ne se terminerait jamais.
function tooBroad(dir) {
  const d = normDir(dir);
  if (!d || /^[a-z]:$/.test(d)) return true;
  const env = process.env;
  const broad = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA, env.SystemRoot,
    env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop'), env.USERPROFILE && path.join(env.USERPROFILE, 'Downloads')]
    .filter(Boolean).map(normDir);
  if (broad.includes(d)) return true;
  return /\\(steam|steamapps|steamapps\\common|epic games|gog galaxy|gog games|games|jeux)$/.test(d);
}

function onSessionStart(id) {
  hub?.emit('session:start', id, { start: running.get(id)?.start || Date.now() });
  send('game:running', { id, running: true });
  commit();
  updatePadWake(); // WAKE : pendant un jeu, seul le sondage Guide reste actif
  if (store.data.settings.hideOnLaunch) setTimeout(() => { if (running.has(id) && !ingameOpen) hideToTray(); }, 900);
}
function finishSession(id) {
  const r = running.get(id);
  if (!r) return;
  try { const end = Date.now(); hub.emit('session:end', id, { start: r.start, end, seconds: Math.round((end - r.start) / 1000) }); } catch (e) { meta.log(`hub : ${e.message}`); }
  clearInterval(r.timer);
  running.delete(id);
  const g = findGame(id);
  if (g) g.playtime = (g.playtime || 0) + Math.round((Date.now() - r.start) / 1000);
  commit();
  send('game:running', { id, running: false, name: g?.name });
  // WAKE : dernière session terminée → le launcher revient devant, que hideOnLaunch soit actif ou non
  if (running.size === 0) bringToFront('session-end', { id, platform: g?.platform || null });
  updatePadWake();
}

// Surveille les processus du dossier du jeu (jeux Steam/Epic, ou exécutables qui se relancent).
function watchDir(id, dir, { graceMs = 180000, exe = '' } = {}) {
  const r = running.get(id);
  if (!r || !dir || process.platform !== 'win32') return;
  // Dossier trop large : on se rabat sur le dossier de l'exécutable
  if (tooBroad(dir) && exe && !tooBroad(path.dirname(exe))) dir = path.dirname(exe);
  if (tooBroad(dir)) meta.log(`suivi : dossier très large pour ${findGame(id)?.name} (${dir}), la fin de partie peut ne pas être détectée`);
  clearInterval(r.timer);
  let seen = false, misses = 0, busy = false;
  const started = Date.now();
  const check = async () => {
    if (busy || !running.has(id)) return;
    busy = true;
    try {
      const n = await countProcessesIn(dir);
      if (n < 0) return;
      if (n > 0) { seen = true; misses = 0; return; }
      if (seen) { if (++misses >= 2) finishSession(id); }
      else if (Date.now() - started > graceMs) finishSession(id);
    } finally { busy = false; }
  };
  r.check = check;
  r.timer = setInterval(check, 3000);
}
// Revérifie tout de suite les sessions en cours (ex. quand on revient sur le launcher)
function recheckSessions() { for (const r of running.values()) r.check?.(); }

async function launchGame(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'Jeu introuvable.' };
  // GUIDE : relancer un jeu déjà en cours = le reprendre (remise au premier plan), pas une 2e instance
  if (running.has(id)) return resumeGame(id);

  const begin = (extra = {}) => {
    g.lastPlayed = Date.now();
    g.playCount = (g.playCount || 0) + 1;
    running.set(id, { start: Date.now(), ...extra });
    onSessionStart(id);
  };

  // Steam / Epic : via le protocole du launcher, puis surveillance du dossier d'installation
  if (g.kind === 'steam' || g.kind === 'epic') {
    const uri = g.kind === 'steam' ? `steam://rungameid/${g.appid}` : g.launchUri;
    try { await shell.openExternal(uri); } catch (e) { return { ok: false, error: 'Impossible d’ouvrir ' + (g.kind === 'steam' ? 'Steam' : 'Epic Games') }; }
    begin();
    watchDir(id, g.installDir);
    return { ok: true };
  }

  // ROM : via l'émulateur configuré pour la plateforme
  if (g.kind === 'rom') {
    const emu = store.data.settings.emulators[g.platform];
    if (!emu?.path) return { ok: false, error: 'NO_EMULATOR', platform: g.platform };
    if (!fs.existsSync(emu.path)) return { ok: false, error: 'Émulateur introuvable : ' + emu.path };
    if (!fs.existsSync(g.romPath)) return { ok: false, error: 'ROM introuvable : ' + g.romPath };
    const args = splitArgs(emu.args || '"{rom}"').map((a) => a.replace('{rom}', g.romPath).replace('{romdir}', path.dirname(g.romPath)));
    return spawnTracked(id, emu.path, args, path.dirname(emu.path), begin);
  }

  // Exécutable
  if (!fs.existsSync(g.exePath)) return { ok: false, error: 'Fichier introuvable : ' + g.exePath };
  const ext = path.extname(g.exePath).toLowerCase();
  if (ext === '.lnk' || ext === '.url') {
    const err = await shell.openPath(g.exePath);
    if (err) return { ok: false, error: err };
    begin();
    watchDir(id, g.installDir || path.dirname(g.exePath), { graceMs: 60000, exe: g.exePath });
    return { ok: true };
  }
  const cwd = path.dirname(g.exePath);
  if (ext === '.bat' || ext === '.cmd') return spawnTracked(id, 'cmd.exe', ['/c', g.exePath, ...splitArgs(g.args)], cwd, begin);
  return spawnTracked(id, g.exePath, splitArgs(g.args), cwd, begin, g.installDir || cwd);
}

function spawnTracked(id, file, args, cwd, begin, followDir) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    } catch (e) {
      return resolve({ ok: false, error: String(e.message || e) });
    }
    let settled = false;
    child.once('spawn', () => {
      settled = true;
      child.unref();
      begin({ child });
      resolve({ ok: true });
    });
    child.once('exit', () => {
      const r = running.get(id);
      if (!r) return;
      // Si le programme a passé la main à un autre processus (petit launcher), on suit le dossier.
      if (followDir && Date.now() - r.start < 20000) watchDir(id, followDir, { graceMs: 15000, exe: file });
      else finishSession(id);
    });
    child.once('error', async (e) => {
      if (settled) return;
      settled = true;
      // Exige les droits admin (erreur 740) : on passe par le shell (UAC).
      const err = await shell.openPath(file);
      if (!err) { begin(); watchDir(id, followDir || cwd, { graceMs: 60000, exe: file }); resolve({ ok: true }); }
      else resolve({ ok: false, error: e.message || err });
    });
  });
}

ipcMain.handle('game:launch', (_e, id) => launchGame(id));

// ---------------------------------------------------------------- Réglages / fenêtre
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(store.data.settings, patch);
  if ('fullscreen' in patch && win) win.setFullScreen(!!patch.fullscreen);
  if ('openAtLogin' in patch) applyLoginItem();
  if ('guideButton' in patch) updateGuideWatch();
  if ('wakeOnPad' in patch) updatePadWake(); // WAKE
  commit();
  return store.data.settings;
});
ipcMain.handle('win:toggleFullscreen', () => {
  if (!win) return;
  const v = !win.isFullScreen();
  win.setFullScreen(v);
  store.data.settings.fullscreen = v;
  store.save();
  return v;
});
ipcMain.handle('win:minimize', () => hideToTray());
ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
ipcMain.handle('app:openExternal', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------------------------------------------------------------- Mises à jour automatiques (GitHub Releases)
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
  if (update.state === 'ready') { quitting = true; setImmediate(() => autoUpdater.quitAndInstall(true, true)); }
});

// ---------------------------------------------------------------- GUIDE : bouton Xbox / PS / Home, menu en jeu, alimentation
// Le bouton Guide (ou Ctrl+Alt+L) fait revenir le launcher au premier plan ; le renderer ouvre alors le
// menu en jeu (reprendre, quitter, changer de jeu, alimentation). Sondage natif optionnel (src/guide.js).
let ingameOpen = false; // le renderer signale l'ouverture / fermeture du menu en jeu
let nativeWin; // undefined = pas encore essayé, null = indisponible
function winNative() {
  if (nativeWin !== undefined) return nativeWin;
  nativeWin = null;
  if (process.platform !== 'win32') return null;
  try { nativeWin = require('./native-win'); } catch (e) { meta.log(`guide : module natif indisponible (${e.message})`); }
  return nativeWin;
}
const guideWatch = guide.createGuideWatcher({
  log: (m) => meta.log(m),
  loadNative: () => { const n = winNative(); if (!n) throw new Error(process.platform !== 'win32' ? 'Windows uniquement' : 'koffi non chargé'); return n; },
  onGuide: () => summon('guide'),
  // Menu en jeu affiché mais fenêtre sans focus (Windows a refusé le premier plan) : on relaie la manette
  wantRemote: () => ingameOpen && !!win && win.isVisible() && !win.isFocused(),
  onRemote: (btn) => send('pad:remote', btn),
  // WAKE : une manette vient de s'allumer / d'être branchée (launcher masqué ou réduit, aucun jeu)
  onConnect: () => { if (running.size === 0) bringToFront('pad'); },
  // CAPTURE : pendant un jeu (launcher pas au premier plan), Guide + RB / LB / B, Guide maintenu et Share
  combos: () => store.data.settings.padShortcuts !== false && running.size > 0 && !(win && !win.isDestroyed() && win.isVisible() && win.isFocused()),
  onCombo: (name, src) => { if (name === 'quit' || name === 'power') summon('guide', name); else hub.emit('pad:combo', name, src); },
});
function updateGuideWatch() {
  if (store.data.settings.guideButton !== false) guideWatch.start(); else guideWatch.stop();
}
// WAKE : surveillance des connexions de manettes — fenêtre masquée (zone de notification, y compris
// démarrage avec --hidden) ou réduite, aucun jeu en cours, réglage wakeOnPad actif.
function updatePadWake() {
  const ok = !!win && !win.isDestroyed();
  guideWatch.setConnect(padwake.wakeWanted({
    enabled: store.data.settings.wakeOnPad !== false,
    gameRunning: running.size > 0,
    hidden: ok && !win.isVisible(),
    minimized: ok && win.isMinimized(),
  }));
}

// Fait revenir le launcher devant tout (y compris un jeu en plein écran fenêtré) et prévient le renderer.
// Fenêtre déjà active et visible : le renderer décide seul (ouvrir / fermer le menu en jeu ou le menu).
function summon(source, intent) { // CAPTURE : intent 'quit' | 'power' → menu en jeu ouvert sur ce sous-menu
  if (!win || win.isDestroyed()) return;
  const front = win.isVisible() && !win.isMinimized() && win.isFocused();
  if (!front) {
    if (running.size) win.setAlwaysOnTop(true, 'screen-saver');
    showWindow();
    win.moveTop();
    const n = winNative();
    if (n && !win.isFocused()) n.focusWindow(n.hwndOf(win.getNativeWindowHandle()));
  }
  send('guide:press', { source, summoned: !front, running: [...running.keys()], intent: intent || null });
}

// ---------- Processus d'un jeu en cours
// Dossier dont les processus appartiennent au jeu (jamais une racine de disque ni un dossier système)
function gameDir(g) {
  if (!g) return '';
  let d = '';
  if (g.kind === 'steam' || g.kind === 'epic') d = g.installDir;
  else if (g.kind === 'rom') d = path.dirname(store.data.settings.emulators[g.platform]?.path || '');
  else d = g.installDir || (g.exePath ? path.dirname(g.exePath) : '');
  d = (d || '').replace(/[\\/]+$/, '');
  const parts = d.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2 || /^(windows|system32|program files( \(x86\))?|programdata|users|common|steamapps|games|jeux)$/i.test(parts[parts.length - 1])) return '';
  return d;
}
function listProcessesPs() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      try { resolve([].concat(JSON.parse(out)).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, path: p.ExecutablePath || '' }))); } catch { resolve([]); }
    });
  });
}
// PID du jeu : processus enfant lancé (et ses descendants) + processus dont l'exe est dans le dossier du jeu
async function gamePids(id) {
  const r = running.get(id);
  const g = findGame(id);
  if (!r) return [];
  const n = winNative();
  let procs = [];
  try { procs = n ? n.listProcesses() : await listProcessesPs(); } catch (e) { meta.log(`guide : liste des processus : ${e.message}`); procs = await listProcessesPs(); }
  const set = new Set();
  const child = r.child && r.child.exitCode === null && r.child.pid ? r.child.pid : 0;
  if (child) set.add(child);
  const dir = gameDir(g).toLowerCase();
  if (dir) for (const p of procs) if (p.path && p.path.toLowerCase().startsWith(dir + '\\')) set.add(p.pid);
  // Descendants (un jeu lancé par un petit launcher, un émulateur qui ouvre une 2e fenêtre…)
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) if (!set.has(p.pid) && set.has(p.ppid) && p.pid !== process.pid) { set.add(p.pid); grew = true; }
  }
  set.delete(process.pid);
  return [...set];
}

// Reprendre : remet la fenêtre du jeu au premier plan, puis masque le launcher
async function resumeGame(id) {
  id = id && running.has(id) ? id : [...running.keys()].pop();
  if (!id) { hideToTray(); return { ok: false, error: 'Aucun jeu en cours.' }; }
  let focused = false;
  const n = winNative();
  if (n) {
    try {
      n.allowForeground();
      const hwnd = n.findMainWindow(await gamePids(id));
      if (hwnd) focused = n.focusWindow(hwnd);
      if (!hwnd) meta.log(`guide : fenêtre du jeu ${findGame(id)?.name} introuvable`);
    } catch (e) { meta.log(`guide : reprise ${e.message}`); }
  }
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(false);
    if (store.data.settings.hideOnLaunch || !focused) hideToTray();
  }
  return { ok: true, resumed: true, focused };
}

// Quitter : termine le jeu et ses processus, comptabilise le temps de jeu
async function quitGame(id) {
  const r = running.get(id);
  if (!r) return { ok: false, error: 'Ce jeu n’est plus en cours.' };
  const pids = await gamePids(id);
  if (process.platform === 'win32') {
    if (pids.length) {
      await new Promise((resolve) => execFile('taskkill', ['/F', '/T', ...pids.flatMap((p) => ['/PID', String(p)])], { windowsHide: true, timeout: 15000 }, (err, _o, se) => {
        if (err) meta.log(`guide : taskkill ${String(se || err.message).trim().slice(0, 300)}`);
        resolve();
      }));
    } else meta.log(`guide : aucun processus trouvé pour ${findGame(id)?.name}`);
  } else {
    for (const p of pids) { try { process.kill(p, 'SIGTERM'); } catch {} }
  }
  finishSession(id);
  return { ok: true, killed: pids.length };
}

ipcMain.handle('game:resume', (_e, id) => resumeGame(id));
ipcMain.handle('game:quit', (_e, id) => quitGame(id));
ipcMain.handle('game:sessions', () => [...running.entries()].map(([id, r]) => ({ id, start: r.start })));
ipcMain.handle('guide:status', () => ({ ...guideWatch.status(), enabled: store.data.settings.guideButton !== false, wakeOnPad: store.data.settings.wakeOnPad !== false }));
ipcMain.handle('guide:ingame', (_e, open) => {
  ingameOpen = !!open;
  if (!ingameOpen && win && !win.isDestroyed() && win.isAlwaysOnTop() && win.isFocused()) win.setAlwaysOnTop(false);
});

// ---------- Alimentation (Windows)
// Veille : SetSuspendState(FALSE…) via koffi. Repli : rundll32 powrprof.dll,SetSuspendState 0,1,0 —
// attention, rundll32 passe mal les arguments et Windows HIBERNE au lieu de mettre en veille si
// l'hibernation est activée (powercfg /h off pour l'éviter).
function endAllSessions() { for (const id of [...running.keys()]) finishSession(id); store.save(); }
ipcMain.handle('power:action', async (_e, act) => {
  if (!['shutdown', 'restart', 'sleep'].includes(act)) return { ok: false, error: 'Action inconnue' };
  if (process.platform !== 'win32') return { ok: false, error: 'Disponible uniquement sous Windows' };
  meta.log(`alimentation : ${act}`);
  if (act === 'sleep') {
    const n = winNative();
    if (n?.canSleep) { setTimeout(() => { try { n.sleep(); } catch (e) { meta.log(`veille : ${e.message}`); } }, 400); return { ok: true }; }
    execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true }, () => {});
    return { ok: true };
  }
  endAllSessions();
  return new Promise((resolve) => execFile('shutdown', [act === 'restart' ? '/r' : '/s', '/t', '0'], { windowsHide: true }, (err) => {
    resolve(err ? { ok: false, error: String(err.message || err) } : { ok: true });
  }));
});

// ---------------------------------------------------------------- Modules (src/features/*.js)
// Chaque module exporte init(ctx) ; IPC sur des canaux préfixés « x: » (rr.x / rr.onX côté renderer).
// hub : évènements 'session:start' (id, { start }), 'session:end' (id, { start, end, seconds }).
const hub = new (require('events'))();
function loadFeatures() {
  const dir = path.join(__dirname, 'features');
  if (!fs.existsSync(dir)) return;
  const ctx = {
    app, ipcMain, store, meta, hub, running, DATA, MEDIA,
    commit, send, findGame, showWindow, bringToFront, hideToTray,
    getWin: () => win, winNative: () => winNative(), log: (m) => meta.log(m),
    protoRoute: (host, fn) => { protoRoutes[host] = fn; }, // CAPTURE
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    try { require(path.join(dir, f)).init?.(ctx); } catch (e) { meta.log(`module ${f} : ${e.stack || e.message}`); }
  }
}

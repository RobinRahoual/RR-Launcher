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
const names = require('./names'); // noms collés (« RedDeadRedemption2 ») et similarité des titres
const guide = require('./guide'); // GUIDE : bouton Xbox / PS / Home (natif optionnel)
const padwake = require('./padwake'); // WAKE : manette allumée → launcher au premier plan
const emuLaunch = require('./features/emu/launch'); // EMU : profil de lancement par jeu (g.launch)

protocol.registerSchemesAsPrivileged([
  { scheme: 'rr', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }, // MEDIA : stream = lecture vidéo / audio via rr:
]);

// FIXES : vidéos de présentation et musique d'ambiance démarrent sans clic préalable
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const fixesMedia = require('./features/fixes'); // FIXES : serveFile (Range) pour l'audio / la vidéo via rr://

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
  trackOutside: true, // PLAYTIME : compter les jeux lancés hors du launcher
  syncPlaytime: true, // PLAYTIME : reprendre les heures de Steam / GOG Galaxy / itch.io
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
  win.on('show', () => { send('win:visible', true); updatePadWake(); guideWatch.navFlush(); });
  win.on('focus', () => { recheckSessions(); guideWatch.navFlush(); });
  win.on('hide', () => { send('win:visible', false); updatePadWake(); guideWatch.navFlush(); });
  // WAKE : réduite / restaurée → (dés)active la surveillance des manettes
  win.on('minimize', () => { updatePadWake(); guideWatch.navFlush(); });
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
  frontAt = Date.now(); // NAV : la manette pilote le launcher qu'on vient de ramener devant
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
    // Windows refuse parfois le premier plan au 1er essai (jeu encore en train de se fermer) : on réessaie
    setTimeout(() => {
      if (!win || win.isDestroyed() || win.isFocused() || !win.isVisible()) return;
      try { const m = winNative(); win.show(); win.moveTop(); if (m) { m.allowForeground(); m.focusWindow(m.hwndOf(win.getNativeWindowHandle())); } } catch {}
    }, 700);
    clearTimeout(wakeTopTimer);
    wakeTopTimer = setTimeout(() => {
      // le menu en jeu garde « toujours au premier plan » tant qu'il est ouvert (voir guide:ingame)
      if (win && !win.isDestroyed() && win.isAlwaysOnTop() && !ingameOpen) win.setAlwaysOnTop(false);
    }, 2000);
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

// Icône de Windows après une mise à jour : les raccourcis (menu Démarrer, Bureau, barre des tâches) gardent l'icône
// en cache de l'ancienne version. Une fois par version : on réécrit l'icône des raccourcis qui pointent vers le
// launcher (ce qui invalide leur cache) puis on demande à l'Explorateur de recharger son cache d'icônes.
function refreshShellIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const v = app.getVersion();
  if (store.data.shellIconVersion === v) return;
  setTimeout(() => {
    try {
      const exe = process.execPath;
      const roaming = process.env.APPDATA || '';
      const links = [
        path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'RR Launcher.lnk'),
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'RR Launcher.lnk'),
        path.join(app.getPath('desktop'), 'RR Launcher.lnk'),
        path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'RR Launcher.lnk'),
      ];
      for (const l of links) {
        if (!fs.existsSync(l)) continue;
        try {
          const cur = shell.readShortcutLink(l);
          if (path.resolve(cur.target || '').toLowerCase() !== path.resolve(exe).toLowerCase()) continue;
          shell.writeShortcutLink(l, 'update', { icon: exe, iconIndex: 0 });
        } catch (e) { meta.log(`icône : raccourci ${l} : ${e.message}`); }
      }
      const { spawn } = require('child_process');
      const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
      if (fs.existsSync(sys)) spawn(sys, ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
      store.data.shellIconVersion = v;
      commit();
      meta.log(`icône : raccourcis rafraîchis pour ${v}`);
    } catch (e) { meta.log(`icône : ${e.message}`); }
  }, 4000);
}

app.whenReady().then(() => {
  protocol.handle('rr', (req) => {
    // rr://media/<gameId|_platforms>/<fichier>
    const u = new URL(req.url);
    if (protoRoutes[u.hostname]) return protoRoutes[u.hostname](req, u); // CAPTURE : routes des modules (rr://capture/…)
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    const ach = parts.length === 3 && parts[1] === 'ach'; // EXTRAS : rr://media/<gameId>/ach/<fichier> (icônes de succès)
    if (u.hostname !== 'media' || (parts.length !== 2 && !ach)) return new Response('Not found', { status: 404 });
    const [id, file] = (ach ? [parts[0], parts[2]] : parts).map((p) => path.basename(p));
    const full = ach ? path.join(MEDIA, id, 'ach', file) : path.join(MEDIA, id, file);
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    if (id === '_platforms') {
      // logos de console : lisibles par un <canvas> (crossorigin) pour analyser leurs couleurs
      return net.fetch(pathToFileURL(full).toString()).then((r) => new Response(r.body, {
        status: r.status, headers: { 'Content-Type': r.headers.get('content-type') || 'image/png', 'Access-Control-Allow-Origin': '*' },
      }));
    }
    if (fixesMedia.isStream(full)) return fixesMedia.serveFile(req, full); // FIXES : Range / 206 (boucle, recherche)
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();
  loadFeatures();
  scheduleHeroUpgrade(25000);
  createTray();
  setupUpdater();
  refreshShellIcons();
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
  return names.prettify(s
    .replace(/\.(exe|lnk|url|bat|cmd)$/i, '')
    .replace(/[-_ ](win64|win32|x64|x86|shipping|dx11|dx12|vulkan|launcher)\b/gi, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()); // « Redemption2 » → « Redemption 2 »
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
        // Plusieurs écritures (« RedDeadRedemption2 » → « Red Dead Redemption 2 ») ; on garde le résultat le plus proche
        // du nom, jamais un résultat sans rapport (mieux vaut une jaquette générée qu'un autre jeu)
        const tries = [...new Set([game.name, names.prettify(game.name)])];
        let pick = null, total = 0;
        for (const term of tries) {
          const res = await meta.search(term, store.data.settings, platform).catch(() => []);
          total += res.length;
          const b = names.best(res, tries);
          if (b && (!pick || b.score > pick.score)) pick = b;
          if (pick && pick.score >= 0.95) break;
        }
        match = pick && pick.score >= 0.5 ? pick.item : { source: 'none', name: game.name };
        meta.log(`recherche auto « ${game.name} » → ${total} résultat(s), choisi : ${match.source} ${match.name} (score ${pick ? pick.score.toFixed(2) : '-'})`);
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
// Images à retélécharger après une correction de la source (v2 : la N64 affichait une station SGI Onyx)
const PLATFORM_IMG_V = 2, PLATFORM_IMG_RESET = ['n64'];
ipcMain.handle('platform:image', async (_e, id) => {
  const s = store.data.settings;
  if ((s.platformImagesV || 1) < PLATFORM_IMG_V) {
    for (const k of PLATFORM_IMG_RESET) if (s.platformImages[k] && !/-custom-/.test(s.platformImages[k])) delete s.platformImages[k];
    s.platformImagesV = PLATFORM_IMG_V; store.save();
  }
  const known = s.platformImages[id];
  if (known && fs.existsSync(path.join(PLATFORM_MEDIA, known))) return known;
  const p = BY_ID[id];
  if (!p || !p.wiki) return null;
  if (!platformFetching.has(id)) {
    platformFetching.set(id, meta.platformImage(p.wiki, PLATFORM_MEDIA, id, { minWidth: 1280, image: p.image || null }).catch((e) => { meta.log(`console ${id}: ${e.message}`); return null; }));
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
      // IMPORTER : + Xbox, EA app, Ubisoft Connect, Battle.net, Amazon Games, itch.io (src/features/importer/sources.js)
      const all = await Promise.all([scanner.scanSteam(), scanner.scanEpic(), scanner.scanGog(), ...require('./features/importer/sources').scanAll()]);
      res = { ok: all.some((a) => a.ok), items: all.flatMap((a) => a.items || []), error: all.every((a) => !a.ok) ? 'Aucun launcher trouvé (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Amazon, itch.io).' : null };
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
// Processus qui traînent après la fermeture d'un jeu (rapport de plantage, anti-triche, overlay, mise à jour) :
// ils ne prolongent pas la session.
const HELPER_EXE = /crash|reporter|unitycrashhandler|easyanticheat|eac_?launcher|beservice|battleye|overlay|webhelper|cefprocess|updater|uninst|redist|dxsetup|prereq|vcredist|launcherpatcher|socialclubhelper/i;
// État des processus d'un dossier : { count, win } — win = une fenêtre principale visible existe (null si inconnu)
async function dirStatus(dir) {
  const n = winNative();
  if (n && process.platform === 'win32' && dir) {
    try {
      const d = normDir(dir) + '\\';
      const pids = n.listProcesses()
        .filter((p) => p.pid !== process.pid && p.path && p.path.toLowerCase().startsWith(d) && !HELPER_EXE.test(path.basename(p.path)))
        .map((p) => p.pid);
      return { count: pids.length, win: pids.length ? !!n.findMainWindow(pids) : false };
    } catch (e) { meta.log(`suivi : ${e.message}`); }
  }
  return { count: await countProcessesIn(dir), win: null };
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
  handOffToGame(id);
}
// Passe la main au jeu : l'écran de lancement reste affiché jusqu'à ce que la fenêtre du jeu existe, puis elle est
// mise au premier plan (Windows laisse souvent un jeu démarrer DERRIÈRE la fenêtre active) et le launcher se masque.
// Sans fenêtre au bout de quelques secondes (Steam qui synchronise, petit launcher…) le launcher se masque quand
// même pour ne rien cacher, et la fenêtre du jeu est mise devant dès qu'elle apparaît (jusqu'à 2 min).
function handOffToGame(id) {
  const g = findGame(id);
  const n = winNative();
  const t0 = Date.now();
  const maxWait = g && (g.kind === 'steam' || g.kind === 'epic' || g.kind === 'uri') ? 12000 : 25000;
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    if (!store.data.settings.hideOnLaunch || !running.has(id) || ingameOpen || !win || win.isDestroyed()) return;
    if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
    hideToTray();
  };
  if (!n) { setTimeout(hide, 900); return; }
  try { n.allowForeground(); } catch {}
  let anyPid = false;
  const tick = async () => {
    if (!running.has(id) || ingameOpen) return;
    let pids = [], hwnd = 0;
    try { pids = await gamePids(id); hwnd = pids.length ? n.findMainWindow(pids) : 0; } catch (e) { meta.log(`lancement : ${e.message}`); }
    if (pids.length) anyPid = true;
    if (hwnd) {
      hide();
      const ok = n.focusWindow(hwnd);
      meta.log(`lancement : fenêtre de ${g?.name} trouvée en ${Date.now() - t0} ms${ok ? '' : ' (premier plan refusé)'}`);
      // 2e passage : un splash / petit launcher qui laisse la place à la vraie fenêtre (sans voler le focus à une autre appli)
      setTimeout(async () => {
        if (!running.has(id) || ingameOpen) return;
        try {
          const p2 = await gamePids(id), h2 = n.findMainWindow(p2), fg = n.foregroundPid();
          if (h2 && h2 !== hwnd && (!fg || p2.includes(fg) || fg === process.pid)) n.focusWindow(h2);
        } catch {}
      }, 3000);
      return;
    }
    const el = Date.now() - t0;
    if (el > maxWait || (!anyPid && el > 8000 && g?.kind !== 'steam' && g?.kind !== 'epic' && g?.kind !== 'uri')) hide();
    if (el > 120000) return;
    setTimeout(tick, hidden ? 1000 : 300);
  };
  setTimeout(tick, 200);
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
  if (running.size === 0 && !r.auto) bringToFront('session-end', { id, platform: g?.platform || null }); // PLAYTIME : jeu lancé hors du launcher → on ne vient pas s'imposer
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
  let seen = false, misses = 0, busy = false, hadWin = false, noWin = 0;
  const started = Date.now();
  const check = async () => {
    if (busy || !running.has(id)) return;
    busy = true;
    try {
      const st = await dirStatus(dir);
      const n = st.count;
      if (n < 0) return;
      if (n > 0) {
        seen = true; misses = 0;
        // Le jeu a eu une fenêtre puis n'en a plus depuis ~8 s : il est fermé, seuls des processus d'arrière-plan restent
        if (st.win === true) { hadWin = true; noWin = 0; }
        else if (st.win === false && hadWin && ++noWin >= 4) { meta.log(`suivi : ${findGame(id)?.name} sans fenêtre, fin de session`); finishSession(id); }
        return;
      }
      if (seen) { if (++misses >= 2) finishSession(id); }
      else if (Date.now() - started > graceMs) finishSession(id);
    } finally { busy = false; }
  };
  r.check = check;
  r.timer = setInterval(check, winNative() ? 2000 : 3000);
}
// PLAYTIME : un jeu de la bibliothèque lancé hors du launcher (Steam, raccourci…) est compté comme une session
// normale, sans masquer ni réafficher le launcher. start = première détection.
function startDetectedSession(id, dir, start = Date.now()) {
  const g = findGame(id);
  if (!g || running.has(id)) return false;
  g.lastPlayed = start;
  g.playCount = (g.playCount || 0) + 1;
  running.set(id, { start, auto: true });
  hub?.emit('session:start', id, { start, auto: true });
  send('game:running', { id, running: true, auto: true });
  commit();
  updatePadWake();
  watchDir(id, dir, { graceMs: 30000, exe: g.exePath || '' });
  meta.log(`suivi : ${g.name} détecté hors du launcher`);
  return true;
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
  // IMPORTER : kind 'uri' = jeu d'un autre launcher (Xbox, EA, Ubisoft, Battle.net, Amazon), lancé par son lien
  if (g.kind === 'steam' || g.kind === 'epic' || g.kind === 'uri') {
    const uri = g.kind === 'steam' ? `steam://rungameid/${g.appid}` : g.launchUri;
    try { await (g.kind === 'uri' ? require('./features/importer/sources').openLaunchUri(uri, shell) : shell.openExternal(uri)); } catch (e) { return { ok: false, error: 'Impossible d’ouvrir ' + (g.kind === 'steam' ? 'Steam' : g.kind === 'uri' ? 'le launcher du jeu' : 'Epic Games') }; }
    begin();
    watchDir(id, g.installDir);
    return { ok: true };
  }

  // ROM : via l'émulateur configuré pour la plateforme
  if (g.kind === 'rom') {
    const emu = emuLaunch.emulatorFor(g, store.data.settings); // EMU : émulateur propre au jeu, sinon celui de la console
    if (!emu?.path) return { ok: false, error: 'NO_EMULATOR', platform: g.platform };
    if (!fs.existsSync(emu.path)) return { ok: false, error: 'Émulateur introuvable : ' + emu.path };
    if (!fs.existsSync(g.romPath)) return { ok: false, error: 'ROM introuvable : ' + g.romPath };
    const c = emuLaunch.command(g, emu, { splitArgs }); // EMU : plein écran, résolution, arguments, env, admin
    return spawnTracked(id, c.file, c.args, c.cwd, begin, c.admin ? c.followDir : undefined, c.spawn);
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
  const c = emuLaunch.command(g, null, { splitArgs }); // EMU : arguments supplémentaires, env, admin (sinon identique)
  return spawnTracked(id, c.file, c.args, c.cwd, begin, c.followDir, c.spawn);
}

function spawnTracked(id, file, args, cwd, begin, followDir, opts = {}) { // EMU : opts (env…)
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, ...opts });
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
    child.once('exit', async () => {
      const r = running.get(id);
      if (!r) return;
      // Si le programme a passé la main à un autre processus (petit launcher, ou jeu relancé par lui-même),
      // on suit le dossier tant que des processus y tournent ; sinon la session est finie tout de suite.
      if (followDir && !tooBroad(followDir)) {
        const st = await dirStatus(followDir).catch(() => ({ count: -1 }));
        if (!running.has(id)) return;
        if (st.count > 0 || (st.count < 0 && Date.now() - r.start < 20000)) return watchDir(id, followDir, { graceMs: 15000, exe: file });
      }
      finishSession(id);
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
  if ('sgdbKey' in patch || 'tgdbKey' in patch) scheduleHeroUpgrade(3000, true); // fonds HD
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
  onGuide: () => { if (store.data.settings.guideButton !== false) summon('guide'); },
  // NAV : la navigation à la manette passe aussi par la lecture native (XInput / HID), pas seulement par l'API
  // Gamepad de Chromium — qui ne voit rien sans le focus et rate certaines manettes (Xbox, Switch Pro).
  // Relayée tant que le launcher est visible et « au premier plan pour l'utilisateur » (focus, menu en jeu,
  // ou ramené devant il y a peu). L'ancien relais « pad:remote » du menu en jeu est remplacé par celui-ci.
  wantNav: () => navWanted(),
  onNav: (mask) => {
    send('pad:nav', mask);
    if (mask && win && !win.isDestroyed() && !win.isFocused()) focusSelfSoon(); // la manette sert le launcher : on lui rend le focus
  },
  // WAKE : une manette vient de s'allumer / d'être branchée (launcher masqué ou réduit, aucun jeu)
  onConnect: () => { if (running.size === 0) bringToFront('pad'); },
  // CAPTURE : pendant un jeu (launcher pas au premier plan), Guide + RB / LB / B, Guide maintenu et Share
  combos: () => store.data.settings.guideButton !== false && store.data.settings.padShortcuts !== false && running.size > 0 && !(win && !win.isDestroyed() && win.isVisible() && win.isFocused()),
  onCombo: (name, src) => { if (name === 'quit' || name === 'power') summon('guide', name); else hub.emit('pad:combo', name, src); },
});
// La lecture native tourne toujours (navigation à la manette) ; le réglage guideButton ne coupe que le bouton Guide
function updateGuideWatch() { guideWatch.start(); }
let frontAt = 0, focusSelfT = 0;
function navWanted() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
  return win.isFocused() || ingameOpen || Date.now() - frontAt < 30000;
}
function focusSelfSoon() {
  const now = Date.now();
  if (now - focusSelfT < 1500) return;
  focusSelfT = now;
  const n = winNative();
  try { win.focus(); if (n && !win.isFocused()) { n.allowForeground(); n.focusWindow(n.hwndOf(win.getNativeWindowHandle())); } } catch (e) { meta.log(`focus : ${e.message}`); }
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
  else if (g.kind === 'rom') d = path.dirname(emuLaunch.emulatorFor(g, store.data.settings)?.path || ''); // EMU
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
  for (const f of hub.listeners('emu:beforeQuit')) { try { await f(id); } catch (e) { meta.log(`emu : ${e.message}`); } } // EMU : sauvegarde auto
  if (!running.has(id)) return { ok: true, killed: 0 };
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
  guideWatch.navFlush(); // NAV
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
    startDetectedSession, tooBroad, HELPER_EXE, normDir, // PLAYTIME
    protoRoute: (host, fn) => { protoRoutes[host] = fn; }, // CAPTURE
    // RECOMP : ajoute un jeu à la bibliothèque et lance la récupération des visuels (null si déjà présent)
    addGame: (data) => {
      if (alreadyHave(data)) return games().find((g) => gameKey(g) === gameKey(data)) || null;
      const g = newGame(data);
      games().push(g);
      commit();
      enqueue(g, null);
      return g;
    },
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    try { require(path.join(dir, f)).init?.(ctx); } catch (e) { meta.log(`module ${f} : ${e.stack || e.message}`); }
  }
}

// ---------------------------------------------------------------- Fonds en haute définition
// Remplace en arrière-plan les images de fond trop petites (captures rétro 240×160 agrandies = pixelisées)
// par des visuels HD de SteamGridDB / TheGamesDB (clé gratuite). Un essai par jeu tous les 7 jours.
let heroTimer = null, heroBusy = false;
function scheduleHeroUpgrade(delay = 25000, force = false) {
  clearTimeout(heroTimer);
  heroTimer = setTimeout(() => upgradeHeroes(force).catch((e) => meta.log(`fonds HD : ${e.message}`)), delay);
}
function heroWidth(g) {
  const f = g.media?.hero;
  if (!f) return 0;
  try { const im = nativeImage.createFromPath(path.join(MEDIA, g.id, f)); return im.isEmpty() ? 0 : im.getSize().width; } catch { return 0; }
}
async function upgradeHeroes(force) {
  const s = store.data.settings;
  if (heroBusy || (!s.sgdbKey && !s.tgdbKey)) return;
  heroBusy = true;
  try {
    const WEEK = 7 * 864e5;
    for (const g of [...games()]) {
      if (running.size) break; // jamais pendant une partie
      if (!force && g.heroTry && Date.now() - g.heroTry < WEEK) continue;
      if (g.heroWv !== (g.mediaVersion || 0) || g.heroW == null) { g.heroW = heroWidth(g); g.heroWv = g.mediaVersion || 0; }
      if (g.heroW >= 1280) continue;
      g.heroTry = Date.now();
      const dir = path.join(MEDIA, g.id);
      const file = await meta.upgradeHero(g, dir, s, BY_ID[g.platform]?.tgdb).catch(() => null);
      if (!file) { store.save(); continue; }
      const w = (() => { try { return nativeImage.createFromPath(path.join(dir, file)).getSize().width; } catch { return 0; } })();
      if (w > (g.heroW || 0)) {
        const old = g.media?.hero;
        g.media = { ...(g.media || {}), hero: file };
        g.heroW = w;
        g.mediaVersion = Date.now(); g.heroWv = g.mediaVersion;
        if (old && old !== file) fs.rmSync(path.join(dir, old), { force: true });
        meta.log(`fond HD : ${g.name} → ${w}px`);
        commit();
      } else fs.rmSync(path.join(dir, file), { force: true });
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally { heroBusy = false; }
}

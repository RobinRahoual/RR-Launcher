// PLAYTIME — temps de jeu complet, même sans passer par le launcher :
// 1) Suivi en arrière-plan : toutes les 15 s, les processus Windows sont comparés aux dossiers des jeux de la
//    bibliothèque ; un jeu qui a une fenêtre deux relevés de suite devient une session normale (statistiques,
//    amis, « dernier lancé »), sans masquer ni réafficher le launcher. Tant que le launcher tourne (y compris
//    réduit dans la zone de notification ; « Lancer avec Windows » le garde toujours actif).
// 2) Synchronisation des heures des autres launchers : Steam (localconfig.vdf, hors ligne, sans clé),
//    GOG Galaxy (galaxy-2.0.db) et itch.io (butler.db). Le temps affiché = le plus grand des deux.
//    Au démarrage, puis toutes les 30 min, et sur demande (Réglages).
// Réglages : trackOutside (suivi), syncPlaytime (synchronisation). IPC : x:playtime:sync, x:playtime:status.
// Main : startDetectedSession / tooBroad / HELPER_EXE (ctx, main.js).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sqlite = require('./importer/sqlite');
const core = require('./playtime/core');
const { createEpic, LOGIN_URL } = require('./playtime/epic');

function init(ctx) {
  const { ipcMain, store, send, commit, running, log } = ctx;
  const S = () => store.data.settings || {};
  const on = (k) => S()[k] !== false;
  const status = { at: 0, sources: {}, updated: 0, error: '' };
  let safeStore = null;
  try { safeStore = require('electron').safeStorage; } catch { /* tests */ }
  const epic = createEpic({ store, safe: safeStore, log, fetchImpl: (u, o) => require('electron').net.fetch(u, o) });

  // ------------------------------------------------------------ Connexion Epic Games (page officielle d'Epic)
  let loginWin = null;
  function epicLogin() {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return Promise.resolve({ ok: false, error: 'Connexion déjà ouverte' }); }
    const { BrowserWindow } = require('electron');
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (done) return; done = true; if (loginWin && !loginWin.isDestroyed()) loginWin.close(); loginWin = null; resolve(r); };
      loginWin = new BrowserWindow({
        width: 520, height: 760, parent: ctx.getWin?.() || undefined, modal: false, autoHideMenuBar: true, title: 'Connexion à Epic Games',
        webPreferences: { partition: 'persist:epic-login', contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      const check = async () => {
        if (!loginWin || loginWin.isDestroyed()) return;
        const url = loginWin.webContents.getURL();
        if (!/epicgames\.com\/id\/api\/redirect/i.test(url)) return;
        try {
          const code = core.epicCodeFrom(await loginWin.webContents.executeJavaScript('document.body.innerText', true));
          if (!code) return finish({ ok: false, error: 'Epic n’a pas renvoyé de code : réessaie' });
          const j = await epic.loginWithCode(code);
          finish({ ok: true, name: j.displayName || '' });
        } catch (e) { log(`epic : ${e.message}`); finish({ ok: false, error: `Connexion refusée par Epic (${e.message})` }); }
      };
      loginWin.webContents.on('did-finish-load', check);
      loginWin.webContents.on('did-navigate', check);
      loginWin.webContents.setWindowOpenHandler(({ url }) => { loginWin.loadURL(url); return { action: 'deny' }; }); // « Se connecter avec… » reste dans la fenêtre
      loginWin.on('closed', () => finish({ ok: false, cancelled: true }));
      loginWin.loadURL(LOGIN_URL);
    });
  }
  ipcMain.handle('x:playtime:epicLogin', async () => {
    const r = await epicLogin();
    if (r.ok) sync(true).catch(() => {});
    return r;
  });
  ipcMain.handle('x:playtime:epicLogout', async () => {
    epic.logout();
    try { await require('electron').session.fromPartition('persist:epic-login').clearStorageData(); } catch { /* */ }
    return { ok: true };
  });

  // ------------------------------------------------------------ Suivi des jeux lancés hors du launcher
  const pending = new Map(); // id → première détection (ms)
  let busy = false;
  function excludes() {
    const emus = Object.values(S().emulators || {}).map((e) => e?.path && path.dirname(e.path)).filter(Boolean);
    return [...emus, path.dirname(process.execPath)];
  }
  function detect() {
    if (busy || !on('trackOutside') || process.platform !== 'win32' || !ctx.startDetectedSession) return;
    const n = ctx.winNative?.();
    if (!n) return;
    busy = true;
    try {
      const list = core.watchList(store.data.games || [], { tooBroad: ctx.tooBroad, exclude: excludes() }).filter((w) => !running.has(w.id));
      if (!list.length) { pending.clear(); return; }
      const hits = core.matchProcesses(n.listProcesses(), list, { helper: ctx.HELPER_EXE, selfPid: process.pid });
      const now = Date.now();
      for (const id of [...pending.keys()]) if (!hits.has(id)) pending.delete(id);
      for (const [id, h] of hits) {
        let win = false;
        try { win = !!n.findMainWindow(h.pids); } catch { /* */ }
        if (!win) { pending.delete(id); continue; }
        if (!pending.has(id)) { pending.set(id, now); continue; } // confirmé au relevé suivant
        const start = pending.get(id);
        pending.delete(id);
        ctx.startDetectedSession(id, h.dir, start);
      }
    } catch (e) { log(`suivi hors launcher : ${e.message}`); } finally { busy = false; }
  }
  setTimeout(() => { detect(); setInterval(detect, 15000); }, 20000);

  // ------------------------------------------------------------ Heures des autres launchers
  const reg = (key, value) => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 6000 }, (err, out) => resolve(err ? '' : String(out)));
  });
  const exists = (f) => { try { return fs.existsSync(f); } catch { return false; } };
  async function steamRoots() {
    const out = [];
    if (process.env.RR_STEAM_PATH) out.push(process.env.RR_STEAM_PATH);
    const m = (await reg('HKCU\\Software\\Valve\\Steam', 'SteamPath')).match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) out.push(m[1].trim().replace(/\//g, '\\'));
    out.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    return [...new Set(out)].filter(exists);
  }
  async function readSteam() {
    const maps = [];
    for (const r of await steamRoots()) {
      const ud = path.join(r, 'userdata');
      let users = [];
      try { users = fs.readdirSync(ud).filter((u) => /^\d+$/.test(u) && u !== '0'); } catch { continue; }
      for (const u of users) {
        const f = path.join(ud, u, 'config', 'localconfig.vdf');
        try { maps.push(core.steamLocalConfig(fs.readFileSync(f, 'utf8'))); } catch { /* compte sans config */ }
      }
    }
    return maps.length ? core.mergeMax(maps) : null;
  }
  function readGog() {
    const f = process.env.RR_GOG_DB || path.join(process.env.ProgramData || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
    if (!exists(f)) return null;
    return core.gogTimes(sqlite.openFile(fs, f));
  }
  function readItch() {
    const f = path.join(process.env.APPDATA || '', 'itch', 'db', 'butler.db');
    if (!exists(f)) return null;
    return core.itchTimes(sqlite.openFile(fs, f));
  }
  const gogIds = new Map(); // dossier → id GOG (lecture disque une fois)
  function gogIdOf(g) {
    const dir = g.installDir || (g.exePath && path.dirname(g.exePath));
    if (!dir) return '';
    if (!gogIds.has(dir)) { let id = ''; try { id = core.gogIdOf(fs.readdirSync(dir)); } catch { /* */ } gogIds.set(dir, id); }
    return gogIds.get(dir);
  }

  let syncing = null;
  async function sync(manual = false) {
    if (syncing) return syncing;
    syncing = (async () => {
      const src = {}, errs = {};
      const safe = async (name, fn) => { try { const m = await fn(); src[name] = m ? m.size : -1; return m; } catch (e) { src[name] = -2; errs[name] = e.message; log(`temps de jeu ${name} : ${e.message}`); return null; } };
      const steam = await safe('steam', readSteam);
      const gog = await safe('gog', readGog);
      const itch = await safe('itch', readItch);
      const epicInfo = { entries: 0, games: 0, matched: 0, miss: [] };
      const epicT = epic.connected() ? await safe('epic', () => epic.playtime()) : null;
      // Profil secondaire actif : son temps de jeu est le sien, on n'y verse pas les heures du compte Steam
      const P = store.data.profiles;
      if (P && P.current && P.current !== 'main') { status.error = 'Profil secondaire actif : synchronisation au retour sur le profil principal'; return status; }
      const best = (...xs) => xs.filter(Boolean).sort((a, b) => b.sec - a.sec)[0] || null;
      const n = core.applyTimes(store.data.games || [], (g) => {
        const c = [];
        if (g.appid && steam?.has(Number(g.appid))) c.push({ src: 'Steam', ...steam.get(Number(g.appid)) });
        if (gog) {
          if (g.appid && gog.has(`steam_${g.appid}`)) c.push({ src: 'GOG Galaxy', ...gog.get(`steam_${g.appid}`) });
          const id = (g.source === 'gog' || !g.appid) && gogIdOf(g);
          if (id && gog.has(`gog_${id}`)) c.push({ src: 'GOG Galaxy', ...gog.get(`gog_${id}`) });
        }
        if (epicT) { // jeux Epic : AppName, sinon identifiant du catalogue
          const keys = core.epicKeys(g);
          if (keys.length) { epicInfo.games++; const k = keys.find((x) => epicT.has(x)); if (k) { epicInfo.matched++; c.push({ src: 'Epic Games', ...epicT.get(k) }); } else epicInfo.miss.push(keys[0]); }
        }
        if (itch && g.source === 'itch' && g.installDir) { const r = itch.get(core.normDir(g.installDir)); if (r) c.push({ src: 'itch.io', ...r }); }
        return best(...c);
      });
      if (epicT) { epicInfo.entries = epicT.size; epicInfo.ids = [...epicT.keys()].slice(0, 8); log(`epic : ${epicInfo.entries} jeu(x) avec du temps, ${epicInfo.games} jeu(x) Epic dans la bibliothèque, ${epicInfo.matched} associé(s)${epicInfo.miss.length ? ` — sans correspondance : ${epicInfo.miss.slice(0, 8).join(', ')}` : ''}`); }
      Object.assign(status, { epicInfo: epicT ? epicInfo : null, at: Date.now(), sources: src, errors: errs, updated: n, error: '' });
      if (n) commit();
      ctx.hub?.emit('playtime:ext');
      if (manual || n) log(`temps de jeu : ${n} jeu(x) mis à jour (${JSON.stringify(src)})`);
      return status;
    })().finally(() => { syncing = null; });
    return syncing;
  }
  setTimeout(() => { if (on('syncPlaytime')) sync().catch(() => {}); }, 45000);
  setInterval(() => { if (on('syncPlaytime')) sync().catch(() => {}); }, 30 * 60 * 1000);
  // Fin d'une partie Steam : Steam écrit localconfig.vdf à la fermeture du jeu
  ctx.hub?.on('session:end', () => { if (on('syncPlaytime')) setTimeout(() => sync().catch(() => {}), 15000); });

  ipcMain.handle('x:playtime:sync', () => sync(true));
  ipcMain.handle('x:playtime:status', () => ({ ...status, epic: { connected: epic.connected(), name: epic.name() } }));
}

module.exports = { init };

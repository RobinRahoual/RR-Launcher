// EMU — émulateurs : installation automatique (RetroArch + cœurs, émulateurs dédiés), BIOS (détection seule),
// sauvegardes d'état depuis le menu en jeu, profils de lancement par jeu (g.launch, appliqué dans main.js/launchGame).
// Fichiers : src/features/emu/*.js. Canaux x:emu:*. Données : store.data.emu = { installs: { emuId: { exe, version, date } } }.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./emu/catalog');
const L = require('./emu/launch');
const ST = require('./emu/states');
const bios = require('./emu/bios');
const { install } = require('./emu/installer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function init(ctx) {
  const { ipcMain, store, hub, running, findGame, send, log, commit } = ctx;
  const { BY_ID } = require('../platforms');
  const S = () => store.data.settings;
  store.data.emu ||= { installs: {} };
  store.data.emu.installs ||= {};
  const root = process.env.RR_EMU_ROOT || (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'RR Launcher', 'emulators') : path.join(ctx.DATA, 'emulators'));

  // ---------------------------------------------------------------- A. Configuration / installation
  function overview() {
    const games = store.data.games.filter((g) => g.kind === 'rom');
    const ids = [...new Set([...games.map((g) => g.platform), ...Object.keys(S().emulators || {})])].filter((id) => BY_ID[id] && id !== 'pc');
    const order = Object.keys(BY_ID);
    ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return {
      root,
      installs: store.data.emu.installs,
      platforms: ids.map((id) => {
        const conf = S().emulators?.[id] || null;
        return {
          id, name: BY_ID[id].name, color: BY_ID[id].color,
          games: games.filter((g) => g.platform === id).length,
          conf: conf ? { ...conf, exists: fs.existsSync(conf.path) } : null,
          reco: (C.RECO[id] || []).map((r) => ({ ...r, name: C.EMULATORS[r.emu].name, auto: C.EMULATORS[r.emu].source.type !== 'site', site: C.EMULATORS[r.emu].site, installed: !!store.data.emu.installs[r.emu] })),
          bios: conf ? bios.check(id, conf) : [],
        };
      }),
    };
  }

  let job = null; // { ctrl, key }
  const queue = [];
  async function runJob(req) {
    const ctrl = new AbortController();
    job = { ctrl, key: `${req.platform}:${req.emu}` };
    const progress = (p) => send('x:emu:progress', p);
    try {
      const r = await install(req, { root, signal: ctrl.signal, installed: store.data.emu.installs, onProgress: progress });
      store.data.emu.installs[req.emu] = { exe: r.exe, version: r.version, date: Date.now() };
      // Toutes les consoles servies par cet émulateur (et ce cœur) sans émulateur : on les configure aussi
      S().emulators ||= {};
      S().emulators[req.platform] = r.conf;
      commit();
      log(`emu : ${req.emu} ${r.version} installé pour ${req.platform} (${r.exe})`);
      const res = { ok: true, platform: req.platform, emu: req.emu, version: r.version, conf: r.conf, bios: bios.check(req.platform, r.conf) };
      send('x:emu:progress', { phase: 'done', emu: req.emu, platform: req.platform, label: `${C.EMULATORS[req.emu].name} prêt` });
      return res;
    } catch (e) {
      const cancelled = e.name === 'AbortError' || ctrl.signal.aborted;
      log(`emu : installation ${req.emu} : ${e.message}`);
      const res = { ok: false, cancelled, platform: req.platform, emu: req.emu, error: cancelled ? 'Installation annulée' : String(e.message || e), site: e.site };
      send('x:emu:progress', { phase: cancelled ? 'cancelled' : 'error', emu: req.emu, platform: req.platform, label: res.error });
      return res;
    } finally { job = null; }
  }
  // Installations l'une après l'autre (une seule archive RetroArch pour plusieurs consoles)
  function enqueue(req) {
    return new Promise((resolve) => {
      queue.push({ req, resolve });
      if (queue.length === 1) pump();
    });
  }
  async function pump() {
    while (queue.length) {
      const { req, resolve } = queue[0];
      resolve(await runJob(req));
      queue.shift();
    }
  }
  ipcMain.handle('x:emu:overview', () => overview());
  ipcMain.handle('x:emu:install', (_e, req = {}) => {
    if (!BY_ID[req.platform] || !C.EMULATORS[req.emu]) return { ok: false, error: 'Requête invalide' };
    if (req.emu === 'retroarch' && !req.core) req.core = C.CORES[req.platform];
    return enqueue({ platform: req.platform, emu: req.emu, core: req.core, update: !!req.update });
  });
  ipcMain.handle('x:emu:cancel', () => {
    for (const q of queue.splice(1)) q.resolve({ ok: false, cancelled: true, platform: q.req.platform, emu: q.req.emu, error: 'Installation annulée' });
    job?.ctrl.abort();
    return true;
  });
  ipcMain.handle('x:emu:bios', (_e, platform) => bios.check(platform, S().emulators?.[platform]));
  ipcMain.handle('x:emu:openFolder', (_e, dir) => {
    dir = String(dir || '');
    if (!path.isAbsolute(dir)) return false;
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    require('electron').shell.openPath(dir);
    return true;
  });

  // ---------------------------------------------------------------- C. Profils de lancement
  ipcMain.handle('x:emu:caps', (_e, exe) => L.capabilities(exe));
  ipcMain.handle('x:emu:pickExe', async (_e, title) => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: title || 'Émulateur pour ce jeu', properties: ['openFile'], filters: [{ name: 'Programmes', extensions: ['exe', 'bat', 'cmd'] }, { name: 'Tous', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  ipcMain.handle('x:emu:setLaunch', (_e, id, launch) => {
    const g = findGame(id);
    if (!g) return null;
    if (!launch || !Object.values(launch).some((v) => v !== '' && v != null && v !== false && v !== 'default' && v !== 0)) delete g.launch;
    else g.launch = sanitize(launch);
    commit();
    return g.launch || null;
  });
  ipcMain.handle('x:emu:preview', (_e, id, launch) => {
    const g = findGame(id);
    if (!g) return null;
    const gg = { ...g, launch: sanitize(launch || {}) };
    const emu = g.kind === 'rom' ? L.emulatorFor(gg, S()) : null;
    if (g.kind === 'rom' && !emu?.path) return { error: 'Aucun émulateur configuré pour cette console' };
    if (g.kind !== 'rom' && !g.exePath) return { error: 'Ce jeu passe par un autre launcher : pas d’options de lancement' };
    const split = (s = '') => (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
    const c = L.command(gg, emu, { splitArgs: split, env: {} });
    return { file: c.admin ? c.target : c.file, args: c.args, admin: c.admin, caps: emu ? L.capabilities(emu.path) : {} };
  });
  function sanitize(o) {
    const s = (v, n = 2000) => String(v ?? '').slice(0, n);
    return {
      emuPath: s(o.emuPath, 1000), emuArgs: s(o.emuArgs), emuName: s(o.emuName, 120), args: s(o.args), env: s(o.env, 4000),
      admin: !!o.admin, fullscreen: ['on', 'off'].includes(o.fullscreen) ? o.fullscreen : 'default',
      resolution: Math.max(0, Math.min(8, Number(o.resolution) || 0)),
    };
  }

  // ---------------------------------------------------------------- B. Sauvegardes d'état
  const slots = new Map(); // id → { cur, want }
  function infoFor(id) {
    const g = findGame(id);
    if (!g || g.kind !== 'rom') return null;
    const emu = L.emulatorFor(g, S());
    const kind = L.emuKind(emu?.path);
    const t = ST.table(kind, S().emuHotkeys || {});
    if (!t) return { supported: false, kind };
    if (!slots.has(id)) slots.set(id, { cur: t.slots[0], want: t.slots[0] });
    const sl = slots.get(id);
    return { supported: true, kind, name: ST.LABELS[kind], save: t.save, load: t.load, net: !!t.net && S().emuNetCmd !== false, slot: sl.want, min: t.slots[0], max: t.slots[1], admin: !!g.launch?.admin };
  }
  hub.on('session:start', (id) => slots.delete(id));
  async function gameWindow(id, n) {
    const g = findGame(id), r = running.get(id);
    const pids = new Set();
    if (r?.child?.pid && r.child.exitCode === null) pids.add(r.child.pid);
    let procs = [];
    try { procs = n.listProcesses(); } catch {}
    const dir = path.dirname(L.emulatorFor(g, S())?.path || '').toLowerCase();
    if (dir && dir.length > 3) for (const p of procs) if (p.path && p.path.toLowerCase().startsWith(dir + '\\')) pids.add(p.pid);
    for (let grew = true; grew;) { grew = false; for (const p of procs) if (!pids.has(p.pid) && pids.has(p.ppid)) { pids.add(p.pid); grew = true; } }
    pids.delete(process.pid);
    return n.findMainWindow([...pids]);
  }
  async function doState(id, action, { focus = true } = {}) {
    id = id && running.has(id) ? id : [...running.keys()].pop();
    if (!id) return { ok: false, error: 'Aucun jeu en cours' };
    const info = infoFor(id);
    if (!info?.supported) return { ok: false, error: 'Sauvegardes d’état non gérées pour cet émulateur' };
    const sl = slots.get(id);
    const g = findGame(id);
    const emu = L.emulatorFor(g, S());
    if (info.kind === 'retroarch' && info.net) {
      const r = await ST.retroarchNet(action, sl.cur, sl.want);
      if (r.ok) { sl.cur = sl.want; log(`emu : ${action} via commande réseau (emplacement ${sl.want})`); return { ...r, action }; }
      if (r.error !== 'NO_NET') return r;
      // Commandes réseau désactivées : on les active pour la prochaine fois, et on passe par le clavier
      try {
        const cfg = path.join(path.dirname(emu.path), 'retroarch.cfg');
        const t = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
        if (!ST.netEnabled(t)) { fs.writeFileSync(cfg, ST.enableNetCmd(t)); log('emu : network_cmd_enable activé dans retroarch.cfg (au prochain lancement)'); }
      } catch (e) { log(`emu : retroarch.cfg ${e.message}`); }
    }
    const n = ctx.winNative();
    if (!n?.sendKeys) return { ok: false, error: 'Disponible uniquement sous Windows' };
    const t = ST.table(info.kind, S().emuHotkeys || {});
    const p = ST.plan(t, action, sl.cur, sl.want);
    if (!p) return { ok: false, error: 'Raccourci invalide (Réglages → Fonctions → Émulateurs)' };
    if (focus) {
      try { n.allowForeground(); const h = await gameWindow(id, n); if (h) n.focusWindow(h); else log('emu : fenêtre du jeu introuvable'); } catch (e) { log(`emu : focus ${e.message}`); }
      await sleep(250);
    }
    for (const vks of p.steps) { n.sendKeys(vks, 70); await sleep(160); }
    sl.cur = p.slot;
    log(`emu : ${action} via clavier (${info.kind}, emplacement ${p.slot})`);
    return { ok: true, via: 'keys', slot: p.slot, action };
  }
  ipcMain.handle('x:emu:info', (_e, id) => infoFor(id));
  ipcMain.handle('x:emu:slot', (_e, id, delta) => {
    const info = infoFor(id);
    if (!info?.supported) return null;
    const sl = slots.get(id);
    sl.want = Math.max(info.min, Math.min(info.max, sl.want + (Number(delta) || 0)));
    return sl.want;
  });
  ipcMain.handle('x:emu:state', async (_e, o = {}) => {
    if (o.delay) await sleep(Math.min(2000, Number(o.delay) || 0));
    return doState(o.id, o.action === 'load' ? 'load' : 'save');
  });
  ipcMain.handle('x:emu:hotkeys', () => ({ defaults: ST.HOTKEYS, labels: ST.LABELS }));
  // Combo manette (opt-in) : Guide + ↑ = sauvegarde rapide, Guide + ↓ = charger
  hub.on('pad:combo', async (name) => {
    if ((name !== 'emu-save' && name !== 'emu-load') || S().emuPadStates !== true) return;
    const r = await doState(null, name === 'emu-save' ? 'save' : 'load', { focus: false });
    send('x:emu:done', { ...r, origin: 'pad' });
  });
  // « Quitter le jeu » : sauvegarde rapide puis ~1,5 s d'attente (main.js/quitGame attend les écouteurs)
  hub.on('emu:beforeQuit', async (id) => {
    if (S().emuSaveOnQuit !== true || !infoFor(id)?.supported) return;
    const r = await doState(id, 'save');
    if (r.ok) await sleep(1500);
  });
}

module.exports = { init };

// EXTRAS — succès / trophées (Steam Web API, RetroAchievements) et état des mises à jour Steam / Epic.
// Données : store.data.extras = { ach: { <gameId>: données }, ra: { <gameId>: { raId, manual, hash, console } } }
// Icônes : MEDIA/<gameId>/ach/<fichier> (servies par rr://media/<gameId>/ach/<fichier>).
// Réglages : steamApiKey, steamId (saisie), steamId64 (résolu), raUser, raKey, extrasUpdates (défaut : activé).
// IPC : x:extras:summary | get | refresh | updates | detectSteam | setSteamId | testSteam | testRA | setRaGame
// Évènements → renderer : x:extras:ach ({ id, data }), x:extras:unlocked ({ id, name, items }), x:extras:summary
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const api = require('./extras/api');
const { displayList, summarize, newlyUnlocked } = require('./extras/achievements');
const { raConsoleFor, raHash } = require('./extras/romhash');
const { libraryFolders, loginUsers } = require('./extras/vdf');
const upd = require('./extras/updates');

const STALE_MS = 10 * 60 * 1000; // rafraîchissement à l'ouverture de la page du jeu : 1 fois / 10 min max
const RA_LIST_TTL = 7 * 24 * 3600 * 1000; // listes d'empreintes RA par console
const SESSION_DELAY = 8000; // laisse le temps à Steam / RA d'enregistrer les déblocages de fin de partie
const MAX_ROM = 96 * 1024 * 1024;
const EPIC_DIR = process.env.RR_EPIC_MANIFESTS || 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

function init(ctx) {
  const { ipcMain, store, hub, DATA, MEDIA, send, findGame, log } = ctx;
  const S = () => store.data.settings;
  const X = () => (store.data.extras ||= { ach: {}, ra: {} });
  X().ach ||= {}; X().ra ||= {};
  if (S().extrasUpdates === undefined) { S().extrasUpdates = true; store.save(); }

  // ------------------------------------------------------------ HTTP (net d'Electron, comme metadata.js)
  const { net } = require('electron');
  async function get(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'RRLauncher/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    let json = null;
    try { json = await res.json(); } catch { /* pas du JSON */ }
    return { status: res.status, json };
  }
  async function download(url, file) {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'RRLauncher/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const safeLog = (m) => { try { log(`extras : ${m}`); } catch { /* */ } };

  // ------------------------------------------------------------ Éligibilité
  function kindOf(g) {
    if (!g) return null;
    if (g.kind === 'steam' && g.appid) return 'steam';
    if (g.kind === 'rom' && (X().ra[g.id]?.raId || raConsoleFor(g.platform, g.romPath))) return 'ra';
    if (g.kind === 'rom') return 'ra-manual'; // console non gérée : association manuelle possible
    return null;
  }
  function configured(kind) {
    const s = S();
    if (kind === 'steam') return !!(s.steamApiKey && s.steamId64);
    if (kind === 'ra' || kind === 'ra-manual') return !!(s.raUser && s.raKey);
    return false;
  }

  // ------------------------------------------------------------ Présentation
  const iconSrc = (id, a) => (a.icon ? `rr://media/${encodeURIComponent(id)}/ach/${encodeURIComponent(a.icon)}` : a.iconUrl || '');
  function present(g) {
    const kind = kindOf(g);
    const d = X().ach[g.id] || null;
    const base = { id: g.id, kind, configured: configured(kind), raId: X().ra[g.id]?.raId || 0, manual: !!X().ra[g.id]?.manual };
    if (!d) return { ...base, data: null };
    return {
      ...base,
      data: {
        source: d.source, title: d.title, total: d.total || 0, unlocked: d.unlocked || 0, pct: d.pct || 0,
        points: d.points, pointsEarned: d.pointsEarned, none: !!d.none, error: d.error || '', errorCode: d.errorCode || '',
        fetchedAt: d.fetchedAt || 0,
        list: displayList(d).map((a) => ({ ...a, src: iconSrc(g.id, a) })),
      },
    };
  }
  ctx.extrasSummary = () => summaryAll(); // PROFILES : résumé renvoyé au renderer après un changement de profil
  function summaryAll() {
    const out = {};
    for (const [id, d] of Object.entries(X().ach)) { const s = summarize(d); if (s && findGame(id)) out[id] = s; }
    return out;
  }

  // ------------------------------------------------------------ RetroAchievements : identification
  const raListFile = (c) => path.join(DATA, 'extras', `ra-gamelist-${c}.json`);
  async function raList(consoleId) {
    const f = raListFile(consoleId);
    try {
      const st = fs.statSync(f);
      if (Date.now() - st.mtimeMs < RA_LIST_TTL) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { /* absent */ }
    const list = await api.raGameList(get, S().raKey, consoleId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(list));
    return list;
  }
  async function raIdentify(g) {
    const m = X().ra[g.id] || {};
    if (m.manual && m.raId) return m.raId;
    const consoleId = raConsoleFor(g.platform, g.romPath);
    if (!consoleId) return 0;
    let st;
    try { st = fs.statSync(g.romPath); } catch { throw new api.ApiError('rom', 'ROM introuvable sur le disque'); }
    if (st.size > MAX_ROM) return 0;
    const key = `${g.romPath}|${st.size}|${st.mtimeMs}`;
    let hash = m.key === key ? m.hash : '';
    if (!hash) hash = raHash(consoleId, fs.readFileSync(g.romPath));
    const found = api.findByHash(await raList(consoleId), hash);
    X().ra[g.id] = { raId: found?.id || 0, hash, key, console: consoleId, manual: false };
    return found?.id || 0;
  }

  // ------------------------------------------------------------ Icônes
  async function cacheIcons(gameId, d) {
    const dir = path.join(MEDIA, gameId, 'ach');
    const todo = d.list.filter((a) => a.iconUrl);
    if (!todo.length) return;
    fs.mkdirSync(dir, { recursive: true });
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const a = todo[i++];
        const ext = (a.iconUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i) || [, 'jpg'])[1].toLowerCase();
        const file = crypto.createHash('md5').update(a.iconUrl).digest('hex').slice(0, 16) + '.' + ext;
        const full = path.join(dir, file);
        if (!fs.existsSync(full)) { try { await download(a.iconUrl, full); } catch (e) { continue; } }
        a.icon = file;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // ------------------------------------------------------------ Rafraîchissement
  const inflight = new Map();
  function refresh(id, { notify = false } = {}) {
    if (inflight.has(id)) return inflight.get(id);
    const p = doRefresh(id, notify).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }
  async function doRefresh(id, notify) {
    const g = findGame(id);
    const kind = kindOf(g);
    if (!kind || !configured(kind)) return null;
    const prev = X().ach[id] || null;
    let d;
    try {
      if (kind === 'steam') {
        d = await api.steamAchievements(get, { key: S().steamApiKey, steamId: S().steamId64, appid: g.appid });
      } else {
        const raId = await raIdentify(g);
        if (!raId) {
          d = { source: 'ra', none: true, unidentified: true, total: 0, unlocked: 0, pct: 0, list: [] };
        } else d = await api.raAchievements(get, { user: S().raUser, key: S().raKey, gameId: raId });
      }
      if (d.list.length) await cacheIcons(id, d);
    } catch (e) {
      safeLog(`${id} : ${e.message}`);
      // on garde les dernières données connues, avec l'erreur (et on ne réessaie pas avant 10 min)
      d = { ...(prev || { source: kind === 'steam' ? 'steam' : 'ra', total: 0, unlocked: 0, pct: 0, list: [] }), error: e.code ? e.message : 'Connexion impossible : succès non synchronisés', errorCode: e.code || 'net' };
    }
    d.fetchedAt = Date.now();
    if (!d.error) { delete d.error; delete d.errorCode; }
    X().ach[id] = d;
    store.save();
    const fresh = notify && prev && !d.error ? newlyUnlocked(prev, d) : [];
    const out = present(g);
    send('x:extras:ach', out);
    send('x:extras:summary', summaryAll());
    if (fresh.length) {
      send('x:extras:unlocked', { id, name: g.name, items: fresh.map((a) => ({ name: a.name, src: iconSrc(id, a), rarity: a.rarity })) });
    }
    return out;
  }

  // ------------------------------------------------------------ Steam : SteamID depuis les fichiers locaux
  function regQuery(key, value) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve('');
      execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 6000 }, (err, out) => resolve(err ? '' : out));
    });
  }
  async function steamRoots() {
    const out = [];
    if (process.env.RR_STEAM_PATH) out.push(process.env.RR_STEAM_PATH);
    const m = (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')).match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) out.push(m[1].trim().replace(/\//g, '\\'));
    out.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    for (const g of store.data.games) if (g.kind === 'steam') { const sa = upd.steamappsOf(g.installDir); if (sa) out.push(path.dirname(sa)); }
    return [...new Set(out)].filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
  }
  async function detectSteamUsers() {
    for (const r of await steamRoots()) {
      try {
        const users = loginUsers(fs.readFileSync(path.join(r, 'config', 'loginusers.vdf'), 'utf8'));
        if (users.length) return users;
      } catch { /* pas ici */ }
    }
    return [];
  }
  let libsCache = { t: 0, list: [] };
  async function steamLibraries() {
    if (Date.now() - libsCache.t < 10 * 60 * 1000) return libsCache.list;
    const list = new Set();
    for (const r of await steamRoots()) {
      try { for (const l of libraryFolders(fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8'))) list.add(l.path); } catch { /* */ }
    }
    libsCache = { t: Date.now(), list: [...list] };
    return libsCache.list;
  }

  // ------------------------------------------------------------ Mises à jour (lecture disque, sans réseau)
  const prevDl = new Map();
  async function pollUpdates() {
    if (S().extrasUpdates === false) return {};
    const out = {};
    const steam = store.data.games.filter((g) => g.kind === 'steam' && g.appid);
    const libs = steam.length ? await steamLibraries() : [];
    for (const g of steam) {
      const f = upd.findAppManifest(g, libs);
      if (!f) continue;
      const s = upd.steamStatus(upd.readAppState(f), prevDl.get(g.appid));
      prevDl.set(g.appid, { dl: s?.dl || 0 });
      if (s) out[g.id] = { state: s.state, pct: s.pct, label: upd.statusLabel(s), source: 'steam' };
    }
    const epic = store.data.games.filter((g) => g.kind === 'epic');
    if (epic.length) {
      const items = upd.readEpicItems(EPIC_DIR);
      const pending = upd.readEpicItems(path.join(EPIC_DIR, 'Pending'));
      for (const g of epic) {
        const it = upd.matchEpic(g, items);
        const s = upd.epicStatus(it, it ? upd.matchEpic(g, pending) : null);
        if (s) out[g.id] = { state: s.state, pct: s.pct, label: upd.statusLabel(s), source: 'epic' };
      }
    }
    return out;
  }

  // ------------------------------------------------------------ IPC
  ipcMain.handle('x:extras:summary', () => summaryAll());
  ipcMain.handle('x:extras:get', (_e, id) => {
    const g = findGame(id);
    if (!g) return null;
    const out = present(g);
    const d = X().ach[id];
    if (out.kind && out.configured && (!d || Date.now() - (d.fetchedAt || 0) > STALE_MS)) { out.loading = true; refresh(id); }
    return out;
  });
  ipcMain.handle('x:extras:refresh', (_e, id) => refresh(id));
  ipcMain.handle('x:extras:updates', () => pollUpdates().catch((e) => { safeLog(`maj : ${e.message}`); return {}; }));
  ipcMain.handle('x:extras:detectSteam', async () => {
    const users = await detectSteamUsers();
    return { ok: users.length > 0, users: users.map((u) => ({ steamId: u.steamId, name: u.personaName || u.accountName, mostRecent: u.mostRecent })) };
  });
  ipcMain.handle('x:extras:setSteamId', async (_e, input) => {
    const s = S();
    const v = String(input || '').trim();
    if (!v) { s.steamId = ''; s.steamId64 = ''; ctx.commit(); return { ok: true, steamId64: '' }; }
    try {
      const id = await api.resolveSteamId(get, s.steamApiKey, v);
      s.steamId = v; s.steamId64 = id; ctx.commit();
      return { ok: true, steamId64: id };
    } catch (e) { s.steamId = v; ctx.commit(); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('x:extras:testSteam', async () => {
    const s = S();
    if (!s.steamApiKey) return { ok: false, error: 'Ajoute ta clé API Steam' };
    try {
      if (!s.steamId64 && s.steamId) { s.steamId64 = await api.resolveSteamId(get, s.steamApiKey, s.steamId); ctx.commit(); }
      if (!s.steamId64) return { ok: false, error: 'Ajoute ton SteamID ou l’URL de ton profil' };
      const p = await api.steamProfile(get, s.steamApiKey, s.steamId64);
      return { ok: true, ...p };
    } catch (e) { return { ok: false, error: e.message, code: e.code }; }
  });
  ipcMain.handle('x:extras:testRA', async () => {
    const s = S();
    if (!s.raUser || !s.raKey) return { ok: false, error: 'Ajoute ton nom d’utilisateur et ta clé API web' };
    try { return { ok: true, ...(await api.raProfile(get, s.raUser, s.raKey)) }; } catch (e) { return { ok: false, error: e.message, code: e.code }; }
  });
  ipcMain.handle('x:extras:setRaGame', async (_e, id, raId) => {
    const n = Number(raId) || 0;
    if (n) X().ra[id] = { raId: n, manual: true };
    else delete X().ra[id];
    delete X().ach[id];
    store.save();
    return refresh(id);
  });

  // Fin de session : synchro des succès (+ notification des nouveaux)
  hub.on('session:end', (id) => {
    const g = findGame(id);
    const kind = kindOf(g);
    if (!kind || !configured(kind)) return;
    setTimeout(() => refresh(id, { notify: true }).catch(() => {}), SESSION_DELAY);
  });
}

module.exports = { init };

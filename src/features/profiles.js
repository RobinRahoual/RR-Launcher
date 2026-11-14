'use strict';
// Module PROFILES (main) — profils joueurs façon Switch / Xbox.
//
// MODÈLE DE DONNÉES (choix : « échange » des champs du profil actif)
//   store.data.profiles = { v, list: [{ id, name, avatar, color, image, settings }], current, last }
//     · id 'main' = profil principal (jamais supprimé). Un utilisateur existant n'a que lui : rien ne change.
//     · current = profil dont les données sont DANS les champs habituels (g.favorite, g.playtime…, settings.theme…).
//     · last = dernier profil choisi (option « garder le dernier » / Qui joue ? présélectionné).
//   Par jeu, les champs PAR PROFIL (GAME_KEYS) du profil `current` restent à leur place habituelle ;
//   ceux des autres profils sont rangés dans g.pp = { [profileId]: { favorite, playtime, … } } (valeurs par défaut omises).
//   Changer de profil = ranger les champs actuels dans g.pp[current] puis sortir g.pp[cible].
//   → TOUT le code existant (app.js, library, finishSession, launchGame, tray, home « Continuer »…) lit et écrit
//     g.favorite / g.playtime / g.lastPlayed / g.status… et travaille donc, sans modification, pour le profil actif.
//   Réglages par profil : OWN_SETTINGS (propres à chaque profil, vides pour un nouveau profil) et INHERIT_SETTINGS
//     (identifiants Steam / RetroAchievements, thème : ceux du profil s'ils sont définis, sinon ceux du principal).
//     Le profil principal garde ses valeurs dans list[main].settings tant qu'il n'est pas actif.
//   Succès (store.data.extras.ach) : rangés par identité (Steam ID 64 | utilisateur RA) dans profiles.achBy quand
//     deux profils n'ont pas les mêmes comptes.
//   Au démarrage, les données sont ramenées sur le principal le temps que les modules s'initialisent (stats : migration),
//   puis le dernier profil est réactivé. À la fermeture, retour au principal : sur le disque, au repos, les champs
//   habituels sont ceux du principal (une ancienne version du launcher retrouve donc ses données).
//   Temps total tous profils : g.playtime + Σ g.pp[*].playtime (totalPlaytime).
//   Sessions des statistiques : champ `profile` (absent = 'main'), filtre filterSessions().
// IPC : x:profiles:get | switch | save | remove | pickImage | statsScope
// Évènements → renderer : x:profiles:changed (état), x:stats:changed, x:extras:summary
// Images perso : DATA/profiles/<fichier>, servies par rr://profiles/<fichier>
const fs = require('fs');
const path = require('path');

const MAIN = 'main';
const GAME_KEYS = ['favorite', 'playtime', 'lastPlayed', 'playCount', 'status', 'rating', 'collections'];
const GAME_DEF = { favorite: false, playtime: 0, lastPlayed: 0, playCount: 0 }; // les autres clés sont simplement absentes
const OWN_SETTINGS = ['collections'];
const INHERIT_SETTINGS = ['theme', 'steamId', 'steamId64', 'steamApiKey', 'raUser', 'raKey'];
const AVATARS = ['star', 'bolt', 'heart', 'moon', 'pad', 'rocket', 'crown', 'leaf', 'note', 'hex', 'diamond', 'flame'];
const COLORS = ['#3C91E6', '#0C335A', '#C7362F', '#B4540C', '#23804A', '#7A3FB0', '#B02F80', '#0E7A70'];
const MAX = 8;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
const isDefault = (k, v) => v === undefined || v === null || (k in GAME_DEF ? v === GAME_DEF[k] : k === 'status' ? v === 'none' : k === 'rating' ? !v : k === 'collections' ? !v.length : false);
const empty = (v) => v === undefined || v === null || v === '';

function ensure(data) {
  let P = data.profiles;
  if (!P || !Array.isArray(P.list) || !P.list.length) P = data.profiles = { v: 1, list: [], current: MAIN, last: MAIN };
  if (!P.list.some((p) => p.id === MAIN)) P.list.unshift({ id: MAIN, name: 'Joueur 1', avatar: 'star', color: COLORS[0], image: '', settings: {} });
  for (const p of P.list) { p.settings ||= {}; if (!AVATARS.includes(p.avatar)) p.avatar = AVATARS[0]; if (!p.color) p.color = COLORS[0]; }
  if (!P.list.some((p) => p.id === P.current)) P.current = MAIN; // ne devrait pas arriver : données d'un profil disparu
  if (!P.list.some((p) => p.id === P.last)) P.last = MAIN;
  P.achBy ||= {};
  return P;
}
const byId = (P, id) => P.list.find((p) => p.id === id);

// ---------------------------------------------------------------- Jeux
function stashGame(g, pid) {
  const rec = {};
  for (const k of GAME_KEYS) if (!isDefault(k, g[k])) rec[k] = g[k];
  if (Object.keys(rec).length) (g.pp ||= {})[pid] = rec;
  else if (g.pp) delete g.pp[pid];
}
function restoreGame(g, pid) {
  const rec = g.pp?.[pid] || {};
  for (const k of GAME_KEYS) {
    if (k in rec) g[k] = rec[k];
    else if (k in GAME_DEF) g[k] = GAME_DEF[k];
    else delete g[k];
  }
  if (g.pp) { delete g.pp[pid]; if (!Object.keys(g.pp).length) delete g.pp; }
}
const totalPlaytime = (g) => (g.playtime || 0) + Object.values(g.pp || {}).reduce((a, r) => a + (r.playtime || 0), 0);

// ---------------------------------------------------------------- Réglages
function stashSettings(P, s, pid) {
  const p = byId(P, pid);
  if (!p) return;
  if (pid === MAIN) { p.settings = {}; for (const k of [...OWN_SETTINGS, ...INHERIT_SETTINGS]) if (s[k] !== undefined) p.settings[k] = s[k]; return; }
  const m = byId(P, MAIN).settings;
  p.settings = {};
  for (const k of OWN_SETTINGS) if (s[k] !== undefined && !(Array.isArray(s[k]) && !s[k].length)) p.settings[k] = s[k];
  for (const k of INHERIT_SETTINGS) if (!empty(s[k]) && s[k] !== m[k]) p.settings[k] = s[k]; // identique au principal = hérité
}
function restoreSettings(P, s, pid) {
  const p = byId(P, pid), m = byId(P, MAIN).settings;
  if (pid === MAIN) {
    for (const k of [...OWN_SETTINGS, ...INHERIT_SETTINGS]) { if (m[k] !== undefined) s[k] = m[k]; else delete s[k]; }
    p.settings = {};
    return;
  }
  for (const k of OWN_SETTINGS) s[k] = p.settings[k] !== undefined ? p.settings[k] : [];
  for (const k of INHERIT_SETTINGS) { const v = !empty(p.settings[k]) ? p.settings[k] : m[k]; if (v !== undefined) s[k] = v; else delete s[k]; }
  // Steam ID 64 résolu : seulement s'il correspond au Steam ID saisi par ce profil (sinon celui du principal)
  if (!empty(p.settings.steamId) && empty(p.settings.steamId64)) delete s.steamId64;
}
const identity = (s) => `${s.steamId64 || ''}|${s.raUser || ''}`;

// Passe du profil courant au profil `to`. Retourne false si rien à faire.
function switchTo(data, to) {
  const P = ensure(data);
  if (!byId(P, to) || P.current === to) { if (byId(P, to)) P.last = to; return false; }
  const from = P.current, s = (data.settings ||= {});
  const idA = identity(s);
  for (const g of data.games || []) stashGame(g, from);
  stashSettings(P, s, from);
  restoreSettings(P, s, to);
  for (const g of data.games || []) restoreGame(g, to);
  const idB = identity(s);
  if (idA !== idB && data.extras) { // succès d'un autre compte : on range ceux du compte quitté
    P.achBy[idA] = data.extras.ach || {};
    data.extras.ach = P.achBy[idB] || {};
    delete P.achBy[idB];
  }
  P.current = to;
  P.last = to;
  return true;
}

function removeProfile(data, id) {
  const P = ensure(data);
  if (id === MAIN || !byId(P, id)) return false;
  if (P.current === id) switchTo(data, MAIN);
  for (const g of data.games || []) if (g.pp?.[id]) { delete g.pp[id]; if (!Object.keys(g.pp).length) delete g.pp; }
  P.list = P.list.filter((p) => p.id !== id);
  if (P.last === id) P.last = MAIN;
  return true;
}

function saveProfile(data, o = {}) {
  const P = ensure(data);
  const name = clean(o.name);
  if (!name) return { ok: false, error: 'Donne un nom au profil' };
  if (P.list.some((p) => p.id !== o.id && p.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) return { ok: false, error: 'Ce nom est déjà pris' };
  let p = o.id ? byId(P, o.id) : null;
  if (o.id && !p) return { ok: false, error: 'Profil introuvable' };
  if (!p) {
    if (P.list.length >= MAX) return { ok: false, error: `${MAX} profils au maximum` };
    const used = new Set(P.list.map((x) => x.color));
    p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, avatar: AVATARS[P.list.length % AVATARS.length], color: COLORS.find((c) => !used.has(c)) || COLORS[1], image: '', settings: {} };
    P.list.push(p);
  }
  p.name = name;
  if (AVATARS.includes(o.avatar)) p.avatar = o.avatar;
  if (/^#[0-9a-f]{6}$/i.test(o.color || '')) p.color = o.color;
  if ('image' in o) p.image = typeof o.image === 'string' ? path.basename(o.image) : '';
  return { ok: true, id: p.id };
}

const sessionProfile = (s) => s.profile || MAIN;
const filterSessions = (sessions, pid) => (pid ? sessions.filter((s) => sessionProfile(s) === pid) : sessions);

// ---------------------------------------------------------------- Processus principal
function init(ctx) {
  const { ipcMain, store, send, commit, running, DATA, app, log } = ctx;
  const dir = path.join(DATA, 'profiles');
  const P = () => ensure(store.data);
  const scope = { stats: 'active' }; // écran stats : 'active' | 'all' (session uniquement)
  const state = () => {
    const p = P();
    return {
      list: p.list.map(({ id, name, avatar, color, image, settings }) => ({ id, name, avatar, color, image: image || '', own: Object.keys(settings || {}).filter((k) => INHERIT_SETTINGS.includes(k)) })),
      current: p.current, last: p.last, statsScope: scope.stats, avatars: AVATARS, colors: COLORS, max: MAX, running: running.size > 0,
    };
  };
  const changed = (extra = {}) => { send('x:profiles:changed', state()); if (extra.data) { send('x:stats:changed', {}); try { if (ctx.extrasSummary) send('x:extras:summary', ctx.extrasSummary()); } catch { /* */ } } };

  // Démarrage : données du principal le temps de l'initialisation des modules, puis dernier profil
  const startCur = P().current;
  if (startCur !== MAIN) { switchTo(store.data, MAIN); P().last = startCur; store.save(); } else store.save();
  setImmediate(() => {
    const last = P().last;
    if (last !== MAIN && switchTo(store.data, last)) { commit(); changed({ data: true }); }
  });
  // Fermeture : retour au principal sur le disque (compatibilité avec les anciennes versions)
  app?.on?.('before-quit', () => {
    try { const last = P().last; if (P().current !== MAIN) { switchTo(store.data, MAIN); P().last = last; store.save(); } } catch (e) { log?.(`profils : ${e.message}`); }
  });

  // API pour les autres modules (stats : profil de la session, filtre)
  ctx.profiles = {
    active: () => P().current,
    statsFilter: () => (scope.stats === 'all' ? null : P().current),
    filterSessions: (sessions) => filterSessions(sessions, scope.stats === 'all' ? null : P().current),
    totalPlaytime,
  };

  ipcMain.handle('x:profiles:get', () => state());
  ipcMain.handle('x:profiles:switch', (_e, id) => {
    if (!byId(P(), id)) return { ok: false, error: 'Profil introuvable' };
    if (P().current !== id && running.size) return { ok: false, error: 'Termine la partie en cours avant de changer de profil' };
    const did = switchTo(store.data, id);
    commit();
    changed({ data: did });
    return { ok: true, changed: did, state: state() };
  });
  ipcMain.handle('x:profiles:save', (_e, o) => {
    const r = saveProfile(store.data, o);
    if (r.ok) { commit(); changed(); }
    return { ...r, state: state() };
  });
  ipcMain.handle('x:profiles:remove', (_e, id) => {
    if (P().current === id && running.size) return { ok: false, error: 'Termine la partie en cours avant de supprimer ce profil' };
    const was = P().current;
    const p = byId(P(), id);
    if (!removeProfile(store.data, id)) return { ok: false, error: id === MAIN ? 'Le profil principal ne peut pas être supprimé' : 'Profil introuvable' };
    if (p?.image) fs.rmSync(path.join(dir, path.basename(p.image)), { force: true });
    commit();
    changed({ data: was === id });
    return { ok: true, state: state() };
  });
  ipcMain.handle('x:profiles:pickImage', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(ctx.getWin?.(), { title: 'Choisir une image de profil', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = `avatar-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
    fs.copyFileSync(r.filePaths[0], path.join(dir, file));
    return file;
  });
  // Recadrage : PNG carré produit par le renderer (data URL), remplace l'image choisie
  ipcMain.handle('x:profiles:saveCrop', (_e, dataUrl) => {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || m[2].length > 4e6) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = `avatar-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], 'base64'));
    return file; // l'original reste à côté : il sert si on recadre à nouveau
  });
  ipcMain.handle('x:profiles:statsScope', (_e, v) => {
    scope.stats = v === 'all' ? 'all' : 'active';
    send('x:stats:changed', {});
    return scope.stats;
  });
  ctx.protoRoute?.('profiles', (_req, u) => {
    const { net } = require('electron');
    const { pathToFileURL } = require('url');
    const full = path.join(dir, path.basename(decodeURIComponent(u.pathname)));
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
}

module.exports = { init, MAIN, GAME_KEYS, OWN_SETTINGS, INHERIT_SETTINGS, AVATARS, COLORS, ensure, switchTo, removeProfile, saveProfile, totalPlaytime, filterSessions, stashGame, restoreGame };

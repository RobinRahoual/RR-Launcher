// FRIENDS — fusion Discord + Steam, correspondance avec la bibliothèque, tri en sections, détection
// des lancements de jeu (notifications). Pur, testé dans test/friends.test.js.
'use strict';

/** « The Witcher® 3: Wild Hunt – GOTY » → « thewitcher3wildhunt » */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[™®©]/g, '').replace(/&/g, 'and')
    .replace(/\b(goty|game of the year|definitive|complete|deluxe|remastered|enhanced|ultimate|anniversary|director'?s cut)( edition)?\b/g, '')
    .replace(/\bedition\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Index de la bibliothèque : appid Steam → jeu, nom normalisé → jeu. */
function libraryIndex(games = []) {
  const byApp = new Map(), byName = new Map();
  for (const g of games) {
    if (g.appid) byApp.set(Number(g.appid), g);
    for (const n of [g.name, g.sortName, g.matchName].filter(Boolean)) { const k = norm(n); if (k.length >= 3 && !byName.has(k)) byName.set(k, g); }
  }
  return { byApp, byName };
}
function matchGame(act, idx) {
  if (!act || !idx || !['playing', 'streaming', 'competing'].includes(act.kind)) return null;
  if (act.appid && idx.byApp.has(Number(act.appid))) return idx.byApp.get(Number(act.appid));
  const k = norm(act.name);
  if (k.length < 3) return null;
  if (idx.byName.has(k)) return idx.byName.get(k);
  // « Elden Ring Nightreign » ne doit pas correspondre à « Elden Ring » : seule l'égalité compte,
  // à l'exception d'un sous-titre après « : » (« Hades: Battle Out of Hell » ↔ « Hades »)
  const head = norm(String(act.name).split(/[:–—]/)[0]);
  return head.length >= 4 && idx.byName.has(head) ? idx.byName.get(head) : null;
}

const inGame = (f) => !!f.activity && ['playing', 'streaming', 'competing'].includes(f.activity.kind);
const STATUS_RANK = { online: 0, idle: 1, dnd: 2, offline: 3 };
const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

const SRC_PRIO = { rr: 0, discord: 1, steam: 2 };
const STATE_RANK = (f) => (inGame(f) ? 0 : f.status !== 'offline' ? 1 : 2);

/**
 * Fusionne les doublons d'une même personne (profil RR, Discord, Steam) : liens manuels (groupes de clés)
 * + même pseudo d'une source à l'autre. Le nom/avatar viennent de RR > Discord > Steam, l'état du plus actif.
 */
function merge(list, links = []) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => { if (!parent.has(a) || !parent.has(b)) return; parent.set(find(a), find(b)); };
  for (const f of list) parent.set(f.key, f.key);
  for (const grp of links) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
  const byNick = new Map();
  for (const f of list) {
    const n = norm(f.name);
    if (n.length < 3) continue;
    const prev = byNick.get(n);
    if (prev && prev.source !== f.source) union(prev.key, f.key); else if (!prev) byNick.set(n, f);
  }
  const groups = new Map();
  for (const f of list) { const r = find(f.key); (groups.get(r) || groups.set(r, []).get(r)).push(f); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const named = [...g].sort((a, b) => (SRC_PRIO[a.source] ?? 9) - (SRC_PRIO[b.source] ?? 9))[0];
    const active = [...g].sort((a, b) => STATE_RANK(a) - STATE_RANK(b) || (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || ((b.lastSeen || 0) - (a.lastSeen || 0)))[0];
    out.push({ ...active, key: named.key, name: named.name, avatar: named.avatar ?? active.avatar, av: named.av ?? active.av, keys: g.map((x) => x.key), sources: [...new Set(g.map((x) => x.source))] });
  }
  return out;
}

/** Ajoute gameId (jeu de ta bibliothèque) et range en sections. hidden : Set de clés masquées. */
function build(list, games, { hidden = new Set(), offlineMax = 300 } = {}) {
  const idx = libraryIndex(games);
  const playing = [], online = [], offline = [];
  for (const f0 of list) {
    if ((f0.keys || [f0.key]).some((k) => hidden.has(k))) continue;
    const g = matchGame(f0.activity, idx);
    const f = { ...f0, inGame: inGame(f0), streaming: f0.activity?.kind === 'streaming' || !!f0.activity?.streaming, gameId: g ? g.id : null };
    if (f.inGame) playing.push(f);
    else if (f.status !== 'offline') online.push(f);
    else offline.push(f);
  }
  // En jeu : jeux que tu as d'abord, puis les streams, puis les parties les plus récentes
  playing.sort((a, b) => (!!b.gameId - !!a.gameId) || (b.streaming - a.streaming) || ((b.activity.since || 0) - (a.activity.since || 0)) || byName(a, b));
  // En ligne : une activité (écoute, regarde) d'abord, puis disponible > absent > ne pas déranger
  online.sort((a, b) => (!!b.activity - !!a.activity) || (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || byName(a, b));
  offline.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || byName(a, b));
  return { playing, online, offline: offline.slice(0, offlineMax), offlineTotal: offline.length };
}

/** Lancements de jeu entre deux états : Map(key → nom du jeu) avant / liste après. */
function started(prev, list) {
  const out = [];
  for (const f of list) {
    if (!inGame(f)) continue;
    const before = prev.get(f.key);
    if (before !== f.activity.name) out.push(f);
  }
  return out;
}
function playingMap(list) {
  const m = new Map();
  for (const f of list) if (inGame(f)) m.set(f.key, f.activity.name);
  return m;
}

module.exports = { merge, norm, libraryIndex, matchGame, build, started, playingMap, inGame };

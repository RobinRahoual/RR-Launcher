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

/** Ajoute gameId (jeu de ta bibliothèque) et range en sections. hidden : Set de clés masquées. */
function build(list, games, { hidden = new Set(), offlineMax = 300 } = {}) {
  const idx = libraryIndex(games);
  const playing = [], online = [], offline = [];
  for (const f0 of list) {
    if (hidden.has(f0.key)) continue;
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

module.exports = { norm, libraryIndex, matchGame, build, started, playingMap, inGame };

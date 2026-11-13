'use strict';
// IMPORTER — analyse de la bibliothèque (doublons, jeux désinstallés, visuels manquants, métadonnées en échec) et fusion.
// Logique pure : le système de fichiers est injecté (fsx.exists), pour les tests.
const path = require('path');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[™®©]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/\b(goty|game of the year|deluxe|standard|gold|complete)( edition)?\b/g, ' ').replace(/\bthe\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '');
const low = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const isLaunchers = (g) => ['steam', 'epic', 'uri'].includes(g.kind);

function score(g, hasFile = () => false) {
  return (g.playtime || 0) / 60 + (g.favorite ? 50 : 0) + (g.status && g.status !== 'none' ? 30 : 0) + (g.rating || 0) * 50
    + (g.collections?.length || 0) * 50 + (g.metaStatus === 'ok' ? 200 : 0) + (g.media?.cover ? 100 : 0) + (g.media?.hero ? 50 : 0)
    + (isLaunchers(g) ? 300 : 0) + (g.lastPlayed ? 100 : 0) - (g.addedAt || 0) / 1e13;
}

function findDuplicates(games) {
  const parent = games.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const strongLink = new Set();
  const link = (a, b, strong) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; if (strong) strongLink.add(find(a)); };
  const seen = new Map();
  const key = (k, i, strong, why) => {
    if (seen.has(k)) { const j = seen.get(k); link(i, j.i, strong); (j.why ||= new Set()).add(why); (seen.get(k).hit ||= new Set()).add(i); }
    else seen.set(k, { i });
  };
  games.forEach((g, i) => {
    if (g.exePath) key('exe:' + low(g.exePath), i, true, 'même exécutable');
    if (g.romPath) key('rom:' + low(g.romPath), i, true, 'même ROM');
    if (g.kind === 'steam' && g.appid) key('app:' + g.appid, i, true, 'même AppID Steam');
    else if (g.appid && g.platform === 'pc') key('app:' + g.appid, i, true, 'même AppID Steam');
    const n = norm(g.name);
    if (n.length >= 2) key(`name:${g.platform}:${n}`, i, false, 'même nom');
  });
  // un .exe rangé dans le dossier d'installation d'un jeu Steam / Epic / launcher
  const dirs = games.map((g, i) => [i, low(g.installDir)]).filter(([i, d]) => isLaunchers(games[i]) && d.split('\\').filter(Boolean).length >= 3);
  games.forEach((g, i) => {
    if (!g.exePath || isLaunchers(g)) return;
    for (const [j, d] of dirs) if (low(g.exePath).startsWith(d + '\\')) link(i, j, true);
  });
  const groups = new Map();
  games.forEach((g, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(i); });
  const out = [];
  for (const [r, idx] of groups) {
    if (idx.length < 2) continue;
    const members = idx.map((i) => games[i]);
    const reasons = new Set();
    for (const v of seen.values()) if (v.why && idx.includes(v.i)) for (const w of v.why) reasons.add(w);
    const dirLink = members.some((m) => !isLaunchers(m) && m.exePath && dirs.some(([j, d]) => idx.includes(j) && low(m.exePath).startsWith(d + '\\')));
    if (dirLink) reasons.add('dans le dossier du jeu');
    const strong = strongLink.has(find(idx[0])) || [...strongLink].some((s) => find(s) === r);
    const scored = members.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s);
    out.push({ strong, reason: [...reasons].join(', ') || 'même nom', keep: scored[0].m.id, ids: scored.map((x) => x.m.id) });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong));
}

// → { missing: bool, offline: bool, reason }
async function checkInstalled(g, fsx) {
  const ex = (p) => fsx.exists(p);
  const root = (p) => { const m = /^([A-Za-z]:)[\\/]/.exec(p || ''); return m ? m[1] + '\\' : null; };
  const gone = async (p, reason) => {
    const r = root(p);
    if (r && !(await ex(r))) return { missing: false, offline: true };
    if (!r && /^\\\\/.test(p || '')) return { missing: false, offline: true }; // réseau : jamais signalé
    return (await ex(p)) ? { missing: false } : { missing: true, reason };
  };
  if (g.kind === 'rom') return g.romPath ? gone(g.romPath, 'ROM introuvable') : { missing: false };
  if (g.kind === 'steam') {
    const d = g.installDir || '';
    const apps = path.win32.dirname(path.win32.dirname(d));
    if (/steamapps$/i.test(apps) && g.appid) return gone(path.win32.join(apps, `appmanifest_${g.appid}.acf`), 'appmanifest Steam absent');
    return d ? gone(d, 'Dossier du jeu introuvable') : { missing: false };
  }
  if (g.kind === 'epic') return g.installDir ? gone(g.installDir, 'Dossier du jeu introuvable') : { missing: false };
  if (g.kind === 'uri') return g.installDir ? gone(g.installDir, 'Dossier du jeu introuvable') : { missing: false };
  if (g.exePath) return gone(g.exePath, 'Fichier introuvable');
  return { missing: false };
}

const IMG = [['cover', 'jaquette'], ['hero', 'fond'], ['logo', 'logo']];
async function analyze(games, { fsx, mediaDir, running = new Set(), tried = {}, now = Date.now() }) {
  const res = { total: games.length, duplicates: [], missing: [], images: [], nometa: [], offline: 0 };
  const byId = new Map(games.map((g) => [g.id, g]));
  const dupIds = new Set();
  for (const d of findDuplicates(games)) { res.duplicates.push(d); d.ids.forEach((i) => dupIds.add(i)); }
  for (const g of games) {
    if (running.has(g.id)) continue;
    const c = await checkInstalled(g, fsx);
    if (c.offline) res.offline++;
    if (c.missing) { res.missing.push({ id: g.id, reason: c.reason }); continue; }
    const stuck = g.metaStatus === 'loading' && now - (g.addedAt || 0) > 10 * 60 * 1000 && !g.media?.cover;
    if (g.metaStatus === 'none' || stuck) { res.nometa.push({ id: g.id, triedAt: tried[g.id] || 0 }); continue; }
    if (g.metaStatus === 'loading') continue;
    const lack = [];
    for (const [k, label] of IMG) if (!g.media?.[k] || !(await fsx.exists(path.join(mediaDir, g.id, g.media[k])))) lack.push(label);
    if (lack.length) res.images.push({ id: g.id, missing: lack, triedAt: tried[g.id] || 0 });
  }
  res.byId = byId;
  return res;
}

const STATUS_RANK = { none: 0, todo: 1, dropped: 2, playing: 3, done: 4, complete: 5 };
// Fusionne `drops` dans `keep` (objets jeu) ; renvoie les fichiers de visuels à copier [{from, to}] (ids de dossier).
function mergeInto(keep, drops) {
  const copy = [];
  for (const d of drops) {
    keep.playtime = (keep.playtime || 0) + (d.playtime || 0);
    keep.playCount = (keep.playCount || 0) + (d.playCount || 0);
    keep.lastPlayed = Math.max(keep.lastPlayed || 0, d.lastPlayed || 0);
    keep.favorite = !!(keep.favorite || d.favorite);
    if ((STATUS_RANK[d.status] || 0) > (STATUS_RANK[keep.status] || 0)) keep.status = d.status;
    keep.rating = Math.max(keep.rating || 0, d.rating || 0);
    if (keep.rating === 0) delete keep.rating;
    const cols = [...new Set([...(keep.collections || []), ...(d.collections || [])])];
    if (cols.length) keep.collections = cols;
    keep.addedAt = Math.min(keep.addedAt || Infinity, d.addedAt || Infinity);
    if (!Number.isFinite(keep.addedAt)) keep.addedAt = Date.now();
    keep.media ||= {};
    for (const [k, f] of Object.entries(d.media || {})) if (f && !keep.media[k]) { keep.media[k] = f; copy.push({ from: d.id, to: keep.id, file: f }); }
    if (!keep.args && d.args) keep.args = d.args;
  }
  keep.mediaVersion = Date.now();
  return copy;
}

module.exports = { norm, score, findDuplicates, checkInstalled, analyze, mergeInto };

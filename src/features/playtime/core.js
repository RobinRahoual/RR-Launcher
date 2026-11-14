// PLAYTIME — logique pure (testée dans test/playtime.test.js) :
// - temps de jeu des autres launchers : Steam (userdata/*/config/localconfig.vdf), GOG Galaxy (galaxy-2.0.db),
//   itch.io (butler.db) ;
// - correspondance processus → jeu de la bibliothèque pour le suivi des jeux lancés hors du launcher.
'use strict';
const path = require('path').win32; // chemins Windows, y compris dans les tests
const { parseVdf, ci } = require('../extras/vdf');

/** localconfig.vdf → Map appid → { sec, last (ms) } */
function steamLocalConfig(text) {
  const out = new Map();
  const root = parseVdf(text);
  let apps = ci(root, 'UserLocalConfigStore');
  for (const k of ['Software', 'Valve', 'Steam', 'apps']) apps = apps && ci(apps, k);
  if (!apps || typeof apps !== 'object') return out;
  for (const [id, a] of Object.entries(apps)) {
    if (!/^\d+$/.test(id) || !a || typeof a !== 'object') continue;
    const min = Number(ci(a, 'Playtime') || 0);
    const last = Number(ci(a, 'LastPlayed') || 0) * 1000;
    if (min > 0 || last > 0) out.set(Number(id), { sec: Math.round(min * 60), last });
  }
  return out;
}
/** Plusieurs comptes Steam sur le PC : on garde le plus grand temps par jeu */
function mergeMax(maps) {
  const out = new Map();
  for (const m of maps) for (const [k, v] of m) {
    const o = out.get(k);
    out.set(k, o ? { sec: Math.max(o.sec, v.sec), last: Math.max(o.last, v.last) } : { ...v });
  }
  return out;
}

/** GOG Galaxy : tables GameTimes (releaseKey, minutesInGame) et LastPlayedDates → Map releaseKey → { sec, last } */
function gogTimes(db) {
  const out = new Map();
  let times = [], lasts = [];
  try { times = db.rows('GameTimes'); } catch { return out; }
  try { lasts = db.rows('LastPlayedDates'); } catch { /* facultatif */ }
  for (const r of times) {
    const key = String(r.releaseKey || '');
    const sec = Math.round(Number(r.minutesInGame || 0) * 60);
    if (!key || !(sec > 0)) continue;
    const o = out.get(key);
    out.set(key, { sec: Math.max(o?.sec || 0, sec), last: 0 });
  }
  for (const r of lasts) {
    const key = String(r.gameReleaseKey || r.releaseKey || '');
    const t = Date.parse(r.lastPlayedDate || '') || 0;
    if (out.has(key) && t) out.get(key).last = Math.max(out.get(key).last, t);
  }
  return out;
}

/** itch.io : caves (seconds_run, last_touched_at) → Map dossier normalisé → { sec, last } */
function itchTimes(db) {
  const out = new Map();
  let caves = [], locs = {};
  try { caves = db.rows('caves'); locs = Object.fromEntries(db.rows('install_locations').map((l) => [l.id, l.path])); } catch { return out; }
  for (const c of caves) {
    const dir = c.custom_install_folder || (locs[c.install_location_id] && c.install_folder_name ? path.join(locs[c.install_location_id], c.install_folder_name) : '');
    const sec = Number(c.seconds_run || 0);
    if (!dir || !(sec > 0)) continue;
    out.set(normDir(dir), { sec: Math.round(sec), last: Date.parse(c.last_touched_at || '') || 0 });
  }
  return out;
}

const normDir = (d) => path.resolve(String(d || '')).replace(/[\\/]+$/, '').toLowerCase();

/** Identifiant GOG d'un dossier de jeu : goggame-<id>.info */
function gogIdOf(files) {
  for (const f of files) { const m = /^goggame-(\d+)\.info$/i.exec(f); if (m) return m[1]; }
  return '';
}

/**
 * Applique les temps externes à la bibliothèque : le temps affiché devient le plus grand des deux (le launcher
 * et Steam comptent la même partie quand le jeu est lancé depuis le launcher : on ne les additionne pas).
 * Renvoie le nombre de jeux mis à jour.
 */
function applyTimes(games, lookup, now = Date.now()) {
  let n = 0;
  for (const g of games) {
    const r = lookup(g);
    if (!r || !(r.sec > 0)) continue;
    const prev = g.playtimeExt?.sec || 0;
    g.playtimeExt = { src: r.src, sec: r.sec, at: now };
    let changed = r.sec !== prev;
    if (r.sec > (g.playtime || 0)) { g.playtime = r.sec; changed = true; }
    if (r.last && r.last > (g.lastPlayed || 0) && r.last <= now + 60000) { g.lastPlayed = r.last; changed = true; }
    if (changed) n++;
  }
  return n;
}

/**
 * Dossiers suivis : jeux de la bibliothèque (hors ROM), avec un dossier assez précis.
 * Renvoie [{ id, dir }] trié du plus long au plus court (un jeu dans le sous-dossier d'un autre gagne).
 */
function watchList(games, { tooBroad, exclude = [] }) {
  const ex = exclude.map(normDir);
  const out = [];
  for (const g of games) {
    if (g.kind === 'rom' || g.hidden) continue;
    const exe = g.exePath && !/\.(lnk|url)$/i.test(g.exePath) ? g.exePath : '';
    let dir = g.installDir || (exe ? path.dirname(exe) : '');
    if (dir && tooBroad(dir) && exe && !tooBroad(path.dirname(exe))) dir = path.dirname(exe);
    if (!dir || tooBroad(dir)) continue;
    const d = normDir(dir);
    if (ex.some((e) => e === d || e.startsWith(d + '\\') || d.startsWith(e + '\\'))) continue; // émulateurs, le launcher lui-même
    out.push({ id: g.id, dir: d });
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}
/** Processus [{ pid, path }] → Map id du jeu → pids */
function matchProcesses(procs, list, { helper = /$^/, selfPid = 0 } = {}) {
  const out = new Map();
  for (const p of procs) {
    if (!p.path || p.pid === selfPid) continue;
    const lp = p.path.toLowerCase();
    if (helper.test(path.basename(lp))) continue;
    const w = list.find((x) => lp.startsWith(x.dir + '\\'));
    if (!w) continue;
    if (!out.has(w.id)) out.set(w.id, { dir: w.dir, pids: [] });
    out.get(w.id).pids.push(p.pid);
  }
  return out;
}

/** AppName Epic d'un jeu : dernier segment de com.epicgames.launcher://apps/<ns>%3A<item>%3A<AppName>?action=… */
function epicAppName(g) {
  if (g.epicAppName) return g.epicAppName;
  const m = /^com\.epicgames\.launcher:\/\/apps\/([^?]+)/i.exec(g.launchUri || '');
  if (!m) return '';
  const parts = decodeURIComponent(m[1]).split(':');
  return parts[parts.length - 1] || '';
}
/** Réponse de library-service …/playtime/account/<id>/all → Map AppName → { sec } */
function epicTimes(list) {
  const out = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const id = String(r?.artifactId || '');
    const sec = Number(r?.totalTime || 0);
    if (id && sec > 0) out.set(id, { sec: Math.round(Math.max(out.get(id)?.sec || 0, sec)), last: 0 });
  }
  return out;
}
/** Page /id/api/redirect après connexion : JSON { authorizationCode } (texte brut ou <pre>) */
function epicCodeFrom(text) {
  try { const j = JSON.parse(String(text || '').trim()); return typeof j.authorizationCode === 'string' && j.authorizationCode ? j.authorizationCode : ''; } catch { return ''; }
}

module.exports = { epicAppName, epicTimes, epicCodeFrom, steamLocalConfig, mergeMax, gogTimes, itchTimes, gogIdOf, applyTimes, watchList, matchProcesses, normDir };

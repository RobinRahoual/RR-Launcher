// Module stats — journal des sessions + agrégats « Year in Review » (processus principal).
// Données : DATA/stats/sessions.json  { v, migrated, sessions: [{ id, start, end, seconds }] }
// Les entrées « historique » (jeux jouées avant le journal) n'ont ni start ni end : { id, seconds, legacy: true }.
// Toute la logique de dates/agrégats est pure (testée dans test/stats.test.js) ; fuseau par défaut Europe/Paris.
'use strict';
const fs = require('fs');
const path = require('path');

const TZ = 'Europe/Paris';
const MIN_SECONDS = 30;          // sessions plus courtes : ignorées
const MAX_BYTES = 5 * 1024 * 1024; // au-delà, la moitié la plus ancienne part dans une archive

// ---------------------------------------------------------------- Dates (jours civils dans un fuseau)
const fmtCache = new Map();
function dayKey(ts, tz = TZ) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); fmtCache.set(tz, f); }
  const p = {};
  for (const x of f.formatToParts(ts)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const keyOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const dow = (n) => (((n + 3) % 7) + 7) % 7; // 0 = lundi
const monthKey = (key) => key.slice(0, 7);

// Découpe une session sur les jours civils qu'elle traverse (minuit local, DST compris)
function splitSession(s, tz = TZ) {
  if (!s || s.start == null) return [];
  const total = Math.max(0, Math.round(s.seconds ?? ((s.end - s.start) / 1000)));
  if (!(s.end > s.start)) return [{ day: dayKey(s.start, tz), sec: total }];
  const parts = [];
  let cur = s.start;
  while (cur < s.end) {
    const k = dayKey(cur, tz);
    if (dayKey(s.end - 1, tz) === k) { parts.push({ day: k, ms: s.end - cur }); break; }
    let lo = cur, hi = s.end;
    while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (dayKey(mid, tz) === k) lo = mid; else hi = mid; }
    parts.push({ day: k, ms: hi - cur });
    cur = hi;
  }
  const sumMs = parts.reduce((a, p) => a + p.ms, 0) || 1;
  let left = total;
  return parts.map((p, i) => { const sec = i === parts.length - 1 ? left : Math.round(total * p.ms / sumMs); left -= sec; return { day: p.day, sec }; });
}

// Segments { id, day, sec, first } (first = 1ʳᵉ part d'une session : sert à compter les sessions) ; legacy : day = null
function segments(sessions, tz = TZ) {
  const out = [];
  for (const s of sessions) {
    if (s.legacy || s.start == null) { out.push({ id: s.id, day: null, sec: s.seconds || 0, first: 0 }); continue; }
    splitSession(s, tz).forEach((p, i) => out.push({ id: s.id, day: p.day, sec: p.sec, first: i === 0 ? 1 : 0 }));
  }
  return out;
}

// ---------------------------------------------------------------- Séries
function streaks(days, todayKey) {
  const set = [...new Set(days)].map(dayNum).sort((a, b) => a - b);
  let best = 0, bestEnd = null, run = 0, prev = null;
  for (const n of set) {
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    if (run >= best) { best = run; bestEnd = n; }
    prev = n;
  }
  const have = new Set(set);
  const today = dayNum(todayKey);
  let n = have.has(today) ? today : today - 1; // série encore « vivante » si on a joué hier
  let current = 0;
  while (have.has(n)) { current++; n--; }
  return { current, best, bestEnd: bestEnd === null ? null : keyOf(bestEnd) };
}

// ---------------------------------------------------------------- Périodes
function periodRange(period, todayKey, offset = 0, firstKey = null) {
  const t = dayNum(todayKey);
  if (period === 'week') { const m = t - dow(t) + offset * 7; return { from: keyOf(m), to: keyOf(m + 6) }; }
  if (period === 'month') {
    const [y, mo] = todayKey.split('-').map(Number);
    return { from: keyOf(Date.UTC(y, mo - 1 + offset, 1) / 864e5), to: keyOf(Date.UTC(y, mo + offset, 0) / 864e5) };
  }
  if (period === 'year') { const y = +todayKey.slice(0, 4) + offset; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  return { from: firstKey || todayKey, to: todayKey }; // 'all'
}

function buckets(period, range, perDay) {
  const a = dayNum(range.from), b = dayNum(range.to);
  const sumDays = (x, y) => { let s = 0; for (let n = x; n <= y; n++) s += perDay.get(keyOf(n)) || 0; return s; };
  if (period === 'week') {
    return { unit: 'day', items: Array.from({ length: 7 }, (_, i) => ({ key: keyOf(a + i), from: keyOf(a + i), to: keyOf(a + i), sec: perDay.get(keyOf(a + i)) || 0 })) };
  }
  if (period === 'month') { // semaines (lundi→dimanche) recoupées par le mois
    const items = [];
    for (let m = a - dow(a); m <= b; m += 7) {
      const x = Math.max(m, a), y = Math.min(m + 6, b);
      items.push({ key: keyOf(m), from: keyOf(x), to: keyOf(y), sec: sumDays(x, y) });
    }
    return { unit: 'week', items };
  }
  const months = [];
  const [y0, m0] = range.from.split('-').map(Number), [y1, m1] = range.to.split('-').map(Number);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) months.push([y, m]);
  if (period === 'all' && months.length > 24) { // longue durée : par année
    const items = [];
    for (let y = y0; y <= y1; y++) items.push({ key: String(y), from: `${y}-01-01`, to: `${y}-12-31`, sec: sumDays(dayNum(`${y}-01-01`), dayNum(`${y}-12-31`)) });
    return { unit: 'year', items };
  }
  return {
    unit: 'month',
    items: months.map(([y, m]) => {
      const f = dayNum(`${y}-${String(m).padStart(2, '0')}-01`), l = Math.round(Date.UTC(y, m, 0) / 864e5);
      return { key: `${y}-${String(m).padStart(2, '0')}`, from: keyOf(f), to: keyOf(l), sec: sumDays(f, l) };
    }),
  };
}

// Carte annuelle : colonnes = semaines (lundi en haut), niveaux 0-4 selon les quartiles des jours joués
function heatmap(perDay, year, todayKey) {
  const first = dayNum(`${year}-01-01`), last = dayNum(`${year}-12-31`);
  const vals = [];
  for (let n = first; n <= last; n++) { const v = perDay.get(keyOf(n)); if (v > 0) vals.push(v); }
  vals.sort((x, y) => x - y);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0);
  const th = [q(0.25), q(0.5), q(0.75)]; // seuils des niveaux 2, 3, 4 (le niveau 1 = tout jour joué sous le 1ᵉʳ seuil)
  const level = (v) => (v <= 0 ? 0 : v < th[0] ? 1 : v < th[1] ? 2 : v < th[2] ? 3 : 4);
  const today = dayNum(todayKey);
  const weeks = [];
  for (let m = first - dow(first); m <= last; m += 7) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const n = m + i;
      if (n < first || n > last) return null;
      const sec = perDay.get(keyOf(n)) || 0;
      return { key: keyOf(n), sec, level: level(sec), future: n > today };
    }));
  }
  return { year, weeks, thresholds: th, max: vals.length ? vals[vals.length - 1] : 0 };
}

// ---------------------------------------------------------------- Agrégat principal
function aggregate(sessions, opts = {}) {
  const tz = opts.tz || TZ, now = opts.now ?? Date.now(), period = opts.period || 'week', offset = period === 'all' ? 0 : (opts.offset || 0);
  const info = opts.gameInfo || (() => null);
  const todayKey = dayKey(now, tz);
  const segs = segments(sessions, tz);
  const perDayAll = new Map();
  for (const s of segs) if (s.day) perDayAll.set(s.day, (perDayAll.get(s.day) || 0) + s.sec);
  const dated = [...perDayAll.keys()].sort();
  const range = periodRange(period, todayKey, offset, dated[0]);
  const inRange = (s) => (s.day ? s.day >= range.from && s.day <= range.to : period === 'all');
  const sel = segs.filter(inRange);

  const perDay = new Map();
  const byGame = new Map(), byPlat = new Map();
  let seconds = 0, nSessions = 0, legacySeconds = 0;
  for (const s of sel) {
    seconds += s.sec; nSessions += s.first;
    if (!s.day) legacySeconds += s.sec; else perDay.set(s.day, (perDay.get(s.day) || 0) + s.sec);
    const g = byGame.get(s.id) || { id: s.id, seconds: 0, sessions: 0 };
    g.seconds += s.sec; g.sessions += s.first; byGame.set(s.id, g);
  }
  const topGames = [...byGame.values()].filter((g) => g.seconds > 0).sort((a, b) => b.seconds - a.seconds).map((g) => {
    const gi = info(g.id) || {};
    const p = gi.platform || null;
    if (p) byPlat.set(p, (byPlat.get(p) || 0) + g.seconds);
    return { ...g, name: gi.name || null, platform: p };
  });
  const platforms = [...byPlat].map(([id, sec]) => ({ id, seconds: sec })).sort((a, b) => b.seconds - a.seconds);
  const platTotal = platforms.reduce((a, p) => a + p.seconds, 0) || 1;
  platforms.forEach((p) => { p.share = p.seconds / platTotal; });

  const year = period === 'year' ? +range.from.slice(0, 4) : +(period === 'all' ? todayKey : range.to).slice(0, 4);
  return {
    tz, now, period, offset, today: todayKey, range,
    hasData: sessions.length > 0,
    totals: { seconds, sessions: nSessions, days: perDay.size, legacySeconds },
    streak: streaks([...perDayAll.keys()], todayKey),
    topGames, topGame: topGames.find((g) => g.name) || topGames[0] || null,
    platforms, topPlatform: platforms[0] || null,
    buckets: buckets(period, range, perDay),
    heat: heatmap(perDayAll, year, todayKey),
  };
}

// Activité d'un jeu : N dernières semaines (la courante en dernier) + 1ʳᵉ / dernière session
function gameActivity(sessions, id, opts = {}) {
  const tz = opts.tz || TZ, now = opts.now ?? Date.now(), n = opts.weeks || 8;
  const mine = sessions.filter((s) => s.id === id);
  const perDay = new Map();
  for (const s of segments(mine, tz)) if (s.day) perDay.set(s.day, (perDay.get(s.day) || 0) + s.sec);
  const t = dayNum(dayKey(now, tz)), monday = t - dow(t);
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const a = monday - i * 7;
    let sec = 0; for (let d = a; d < a + 7; d++) sec += perDay.get(keyOf(d)) || 0;
    weeks.push({ from: keyOf(a), to: keyOf(a + 6), sec });
  }
  const dated = mine.filter((s) => !s.legacy && s.start != null).sort((a, b) => a.start - b.start);
  return {
    weeks, sessions: dated.length, seconds: mine.reduce((a, s) => a + (s.seconds || 0), 0),
    legacySeconds: mine.filter((s) => s.legacy).reduce((a, s) => a + (s.seconds || 0), 0),
    first: dated[0]?.start ?? null, last: dated.length ? dated[dated.length - 1].start : null,
  };
}

// ---------------------------------------------------------------- CSV (séparateur « ; » pour Excel fr, BOM UTF-8)
function localStamp(ts, tz = TZ) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ts)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function toCsv(sessions, gameInfo = () => null, tz = TZ) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['jeu', 'console', 'debut', 'fin', 'duree_secondes', 'historique']];
  const list = [...sessions].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  for (const s of list) {
    const gi = gameInfo(s.id) || {};
    rows.push([gi.name || s.id, gi.platform || '', s.start != null ? localStamp(s.start, tz) : '', s.end != null ? localStamp(s.end, tz) : '', s.seconds || 0, s.legacy ? 'oui' : '']);
  }
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- Persistance
function readDb(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sessions = Array.isArray(j) ? j : Array.isArray(j.sessions) ? j.sessions : [];
    return { v: 1, migrated: !!j.migrated, sessions: sessions.filter((s) => s && s.id && Number.isFinite(s.seconds)) };
  } catch { return { v: 1, migrated: false, sessions: [] }; }
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}
// Jeux ayant du temps de jeu mais aucune session journalisée → une entrée « historique »
function migrate(db, games) {
  if (db.migrated) return false;
  const have = new Set(db.sessions.map((s) => s.id));
  for (const g of games) if ((g.playtime || 0) >= MIN_SECONDS && !have.has(g.id)) db.sessions.push({ id: g.id, start: null, end: null, seconds: Math.round(g.playtime), legacy: true });
  db.migrated = true;
  return true;
}

function init(ctx) {
  const { ipcMain, hub, DATA } = ctx;
  const file = path.join(DATA, 'stats', 'sessions.json');
  const db = readDb(file);
  const games = () => ctx.store?.data?.games || [];
  const info = (id) => { const g = ctx.findGame(id); return g ? { name: g.name, platform: g.platform } : null; };
  const save = () => {
    try {
      let text = JSON.stringify(db);
      if (text.length > MAX_BYTES) { // rotation : la moitié la plus ancienne part dans une archive
        const sorted = [...db.sessions].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        const cut = Math.floor(sorted.length / 2);
        const arch = path.join(path.dirname(file), `sessions-archive-${Date.now()}.json`);
        writeAtomic(arch, JSON.stringify({ v: 1, sessions: sorted.slice(0, cut) }));
        db.sessions = sorted.slice(cut);
        text = JSON.stringify(db);
      }
      writeAtomic(file, text);
    } catch (e) { ctx.log(`stats : écriture impossible (${e.message})`); }
  };
  if (migrate(db, games()) || !fs.existsSync(file)) save();

  hub.on('session:end', (id, s) => {
    if (!s || !(s.seconds >= MIN_SECONDS)) return;
    db.sessions.push({ id, start: s.start, end: s.end, seconds: s.seconds });
    save();
    ctx.send('x:stats:changed', {});
  });
  ipcMain.handle('x:stats:get', (_e, o = {}) => aggregate(db.sessions, { period: o.period, offset: o.offset, gameInfo: info }));
  ipcMain.handle('x:stats:game', (_e, id) => gameActivity(db.sessions, String(id)));
  ipcMain.handle('x:stats:clear', () => { db.sessions = []; db.migrated = true; save(); ctx.send('x:stats:changed', {}); return true; });
  ipcMain.handle('x:stats:export', async () => {
    const { dialog } = require('electron');
    const win = ctx.getWin?.();
    const r = await dialog.showSaveDialog(win, { title: 'Exporter les statistiques', defaultPath: path.join(ctx.app.getPath('documents'), 'rr-launcher-statistiques.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(r.filePath, toCsv(db.sessions, info), 'utf8'); return { ok: true, path: r.filePath, rows: db.sessions.length }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { init, TZ, MIN_SECONDS, dayKey, dayNum, keyOf, splitSession, segments, streaks, periodRange, buckets, heatmap, aggregate, gameActivity, toCsv, migrate, readDb };

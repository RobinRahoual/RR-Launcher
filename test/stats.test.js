// STATS : agrégats, séries, regroupements, fuseau Europe/Paris. Lancer : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/features/stats');

const H = 3600e3;
// Instant local Paris (été = UTC+2, hiver = UTC+1)
const paris = (iso, off = 2) => Date.parse(`${iso}:00Z`) - off * H;
const ses = (id, a, mins, off = 2) => { const start = paris(a, off); return { id, start, end: start + mins * 60e3, seconds: mins * 60 }; };

test('dayKey : le jour dépend du fuseau (23:30 UTC le 31/12 = 1er janvier à Paris)', () => {
  const ts = Date.parse('2025-12-31T23:30:00Z');
  assert.strictEqual(S.dayKey(ts, 'UTC'), '2025-12-31');
  assert.strictEqual(S.dayKey(ts, 'Europe/Paris'), '2026-01-01');
  assert.strictEqual(S.dayKey(Date.parse('2026-06-30T22:30:00Z')), '2026-07-01'); // été : UTC+2
});

test('splitSession : une session à cheval sur minuit est coupée à minuit local', () => {
  const s = ses('a', '2026-03-10T23:30', 90, 1); // 23:30 → 01:00 (hiver, UTC+1)
  const p = S.splitSession(s);
  assert.deepStrictEqual(p.map((x) => x.day), ['2026-03-10', '2026-03-11']);
  assert.deepStrictEqual(p.map((x) => x.sec), [1800, 3600]);
  assert.strictEqual(p.reduce((a, x) => a + x.sec, 0), s.seconds);
});

test('splitSession : changement d’heure (29/03/2026, 23 h) sans perte ni doublon', () => {
  // 28/03 22:00 (UTC+1) → 29/03 04:00 (UTC+2) : 5 h réelles
  const start = Date.parse('2026-03-28T21:00:00Z'), end = Date.parse('2026-03-29T02:00:00Z');
  const p = S.splitSession({ id: 'x', start, end, seconds: 5 * 3600 });
  assert.deepStrictEqual(p.map((x) => x.day), ['2026-03-28', '2026-03-29']);
  assert.deepStrictEqual(p.map((x) => x.sec), [2 * 3600, 3 * 3600]);
});

test('streaks : actuelle (aujourd’hui ou hier) et record', () => {
  const days = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-10', '2026-05-11', '2026-05-12'];
  assert.deepStrictEqual(S.streaks(days, '2026-05-12'), { current: 3, best: 4, bestEnd: '2026-05-04' });
  assert.strictEqual(S.streaks(days, '2026-05-13').current, 3);  // hier compte encore
  assert.strictEqual(S.streaks(days, '2026-05-14').current, 0);  // série rompue
  assert.deepStrictEqual(S.streaks([], '2026-05-14'), { current: 0, best: 0, bestEnd: null });
  assert.strictEqual(S.streaks(['2026-02-28', '2026-03-01'], '2026-03-01').current, 2); // 2026 non bissextile : 28/02 → 01/03 consécutifs
  assert.strictEqual(S.streaks(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01').current, 3);
});

test('periodRange : semaine du lundi, mois, année, offsets', () => {
  assert.deepStrictEqual(S.periodRange('week', '2026-11-13'), { from: '2026-11-09', to: '2026-11-15' }); // vendredi
  assert.deepStrictEqual(S.periodRange('week', '2026-11-15'), { from: '2026-11-09', to: '2026-11-15' }); // dimanche
  assert.deepStrictEqual(S.periodRange('week', '2026-11-13', -1), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepStrictEqual(S.periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepStrictEqual(S.periodRange('month', '2026-01-10', -1), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepStrictEqual(S.periodRange('year', '2026-11-13', -1), { from: '2025-01-01', to: '2025-12-31' });
});

test('aggregate semaine : barres par jour, totaux, jeu et console les plus joués', () => {
  const now = paris('2026-11-13T15:00'); // vendredi
  const list = [
    ses('zelda', '2026-11-09T20:00', 60), ses('zelda', '2026-11-09T22:00', 30), ses('doom', '2026-11-11T21:00', 45),
    ses('zelda', '2026-11-13T10:00', 120), ses('doom', '2026-11-02T20:00', 600), // semaine précédente
  ];
  const info = (id) => ({ zelda: { name: 'Zelda', platform: 'switch' }, doom: { name: 'Doom', platform: 'pc' } }[id]);
  const a = S.aggregate(list, { period: 'week', now, gameInfo: info });
  assert.deepStrictEqual(a.range, { from: '2026-11-09', to: '2026-11-15' });
  assert.strictEqual(a.buckets.unit, 'day');
  assert.deepStrictEqual(a.buckets.items.map((b) => b.sec / 60), [90, 0, 45, 0, 120, 0, 0]);
  assert.deepStrictEqual(a.totals, { seconds: 255 * 60, sessions: 4, days: 3, legacySeconds: 0 });
  assert.strictEqual(a.topGame.id, 'zelda');
  assert.strictEqual(a.topGame.seconds, 210 * 60);
  assert.strictEqual(a.topPlatform.id, 'switch');
  assert.ok(Math.abs(a.platforms.reduce((x, p) => x + p.share, 0) - 1) < 1e-9);
  const prev = S.aggregate(list, { period: 'week', offset: -1, now, gameInfo: info });
  assert.strictEqual(prev.totals.seconds, 600 * 60);
});

test('aggregate mois : regroupement par semaines recoupées par le mois', () => {
  const now = paris('2026-11-13T15:00');
  const list = [ses('a', '2026-11-01T10:00', 60), ses('a', '2026-11-02T10:00', 30), ses('a', '2026-11-30T10:00', 15), ses('a', '2026-10-31T10:00', 99)];
  const a = S.aggregate(list, { period: 'month', now });
  const w = a.buckets.items;
  assert.strictEqual(a.buckets.unit, 'week');
  assert.strictEqual(w.length, 6); // 1er nov = dimanche → 6 semaines civiles
  assert.deepStrictEqual([w[0].from, w[0].to, w[0].sec], ['2026-11-01', '2026-11-01', 3600]);
  assert.deepStrictEqual([w[1].from, w[1].to, w[1].sec], ['2026-11-02', '2026-11-08', 1800]);
  assert.deepStrictEqual([w[5].from, w[5].to, w[5].sec], ['2026-11-30', '2026-11-30', 900]);
  assert.strictEqual(w.reduce((x, b) => x + b.sec, 0), a.totals.seconds); // aucune perte
});

test('aggregate année : 12 mois ; "tout" : mois puis années au-delà de 24 mois', () => {
  const now = paris('2026-11-13T15:00');
  const list = [ses('a', '2026-01-31T23:30', 60, 1), ses('a', '2026-03-05T12:00', 30, 1), ses('a', '2023-06-01T12:00', 10)];
  const y = S.aggregate(list, { period: 'year', now });
  assert.strictEqual(y.buckets.unit, 'month');
  assert.strictEqual(y.buckets.items.length, 12);
  assert.deepStrictEqual(y.buckets.items.slice(0, 3).map((b) => b.sec), [1800, 1800, 1800]); // la session du 31/01 23:30 est coupée en janvier / février
  const all = S.aggregate(list, { period: 'all', now });
  assert.strictEqual(all.buckets.unit, 'year');
  assert.deepStrictEqual(all.buckets.items.map((b) => b.key), ['2023', '2024', '2025', '2026']);
  assert.strictEqual(all.totals.seconds, (60 + 30 + 10) * 60);
});

test('historique (sans date) : compté dans « Tout » seulement, pas dans les sessions ni les jours', () => {
  const now = paris('2026-11-13T15:00');
  const list = [{ id: 'old', start: null, end: null, seconds: 7200, legacy: true }, ses('old', '2026-11-12T20:00', 30)];
  const all = S.aggregate(list, { period: 'all', now });
  assert.deepStrictEqual(all.totals, { seconds: 9000, sessions: 1, days: 1, legacySeconds: 7200 });
  assert.strictEqual(S.aggregate(list, { period: 'week', now }).totals.seconds, 1800);
});

test('heatmap : 53 colonnes max, lundi en haut, niveaux 0-4, jours futurs signalés', () => {
  const now = paris('2026-06-15T12:00');
  const list = [];
  for (let d = 1; d <= 28; d++) list.push(ses('a', `2026-05-${String(d).padStart(2, '0')}T20:00`, 10 * d));
  const a = S.aggregate(list, { period: 'year', now });
  const h = a.heat;
  assert.strictEqual(h.year, 2026);
  assert.ok(h.weeks.length >= 52 && h.weeks.length <= 54);
  assert.strictEqual(h.weeks[0][0], null);           // 1er janv. 2026 = jeudi : lun-mer vides
  assert.strictEqual(h.weeks[0][3].key, '2026-01-01');
  const cells = h.weeks.flat().filter(Boolean);
  assert.strictEqual(cells.length, 365);
  assert.strictEqual(cells.find((c) => c.key === '2026-05-28').level, 4);
  assert.strictEqual(cells.find((c) => c.key === '2026-05-01').level, 1);
  assert.strictEqual(cells.find((c) => c.key === '2026-04-01').level, 0);
  assert.ok(cells.find((c) => c.key === '2026-12-01').future);
  assert.ok(!cells.find((c) => c.key === '2026-06-15').future);
});

test('gameActivity : 8 dernières semaines, première / dernière session', () => {
  const now = paris('2026-11-13T15:00');
  const list = [ses('a', '2026-09-20T20:00', 30), ses('a', '2026-11-12T20:00', 60), ses('a', '2026-11-13T09:00', 20), ses('b', '2026-11-12T20:00', 999)];
  const g = S.gameActivity(list, 'a', { now });
  assert.strictEqual(g.weeks.length, 8);
  assert.strictEqual(g.weeks[7].from, '2026-11-09');
  assert.strictEqual(g.weeks[7].sec, 80 * 60);
  assert.strictEqual(g.weeks[0].from, '2026-09-21'); // 8 semaines : la session du 20/09 est trop ancienne
  assert.strictEqual(g.weeks.reduce((x, w) => x + w.sec, 0), 80 * 60);
  assert.strictEqual(g.sessions, 3);
  assert.strictEqual(g.first, list[0].start);
  assert.strictEqual(g.last, list[2].start);
});

test('migration : une entrée historique par jeu jouable sans session, une seule fois', () => {
  const db = { migrated: false, sessions: [{ id: 'b', start: 1, end: 2, seconds: 100 }] };
  const games = [{ id: 'a', playtime: 3600 }, { id: 'b', playtime: 500 }, { id: 'c', playtime: 0 }, { id: 'd', playtime: 10 }];
  assert.strictEqual(S.migrate(db, games), true);
  assert.deepStrictEqual(db.sessions.filter((s) => s.legacy), [{ id: 'a', start: null, end: null, seconds: 3600, legacy: true }]);
  assert.strictEqual(S.migrate(db, games), false);
  assert.strictEqual(db.sessions.length, 2);
});

test('CSV : séparateur « ; », BOM, heure locale, guillemets échappés', () => {
  const list = [ses('a', '2026-11-12T20:00', 30, 1), { id: 'o', start: null, end: null, seconds: 60, legacy: true }];
  const csv = S.toCsv(list, (id) => ({ name: id === 'a' ? 'Hades; "II"' : 'Old', platform: 'pc' }));
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.strictEqual(lines[0], 'jeu;console;debut;fin;duree_secondes;historique');
  assert.strictEqual(lines[1], 'Old;pc;;;60;oui');
  assert.strictEqual(lines[2], '"Hades; ""II""";pc;2026-11-12 20:00:00;2026-11-12 20:30:00;1800;');
});

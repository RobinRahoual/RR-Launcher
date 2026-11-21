// SMART : règles des collections intelligentes
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const R = require('../src/renderer/features/smart-rules');
const smart = require('../src/features/smart');

const NOW = Date.UTC(2026, 10, 14);
const day = 86400000;
const G = (o) => ({ id: o.name, platform: 'pc', playtime: 0, playCount: 0, lastPlayed: 0, addedAt: NOW - 10 * day, ...o });
const games = [
  G({ name: 'Neuf' }),
  G({ name: 'Court', playtime: 3600, playCount: 2, lastPlayed: NOW - 5 * day }),
  G({ name: 'Long', playtime: 20 * 3600, playCount: 9, lastPlayed: NOW - 200 * day, status: 'playing', addedAt: NOW - 400 * day }),
  G({ name: 'Fini', playtime: 30 * 3600, playCount: 5, lastPlayed: NOW - 300 * day, status: 'done', addedAt: NOW - 500 * day, favorite: true }),
  G({ name: 'Mario Party', platform: 'switch', localCoop: true, genres: ['Fête', 'Action'], collections: ['Soirée'], releaseDate: '2018-10-05', rating: 4 }),
];
const names = (c) => R.filter(games, c, NOW).map((g) => g.name);
const P = (id) => R.PRESETS.find((p) => p.id === id);

test('préréglages : jamais lancés, < 2 h, coop, nouveaux, à reprendre, préférés', () => {
  assert.deepStrictEqual(names(P('p-never')), ['Neuf', 'Mario Party']);
  assert.deepStrictEqual(names(P('p-short')), ['Neuf', 'Court', 'Mario Party']);
  assert.deepStrictEqual(names(P('p-coop')), ['Mario Party']);
  assert.deepStrictEqual(names(P('p-new')), ['Neuf', 'Court', 'Mario Party']);
  assert.deepStrictEqual(names(P('p-forgotten')), ['Long']); // Fini exclu (terminé), Neuf jamais lancé
  assert.deepStrictEqual(names(P('p-loved')), ['Fini', 'Mario Party']);
});

test('ET / OU, texte sans accents, listes (genre, collection)', () => {
  const all = { match: 'all', rules: [{ f: 'genre', op: 'has', v: 'fete' }, { f: 'platform', op: 'eq', v: 'switch' }] };
  assert.deepStrictEqual(names(all), ['Mario Party']);
  const any = { match: 'any', rules: [{ f: 'collection', op: 'eq', v: 'soiree' }, { f: 'name', op: 'has', v: 'LONG' }] };
  assert.deepStrictEqual(names(any), ['Long', 'Mario Party']);
  assert.deepStrictEqual(names({ match: 'all', rules: [{ f: 'name', op: 'nhas', v: 'o' }] }), ['Neuf', 'Fini']);
});

test('année, note, favori ; champ ou opérateur inconnu = jamais vrai', () => {
  assert.deepStrictEqual(names({ rules: [{ f: 'year', op: 'lt', v: 2020 }] }), ['Mario Party']);
  assert.deepStrictEqual(names({ rules: [{ f: 'favorite', op: 'is', v: true }] }), ['Fini']);
  assert.deepStrictEqual(names({ rules: [{ f: 'inconnu', op: 'eq', v: 1 }] }), []);
  assert.deepStrictEqual(names({ rules: [{ f: 'rating', op: 'has', v: 1 }] }), []);
  assert.deepStrictEqual(names({ rules: [] }), []);
});

test('sanitize : nettoie, borne, rejette le vide', () => {
  assert.strictEqual(R.sanitize({ name: '  ', rules: [{ f: 'rating', op: 'gt', v: 1 }] }), null);
  assert.strictEqual(R.sanitize({ name: 'X', rules: [{ f: 'rating', op: 'gt', v: 'abc' }] }), null);
  const c = R.sanitize({ id: 'c-abc12345', name: ' Ma  liste ', match: 'zzz', rules: [{ f: 'status', op: 'eq', v: 'done' }, { f: 'status', op: 'eq', v: 'nimporte' }, { f: 'genre', op: 'has', v: ' RPG ' }, { f: 'coop', op: 'is', v: 'true' }] });
  assert.deepStrictEqual(c, { id: 'c-abc12345', name: 'Ma liste', match: 'all', rules: [{ f: 'status', op: 'eq', v: 'done' }, { f: 'genre', op: 'has', v: 'RPG' }, { f: 'coop', op: 'is', v: true }], tab: true });
  assert.strictEqual(R.sanitize({ name: 'Y', rules: new Array(20).fill({ f: 'rating', op: 'gt', v: 1 }) }).rules.length, 8);
});

test('describe : texte lisible', () => {
  assert.strictEqual(R.describe({ f: 'playtimeH', op: 'lt', v: 2 }), 'Temps de jeu < 2 h');
  assert.strictEqual(R.describe({ f: 'coop', op: 'is', v: true }), 'Multijoueur local est oui');
});

test('module : enregistrer, modifier, nom unique, supprimer, activer un préréglage', async () => {
  const store = { data: { settings: {} } };
  const h = {};
  smart.init({ ipcMain: { handle: (c, f) => { h[c] = f; } }, store, commit() {}, hub: new EventEmitter() });
  assert.deepStrictEqual(store.data.settings.smartPresetsOn, R.DEFAULT_ON);
  const r = await h['x:smart:save'](null, { name: 'RPG longs', rules: [{ f: 'genre', op: 'has', v: 'RPG' }, { f: 'playtimeH', op: 'gt', v: 10 }] });
  assert.strictEqual(r.ok, true);
  const id = r.custom[0].id;
  assert.match(id, /^c-[0-9a-f]{8}$/);
  assert.strictEqual((await h['x:smart:save'](null, { name: 'rpg LONGS', rules: [{ f: 'rating', op: 'gt', v: 1 }] })).ok, false); // nom pris
  assert.strictEqual((await h['x:smart:save'](null, { id, name: 'RPG longs 2', rules: [{ f: 'rating', op: 'gt', v: 1 }] })).custom[0].name, 'RPG longs 2');
  assert.strictEqual((await h['x:smart:save'](null, { name: '', rules: [] })).ok, false);
  assert.deepStrictEqual((await h['x:smart:preset'](null, 'p-coop', true)).on.sort(), ['p-coop', 'p-never', 'p-short']);
  assert.deepStrictEqual((await h['x:smart:preset'](null, 'p-never', false)).on.sort(), ['p-coop', 'p-short']);
  assert.strictEqual((await h['x:smart:preset'](null, 'nope', true)).ok, false);
  assert.strictEqual((await h['x:smart:delete'](null, id)).custom.length, 0);
});

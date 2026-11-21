'use strict';
const test = require('node:test');
const assert = require('node:assert');
const c = require('../src/features/uninstalled/core');

test('Steam : GetOwnedGames → éléments, installés retirés', () => {
  const items = c.steamOwned({ response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 60 }, { appid: 440, name: 'Team Fortress 2' }] } });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(c.notInstalled(items, [{ appid: 620, name: 'Portal 2' }]).map((x) => x.name).join(), 'Team Fortress 2');
  assert.strictEqual(c.installPlan(items[0]).uri, 'steam://install/620');
});
test('Epic : seuls les vrais jeux, URI d’installation', () => {
  const game = { title: 'Hades', categories: [{ path: 'games' }, { path: 'games/edition/base' }], keyImages: [{ type: 'DieselGameBoxTall', url: 'https://x/y.jpg' }] };
  assert.ok(c.epicItem({ appName: 'Min', namespace: 'ns', catalogItemId: 'ci' }, game));
  assert.strictEqual(c.epicItem({ appName: 'D', namespace: 'ns', catalogItemId: 'd' }, { title: 'Pack', categories: [{ path: 'addons' }] }), null);
  assert.strictEqual(c.epicItem({ appName: 'D', namespace: 'ns', catalogItemId: 'd' }, { title: 'DLC', categories: [{ path: 'games' }], mainGameItem: { id: 'x' } }), null);
  const it = c.epicItem({ appName: 'Min', namespace: 'ns', catalogItemId: 'ci' }, game);
  assert.strictEqual(c.installPlan(it).uri, 'com.epicgames.launcher://apps/Min?action=install');
  assert.strictEqual(c.notInstalled([it], [{ epicApp: 'Min', name: 'x' }]).length, 0);
});
test('GOG : OwnedGames + GamePieces', () => {
  const db = { rows: (t) => ({ OwnedGames: [{ releaseKey: 'gog_123' }, { releaseKey: 'steam_9' }], GamePieceTypes: [{ id: 1, type: 'originalTitle' }, { id: 2, type: 'originalImages' }], GamePieces: [{ releaseKey: 'gog_123', gamePieceTypeId: 1, value: '{"title":"Witcher"}' }, { releaseKey: 'gog_123', gamePieceTypeId: 2, value: '{"verticalCover":"//img/x.jpg"}' }] }[t]) };
  const items = c.gogOwned(db);
  assert.deepStrictEqual(items.map((x) => [x.id, x.name, x.art]), [['123', 'Witcher', 'https://img/x.jpg']]);
  assert.strictEqual(c.installPlan(items[0]).uri, 'goggalaxy://openGameView/123');
  assert.strictEqual(c.notInstalled(items, [{ galaxyId: 123, name: 'z' }]).length, 0);
});

test('Epic : un jeu « games + applications » est gardé, les add-ons non', () => {
  const g = { title: 'Fortnite', categories: [{ path: 'games' }, { path: 'applications' }] };
  assert.ok(c.epicItem({ appName: 'F', namespace: 'n', catalogItemId: 'i' }, g));
  assert.strictEqual(c.epicItem({ appName: 'A', namespace: 'n', catalogItemId: 'j' }, { title: 'Outil', categories: [{ path: 'applications' }] }), null);
});
test('Steam famille : exclut ce que tu possèdes et les jeux exclus', () => {
  const j = { response: { apps: [{ appid: 1, name: 'A', exclude_reason: 0 }, { appid: 2, name: 'B', exclude_reason: 3 }, { appid: 3, name: 'C' }] } };
  assert.deepStrictEqual(c.steamFamily(j, new Set(['3'])).map((x) => x.id), ['1']);
});

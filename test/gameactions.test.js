'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { updatePlan, uninstallPlan } = require('../src/features/gameactions/core');

test('updatePlan : Steam, Epic, GOG, rien pour une ROM', () => {
  assert.strictEqual(updatePlan({ kind: 'steam', appid: 620 }).uri, 'steam://validate/620');
  assert.strictEqual(updatePlan({ kind: 'epic' }).via, 'epic');
  assert.strictEqual(updatePlan({ kind: 'exe', source: 'gog', galaxyId: '123' }).uri, 'goggalaxy://openGameView/123');
  assert.strictEqual(updatePlan({ kind: 'rom' }), null);
  assert.strictEqual(updatePlan(null), null);
});
test('uninstallPlan : Steam / Epic / désinstalleur / rien', () => {
  assert.strictEqual(uninstallPlan({ kind: 'steam', appid: 7 }).uri, 'steam://uninstall/7');
  assert.strictEqual(uninstallPlan({ kind: 'epic' }).via, 'epic');
  const g = { kind: 'exe', installDir: 'C:\\Games\\X' };
  assert.strictEqual(uninstallPlan(g, ['game.exe', 'unins000.exe']).exe, 'C:\\Games\\X\\unins000.exe');
  assert.strictEqual(uninstallPlan(g, ['Uninstall.exe']).exe, 'C:\\Games\\X\\Uninstall.exe');
  assert.strictEqual(uninstallPlan(g, ['game.exe']), null);
  assert.strictEqual(uninstallPlan({ kind: 'rom', installDir: 'x' }, ['unins000.exe']), null);
});

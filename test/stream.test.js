'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/features/stream');

test('launchArg', () => {
  assert.strictEqual(S.launchArg(['x', '--launch=abc-12']), 'abc-12');
  assert.strictEqual(S.launchArg(['x', '--launch', 'g1']), 'g1');
  assert.strictEqual(S.launchArg(['x', '--launch=../../evil']), null);
  assert.strictEqual(S.launchArg(['x']), null);
});
test('localAddresses garde le LAN', () => {
  const r = S.localAddresses({ Wi: [{ family: 'IPv4', address: '192.168.1.5' }, { family: 'IPv6', address: 'fe80::1' }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], Ts: [{ family: 'IPv4', address: '100.101.2.3' }], Pub: [{ family: 'IPv4', address: '8.8.8.8' }] });
  assert.deepStrictEqual(r.map((a) => a.address), ['192.168.1.5', '100.101.2.3']);
});
test('appEntry / addApp / removeApp', () => {
  const e = S.appEntry('C:\\RR\\RR Launcher.exe', { id: 'g1', name: 'Zelda' });
  assert.strictEqual(e.cmd, '"C:\\RR\\RR Launcher.exe" --launch=g1');
  let r = S.addApp({}, e); assert.ok(r.added); assert.strictEqual(r.json.apps.length, 1);
  r = S.addApp(r.json, { ...e, cmd: 'x' }); assert.ok(!r.added); assert.strictEqual(r.json.apps.length, 1);
  r = S.removeApp(r.json, e.name); assert.ok(r.removed); assert.strictEqual(r.json.apps.length, 0);
});
test('moonlightArgs', () => assert.deepStrictEqual(S.moonlightArgs('10.0.0.2'), ['stream', '10.0.0.2', 'Desktop']));

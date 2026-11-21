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
test('waitPort attend l’ouverture du port', async () => {
  const net = require('net');
  const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  assert.strictEqual(await S.portOpen(port), true);
  let n = 0;
  assert.strictEqual(await S.waitPort(1, { tries: 5, every: 0, sleep: async () => {}, check: async () => ++n >= 3 }), true);
  assert.strictEqual(await S.waitPort(1, { tries: 3, every: 0, sleep: async () => {}, check: async () => false }), false);
  srv.close();
});
test('isLocalHost : seulement la machine locale', () => {
  assert.ok(S.isLocalHost('localhost') && S.isLocalHost('127.0.0.1') && S.isLocalHost('::1'));
  assert.ok(!S.isLocalHost('evil.com') && !S.isLocalHost('192.168.1.16') && !S.isLocalHost(''));
});

test('apolloCandidates : Program Files\\Apollo, Apollo.exe ou sunshine.exe', () => {
  const c = S.apolloCandidates({ ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\U\\AppData\\Local' });
  assert.ok(c.includes('C:\\Program Files\\Apollo\\Apollo.exe') && c.includes('C:\\Program Files\\Apollo\\sunshine.exe'));
  assert.ok(c.some((p) => p.includes('Programs\\Apollo')));
});
test('pickAsset : installeur .exe, ignore les archives source', () => {
  const rel = { tag_name: 'v0.4.6', assets: [{ name: 'Source.zip', browser_download_url: 'u0' }, { name: 'Apollo-0.4.6.exe', size: 5, browser_download_url: 'u1', digest: 'sha256:' + 'a'.repeat(64) }] };
  const a = S.pickAsset(rel);
  assert.deepStrictEqual([a.name, a.url, a.size, a.sha256, a.tag], ['Apollo-0.4.6.exe', 'u1', 5, 'a'.repeat(64), 'v0.4.6']);
  assert.strictEqual(S.pickAsset({ assets: [] }), null);
});
test('parseGpus : NVIDIA prioritaire, AV1 selon la génération', () => {
  assert.deepStrictEqual(S.parseGpus(['Intel(R) UHD Graphics', 'NVIDIA GeForce RTX 4070']).gpu, 'nvidia');
  assert.strictEqual(S.parseGpus(['NVIDIA GeForce RTX 4070']).av1Host, true);
  assert.strictEqual(S.parseGpus(['NVIDIA GeForce GTX 1660']).av1Host, false);
  assert.strictEqual(S.parseGpus(['AMD Radeon RX 7800 XT']).gpu, 'amd');
  assert.strictEqual(S.parseGpus([]).gpu, 'unknown');
});
test('cleanConfig : enlève platform / version / vides, accepte { config }', () => {
  assert.deepStrictEqual(S.cleanConfig({ platform: 'windows', version: '1', status: true, encoder: 'nvenc', fec_percentage: 20, empty: '' }), { encoder: 'nvenc', fec_percentage: '20' });
  assert.deepStrictEqual(S.cleanConfig({ config: { hevc_mode: 0 }, platform: 'x' }), { hevc_mode: '0' });
});
test('speedStats : médiane et minimum', () => {
  assert.deepStrictEqual(S.speedStats([100, 300, 200, NaN]), { mbps: 200, minMbps: 100, n: 3 });
  assert.strictEqual(S.speedStats([]).mbps, null);
});
test('installScript : installeur silencieux en administrateur', () => assert.match(S.installScript("C:\\t\\Apollo-1.exe"), /-ArgumentList '\/S' -Verb RunAs -Wait/));

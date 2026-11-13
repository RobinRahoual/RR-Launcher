// Tests des parties pures du bouton Guide : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { BTN, hidKind, decodeHidReport, makeEdges, createGuideWatcher } = require('../src/guide');

const rep = (len, set) => { const b = Buffer.alloc(len); for (const [i, v] of Object.entries(set)) b[i] = v; return b; };
const NEUTRAL_HAT = 0x08;

test('identification des manettes HID', () => {
  assert.strictEqual(hidKind(0x054c, 0x09cc), 'ds4');
  assert.strictEqual(hidKind(0x054c, 0x0ce6), 'dualsense');
  assert.strictEqual(hidKind(0x054c, 0x0df2), 'dualsense');
  assert.strictEqual(hidKind(0x057e, 0x2009), 'switchpro');
  assert.strictEqual(hidKind(0x045e, 0x028e), null); // Xbox 360 : passe par XInput
});

test('DualShock 4 USB : bouton PS octet 7 bit 0, croix = A', () => {
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT })), 0);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT, 7: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT | 0x20 })), BTN.A);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT | 0x40 })), BTN.B);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: 0x00 })), BTN.UP);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: 0x06 })), BTN.LEFT);
  // le compteur (bits 2-7 de l'octet 7) ne déclenche pas le bouton PS
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT, 7: 0xfc })), 0);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: NEUTRAL_HAT, 6: 0x20 })), BTN.START);
});

test('DualShock 4 Bluetooth : rapport réduit 0x01 et complet 0x11 (+2)', () => {
  assert.strictEqual(decodeHidReport('ds4', rep(10, { 0: 0x01, 5: NEUTRAL_HAT, 7: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('ds4', rep(78, { 0: 0x11, 7: NEUTRAL_HAT, 9: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('ds4', rep(78, { 0: 0x11, 7: NEUTRAL_HAT | 0x20 })), BTN.A);
  assert.strictEqual(decodeHidReport('ds4', rep(78, { 0: 0x11, 7: NEUTRAL_HAT })), 0);
  assert.strictEqual(decodeHidReport('ds4', rep(10, { 0: 0x05 })), null); // rapport inconnu
});

test('DualSense : USB octet 10, BT réduit octet 7, BT 0x31 octet 11', () => {
  assert.strictEqual(decodeHidReport('dualsense', rep(64, { 0: 0x01, 8: NEUTRAL_HAT, 10: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('dualsense', rep(64, { 0: 0x01, 8: NEUTRAL_HAT })), 0);
  assert.strictEqual(decodeHidReport('dualsense', rep(64, { 0: 0x01, 8: NEUTRAL_HAT | 0x20 })), BTN.A);
  assert.strictEqual(decodeHidReport('dualsense', rep(10, { 0: 0x01, 5: NEUTRAL_HAT, 7: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('dualsense', rep(78, { 0: 0x31, 9: NEUTRAL_HAT, 11: 0x01 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('dualsense', rep(78, { 0: 0x31, 9: 0x04 })), BTN.DOWN);
  // octet 10 du rapport BT 0x31 = boutons « 2 » (OPTIONS 0x20), pas le bouton PS
  assert.strictEqual(decodeHidReport('dualsense', rep(78, { 0: 0x31, 9: NEUTRAL_HAT, 10: 0x20 })), BTN.START);
});

test('Switch Pro : HOME dans les rapports 0x30 et 0x3F, A Nintendo = valider', () => {
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 4: 0x10 })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 3: 0x08 })), BTN.A);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 5: 0x02 })), BTN.UP);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 2: 0x10, 3: NEUTRAL_HAT })), BTN.GUIDE);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 1: 0x02, 3: NEUTRAL_HAT })), BTN.A);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 3: NEUTRAL_HAT })), 0);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x21 })), null);
});

test('rapports invalides', () => {
  assert.strictEqual(decodeHidReport('ds4', null), null);
  assert.strictEqual(decodeHidReport('ds4', Buffer.from([1, 2])), null);
  assert.strictEqual(decodeHidReport('inconnu', rep(64, { 0: 1 })), null);
});

test('anti-rebond : un appui = un front, maintien ignoré', () => {
  const e = makeEdges({ minGapMs: 150 });
  assert.strictEqual(e.feed('s', BTN.GUIDE, 0), BTN.GUIDE);
  for (let t = 16; t < 2000; t += 16) assert.strictEqual(e.feed('s', BTN.GUIDE, t), 0); // maintenu 2 s
  assert.strictEqual(e.feed('s', 0, 2000), 0);
  assert.strictEqual(e.feed('s', BTN.GUIDE, 2100), BTN.GUIDE);
});

test('anti-rebond : rebond de contact < 150 ms filtré, sources indépendantes', () => {
  const e = makeEdges({ minGapMs: 150 });
  assert.strictEqual(e.feed('s', BTN.A, 0), BTN.A);
  assert.strictEqual(e.feed('s', 0, 20), 0);
  assert.strictEqual(e.feed('s', BTN.A, 40), 0); // rebond
  assert.strictEqual(e.feed('s', 0, 300), 0);
  assert.strictEqual(e.feed('s', BTN.A, 320), BTN.A);
  assert.strictEqual(e.feed('t', BTN.A, 330), BTN.A); // autre manette
  assert.strictEqual(e.feed('s', BTN.A | BTN.B, 340), BTN.B); // A toujours tenu, B nouveau
});

test('surveillance : Guide dédoublonné entre sources, relais seulement si demandé', () => {
  const guides = [], remotes = [];
  let remote = false;
  const w = createGuideWatcher({
    loadNative: () => { throw new Error('absent'); },
    loadHid: () => { throw new Error('absent'); },
    onGuide: (s) => guides.push(s),
    onRemote: (b) => remotes.push(b),
    wantRemote: () => remote,
  });
  w.start(); // modules absents : ne plante pas
  assert.deepStrictEqual(w.status().xinput, false);
  w._feed('xi0', BTN.GUIDE);
  w._feed('hid:a', BTN.GUIDE); // même appui vu en HID : ignoré
  assert.deepStrictEqual(guides, ['xi0']);
  w._feed('xi0', BTN.A);
  assert.deepStrictEqual(remotes, []);
  remote = true;
  w._feed('xi0', 0);
  w._feed('xi0', BTN.DOWN);
  assert.deepStrictEqual(remotes, ['down']);
  w.stop();
});

test('surveillance XInput simulée : sondage, slot déconnecté', async () => {
  const guides = [];
  let state = [0, null, null, null];
  const fake = { xinputOk: true, xinputButtons: () => state };
  const w = createGuideWatcher({ loadNative: () => fake, loadHid: () => { throw new Error('x'); }, onGuide: (s) => guides.push(s), pollMs: 5 });
  w.start();
  await new Promise((r) => setTimeout(r, 20));
  state = [BTN.GUIDE, null, null, null];
  await new Promise((r) => setTimeout(r, 40)); // maintenu sur plusieurs sondages
  state = [0, null, null, null];
  await new Promise((r) => setTimeout(r, 20));
  w.stop();
  assert.deepStrictEqual(guides, ['xi0']);
});

// Vérifie que tous les prototypes Win32 de native-win.js sont acceptés par koffi (analyse seule, sans DLL)
test('native-win : prototypes koffi valides', (t) => {
  let koffi;
  try { koffi = require('koffi'); } catch { return t.skip('koffi absent'); }
  const src = fs.readFileSync(path.join(__dirname, '../src/native-win.js'), 'utf8');
  {
    try {
      koffi.struct('RR_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
      koffi.struct('RR_PROCESSENTRY32W', { dwSize: 'uint32_t', cntUsage: 'uint32_t', th32ProcessID: 'uint32_t', th32DefaultHeapID: 'uintptr_t', th32ModuleID: 'uint32_t', cntThreads: 'uint32_t', th32ParentProcessID: 'uint32_t', pcPriClassBase: 'int32_t', dwFlags: 'uint32_t', szExeFile: koffi.array('uint16_t', 260, 'Typed') });
      koffi.proto('bool __stdcall RREnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
    } catch { /* déjà défini */ }
  }
  assert.strictEqual(koffi.sizeof('RR_PROCESSENTRY32W'), 568); // taille Windows x64
  const protos = [...src.matchAll(/\.func\('([^']+\([^']*\))'\)/g)].map((m) => m[1]);
  assert.ok(protos.length >= 20, `prototypes trouvés : ${protos.length}`);
  protos.forEach((p, i) => {
    const named = p.replace(/(__stdcall\s+)(\w+)\(/, (_m, cc, name) => `${cc}RRT${i}_${name}(`);
    assert.doesNotThrow(() => koffi.proto(named), p);
  });
});

// WAKE : manette allumée → launcher au premier plan. Tests de la logique pure : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPresence, createWakeGate, wakeWanted, xinputKeys, hidPadKeys } = require('../src/padwake');
const { hidKind, createGuideWatcher } = require('../src/guide');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('présence : 1er passage = référence, nouvelle manette signalée une fois', () => {
  const p = createPresence();
  assert.deepStrictEqual(p.update('xinput', ['xi0']), []); // déjà branchée au démarrage
  assert.deepStrictEqual(p.update('xinput', ['xi0']), []);
  assert.deepStrictEqual(p.update('xinput', ['xi0', 'xi1']), ['xi1']);
  assert.deepStrictEqual(p.update('xinput', ['xi0', 'xi1']), []);
  assert.deepStrictEqual(p.update('hid', ['hid:a']), []); // sources indépendantes : référence propre
  assert.deepStrictEqual(p.update('hid', ['hid:a', 'hid:b']), ['hid:b']);
});

test('présence : raté isolé ignoré, débranchée puis rebranchée = nouvelle', () => {
  const p = createPresence({ goneAfter: 2 });
  p.update('xinput', ['xi0']);
  assert.deepStrictEqual(p.update('xinput', []), []); // 1 raté
  assert.deepStrictEqual(p.update('xinput', ['xi0']), []); // pas une arrivée
  p.update('xinput', []);
  p.update('xinput', []); // vraiment partie
  assert.deepStrictEqual(p.update('xinput', ['xi0']), ['xi0']);
});

test('présence : reset → le passage suivant redevient la référence', () => {
  const p = createPresence();
  p.update('xinput', []);
  p.reset();
  assert.deepStrictEqual(p.update('xinput', ['xi0']), []);
});

test('anti-rebond : 1 réveil max par 10 s', () => {
  const g = createWakeGate({ cooldownMs: 10000 });
  assert.strictEqual(g.tryWake(1000), true);
  assert.strictEqual(g.tryWake(5000), false); // manette Bluetooth qui réapparaît
  assert.strictEqual(g.tryWake(10999), false);
  assert.strictEqual(g.tryWake(11000), true);
});

test('activation : masqué ou réduit, aucun jeu, réglage actif', () => {
  assert.strictEqual(wakeWanted({ enabled: true, gameRunning: false, hidden: true, minimized: false }), true);
  assert.strictEqual(wakeWanted({ enabled: true, gameRunning: false, hidden: false, minimized: true }), true);
  assert.strictEqual(wakeWanted({ enabled: true, gameRunning: false, hidden: false, minimized: false }), false); // visible : API Gamepad
  assert.strictEqual(wakeWanted({ enabled: true, gameRunning: true, hidden: true, minimized: false }), false); // pendant un jeu
  assert.strictEqual(wakeWanted({ enabled: false, gameRunning: false, hidden: true, minimized: false }), false);
});

test('clés XInput et HID', () => {
  assert.deepStrictEqual(xinputKeys([0, null, 0x1000, null]), ['xi0', 'xi2']);
  assert.deepStrictEqual(xinputKeys(null), []);
  const list = [
    { vendorId: 0x054c, productId: 0x0ce6, path: 'ds', usagePage: 1, usage: 5 },
    { vendorId: 0x054c, productId: 0x0ce6, path: 'ds-audio', usagePage: 12, usage: 1 }, // autre interface
    { vendorId: 0x046d, productId: 0xc52b, path: 'souris', usagePage: 1, usage: 2 }, // pas une manette connue
    { vendorId: 0x057e, productId: 0x2009, path: 'pro' }, // pas d'info d'usage : acceptée
  ];
  assert.deepStrictEqual(hidPadKeys(list, hidKind), ['hid:ds', 'hid:pro']);
});

// Mode « connexion » du module de sondage partagé (src/guide.js), modules natifs simulés
function fakeWatcher(opts = {}) {
  const st = { xi: [null, null, null, null], hid: [], calls: 0, wakes: [] };
  const native = { xinputOk: true, xinputButtons: () => { st.calls++; return st.xi; } };
  const HID = { devices: () => st.hid, HID: function () { throw new Error('pas d’ouverture en test'); } };
  const w = createGuideWatcher({
    loadNative: () => native, loadHid: () => HID, onConnect: (k) => st.wakes.push(k),
    pollMs: 5, connectPollMs: 10, hidScanMs: 10, wakeCooldownMs: 200, ...opts,
  });
  return { w, st };
}

test('surveillance : manette déjà branchée au démarrage ignorée, nouvelle manette = réveil', async () => {
  const { w, st } = fakeWatcher();
  st.xi = [0, null, null, null];
  w.setConnect(true);
  await wait(40);
  assert.deepStrictEqual(st.wakes, []);
  st.xi = [0, 0, null, null];
  await wait(40);
  assert.deepStrictEqual(st.wakes, ['xi1']);
  w.setConnect(false);
});

test('surveillance : HID nouvelle apparition, anti-rebond, arrêt = plus de réveil', async () => {
  const { w, st } = fakeWatcher();
  w.setConnect(true);
  await wait(30);
  st.hid = [{ vendorId: 0x054c, productId: 0x09cc, path: 'p1', usagePage: 1, usage: 5 }];
  await wait(40);
  assert.deepStrictEqual(st.wakes, ['hid:p1']);
  st.xi = [0, null, null, null]; // la même manette vue aussi en XInput (Steam) : dans les 200 ms → ignorée
  await wait(40);
  assert.deepStrictEqual(st.wakes, ['hid:p1']);
  w.setConnect(false); // ex. un jeu démarre
  const before = st.calls;
  st.xi = [0, 0, 0, null];
  await wait(40);
  assert.strictEqual(st.calls, before); // plus aucun sondage
  assert.deepStrictEqual(st.wakes, ['hid:p1']);
  // Reprise après le jeu : l'état courant devient la référence (pas de réveil pour une manette reconnectée pendant le jeu)
  await wait(250); // au-delà de l'anti-rebond : seul l'état de référence empêche le réveil
  w.setConnect(true);
  await wait(40);
  assert.deepStrictEqual(st.wakes, ['hid:p1']);
  st.hid = [...st.hid, { vendorId: 0x054c, productId: 0x0ce6, path: 'p2', usagePage: 1, usage: 5 }];
  await wait(40);
  assert.deepStrictEqual(st.wakes, ['hid:p1', 'hid:p2']);
  w.setConnect(false);
});

test('surveillance : sondage XInput lent en mode connexion seul, rapide avec le Guide, une seule boucle', async () => {
  const { w, st } = fakeWatcher({ pollMs: 5, connectPollMs: 50 });
  w.setConnect(true);
  st.calls = 0;
  await wait(120);
  const slow = st.calls;
  assert.ok(slow <= 4, `sondages en mode connexion : ${slow}`);
  w.start(); // + mode Guide : même boucle, cadence rapide
  st.calls = 0;
  await wait(120);
  assert.ok(st.calls > slow * 2, `sondages en mode Guide : ${st.calls}`);
  assert.strictEqual(w.running, true);
  assert.strictEqual(w.connecting, true);
  w.stop();
  st.calls = 0;
  await wait(120);
  assert.ok(st.calls <= 4, `retour au mode lent : ${st.calls}`);
  w.setConnect(false);
  st.calls = 0;
  await wait(60);
  assert.strictEqual(st.calls, 0);
});

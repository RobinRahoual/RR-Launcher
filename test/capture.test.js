// Tests du module CAPTURE : combinaisons manette (src/guide.js) et utilitaires purs (src/features/capture/util.js)
// node --test test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { BTN, decodeHidReport, createComboMachine, createGuideWatcher } = require('../src/guide');
const U = require('../src/features/capture/util');

const rep = (len, set) => { const b = Buffer.alloc(len); for (const [i, v] of Object.entries(set)) b[i] = v; return b; };
const HAT0 = 0x08; // croix relâchée

// ---------------------------------------------------------------- Décodage HID
test('Sony : L1 / R1 / Share-Create / Rond dans tous les formats de rapport', () => {
  // DualShock 4 USB : boutons 2 à l'octet 6
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: HAT0, 6: 0x01 })), BTN.LB);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: HAT0, 6: 0x02 })), BTN.RB);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: HAT0, 6: 0x10 })), BTN.BACK | BTN.SHARE);
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: HAT0 | 0x40, 7: 0x01 })), BTN.B | BTN.GUIDE);
  // L2 / R2 (0x04 / 0x08) ne sont pas des gâchettes hautes
  assert.strictEqual(decodeHidReport('ds4', rep(64, { 0: 0x01, 5: HAT0, 6: 0x0c })), 0);
  // DualShock 4 Bluetooth 0x11 : +2
  assert.strictEqual(decodeHidReport('ds4', rep(78, { 0: 0x11, 7: HAT0, 8: 0x02, 9: 0x01 })), BTN.RB | BTN.GUIDE);
  // DualSense USB : boutons 2 à l'octet 9 ; BT 0x31 : octet 10 ; BT réduit : octet 6
  assert.strictEqual(decodeHidReport('dualsense', rep(64, { 0: 0x01, 8: HAT0, 9: 0x01 | 0x02 })), BTN.LB | BTN.RB);
  assert.strictEqual(decodeHidReport('dualsense', rep(64, { 0: 0x01, 8: HAT0, 9: 0x10 })), BTN.BACK | BTN.SHARE);
  assert.strictEqual(decodeHidReport('dualsense', rep(78, { 0: 0x31, 9: HAT0, 10: 0x02, 11: 0x01 })), BTN.RB | BTN.GUIDE);
  assert.strictEqual(decodeHidReport('dualsense', rep(10, { 0: 0x01, 5: HAT0, 6: 0x10 })), BTN.BACK | BTN.SHARE);
});

test('Switch Pro : L / R / Capture (0x30 et 0x3F), « − » reste BACK sans SHARE', () => {
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 3: 0x40 })), BTN.RB);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 5: 0x40 })), BTN.LB);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 4: 0x20 })), BTN.SHARE);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 4: 0x01 })), BTN.BACK);
  assert.strictEqual(decodeHidReport('switchpro', rep(64, { 0: 0x30, 3: 0x80, 5: 0x80 })), 0); // ZR / ZL ignorées
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 1: 0x10, 3: HAT0 })), BTN.LB);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 1: 0x20, 3: HAT0 })), BTN.RB);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 2: 0x20, 3: HAT0 })), BTN.SHARE);
  assert.strictEqual(decodeHidReport('switchpro', rep(12, { 0: 0x3f, 2: 0x10 | 0x20, 3: HAT0 })), BTN.GUIDE | BTN.SHARE);
});

// ---------------------------------------------------------------- Machine à états
// Rejoue une suite [instant, masque] et renvoie les évènements émis
function run(m, seq) {
  const out = [];
  for (const [t, mask] of seq) for (const e of m.feed(mask, t)) out.push([t, e]);
  return out;
}

test('Guide court : menu en jeu au relâchement, rien à l\'appui', () => {
  const m = createComboMachine();
  assert.deepStrictEqual(m.feed(BTN.GUIDE, 0), []);
  assert.strictEqual(m.holding, true);
  assert.deepStrictEqual(m.feed(BTN.GUIDE, 200), []);
  assert.deepStrictEqual(m.feed(0, 300), ['guide']);
  assert.strictEqual(m.holding, false);
});

test('Guide + RB / LB / B : combinaison seule, jamais le menu en jeu en plus', () => {
  for (const [bit, name] of [[BTN.RB, 'capture'], [BTN.LB, 'clip'], [BTN.B, 'quit']]) {
    const m = createComboMachine();
    const ev = run(m, [[0, BTN.GUIDE], [100, BTN.GUIDE | bit], [200, BTN.GUIDE | bit], [260, BTN.GUIDE], [400, 0]]);
    assert.deepStrictEqual(ev.map((x) => x[1]), [name], name);
  }
  // relâcher le Guide AVANT le bouton combiné : toujours pas de menu, pas de 2e évènement
  const m = createComboMachine();
  assert.deepStrictEqual(run(m, [[0, BTN.GUIDE], [80, BTN.GUIDE | BTN.RB], [150, BTN.RB], [300, 0]]).map((x) => x[1]), ['capture']);
});

test('Guide maintenu : deux captures pendant le même maintien, puis aucun appui long', () => {
  const m = createComboMachine({ longMs: 1000 });
  const ev = run(m, [[0, BTN.GUIDE], [100, BTN.GUIDE | BTN.RB], [250, BTN.GUIDE], [400, BTN.GUIDE | BTN.RB], [600, BTN.GUIDE], [1500, BTN.GUIDE], [1600, 0]]);
  assert.deepStrictEqual(ev.map((x) => x[1]), ['capture', 'capture']);
});

test('appui long ≥ 1 s : alimentation pendant le maintien (feed ou tick), une seule fois', () => {
  const m = createComboMachine({ longMs: 1000 });
  assert.deepStrictEqual(run(m, [[0, BTN.GUIDE], [500, BTN.GUIDE], [999, BTN.GUIDE]]), []);
  assert.deepStrictEqual(m.feed(BTN.GUIDE, 1000), ['power']);
  assert.deepStrictEqual(m.feed(BTN.GUIDE, 1300), []);
  assert.deepStrictEqual(m.feed(0, 1400), []); // relâché : pas de menu en plus
  // Sans nouveau rapport (Switch Pro 0x3F) : tick
  const n = createComboMachine({ longMs: 1000 });
  n.feed(BTN.GUIDE, 0);
  assert.deepStrictEqual(n.tick(900), []);
  assert.deepStrictEqual(n.tick(1020), ['power']);
  assert.deepStrictEqual(n.tick(1100), []);
  assert.deepStrictEqual(n.feed(0, 1500), []);
  // Ni tick ni rapport pendant le maintien : décidé au relâchement
  const o = createComboMachine({ longMs: 1000 });
  o.feed(BTN.GUIDE, 0);
  assert.deepStrictEqual(o.feed(0, 1200), ['power']);
  // Une combinaison avant 1 s annule l'appui long
  const p = createComboMachine({ longMs: 1000 });
  assert.deepStrictEqual(run(p, [[0, BTN.GUIDE], [300, BTN.GUIDE | BTN.LB], [1500, BTN.GUIDE], [1600, 0]]).map((x) => x[1]), ['clip']);
});

test('Share seul : capture ; Share pendant le maintien du Guide : ignoré', () => {
  const m = createComboMachine();
  assert.deepStrictEqual(run(m, [[0, BTN.SHARE], [100, BTN.SHARE], [200, 0]]).map((x) => x[1]), ['share']);
  const n = createComboMachine();
  assert.deepStrictEqual(run(n, [[0, BTN.GUIDE], [100, BTN.GUIDE | BTN.SHARE], [200, 0]]).map((x) => x[1]), ['guide']);
});

test('anti-rebond : rebond de contact du Guide et du RB filtrés', () => {
  const m = createComboMachine({ minGapMs: 150, guideCooldownMs: 120 });
  // Guide : appui, relâché, rebond 30 ms plus tard → un seul « guide »
  const ev = run(m, [[0, BTN.GUIDE], [100, 0], [130, BTN.GUIDE], [150, 0], [700, 0]]);
  assert.deepStrictEqual(ev.map((x) => x[1]), ['guide']);
  // RB qui oscille pendant le maintien → une seule capture
  const n = createComboMachine({ minGapMs: 150 });
  const ev2 = run(n, [[0, BTN.GUIDE], [100, BTN.GUIDE | BTN.RB], [120, BTN.GUIDE], [140, BTN.GUIDE | BTN.RB], [400, BTN.GUIDE], [500, 0]]);
  assert.deepStrictEqual(ev2.map((x) => x[1]), ['capture']);
  // nouvel appui franc après le délai : accepté
  assert.deepStrictEqual(run(m, [[1000, BTN.GUIDE], [1100, 0]]).map((x) => x[1]), ['guide']);
});

test('bouton déjà tenu avant le Guide : pas une combinaison', () => {
  const m = createComboMachine();
  assert.deepStrictEqual(run(m, [[0, BTN.RB], [100, BTN.RB | BTN.GUIDE], [200, BTN.RB], [300, 0]]).map((x) => x[1]), ['guide']);
});

// ---------------------------------------------------------------- Intégration dans la surveillance
function watcher(opts = {}) {
  const log = { guide: [], combo: [], remote: [] };
  const w = createGuideWatcher({
    loadNative: () => { throw new Error('absent'); },
    loadHid: () => { throw new Error('absent'); },
    onGuide: (s) => log.guide.push(s),
    onCombo: (n, s) => log.combo.push(n),
    onRemote: (b) => log.remote.push(b),
    longMs: 60,
    ...opts,
  });
  return { w, log };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('surveillance : combinaison pendant un jeu, menu en jeu non ouvert', async () => {
  const { w, log } = watcher({ combos: () => true });
  w.start();
  w._feed('xi0', BTN.GUIDE);
  assert.deepStrictEqual(log.guide, []); // pas encore : on attend le relâchement
  w._feed('xi0', BTN.GUIDE | BTN.RB);
  w._feed('xi0', BTN.GUIDE);
  w._feed('xi0', 0);
  assert.deepStrictEqual(log.combo, ['capture']);
  assert.deepStrictEqual(log.guide, []);
  // XInput View = Share
  w._feed('xi0', BTN.BACK);
  w._feed('xi0', 0);
  assert.deepStrictEqual(log.combo, ['capture', 'share']);
  w.stop();
});

test('surveillance : appui long par minuterie, même source dédoublonnée entre XInput et HID', async () => {
  const { w, log } = watcher({ combos: () => true });
  w.start();
  w._feed('xi0', BTN.GUIDE);
  w._feed('hid:x', BTN.GUIDE); // même manette vue deux fois (Steam / DS4Windows)
  await sleep(120);
  assert.deepStrictEqual(log.combo, ['power']);
  w._feed('xi0', 0);
  w._feed('hid:x', 0);
  assert.deepStrictEqual(log.guide, []);
  w.stop();
});

test('surveillance : combinaisons désactivées (launcher actif, pas de jeu) = comportement historique', () => {
  const { w, log } = watcher({ combos: () => false });
  w.start();
  w._feed('xi0', BTN.GUIDE);
  assert.deepStrictEqual(log.guide, ['xi0']); // tout de suite, à l'appui
  w._feed('xi0', BTN.GUIDE | BTN.RB);
  w._feed('xi0', 0);
  w._feed('xi0', BTN.BACK);
  assert.deepStrictEqual(log.combo, []);
  w.stop();
  // sans onCombo : idem (API d'origine)
  const g = [];
  const w2 = createGuideWatcher({ loadNative: () => { throw new Error('x'); }, loadHid: () => { throw new Error('x'); }, onGuide: (s) => g.push(s) });
  w2._feed('xi1', BTN.GUIDE);
  assert.deepStrictEqual(g, ['xi1']);
});

test('surveillance : relais du menu en jeu intact en mode combinaisons, mais pas pendant un maintien', () => {
  const { w, log } = watcher({ combos: () => true, wantRemote: () => true });
  w._feed('xi0', BTN.DOWN);
  w._feed('xi0', 0);
  w._feed('xi0', BTN.GUIDE);
  w._feed('xi0', BTN.GUIDE | BTN.B); // Guide + B : quitter, pas « retour » relayé
  w._feed('xi0', 0);
  assert.deepStrictEqual(log.remote, ['down']);
  assert.deepStrictEqual(log.combo, ['quit']);
  w.stop();
});

// ---------------------------------------------------------------- Utilitaires
test('noms de dossier / fichier sûrs (Windows)', () => {
  assert.strictEqual(U.safeName('Zelda: Breath of the Wild'), 'Zelda Breath of the Wild');
  assert.strictEqual(U.safeName('  a/b\\c?*<>|"  '), 'a b c');
  assert.strictEqual(U.safeName('CON'), 'CON_');
  assert.strictEqual(U.safeName('Jeu...'), 'Jeu');
  assert.strictEqual(U.safeName(''), 'Autres');
  assert.strictEqual(U.safeName('..'), 'Autres');
  assert.ok(U.safeName('x'.repeat(300)).length <= 80);
  const d = new Date(2026, 10, 13, 21, 4, 5);
  assert.strictEqual(U.fileStamp(d), '2026-11-13 21-04-05');
});

test('chemins : restreints au dossier de captures', () => {
  const root = path.join(os.tmpdir(), 'rr-cap-root');
  assert.ok(U.inside(root, path.join(root, 'Jeu', 'a.png')));
  assert.ok(!U.inside(root, path.join(root, '..', 'b.png')));
  assert.ok(!U.inside(root, root + '-x/a.png'));
  assert.strictEqual(U.resolveRel(root, 'Jeu/a.png'), path.join(root, 'Jeu', 'a.png'));
  assert.strictEqual(U.resolveRel(root, '../../etc/passwd'), null);
  assert.strictEqual(U.resolveRel(root, 'Jeu/a.exe'), null);
  assert.strictEqual(U.resolveRel(root, 'a.png'), null); // toujours <jeu>/<fichier>
  assert.strictEqual(U.resolveRel(root, 'Jeu/sous/a.png'), null);
});

test('liste des captures : PNG + WebM, plus récentes d\'abord', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cap-'));
  const mk = (f, t) => { fs.writeFileSync(path.join(dir, f), 'x'); fs.utimesSync(path.join(dir, f), t, t); };
  mk('a.png', 1000); mk('b.webm', 3000); mk('c.txt', 4000); mk('d.PNG', 2000);
  const l = U.listMedia(dir);
  assert.deepStrictEqual(l.map((x) => x.file), ['b.webm', 'd.PNG', 'a.png']);
  assert.deepStrictEqual(l.map((x) => x.kind), ['video', 'image', 'image']);
  assert.deepStrictEqual(U.listMedia(path.join(dir, 'absent')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

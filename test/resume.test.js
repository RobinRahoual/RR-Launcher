// EMU : reprise du dernier état au lancement (plan pur)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resumePlan } = require('../src/features/emu/states');

const info = { supported: true, kind: 'pcsx2', net: false, min: 0, max: 9, admin: false };
const rom = (extra = {}) => ({ kind: 'rom', lastState: { slot: 3, at: 1 }, ...extra });

test('réglage global activé + état connu → reprise, emplacement mémorisé', () => {
  const p = resumePlan(rom(), { emuResume: true }, info);
  assert.deepStrictEqual(p, { resume: true, slot: 3, delayMs: 6000, tries: 1 });
});
test('désactivé par défaut ; le jeu peut forcer on / off', () => {
  assert.strictEqual(resumePlan(rom(), {}, info).resume, false);
  assert.strictEqual(resumePlan(rom({ launch: { resume: 'on' } }), {}, info).resume, true);
  assert.strictEqual(resumePlan(rom({ launch: { resume: 'off' } }), { emuResume: true }, info).resume, false);
});
test('rien à reprendre sans sauvegarde faite via le launcher', () => {
  const r = resumePlan({ kind: 'rom' }, { emuResume: true }, info);
  assert.deepStrictEqual([r.resume, r.reason], [false, 'no-state']);
});
test('émulateur non géré, jeu PC, admin sans réseau : pas de reprise', () => {
  assert.strictEqual(resumePlan(rom(), { emuResume: true }, { supported: false }).resume, false);
  assert.strictEqual(resumePlan({ kind: 'exe' }, { emuResume: true }, info).resume, false);
  assert.strictEqual(resumePlan(rom(), { emuResume: true }, { ...info, admin: true }).reason, 'admin');
  assert.strictEqual(resumePlan(rom(), { emuResume: true }, { ...info, admin: true, net: true, kind: 'retroarch' }).resume, true);
});
test('emplacement borné, délai borné, RetroArch réessaie', () => {
  const p = resumePlan(rom({ lastState: { slot: 99 } }), { emuResume: true, emuResumeDelay: 100 }, { ...info, kind: 'retroarch', net: true });
  assert.deepStrictEqual(p, { resume: true, slot: 9, delayMs: 30000, tries: 8 });
});

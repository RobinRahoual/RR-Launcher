// KIOSK : décision du mode Kiosque / TV (pure)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decide, normMode } = require('../src/features/kiosk');

test('auto : une manette active le kiosque et force le plein écran', () => {
  const r = decide({ mode: 'auto', pads: 1, active: false, fullscreen: false });
  assert.deepStrictEqual(r, { active: true, setFullscreen: true, forcedFullscreen: true });
});
test('auto : déjà en plein écran, rien à changer et rien à rétablir ensuite', () => {
  const on = decide({ mode: 'auto', pads: 2, active: false, fullscreen: true });
  assert.deepStrictEqual(on, { active: true, setFullscreen: null, forcedFullscreen: false });
  const off = decide({ mode: 'auto', pads: 0, active: true, forcedFullscreen: false, fullscreen: true });
  assert.deepStrictEqual(off, { active: false, setFullscreen: null, forcedFullscreen: false });
});
test('auto : manette débranchée, le fenêtré d’origine est rétabli', () => {
  const off = decide({ mode: 'auto', pads: 0, active: true, forcedFullscreen: true, fullscreen: true });
  assert.deepStrictEqual(off, { active: false, setFullscreen: false, forcedFullscreen: false });
});
test('toujours / jamais, indépendamment des manettes', () => {
  assert.strictEqual(decide({ mode: 'on', pads: 0 }).active, true);
  assert.strictEqual(decide({ mode: 'off', pads: 3, active: true, forcedFullscreen: true }).active, false);
  assert.strictEqual(decide({ mode: 'off', pads: 3 }).active, false);
});
test('état stable : aucun changement de fenêtre', () => {
  assert.strictEqual(decide({ mode: 'auto', pads: 1, active: true, forcedFullscreen: true, fullscreen: true }).setFullscreen, null);
  assert.strictEqual(decide({ mode: 'auto', pads: 0, active: false }).setFullscreen, null);
});
test('mode invalide → auto', () => { assert.strictEqual(normMode('xx'), 'auto'); });

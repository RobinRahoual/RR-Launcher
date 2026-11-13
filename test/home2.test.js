'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { accentFor, contrast, parse, BLUE } = require('../src/renderer/features/home2-color.js');

const WHITE = [255, 255, 255], DARK_BG = [16, 16, 16];
const sample = ['#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffd400', '#102a43', '#f5e6a8', '#8b0000', '#2ecc71', '#e67e22', '#9b59b6', '#050510'];

test('accent : toujours ≥ 3:1 avec le fond et le texte blanc, dans les deux thèmes', () => {
  for (const c of sample) for (const theme of ['light', 'dark']) {
    const out = accentFor(c, theme);
    const rgb = parse(out);
    assert.ok(rgb, `${c} → ${out}`);
    assert.ok(contrast(rgb, WHITE) >= 3, `${c}/${theme} texte blanc : ${contrast(rgb, WHITE).toFixed(2)}`);
    assert.ok(contrast(rgb, theme === 'dark' ? DARK_BG : WHITE) >= 3, `${c}/${theme} fond`);
  }
});
test('accent : couleur absente, invalide ou grise → bleu de la charte', () => {
  for (const c of [null, undefined, '', 'rouge', '#808080', '#fafafa', '#101010']) assert.strictEqual(accentFor(c, 'dark'), BLUE, String(c));
});
test('accent : une couleur déjà valable est conservée', () => {
  assert.strictEqual(accentFor('#3C91E6', 'dark'), '#3C91E6');
  assert.strictEqual(accentFor('#3C91E6', 'light'), '#3C91E6');
});
test('accent : la teinte est conservée quand la luminosité est corrigée', () => {
  const out = parse(accentFor('#ffdd00', 'light'));
  assert.ok(out[0] > out[2] && out[1] > out[2]); // reste jaune/ocre
});

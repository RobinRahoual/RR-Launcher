'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { prettify, similarity, best } = require('../src/names');
const { platformForFile, folderHint } = require('../src/platforms');
const { BTN, toNav, hidExtras } = require('../src/guide');

test('noms collés : CamelCase et numéro en fin de mot', () => {
  assert.strictEqual(prettify('RedDeadRedemption2'), 'Red Dead Redemption 2');
  assert.strictEqual(prettify('Battlefield2042'), 'Battlefield 2042');
  assert.strictEqual(prettify('Hollow_Knight'), 'Hollow Knight');
  assert.strictEqual(prettify('DX12'), 'DX12');
  assert.strictEqual(prettify('Pokémon Émeraude'), 'Pokémon Émeraude');
});

test('similarité : même jeu malgré l’écriture, autre épisode écarté', () => {
  assert.strictEqual(similarity('RedDeadRedemption2', 'Red Dead Redemption 2'), 1);
  assert.strictEqual(similarity('Final Fantasy VII', 'Final Fantasy 7'), 1);
  assert.ok(similarity('Red Dead Redemption 2', 'Red Dead Redemption') < 0.6);
  assert.ok(similarity('Pokémon Emerald', 'Pokemon - Emerald Version (USA, Europe)') >= 0.95);
  assert.ok(similarity('Pokémon Emerald', 'Pokemon - Ruby Version (USA, Europe)') < 0.6);
  const b = best([{ name: 'Pokemon Ruby' }, { name: 'Pokemon Emerald' }], ['Pokémon Émeraude', 'Pokémon Emerald']);
  assert.strictEqual(b.item.name, 'Pokemon Emerald');
});

test('Switch 2 : même format que la Switch, rangée d’après le dossier', () => {
  assert.strictEqual(platformForFile('D:/Roms/Switch/Zelda.nsp'), 'switch');
  assert.strictEqual(platformForFile('D:/Roms/Switch 2/Mario Kart World.xci'), 'switch2');
  assert.strictEqual(platformForFile('D:/Jeux/NS2/DK.nsp'), 'switch2');
  assert.strictEqual(folderHint('D:/Roms/Switch2/x.nsp'), 'switch2');
  assert.strictEqual(folderHint('D:/Roms/Switch/x.nsp'), 'switch');
});

test('navigation native : stick → croix, sans Guide ni Share', () => {
  assert.strictEqual(toNav(BTN.SUP | BTN.A | BTN.GUIDE), BTN.UP | BTN.A);
  assert.strictEqual(toNav(BTN.LT | BTN.SHARE), BTN.LT);
  // DualSense USB : stick centré = rien ; poussé à gauche = SLEFT ; R2
  const ds = Buffer.alloc(64); ds[0] = 0x01; ds[1] = 128; ds[2] = 128; ds[8] = 0x08;
  assert.strictEqual(hidExtras('dualsense', ds), 0);
  ds[1] = 0; ds[9] = 0x08;
  assert.strictEqual(hidExtras('dualsense', ds), BTN.SLEFT | BTN.RT);
  // Switch Pro 0x30 : stick 12 bits centré, puis vers le haut
  const sp = Buffer.alloc(49); sp[0] = 0x30;
  const put = (x, y) => { sp[6] = x & 0xff; sp[7] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4); sp[8] = y >> 4; };
  put(2048, 2048);
  assert.strictEqual(hidExtras('switchpro', sp), 0);
  put(2048, 3600);
  assert.strictEqual(hidExtras('switchpro', sp), BTN.SUP);
});

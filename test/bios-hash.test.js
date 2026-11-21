// EMU : vérification des BIOS par empreinte MD5 (présent ≠ conforme)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bios = require('../src/features/emu/bios');
const { BIOS_MD5 } = require('../src/features/emu/catalog');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-bh-'));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

test('table : empreintes MD5 bien formées, noms en minuscules', () => {
  for (const [name, list] of Object.entries(BIOS_MD5)) {
    assert.strictEqual(name, name.toLowerCase());
    for (const h of list) assert.match(h, /^[0-9a-f]{32}$/, name);
  }
});

test('verify : conforme, différent, sans référence', () => {
  const d = tmp();
  const f = path.join(d, 'scph5501.bin');
  fs.writeFileSync(f, Buffer.alloc(524288, 7));
  const r = bios.verify(f, 524288);
  assert.strictEqual(r.verified, false);                      // contenu quelconque ≠ BIOS Sony
  assert.strictEqual(r.hash, md5(Buffer.alloc(524288, 7)));
  fs.writeFileSync(path.join(d, 'inconnu.bin'), 'x');
  assert.strictEqual(bios.verify(path.join(d, 'inconnu.bin'), 1).verified, null);
  // Référence temporaire : on simule un BIOS conforme
  const fake = path.join(d, 'gba_bios.bin');
  const data = Buffer.alloc(16384, 1);
  fs.writeFileSync(fake, data);
  BIOS_MD5['gba_bios.bin'].push(md5(data));
  try { assert.strictEqual(bios.verify(fake, 16384).verified, true); } finally { BIOS_MD5['gba_bios.bin'].pop(); }
});

test('check : BIOS présent mais non conforme → ok:true, verified:false, avertissement', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'system'));
  fs.writeFileSync(path.join(d, 'system', 'scph5501.bin'), Buffer.alloc(524288, 9));
  const exe = path.join(d, 'retroarch.exe');
  const r = bios.check('ps1', { path: exe })[0];
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, false);
  assert.match(r.warn, /empreinte MD5/);
});

test('check : fichier sans référence connue → verified:null, pas d’avertissement', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'bios'));
  fs.writeFileSync(path.join(d, 'bios', 'perso.bin'), Buffer.alloc(524288, 2));
  fs.writeFileSync(path.join(d, 'portable.txt'), '');
  const r = bios.check('ps1', { path: path.join(d, 'duckstation-qt-x64-ReleaseLTCG.exe') })[0];
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, null);
  assert.strictEqual(r.warn, null);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { patchLatest } = require('../build/finalize-release');
test('patchLatest remplace sha512 et taille', () => {
  const y = "version: 1.19.0\nfiles:\n  - url: RR-Launcher-Setup-1.19.0.exe\n    sha512: OLD==\n    size: 10\n    blockMapSize: 5\npath: RR-Launcher-Setup-1.19.0.exe\nsha512: OLD==\nreleaseDate: '2026'\n";
  const o = patchLatest(y, 'x.exe', 'NEW==', 99);
  assert.ok(!o.includes('OLD'));
  assert.match(o, /sha512: NEW==\n    size: 99\n/);
  assert.match(o, /^sha512: NEW==$/m);
});

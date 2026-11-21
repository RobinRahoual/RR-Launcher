// MODS : patchs IPS / BPS / UPS, mods de fichiers réversibles, ROM patchée
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/features/mods/patch');
const C = require('../src/features/mods/core');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-mod-'));
const be = (n, len) => { const b = Buffer.alloc(len); b.writeUIntBE(n, 0, len); return b; };
const vint = (n) => { const o = []; for (;;) { const x = n & 0x7f; n = Math.floor(n / 128); if (n === 0) { o.push(0x80 | x); break; } o.push(x); n--; } return Buffer.from(o); };
const withCrc = (body, src, tgt) => { const a = Buffer.alloc(8); a.writeUInt32LE(P.crc32(src), 0); a.writeUInt32LE(P.crc32(tgt), 4); const pre = Buffer.concat([body, a]); const c = Buffer.alloc(4); c.writeUInt32LE(P.crc32(pre)); return Buffer.concat([pre, c]); };

const ROM = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff));

test('CRC32 : valeur de référence', () => { assert.strictEqual(P.crc32(Buffer.from('123456789')), 0xcbf43926); });

test('IPS : enregistrement, RLE, extension de la ROM, troncature', () => {
  const patch = Buffer.concat([Buffer.from('PATCH'), be(2, 3), be(3, 2), Buffer.from([1, 2, 3]),
    be(10, 3), be(0, 2), be(4, 2), Buffer.from([0xff]),
    be(70, 3), be(2, 2), Buffer.from([9, 9]), Buffer.from('EOF')]);
  const out = P.applyIps(ROM, patch);
  assert.strictEqual(out.length, 72);
  assert.deepStrictEqual([...out.subarray(2, 5)], [1, 2, 3]);
  assert.deepStrictEqual([...out.subarray(10, 14)], [255, 255, 255, 255]);
  assert.deepStrictEqual([...out.subarray(70, 72)], [9, 9]);
  assert.strictEqual(out[64], 0); // zone créée par l'extension
  assert.strictEqual(out[0], ROM[0]); // le reste est intact
  assert.strictEqual(ROM[2], (2 * 7 + 3) & 0xff); // l'original n'est pas modifié
  const trunc = P.applyIps(ROM, Buffer.concat([Buffer.from('PATCH'), Buffer.from('EOF'), be(32, 3)]));
  assert.strictEqual(trunc.length, 32);
  assert.throws(() => P.applyIps(ROM, Buffer.from('PATCH\x00\x00')), /tronqué/);
  assert.throws(() => P.applyIps(ROM, Buffer.from('nope')), /IPS/);
});

// BPS : cible = ROM[0..16) + « HELLO » + copie source (offset 32, 8 octets) + copie cible (6 octets depuis le début de « HELLO »)
test('BPS : SourceRead, TargetRead, SourceCopy, TargetCopy, CRC32', () => {
  const hello = Buffer.from('HELLO');
  const parts = [ROM.subarray(0, 16), hello, ROM.subarray(32, 40)];
  const tgtHead = Buffer.concat(parts);
  const copy = Buffer.alloc(6); // TargetCopy chevauchant : depuis l'offset 16, 6 octets (« HELLO » puis le 1er octet recopié)
  for (let i = 0; i < 6; i++) copy[i] = i < 5 ? hello[i] : hello[0];
  // la cible vue par l'algorithme : octets copiés un par un depuis out[16..] (HELLO + 1er octet de la copie source à l'offset 21)
  const tgt = Buffer.concat([tgtHead, Buffer.alloc(6)]);
  for (let i = 0; i < 6; i++) tgt[tgtHead.length + i] = tgt[16 + i];
  const actions = Buffer.concat([
    vint(((16 - 1) << 2) | 0),                                   // SourceRead 16
    vint(((5 - 1) << 2) | 1), hello,                              // TargetRead « HELLO »
    vint(((8 - 1) << 2) | 2), vint((32 << 1) | 0),                // SourceCopy 8 depuis +32
    vint(((6 - 1) << 2) | 3), vint((16 << 1) | 0),                // TargetCopy 6 depuis +16
  ]);
  const body = Buffer.concat([Buffer.from('BPS1'), vint(ROM.length), vint(tgt.length), vint(0), actions]);
  const patch = withCrc(body, ROM, tgt);
  assert.strictEqual(P.kind(patch), 'bps');
  assert.deepStrictEqual(P.applyBps(ROM, patch), tgt);
  // mauvaise ROM, patch corrompu
  const other = Buffer.from(ROM); other[0] ^= 1;
  assert.throws(() => P.applyBps(other, patch), /ne correspond pas/);
  const bad = Buffer.from(patch); bad[10] ^= 0xff;
  assert.throws(() => P.applyBps(ROM, bad), /corrompu/);
});

test('UPS : XOR par blocs, CRC32, ROM déjà patchée refusée', () => {
  const tgt = Buffer.from(ROM); tgt[5] ^= 0x55; tgt[6] ^= 0x01; tgt[40] ^= 0xaa;
  const body2 = Buffer.concat([Buffer.from('UPS1'), vint(ROM.length), vint(tgt.length), vint(5), Buffer.from([0x55, 0x01, 0x00]), vint(32), Buffer.from([0xaa, 0x00])]);
  const patch = withCrc(body2, ROM, tgt);
  assert.deepStrictEqual(P.applyUps(ROM, patch), tgt);
  assert.throws(() => P.applyUps(tgt, patch), /déjà patchée/);
});

test('apply : format inconnu', () => { assert.throws(() => P.apply(ROM, Buffer.from('xxxxxxxx')), /non reconnu/); });

// ---------------------------------------------------------------- Mods de fichiers
function setup() {
  const root = tmp();
  const install = path.join(root, 'jeu'), gameDir = path.join(root, 'mods');
  fs.mkdirSync(path.join(install, 'data'), { recursive: true });
  fs.writeFileSync(path.join(install, 'data', 'a.txt'), 'ORIGINAL-A');
  fs.writeFileSync(path.join(install, 'b.txt'), 'ORIGINAL-B');
  const mod = (id, files) => { for (const [rel, txt] of Object.entries(files)) { const f = path.join(gameDir, id, 'files', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); } return { id, files: Object.keys(files), enabled: true }; };
  return { install, gameDir, mod };
}
const rd = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('mods de fichiers : activer sauvegarde l’original, désactiver le restaure', () => {
  const { install, gameDir, mod } = setup();
  const m1 = mod('m1', { 'data/a.txt': 'MOD1-A', 'nouveau.txt': 'NEW' });
  let r = C.syncFiles({ installDir: install, gameDir, mods: [m1], state: null });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(rd(install, 'data', 'a.txt'), 'MOD1-A');
  assert.strictEqual(rd(install, 'nouveau.txt'), 'NEW');
  assert.deepStrictEqual(r.state.backed, ['data/a.txt']);
  r = C.syncFiles({ installDir: install, gameDir, mods: [{ ...m1, enabled: false }], state: r.state });
  assert.strictEqual(rd(install, 'data', 'a.txt'), 'ORIGINAL-A');
  assert.strictEqual(fs.existsSync(path.join(install, 'nouveau.txt')), false); // ajouté par le mod : supprimé
  assert.deepStrictEqual(r.state, { installed: {}, backed: [] });
});

test('mods de fichiers : conflit entre deux mods, le dernier gagne, l’original revient à la fin', () => {
  const { install, gameDir, mod } = setup();
  const m1 = mod('m1', { 'b.txt': 'M1' });
  const m2 = mod('m2', { 'b.txt': 'M2' });
  let r = C.syncFiles({ installDir: install, gameDir, mods: [m1, m2], state: null });
  assert.strictEqual(rd(install, 'b.txt'), 'M2');
  r = C.syncFiles({ installDir: install, gameDir, mods: [m1, { ...m2, enabled: false }], state: r.state }); // m2 retiré : m1 reprend la main
  assert.strictEqual(rd(install, 'b.txt'), 'M1');
  r = C.syncFiles({ installDir: install, gameDir, mods: [{ ...m1, enabled: false }, { ...m2, enabled: false }], state: r.state });
  assert.strictEqual(rd(install, 'b.txt'), 'ORIGINAL-B');
});

test('mods de fichiers : chemins dangereux refusés', () => {
  assert.strictEqual(C.safeRel('../evil.dll'), null);
  assert.strictEqual(C.safeRel('C:\\Windows\\x.dll'), null);
  assert.strictEqual(C.safeRel('/etc/passwd'), null);
  assert.strictEqual(C.safeRel('a\\b\\c.txt'), 'a/b/c.txt');
  const { install, gameDir } = setup();
  const r = C.syncFiles({ installDir: install, gameDir, mods: [{ id: 'x', enabled: true, files: ['../dehors.txt'] }], state: null });
  assert.deepStrictEqual(r.state.installed, {});
  assert.strictEqual(fs.existsSync(path.join(install, '..', 'dehors.txt')), false);
});

test('listFiles / flattenSingleRoot', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'MonMod', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(d, 'MonMod', 'sub', 'x.bin'), '1');
  fs.writeFileSync(path.join(d, 'MonMod', 'y.bin'), '2');
  C.flattenSingleRoot(d);
  assert.deepStrictEqual(C.listFiles(d), ['sub/x.bin', 'y.bin']);
});

// ---------------------------------------------------------------- ROM patchée
test('ROM patchée : copie nommée de façon stable, cache par empreinte, original intact', () => {
  const d = tmp();
  const rom = path.join(d, 'Jeu.gba'); fs.writeFileSync(rom, ROM);
  const ips = path.join(d, 'p.ips'); fs.writeFileSync(ips, Buffer.concat([Buffer.from('PATCH'), be(0, 3), be(2, 2), Buffer.from([0xde, 0xad]), Buffer.from('EOF')]));
  const out = path.join(d, 'out');
  let r = C.buildPatched({ romPath: rom, patches: [{ id: 'p', file: ips }], outDir: out });
  assert.strictEqual(path.basename(r.path), 'Jeu (patché).gba');
  assert.strictEqual(r.rebuilt, true);
  assert.deepStrictEqual([...fs.readFileSync(r.path).subarray(0, 2)], [0xde, 0xad]);
  assert.deepStrictEqual(fs.readFileSync(rom), ROM);
  assert.strictEqual(C.buildPatched({ romPath: rom, patches: [{ id: 'p', file: ips }], outDir: out }).rebuilt, false);
  fs.appendFileSync(ips, Buffer.alloc(0)); fs.utimesSync(ips, new Date(), new Date(Date.now() + 5000));
  assert.strictEqual(C.buildPatched({ romPath: rom, patches: [{ id: 'p', file: ips }], outDir: out }).rebuilt, true);
  assert.deepStrictEqual(C.buildPatched({ romPath: rom, patches: [], outDir: out }), { path: rom, rebuilt: false });
  fs.writeFileSync(ips, 'pas un patch');
  assert.throws(() => C.buildPatched({ romPath: rom, patches: [{ id: 'p', file: ips }], outDir: out }), /p\.ips/);
});

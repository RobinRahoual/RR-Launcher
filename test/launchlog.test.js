// LAUNCHLOG : écriture, rotation, fusion des évènements, rapport
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const LL = require('../src/features/launchlog');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-ll-'));

test('fold : fusionne lancement, note, sortie ; la plus récente d’abord', () => {
  const recs = [
    { n: 1, t: 1000, ev: 'launch', info: { id: 'a', name: 'Zelda', file: 'C:\\emu\\dolphin.exe', args: ['-b', 'C:\\roms\\z z.iso'], via: 'émulateur' } },
    { n: 1, t: 1500, ev: 'note', note: 'repli' },
    { n: 1, t: 61000, ev: 'exit', code: 0, signal: null, seconds: 60 },
    { n: 2, t: 2000, ev: 'launch', info: { id: 'b', name: 'Sonic', file: 'sonic.exe', args: [] } },
    { n: 2, t: 2100, ev: 'error', error: 'Fichier introuvable' },
  ];
  const f = LL.fold(recs);
  assert.deepStrictEqual(f.map((e) => e.n), [2, 1]);
  assert.strictEqual(f[1].name, 'Zelda');
  assert.deepStrictEqual(f[1].notes, ['repli']);
  assert.strictEqual(LL.statusOf(f[0]), 'error');
  assert.strictEqual(LL.statusOf(f[1]), 'ok');
  assert.strictEqual(LL.commandLine(f[1]), 'C:\\emu\\dolphin.exe -b "C:\\roms\\z z.iso"');
});

test('statut : crash = signal, ou code ≠ 0 en moins de 20 s', () => {
  assert.strictEqual(LL.statusOf({ exit: { code: 1, signal: null }, seconds: 3 }), 'crash');
  assert.strictEqual(LL.statusOf({ exit: { code: 1, signal: null }, seconds: 3600 }), 'ok');
  assert.strictEqual(LL.statusOf({ exit: { code: null, signal: 'SIGSEGV' }, seconds: 900 }), 'crash');
  assert.strictEqual(LL.statusOf({}), 'running');
});

test('append : rotation au-delà de la taille max, lignes entières', () => {
  const f = path.join(tmp(), 'j.jsonl');
  for (let i = 1; i <= 200; i++) LL.append(f, { n: i, t: i, ev: 'launch', info: { id: 'x', file: 'a'.repeat(50) } }, { maxBytes: 4000 });
  const recs = LL.readRecords(f);
  assert.ok(recs.length < 200 && recs.length > 20);
  assert.strictEqual(recs[recs.length - 1].n, 200);
  assert.ok(fs.statSync(f).size <= 4000 + 400);
});

test('readRecords : ignore une ligne tronquée', () => {
  const f = path.join(tmp(), 'j.jsonl');
  fs.writeFileSync(f, '{"n":1,"t":1,"ev":"error","error":"x"}\n{"n":2,"t');
  assert.strictEqual(LL.readRecords(f).length, 1);
});

test('module : enregistre commande, variables (noms seuls) et sortie via le hub', async () => {
  const DATA = tmp();
  const hub = new EventEmitter();
  const handlers = {};
  LL.init({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, hub, findGame: (id) => ({ id, name: 'Jeu', platform: 'ps2' }), DATA, log() {}, getWin: () => null });
  hub.emit('launch:cmd', 'g1', { via: 'émulateur', file: 'pcsx2.exe', args: ['-fullscreen', 'x.iso'], cwd: 'C:\\p', env: ['SDL_VIDEODRIVER'] });
  hub.emit('launch:exit', 'g1', { code: 3, signal: null });
  hub.emit('launch:error', 'g2', 'ROM introuvable');
  const list = await handlers['x:launchlog:list'](null, 10);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[1].status, 'crash');
  assert.deepStrictEqual(list[1].env, ['SDL_VIDEODRIVER']);
  assert.strictEqual(list[0].status, 'error');
  assert.match(LL.report(list, { version: '1.19.0' }), /variables : SDL_VIDEODRIVER/);
  await handlers['x:launchlog:clear']();
  assert.strictEqual((await handlers['x:launchlog:list']()).length, 0);
});

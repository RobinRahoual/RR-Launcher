// RECOMP : catalogue, choix de l'archive Windows, en-têtes N64 (3 ordres d'octets) et GameCube, vérification de la
// copie du joueur, puis installation de bout en bout (faux GitHub + faux catalogue distant, archive 7z réelle) :
// ROM copiée au bon endroit, jeu ajouté sous sa console, mise à jour qui garde les fichiers, désinstallation.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-recomp-'));
const R = require('../src/features/recomp/core');

// En-tête N64 grand-boutiste (.z64) : magic, titre à 0x20, code à 0x3B
function z64(title, code, size = 0x1000) {
  const b = Buffer.alloc(size);
  b.writeUInt32BE(0x80371240, 0);
  b.write(title.padEnd(20, ' '), 0x20, 'ascii');
  b.write(code, 0x3b, 'ascii');
  return b;
}
const v64 = (b) => { const o = Buffer.from(b); for (let i = 0; i < o.length; i += 2) { const t = o[i]; o[i] = o[i + 1]; o[i + 1] = t; } return o; };
const n64 = (b) => { const o = Buffer.from(b); for (let i = 0; i < o.length; i += 4) o.subarray(i, i + 4).reverse(); return o; };

test('catalogue embarqué : entrées valides, identifiants uniques, règles de ROM cohérentes', () => {
  const list = R.merge(null);
  assert.strictEqual(list.length, R.BUNDLED.recomps.length, 'aucune entrée embarquée rejetée');
  assert.strictEqual(new Set(list.map((e) => e.id)).size, list.length);
  const { BY_ID } = require('../src/platforms');
  for (const e of list) {
    assert.ok(BY_ID[e.platform], `${e.id} : console ${e.platform}`);
    if (e.rom.codes) new RegExp(e.rom.codes);
  }
});

test('catalogue RecompLauncher : consoles, dépôts GitHub, manifeste, fusion avec les entrées embarquées', () => {
  const remote = {
    origins: [{ id: 'n64', name: 'Nintendo 64' }, { id: 'x360', name: 'Xbox 360' }, { id: 'ps4', name: 'PlayStation 4' }, { id: 'gamecube', name: 'GameCube' }],
    apps: [
      { id: 'donkey-kong-64-recompiled', name: 'Donkey Kong 64: Recompiled', game: 'Donkey Kong 64', origin: 'n64', repo: 'Rainchus/Donkey-Kong-64-Recompiled', cover: '/media/dk64.jpg', systems: ['windows', 'linux'] },
      { id: 'skate3', name: 'Skate 3 Recomp', game: 'Skate 3', origin: 'x360', repo: 'https://github.com/someone/skate3-recomp', systems: ['windows'],
        boot: { format: 1, game: { kind: 'iso', label: 'Ton image .iso de Skate 3' }, start: { program: ['bin/skate.exe'], args: ['--iso', '{game}'] } } },
      { id: 'bloodborne', name: 'Bloodborne PC', game: 'Bloodborne', origin: 'ps4', repo: 'x/bb', systems: ['linux'] },
      { id: 'soon-thing', name: 'Soon', game: 'Soon', origin: 'gamecube', soon: true, systems: ['windows'] },
      { id: 'gitlab', name: 'Ailleurs', origin: 'n64', repo: 'https://gitlab.com/a/b' },
      { id: '../evil', name: 'X' },
    ],
  };
  const m = R.merge(remote);
  const dk = m.find((e) => e.id === 'donkey-kong-64-recompiled');
  assert.strictEqual(dk.cover, 'https://recomplauncher.com/media/dk64.jpg');
  assert.strictEqual(dk.rom.codes, '^NDOE$', 'règle ROM embarquée reprise par dépôt');
  assert.ok(!m.find((e) => e.id === 'dk64recomp'), 'pas de doublon embarqué');
  const sk = m.find((e) => e.id === 'skate3');
  assert.deepStrictEqual([sk.platform, sk.repo, sk.rom.place, sk.rom.system], ['x360', 'someone/skate3-recomp', 'arg', 'iso']);
  const bb = m.find((e) => e.id === 'bloodborne');
  assert.deepStrictEqual([bb.platform, bb.originName, bb.windows], [null, 'PlayStation 4', false]);
  assert.strictEqual(m.find((e) => e.id === 'soon-thing').platform, 'gc');
  assert.strictEqual(m.find((e) => e.id === 'gitlab').repo, null, 'dépôt non GitHub : non installable');
  assert.ok(!m.find((e) => e.id.includes('evil')));
  assert.ok(m.find((e) => e.id === 'zelda64recomp'), 'entrée embarquée absente du distant gardée');
  // Lancement d'après le manifeste
  const d = tmp();
  fs.mkdirSync(path.join(d, 'bin'));
  fs.writeFileSync(path.join(d, 'bin', 'skate.exe'), 'x');
  const st = R.startFrom({ start: { program: ['missing.exe', 'bin/skate.exe'], args: ['--iso', '{game}', '--data', '{install}/data'], env: { SK_DIR: '{documents}/Skate', PATH: 'no' } } }, d, { game: 'D:\\Jeux\\Skate 3.iso', documents: 'C:\\Docs' });
  assert.strictEqual(st.exe, path.join(d, 'bin', 'skate.exe'));
  assert.deepStrictEqual(st.args, ['--iso', 'D:\\Jeux\\Skate 3.iso', '--data', `${d}/data`]);
  assert.deepStrictEqual(st.env, ['SK_DIR=C:\\Docs/Skate']);
  assert.strictEqual(R.joinArgs(['--iso', 'D:\\a b.iso']), '--iso "D:\\a b.iso"');
});

test('archive Windows : écarte Linux / macOS / sources / symboles', () => {
  const pick = (names) => R.pickAsset({ assets: names.map((name) => ({ name })) })?.name || null;
  assert.strictEqual(pick(['Zelda64Recompiled-v1.2.2-Linux-X64.AppImage', 'Zelda64Recompiled-v1.2.2-Windows.zip', 'Zelda64Recompiled-v1.2.2-macOS.zip']), 'Zelda64Recompiled-v1.2.2-Windows.zip');
  assert.strictEqual(pick(['SoH-Ackbar-Win64.zip', 'SoH-Ackbar-Linux-Performance.zip', 'SoH-Ackbar-Mac.zip']), 'SoH-Ackbar-Win64.zip');
  assert.strictEqual(pick(['pd-i686-windows.zip', 'pd-x86_64-windows.zip', 'pd-x86_64-linux.tar.gz']), 'pd-x86_64-windows.zip');
  assert.strictEqual(pick(['UnleashedRecomp-Windows.zip', 'UnleashedRecomp-Flatpak.zip']), 'UnleashedRecomp-Windows.zip');
  assert.strictEqual(pick(['Fritchii-v5.8.4-Windows-x64.zip', 'Fritchii-v5.8.4-debug-symbols-not-needed-to-play.zip']), 'Fritchii-v5.8.4-Windows-x64.zip');
  assert.strictEqual(pick(['source.zip', 'game-linux.zip']), null);
});

test('en-tête N64 : .z64, .v64 et .n64 donnent le même code', () => {
  const b = z64("ZELDA MAJORA'S MASK", 'NZSE');
  for (const [buf, order] of [[b, 'z64'], [v64(b), 'v64'], [n64(b), 'n64']]) {
    const h = R.n64Header(buf);
    assert.strictEqual(h.order, order);
    assert.strictEqual(h.code, 'NZSE');
    assert.strictEqual(h.title, "ZELDA MAJORA'S MASK");
    assert.strictEqual(h.region, 'USA');
  }
  assert.strictEqual(R.n64Header(Buffer.from('pas une rom du tout, vraiment pas'.repeat(3))), null);
});

test('vérification de la copie : bon jeu, autre région (avertissement), mauvais jeu, autre format', async () => {
  const d = tmp();
  const rule = R.BUNDLED.recomps.find((e) => e.id === 'zelda64recomp').rom;
  const w = (n, b) => { const p = path.join(d, n); fs.writeFileSync(p, b); return p; };
  const ok = await R.checkRom(w('mm.z64', z64("ZELDA MAJORA'S MASK", 'NZSE')), rule);
  assert.ok(ok.ok && !ok.warn, JSON.stringify(ok));
  const eu = await R.checkRom(w('mm-eu.v64', v64(z64("ZELDA MAJORA'S MASK", 'NZSP'))), rule);
  assert.ok(eu.ok && /Europe/.test(eu.warn));
  const bad = await R.checkRom(w('mk.z64', z64('MARIOKART64', 'NKTE')), rule);
  assert.ok(!bad.ok && /bon jeu/.test(bad.error));
  const junk = await R.checkRom(w('x.z64', Buffer.alloc(200)), rule);
  assert.ok(!junk.ok && /Nintendo 64/.test(junk.error));
  // Ocarina of Time : plusieurs régions acceptées
  const oot = R.BUNDLED.recomps.find((e) => e.id === 'shipwright').rom;
  assert.ok((await R.checkRom(w('oot.z64', z64('THE LEGEND OF ZELDA', 'NZLP')), oot)).ok);
  // GameCube
  const gc = Buffer.alloc(0x100); gc.write('GZ2E01', 0, 'ascii'); gc.writeUInt32BE(0xc2339f3d, 0x1c); gc.write('Twilight Princess', 0x20, 'ascii');
  const tp = R.BUNDLED.recomps.find((e) => e.id === 'dusklight').rom;
  assert.ok((await R.checkRom(w('tp.iso', gc), tp)).ok);
  assert.ok((await R.checkRom(w('tp.rvz', Buffer.alloc(0x100)), tp)).warn);
  assert.ok(!(await R.checkRom(w('tp2.iso', Buffer.alloc(0x100)), tp)).ok);
});

test('exécutable principal et racine d’archive', () => {
  const d = tmp();
  const top = path.join(d, 'Zelda64Recompiled-v1.2.2');
  fs.mkdirSync(path.join(top, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(top, 'Zelda64Recompiled.exe'), Buffer.alloc(5000));
  fs.writeFileSync(path.join(top, 'vc_redist.x64.exe'), Buffer.alloc(9000));
  fs.writeFileSync(path.join(top, 'tools', 'big.exe'), Buffer.alloc(90000));
  assert.strictEqual(R.contentRoot(d), top);
  assert.strictEqual(R.findExe(top), path.join(top, 'Zelda64Recompiled.exe'));
  assert.strictEqual(R.findExe(top, '^big\\.exe$'), path.join(top, 'tools', 'big.exe'));
});

// ---- Bout en bout : init(ctx) avec un faux ipcMain
async function make7z(srcDir, out, files) {
  const SevenZip = require('7z-wasm');
  const sz = await SevenZip({ print() {}, printErr() {} });
  sz.FS.mkdir('/w'); sz.FS.mount(sz.NODEFS, { root: srcDir }, '/w');
  sz.FS.chdir('/w');
  assert.strictEqual(sz.callMain(['a', out, ...files, '-y']), 0);
}
test('installation : catalogue distant, ROM copiée, jeu ajouté, mise à jour, désinstallation', async () => {
  const work = tmp();
  fs.mkdirSync(path.join(work, 'SpaghettiKart'));
  fs.writeFileSync(path.join(work, 'SpaghettiKart', 'Spaghettify.exe'), Buffer.alloc(4000));
  fs.writeFileSync(path.join(work, 'SpaghettiKart', 'config.yml'), 'v1');
  await make7z(work, 'sk.zip', ['SpaghettiKart']);
  const remote = { origins: [{ id: 'n64', name: 'Nintendo 64' }], apps: [
    { id: 'extra', name: 'Extra', game: 'Extra', origin: 'n64', repo: 'x/extra', systems: ['windows'] },
    { id: 'spaghettikart', name: 'SpaghettiKart', game: 'Mario Kart 64', origin: 'n64', repo: 'HarbourMasters/SpaghettiKart', systems: ['windows'] },
  ] };
  let tag = 'v1.0.0';
  let srv;
  const asset = () => ({ name: 'SpaghettiKart-Windows-x64.zip', size: fs.statSync(path.join(work, 'sk.zip')).size, browser_download_url: `http://127.0.0.1:${srv.address().port}/dl/sk.zip` });
  srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/catalog.json') return res.end(JSON.stringify(remote));
    if (u === '/repos/HarbourMasters/SpaghettiKart/releases/latest') return res.end(JSON.stringify({ tag_name: tag, assets: [{ name: 'SpaghettiKart-Linux.AppImage' }, asset()] }));
    if (u === '/dl/sk.zip') return res.end(fs.readFileSync(path.join(work, 'sk.zip')));
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.RR_EMU_GITHUB_API = base;
  process.env.RR_RECOMP_CATALOG = `${base}/catalog.json`;
  process.env.RR_RECOMP_ROOT = path.join(work, 'recomps');
  process.env.RR_RECOMP_NO_COVERS = '1';
  delete process.env.RR_RECOMP_OFFLINE;
  for (const k of Object.keys(require.cache)) if (/features[\\/](recomp|emu)/.test(k)) delete require.cache[k];
  const feature = require('../src/features/recomp');

  const handlers = {};
  const sent = [];
  const store = { data: { games: [], settings: {} }, save() {} };
  const ctx = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = (...a) => fn({}, ...a); } },
    store, hub: new EventEmitter(), DATA: work, MEDIA: path.join(work, 'media'),
    commit() {}, send: (ch, p) => sent.push([ch, p]), log() {}, getWin: () => null,
    findGame: (id) => store.data.games.find((g) => g.id === id),
    addGame: (d) => { const g = { id: 'g' + store.data.games.length, ...d }; store.data.games.push(g); return g; },
  };
  feature.init(ctx);

  const list = await handlers['x:recomp:list']();
  assert.ok(list.items.find((e) => e.id === 'extra'), 'entrée du catalogue distant');
  assert.ok(list.items.find((e) => e.id === 'spaghettikart'));

  // Sans ROM : refusé (la recomp lit la ROM dans son dossier)
  assert.match((await handlers['x:recomp:install']('spaghettikart')).error, /copie du jeu/);
  // ROM choisie (comme après x:recomp:pickRom)
  const rom = path.join(work, 'Mario Kart 64 (USA).z64');
  fs.writeFileSync(rom, z64('MARIOKART64', 'NKTE', 0x20000));
  store.data.recomps.roms.spaghettikart = { path: rom, info: 'MARIOKART64 (USA, NKTE)' };

  const r = await handlers['x:recomp:install']('spaghettikart');
  assert.ok(r.ok, r.error);
  const dir = path.join(work, 'recomps', 'spaghettikart');
  assert.strictEqual(r.installed.exe, path.join(dir, 'Spaghettify.exe'));
  assert.ok(fs.existsSync(path.join(dir, 'Mario Kart 64 (USA).z64')), 'ROM copiée à côté de l’exe');
  const g = store.data.games[0];
  assert.deepStrictEqual([g.kind, g.platform, g.name, g.source, g.exePath], ['exe', 'n64', 'Mario Kart 64', 'recomp', path.join(dir, 'Spaghettify.exe')]);
  assert.ok(sent.some(([ch, p]) => ch === 'x:recomp:progress' && p.phase === 'done'));

  // Mise à jour : nouvelle release, la config modifiée par le joueur est gardée si l'archive ne la contient pas
  fs.writeFileSync(path.join(dir, 'saves.dat'), 'progression');
  tag = 'v1.1.0';
  const up = await handlers['x:recomp:checkUpdate']('spaghettikart');
  assert.ok(up.update && up.latest === 'v1.1.0');
  const r2 = await handlers['x:recomp:install']('spaghettikart', { update: true });
  assert.ok(r2.ok && r2.version === 'v1.1.0');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'saves.dat'), 'utf8'), 'progression');
  assert.strictEqual(store.data.games.length, 1, 'pas de doublon dans la bibliothèque');

  // Désinstallation : dossier et jeu retirés, ROM d'origine intacte
  assert.ok(await handlers['x:recomp:uninstall']('spaghettikart'));
  assert.ok(!fs.existsSync(dir));
  assert.strictEqual(store.data.games.length, 0);
  assert.ok(fs.existsSync(rom));
  srv.close();
});

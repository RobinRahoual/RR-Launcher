// EMU : tables de raccourcis, ligne de commande avec profil, BIOS, commande réseau RetroArch (faux serveur UDP),
// installation complète depuis un faux buildbot / fausse API GitHub (serveur HTTP local, archives 7z/zip réelles).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dgram = require('dgram');

const ST = require('../src/features/emu/states');
const L = require('../src/features/emu/launch');
const bios = require('../src/features/emu/bios');
const split = (s = '') => (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-emu-'));

test('raccourcis : touches et rattrapage d’emplacement', () => {
  assert.deepStrictEqual(ST.parseKeys('Shift+F{slot}', 3), [0x10, 0x72]);
  assert.deepStrictEqual(ST.parseKeys('F2'), [0x71]);
  assert.strictEqual(ST.parseKeys('Hyper+F2'), null);
  // Dolphin : l'emplacement est dans la touche
  const dol = ST.plan(ST.table('dolphin'), 'save', 1, 4);
  assert.deepStrictEqual(dol.steps, [[0x10, 0x73]]);
  // PCSX2 : 0 → 2 = F2, F2 puis F1
  const p = ST.plan(ST.table('pcsx2'), 'save', 0, 2);
  assert.deepStrictEqual(p.steps, [[0x71], [0x71], [0x70]]);
  // DuckStation 3 → 2 : précédent (F3) puis F1 (charger)
  assert.deepStrictEqual(ST.plan(ST.table('duckstation'), 'load', 3, 2).steps, [[0x72], [0x70]]);
  // PPSSPP n'a que « suivant » : 3 → 1 = trois fois F3 (5 emplacements, 0-4) puis F4
  assert.deepStrictEqual(ST.plan(ST.table('ppsspp'), 'load', 3, 1).steps, [[0x72], [0x72], [0x72], [0x73]]);
  // Surcharge utilisateur
  assert.deepStrictEqual(ST.plan(ST.table('retroarch', { retroarch: { save: 'Ctrl+S' } }), 'save', 0, 0).steps, [[0x11, 0x53]]);
  assert.strictEqual(ST.table('inconnu'), null);
  for (const [k, t] of Object.entries(ST.HOTKEYS)) { assert.ok(ST.parseKeys(t.save, 1), k); assert.ok(ST.parseKeys(t.load, 1), k); }
});

test('retroarch.cfg : activation des commandes réseau', () => {
  assert.strictEqual(ST.enableNetCmd(''), 'network_cmd_enable = "true"\nnetwork_cmd_port = "55355"\n');
  const t = ST.enableNetCmd('video_fullscreen = "true"\nnetwork_cmd_enable = "false"\n');
  assert.match(t, /^network_cmd_enable = "true"$/m);
  assert.ok(ST.netEnabled(t));
  assert.deepStrictEqual(ST.netCommands('save', 0, 2), ['STATE_SLOT_PLUS', 'STATE_SLOT_PLUS', 'SAVE_STATE']);
  assert.deepStrictEqual(ST.netCommands('load', 2, 1), ['STATE_SLOT_MINUS', 'LOAD_STATE']);
});

test('commande réseau RetroArch (faux serveur UDP)', async () => {
  const srv = dgram.createSocket('udp4');
  const got = [];
  srv.on('message', (m, r) => {
    const c = String(m).trim();
    got.push(c);
    if (c === 'GET_STATUS') srv.send('GET_STATUS PLAYING snes,Mario,crc32=1234', r.port, r.address);
  });
  await new Promise((r) => srv.bind(0, '127.0.0.1', r));
  const port = srv.address().port;
  const res = await ST.retroarchNet('save', 0, 1, { port });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(res, { ok: true, via: 'net', slot: 1 });
  assert.deepStrictEqual(got, ['GET_STATUS', 'STATE_SLOT_PLUS', 'SAVE_STATE']);
  srv.close();
  // Pas de RetroArch à l'écoute → NO_NET (repli clavier)
  const none = await ST.retroarchNet('save', 0, 0, { port, timeout: 200 });
  assert.deepStrictEqual(none, { ok: false, error: 'NO_NET' });
});

test('ligne de commande : profil par jeu', () => {
  const g = { kind: 'rom', platform: 'ps2', romPath: 'D:\\ROMs\\PS2\\jeu.iso' };
  const emu = { path: 'C:\\Emu\\pcsx2-qt.exe', args: '-batch -fullscreen -- "{rom}"' };
  let c = L.command(g, emu, { splitArgs: split });
  assert.deepStrictEqual(c.args, ['-batch', '-fullscreen', '--', g.romPath]);
  c = L.command({ ...g, launch: { fullscreen: 'off', args: '-bigpicture' } }, emu, { splitArgs: split });
  assert.deepStrictEqual(c.args, ['-nofullscreen', '-bigpicture', '-batch', '--', g.romPath]);
  // Dolphin : résolution + plein écran via -C
  const dol = { path: 'C:\\Dolphin\\Dolphin.exe', args: '-b -e "{rom}"' };
  c = L.command({ kind: 'rom', romPath: 'x.rvz', launch: { fullscreen: 'on', resolution: 3 } }, dol, { splitArgs: split });
  assert.deepStrictEqual(c.args, ['-C', 'Dolphin.Display.Fullscreen=True', '-C', 'GFX.Settings.InternalResolution=3', '-b', '-e', 'x.rvz']);
  // Émulateur propre au jeu (autre cœur RetroArch)
  const g2 = { kind: 'rom', platform: 'snes', romPath: 'm.sfc', launch: { emuPath: 'C:\\RA\\retroarch.exe', emuArgs: '-L "cores/bsnes_libretro.dll" "{rom}"' } };
  const e2 = L.emulatorFor(g2, { emulators: { snes: { path: 'C:\\RA\\retroarch.exe', args: 'x' } } });
  assert.strictEqual(e2.custom, true);
  assert.deepStrictEqual(L.command(g2, e2, { splitArgs: split }).args, ['-L', 'cores/bsnes_libretro.dll', 'm.sfc']);
  // Exe PC : arguments supplémentaires + env
  c = L.command({ kind: 'exe', exePath: 'C:\\Jeux\\A\\a.exe', args: '-x', launch: { args: '-windowed', env: 'DXVK_HUD=fps\nFOO="b c"' } }, null, { splitArgs: split, env: { PATH: 'p' } });
  assert.deepStrictEqual(c.args, ['-x', '-windowed']);
  assert.deepStrictEqual(c.spawn.env, { PATH: 'p', DXVK_HUD: 'fps', FOO: 'b c' });
  assert.strictEqual(c.followDir, 'C:\\Jeux\\A');
  // Administrateur : Start-Process -Verb RunAs, suivi par dossier
  c = L.command({ kind: 'exe', exePath: "C:\\Jeux\\L'A\\a.exe", args: '', launch: { admin: true, args: '-a "b c"' } }, null, { splitArgs: split });
  assert.strictEqual(c.file, 'powershell.exe');
  assert.match(c.args.at(-1), /Start-Process -FilePath 'C:\\Jeux\\L''A\\a\.exe' -ArgumentList '-a "b c"' .* -Verb RunAs$/);
  assert.ok(c.admin && c.followDir);
  assert.deepStrictEqual(L.capabilities('C:/x/Dolphin.exe'), { kind: 'dolphin', fullscreen: true, resolution: true });
  assert.deepStrictEqual(L.capabilities('C:/x/retroarch.exe'), { kind: 'retroarch', fullscreen: true, resolution: false });
});

test('BIOS : détection et dossiers', () => {
  const d = tmp();
  const exe = path.join(d, 'retroarch.exe');
  fs.writeFileSync(exe, '');
  let r = bios.check('ps1', { path: exe });
  assert.strictEqual(r[0].ok, false);
  assert.strictEqual(r[0].folder, path.join(d, 'system'));
  fs.mkdirSync(path.join(d, 'system'));
  fs.writeFileSync(path.join(d, 'system', 'SCPH5501.BIN'), Buffer.alloc(100));
  r = bios.check('ps1', { path: exe });
  assert.strictEqual(r[0].ok, false);
  assert.match(r[0].warn, /taille inattendue/);
  fs.writeFileSync(path.join(d, 'system', 'SCPH5501.BIN'), Buffer.alloc(524288));
  assert.strictEqual(bios.check('ps1', { path: exe })[0].ok, true);
  // system_directory personnalisé
  fs.writeFileSync(path.join(d, 'retroarch.cfg'), 'system_directory = ":\\bios"\n');
  assert.strictEqual(bios.retroarchSystemDir(exe), path.join(d, 'bios'));
  // PCSX2 portable : <dir>/bios, fichiers ≥ 4 Mo
  const p = tmp();
  fs.writeFileSync(path.join(p, 'pcsx2-qt.exe'), ''); fs.writeFileSync(path.join(p, 'portable.ini'), '');
  assert.strictEqual(bios.check('ps2', { path: path.join(p, 'pcsx2-qt.exe') })[0].folder, path.join(p, 'bios'));
  fs.mkdirSync(path.join(p, 'bios')); fs.writeFileSync(path.join(p, 'bios', 'scph-70004.bin'), Buffer.alloc(4194304));
  assert.strictEqual(bios.check('ps2', { path: path.join(p, 'pcsx2-qt.exe') })[0].ok, true);
  assert.deepStrictEqual(bios.check('snes', { path: exe }), []);
});

test('catalogue : version stable, choix de l’asset', () => {
  const C = require('../src/features/emu/catalog');
  assert.strictEqual(C.latestStable('<a href="1.9.0/">x</a><a href="1.22.2/">x</a><a href="1.21.0/">'), '1.22.2');
  const rel = { assets: [{ name: 'pcsx2-v2.8.2-windows-x64-Qt-symbols.7z' }, { name: 'pcsx2-v2.8.2-windows-x64-Qt.7z' }, { name: 'pcsx2-v2.8.2-linux.AppImage' }] };
  assert.strictEqual(C.pickAsset(rel, C.EMULATORS.pcsx2.source.asset).name, 'pcsx2-v2.8.2-windows-x64-Qt.7z');
  assert.strictEqual(C.pickAsset({ assets: [{ name: 'azahar-windows-msvc-2126.2.zip' }] }, C.EMULATORS.azahar.source.asset).name, 'azahar-windows-msvc-2126.2.zip');
  for (const [pid, opts] of Object.entries(C.RECO)) for (const o of opts) assert.ok(C.EMULATORS[o.emu], pid);
});

// ---- Installation de bout en bout avec un faux serveur
async function make7z(srcDir, out, files) {
  const SevenZip = require('7z-wasm');
  const sz = await SevenZip({ print() {}, printErr() {} });
  sz.FS.mkdir('/w'); sz.FS.mount(sz.NODEFS, { root: srcDir }, '/w');
  sz.FS.chdir('/w');
  assert.strictEqual(sz.callMain(['a', out, ...files, '-y']), 0);
}
test('installation : RetroArch + cœur, PCSX2 (GitHub), annulation, archive corrompue', async () => {
  const work = tmp();
  // Contenu des archives
  fs.mkdirSync(path.join(work, 'RetroArch-Win64'));
  fs.writeFileSync(path.join(work, 'RetroArch-Win64', 'retroarch.exe'), 'exe');
  fs.writeFileSync(path.join(work, 'snes9x_libretro.dll'), 'dll');
  fs.mkdirSync(path.join(work, 'pcsx2'));
  fs.writeFileSync(path.join(work, 'pcsx2', 'pcsx2-qt.exe'), 'exe');
  await make7z(work, 'RetroArch.7z', ['RetroArch-Win64']);
  await make7z(work, 'core.zip', ['snes9x_libretro.dll']);
  await make7z(work, 'pcsx2.7z', ['pcsx2']);
  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  const files = { '/stable/1.22.2/windows/x86_64/RetroArch.7z': 'RetroArch.7z', '/nightly/windows/x86_64/latest/snes9x_libretro.dll.zip': 'core.zip', '/dl/pcsx2-v2.8.2-windows-x64-Qt.7z': 'pcsx2.7z' };
  const srv = http.createServer((req, res) => {
    const u = req.url;
    if (u === '/stable/') return res.end('<a href="1.21.0/">1.21.0/</a><a href="1.22.2/">1.22.2/</a>');
    if (u === '/repos/PCSX2/pcsx2/releases/latest') {
      const size = fs.statSync(path.join(work, 'pcsx2.7z')).size;
      return res.end(JSON.stringify({ tag_name: 'v2.8.2', assets: [{ name: 'pcsx2-v2.8.2-windows-x64-Qt.7z', size, browser_download_url: `http://127.0.0.1:${srv.address().port}/dl/pcsx2-v2.8.2-windows-x64-Qt.7z` }] }));
    }
    if (u === '/slow.7z') { res.writeHead(200, { 'content-length': big.length }); let i = 0; const t = setInterval(() => { if (i >= big.length || res.destroyed) { clearInterval(t); return res.end(); } res.write(big.subarray(i, i += 65536)); }, 30); return; }
    if (u === '/bad.7z') return res.end('pas une archive');
    if (files[u]) return res.end(fs.readFileSync(path.join(work, files[u])));
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.RR_EMU_BUILDBOT = base;
  process.env.RR_EMU_GITHUB_API = base;
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}features${path.sep}emu${path.sep}`)) delete require.cache[k];
  const { install } = require('../src/features/emu/installer');
  const root = path.join(work, 'emulators');
  const phases = [];
  const r = await install({ platform: 'snes', emu: 'retroarch', core: 'snes9x' }, { root, onProgress: (p) => phases.push(p.phase) });
  assert.strictEqual(r.exe, path.join(root, 'retroarch', 'retroarch.exe'));
  assert.strictEqual(r.version, '1.22.2');
  assert.ok(fs.existsSync(path.join(root, 'retroarch', 'cores', 'snes9x_libretro.dll')));
  assert.ok(fs.existsSync(path.join(root, 'retroarch', 'system')));
  assert.ok(ST.netEnabled(fs.readFileSync(path.join(root, 'retroarch', 'retroarch.cfg'), 'utf8')));
  assert.match(r.conf.args, /snes9x_libretro\.dll/);
  assert.strictEqual(r.conf.name, 'RetroArch (Snes9x)');
  for (const ph of ['resolve', 'download', 'extract', 'core', 'config', 'done']) assert.ok(phases.includes(ph), ph);
  assert.ok(!fs.existsSync(path.join(root, '_staging', 'retroarch')));

  const p = await install({ platform: 'ps2', emu: 'pcsx2' }, { root });
  assert.strictEqual(p.exe, path.join(root, 'pcsx2', 'pcsx2-qt.exe'));
  assert.ok(fs.existsSync(path.join(root, 'pcsx2', 'portable.ini')));
  assert.strictEqual(p.conf.args, '-batch -fullscreen -- "{rom}"');

  // Annulation pendant le téléchargement, puis reprise (Range) : le .part est conservé
  const { download } = require('../src/features/emu/download');
  const ctrl = new AbortController();
  const dest = path.join(work, 'slow.7z');
  let seen = 0;
  await assert.rejects(download(`${base}/slow.7z`, dest, { signal: ctrl.signal, onProgress: (x) => { seen = x.got; if (x.got > 300000) ctrl.abort(); } }), (e) => e.name === 'AbortError');
  assert.ok(seen > 0 && fs.existsSync(dest + '.part'));
  // Taille annoncée différente → erreur claire
  await assert.rejects(download(`${base}/bad.7z`, path.join(work, 'b1'), { size: 999 }), /incomplet/);
  // Archive illisible
  const { extract } = require('../src/features/emu/extract');
  await download(`${base}/bad.7z`, path.join(work, 'bad.7z'));
  await assert.rejects(extract(path.join(work, 'bad.7z'), path.join(work, 'out')), /illisible|corrompue/);
  // Fichier absent du serveur
  await assert.rejects(download(`${base}/nope.zip`, path.join(work, 'n')), /introuvable/);
  srv.close();
});

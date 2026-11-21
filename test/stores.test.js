// STORES : import Epic / GOG et lancement direct (analyses pures + scanners avec registre / disque simulés)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/features/importer/stores');
const split = (s = '') => (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));

const manifest = { DisplayName: 'Hades', AppName: 'Min', CatalogNamespace: 'ns', CatalogItemId: 'it', InstallLocation: 'D:\\Epic\\Hades', LaunchExecutable: 'x64\\Hades.exe', LaunchCommand: '-windowed -nointro', AppCategories: ['public', 'games', 'applications'] };

test('Epic : manifeste → exécutable, arguments, lien de lancement', () => {
  const it = S.parseEpicManifest(manifest);
  assert.strictEqual(it.exePath, 'D:\\Epic\\Hades\\x64\\Hades.exe');
  assert.strictEqual(it.epicArgs, '-windowed -nointro');
  assert.strictEqual(it.epicApp, 'Min');
  assert.match(it.launchUri, /^com\.epicgames\.launcher:\/\/apps\/ns%3Ait%3AMin\?action=launch&silent=true$/);
  assert.strictEqual(S.parseEpicManifest({ ...manifest, bIsIncompleteInstall: true }), null);
  assert.strictEqual(S.parseEpicManifest({ ...manifest, DisplayName: 'Unreal Engine 5.4' }), null);
  assert.strictEqual(S.parseEpicManifest({ ...manifest, AppCategories: ['applications'] }), null);
});

test('Epic : direct seulement si demandé (réglage ou option du jeu)', () => {
  const g = { kind: 'epic', exePath: 'D:\\E\\a.exe', epicArgs: '-x', installDir: 'D:\\E' };
  assert.strictEqual(S.wantsEpicDirect(g, {}), false);
  assert.strictEqual(S.wantsEpicDirect(g, { epicDirect: true }), true);
  assert.strictEqual(S.wantsEpicDirect({ ...g, launch: { via: 'client' } }, { epicDirect: true }), false);
  assert.strictEqual(S.wantsEpicDirect({ ...g, launch: { via: 'direct' } }, {}), true);
  assert.strictEqual(S.wantsEpicDirect({ ...g, exePath: '' }, { epicDirect: true }), false);
  const c = S.epicDirectCommand(g, split, '-w 1280');
  assert.deepStrictEqual([c.file, c.args, c.cwd, c.followDir], ['D:\\E\\a.exe', ['-x', '-w', '1280'], 'D:\\E', 'D:\\E']);
});

const REG = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924
    gameID    REG_SZ    1207658924
    gameName    REG_SZ    Heroes of Might and Magic 3
    exe    REG_SZ    D:\\GOG Games\\HoMM3\\homm3.exe
    launchParam    REG_SZ    /fast
    path    REG_SZ    D:\\GOG Games\\HoMM3

HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\999
    gameID    REG_SZ    999
    gameName    REG_SZ    Sans exe
    path    REG_SZ    D:\\X
`;
test('GOG : registre → jeux, arguments de lancement, identifiant Galaxy', () => {
  const l = S.parseGogRegistry(REG);
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual(l[0], { id: '1207658924', name: 'Heroes of Might and Magic 3', exe: 'D:\\GOG Games\\HoMM3\\homm3.exe', args: '/fast', dir: 'D:\\GOG Games\\HoMM3' });
  const it = S.gogItem(l[0]);
  assert.deepStrictEqual([it.kind, it.source, it.galaxyId, it.args], ['exe', 'gog', '1207658924', '/fast']);
});

test('GOG : goggame-<id>.info → tâche principale', () => {
  const info = { gameId: '42', name: 'Jeu', playTasks: [{ category: 'document', path: 'manual.pdf' }, { category: 'game', isPrimary: false, path: 'alt.exe' }, { category: 'game', isPrimary: true, path: 'bin\\jeu.exe', arguments: '-dx11', workingDir: 'bin' }] };
  const r = S.parseGogInfo(info, 'D:\\G\\Jeu');
  assert.deepStrictEqual([r.exe, r.args, r.cwd], ['D:\\G\\Jeu\\bin\\jeu.exe', '-dx11', 'D:\\G\\Jeu\\bin']);
  assert.strictEqual(S.parseGogInfo({ playTasks: [] }, 'D:\\x'), null);
});

test('GOG : Galaxy seulement si demandé, jamais sans Galaxy', () => {
  const g = { source: 'gog', galaxyId: '42', installDir: 'D:\\G\\Jeu' };
  assert.strictEqual(S.wantsGalaxy(g, {}), false);
  assert.strictEqual(S.wantsGalaxy(g, { gogGalaxy: true }), true);
  assert.strictEqual(S.wantsGalaxy({ ...g, launch: { via: 'direct' } }, { gogGalaxy: true }), false);
  assert.strictEqual(S.wantsGalaxy({ ...g, galaxyId: null }, { gogGalaxy: true }), false);
  assert.strictEqual(S.galaxyCommand(g, null), null);
  const c = S.galaxyCommand(g, 'C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe');
  assert.deepStrictEqual(c.args, ['/gameId=42', '/command=runGame', '/path=D:\\G\\Jeu']);
  assert.strictEqual(c.cwd, 'C:\\Program Files (x86)\\GOG Galaxy');
});

test('scanEpic : dossier lu dans le registre, doublons ignorés, introuvable → erreur', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-st-'));
  const man = path.join(d, 'Manifests');
  fs.mkdirSync(man);
  fs.writeFileSync(path.join(man, 'a.item'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(man, 'b.item'), JSON.stringify(manifest)); // même AppName
  fs.writeFileSync(path.join(man, 'c.item'), '{pas du json');
  const r = await S.scanEpic({ reg: async () => `    AppDataPath    REG_SZ    ${d}/\n`, env: { ProgramData: '/nulle-part' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 1);
  const none = await S.scanEpic({ reg: async () => '', env: { ProgramData: '/nulle-part' } });
  assert.strictEqual(none.ok, false);
});

test('scanGog : le fichier .info prime sur le registre', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-gog-'));
  fs.writeFileSync(path.join(d, 'goggame-7.info'), JSON.stringify({ gameId: '7', name: 'X', playTasks: [{ category: 'game', isPrimary: true, path: 'real.exe', arguments: '-fs' }] }));
  const reg = async (key) => (/WOW6432Node/.test(key) ? `HKEY_X\\7\n    gameID    REG_SZ    7\n    gameName    REG_SZ    Mon jeu\n    exe    REG_SZ    ${d}\\launcher.exe\n    path    REG_SZ    ${d}\n` : '');
  const r = await S.scanGog({ reg });
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.items[0].exePath.endsWith('real.exe'));
  assert.strictEqual(r.items[0].args, '-fs');
  assert.strictEqual((await S.scanGog({ reg: async () => '' })).ok, false);
});

test('findGalaxy : registre puis emplacements usuels', async () => {
  const hit = 'C:\\GOG\\GalaxyClient.exe';
  assert.strictEqual(await S.findGalaxy({ reg: async () => '    client    REG_SZ    C:\\GOG\n', exists: (f) => f === hit }), hit);
  assert.strictEqual(await S.findGalaxy({ reg: async () => '', exists: () => false }), null);
});

test('enrich : complète un jeu déjà importé sans écraser', () => {
  const g = { source: 'gog', args: '' };
  assert.strictEqual(S.enrich(g, { source: 'gog', galaxyId: '5', args: '-a' }), true);
  assert.deepStrictEqual([g.galaxyId, g.args], ['5', '-a']);
  assert.strictEqual(S.enrich(g, { source: 'gog', galaxyId: '6', args: '-b' }), false);
  assert.strictEqual(g.galaxyId, '5');
});

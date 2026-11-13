// IMPORTER : sources des autres launchers (fixtures), lecteur SQLite, nettoyage de la bibliothèque.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../src/features/importer/sources');
const sqlite = require('../src/features/importer/sqlite');
const C = require('../src/features/importer/cleanup');
const F = (n) => path.join(__dirname, 'fixtures', 'importer', n);

test('SQLite : lecture d’une vraie base (Amazon), alias rowid, débordements, nœuds intérieurs', () => {
  const db = sqlite.openFile(fs, F('amazon.sqlite'));
  assert.deepStrictEqual(db.tables().sort(), ['DbSet']);
  assert.strictEqual(db.rows('DbSet').length, 3);
  const b = sqlite.openFile(fs, F('butler.db'));
  const big = b.rows('big');
  assert.strictEqual(big.length, 400);
  assert.strictEqual(big[399].id, 400);
  assert.ok(big[10].t.startsWith('ligne 10 x'));
  assert.strictEqual(b.rows('blobby')[0].t.length, 20000);
});
test('SQLite : journal WAL appliqué', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-'));
  fs.copyFileSync(F('wal-copy.db'), path.join(dir, 'a.db')); fs.copyFileSync(F('wal-copy.db-wal'), path.join(dir, 'a.db-wal'));
  assert.deepStrictEqual(sqlite.openFile(fs, path.join(dir, 'a.db')).rows('t').map((r) => r.n), ['a', 'b']);
  assert.throws(() => sqlite.open(Buffer.from('pas sqlite'.repeat(20))));
});

test('Amazon Games', () => {
  const items = S.buildAmazon(sqlite.openFile(fs, F('amazon.sqlite')).rows('DbSet'));
  assert.deepStrictEqual(items.map((i) => [i.name, i.launchUri, i.kind]), [['Tomb Raider', 'amazon-games://play/amzn1.adg.product.AAA', 'uri'], ['Fallout Shelter', 'amazon-games://play/amzn1.adg.product.CCC', 'uri']]);
});
test('itch.io : jeux Windows uniquement, exécutable le plus gros', () => {
  const items = S.buildItch(sqlite.openFile(fs, F('butler.db')), () => true);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].name, 'Celeste Classic');
  assert.ok(items[0].exePath.endsWith('celeste.exe'));
  assert.strictEqual(items[0].kind, 'exe');
});
test('Battle.net : décodage protobuf heuristique de product.db', () => {
  const p = S.parseProductDb(fs.readFileSync(F('product.db')));
  assert.deepStrictEqual(p.map((x) => x.uid), ['wow', 'agent', 'prometheus', 'inconnu']);
  assert.strictEqual(p[0].installPath, '/tmp/bnet/World of Warcraft');
});
test('Battle.net : produits connus, lancement battlenet://', async () => {
  fs.rmSync('/tmp/bnet', { recursive: true, force: true });
  const r = await S.scanBattlenet({ db: F('product.db') });
  assert.strictEqual(r.items.length, 0); // dossiers /tmp/bnet absents
  fs.mkdirSync('/tmp/bnet/World of Warcraft', { recursive: true }); fs.mkdirSync('/tmp/bnet/Overwatch', { recursive: true });
  const r2 = await S.scanBattlenet({ db: F('product.db') });
  assert.deepStrictEqual(r2.items.map((i) => [i.name, i.launchUri]), [['World of Warcraft', 'battlenet://WoW'], ['Overwatch 2', 'battlenet://Pro']]);
});
test('Xbox : MicrosoftGame.config + noms résolus', () => {
  const cfg = S.parseMicrosoftGameConfig(fs.readFileSync(F('MicrosoftGame.config'), 'utf8'));
  assert.deepStrictEqual([cfg.name, cfg.exeName, cfg.exeId], ['Forza & Co', 'ForzaGame.exe', 'Game']);
  const read = () => fs.readFileSync(F('MicrosoftGame.config'), 'utf8');
  const items = S.buildXbox([
    { Name: 'Contoso.Forza', Family: 'Contoso.Forza_abc', Dir: 'X:\\XboxGames\\Forza\\Content', Apps: ['Game'] },
    { Name: 'Contoso.Autre', Family: 'Contoso.Autre_abc', Dir: 'X:\\XboxGames\\Autre\\Content', Apps: ['App'], Display: 'Nom localisé' },
    { Name: 'Microsoft.GamingApp', Family: 'Microsoft.GamingApp_x', Dir: 'C:\\x', Apps: ['Microsoft.Xbox.App'] },
  ], read, () => false);
  assert.deepStrictEqual(items.map((i) => i.name), ['Forza & Co', 'Nom localisé']);
  assert.strictEqual(items[0].launchUri, 'shell:AppsFolder\\Contoso.Forza_abc!Game');
});
test('EA app : installerdata.xml', async () => {
  const d = S.parseInstallerData(fs.readFileSync(F('installerdata.xml'), 'utf8'));
  assert.strictEqual(d.name, 'Titanfall™ 2');
  assert.strictEqual(d.exe, 'Titanfall2.exe');
  assert.strictEqual(d.offerId, 'Origin.OFR.50.0001234');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-'));
  fs.mkdirSync(path.join(root, 'Titanfall2', '__Installer'), { recursive: true });
  fs.copyFileSync(F('installerdata.xml'), path.join(root, 'Titanfall2', '__Installer', 'installerdata.xml'));
  const r = await S.scanEA({ roots: [root], reg: '' });
  assert.strictEqual(r.items[0].kind, 'uri');
  assert.strictEqual(r.items[0].launchUri, 'origin2://game/launch?offerIds=Origin.OFR.50.0001234');
  fs.writeFileSync(path.join(root, 'Titanfall2', 'Titanfall2.exe'), 'x');
  assert.strictEqual((await S.scanEA({ roots: [root], reg: '' })).items[0].kind, 'exe');
});
test('Ubisoft Connect : registre', async () => {
  const k = S.parseReg(fs.readFileSync(F('ubisoft-installs.reg.txt'), 'utf8'));
  assert.strictEqual(k.length, 3);
  const r = await S.scanUbisoft({ reg: fs.readFileSync(F('ubisoft-installs.reg.txt'), 'utf8'), names: { 3539: 'Assassin’s Creed Valhalla' }, check: () => true });
  assert.deepStrictEqual(r.items.map((i) => [i.name, i.launchUri, i.installDir]), [
    ['Assassin’s Creed Valhalla', 'uplay://launch/3539/0', 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Assassin\'s Creed Valhalla'],
    ['Far Cry 6', 'uplay://launch/720/0', 'D:\\Jeux\\Far Cry 6']]);
});
test('lancement par lien : schémas inconnus refusés', async () => {
  await assert.rejects(S.openLaunchUri('file:///c:/windows/system32/calc.exe', {}));
  let seen; await S.openLaunchUri('battlenet://WoW', { openExternal: (u) => { seen = u; } });
  assert.strictEqual(seen, 'battlenet://WoW');
});

// ---------------------------------------------------------------- Nettoyage
const G = (o) => ({ id: o.id, name: 'Jeu', platform: 'pc', kind: 'exe', exePath: '', romPath: '', installDir: '', appid: null, playtime: 0, favorite: false, media: {}, metaStatus: 'ok', addedAt: 1, ...o });
test('nettoyage : doublons (exe, appid, Steam + .exe, nom) et choix du plus complet', () => {
  const games = [
    G({ id: 'a', name: 'Hades', kind: 'steam', appid: 1145360, installDir: 'D:\\SteamLibrary\\steamapps\\common\\Hades', playtime: 7200, media: { cover: 'c.jpg' } }),
    G({ id: 'b', name: 'Hades', exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\x64\\Hades.exe', favorite: true }),
    G({ id: 'c', name: 'Autre', exePath: 'E:\\Jeux\\Autre\\a.exe' }), G({ id: 'd', name: 'Autre lancé 2', exePath: 'e:/jeux/autre/a.exe' }),
    G({ id: 'e', name: 'Sonic (USA)', platform: 'md', kind: 'rom', romPath: 'r1' }), G({ id: 'f', name: 'Sonic (Europe)', platform: 'md', kind: 'rom', romPath: 'r2' }),
    G({ id: 'g', name: 'Solo' }),
  ];
  const d = C.findDuplicates(games);
  assert.strictEqual(d.length, 3);
  const hades = d.find((x) => x.ids.includes('a'));
  assert.deepStrictEqual([hades.strong, hades.keep, hades.ids.sort()], [true, 'a', ['a', 'b']]);
  assert.ok(d.find((x) => x.ids.includes('c')).strong);
  const sonic = d.find((x) => x.ids.includes('e'));
  assert.strictEqual(sonic.strong, false);
  assert.match(sonic.reason, /nom/);
});
test('nettoyage : fusion (temps, favori, statut, visuels)', () => {
  const keep = G({ id: 'k', playtime: 100, status: 'none', media: {} });
  const drop = G({ id: 'x', playtime: 50, playCount: 2, favorite: true, status: 'playing', rating: 4, collections: ['RPG'], lastPlayed: 9, media: { cover: 'c.jpg' } });
  const copy = C.mergeInto(keep, [drop]);
  assert.deepStrictEqual([keep.playtime, keep.favorite, keep.status, keep.rating, keep.collections, keep.lastPlayed, keep.media.cover], [150, true, 'playing', 4, ['RPG'], 9, 'c.jpg']);
  assert.deepStrictEqual(copy, [{ from: 'x', to: 'k', file: 'c.jpg' }]);
});
test('nettoyage : désinstallés, disque hors ligne, visuels, métadonnées', async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  fs.mkdirSync(path.join(media, 'ok')); for (const f of ['c.jpg', 'h.jpg', 'l.png']) fs.writeFileSync(path.join(media, 'ok', f), 'x');
  const have = new Set(['c:\\', 'c:\\steam\\steamapps\\appmanifest_10.acf', 'c:\\jeux\\ok.exe']);
  const fsx = { exists: async (p) => have.has(String(p).toLowerCase()) || fs.existsSync(p) };
  const games = [
    G({ id: 'ok', exePath: 'C:\\Jeux\\ok.exe', media: { cover: 'c.jpg', hero: 'h.jpg', logo: 'l.png' } }),
    G({ id: 'gone', name: 'Parti', exePath: 'C:\\Jeux\\parti.exe', media: { cover: 'c.jpg' } }),
    G({ id: 'off', name: 'Disque Z', exePath: 'Z:\\Jeux\\z.exe' }),
    G({ id: 'st1', name: 'Steam OK', kind: 'steam', appid: 10, installDir: 'C:\\Steam\\steamapps\\common\\A' }),
    G({ id: 'st2', name: 'Steam KO', kind: 'steam', appid: 11, installDir: 'C:\\Steam\\steamapps\\common\\B' }),
    G({ id: 'rom', name: 'Rom', kind: 'rom', platform: 'nes', romPath: 'C:\\roms\\a.nes' }),
    G({ id: 'nm', name: 'Sans méta', exePath: 'C:\\Jeux\\ok.exe', metaStatus: 'none' }),
  ];
  const r = await C.analyze(games, { fsx, mediaDir: media, tried: {} });
  assert.deepStrictEqual(r.missing.map((m) => m.id).sort(), ['gone', 'rom', 'st2']);
  assert.strictEqual(r.offline, 1);
  assert.deepStrictEqual(r.nometa.map((m) => m.id), ['nm']);
  assert.deepStrictEqual(r.images.find((i) => i.id === 'st1').missing, ['jaquette', 'fond', 'logo']);
  assert.ok(!r.images.some((i) => i.id === 'ok'));
});

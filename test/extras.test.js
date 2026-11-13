// Tests du module EXTRAS (succès, mises à jour) : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseVdf, ci, libraryFolders, loginUsers } = require('../src/features/extras/vdf');
const { decodeStateFlags, steamStatus, statusLabel, steamappsOf, findAppManifest, readAppState, epicAppName, epicStatus, matchEpic } = require('../src/features/extras/updates');
const { RA_CONSOLE, raConsoleFor, normalizeRom, raHash } = require('../src/features/extras/romhash');
const { fromSteam, fromRA, summarize, displayList, newlyUnlocked, raDate, fmtPct } = require('../src/features/extras/achievements');
const api = require('../src/features/extras/api');

const FX = path.join(__dirname, 'fixtures', 'extras');
const fx = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const json = (f) => JSON.parse(fx(f));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

// ---------------------------------------------------------------- VDF
test('VDF : appmanifest (blocs imbriqués, commentaires, casse)', () => {
  const st = ci(parseVdf(fx('appmanifest_1145360.acf')), 'appstate');
  assert.strictEqual(st.appid, '1145360');
  assert.strictEqual(st.StateFlags, '1542');
  assert.strictEqual(st.InstalledDepots['1145361'].manifest, '123456789');
  assert.strictEqual(st.UserConfig.language, 'french');
});
test('VDF : échappements, mots nus, conditions, clé en double', () => {
  const o = parseVdf('"a" { "p" "C:\\\\X\\\\Y" "q" "dit \\"oui\\"" nu valeur "c" "1" [$WIN32] "c" "2" }');
  assert.deepStrictEqual(o, { a: { p: 'C:\\X\\Y', q: 'dit "oui"', nu: 'valeur', c: '2' } });
  assert.deepStrictEqual(parseVdf(''), {});
  assert.deepStrictEqual(parseVdf('"x" { "y" "1"'), { x: { y: '1' } }); // fichier tronqué : on tolère
});
test('VDF : libraryfolders (nouveau et ancien format)', () => {
  const l = libraryFolders(fx('libraryfolders.vdf'));
  assert.deepStrictEqual(l.map((x) => x.path), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  assert.ok(l[1].apps.has('1145360'));
  assert.deepStrictEqual(libraryFolders(fx('libraryfolders-old.vdf')).map((x) => x.path), ['E:\\Jeux\\Steam']);
});
test('VDF : loginusers → compte MostRecent en premier', () => {
  const u = loginUsers(fx('loginusers.vdf'));
  assert.strictEqual(u.length, 2);
  assert.strictEqual(u[0].steamId, '76561198000000001');
  assert.strictEqual(u[0].personaName, 'Robin "RR"');
  assert.ok(u[0].mostRecent && !u[1].mostRecent);
});

// ---------------------------------------------------------------- StateFlags / état des mises à jour
test('StateFlags : décodage des bits EAppState', () => {
  assert.deepStrictEqual(decodeStateFlags(4), ['FullyInstalled']);
  assert.deepStrictEqual(decodeStateFlags(6), ['UpdateRequired', 'FullyInstalled']);
  assert.deepStrictEqual(decodeStateFlags(1542), ['UpdateRequired', 'FullyInstalled', 'UpdatePaused', 'UpdateStarted']);
  assert.deepStrictEqual(decodeStateFlags(1026 + 256), ['UpdateRequired', 'UpdateRunning', 'UpdateStarted']);
  assert.deepStrictEqual(decodeStateFlags('0'), []);
});
test('Steam : état et pourcentage depuis un appmanifest', () => {
  const st = ci(parseVdf(fx('appmanifest_1145360.acf')), 'AppState');
  const s = steamStatus(st);
  assert.strictEqual(s.state, 'paused');
  assert.strictEqual(s.pct, 42);
  assert.strictEqual(statusLabel(s), 'Mise à jour en pause');
  const mk = (o) => ({ StateFlags: '4', buildid: '1', TargetBuildID: '1', BytesToDownload: '0', BytesDownloaded: '0', ...o });
  assert.strictEqual(steamStatus(mk({})), null); // à jour
  assert.strictEqual(steamStatus(mk({ StateFlags: '6' })).state, 'update');
  assert.strictEqual(statusLabel(steamStatus(mk({ StateFlags: '6' }))), 'Mise à jour disponible');
  const run = steamStatus(mk({ StateFlags: String(4 + 2 + 1024 + 256), BytesToDownload: '200', BytesDownloaded: '84' }));
  assert.strictEqual(statusLabel(run), 'Téléchargement 42\u202f%');
  assert.strictEqual(steamStatus(mk({ StateFlags: String(4 + 1048576) })).state, 'downloading');
  // file d'attente (1026) : « disponible », puis « téléchargement » si les octets progressent entre deux lectures
  const q = mk({ StateFlags: '1030', BytesToDownload: '1000', BytesDownloaded: '300' });
  assert.strictEqual(steamStatus(q).state, 'update');
  assert.strictEqual(steamStatus(q, { dl: 100 }).state, 'downloading');
  assert.strictEqual(steamStatus(mk({ TargetBuildID: '2' })).state, 'update'); // build cible différente
  assert.strictEqual(steamStatus(mk({ TargetBuildID: '0' })), null);
  assert.strictEqual(steamStatus(null), null);
});
test('Steam : chemin du manifeste depuis installDir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrx-'));
  const sa = path.join(tmp, 'lib', 'steamapps');
  fs.mkdirSync(path.join(sa, 'common', 'Hades'), { recursive: true });
  fs.copyFileSync(path.join(FX, 'appmanifest_1145360.acf'), path.join(sa, 'appmanifest_1145360.acf'));
  const g = { appid: 1145360, installDir: path.join(sa, 'common', 'Hades') };
  assert.strictEqual(steamappsOf(g.installDir), sa);
  assert.strictEqual(findAppManifest(g), path.join(sa, 'appmanifest_1145360.acf'));
  assert.strictEqual(findAppManifest({ appid: 1145360, installDir: '/ailleurs/x' }, [path.join(tmp, 'lib')]), path.join(sa, 'appmanifest_1145360.acf'));
  assert.strictEqual(readAppState(path.join(sa, 'appmanifest_1145360.acf')).name, 'Hades');
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('Epic : AppName, correspondance et état', () => {
  const item = json('epic-item.json');
  const g = { launchUri: 'com.epicgames.launcher://apps/ns1%3Aitem1%3AFortune?action=launch&silent=true', installDir: 'C:\\autre' };
  assert.strictEqual(epicAppName(g), 'Fortune');
  assert.strictEqual(matchEpic(g, [item]), item);
  assert.strictEqual(matchEpic({ installDir: 'C:\\Program Files\\Epic Games\\MonJeu\\' }, [item]), item);
  assert.strictEqual(epicStatus(item), null);
  assert.strictEqual(epicStatus({ ...item, bIsIncompleteInstall: true }).state, 'downloading');
  assert.strictEqual(statusLabel(epicStatus({ ...item, bIsIncompleteInstall: true })), 'Mise à jour en cours');
  assert.strictEqual(epicStatus(item, { ...item, AppVersionString: '1.0.2' }).state, 'downloading');
  assert.strictEqual(statusLabel(epicStatus({ ...item, bNeedsValidation: true })), 'Vérification requise');
});

// ---------------------------------------------------------------- Empreintes RA
test('RA : console selon la plateforme et l’extension', () => {
  assert.strictEqual(raConsoleFor('nes', 'a.nes'), RA_CONSOLE.nes);
  assert.strictEqual(raConsoleFor('gb', 'a.gbc'), 6);
  assert.strictEqual(raConsoleFor('gb', 'a.gb'), 4);
  assert.strictEqual(raConsoleFor('md', 'a.smd'), null);
  assert.strictEqual(raConsoleFor('snes', 'a.zip'), null);
  assert.strictEqual(raConsoleFor('ps2', 'a.iso'), null);
  assert.strictEqual(raConsoleFor('nds', 'a.nds'), null);
});
test('RA : NES sans en-tête iNES', () => {
  const body = Buffer.from('CONTENU-PRG-CHR'.repeat(4));
  const hdr = Buffer.concat([Buffer.from([0x4e, 0x45, 0x53, 0x1a]), Buffer.alloc(12, 1)]);
  assert.strictEqual(raHash(7, Buffer.concat([hdr, body])), md5(body));
  assert.strictEqual(raHash(7, body), md5(body)); // pas d'en-tête : fichier entier
});
test('RA : SNES sans en-tête copieur de 512 o', () => {
  const rom = Buffer.alloc(8192 * 2, 7);
  assert.strictEqual(raHash(3, Buffer.concat([Buffer.alloc(512, 0xff), rom])), md5(rom));
  assert.strictEqual(raHash(3, rom), md5(rom));
});
test('RA : N64 normalisée en big-endian (z64 / v64 / n64)', () => {
  const z64 = Buffer.from([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4, 5, 6, 7, 8]);
  const v64 = Buffer.from([0x37, 0x80, 0x40, 0x12, 2, 1, 4, 3, 6, 5, 8, 7]);
  const n64 = Buffer.from([0x40, 0x12, 0x37, 0x80, 4, 3, 2, 1, 8, 7, 6, 5]);
  assert.deepStrictEqual(normalizeRom(2, v64), z64);
  assert.deepStrictEqual(normalizeRom(2, n64), z64);
  assert.strictEqual(raHash(2, v64), md5(z64));
  assert.strictEqual(raHash(2, n64), raHash(2, z64));
});
test('RA : GB / GBA / Mega Drive = fichier entier ; recherche par empreinte', () => {
  const b = Buffer.from('ROM GBA DE TEST');
  for (const c of [4, 5, 6, 1]) assert.strictEqual(raHash(c, b), md5(b));
  const list = [{ id: 9, title: 'X', hashes: [md5(b)] }];
  assert.strictEqual(api.findByHash(list, md5(b).toUpperCase()).id, 9);
  assert.strictEqual(api.findByHash(list, 'zz'), null);
});

// ---------------------------------------------------------------- Succès
test('Steam : fusion schéma + joueur + rareté', () => {
  const d = fromSteam({ schema: json('steam-schema.json'), player: json('steam-player.json'), global: json('steam-global.json') });
  assert.strictEqual(d.total, 4);
  assert.strictEqual(d.unlocked, 2);
  assert.strictEqual(d.pct, 50);
  const first = d.list.find((a) => a.id === 'ACH_FIRST');
  assert.strictEqual(first.unlockedAt, 1700000000 * 1000);
  assert.strictEqual(first.rarity, 92.5);
  assert.strictEqual(d.list.find((a) => a.id === 'ACH_SECRET').hidden, true);
  assert.deepStrictEqual(summarize(d), { unlocked: 2, total: 4, pct: 50, source: 'steam' });
});
test('Affichage : débloqués récents d’abord, cachés masqués', () => {
  const d = fromSteam({ schema: json('steam-schema.json'), player: json('steam-player.json'), global: json('steam-global.json') });
  const l = displayList(d);
  assert.deepStrictEqual(l.map((a) => a.id), ['ACH_FISH', 'ACH_FIRST', 'ACH_ESCAPE', 'ACH_SECRET']);
  const secret = l[3];
  assert.ok(secret.masked);
  assert.strictEqual(secret.name, 'Succès caché');
  assert.ok(!JSON.stringify(secret).includes('Spoiler'));
  assert.strictEqual(secret.rarity, null);
  // débloqué : plus masqué
  const p2 = json('steam-player.json');
  p2.playerstats.achievements[2] = { apiname: 'ACH_SECRET', achieved: 1, unlocktime: 1720000000 };
  const l2 = displayList(fromSteam({ schema: json('steam-schema.json'), player: p2, global: null }));
  assert.strictEqual(l2[0].name, 'Le vrai final');
});
test('RetroAchievements : progression, rareté, points, dates UTC', () => {
  const d = fromRA(json('ra-progress.json'));
  assert.strictEqual(d.raId, 1446);
  assert.strictEqual(d.total, 3);
  assert.strictEqual(d.unlocked, 2);
  assert.strictEqual(d.pct, 67);
  assert.deepStrictEqual(d.list.map((a) => a.id), ['4874', '4876', '4875']); // DisplayOrder
  assert.strictEqual(d.list[0].rarity, 75);
  assert.strictEqual(d.list[0].iconUrl, 'https://media.retroachievements.org/Badge/04800.png');
  assert.strictEqual(d.list[0].unlockedAt, Date.UTC(2024, 0, 15, 18, 22, 5));
  assert.strictEqual(d.points, 40);
  assert.strictEqual(d.pointsEarned, 15);
  assert.strictEqual(raDate(''), 0);
  assert.deepStrictEqual(displayList(d).map((a) => a.id), ['4876', '4874', '4875']);
});
test('Nouveaux succès entre deux synchros', () => {
  const a = fromRA(json('ra-progress.json'));
  const j = json('ra-progress.json');
  j.Achievements['4875'].DateEarned = '2024-03-01 10:00:00';
  const b = fromRA(j);
  assert.deepStrictEqual(newlyUnlocked(a, b).map((x) => x.name), ['Monde 8']);
  assert.deepStrictEqual(newlyUnlocked(null, b), []);
  assert.deepStrictEqual(newlyUnlocked(b, b), []);
});
test('Pourcentages en français', () => {
  assert.strictEqual(fmtPct(24), '24\u202f%');
  assert.strictEqual(fmtPct(4.56), '4,6\u202f%');
  assert.strictEqual(fmtPct(null), '');
});

// ---------------------------------------------------------------- API (réponses d'exemple, sans réseau)
const fakeGet = (routes) => async (url) => {
  for (const [re, r] of routes) if (re.test(url)) return typeof r === 'function' ? r(url) : r;
  throw new Error('URL inattendue ' + url);
};
test('API Steam : profil, URL personnalisée, erreurs', async () => {
  assert.deepStrictEqual(api.parseSteamInput('https://steamcommunity.com/profiles/76561198000000001/'), { steamId: '76561198000000001' });
  assert.deepStrictEqual(api.parseSteamInput('https://steamcommunity.com/id/robin_rr/'), { vanity: 'robin_rr' });
  assert.deepStrictEqual(api.parseSteamInput('robin_rr'), { vanity: 'robin_rr' });
  assert.strictEqual(api.parseSteamInput('a b c'), null);
  const get = fakeGet([[/ResolveVanityURL.*vanityurl=robin_rr/, { status: 200, json: { response: { steamid: '76561198000000001', success: 1 } } }],
    [/ResolveVanityURL/, { status: 200, json: { response: { success: 42, message: 'No match' } } }]]);
  assert.strictEqual(await api.resolveSteamId(get, 'K', 'https://steamcommunity.com/id/robin_rr'), '76561198000000001');
  await assert.rejects(api.resolveSteamId(get, 'K', 'personne'), { code: 'notfound' });
  await assert.rejects(api.resolveSteamId(get, '', 'personne'), { code: 'key' });
  const ok = fakeGet([
    [/GetSchemaForGame.*l=french/, { status: 200, json: json('steam-schema.json') }],
    [/GetPlayerAchievements.*steamid=76561198000000001.*appid=1145360.*l=french/, { status: 200, json: json('steam-player.json') }],
    [/GetGlobalAchievementPercentagesForApp.*gameid=1145360/, { status: 200, json: json('steam-global.json') }],
  ]);
  const d = await api.steamAchievements(ok, { key: 'K', steamId: '76561198000000001', appid: 1145360 });
  assert.strictEqual(d.unlocked, 2);
  const priv = fakeGet([[/GetSchema/, { status: 200, json: json('steam-schema.json') }], [/GetPlayerAch/, { status: 403, json: json('steam-private.json') }], [/Global/, { status: 200, json: null }]]);
  await assert.rejects(api.steamAchievements(priv, { key: 'K', steamId: '1', appid: 1 }), { code: 'private' });
  const none = fakeGet([[/GetSchema/, { status: 200, json: { game: {} } }], [/GetPlayerAch/, { status: 400, json: json('steam-nostats.json') }], [/Global/, { status: 403, json: null }]]);
  assert.strictEqual((await api.steamAchievements(none, { key: 'K', steamId: '1', appid: 1 })).none, true);
  const badKey = fakeGet([[/GetSchema/, { status: 403, json: null }], [/GetPlayerAch/, { status: 403, json: null }], [/Global/, { status: 200, json: null }]]);
  await assert.rejects(api.steamAchievements(badKey, { key: 'K', steamId: '1', appid: 1 }), { code: 'key' });
});
test('API RetroAchievements : liste d’empreintes et progression', async () => {
  const get = fakeGet([
    [/API_GetGameList\.php\?i=7&h=1&f=1&y=K/, { status: 200, json: json('ra-gamelist.json') }],
    [/API_GetGameInfoAndUserProgress\.php\?g=1446&u=robin&y=K&a=1/, { status: 200, json: json('ra-progress.json') }],
    [/API_GetUserProfile/, { status: 200, json: { User: 'robin', TotalPoints: 1234 } }],
  ]);
  const list = await api.raGameList(get, 'K', 7);
  assert.strictEqual(api.findByHash(list, '811b027eaf99c2def7b933c5208636de').id, 1446);
  const d = await api.raAchievements(get, { user: 'robin', key: 'K', gameId: 1446 });
  assert.strictEqual(d.title, 'Super Mario Bros.');
  assert.deepStrictEqual(await api.raProfile(get, 'robin', 'K'), { name: 'robin', points: 1234 });
  const bad = fakeGet([[/./, { status: 401, json: null }]]);
  await assert.rejects(api.raProfile(bad, 'x', 'y'), { code: 'key' });
});

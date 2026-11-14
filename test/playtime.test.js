// PLAYTIME : heures Steam (localconfig.vdf), GOG Galaxy et itch.io (fausses bases), application « le plus grand
// des deux », entrée historique des statistiques, et correspondance processus → jeu pour le suivi hors launcher.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/features/playtime/core');
const { reconcileExternal } = require('../src/features/stats');

const VDF = `"UserLocalConfigStore"
{
  "Software" { "Valve" { "Steam" {
    "apps" {
      "1091500" { "LastPlayed" "1700000000" "Playtime" "600" "Playtime2wks" "30" }
      "620" { "Playtime" "0" }
      "570" { "LastPlayed" "1690000000" "playtime" "90" }
    }
  } } }
}`;

test('Steam : localconfig.vdf → minutes et dernière partie', () => {
  const m = core.steamLocalConfig(VDF);
  assert.deepEqual(m.get(1091500), { sec: 36000, last: 1700000000000 });
  assert.equal(m.get(570).sec, 5400); // casse différente
  assert.ok(!m.has(620));
  const merged = core.mergeMax([m, new Map([[570, { sec: 9000, last: 0 }]])]);
  assert.equal(merged.get(570).sec, 9000);
  assert.equal(merged.get(570).last, 1690000000000);
  assert.equal(core.steamLocalConfig('pas du vdf').size, 0);
});

const fakeDb = (tables) => ({ rows: (t) => { if (!tables[t]) throw new Error('table absente'); return tables[t]; } });

test('GOG Galaxy et itch.io', () => {
  const gog = core.gogTimes(fakeDb({
    GameTimes: [{ releaseKey: 'gog_1207658924', minutesInGame: 120 }, { releaseKey: 'steam_570', minutesInGame: 10 }, { releaseKey: 'gog_1', minutesInGame: 0 }],
    LastPlayedDates: [{ gameReleaseKey: 'gog_1207658924', lastPlayedDate: '2026-11-01T20:00:00Z' }],
  }));
  assert.equal(gog.get('gog_1207658924').sec, 7200);
  assert.equal(gog.get('gog_1207658924').last, Date.parse('2026-11-01T20:00:00Z'));
  assert.ok(!gog.has('gog_1'));
  assert.equal(core.gogTimes(fakeDb({})).size, 0);
  const itch = core.itchTimes(fakeDb({
    caves: [{ install_location_id: 'L', install_folder_name: 'celeste', seconds_run: 3600, last_touched_at: '2026-10-01T10:00:00Z' }],
    install_locations: [{ id: 'L', path: 'D:\\itch' }],
  }));
  assert.equal(itch.get(core.normDir('D:\\itch\\celeste')).sec, 3600);
  assert.equal(core.gogIdOf(['game.exe', 'goggame-1207658924.info']), '1207658924');
});

test('application : le plus grand des deux, sans addition', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const games = [
    { id: 'a', appid: 1091500, playtime: 1000, lastPlayed: 0 },
    { id: 'b', appid: 570, playtime: 99999, lastPlayed: now - 1000 },
    { id: 'c', playtime: 50 },
  ];
  const lookup = (g) => ({ a: { src: 'Steam', sec: 36000, last: now - 5000 }, b: { src: 'Steam', sec: 5400, last: now - 9e9 } })[g.id];
  assert.equal(core.applyTimes(games, lookup, now), 2);
  assert.equal(games[0].playtime, 36000);
  assert.equal(games[0].lastPlayed, now - 5000);
  assert.equal(games[1].playtime, 99999); // le launcher en sait plus
  assert.equal(games[1].lastPlayed, now - 1000);
  assert.equal(games[2].playtimeExt, undefined);
  assert.equal(core.applyTimes(games, lookup, now), 0); // rien de neuf
});

test('statistiques : une seule entrée historique par jeu, ajustée', () => {
  const db = { sessions: [{ id: 'a', start: 1, end: 2, seconds: 3000 }] };
  const games = [{ id: 'a', playtime: 36000, playtimeExt: { src: 'Steam', sec: 36000 } }];
  assert.ok(reconcileExternal(db, games));
  assert.deepEqual(db.sessions.find((s) => s.ext), { id: 'a', start: null, end: null, seconds: 33000, legacy: true, ext: 'Steam' });
  db.sessions.push({ id: 'a', start: 3, end: 4, seconds: 1000 }); // partie dans le launcher
  games[0].playtime = 37000;
  assert.ok(!reconcileExternal(db, games)); // 37000 - 4000 = 33000 : inchangé
  assert.equal(db.sessions.filter((s) => s.ext).length, 1);
});

test('suivi hors launcher : dossiers et processus', () => {
  const tooBroad = (d) => /^[a-z]:\\?$|\\steamapps\\common$|\\program files$/i.test(d.replace(/\\$/, ''));
  const games = [
    { id: 'cp', kind: 'steam', installDir: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077' },
    { id: 'dlc', kind: 'exe', exePath: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\tools\\mod.exe', installDir: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\tools' },
    { id: 'rom', kind: 'rom', romPath: 'E:\\roms\\zelda.z64' },
    { id: 'lnk', kind: 'exe', exePath: 'C:\\Users\\R\\Desktop\\Jeu.lnk' },
    { id: 'emu', kind: 'exe', exePath: 'E:\\Emus\\PCSX2\\pcsx2.exe' },
    { id: 'broad', kind: 'exe', exePath: 'C:\\Program Files\\game.exe', installDir: 'C:\\Program Files' },
  ];
  const list = core.watchList(games, { tooBroad, exclude: ['E:\\Emus\\PCSX2'] });
  assert.deepEqual(list.map((x) => x.id), ['dlc', 'cp']); // raccourci .lnk sans dossier : ignoré
  const hits = core.matchProcesses([
    { pid: 10, path: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe' },
    { pid: 11, path: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\CrashReporter.exe' },
    { pid: 12, path: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\tools\\mod.exe' },
    { pid: 13, path: 'C:\\Windows\\explorer.exe' },
    { pid: 99, path: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\x.exe' },
  ], list, { helper: /crash|reporter/i, selfPid: 99 });
  assert.deepEqual(hits.get('cp').pids, [10]);
  assert.deepEqual(hits.get('dlc').pids, [12]);
  assert.equal(hits.size, 2);
});

test('Epic : AppName, réponse playtime, code de connexion', () => {
  const g = { kind: 'epic', launchUri: 'com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true' };
  assert.equal(core.epicAppName(g), 'Fortnite');
  assert.equal(core.epicAppName({ launchUri: 'steam://run/1' }), '');
  const m = core.epicTimes([{ accountId: 'a', artifactId: 'Fortnite', totalTime: 9180 }, { artifactId: 'Zero', totalTime: 0 }, null]);
  assert.deepEqual(m.get('Fortnite'), { sec: 9180, last: 0 });
  assert.ok(!m.has('Zero'));
  assert.equal(core.epicCodeFrom('{"redirectUrl":"x","authorizationCode":"abc123","sid":null}'), 'abc123');
  assert.equal(core.epicCodeFrom('<html>'), '');
});

test('Epic : connexion, renouvellement du jeton, temps de jeu', async () => {
  const { createEpic } = require('../src/features/playtime/epic');
  const store = { data: {}, save() {} };
  const calls = [];
  const fetchImpl = async (url, o = {}) => {
    calls.push(url);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.includes('/oauth/token')) {
      const p = new URLSearchParams(o.body);
      assert.match(o.headers.Authorization, /^Basic /);
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good') return json(200, { access_token: 'A1', refresh_token: 'R1', account_id: 'ACC', displayName: 'Robin', expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'R1') return json(200, { access_token: 'A2', refresh_token: 'R2', account_id: 'ACC', displayName: 'Robin', expires_at: new Date(Date.now() + 3600e3).toISOString() });
      return json(400, { errorCode: 'errors.com.epicgames.account.oauth.authorization_code_not_found', errorMessage: 'invalid' });
    }
    if (url.includes('/playtime/account/ACC/all')) { assert.match(o.headers.Authorization, /^Bearer A/); return json(200, [{ artifactId: 'Fortnite', totalTime: 9180 }]); }
    return json(404, {});
  };
  const ep = createEpic({ store, fetchImpl });
  assert.equal(ep.connected(), false);
  await assert.rejects(ep.loginWithCode('bad'));
  await ep.loginWithCode('good');
  assert.ok(ep.connected()); assert.equal(ep.name(), 'Robin');
  assert.ok(!JSON.stringify(store.data.epicAuth).includes('A1')); // jeton d'accès jamais stocké
  assert.equal((await ep.playtime()).get('Fortnite').sec, 9180);
  // nouvelle instance (redémarrage) : renouvellement par le refresh token
  const ep2 = createEpic({ store, fetchImpl });
  assert.equal((await ep2.playtime()).get('Fortnite').sec, 9180);
  assert.ok(calls.some((u) => u.includes('oauth/token')));
  ep2.logout();
  assert.equal(ep2.connected(), false);
  await assert.rejects(ep2.playtime(), /non connecté/);
});

test('epicKeys : AppName puis catalogItemId, ou epicApp importé', () => {
  const g = { launchUri: 'com.epicgames.launcher://apps/ns%3Acat123%3AAppX?action=launch' };
  assert.deepEqual(core.epicKeys(g), ['AppX', 'cat123']);
  assert.deepEqual(core.epicKeys({ epicApp: 'Zed' }), ['Zed']);
  assert.deepEqual(core.epicKeys({}), []);
});

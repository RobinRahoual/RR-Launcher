// Tests du module FRIENDS : Gateway Discord (fausse Gateway locale), état des présences, Steam, modèle.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createGateway, INTENTS } = require('../src/features/friends/gateway');
const { createDiscordState, mainActivity, avatarUrl } = require('../src/features/friends/discord-state');
const { steamFriends, toFriend } = require('../src/features/friends/steam');
const model = require('../src/features/friends/model');
const { cleanToken, TOKEN_RE } = require('../src/features/friends');
const { startFakeGateway } = require('./fixtures/friends/fake-gateway');

// jeton FACTICE assemblé à l'exécution (évite le faux positif du scanner de secrets de GitHub)
const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GabcDE', 'abcdefghijklmnopqrstuvwxyz0123456789AB'].join('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('délai dépassé'); await wait(10); } }
const u = (id, name, extra = {}) => ({ id, username: name, global_name: name[0].toUpperCase() + name.slice(1), avatar: null, discriminator: '0', ...extra });

// ---------------------------------------------------------------- Gateway
test('Gateway : HELLO → IDENTIFY → READY → GUILD_CREATE → membres → PRESENCE_UPDATE, battements, reprise', async () => {
  let seq = 0, conns = 0, identifies = 0, resumes = 0, beats = 0;
  const S = (t, d) => ({ op: 0, t, s: ++seq, d });
  const gwSrv = await startFakeGateway((c) => {
    conns++;
    c.send({ op: 10, d: { heartbeat_interval: 60 } });
    c.on((m) => {
      if (m.op === 1) { beats++; assert.ok(m.d === null || typeof m.d === 'number'); c.send({ op: 11 }); }
      if (m.op === 2) {
        identifies++;
        assert.strictEqual(m.d.token, TOKEN);
        assert.strictEqual(m.d.intents, INTENTS);
        assert.strictEqual(INTENTS, 259);
        c.send(S('READY', { v: 10, session_id: 'sess1', resume_gateway_url: gwSrv.base, user: u('900', 'rrbot', { bot: true }), guilds: [{ id: 'g1', unavailable: true }] }));
        c.send(S('GUILD_CREATE', {
          id: 'g1', name: 'Les potes', member_count: 4,
          members: [{ user: u('900', 'rrbot', { bot: true }) }, { user: u('1', 'alice'), nick: 'Ali' }],
          presences: [{ user: { id: '1' }, status: 'online', activities: [{ type: 0, name: 'Hades', details: 'Salle 12', timestamps: { start: 1700000000000 } }], client_status: { desktop: 'online' } }],
        }));
      }
      if (m.op === 8) {
        assert.deepStrictEqual({ g: m.d.guild_id, q: m.d.query, l: m.d.limit, p: m.d.presences }, { g: 'g1', q: '', l: 0, p: true });
        c.send(S('GUILD_MEMBERS_CHUNK', { guild_id: 'g1', chunk_index: 0, chunk_count: 1, members: [{ user: u('2', 'bob') }, { user: u('3', 'carol') }], presences: [{ user: { id: '2' }, status: 'idle', activities: [] }] }));
        c.send(S('PRESENCE_UPDATE', { guild_id: 'g1', user: { id: '3' }, status: 'dnd', activities: [{ type: 1, name: 'Twitch', url: 'https://twitch.tv/carol', state: 'Elden Ring', details: 'Run sans mort' }] }));
      }
      if (m.op === 6) {
        resumes++;
        assert.strictEqual(m.d.session_id, 'sess1');
        assert.strictEqual(m.d.token, TOKEN);
        assert.ok(m.d.seq >= 4);
        c.send(S('RESUMED', {}));
        c.send(S('PRESENCE_UPDATE', { guild_id: 'g1', user: { id: '2' }, status: 'online', activities: [{ type: 0, name: 'Celeste', created_at: Date.now() }] }));
      }
    });
    if (conns === 1) setTimeout(() => c.close(4000), 400); // coupure côté serveur : le client doit reprendre la session
  });
  const st = createDiscordState();
  const states = [];
  const logs = [];
  const gw = createGateway({
    token: TOKEN, url: gwSrv.url, backoff: [30], random: () => 0.1, log: (m) => logs.push(m),
    onStatus: (s) => states.push(s.state),
    onDispatch: (t, d) => { const r = st.apply(t, d); for (const g of r.request || []) gw.requestMembers(g); },
  });
  gw.start();
  await until(() => st.friends().find((f) => f.id === '3')?.activity);
  let fr = st.friends();
  assert.strictEqual(fr.length, 3, 'le bot est exclu');
  const ali = fr.find((f) => f.id === '1');
  assert.strictEqual(ali.name, 'Ali');
  assert.strictEqual(ali.activity.name, 'Hades');
  assert.strictEqual(ali.activity.since, 1700000000000);
  const carol = fr.find((f) => f.id === '3');
  assert.strictEqual(carol.activity.kind, 'streaming');
  assert.strictEqual(carol.activity.name, 'Elden Ring');
  assert.strictEqual(carol.activity.url, 'https://twitch.tv/carol');
  assert.strictEqual(fr.find((f) => f.id === '2').status, 'idle');
  await until(() => beats >= 2);
  await until(() => resumes === 1 && st.friends().find((f) => f.id === '2').activity);
  assert.strictEqual(identifies, 1, 'reprise sans nouvel IDENTIFY');
  assert.strictEqual(conns, 2);
  assert.strictEqual(st.friends().find((f) => f.id === '2').activity.name, 'Celeste');
  assert.ok(states.includes('ready') && states.includes('waiting') && states.includes('resuming'));
  assert.ok(!logs.join('\n').includes(TOKEN), 'jeton jamais journalisé');
  gw.stop();
  assert.strictEqual(gw.status.state, 'idle');
  await gwSrv.close();
});

test('Gateway : intents refusés (4014) → erreur sans nouvelle tentative', async () => {
  let conns = 0;
  const srv = await startFakeGateway((c) => { conns++; c.send({ op: 10, d: { heartbeat_interval: 1000 } }); c.on((m) => { if (m.op === 2) c.close(4014); }); });
  const gw = createGateway({ token: TOKEN, url: srv.url, backoff: [20], random: () => 0.5 });
  gw.start();
  await until(() => gw.status.state === 'error');
  assert.match(gw.status.error, /Presence Intent/);
  await wait(150);
  assert.strictEqual(conns, 1);
  await srv.close();
});

test('Gateway : battement sans ACK (connexion zombie) → reconnexion et RESUME ; op 7 RECONNECT', async () => {
  let conns = 0, resumes = 0;
  const srv = await startFakeGateway((c) => {
    conns++;
    c.send({ op: 10, d: { heartbeat_interval: 40 } });
    c.on((m) => {
      if (m.op === 2) c.send({ op: 0, t: 'READY', s: 1, d: { session_id: 'z', resume_gateway_url: srv.base, user: u('9', 'bot', { bot: true }), guilds: [] } });
      if (m.op === 6) { resumes++; c.send({ op: 0, t: 'RESUMED', s: 2, d: {} }); if (resumes === 1) setTimeout(() => c.send({ op: 7, d: null }), 30); }
      if (m.op === 1 && conns > 1) c.send({ op: 11 }); // la 1re connexion n'accuse jamais réception
    });
  });
  const gw = createGateway({ token: TOKEN, url: srv.url, backoff: [20], random: () => 0.1 });
  gw.start();
  await until(() => resumes >= 2, 4000);
  assert.ok(conns >= 3);
  assert.strictEqual(gw.status.state, 'ready');
  gw.stop();
  await srv.close();
});

test('Gateway : INVALID_SESSION non reprenable → nouvel IDENTIFY', async () => {
  let identifies = 0;
  const srv = await startFakeGateway((c) => {
    c.send({ op: 10, d: { heartbeat_interval: 1000 } });
    c.on((m) => { if (m.op === 2 && ++identifies === 1) c.send({ op: 9, d: false }); else if (m.op === 2) c.send({ op: 0, t: 'READY', s: 1, d: { session_id: 'n', user: u('9', 'b', { bot: true }), guilds: [] } }); });
  });
  const gw = createGateway({ token: TOKEN, url: srv.url, backoff: [20], random: () => 0 });
  gw.start();
  await until(() => gw.status.state === 'ready', 8000);
  assert.strictEqual(identifies, 2);
  gw.stop();
  await srv.close();
});

// ---------------------------------------------------------------- État Discord
test('État Discord : départs, mise hors ligne, avatars, activité principale', () => {
  const st = createDiscordState();
  st.apply('READY', { user: { id: '9' } });
  st.apply('GUILD_CREATE', { id: 'g', name: 'G', member_count: 2, members: [{ user: u('1', 'a', { avatar: 'abc' }) }, { user: u('2', 'b') }], presences: [] });
  assert.strictEqual(st.friends().length, 2);
  assert.strictEqual(st.friends()[0].status, 'offline');
  st.apply('PRESENCE_UPDATE', { guild_id: 'g', user: { id: '1' }, status: 'online', activities: [{ type: 4, state: 'Dispo' }, { type: 2, name: 'Spotify', details: 'Titre', state: 'Artiste' }] });
  let a = st.friends().find((f) => f.id === '1');
  assert.strictEqual(a.custom, 'Dispo');
  assert.strictEqual(a.activity.kind, 'listening');
  assert.strictEqual(a.avatar, 'https://cdn.discordapp.com/avatars/1/abc.png?size=128');
  st.apply('PRESENCE_UPDATE', { guild_id: 'g', user: { id: '1' }, status: 'offline', activities: [{ type: 0, name: 'X' }] });
  a = st.friends().find((f) => f.id === '1');
  assert.strictEqual(a.activity, null);
  st.apply('GUILD_MEMBER_REMOVE', { guild_id: 'g', user: { id: '2' } });
  assert.strictEqual(st.friends().length, 1);
  assert.match(avatarUrl({ id: '175928847299117063', avatar: null, discriminator: '0' }), /embed\/avatars\/[0-5]\.png$/);
  assert.strictEqual(mainActivity([{ type: 2, name: 'Spotify' }, { type: 0, name: 'Hades', timestamps: { start: 1700000000 } }]).since, 1700000000000);
  assert.strictEqual(mainActivity([{ type: 0, name: 'Hades' }, { type: 1, name: 'Twitch', url: 'u' }]).streaming, true);
  st.apply('GUILD_DELETE', { id: 'g' });
  assert.strictEqual(st.friends().length, 0);
});

// ---------------------------------------------------------------- Steam
test('Steam : GetFriendList + GetPlayerSummaries → amis, jeu en cours, « depuis »', async () => {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (url.includes('GetFriendList')) return { status: 200, json: { friendslist: { friends: [{ steamid: '76561198000000001', relationship: 'friend' }, { steamid: '76561198000000002' }, { steamid: '76561198000000003' }] } } };
    return { status: 200, json: { response: { players: [
      { steamid: '76561198000000001', personaname: 'Zoé', personastate: 1, gameextrainfo: 'Hades', gameid: '1145360', avatarfull: 'https://avatars.steamstatic.com/a_full.jpg' },
      { steamid: '76561198000000002', personaname: 'Max', personastate: 3 },
      { steamid: '76561198000000003', personaname: 'Léa', personastate: 0, lastlogoff: 1700000000 },
    ] } } };
  };
  const seen = new Map();
  let list = await steamFriends(get, { key: 'K', steamId: '76561198000000000', seen, primed: false });
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1], /steamids=76561198000000001%2C76561198000000002%2C76561198000000003/);
  const z = list.find((f) => f.name === 'Zoé');
  assert.deepStrictEqual([z.status, z.activity.name, z.activity.appid, z.activity.since], ['online', 'Hades', 1145360, null]);
  assert.strictEqual(list.find((f) => f.name === 'Max').status, 'idle');
  assert.strictEqual(list.find((f) => f.name === 'Léa').lastSeen, 1700000000000);
  list = await steamFriends(get, { key: 'K', steamId: 'S', seen, primed: true, now: 5 });
  assert.strictEqual(list.find((f) => f.name === 'Zoé').activity.since, null, 'heure inconnue conservée');
  // Nouveau jeu observé → heure du relevé ; raccourci non-Steam (gameid 64 bits) → pas d'appid
  const f = toFriend({ steamid: 'x', personastate: 1, gameextrainfo: 'Mon émulateur', gameid: '12905442918416850944' }, seen, 1234, true);
  assert.deepStrictEqual([f.activity.since, f.activity.appid], [1234, 0]);
  await assert.rejects(steamFriends(async () => ({ status: 401, json: null }), { key: 'K', steamId: 'S' }), /privée/);
  await assert.rejects(steamFriends(get, { key: '', steamId: 'S' }), /clé API/);
});

// ---------------------------------------------------------------- Modèle
test('Modèle : correspondance bibliothèque, sections, tri, lancements', () => {
  const games = [{ id: 'pc-0', name: 'Hades' }, { id: 'pc-1', name: 'ELDEN RING™' }, { id: 'st-1', name: 'Celeste', appid: 504230 }];
  assert.strictEqual(model.norm('The Witcher® 3: Wild Hunt – GOTY Edition'), 'thewitcher3wildhunt');
  const idx = model.libraryIndex(games);
  assert.strictEqual(model.matchGame({ kind: 'playing', name: 'Elden Ring' }, idx).id, 'pc-1');
  assert.strictEqual(model.matchGame({ kind: 'playing', name: 'Elden Ring Nightreign' }, idx), null);
  assert.strictEqual(model.matchGame({ kind: 'playing', name: 'Hades: Battle Out of Hell' }, idx).id, 'pc-0');
  assert.strictEqual(model.matchGame({ kind: 'playing', name: 'Autre', appid: 504230 }, idx).id, 'st-1');
  assert.strictEqual(model.matchGame({ kind: 'listening', name: 'Hades' }, idx), null);
  const P = (key, name, activity, status = 'online', extra = {}) => ({ key, name, source: key.slice(0, 2) === 'st' ? 'steam' : 'discord', status, activity, ...extra });
  const list = [
    P('dc:1', 'Bob', { kind: 'playing', name: 'Minecraft', since: 300 }),
    P('dc:2', 'Ali', { kind: 'playing', name: 'Hades', since: 100 }),
    P('dc:3', 'Cam', { kind: 'streaming', name: 'Inconnu', since: 200 }),
    P('dc:4', 'Dan', null, 'dnd'),
    P('dc:5', 'Eve', { kind: 'listening', name: 'Spotify' }, 'idle'),
    P('st:6', 'Fay', null, 'offline', { lastSeen: 10 }),
    P('st:7', 'Gus', null, 'offline', { lastSeen: 20 }),
    P('dc:8', 'Hal', null),
  ];
  const b = model.build(list, games, { hidden: new Set(['dc:8']) });
  assert.deepStrictEqual(b.playing.map((f) => f.name), ['Ali', 'Cam', 'Bob']);
  assert.strictEqual(b.playing[0].gameId, 'pc-0');
  assert.strictEqual(b.playing[1].streaming, true);
  assert.deepStrictEqual(b.online.map((f) => f.name), ['Eve', 'Dan']);
  assert.deepStrictEqual(b.offline.map((f) => f.name), ['Gus', 'Fay']);
  const prev = model.playingMap(list);
  const next = list.map((f) => (f.key === 'dc:4' ? { ...f, activity: { kind: 'playing', name: 'Celeste' } } : f.key === 'dc:1' ? { ...f, activity: { kind: 'playing', name: 'Tetris' } } : f));
  assert.deepStrictEqual(model.started(prev, next).map((f) => f.key), ['dc:1', 'dc:4']);
});

test('Jeton du bot : nettoyage et format', () => {
  assert.strictEqual(cleanToken(` Bot ${TOKEN} `), TOKEN);
  assert.ok(TOKEN_RE.test(TOKEN));
  assert.ok(!TOKEN_RE.test('1234567890123456789'));
});

test('merge : même pseudo entre sources et liens manuels', () => {
  const mk = (key, source, name, extra = {}) => ({ key, source, name, status: 'offline', activity: null, ...extra });
  const list = [mk('rr:1', 'rr', 'Miky', { status: 'online' }), mk('st:9', 'steam', 'Raiden_Nika', { status: 'online', activity: { kind: 'playing', name: 'REMATCH' } }), mk('dc:3', 'discord', 'miky')];
  let out = model.merge(list, []);
  assert.strictEqual(out.length, 2); // rr + discord « miky » fusionnés
  out = model.merge(list, [['rr:1', 'st:9']]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Miky');
  assert.strictEqual(out[0].key, 'rr:1');
  assert.strictEqual(out[0].activity.name, 'REMATCH');
  assert.deepStrictEqual(out[0].keys.sort(), ['dc:3', 'rr:1', 'st:9']);
});

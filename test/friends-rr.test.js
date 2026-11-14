// AMIS RR LAUNCHER (Firebase) : statistiques partagées, format des amis, codes ami, puis un parcours complet
// contre une fausse base Firebase qui applique les mêmes règles que firebase/database.rules.json :
// deux joueurs, ajout par code, demande acceptée, présence « en jeu », statistiques visibles, retrait.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createRR, statsOf, toItem, normCode, newCode, CODE_RE, ONLINE_MS } = require('../src/features/friends/rr');

test('statsOf : temps total, top 10 et derniers jeux', () => {
  const now = Date.now();
  const games = [
    { name: 'A', platform: 'n64', playtime: 3600, lastPlayed: now - 1000 },
    { name: 'B', platform: 'pc', playtime: 7200, lastPlayed: now - 10 * 864e5, source: 'recomp' },
    { name: 'C', platform: 'ps2' },
  ];
  const s = statsOf(games, { platName: (p) => p.toUpperCase(), now });
  assert.equal(s.total, 10800);
  assert.equal(s.count, 3);
  assert.equal(s.played, 2);
  assert.deepEqual(s.top.map((x) => x.name), ['B', 'A']);
  assert.equal(s.top[0].recomp, true);
  assert.equal(s.top[1].pname, 'N64');
  assert.deepEqual(s.recent.map((x) => x.name), ['A', 'B']);
  assert.equal(s.recentWeek, 1);
});

test('toItem : en ligne, en jeu, hors ligne, en attente', () => {
  const now = Date.now();
  const u = { name: 'Léo', code: 'ABCD2345' };
  const p = toItem('u1', u, { state: 'playing', game: { name: 'Zelda', pname: 'N64' }, since: now - 5000, at: now - 1000 }, { now });
  assert.equal(p.key, 'rr:u1'); assert.equal(p.source, 'rr'); assert.equal(p.status, 'online');
  assert.equal(p.activity.name, 'Zelda');
  assert.equal(toItem('u1', u, { state: 'online', at: now - ONLINE_MS - 1 }, { now }).status, 'offline');
  assert.equal(toItem('u1', u, { state: 'offline', at: now }, { now }).status, 'offline');
  const pic = toItem('u2', { name: 'Zoé', img: 'data:image/jpeg;base64,AAA', av: { g: 'leaf', c: '#ff0000' } }, null, { now });
  assert.equal(pic.avatar, 'data:image/jpeg;base64,AAA'); assert.deepEqual(pic.av, { g: 'leaf', c: '#ff0000' });
  assert.equal(toItem('u3', { name: 'X', img: 'javascript:alert(1)', av: { g: 'star', c: 'red;x' } }, null, { now }).avatar, null);
  assert.equal(toItem('u3', { name: 'X', av: { g: 'star', c: 'red;x' } }, null, { now }).av.c, '#3C91E6');
  const w = toItem('u1', u, null, { now, pending: true });
  assert.equal(w.pending, true); assert.equal(w.activity, null);
});

test('codes ami : format et saisie tolérante', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), CODE_RE);
  assert.equal(normCode(' k7qm-2xpa '), 'K7QM2XPA');
  assert.ok(!CODE_RE.test(normCode('K7QM-2XP')));
  assert.ok(!CODE_RE.test('K7QM2XP0')); // 0 exclu (confusion avec O)
});

// ---- Fausse Firebase : auth anonyme + base REST avec les règles du projet
function fakeFirebase() {
  const data = {};
  let n = 0;
  const tokens = new Map();
  const get = (path) => path.reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (path, v) => {
    let o = data;
    for (const k of path.slice(0, -1)) o = (o[k] ||= {});
    if (v === null) delete o[path.at(-1)]; else o[path.at(-1)] = v;
  };
  const isFriend = (owner, who) => !!get(['friends', owner, who]);
  function allowed(method, p, uid, v) {
    const [root, a, b] = p;
    const read = method === 'GET';
    if (root === 'codes') return read || (get(p) === undefined && v === uid && CODE_RE.test(a));
    if (root === 'users') return read || a === uid;
    if (root === 'friends') return a === uid;
    if (root === 'requests') return read ? a === uid : (b === uid || a === uid);
    if (root === 'presence' || root === 'stats') return read ? (a === uid || isFriend(a, uid)) : a === uid;
    return false;
  }
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  async function fetchImpl(url, opts) {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (u.host === 'identitytoolkit.googleapis.com') {
      const uid = `uid${++n}`, t = `tok-${uid}`;
      tokens.set(t, uid);
      return json(200, { idToken: t, refreshToken: `ref-${uid}`, localId: uid, expiresIn: '3600' });
    }
    if (u.host === 'securetoken.googleapis.com') {
      const uid = body.refresh_token.replace('ref-', '');
      tokens.set(`tok-${uid}`, uid);
      return json(200, { id_token: `tok-${uid}`, refresh_token: body.refresh_token, user_id: uid, expires_in: '3600' });
    }
    const uid = tokens.get(u.searchParams.get('auth'));
    if (!uid) return json(401, { error: 'Permission denied' });
    const p = u.pathname.replace(/^\/|\.json$/g, '').split('/');
    const resolve = (x) => (x && typeof x === 'object' ? (x['.sv'] === 'timestamp' ? Date.now() : Object.fromEntries(Object.entries(x).map(([k, y]) => [k, resolve(y)]))) : x);
    const v = opts.method === 'DELETE' ? null : resolve(body);
    if (!allowed(opts.method, p, uid, v)) return json(401, { error: 'Permission denied' });
    if (opts.method === 'GET') return json(200, get(p) ?? null);
    set(p, v);
    return json(200, v);
  }
  return { fetchImpl, data };
}

function player(fb, name, games = [], card = {}) {
  const store = { data: { settings: {} }, save() {} };
  const rr = createRR({
    fetchImpl: fb.fetchImpl, store, profileName: () => name, gamesFn: () => games, profileCard: () => card.v || {},
    getConfig: () => ({ apiKey: 'k', databaseURL: 'https://rr-test.firebaseio.com' }),
  });
  return { rr, store };
}

test('parcours complet : code, demande, acceptation, présence, statistiques, retrait', async () => {
  const fb = fakeFirebase();
  const card = { v: { av: { g: 'star', c: '#3C91E6' } } };
  const a = player(fb, 'Robin', [{ name: 'Zelda', platform: 'n64', playtime: 5000, lastPlayed: Date.now() }], card);
  const b = player(fb, 'Léo');
  await a.rr.start(); await b.rr.start();
  try {
    assert.equal(a.rr.info().state, 'ok');
    const codeA = a.rr.info().code, codeB = b.rr.info().code;
    assert.match(codeA, CODE_RE);
    assert.notEqual(codeA, codeB);

    assert.equal((await a.rr.add(codeA)).ok, false); // son propre code
    assert.equal((await a.rr.add('ZZZZ2222')).error, 'Aucun joueur avec ce code');

    const r = await a.rr.add(codeB.slice(0, 4) + '-' + codeB.slice(4).toLowerCase());
    assert.deepEqual(r, { ok: true, name: 'Léo', pending: true }); // Léo ne l'a pas encore accepté

    await b.rr.refresh();
    assert.deepEqual(b.rr.requests().map((q) => q.name), ['Robin']);
    assert.equal((await a.rr.stats(b.store.data.rrFriends.uid)), null); // Léo n'a pas accepté : Robin ne voit rien de lui

    await b.rr.accept(a.store.data.rrFriends.uid);
    assert.equal(b.rr.requests().length, 0);
    await a.rr.setPlaying({ name: 'Zelda', pname: 'Nintendo 64' });
    await b.rr.refresh(); await a.rr.refresh();
    const seen = b.rr.list()[0];
    assert.equal(seen.name, 'Robin'); assert.equal(seen.pending, false);
    assert.equal(seen.activity.name, 'Zelda');
    assert.deepEqual(seen.av, { g: 'star', c: '#3C91E6' });
    // nouvelle photo de profil : republiée au battement suivant
    card.v = { av: { g: 'star', c: '#3C91E6' }, img: 'data:image/jpeg;base64,QUJD' };
    await a.rr.setPlaying(null);
    await b.rr.refresh();
    assert.equal(b.rr.list()[0].avatar, 'data:image/jpeg;base64,QUJD');
    assert.equal(a.rr.list()[0].pending, false);

    const st = await b.rr.stats(a.store.data.rrFriends.uid);
    assert.equal(st.total, 5000); assert.equal(st.top[0].name, 'Zelda');

    // statistiques masquées
    a.store.data.settings.friendsRRStats = false;
    await a.rr.publishStats();
    assert.equal(fb.data.stats[a.store.data.rrFriends.uid], undefined);

    await b.rr.remove(a.store.data.rrFriends.uid);
    assert.equal(b.rr.list().length, 0);
    await a.rr.refresh();
    assert.equal(a.rr.list()[0].pending, true); // Léo l'a retiré : Robin ne voit plus son activité
  } finally { a.rr.stop(); b.rr.stop(); }
});

test('non configuré ou désactivé : aucun appel réseau', async () => {
  let calls = 0;
  const store = { data: { settings: {} }, save() {} };
  const rr = createRR({ fetchImpl: async () => { calls++; }, store, getConfig: () => ({}) });
  await rr.start();
  assert.equal(rr.info().state, 'unconfigured');
  const off = createRR({ fetchImpl: async () => { calls++; }, store: { data: { settings: { friendsRR: false } }, save() {} }, getConfig: () => ({ apiKey: 'k', databaseURL: 'https://x.firebaseio.com' }) });
  await off.start();
  assert.equal(off.info().state, 'off');
  assert.equal(calls, 0);
});

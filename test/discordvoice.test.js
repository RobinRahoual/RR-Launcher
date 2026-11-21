// DISCORDVOICE : client RPC contre un faux Discord (socket Unix), autorisation OAuth2, rejoindre / quitter / micro
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-dv-'));
process.env.XDG_RUNTIME_DIR = dir;
const { encode, decoder } = require('../src/features/discord');
const V = require('../src/features/discordvoice');

// Faux Discord : renvoie des réponses scénarisées ; `log` garde les commandes reçues
function fakeDiscord() {
  const st = { log: [], voice: null, mute: false, validToken: 'TOKEN1', authorizeDelay: 0 };
  const server = net.createServer((s) => {
    s.on('data', decoder((op, data) => {
      if (op === 0) return s.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'robin' } } }));
      if (op !== 1) return;
      const { cmd, args, nonce } = data;
      st.log.push({ cmd, args });
      const ok = (d) => s.write(encode(1, { cmd, data: d, evt: null, nonce }));
      const ko = (code, message) => s.write(encode(1, { cmd, evt: 'ERROR', data: { code, message }, nonce }));
      if (cmd === 'AUTHORIZE') return setTimeout(() => ok({ code: 'CODE123' }), st.authorizeDelay);
      if (cmd === 'AUTHENTICATE') return args.access_token === st.validToken ? ok({ user: { username: 'robin' } }) : ko(4009, 'Invalid token');
      if (cmd === 'GET_SELECTED_VOICE_CHANNEL') return ok(st.voice);
      if (cmd === 'SELECT_VOICE_CHANNEL') { st.voice = args.channel_id ? { id: args.channel_id, name: 'Salon' } : null; return ok(st.voice); }
      if (cmd === 'GET_VOICE_SETTINGS') return ok({ mute: st.mute });
      if (cmd === 'SET_VOICE_SETTINGS') { st.mute = !!args.mute; return ok({ mute: st.mute }); }
      if (cmd === 'GET_GUILDS') return ok({ guilds: [{ id: '111111111111111111', name: 'Mon serveur' }] });
      if (cmd === 'GET_CHANNELS') return ok({ channels: [{ id: '222222222222222222', name: 'Général', type: 2 }, { id: '333333333333333333', name: 'texte', type: 0 }, { id: '444444444444444444', name: 'Scène', type: 13 }] });
      ko(1000, 'inconnu');
    }));
  });
  return new Promise((res) => { try { fs.rmSync(path.join(dir, 'discord-ipc-0'), { force: true }); } catch {} server.listen(path.join(dir, 'discord-ipc-0'), () => res({ server, st })); });
}
const CLIENT = '123456789012345678';
const FAV = { id: '222222222222222222', name: 'Général' };
function setup(extra = {}) {
  const t = { tok: extra.tok ?? null };
  const fetchCalls = [];
  const fetchImpl = async (url, o) => {
    fetchCalls.push({ url, body: new URLSearchParams(o.body) });
    const grant = new URLSearchParams(o.body).get('grant_type');
    if (extra.refuseToken) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Code invalide' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: grant === 'refresh_token' ? 'TOKEN1' : 'TOKEN1', refresh_token: 'REFRESH1', expires_in: 604800 }) };
  };
  const voice = V.createVoice({ cfg: () => ({ clientId: extra.clientId ?? CLIENT, clientSecret: extra.secret ?? 'secret' }), tokens: { get: () => t.tok, set: (x) => { t.tok = x; } }, fetchImpl, launch: extra.launch, sleep: async () => {}, launchWait: extra.launchWait });
  return { voice, t, fetchCalls };
}

test('planToggle : quitter si en vocal, rejoindre sinon, erreur sans salon favori', () => {
  assert.strictEqual(V.planToggle({ id: '1', name: 'x' }, FAV).action, 'leave');
  assert.deepStrictEqual(V.planToggle(null, FAV), { action: 'join', channel: FAV });
  assert.strictEqual(V.planToggle(null, null).action, 'none');
  assert.match(V.planToggle(null, null).error, /salon vocal/);
});

test('configuration manquante : messages clairs, sans toucher à Discord', async () => {
  await assert.rejects(setup({ clientId: '' }).voice.toggle(FAV), /ID d’application/);
  await assert.rejects(setup({ secret: '' }).voice.toggle(FAV), /Secret/);
});

test('Discord fermé : erreur explicite', async () => {
  fs.rmSync(path.join(dir, 'discord-ipc-0'), { force: true });
  await assert.rejects(setup().voice.toggle(FAV), /pas ouvert/);
});

test('première autorisation : AUTHORIZE → échange du code → AUTHENTICATE, jeton conservé', async () => {
  const { server, st } = await fakeDiscord();
  try {
    const { voice, t, fetchCalls } = setup();
    await assert.rejects(voice.toggle(FAV), /Connecter le vocal/);             // pas d'autorisation : pas d'invite surprise
    await voice.connect();
    const auth = st.log.find((c) => c.cmd === 'AUTHORIZE');
    assert.deepStrictEqual(auth.args, { client_id: CLIENT, scopes: ['rpc', 'rpc.voice.write'] });
    assert.strictEqual(fetchCalls[0].url, 'https://discord.com/api/oauth2/token');
    assert.strictEqual(fetchCalls[0].body.get('grant_type'), 'authorization_code');
    assert.strictEqual(fetchCalls[0].body.get('code'), 'CODE123');
    assert.strictEqual(fetchCalls[0].body.get('redirect_uri'), 'http://127.0.0.1');
    assert.strictEqual(fetchCalls[0].body.get('client_secret'), 'secret');
    assert.strictEqual(t.tok.access, 'TOKEN1');
    assert.strictEqual(t.tok.refresh, 'REFRESH1');
    voice.logout();
  } finally { server.close(); }
});

test('rejoindre puis quitter avec le même appui ; micro bascule', async () => {
  const { server, st } = await fakeDiscord();
  try {
    const { voice } = setup({ tok: { access: 'TOKEN1', refresh: 'R', expiresAt: Date.now() + 3600e3 } });
    let r = await voice.toggle(FAV);
    assert.deepStrictEqual(r, { ok: true, joined: true, name: 'Général' });
    assert.strictEqual(st.voice.id, FAV.id);
    r = await voice.toggle(FAV);
    assert.strictEqual(r.joined, false);
    assert.strictEqual(st.voice, null);
    assert.strictEqual((await voice.mute()).muted, true);
    assert.strictEqual((await voice.mute()).muted, false);
    assert.strictEqual((await voice.toggle(null)).ok, false); // rien à rejoindre sans salon favori
    voice.logout();
  } finally { server.close(); }
});

test('jeton refusé → renouvellement par refresh_token', async () => {
  const { server, st } = await fakeDiscord();
  try {
    st.validToken = 'TOKEN1';
    const { voice, t, fetchCalls } = setup({ tok: { access: 'PERIME', refresh: 'REFRESH0', expiresAt: Date.now() + 3600e3 } });
    const r = await voice.toggle(FAV);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fetchCalls[0].body.get('grant_type'), 'refresh_token');
    assert.strictEqual(fetchCalls[0].body.get('refresh_token'), 'REFRESH0');
    assert.strictEqual(t.tok.access, 'TOKEN1');
    voice.logout();
  } finally { server.close(); }
});

test('échange du code refusé : message de Discord remonté', async () => {
  const { server } = await fakeDiscord();
  try {
    const { voice } = setup({ refuseToken: true });
    await assert.rejects(voice.connect(), /Code invalide/);
    voice.logout();
  } finally { server.close(); }
});

test('salons vocaux : uniquement vocal et scène', async () => {
  const { server } = await fakeDiscord();
  try {
    const { voice } = setup({ tok: { access: 'TOKEN1', refresh: '', expiresAt: Date.now() + 3600e3 } });
    const list = await voice.channels();
    assert.deepStrictEqual(list.map((c) => [c.guild, c.name]), [['Mon serveur', 'Général'], ['Mon serveur', 'Scène']]);
    voice.logout();
  } finally { server.close(); }
});

test('Discord fermé : il est lancé puis le salon est rejoint', async () => {
  fs.rmSync(path.join(dir, 'discord-ipc-0'), { force: true });
  let fake = null, launched = 0;
  const { voice } = setup({ tok: { access: 'TOKEN1', refresh: 'R', expiresAt: Date.now() + 3600e3 }, launchWait: 6000, launch: async () => { launched++; fake = await fakeDiscord(); } });
  try {
    const r = await voice.toggle(FAV);
    assert.strictEqual(launched, 1);
    assert.deepStrictEqual(r, { ok: true, joined: true, name: 'Général' });
    voice.logout();
  } finally { fake?.server.close(); }
});

test('Discord ne démarre jamais : erreur après l’attente', async () => {
  fs.rmSync(path.join(dir, 'discord-ipc-0'), { force: true });
  const { voice } = setup({ launchWait: 4000, launch: async () => {} });
  await assert.rejects(voice.toggle(FAV), /pas ouvert/);
});

test('peek : état réel sans jamais lancer Discord', async () => {
  fs.rmSync(path.join(dir, 'discord-ipc-0'), { force: true });
  let launched = 0;
  const closed = setup({ launch: async () => { launched++; } });
  assert.deepStrictEqual(await closed.voice.peek(), { discord: false });
  assert.strictEqual(launched, 0);
  const { server, st } = await fakeDiscord();
  try {
    const { voice } = setup({ tok: { access: 'TOKEN1', refresh: 'R', expiresAt: Date.now() + 3600e3 } });
    assert.deepStrictEqual(await voice.peek(), { discord: true, authed: true, inVoice: false, name: '', muted: false });
    await voice.toggle(FAV); st.mute = true;
    assert.deepStrictEqual(await voice.peek(), { discord: true, authed: true, inVoice: true, name: 'Salon', muted: true });
    voice.logout();
  } finally { server.close(); }
});

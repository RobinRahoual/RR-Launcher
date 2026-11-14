// DISCORDVOICE — rejoindre / quitter un salon vocal Discord et couper le micro, à la manette (Guide + X, Guide + A)
// ou depuis le menu en jeu, sans quitter le jeu.
//
// Méthode : protocole RPC local de Discord (le même tube que la Rich Presence, voir discord.js) avec les commandes
// SELECT_VOICE_CHANNEL / GET_SELECTED_VOICE_CHANNEL / SET_VOICE_SETTINGS. Discord exige pour cela une autorisation
// OAuth2 (scopes rpc + rpc.voice.write) : à faire UNE fois depuis Réglages → Discord → « Connecter le vocal » (Discord affiche
// une fenêtre « Autoriser »). Il faut l'ID et le secret de TA propre application Discord (celle de la Rich Presence), avec
// l'adresse de redirection http://127.0.0.1 ajoutée dans OAuth2 → Redirects. Le compte propriétaire de l'application a accès
// au RPC sans validation de Discord. Le jeton est conservé dans la bibliothèque locale (store.data.discordVoice).
//
// Réglages : discordClientId (partagé avec la Rich Presence), discordClientSecret, discordVoiceChannel { id, name, guild },
// discordVoicePad (défaut oui). Canaux : x:discordvoice:status | connect | channels | setChannel | toggle | mute | logout.
'use strict';
const net = require('net');
const path = require('path');
const { encode, decoder } = require('./discord');

const REDIRECT = 'http://127.0.0.1';
const SCOPES = ['rpc', 'rpc.voice.write'];
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

const pipePath = (i) => (process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `discord-ipc-${i}`));

// Décision (pure) : un appui = quitter si on est en vocal, sinon rejoindre le salon choisi
function planToggle(selected, favorite) {
  if (selected && selected.id) return { action: 'leave', from: selected };
  if (!favorite?.id) return { action: 'none', error: 'Choisis d’abord un salon vocal (Réglages → Discord)' };
  return { action: 'join', channel: favorite };
}

class RpcError extends Error { constructor(message, code) { super(message); this.code = code; } }

function createRpc({ log = () => {}, defaultTimeout = 8000 } = {}) {
  let sock = null, ready = false, clientId = null, connecting = null;
  const pending = new Map();
  const nonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function fail(err) { for (const p of pending.values()) { clearTimeout(p.t); p.reject(err); } pending.clear(); }
  function close() {
    ready = false;
    if (sock) { try { sock.destroy(); } catch {} sock = null; }
    fail(new RpcError('Connexion à Discord fermée'));
  }
  function connect(id) {
    if (ready && clientId === id) return Promise.resolve(true);
    if (connecting) return connecting;
    close();
    clientId = id;
    connecting = new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (i > 9) { connecting = null; return resolve(false); }
        const s = net.createConnection(pipePath(i++));
        let settled = false;
        const bad = () => { if (settled) return; settled = true; s.destroy(); next(); };
        s.once('error', bad);
        s.setTimeout(3000, bad);
        s.once('connect', () => {
          s.setTimeout(0);
          s.on('data', decoder((op, data) => {
            if (op === OP.PING) return s.write(encode(OP.PONG, data));
            if (op === OP.CLOSE) { log(`discord vocal : fermé (${data?.message || ''})`); return close(); }
            if (op !== OP.FRAME || !data) return;
            if (data.evt === 'READY' && !ready) { ready = true; settled = true; connecting = null; log('discord vocal : connecté'); return resolve(true); }
            const p = data.nonce && pending.get(data.nonce);
            if (!p) return;
            pending.delete(data.nonce); clearTimeout(p.t);
            if (data.evt === 'ERROR') p.reject(new RpcError(data.data?.message || 'Erreur Discord', data.data?.code));
            else p.resolve(data.data);
          }));
          s.on('close', () => { if (sock === s) { ready = false; sock = null; fail(new RpcError('Connexion à Discord fermée')); } });
          s.removeListener('error', bad);
          s.on('error', () => {});
          sock = s;
          s.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(id) }));
          setTimeout(() => { if (!ready && !settled) { settled = true; connecting = null; close(); resolve(false); } }, 5000);
        });
      };
      next();
    });
    return connecting;
  }
  function request(cmd, args = {}, timeout = defaultTimeout) {
    return new Promise((resolve, reject) => {
      if (!ready || !sock) return reject(new RpcError('Discord n’est pas connecté'));
      const n = nonce();
      const t = setTimeout(() => { pending.delete(n); reject(new RpcError(`Discord n’a pas répondu (${cmd})`)); }, timeout);
      pending.set(n, { resolve, reject, t });
      sock.write(encode(OP.FRAME, { cmd, args, nonce: n }));
    });
  }
  return { connect, request, close, get ready() { return ready; } };
}

/**
 * Client haut niveau. cfg() → { clientId, clientSecret } ; tokens = { get(), set(t) } ; fetchImpl : fetch du jeton OAuth2.
 */
function createVoice({ log = () => {}, cfg, tokens, fetchImpl = globalThis.fetch, rpc = createRpc({ log }), now = () => Date.now() }) {
  let authed = false;

  async function oauth(params) {
    const { clientId, clientSecret } = cfg();
    const r = await fetchImpl('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new RpcError(j.error_description || j.error || `Jeton refusé (${r.status})`);
    const t = { access: j.access_token, refresh: j.refresh_token || '', expiresAt: now() + (Number(j.expires_in) || 604800) * 1000 };
    tokens.set(t);
    return t;
  }

  // Connexion + authentification (autorisation interactive la première fois ou si le jeton est perdu)
  async function ensure({ interactive = false } = {}) {
    const { clientId, clientSecret } = cfg();
    if (!/^\d{15,22}$/.test(clientId || '')) throw new RpcError('ID d’application Discord manquant (Réglages → Discord)');
    if (!clientSecret) throw new RpcError('Secret de l’application Discord manquant (Réglages → Discord)');
    if (!(await rpc.connect(clientId))) { authed = false; throw new RpcError('Discord n’est pas ouvert (application de bureau)'); }
    if (authed && rpc.ready) return;
    authed = false;
    let t = tokens.get();
    const tryAuth = async (tok) => { await rpc.request('AUTHENTICATE', { access_token: tok.access }); authed = true; };
    if (t?.access && t.expiresAt > now() + 60000) { try { await tryAuth(t); return; } catch (e) { log(`discord vocal : jeton refusé (${e.message})`); } }
    if (t?.refresh) {
      try { t = await oauth({ grant_type: 'refresh_token', refresh_token: t.refresh }); await tryAuth(t); return; } catch (e) { log(`discord vocal : renouvellement impossible (${e.message})`); }
    }
    if (!interactive) throw new RpcError('Vocal non autorisé : clique sur « Connecter le vocal » dans Réglages → Discord');
    const a = await rpc.request('AUTHORIZE', { client_id: clientId, scopes: SCOPES }, 60000); // fenêtre « Autoriser » dans Discord
    t = await oauth({ grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT });
    await tryAuth(t);
  }

  const selected = async () => (await rpc.request('GET_SELECTED_VOICE_CHANNEL')) || null;
  async function toggle(favorite) {
    await ensure();
    const cur = await selected();
    const plan = planToggle(cur, favorite);
    if (plan.action === 'none') return { ok: false, error: plan.error };
    if (plan.action === 'leave') { await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: null, force: true }); return { ok: true, joined: false, was: cur.name || '' }; }
    await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: plan.channel.id, timeout: 15, force: true }, 20000);
    return { ok: true, joined: true, name: plan.channel.name || '' };
  }
  async function mute() {
    await ensure();
    const v = await rpc.request('GET_VOICE_SETTINGS');
    const want = !v?.mute;
    await rpc.request('SET_VOICE_SETTINGS', { mute: want });
    return { ok: true, muted: want };
  }
  // Salons vocaux de tous les serveurs : [{ guild, id, name }]
  async function channels() {
    await ensure();
    const { guilds = [] } = (await rpc.request('GET_GUILDS')) || {};
    const out = [];
    for (const g of guilds) {
      const { channels: ch = [] } = (await rpc.request('GET_CHANNELS', { guild_id: g.id }).catch(() => ({}))) || {};
      for (const c of ch) if (c.type === 2 || c.type === 13) out.push({ guild: g.name, id: c.id, name: c.name });
    }
    return out;
  }
  const connect = async () => { await ensure({ interactive: true }); return { ok: true }; };
  const logout = () => { tokens.set(null); authed = false; rpc.close(); };
  return { ensure, connect, toggle, mute, channels, selected, logout, planToggle, get authed() { return authed; } };
}

function init(ctx) {
  const { ipcMain, store, hub, commit, log } = ctx;
  const S = () => store.data.settings;
  if (S().discordVoicePad === undefined) S().discordVoicePad = true;
  const cfg = () => ({ clientId: String(S().discordClientId || '').trim(), clientSecret: String(S().discordClientSecret || '').trim() });
  const tokens = { get: () => store.data.discordVoice || null, set: (t) => { if (t) store.data.discordVoice = t; else delete store.data.discordVoice; commit(); } };
  const voice = createVoice({ log, cfg, tokens });
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { log(`discord vocal : ${msg(e)}`); return { ok: false, error: msg(e) }; } };

  function notify(title, body) {
    try { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title, body, silent: true }).show(); } catch {}
  }
  const doToggle = wrap(() => voice.toggle(S().discordVoiceChannel));
  const doMute = wrap(() => voice.mute());
  const report = (r, ok, ko) => { if (r.ok) notify(...ok(r)); else notify(ko, r.error || ''); };
  hub.on('pad:combo', async (name, src) => {
    if (S().discordVoicePad === false) return;
    if (name === 'voice') { const r = await doToggle(); ctx.send('x:discordvoice:done', { ...r, origin: 'pad' }); report(r, (x) => [x.joined ? 'Vocal Discord rejoint' : 'Vocal Discord quitté', x.joined ? x.name : x.was], 'Vocal Discord'); }
    else if (name === 'voice-mute') { const r = await doMute(); ctx.send('x:discordvoice:done', { ...r, origin: 'pad' }); report(r, (x) => [x.muted ? 'Micro coupé' : 'Micro activé', 'Discord'], 'Vocal Discord'); }
    void src;
  });

  ipcMain.handle('x:discordvoice:status', wrap(async () => {
    const c = cfg();
    const out = { ok: true, configured: !!(c.clientId && c.clientSecret), authorized: !!tokens.get(), channel: S().discordVoiceChannel || null, inVoice: null };
    if (out.configured && out.authorized && voice.authed) { try { const s = await voice.selected(); out.inVoice = s ? s.name || true : false; } catch {} }
    return out;
  }));
  ipcMain.handle('x:discordvoice:connect', wrap(() => voice.connect()));
  ipcMain.handle('x:discordvoice:channels', wrap(async () => ({ ok: true, channels: await voice.channels() })));
  ipcMain.handle('x:discordvoice:setChannel', (_e, ch) => {
    const ok = ch && /^\d{15,22}$/.test(String(ch.id || ''));
    S().discordVoiceChannel = ok ? { id: String(ch.id), name: String(ch.name || '').slice(0, 100), guild: String(ch.guild || '').slice(0, 100) } : null;
    commit();
    return S().discordVoiceChannel;
  });
  ipcMain.handle('x:discordvoice:toggle', async (_e, o = {}) => {
    if (o.delay) await new Promise((r) => setTimeout(r, Math.min(2000, Number(o.delay) || 0)));
    const r = await doToggle();
    if (!r.ok && o.notify !== false) notify('Vocal Discord', r.error || '');
    return r;
  });
  ipcMain.handle('x:discordvoice:mute', async () => doMute());
  ipcMain.handle('x:discordvoice:logout', () => { voice.logout(); return true; });
}

module.exports = { init, createRpc, createVoice, planToggle, pipePath, RpcError, REDIRECT, SCOPES };

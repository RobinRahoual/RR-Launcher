// FRIENDS — client minimal de la Gateway Discord (v10, JSON, sans compression).
// Doc : https://docs.discord.com/developers/events/gateway (HELLO → IDENTIFY → READY, HEARTBEAT/ACK,
// RESUME sur resume_gateway_url, RECONNECT (op 7), INVALID_SESSION (op 9), REQUEST_GUILD_MEMBERS (op 8)).
// WebSocket : celui de Node 22+/Electron (globalThis.WebSocket), injectable pour les tests.
// Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur.
'use strict';

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, PRESENCE: 3, RESUME: 6, RECONNECT: 7, REQUEST_MEMBERS: 8, INVALID_SESSION: 9, HELLO: 10, ACK: 11 };
// GUILDS (1<<0) | GUILD_MEMBERS (1<<1, privilégié) | GUILD_PRESENCES (1<<8, privilégié)
const INTENTS = (1 << 0) | (1 << 1) | (1 << 8);
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// Codes de fermeture sans reprise possible : inutile de réessayer tant que la configuration ne change pas
const FATAL = {
  4004: 'Jeton du bot refusé : recopie-le depuis le portail développeur (onglet Bot → Reset Token)',
  4010: 'Shard invalide', 4011: 'Shard requis', 4012: 'Version de Gateway invalide',
  4013: 'Intents invalides',
  4014: 'Intents non autorisés : active « Presence Intent » et « Server Members Intent » (portail développeur → Bot)',
};
const FRESH = new Set([4007, 4009]); // séquence invalide / session expirée : nouvelle session (IDENTIFY)

function createGateway(opts = {}) {
  const {
    token, intents = INTENTS, url = GATEWAY, log = () => {},
    onDispatch = () => {}, onStatus = () => {},
    WebSocketImpl = globalThis.WebSocket, backoff = [1000, 2000, 5000, 10000, 30000], random = Math.random,
    properties = { os: 'windows', browser: 'rr-launcher', device: 'rr-launcher' },
  } = opts;
  let ws = null, seq = null, sessionId = null, resumeUrl = null, hbTimer = null, hbFirst = null, acked = true;
  let retry = 0, retryTimer = null, stopped = true, status = { state: 'idle' }, user = null;

  const setStatus = (s) => { status = { ...s, at: Date.now() }; try { onStatus(status); } catch { /* */ } };
  const send = (op, d) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op, d })); };
  const clearHb = () => { clearTimeout(hbFirst); clearInterval(hbTimer); hbFirst = hbTimer = null; };

  function beat() {
    if (!acked) { // pas d'ACK depuis le dernier battement : connexion « zombie » → on coupe et on reprend la session
      log('discord-bot : battement sans réponse, reconnexion');
      drop(4000, true);
      return;
    }
    acked = false;
    send(OP.HEARTBEAT, seq);
  }

  function open(resume) {
    if (!WebSocketImpl) { setStatus({ state: 'error', error: 'WebSocket indisponible dans cette version' }); return; }
    const target = resume && resumeUrl ? `${resumeUrl.replace(/\/?(\?.*)?$/, '')}/?v=10&encoding=json` : url;
    setStatus({ state: resume ? 'resuming' : 'connecting' });
    let sock;
    try { sock = new WebSocketImpl(target); } catch (e) { log(`discord-bot : ouverture impossible (${e.message})`); schedule(resume); return; }
    ws = sock;
    acked = true;
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      let p;
      try { p = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      handle(p, resume);
    });
    sock.addEventListener('close', (ev) => { if (ws === sock) onClose(ev.code, ev.reason); });
    sock.addEventListener('error', () => { /* suivi d'un « close » */ });
  }

  function handle(p, resume) {
    if (p.s != null) seq = p.s;
    switch (p.op) {
      case OP.HELLO: {
        const iv = Number(p.d?.heartbeat_interval) || 41250;
        clearHb();
        // Premier battement après interval × jitter (doc), puis à intervalle régulier
        hbFirst = setTimeout(() => { beat(); hbTimer = setInterval(beat, iv); }, Math.floor(iv * random()));
        if (resume && sessionId) send(OP.RESUME, { token, session_id: sessionId, seq });
        else send(OP.IDENTIFY, { token, intents, properties, large_threshold: 250 });
        setStatus({ state: resume && sessionId ? 'resuming' : 'identifying' });
        break;
      }
      case OP.ACK: acked = true; break;
      case OP.HEARTBEAT: send(OP.HEARTBEAT, seq); break; // le serveur demande un battement immédiat
      case OP.RECONNECT: log('discord-bot : RECONNECT demandé'); drop(4000, true); break;
      case OP.INVALID_SESSION: {
        const resumable = p.d === true;
        if (!resumable) { sessionId = null; seq = null; resumeUrl = null; }
        log(`discord-bot : session invalide (${resumable ? 'reprise' : 'nouvelle session'})`);
        drop(4000, resumable, 1000 + Math.floor(random() * 4000));
        break;
      }
      case OP.DISPATCH: {
        if (p.t === 'READY') {
          sessionId = p.d?.session_id || null;
          resumeUrl = p.d?.resume_gateway_url || null;
          user = p.d?.user || null;
          retry = 0;
          setStatus({ state: 'ready', user: user && { id: user.id, name: user.global_name || user.username }, guilds: (p.d?.guilds || []).length });
        } else if (p.t === 'RESUMED') {
          retry = 0;
          setStatus({ state: 'ready', user: user && { id: user.id, name: user.global_name || user.username }, resumed: true });
        }
        try { onDispatch(p.t, p.d); } catch (e) { log(`discord-bot : ${p.t} → ${e.message}`); }
        break;
      }
      default: break;
    }
  }

  // Ferme la connexion courante puis se reconnecte (reprise si possible)
  function drop(code, resume, delay) {
    const sock = ws;
    ws = null;
    clearHb();
    try { sock?.close(code); } catch { /* */ }
    if (!stopped) schedule(resume, delay);
  }

  function onClose(code, reason) {
    ws = null;
    clearHb();
    if (stopped) return;
    if (FATAL[code]) {
      log(`discord-bot : fermé ${code} (${FATAL[code]})`);
      stopped = true; sessionId = null;
      setStatus({ state: 'error', code, error: FATAL[code] });
      return;
    }
    if (FRESH.has(code)) { sessionId = null; seq = null; resumeUrl = null; }
    log(`discord-bot : connexion fermée (${code || '?'}${reason ? ` ${String(reason).slice(0, 80)}` : ''}), nouvelle tentative`);
    schedule(!!sessionId);
  }

  function schedule(resume, delay) {
    clearTimeout(retryTimer);
    const wait = delay ?? backoff[Math.min(retry, backoff.length - 1)];
    retry++;
    setStatus({ state: 'waiting', retryIn: wait });
    retryTimer = setTimeout(() => { if (!stopped) open(resume); }, wait);
  }

  return {
    start() {
      if (!token) { setStatus({ state: 'error', error: 'Aucun jeton de bot' }); return; }
      if (!stopped) return;
      stopped = false; retry = 0;
      open(false);
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      const sock = ws; ws = null; clearHb();
      try { sock?.close(1000); } catch { /* */ }
      sessionId = null; seq = null;
      setStatus({ state: 'idle' });
    },
    /** Liste complète des membres d'un serveur avec leurs présences (réponses : GUILD_MEMBERS_CHUNK). */
    requestMembers(guildId, nonce) {
      send(OP.REQUEST_MEMBERS, { guild_id: String(guildId), query: '', limit: 0, presences: true, nonce: nonce || undefined });
    },
    get status() { return status; },
    get user() { return user; },
    get sessionId() { return sessionId; },
    get seq() { return seq; },
  };
}

module.exports = { createGateway, OP, INTENTS, GATEWAY, FATAL };

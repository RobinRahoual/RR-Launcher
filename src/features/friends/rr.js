// FRIENDS / RR — amis « RR Launcher » sans Steam ni Discord, via Firebase (Realtime Database + connexion anonyme),
// en REST uniquement (pas de SDK). Chaque launcher a un compte anonyme, un code ami de 8 caractères et publie :
//   users/<uid>    { name, code, at }                      lisible par tout launcher connecté (pseudo + code)
//   presence/<uid> { state, game, since, at }              lisible par les amis (ceux que tu as ajoutés)
//   stats/<uid>    { total, count, week, top, recent, at } idem (si le partage des statistiques est activé)
//   friends/<uid>/<autre> = true                           ta liste ; une amitié = chacun a l'autre dans sa liste
//   requests/<autre>/<uid> { name, code, at }              demande envoyée, l'autre accepte ou refuse
//   codes/<CODE> = uid                                     annuaire des codes amis
// Règles de sécurité : firebase/database.rules.json (à coller dans la console Firebase).
'use strict';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
const CODE_RE = /^[A-Z2-9]{8}$/;
const ONLINE_MS = 11 * 60 * 1000; // présence plus vieille : hors ligne (battement toutes les 4 min)
const HEARTBEAT_MS = 4 * 60 * 1000;

const newCode = (rand = Math.random) => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/[1I]/g, 'L').slice(0, 8);

// Statistiques publiées (calculées sur la bibliothèque : temps de jeu cumulé par jeu, derniers jeux lancés)
function statsOf(games, { platName = (p) => p, now = Date.now() } = {}) {
  const played = games.filter((g) => (g.playtime || 0) > 0 || g.lastPlayed);
  const total = played.reduce((n, g) => n + (g.playtime || 0), 0);
  const item = (g) => ({ name: String(g.name || '').slice(0, 120), platform: g.platform || 'pc', pname: platName(g.platform), recomp: g.source === 'recomp' || undefined, appid: Number(g.appid) || undefined });
  const top = [...played].filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime).slice(0, 10).map((g) => ({ ...item(g), sec: Math.round(g.playtime) }));
  const recent = [...played].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6).map((g) => ({ ...item(g), at: g.lastPlayed }));
  return { total: Math.round(total), count: games.length, played: played.length, top, recent, recentWeek: recent.filter((r) => now - r.at < 7 * 864e5).length };
}

// Ami → élément de liste au format de friends/model.js
function toItem(uid, user, pres, { now = Date.now(), pending = false } = {}) {
  const fresh = pres && pres.at && now - pres.at < ONLINE_MS && pres.state !== 'offline';
  const playing = fresh && pres.state === 'playing' && pres.game?.name;
  return {
    key: `rr:${uid}`, uid, source: 'rr', name: user?.name || 'Joueur RR',
    avatar: typeof user?.img === 'string' && user.img.startsWith('data:image/') ? user.img : null,
    av: user?.av && typeof user.av.g === 'string' ? { g: user.av.g, c: /^#[0-9a-f]{3,8}$/i.test(user.av.c) ? user.av.c : '#3C91E6' } : null, code: user?.code || '',
    status: pending ? 'offline' : fresh ? 'online' : 'offline', pending,
    activity: playing ? { kind: 'playing', name: pres.game.name, details: [pres.game.pname, pres.game.recomp ? 'Recomp PC' : ''].filter(Boolean).join(' · '), state: '', since: pres.since || null, url: '', appid: 0, platform: typeof pres.game.platform === 'string' ? pres.game.platform.slice(0, 20) : '' } : null,
    lastSeen: pres?.at || null, mobile: false, custom: pending ? 'Demande envoyée, en attente' : '', handle: user?.code || '',
  };
}

function createRR({ fetchImpl, getConfig, store, log = () => {}, profileName = () => 'Joueur', profileCard = () => ({}), gamesFn = () => [], platName = (p) => p, onChange = () => {} }) {
  const R = () => (store.data.rrFriends ||= {});
  let token = null, tokenExp = 0, state = { state: 'off' };
  let friends = [], requests = [], heartbeat = null, playing = null;
  const statsCache = new Map();

  const cfg = () => { const c = getConfig() || {}; return { apiKey: String(c.apiKey || '').trim(), db: String(c.databaseURL || '').trim().replace(/\/+$/, '') }; };
  const configured = () => { const c = cfg(); return !!(c.apiKey && /^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)$/.test(c.db)); };

  async function req(url, opts = {}) {
    const r = await fetchImpl(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
    let body = null;
    try { body = await r.json(); } catch { /* vide */ }
    if (!r.ok) {
      const msg = body?.error?.message || body?.error || `HTTP ${r.status}`;
      throw Object.assign(new Error(String(msg)), { status: r.status });
    }
    return body;
  }
  // ---- Connexion anonyme (Identity Toolkit), jeton renouvelé avec le refresh token
  async function auth() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const { apiKey } = cfg();
    const S = R();
    let r;
    if (S.refresh) {
      try {
        r = await req(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: S.refresh }) });
        token = r.id_token; S.refresh = r.refresh_token; S.uid = r.user_id; tokenExp = Date.now() + Number(r.expires_in || 3600) * 1000;
        return token;
      } catch (e) { log(`rr : renouvellement refusé (${e.message}), nouveau compte`); delete S.refresh; }
    }
    r = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, { method: 'POST', body: JSON.stringify({ returnSecureToken: true }) });
    token = r.idToken; S.refresh = r.refreshToken; S.uid = r.localId; tokenExp = Date.now() + Number(r.expiresIn || 3600) * 1000;
    delete S.code; // nouveau compte : nouveau code
    store.save();
    return token;
  }
  async function db(method, p, data) {
    const t = await auth();
    const url = `${cfg().db}/${p}.json?auth=${encodeURIComponent(t)}`;
    return req(url, { method, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  }
  const TS = { '.sv': 'timestamp' };

  // ---- Profil : code ami réservé une fois, pseudo = profil du launcher
  async function ensureMe() {
    await auth();
    const S = R();
    if (!S.code) {
      for (let i = 0; i < 6 && !S.code; i++) {
        const c = newCode();
        try { await db('PUT', `codes/${c}`, S.uid); S.code = c; } catch (e) { if (e.status !== 401 && e.status !== 403) throw e; } // pris : on retente
      }
      if (!S.code) throw new Error('Impossible de réserver un code ami');
      store.save();
    }
    await publishUser();
    return { uid: S.uid, code: S.code };
  }
  // Fiche publique : pseudo + avatar ; republiée quand le profil change (vérifié à chaque battement)
  let userSig = '';
  async function publishUser(force = true) {
    const S = R();
    const doc = { name: String(profileName() || 'Joueur').slice(0, 40), code: S.code, ...profileCard() };
    const sig = JSON.stringify(doc);
    if (!force && sig === userSig) return;
    await db('PUT', `users/${S.uid}`, { ...doc, at: TS });
    userSig = sig;
  }

  async function publishPresence(stateName = playing ? 'playing' : 'online') {
    const S = R();
    if (!S.uid) return;
    if (S.code && stateName !== 'offline') await publishUser(false).catch((e) => log(`rr : profil ${e.message}`));
    await db('PUT', `presence/${S.uid}`, stateName === 'playing' && playing
      ? { state: 'playing', game: playing.game, since: playing.since, at: TS }
      : { state: stateName, at: TS });
  }
  async function publishStats() {
    const S = R();
    if (!S.uid) return;
    if (store.data.settings?.friendsRRStats === false) { await db('DELETE', `stats/${S.uid}`); return; }
    await db('PUT', `stats/${S.uid}`, { ...statsOf(gamesFn(), { platName }), at: TS });
  }

  // ---- Amis et demandes
  async function refresh() {
    if (!configured()) { state = { state: 'unconfigured' }; friends = []; requests = []; return; }
    const S = R();
    const mine = (await db('GET', `friends/${S.uid}`)) || {};
    const reqs = (await db('GET', `requests/${S.uid}`)) || {};
    const now = Date.now();
    const out = [];
    await Promise.all(Object.keys(mine).map(async (uid) => {
      const user = await db('GET', `users/${uid}`).catch(() => null);
      let pres = null, pending = false;
      try { pres = await db('GET', `presence/${uid}`); } catch (e) { if (e.status === 401 || e.status === 403) pending = true; } // il ne t'a pas (encore) ajouté
      out.push(toItem(uid, user, pres, { now, pending }));
    }));
    friends = out;
    requests = Object.entries(reqs).filter(([uid]) => !mine[uid]).map(([uid, r]) => ({ uid, name: String(r?.name || 'Joueur RR').slice(0, 40), code: r?.code || '', at: r?.at || null }));
    state = { state: 'ok', count: friends.length };
  }
  async function add(codeIn) {
    const code = normCode(codeIn);
    if (!CODE_RE.test(code)) return { ok: false, error: 'Un code ami fait 8 caractères (lettres et chiffres)' };
    const S = R();
    if (code === S.code) return { ok: false, error: 'C’est ton propre code' };
    const uid = await db('GET', `codes/${code}`);
    if (!uid || typeof uid !== 'string') return { ok: false, error: 'Aucun joueur avec ce code' };
    await db('PUT', `friends/${S.uid}/${uid}`, true);
    await db('PUT', `requests/${uid}/${S.uid}`, { name: String(profileName() || 'Joueur').slice(0, 40), code: S.code, at: TS });
    userSig = ''; // republier la fiche au prochain battement
    await db('DELETE', `requests/${S.uid}/${uid}`).catch(() => {}); // il t'avait déjà demandé : c'est accepté
    await refresh();
    const f = friends.find((x) => x.uid === uid);
    return { ok: true, name: f?.name || 'ton ami', pending: !!f?.pending };
  }
  async function accept(uid) {
    const S = R();
    await db('PUT', `friends/${S.uid}/${uid}`, true);
    await db('DELETE', `requests/${S.uid}/${uid}`);
    await refresh();
    return { ok: true };
  }
  async function decline(uid) { await db('DELETE', `requests/${R().uid}/${uid}`); await refresh(); return { ok: true }; }
  async function remove(uid) {
    const S = R();
    await db('DELETE', `friends/${S.uid}/${uid}`);
    await db('DELETE', `requests/${uid}/${S.uid}`).catch(() => {});
    statsCache.delete(uid);
    await refresh();
    return { ok: true };
  }
  async function stats(uid) {
    const c = statsCache.get(uid);
    if (c && Date.now() - c.t < 60000) return c.v;
    let v = null;
    try { v = await db('GET', `stats/${uid}`); } catch (e) { if (e.status !== 401 && e.status !== 403) throw e; }
    statsCache.set(uid, { t: Date.now(), v });
    return v;
  }

  // ---- Cycle de vie
  async function start() {
    stop();
    if (!configured()) { state = { state: 'unconfigured' }; onChange(); return; }
    if (store.data.settings?.friendsRR === false) { state = { state: 'off' }; onChange(); return; }
    state = { state: 'connecting' }; onChange();
    try {
      await ensureMe();
      await publishPresence();
      await publishStats().catch((e) => log(`rr : statistiques ${e.message}`));
      await refresh();
      heartbeat = setInterval(() => { publishPresence().catch((e) => log(`rr : présence ${e.message}`)); }, HEARTBEAT_MS);
    } catch (e) {
      state = { state: 'error', error: /PERMISSION|Permission|401|403/.test(e.message) ? 'Accès refusé par Firebase : vérifie les règles de la base et la connexion anonyme' : /ADMIN_ONLY|OPERATION_NOT_ALLOWED/.test(e.message) ? 'Active la connexion « Anonyme » dans Firebase (Authentication → Méthode de connexion)' : e.message };
      log(`rr : ${e.message}`);
    }
    onChange();
  }
  function stop() { clearInterval(heartbeat); heartbeat = null; }
  async function setPlaying(game) {
    playing = game ? { game, since: Date.now() } : null;
    if (state.state !== 'ok') return;
    await publishPresence().catch((e) => log(`rr : présence ${e.message}`));
    if (!game) await publishStats().catch(() => {});
  }
  async function goOffline() { if (state.state === 'ok') await publishPresence('offline').catch(() => {}); }

  return {
    start, stop, refresh: async () => { if (state.state === 'ok') { try { await refresh(); } catch (e) { log(`rr : ${e.message}`); } } },
    add, accept, decline, remove, stats, setPlaying, goOffline, publishStats,
    list: () => friends, requests: () => requests, configured,
    info: () => ({ ...state, configured: configured(), code: R().code || '', uid: R().uid || '', name: profileName(), requests }),
  };
}

module.exports = { createRR, statsOf, toItem, newCode, normCode, CODE_RE, ONLINE_MS };

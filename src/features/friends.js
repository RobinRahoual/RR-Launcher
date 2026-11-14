// FRIENDS — écran « Amis » : qui est en ligne et à quoi jouent tes amis (Discord + Steam).
//
// Discord : une application tierce ne peut PAS lire ta liste d'amis ni leurs activités (RPC : scopes réservés
// aux applications approuvées par Discord). On passe donc par un BOT à toi, invité dans ton/tes serveur(s) :
// avec les intents privilégiés « Presence » et « Server Members », la Gateway lui envoie les présences
// (statut + activités « Joue à… », stream, écoute) de tous les membres de ces serveurs.
// Steam : Steam Web API (clé + SteamID déjà saisis pour les succès) — GetFriendList + GetPlayerSummaries.
//
// Données : store.data.friends = { token: { enc | plain }, hidden: [clés] }  (jeton chiffré par safeStorage si dispo)
// Réglages : friendsDiscord, friendsSteam, friendsNotify (undefined = activé)
// IPC : x:friends:get | visible | setToken | clearToken | test | hide | unhideAll | refresh | config
// Évènements → renderer : x:friends:update (instantané), x:friends:started ({ items })
// Banc : RR_FRIENDS_DEMO=<fichier.json> remplace les connexions par des données factices.
'use strict';
const fs = require('fs');
const { createGateway } = require('./friends/gateway');
const { createDiscordState } = require('./friends/discord-state');
const { steamFriends } = require('./friends/steam');
const model = require('./friends/model');
const { createRR } = require('./friends/rr');
const FIREBASE = require('./friends/firebase.json');

const STEAM_VISIBLE_MS = 60 * 1000; // onglet Amis ouvert
const STEAM_BACKGROUND_MS = 5 * 60 * 1000; // compteur / notifications en arrière-plan
const PRIME_MS = 6000; // après READY : laisse arriver GUILD_CREATE et les listes de membres avant de notifier
const NOTIFY_AGAIN_MS = 10 * 60 * 1000;
const TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

function cleanToken(v) { return String(v || '').trim().replace(/^Bot\s+/i, '').replace(/^["']|["']$/g, ''); }

function init(ctx) {
  const { ipcMain, store, send, log, getWin } = ctx;
  const S = () => store.data.settings;
  const F = () => { const f = (store.data.friends ||= {}); f.hidden ||= []; return f; };
  const on = (k) => S()[k] !== false;
  const say = (m) => { try { log(`amis : ${m}`); } catch { /* */ } };

  // ------------------------------------------------------------ Jeton du bot (jamais renvoyé au renderer ni journalisé)
  let safe = null;
  try { safe = require('electron').safeStorage; } catch { /* tests */ }
  function getToken() {
    const t = F().token;
    if (!t) return '';
    if (t.enc) { try { return safe.decryptString(Buffer.from(t.enc, 'base64')); } catch { return ''; } }
    return t.plain || '';
  }
  function saveToken(v) {
    if (!v) { delete F().token; store.save(); return; }
    let enc = null;
    try { if (safe?.isEncryptionAvailable()) enc = safe.encryptString(v).toString('base64'); } catch { /* */ }
    F().token = enc ? { enc } : { plain: v };
    store.save();
  }

  // ------------------------------------------------------------ État
  const dstate = createDiscordState();
  let gw = null, dStatus = { state: 'off' }, readyTimer = null;
  let steamList = [], steamStatus = { state: 'off' }, steamAt = 0, steamTimer = null, steamBusy = false;
  const steamSeen = new Map();
  const primed = { discord: false, steam: false, rr: false };
  let prevPlaying = new Map();
  const notified = new Map(); // `${key}|${jeu}` → ts
  let overlayVisible = false, winVisible = true, lastSent = '', pushTimer = null;
  let demo = null;

  // ------------------------------------------------------------ Amis RR Launcher (Firebase)
  const { BY_ID } = require('../platforms');
  const rrNet = require('electron').net;
  const rr = createRR({
    fetchImpl: (u, o) => rrNet.fetch(u, o), store, log: say,
    getConfig: () => (S().rrFirebaseApiKey && S().rrFirebaseDb ? { apiKey: S().rrFirebaseApiKey, databaseURL: S().rrFirebaseDb } : FIREBASE),
    profileName: () => { const P = store.data.profiles; const p = P?.list?.find((x) => x.id === P.current); return S().friendsRRName || p?.name || require('os').userInfo().username || 'Joueur'; },
    gamesFn: () => store.data.games || [],
    platName: (id) => BY_ID[id]?.name || id || 'PC',
    onChange: () => schedulePush(),
  });
  ctx.hub?.on('session:start', (id) => {
    const g = (store.data.games || []).find((x) => x.id === id);
    if (g) rr.setPlaying({ name: String(g.name).slice(0, 120), platform: g.platform || 'pc', pname: BY_ID[g.platform]?.name || 'PC', recomp: g.source === 'recomp' || null });
  });
  ctx.hub?.on('session:end', () => setTimeout(() => rr.setPlaying(null), 1500));
  require('electron').app?.on?.('before-quit', () => { rr.goOffline(); });
  let rrTimer = null;
  async function pollRR() {
    clearTimeout(rrTimer);
    await rr.refresh();
    push();
    primed.rr = true; // pas de notification pour les amis déjà en jeu au démarrage
    rrTimer = setTimeout(pollRR, overlayVisible ? 20000 : 90000);
  }

  // ------------------------------------------------------------ Discord (bot + Gateway)
  function stopDiscord() {
    clearTimeout(readyTimer);
    if (gw) { gw.stop(); gw = null; }
    dstate.reset();
    if (!demo) primed.discord = false;
  }
  function startDiscord() {
    stopDiscord();
    if (demo) return;
    if (!on('friendsDiscord')) { dStatus = { state: 'off' }; return schedulePush(); }
    const token = getToken();
    if (!token) { dStatus = { state: 'notoken' }; return schedulePush(); }
    gw = createGateway({
      token, log: say,
      onStatus: (s) => { dStatus = s; schedulePush(); },
      onDispatch: (t, d) => {
        if (t === 'READY') {
          dstate.reset(); primed.discord = false;
          clearTimeout(readyTimer);
          readyTimer = setTimeout(() => { primed.discord = true; push(); }, PRIME_MS);
          say(`bot connecté (${(d?.guilds || []).length} serveur(s))`);
        }
        const r = dstate.apply(t, d);
        for (const gid of r.request || []) gw?.requestMembers(gid);
        if (r.changed) schedulePush();
      },
    });
    gw.start();
  }

  // ------------------------------------------------------------ Steam (Web API)
  const { net } = require('electron');
  async function get(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'RRLauncher/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    let json = null;
    try { json = await res.json(); } catch { /* pas du JSON */ }
    return { status: res.status, json };
  }
  function steamConfigured() { return !!(S().steamApiKey && S().steamId64); }
  async function pollSteam() {
    clearTimeout(steamTimer);
    try {
      if (demo || steamBusy) return;
      if (!on('friendsSteam')) { steamList = []; steamStatus = { state: 'off' }; primed.steam = false; return; }
      if (!steamConfigured()) { steamList = []; steamStatus = { state: 'unconfigured' }; primed.steam = false; return; }
      if (!winVisible && !overlayVisible) return; // fenêtre cachée (en jeu, réduite) : on attend
      steamBusy = true;
      try {
        steamList = await steamFriends(get, { key: S().steamApiKey, steamId: S().steamId64, seen: steamSeen, primed: primed.steam });
        steamStatus = { state: 'ok', count: steamList.length };
        steamAt = Date.now();
        push();
        primed.steam = true;
      } catch (e) {
        steamStatus = { state: 'error', error: e.message, code: e.code || '' };
        steamAt = Date.now();
        if (e.code !== 'private') say(`steam : ${e.message}`);
      } finally { steamBusy = false; }
    } finally {
      schedulePush();
      if (!demo) steamTimer = setTimeout(pollSteam, overlayVisible ? STEAM_VISIBLE_MS : STEAM_BACKGROUND_MS);
    }
  }

  // ------------------------------------------------------------ Instantané → renderer
  function all() { return demo ? [...demo.discord, ...demo.steam] : [...rr.list(), ...dstate.friends(), ...steamList]; }
  function snapshot() {
    const list = all();
    const sec = model.build(list, store.data.games || [], { hidden: new Set(F().hidden) });
    return {
      ...sec,
      counts: { playing: sec.playing.length, online: sec.online.length, offline: sec.offlineTotal, hidden: F().hidden.length },
      discord: {
        enabled: on('friendsDiscord'), hasToken: demo ? true : !!getToken(),
        state: demo ? 'ready' : dStatus.state, error: dStatus.error || '', code: dStatus.code || 0, retryIn: dStatus.retryIn || 0,
        bot: demo ? 'RR Launcher' : dStatus.user?.name || gw?.user?.username || '',
        guilds: demo ? ['Les potes'] : dstate.guilds.map((g) => g.name),
      },
      rr: { enabled: on('friendsRR'), ...rr.info() },
      steam: { enabled: on('friendsSteam'), configured: demo ? true : steamConfigured(), state: demo ? 'ok' : steamStatus.state, error: steamStatus.error || '', code: steamStatus.code || '', at: steamAt },
      demo: !!demo,
    };
  }
  function notify(list) {
    const now = Date.now();
    const items = [];
    for (const f of model.started(prevPlaying, list)) {
      if (!primed[f.source]) continue;
      const k = `${f.key}|${f.activity.name}`;
      if (now - (notified.get(k) || 0) < NOTIFY_AGAIN_MS) continue;
      notified.set(k, now);
      items.push({ key: f.key, name: f.name, game: f.activity.name, source: f.source, avatar: f.avatar, streaming: f.activity.kind === 'streaming' });
    }
    prevPlaying = model.playingMap(list);
    if (items.length && on('friendsNotify')) send('x:friends:started', { items: items.slice(0, 5), more: Math.max(0, items.length - 5) });
  }
  function push() {
    clearTimeout(pushTimer); pushTimer = null;
    const list = all().filter((f) => !F().hidden.includes(f.key));
    notify(list);
    const snap = snapshot();
    const json = JSON.stringify(snap);
    if (json === lastSent) return;
    lastSent = json;
    send('x:friends:update', snap);
  }
  function schedulePush() { if (!pushTimer) pushTimer = setTimeout(push, 250); }

  // ------------------------------------------------------------ Démo (banc de captures)
  function loadDemo(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now();
    const fix = (f) => ({
      mobile: false, custom: '', handle: '', lastSeen: null, ...f,
      lastSeen: f.lastSeenAgo != null ? now - f.lastSeenAgo * 60000 : f.lastSeen || null,
      activity: f.activity ? { details: '', state: '', url: '', appid: 0, ...f.activity, since: f.activity.sinceAgo != null ? now - f.activity.sinceAgo * 60000 : f.activity.since || null } : null,
    });
    demo = { discord: (raw.discord || []).map(fix), steam: (raw.steam || []).map(fix) };
    primed.discord = primed.steam = true;
    prevPlaying = model.playingMap(all());
    demo.later = () => { demo.later = null; for (const ev of raw.later || []) {
      setTimeout(() => {
        const listName = ev.key.startsWith('st:') ? 'steam' : 'discord';
        const f = demo[listName].find((x) => x.key === ev.key);
        if (!f) return;
        Object.assign(f, fix({ ...f, ...ev.patch }));
        push();
      }, ev.after || 3000);
    } }; // départ au 1er x:friends:get (interface prête)
    say(`démo chargée (${demo.discord.length} Discord, ${demo.steam.length} Steam)`);
  }
  if (process.env.RR_FRIENDS_DEMO) { try { loadDemo(process.env.RR_FRIENDS_DEMO); } catch (e) { say(`démo illisible : ${e.message}`); } }

  // ------------------------------------------------------------ Fenêtre
  const w = getWin?.();
  if (w) { w.on('show', () => { winVisible = true; if (Date.now() - steamAt > STEAM_VISIBLE_MS) pollSteam(); }); w.on('hide', () => { winVisible = false; }); }

  // ------------------------------------------------------------ IPC
  ipcMain.handle('x:friends:get', () => {
    demo?.later?.();
    if (!demo && Date.now() - steamAt > STEAM_VISIBLE_MS && !steamBusy) pollSteam();
    const s = snapshot(); lastSent = JSON.stringify(s); return s;
  });
  ipcMain.handle('x:friends:visible', (_e, v) => {
    overlayVisible = !!v;
    if (overlayVisible) pollRR();
    if (overlayVisible && Date.now() - steamAt > 30000) pollSteam();
    else if (!demo) { clearTimeout(steamTimer); steamTimer = setTimeout(pollSteam, overlayVisible ? STEAM_VISIBLE_MS : STEAM_BACKGROUND_MS); }
    return true;
  });
  ipcMain.handle('x:friends:setToken', (_e, v) => {
    const t = cleanToken(v);
    if (!t) { saveToken(''); startDiscord(); return { ok: true, cleared: true }; }
    if (!TOKEN_RE.test(t)) return { ok: false, error: 'Ce n’est pas un jeton de bot (trois blocs séparés par des points). Copie-le depuis l’onglet Bot → Reset Token.' };
    saveToken(t);
    say('jeton du bot enregistré');
    startDiscord();
    return { ok: true };
  });
  ipcMain.handle('x:friends:clearToken', () => { saveToken(''); startDiscord(); return { ok: true }; });
  ipcMain.handle('x:friends:test', async () => {
    if (demo) return { ok: true, bot: 'RR Launcher', guilds: 1 };
    if (!getToken()) return { ok: false, error: 'Colle d’abord le jeton du bot' };
    if (!on('friendsDiscord')) return { ok: false, error: 'Active d’abord « Amis Discord »' };
    if (!gw || dStatus.state !== 'ready') startDiscord();
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      if (dStatus.state === 'ready' && dstate.guilds.length) break;
      if (dStatus.state === 'ready' && Date.now() - t0 > 4000) break;
      if (dStatus.state === 'error') return { ok: false, error: dStatus.error };
      await new Promise((r) => setTimeout(r, 200));
    }
    if (dStatus.state !== 'ready') return { ok: false, error: 'Pas de réponse de Discord (connexion Internet ?)' };
    const n = dstate.guilds.length;
    return { ok: true, bot: dStatus.user?.name || '', guilds: n, members: dstate.friends().length, error: n ? '' : 'Le bot n’est dans aucun serveur : invite-le (étape 4)' };
  });
  ipcMain.handle('x:friends:hide', (_e, key, hide = true) => {
    const h = new Set(F().hidden);
    if (hide) h.add(String(key)); else h.delete(String(key));
    F().hidden = [...h]; store.save(); push();
    return F().hidden.length;
  });
  // Amis RR Launcher
  const rrCall = (fn) => async (...a) => { try { const r = await fn(...a); push(); return r; } catch (e) { say(`rr : ${e.message}`); return { ok: false, error: e.message }; } };
  ipcMain.handle('x:friends:rrAdd', rrCall((_e, code) => rr.add(code)));
  ipcMain.handle('x:friends:rrAccept', rrCall((_e, uid) => rr.accept(String(uid))));
  ipcMain.handle('x:friends:rrDecline', rrCall((_e, uid) => rr.decline(String(uid))));
  ipcMain.handle('x:friends:rrRemove', rrCall((_e, uid) => rr.remove(String(uid))));
  ipcMain.handle('x:friends:rrStats', async (_e, uid) => { try { return { ok: true, stats: await rr.stats(String(uid)) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('x:friends:rrRestart', async () => { await rr.start(); await pollRR(); return rr.info(); });
  ipcMain.handle('x:friends:unhideAll', () => { F().hidden = []; store.save(); push(); return 0; });
  ipcMain.handle('x:friends:refresh', async () => { await Promise.all([pollSteam(), pollRR()]); push(); return snapshot(); });
  // Réglages modifiés (interrupteurs, clé Steam) : le renderer prévient
  ipcMain.handle('x:friends:config', () => {
    rr.start().then(pollRR);
    const wantDc = on('friendsDiscord') && !!getToken();
    if (wantDc !== !!gw) startDiscord();
    pollSteam();
    return true;
  });

  // ------------------------------------------------------------ Démarrage
  setTimeout(() => { startDiscord(); pollSteam(); if (!demo) rr.start().then(pollRR); }, demo ? 0 : 4000);
}

module.exports = { init, cleanToken, TOKEN_RE };

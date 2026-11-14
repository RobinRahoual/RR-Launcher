// PLAYTIME — compte Epic Games : connexion par la page officielle d'Epic (fenêtre du launcher), puis lecture du
// temps de jeu de la bibliothèque (le même que « Temps de jeu » du launcher Epic). Même client public que
// Legendary / Heroic. Le refresh token est chiffré par Windows (safeStorage) ; jamais de mot de passe stocké.
'use strict';
const core = require('./core');

const CLIENT = '34a02cf8f4414e29b15921876da36f9a';
const SECRET = 'daafbccc737745039dffe53d94fc76cf';
const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
const REDIRECT = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT}&responseType=code`;
const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT)}`;
const PLAYTIME_URL = (acc) => `https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/${encodeURIComponent(acc)}/all`;

function createEpic({ store, fetchImpl, safe, log = () => {} }) {
  const D = () => (store.data.epicAuth ||= {});
  let access = null, accessExp = 0;
  const pack = (o) => {
    const json = JSON.stringify(o);
    if (safe?.isEncryptionAvailable?.()) return { enc: safe.encryptString(json).toString('base64') };
    return { plain: json };
  };
  const unpack = () => {
    const d = D();
    try {
      if (d.enc && safe?.isEncryptionAvailable?.()) return JSON.parse(safe.decryptString(Buffer.from(d.enc, 'base64')));
      if (d.plain) return JSON.parse(d.plain);
    } catch (e) { log(`epic : jeton illisible (${e.message})`); }
    return null;
  };
  async function token(body) {
    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, token_type: 'eg1' }).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.errorMessage || `HTTP ${r.status}`), { code: j.errorCode || '' });
    access = j.access_token; accessExp = Date.parse(j.expires_at || '') || Date.now() + 3600e3;
    store.data.epicAuth = { ...pack({ refresh: j.refresh_token, account: j.account_id, name: j.displayName || '' }), name: j.displayName || '', at: Date.now() };
    store.save?.();
    return j;
  }
  async function bearer() {
    if (access && Date.now() < accessExp - 60e3) return access;
    const t = unpack();
    if (!t?.refresh) throw new Error('Compte Epic non connecté');
    try { await token({ grant_type: 'refresh_token', refresh_token: t.refresh }); }
    catch (e) { if (/invalid|expired|not_found/i.test(e.code + e.message)) { logout(); throw new Error('Connexion Epic expirée : reconnecte ton compte'); } throw e; }
    return access;
  }
  function logout() { access = null; accessExp = 0; delete store.data.epicAuth; store.save?.(); }
  async function playtime() {
    const t = await bearer();
    const acc = unpack()?.account;
    const r = await fetchImpl(PLAYTIME_URL(acc), { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error(`Epic : HTTP ${r.status}`);
    return core.epicTimes(await r.json());
  }
  return {
    connected: () => !!(D().enc || D().plain),
    name: () => D().name || '',
    loginWithCode: (code) => token({ grant_type: 'authorization_code', code }),
    playtime, logout,
  };
}

module.exports = { createEpic, LOGIN_URL, REDIRECT, CLIENT };

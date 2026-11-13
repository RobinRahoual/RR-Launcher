// EXTRAS — appels Steam Web API et RetroAchievements Web API.
// get(url) doit renvoyer { status, json } (json = null si le corps n'est pas du JSON) : la Steam Web API
// répond 403 / 400 avec un JSON d'erreur utile (« Profile is not public », « Requested app has no stats »).
// Docs : https://partner.steamgames.com/doc/webapi/ISteamUserStats · https://developer.valvesoftware.com/wiki/Steam_Web_API
//        https://api-docs.retroachievements.org/
'use strict';
const { fromSteam, fromRA } = require('./achievements');

const STEAM = 'https://api.steampowered.com';
const RA = 'https://retroachievements.org/API';
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------------------------------------------------------------- Steam
/** Profil : 7656119… | https://steamcommunity.com/profiles/7656119… | https://steamcommunity.com/id/<nom> | <nom> */
function parseSteamInput(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{17})$/) || v.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (m) return { steamId: m[1] };
  m = v.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
  if (m) return { vanity: m[1] };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(v)) return { vanity: v };
  return null;
}

async function resolveSteamId(get, key, input) {
  const p = parseSteamInput(input);
  if (!p) throw new ApiError('input', 'Identifiant Steam non reconnu');
  if (p.steamId) return p.steamId;
  if (!key) throw new ApiError('key', 'Clé API Steam requise pour lire une URL personnalisée');
  const r = await get(`${STEAM}/ISteamUser/ResolveVanityURL/v1/?${q({ key, vanityurl: p.vanity })}`);
  if (r.status === 403 || r.status === 401) throw new ApiError('key', 'Clé API Steam refusée');
  const res = r.json?.response;
  if (res?.success === 1 && res.steamid) return res.steamid;
  throw new ApiError('notfound', 'Profil Steam introuvable');
}

/** Test de connexion : nom du profil + visibilité (communityvisibilitystate 3 = public). */
async function steamProfile(get, key, steamId) {
  const r = await get(`${STEAM}/ISteamUser/GetPlayerSummaries/v2/?${q({ key, steamids: steamId })}`);
  if (r.status === 403 || r.status === 401) throw new ApiError('key', 'Clé API Steam refusée');
  const p = r.json?.response?.players?.[0];
  if (!p) throw new ApiError('notfound', 'Profil Steam introuvable');
  return { name: p.personaname || '', public: Number(p.communityvisibilitystate) === 3, avatar: p.avatarmedium || '' };
}

/** Succès d'un jeu Steam (format commun). none: true si le jeu n'a pas de succès. */
async function steamAchievements(get, { key, steamId, appid, lang = 'french' }) {
  const [schema, player, global] = await Promise.all([
    get(`${STEAM}/ISteamUserStats/GetSchemaForGame/v2/?${q({ key, appid, l: lang })}`),
    get(`${STEAM}/ISteamUserStats/GetPlayerAchievements/v1/?${q({ key, steamid: steamId, appid, l: lang })}`),
    get(`${STEAM}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?${q({ gameid: appid })}`).catch(() => ({ status: 0, json: null })),
  ]);
  const err = player.json?.playerstats?.error || '';
  if (player.status === 401 || schema.status === 401 || (player.status === 403 && !err)) throw new ApiError('key', 'Clé API Steam refusée');
  if (/not public/i.test(err) || player.status === 403) throw new ApiError('private', 'Profil ou « Détails des jeux » non publics sur Steam');
  if (/no stats/i.test(err)) return { source: 'steam', none: true, total: 0, unlocked: 0, pct: 0, list: [] };
  if (player.status >= 400 || !player.json?.playerstats) throw new ApiError('http', err || `Steam : erreur ${player.status}`);
  const d = fromSteam({ schema: schema.json, player: player.json, global: global.json });
  if (!d.total) d.none = true;
  return d;
}

// ---------------------------------------------------------------- RetroAchievements
async function raProfile(get, user, key) {
  const r = await get(`${RA}/API_GetUserProfile.php?${q({ u: user, y: key })}`);
  if (r.status === 401 || r.status === 403) throw new ApiError('key', 'Clé RetroAchievements refusée');
  if (!r.json || !r.json.User) throw new ApiError('notfound', 'Utilisateur RetroAchievements introuvable');
  return { name: r.json.User, points: Number(r.json.TotalPoints) || 0 };
}

/** Liste des jeux d'une console avec leurs empreintes (h=1), seulement ceux qui ont des succès (f=1). */
async function raGameList(get, key, consoleId) {
  const r = await get(`${RA}/API_GetGameList.php?${q({ i: consoleId, h: 1, f: 1, y: key })}`);
  if (r.status === 401 || r.status === 403) throw new ApiError('key', 'Clé RetroAchievements refusée');
  if (!Array.isArray(r.json)) throw new ApiError('http', `RetroAchievements : erreur ${r.status}`);
  return r.json.map((g) => ({ id: Number(g.ID), title: g.Title, hashes: (g.Hashes || []).map((h) => String(h).toLowerCase()) }));
}
function findByHash(list, hash) {
  const h = String(hash || '').toLowerCase();
  return (list || []).find((g) => g.hashes.includes(h)) || null;
}

async function raAchievements(get, { user, key, gameId }) {
  const r = await get(`${RA}/API_GetGameInfoAndUserProgress.php?${q({ g: gameId, u: user, y: key, a: 1 })}`);
  if (r.status === 401 || r.status === 403) throw new ApiError('key', 'Clé RetroAchievements refusée');
  if (!r.json || !r.json.ID) throw new ApiError('notfound', `Jeu RetroAchievements ${gameId} introuvable`);
  const d = fromRA(r.json);
  if (!d.total) d.none = true;
  return d;
}

module.exports = { ApiError, parseSteamInput, resolveSteamId, steamProfile, steamAchievements, raProfile, raGameList, findByHash, raAchievements };

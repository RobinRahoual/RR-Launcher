// FRIENDS — amis Steam via la Steam Web API (sans bot) : ISteamUser/GetFriendList + GetPlayerSummaries.
// get(url) → { status, json } (même convention que extras/api.js).
// La liste d'amis n'est lisible que si elle est publique (sinon 401), même avec ta propre clé.
'use strict';

const STEAM = 'https://api.steampowered.com';
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

class SteamError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// personastate : 0 hors ligne, 1 en ligne, 2 occupé, 3 absent, 4 somnole, 5 cherche à échanger, 6 cherche à jouer
const STATE = { 0: 'offline', 1: 'online', 2: 'dnd', 3: 'idle', 4: 'idle', 5: 'online', 6: 'online' };

async function friendIds(get, key, steamId) {
  const r = await get(`${STEAM}/ISteamUser/GetFriendList/v1/?${q({ key, steamid: steamId, relationship: 'friend' })}`);
  if (r.status === 401) throw new SteamError('private', 'Liste d’amis Steam privée : rends-la publique (Profil → Confidentialité → Liste d’amis)');
  if (r.status === 403) throw new SteamError('key', 'Clé API Steam refusée');
  if (r.status >= 400 || !r.json) throw new SteamError('http', `Steam : erreur ${r.status}`);
  return (r.json.friendslist?.friends || []).map((f) => String(f.steamid)).filter(Boolean);
}

async function summaries(get, key, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) { // 100 SteamID max par appel
    const r = await get(`${STEAM}/ISteamUser/GetPlayerSummaries/v2/?${q({ key, steamids: ids.slice(i, i + 100).join(',') })}`);
    if (r.status === 403) throw new SteamError('key', 'Clé API Steam refusée');
    out.push(...(r.json?.response?.players || []));
  }
  return out;
}

/** Joueur Steam → format commun. seen : Map(steamid → { game, since }) pour retenir l'heure de lancement observée. */
function toFriend(p, seen, now = Date.now(), primed = true) {
  const st = STATE[Number(p.personastate)] || 'offline';
  const game = p.gameextrainfo ? String(p.gameextrainfo) : '';
  const gid = String(p.gameid || '');
  let since = null;
  if (game && seen) {
    const prev = seen.get(p.steamid);
    // Steam ne donne pas l'heure de lancement : on note le moment où on voit le jeu pour la 1re fois
    // (inconnue au tout premier relevé : le jeu tournait peut-être déjà depuis longtemps)
    since = prev && prev.game === (gid || game) ? prev.since : primed ? now : null;
    seen.set(p.steamid, { game: gid || game, since });
  } else if (seen) seen.delete(p.steamid);
  const appid = /^\d{1,10}$/.test(gid) && Number(gid) < 2 ** 32 ? Number(gid) : 0; // raccourcis non-Steam : gameid 64 bits
  return {
    key: `st:${p.steamid}`, source: 'steam', id: String(p.steamid),
    name: String(p.personaname || 'Ami Steam').slice(0, 64),
    handle: '',
    avatar: p.avatarfull || p.avatarmedium || p.avatar || '',
    status: game && st === 'offline' ? 'online' : st,
    mobile: false,
    custom: '',
    lastSeen: Number(p.lastlogoff) ? Number(p.lastlogoff) * 1000 : null,
    activity: game ? { kind: 'playing', name: game.slice(0, 128), details: '', state: '', since, url: '', appid } : null,
  };
}

async function steamFriends(get, { key, steamId, seen, primed = true, now = Date.now() }) {
  if (!key) throw new SteamError('key', 'Ajoute ta clé API Steam (Réglages → Fonctions → Succès)');
  if (!steamId) throw new SteamError('id', 'Ajoute ton SteamID (Réglages → Fonctions → Succès)');
  const ids = await friendIds(get, key, steamId);
  if (!ids.length) return [];
  const players = await summaries(get, key, ids);
  return players.map((p) => toFriend(p, seen, now, primed));
}

module.exports = { steamFriends, toFriend, SteamError, STATE };

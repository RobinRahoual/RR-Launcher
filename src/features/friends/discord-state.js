// FRIENDS — état Discord reconstruit à partir des évènements de la Gateway (membres + présences des serveurs
// où le bot est invité). Pur : aucune E/S, testé dans test/friends.test.js.
'use strict';

const CDN = 'https://cdn.discordapp.com';
const ACT = { 0: 'playing', 1: 'streaming', 2: 'listening', 3: 'watching', 4: 'custom', 5: 'competing' };

function avatarUrl(u, size = 128) {
  if (!u?.id) return '';
  if (u.avatar) return `${CDN}/avatars/${u.id}/${u.avatar}.${String(u.avatar).startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  // Avatar par défaut : (id >> 22) % 6 pour les nouveaux pseudos, discriminator % 5 sinon
  let i = 0;
  try { i = u.discriminator && u.discriminator !== '0' ? Number(u.discriminator) % 5 : Number((BigInt(u.id) >> 22n) % 6n); } catch { /* */ }
  return `${CDN}/embed/avatars/${i}.png`;
}

/** Activité principale à afficher : jeu > stream > compétition > regarde > écoute. */
function mainActivity(activities = []) {
  const list = (activities || []).filter((a) => a && a.type !== 4);
  const rank = { 0: 0, 1: 1, 5: 2, 3: 3, 2: 4 };
  list.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  const a = list[0];
  if (!a) return null;
  const stream = (activities || []).find((x) => x.type === 1);
  const kind = ACT[a.type] || 'playing';
  const out = {
    kind,
    // Stream : « name » = plateforme (Twitch…), « state » = jeu streamé, « details » = titre du stream
    name: String((kind === 'streaming' ? a.state || a.name : a.name) || '').slice(0, 128),
    details: String(a.details || '').slice(0, 128),
    state: String((kind === 'streaming' ? '' : a.state) || '').slice(0, 128),
    since: Number(a.timestamps?.start) || Number(a.created_at) || null,
    url: stream?.url || '',
    applicationId: a.application_id || '',
  };
  if (out.since && out.since < 1e12) out.since *= 1000; // secondes → ms (certains clients)
  if (kind !== 'streaming' && stream) out.streaming = true;
  return out;
}
const customStatus = (activities = []) => String((activities || []).find((a) => a?.type === 4)?.state || '').slice(0, 128);

function createDiscordState() {
  const users = new Map(); // id → { id, username, global_name, avatar, discriminator, bot }
  const nicks = new Map(); // id → surnom (premier serveur)
  const member = new Map(); // id → Set(guildId)
  const pres = new Map(); // id → { status, activities, client_status }
  const guilds = new Map(); // id → { id, name, count }
  let selfId = null;

  function addMember(gid, m) {
    const u = m?.user;
    if (!u?.id) return;
    users.set(u.id, { ...(users.get(u.id) || {}), ...u });
    if (m.nick && !nicks.has(u.id)) nicks.set(u.id, m.nick);
    if (!member.has(u.id)) member.set(u.id, new Set());
    member.get(u.id).add(gid);
  }
  function setPresence(p) {
    const id = p?.user?.id;
    if (!id) return false;
    if (p.user.username) users.set(id, { ...(users.get(id) || {}), ...p.user });
    const prev = pres.get(id);
    const next = { status: p.status || 'offline', activities: p.status === 'offline' ? [] : p.activities || [], client_status: p.client_status || {} };
    pres.set(id, next);
    return JSON.stringify(prev) !== JSON.stringify(next);
  }
  function removeFromGuild(gid, uid) {
    const set = member.get(uid);
    if (!set) return;
    set.delete(gid);
    if (!set.size) { member.delete(uid); pres.delete(uid); users.delete(uid); nicks.delete(uid); }
  }

  /** Applique un évènement DISPATCH. Retourne { changed, request? } (request = ids de serveurs à compléter). */
  function apply(t, d) {
    switch (t) {
      case 'READY':
        selfId = d?.user?.id || null;
        return { changed: false };
      case 'GUILD_CREATE': {
        if (!d?.id || d.unavailable) return { changed: false };
        guilds.set(d.id, { id: d.id, name: d.name || '', count: d.member_count || 0 });
        for (const m of d.members || []) addMember(d.id, m);
        for (const p of d.presences || []) { if (!member.get(p.user?.id)) addMember(d.id, { user: p.user }); setPresence(p); }
        // Gros serveur (> large_threshold) ou membres incomplets : on demande la liste complète avec présences
        const need = (d.member_count || 0) > (d.members || []).length;
        return { changed: true, request: need ? [d.id] : [] };
      }
      case 'GUILD_DELETE':
        if (d?.unavailable) return { changed: false }; // panne Discord : on garde l'état
        for (const uid of [...member.keys()]) removeFromGuild(d.id, uid);
        guilds.delete(d?.id);
        return { changed: true };
      case 'GUILD_MEMBERS_CHUNK':
        for (const m of d?.members || []) addMember(d.guild_id, m);
        for (const p of d?.presences || []) setPresence(p);
        return { changed: true };
      case 'GUILD_MEMBER_ADD':
        addMember(d.guild_id, d);
        return { changed: true };
      case 'GUILD_MEMBER_UPDATE':
        if (d?.user?.id) { users.set(d.user.id, { ...(users.get(d.user.id) || {}), ...d.user }); if (d.nick) nicks.set(d.user.id, d.nick); }
        return { changed: true };
      case 'GUILD_MEMBER_REMOVE':
        removeFromGuild(d.guild_id, d.user?.id);
        return { changed: true };
      case 'PRESENCE_UPDATE': {
        if (d?.user?.id && !member.has(d.user.id) && d.guild_id) addMember(d.guild_id, { user: d.user });
        return { changed: setPresence(d) };
      }
      default: return { changed: false };
    }
  }

  /** Liste des personnes (hors bots et hors le bot lui-même), au format commun du module. */
  function friends() {
    const out = [];
    for (const [id, u] of users) {
      if (u.bot || id === selfId || !member.has(id)) continue;
      const p = pres.get(id) || { status: 'offline', activities: [] };
      const st = ['online', 'idle', 'dnd'].includes(p.status) ? p.status : 'offline';
      const act = st === 'offline' ? null : mainActivity(p.activities);
      out.push({
        key: `dc:${id}`, source: 'discord', id,
        name: nicks.get(id) || u.global_name || u.username || 'Membre',
        handle: u.username || '',
        avatar: avatarUrl(u),
        status: st,
        mobile: !!p.client_status?.mobile && !p.client_status?.desktop,
        custom: st === 'offline' ? '' : customStatus(p.activities),
        activity: act,
      });
    }
    return out;
  }
  return {
    apply, friends,
    get guilds() { return [...guilds.values()]; },
    get selfId() { return selfId; },
    get size() { return users.size; },
    reset() { users.clear(); nicks.clear(); member.clear(); pres.clear(); guilds.clear(); },
  };
}

module.exports = { createDiscordState, mainActivity, avatarUrl };

// EXTRAS — mise en forme des succès (Steam Web API, RetroAchievements) vers un format commun :
// { source, title, total, unlocked, pct, points?, pointsEarned?, list: [{ id, name, desc, hidden, unlocked,
//   unlockedAt (ms), rarity (% ou null), iconUrl, points? }] }
'use strict';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/**
 * Steam : GetSchemaForGame/v2 (noms, descriptions, icônes, hidden), GetPlayerAchievements/v1 (déblocages),
 * GetGlobalAchievementPercentagesForApp/v2 (rareté). L'ordre est celui du schéma (ordre d'affichage Steam).
 */
function fromSteam({ schema, player, global }) {
  const defs = schema?.game?.availableGameStats?.achievements || [];
  const ps = player?.playerstats || {};
  const mine = new Map((ps.achievements || []).map((a) => [a.apiname, a]));
  const pct = new Map((global?.achievementpercentages?.achievements || []).map((a) => [a.name, num(a.percent)]));
  // Sans schéma (clé refusée…), on se contente de la liste du joueur (noms fournis avec l=french)
  const base = defs.length ? defs : (ps.achievements || []).map((a) => ({ name: a.apiname, displayName: a.name, description: a.description }));
  const list = base.map((d) => {
    const p = mine.get(d.name) || {};
    const unlocked = Number(p.achieved) === 1;
    return {
      id: d.name,
      name: d.displayName || p.name || d.name,
      desc: d.description || p.description || '',
      hidden: Number(d.hidden) === 1,
      unlocked,
      unlockedAt: unlocked && p.unlocktime ? Number(p.unlocktime) * 1000 : 0,
      rarity: round1(pct.get(d.name) ?? null),
      iconUrl: d.icon || '',
    };
  });
  return finish({ source: 'steam', title: ps.gameName || schema?.game?.gameName || '', list });
}

// « 2023-04-01 18:22:05 » (UTC côté RA) → ms
function raDate(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).trim().replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return Number.isFinite(t) ? t : 0;
}

/** RetroAchievements : API_GetGameInfoAndUserProgress.php (Achievements = objet indexé par ID). */
function fromRA(json) {
  const players = num(json?.NumDistinctPlayers) || num(json?.NumDistinctPlayersCasual) || 0;
  const raw = Object.values(json?.Achievements || {});
  raw.sort((a, b) => (num(a.DisplayOrder) || 0) - (num(b.DisplayOrder) || 0) || (num(a.ID) || 0) - (num(b.ID) || 0));
  const list = raw.map((a) => {
    const t = [raDate(a.DateEarned), raDate(a.DateEarnedHardcore)].filter(Boolean);
    const unlocked = t.length > 0;
    return {
      id: String(a.ID),
      name: a.Title || '',
      desc: a.Description || '',
      hidden: false, // RA n'a pas de succès cachés
      unlocked,
      unlockedAt: unlocked ? Math.min(...t) : 0,
      hardcore: !!a.DateEarnedHardcore,
      rarity: players ? round1(((num(a.NumAwarded) || 0) / players) * 100) : null,
      iconUrl: a.BadgeName ? `https://media.retroachievements.org/Badge/${a.BadgeName}.png` : '',
      points: num(a.Points) || 0,
    };
  });
  const out = finish({ source: 'ra', raId: num(json?.ID), title: json?.Title || '', console: json?.ConsoleName || '', list });
  out.points = list.reduce((s, a) => s + a.points, 0);
  out.pointsEarned = list.filter((a) => a.unlocked).reduce((s, a) => s + a.points, 0);
  return out;
}

function finish(d) {
  d.total = d.list.length;
  d.unlocked = d.list.filter((a) => a.unlocked).length;
  d.pct = d.total ? Math.round((d.unlocked / d.total) * 100) : 0;
  return d;
}

/** Résumé pour les badges : { unlocked, total, pct } (null si pas de succès). */
function summarize(d) {
  if (!d || !d.total) return null;
  return { unlocked: d.unlocked, total: d.total, pct: d.pct, source: d.source };
}

/**
 * Liste d'affichage : débloqués les plus récents d'abord, puis verrouillés (ordre du jeu) ;
 * les succès cachés verrouillés sont masqués (nom / description / rareté retirés).
 */
function displayList(d) {
  const list = (d?.list || []).map((a, i) => ({ ...a, _i: i }));
  const on = list.filter((a) => a.unlocked).sort((a, b) => b.unlockedAt - a.unlockedAt || a._i - b._i);
  const off = list.filter((a) => !a.unlocked).sort((a, b) => (a.hidden - b.hidden) || a._i - b._i);
  return [...on, ...off].map(({ _i, ...a }) => (a.hidden && !a.unlocked
    ? { ...a, name: 'Succès caché', desc: 'Continue à jouer pour le découvrir.', masked: true, rarity: null }
    : a));
}

/** Succès débloqués dans `next` qui ne l'étaient pas dans `prev`. */
function newlyUnlocked(prev, next) {
  if (!prev || !next || prev.source !== next.source) return [];
  const before = new Set((prev.list || []).filter((a) => a.unlocked).map((a) => a.id));
  return (next.list || []).filter((a) => a.unlocked && !before.has(a.id));
}

/** Pourcentage en français : 24 → « 24 % », 4.5 → « 4,5 % » (espace insécable). */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  return (v < 10 && v % 1 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + ' %';
}

module.exports = { fromSteam, fromRA, summarize, displayList, newlyUnlocked, raDate, fmtPct };

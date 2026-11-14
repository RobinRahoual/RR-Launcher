// SMART — règles des collections intelligentes (partagé renderer / main / tests : UMD sans dépendance).
// Une collection intelligente = { id, name, match: 'all' | 'any', rules: [{ f, op, v }] } évaluée à la volée sur la
// bibliothèque (aucun jeu n'y est « rangé » à la main). Les jeux y entrent et en sortent tout seuls.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRSmart = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const NUM = ['lt', 'gt', 'eq', 'neq'];
  const TXT = ['has', 'nhas', 'eq', 'neq'];
  const ENUM = ['eq', 'neq'];
  const BOOL = ['is'];
  // f → { label, type, ops, unit? }
  const FIELDS = {
    playtimeH: { label: 'Temps de jeu', type: 'num', ops: NUM, unit: 'h' },
    playCount: { label: 'Nombre de lancements', type: 'num', ops: NUM },
    lastPlayedDays: { label: 'Dernière partie il y a', type: 'num', ops: NUM, unit: 'jours' },
    addedDays: { label: 'Ajouté il y a', type: 'num', ops: NUM, unit: 'jours' },
    rating: { label: 'Note', type: 'num', ops: NUM, unit: '/5' },
    year: { label: 'Année de sortie', type: 'num', ops: NUM },
    status: { label: 'Statut', type: 'enum', ops: ENUM },
    platform: { label: 'Console', type: 'enum', ops: ENUM },
    favorite: { label: 'Favori', type: 'bool', ops: BOOL },
    coop: { label: 'Multijoueur local', type: 'bool', ops: BOOL },
    genre: { label: 'Genre', type: 'text', ops: TXT },
    name: { label: 'Nom', type: 'text', ops: TXT },
    collection: { label: 'Collection', type: 'text', ops: TXT },
  };
  const OPS = { lt: '<', gt: '>', eq: '=', neq: '≠', has: 'contient', nhas: 'ne contient pas', is: 'est' };
  const STATUSES = ['none', 'todo', 'playing', 'done', 'complete', 'dropped'];

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const COOP_RE = /shared\/split|split.?screen|local (co-?op|multi)|écran (partagé|divisé)/i;
  const autoCoop = (g) => g.localMulti === true || (Array.isArray(g.categories) && g.categories.some((c) => COOP_RE.test(c)));
  const isCoop = (g) => (typeof g.localCoop === 'boolean' ? g.localCoop : autoCoop(g));

  // Valeur d'un champ pour un jeu (null = inconnue)
  function valueOf(g, f, now) {
    switch (f) {
      case 'playtimeH': return (g.playtime || 0) / 3600;
      case 'playCount': return g.playCount || 0;
      case 'lastPlayedDays': return g.lastPlayed ? Math.floor((now - g.lastPlayed) / DAY) : Infinity; // jamais joué = très ancien
      case 'addedDays': return g.addedAt ? Math.floor((now - g.addedAt) / DAY) : null;
      case 'rating': return g.rating || 0;
      case 'year': { const m = String(g.releaseDate || '').match(/\d{4}/); return m ? Number(m[0]) : null; }
      case 'status': return g.status || 'none';
      case 'platform': return g.platform || 'pc';
      case 'favorite': return !!g.favorite;
      case 'coop': return isCoop(g);
      case 'genre': return g.genres || [];
      case 'name': return g.name || '';
      case 'collection': return g.collections || [];
      default: return null;
    }
  }

  function test(g, rule, now) {
    const def = FIELDS[rule?.f];
    if (!def || !def.ops.includes(rule.op)) return false;
    const val = valueOf(g, rule.f, now);
    if (def.type === 'bool') return val === (rule.v === true || rule.v === 'true' || rule.v === 1);
    if (def.type === 'num') {
      const n = Number(rule.v);
      if (val == null || !Number.isFinite(n)) return false;
      return rule.op === 'lt' ? val < n : rule.op === 'gt' ? val > n : rule.op === 'eq' ? val === n : val !== n;
    }
    if (def.type === 'enum') return rule.op === 'eq' ? val === rule.v : val !== rule.v;
    // texte : sans accents ni casse ; genre / collection = liste
    const want = norm(rule.v);
    const items = (Array.isArray(val) ? val : [val]).map(norm);
    if (rule.op === 'has') return items.some((x) => x.includes(want));
    if (rule.op === 'nhas') return !items.some((x) => x.includes(want));
    return rule.op === 'eq' ? items.includes(want) : !items.includes(want);
  }

  function matches(g, coll, now = Date.now()) {
    const rules = (coll?.rules || []).filter(Boolean);
    if (!rules.length) return false;
    return coll.match === 'any' ? rules.some((r) => test(g, r, now)) : rules.every((r) => test(g, r, now));
  }
  const filter = (games, coll, now = Date.now()) => games.filter((g) => matches(g, coll, now));

  // Collections fournies (non modifiables) — activées dans les réglages
  const PRESETS = [
    { id: 'p-never', name: 'Jamais lancés', match: 'all', rules: [{ f: 'playCount', op: 'eq', v: 0 }] },
    { id: 'p-short', name: 'Moins de 2 h', match: 'all', rules: [{ f: 'playtimeH', op: 'lt', v: 2 }] },
    { id: 'p-coop', name: 'Multijoueur local', match: 'all', rules: [{ f: 'coop', op: 'is', v: true }] },
    { id: 'p-new', name: 'Ajoutés ce mois-ci', match: 'all', rules: [{ f: 'addedDays', op: 'lt', v: 30 }] },
    { id: 'p-forgotten', name: 'À reprendre', match: 'all', rules: [{ f: 'playCount', op: 'gt', v: 0 }, { f: 'lastPlayedDays', op: 'gt', v: 90 }, { f: 'status', op: 'neq', v: 'done' }, { f: 'status', op: 'neq', v: 'complete' }] },
    { id: 'p-loved', name: 'Mes préférés', match: 'any', rules: [{ f: 'favorite', op: 'is', v: true }, { f: 'rating', op: 'gt', v: 3 }] },
  ];
  const DEFAULT_ON = ['p-never', 'p-short'];

  // Nettoie une collection venant de l'interface : → collection valide ou null
  function sanitize(c) {
    if (!c || typeof c !== 'object') return null;
    const name = String(c.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return null;
    const rules = [];
    for (const r of Array.isArray(c.rules) ? c.rules.slice(0, 8) : []) {
      const def = FIELDS[r?.f];
      if (!def || !def.ops.includes(r.op)) continue;
      let v = r.v;
      if (def.type === 'num') { v = Number(v); if (!Number.isFinite(v)) continue; }
      else if (def.type === 'bool') v = v === true || v === 'true' || v === 1;
      else if (def.type === 'enum') { v = String(v ?? ''); if (r.f === 'status' && !STATUSES.includes(v)) continue; if (!v) continue; }
      else { v = String(v ?? '').trim().slice(0, 60); if (!v) continue; }
      rules.push({ f: r.f, op: r.op, v });
    }
    if (!rules.length) return null;
    return { id: /^[\w-]{3,40}$/.test(c.id || '') ? c.id : null, name, match: c.match === 'any' ? 'any' : 'all', rules, tab: c.tab !== false };
  }

  // Résumé lisible d'une règle (« Temps de jeu < 2 h »)
  function describe(r, enumLabel = (f, v) => v) {
    const def = FIELDS[r.f];
    if (!def) return '';
    const v = def.type === 'bool' ? (r.v ? 'oui' : 'non') : def.type === 'enum' ? enumLabel(r.f, r.v) : r.v;
    return `${def.label} ${OPS[r.op]} ${v}${def.unit && def.type === 'num' ? ' ' + def.unit : ''}`.trim();
  }

  return { FIELDS, OPS, STATUSES, PRESETS, DEFAULT_ON, valueOf, test, matches, filter, sanitize, describe, isCoop };
}));

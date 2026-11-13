// RR Launcher — noms de jeux : mise en forme et comparaison (logique pure, testée sous Linux).
// « RedDeadRedemption2 » → « Red Dead Redemption 2 » ; « Pokémon Émeraude » ≈ « Pokemon - Emerald Version (USA) »
// quand le titre anglais est connu. Sert au scan, à l'ajout d'un jeu et au choix du bon résultat des bases.
'use strict';

// Découpe les noms collés (dossiers / exécutables) : CamelCase, MAJUSCULES suivies d'un mot, chiffres en fin de mot.
function prettify(s = '') {
  let t = String(s).replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t.includes(' ')) {
    t = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  }
  // « Redemption2 », « Battlefield2042 » (mot d'au moins 3 lettres collé à un nombre) ; « DX12 », « 3D » restent
  t = t.replace(/([a-z]{3,})(\d+)\b/g, '$1 $2');
  return t.replace(/\s+/g, ' ').trim();
}

const ROMAN = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13' };
const STOP = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'l', 'of', 'de', 'du', 'des', 'and', 'et', 'version', 'edition', 'jeu', 'video', 'game']);

// Mots significatifs : sans accents, sans contenu entre parenthèses (régions, révisions), chiffres romains → arabes
function words(s = '') {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ')
    .filter(Boolean)
    .map((w) => ROMAN[w] || w)
    .filter((w) => !STOP.has(w));
}
const compact = (s) => words(s).join('');

// Similarité 0…1 : 1 si identiques une fois compactés (« RedDeadRedemption2 » = « Red Dead Redemption 2 »),
// sinon coefficient de Dice sur les mots, avec pénalité si les numéros d'épisode diffèrent.
function similarity(a, b) {
  const ca = compact(a), cb = compact(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const wa = words(a), wb = words(b);
  const sa = new Set(wa), sb = new Set(wb);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  let score = (2 * inter) / (sa.size + sb.size);
  const na = wa.filter((w) => /^\d+$/.test(w)).join(','), nb = wb.filter((w) => /^\d+$/.test(w)).join(',');
  if (na !== nb) score *= 0.6;
  // Un nom entièrement contenu dans l'autre (sous-titre en plus) : léger bonus
  if (na === nb && score < 0.9 && (ca.includes(cb) || cb.includes(ca)) && Math.min(ca.length, cb.length) >= 5) score = Math.max(score, 0.8);
  return score;
}

// Meilleur élément de `list` pour l'un des `names` → { item, score } (null si la liste est vide)
function best(list, names, key = (x) => x.name) {
  let out = null;
  const cands = [...new Set((Array.isArray(names) ? names : [names]).filter(Boolean))];
  for (const item of list || []) {
    const label = key(item);
    for (const n of cands) {
      const s = similarity(label, n);
      if (!out || s > out.score) out = { item, score: s };
    }
  }
  return out;
}

module.exports = { prettify, words, compact, similarity, best };

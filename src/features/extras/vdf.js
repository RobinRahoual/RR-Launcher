// EXTRAS — petit parseur VDF texte (KeyValues de Valve : appmanifest_*.acf, libraryfolders.vdf, loginusers.vdf).
// Format : "clé" "valeur" | "clé" { … } ; chaînes entre guillemets (échappements \\ \" \n \t) ou mots nus,
// commentaires // jusqu'à la fin de ligne, conditions [$WIN32] ignorées. Clé en double : la dernière gagne.
'use strict';

function tokenize(text) {
  const out = [];
  const s = String(text || '').replace(/^\uFEFF/, '');
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { out.push(c); i++; continue; }
    if (c === '[') { while (i < n && s[i] !== ']') i++; i++; continue; } // [$WIN32] etc.
    if (c === '"') {
      let v = '';
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n) {
          const e = s[i + 1];
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e; // \\ → \ ; \" → "
          i += 2;
        } else v += s[i++];
      }
      i++;
      out.push({ s: v });
      continue;
    }
    let v = '';
    while (i < n && !/[\s{}"]/.test(s[i])) v += s[i++];
    out.push({ s: v });
  }
  return out;
}

/** Analyse un texte VDF → objet imbriqué (valeurs = chaînes ou objets). */
function parseVdf(text) {
  const t = tokenize(text);
  let p = 0;
  function block() {
    const obj = {};
    while (p < t.length) {
      const k = t[p++];
      if (k === '}') return obj;
      if (k === '{') continue; // accolade orpheline : on tolère
      const v = t[p];
      if (v === '{') { p++; obj[k.s] = block(); }
      else if (v && typeof v === 'object') { p++; obj[k.s] = v.s; }
      else obj[k.s] = ''; // clé sans valeur en fin de fichier
    }
    return obj;
  }
  return block();
}

/** Accès insensible à la casse ("AppState" / "appstate"). */
function ci(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  const lk = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lk) return obj[k];
  return undefined;
}

/** libraryfolders.vdf (ancien et nouveau format) → [{ path, apps: Set<string> }] */
function libraryFolders(text) {
  const root = parseVdf(text);
  const lf = ci(root, 'libraryfolders') || {};
  const out = [];
  for (const [k, v] of Object.entries(lf)) {
    if (!/^\d+$/.test(k)) continue;
    if (typeof v === 'string') out.push({ path: v, apps: null }); // ancien format : "1" "D:\\SteamLibrary"
    else if (v && ci(v, 'path')) out.push({ path: ci(v, 'path'), apps: new Set(Object.keys(ci(v, 'apps') || {})) });
  }
  return out;
}

/** loginusers.vdf → [{ steamId, accountName, personaName, mostRecent, timestamp }] (le plus récent d'abord) */
function loginUsers(text) {
  const users = ci(parseVdf(text), 'users') || {};
  return Object.entries(users)
    .filter(([id, u]) => /^\d{17}$/.test(id) && u && typeof u === 'object')
    .map(([id, u]) => ({
      steamId: id,
      accountName: ci(u, 'AccountName') || '',
      personaName: ci(u, 'PersonaName') || '',
      mostRecent: ci(u, 'MostRecent') === '1' || ci(u, 'mostrecent') === '1',
      timestamp: Number(ci(u, 'Timestamp') || 0),
    }))
    .sort((a, b) => (b.mostRecent - a.mostRecent) || (b.timestamp - a.timestamp));
}

module.exports = { parseVdf, ci, libraryFolders, loginUsers, tokenize };

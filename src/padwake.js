// RR Launcher — WAKE : « allumer une manette ouvre le launcher ».
// Logique pure (testable sous Linux) : détection d'une NOUVELLE manette à partir de listes successives,
// anti-rebond des réveils, et condition d'activation. Le sondage lui-même vit dans src/guide.js
// (mode « connexion » du même module : une seule boucle sur les manettes).
'use strict';

/*
 * createPresence({ goneAfter })
 *   update(source, keys) → clés apparues depuis la mise à jour précédente de cette source.
 *   - 1er passage d'une source = état de référence (manettes déjà branchées) : rien n'est signalé.
 *   - une clé n'est considérée « partie » qu'après `goneAfter` passages consécutifs sans elle :
 *     un raté isolé (sondage XInput qui échoue une fois) ne fait pas croire à une nouvelle manette.
 *   reset() : oublie tout (le prochain passage redevient la référence).
 */
function createPresence({ goneAfter = 2 } = {}) {
  const known = new Map(); // source -> Map(clé -> passages manqués)
  return {
    update(source, keys) {
      const cur = new Set(keys);
      const prev = known.get(source);
      if (!prev) {
        known.set(source, new Map([...cur].map((k) => [k, 0])));
        return [];
      }
      const added = [];
      for (const k of cur) {
        if (!prev.has(k)) added.push(k);
        prev.set(k, 0);
      }
      for (const [k, miss] of [...prev]) {
        if (cur.has(k)) continue;
        if (miss + 1 >= goneAfter) prev.delete(k); else prev.set(k, miss + 1);
      }
      return added;
    },
    reset() { known.clear(); },
    get size() { return known.size; },
  };
}

// Au plus un réveil toutes les `cooldownMs` (une manette Bluetooth peut apparaître / disparaître en boucle)
function createWakeGate({ cooldownMs = 10000 } = {}) {
  let last = -Infinity;
  return {
    tryWake(now = Date.now()) {
      if (now - last < cooldownMs) return false;
      last = now;
      return true;
    },
    reset() { last = -Infinity; },
  };
}

// La surveillance des connexions n'est utile que launcher masqué / réduit et aucun jeu en cours
function wakeWanted({ enabled, gameRunning, hidden, minimized }) {
  return !!enabled && !gameRunning && (!!hidden || !!minimized);
}

// États XInput [masque | null] ×4 → clés des slots connectés
function xinputKeys(states) {
  const out = [];
  if (!states) return out;
  for (let i = 0; i < 4; i++) if (states[i] != null) out.push('xi' + i);
  return out;
}

// Liste node-hid devices() → clés des manettes reconnues (interface « manette » seulement)
function hidPadKeys(list, hidKind) {
  const out = [];
  for (const d of list || []) {
    if (!d || !d.path || !hidKind(d.vendorId, d.productId)) continue;
    if (d.usagePage && (d.usagePage !== 1 || (d.usage !== 4 && d.usage !== 5))) continue;
    out.push('hid:' + d.path);
  }
  return out;
}

module.exports = { createPresence, createWakeGate, wakeWanted, xinputKeys, hidPadKeys };

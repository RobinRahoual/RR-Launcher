// SMART (main) — collections intelligentes : stockage des collections personnalisées et des préréglages activés.
// Règles et évaluation : src/renderer/features/smart-rules.js (partagé avec le renderer).
// Données : settings.smartCollections = [{ id, name, match, rules, tab }], settings.smartPresetsOn = [ids de préréglages].
'use strict';
const crypto = require('crypto');
const R = require('../renderer/features/smart-rules');

function init(ctx) {
  const { ipcMain, store, commit } = ctx;
  const S = () => store.data.settings;
  if (!Array.isArray(S().smartCollections)) S().smartCollections = [];
  if (!Array.isArray(S().smartPresetsOn)) S().smartPresetsOn = [...R.DEFAULT_ON];
  const state = () => ({ presets: R.PRESETS, on: S().smartPresetsOn, custom: S().smartCollections });

  ipcMain.handle('x:smart:get', () => state());
  ipcMain.handle('x:smart:save', (_e, coll) => {
    const c = R.sanitize(coll);
    if (!c) return { ok: false, error: 'Donne un nom et au moins une règle valide' };
    const L = S().smartCollections;
    const i = c.id ? L.findIndex((x) => x.id === c.id) : -1;
    if (L.some((x, j) => j !== i && x.name.toLocaleLowerCase('fr') === c.name.toLocaleLowerCase('fr'))) return { ok: false, error: 'Ce nom est déjà pris' };
    if (i >= 0) L[i] = c; else { c.id = 'c-' + crypto.randomBytes(4).toString('hex'); if (L.length >= 30) return { ok: false, error: '30 collections intelligentes au maximum' }; L.push(c); }
    commit();
    return { ok: true, ...state() };
  });
  ipcMain.handle('x:smart:delete', (_e, id) => {
    S().smartCollections = S().smartCollections.filter((x) => x.id !== id);
    commit();
    return { ok: true, ...state() };
  });
  ipcMain.handle('x:smart:preset', (_e, id, on) => {
    if (!R.PRESETS.some((p) => p.id === id)) return { ok: false };
    const set = new Set(S().smartPresetsOn);
    if (on) set.add(id); else set.delete(id);
    S().smartPresetsOn = [...set];
    commit();
    return { ok: true, ...state() };
  });
}

module.exports = { init };

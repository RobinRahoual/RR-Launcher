// UNINSTALLED — « Jeux à installer » : jeux possédés sur Steam (clé API des Réglages), Epic (compte connecté) et
// GOG (base locale de Galaxy) qui ne sont pas dans la bibliothèque du launcher. Installation via le client du store.
// Canaux : x:uninst:list (cache) | refresh | install. Données : store.data.uninstalled = { at, items, errors }.
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./uninstalled/core');
const sqlite = require('./importer/sqlite');

function init(ctx) {
  const { ipcMain, store, log } = ctx;
  const S = () => store.data.settings || {};
  const D = () => (store.data.uninstalled ||= { at: 0, items: [], errors: {} });
  let busy = null;
  const fetch = (u, o) => require('electron').net.fetch(u, o);

  async function steam() {
    const key = S().steamApiKey, id = S().steamId64;
    if (!key || !id) return { skipped: 'Renseigne ta clé API et ton profil Steam dans Réglages → Fonctions' };
    const r = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&include_appinfo=true&include_played_free_games=true&format=json`);
    if (!r.ok) throw new Error(`Steam : HTTP ${r.status}`);
    const items = core.steamOwned(await r.json());
    if (!items.length) throw new Error('Steam : aucune donnée (profil ou « Détails des jeux » privés ?)');
    return { items };
  }
  async function epic() {
    const e = ctx.epic;
    if (!e?.connected()) return { skipped: 'Connecte ton compte Epic dans Réglages (Temps de jeu)' };
    const lib = await e.library();
    const items = lib.map(({ rec, cat }) => core.epicItem(rec, cat)).filter(Boolean);
    if (!items.length) throw new Error(`aucun jeu trouvé (${lib.length} entrées reçues, ${lib.filter((x) => x.cat).length} avec fiche)`);
    return { items };
  }
  function gog() {
    const f = process.env.RR_GOG_DB || path.join(process.env.ProgramData || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
    if (!fs.existsSync(f)) return { skipped: 'GOG Galaxy n’est pas installé sur ce PC' };
    return { items: core.gogOwned(sqlite.openFile(fs, f)) };
  }

  async function refresh() {
    if (busy) return busy;
    busy = (async () => {
      const items = [], errors = {};
      for (const [name, fn] of [['steam', steam], ['epic', epic], ['gog', gog]]) {
        try { const r = await fn(); if (r.skipped) errors[name] = r.skipped; else items.push(...r.items); }
        catch (e) { errors[name] = e.message; log(`à installer ${name} : ${e.message}`); }
      }
      Object.assign(D(), { at: Date.now(), items, errors });
      store.save?.();
      return view();
    })().finally(() => { busy = null; });
    return busy;
  }
  function view() {
    const d = D();
    const list = core.notInstalled(d.items, store.data.games || []);
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    return { at: d.at, errors: d.errors, items: list, owned: d.items.length };
  }

  ipcMain.handle('x:uninst:list', () => view());
  ipcMain.handle('x:uninst:refresh', () => refresh());
  ipcMain.handle('x:uninst:install', async (_e, storeId, id) => {
    const it = D().items.find((x) => x.store === storeId && x.id === String(id));
    const p = core.installPlan(it);
    if (!p) return { ok: false, error: 'Jeu introuvable' };
    try { await require('electron').shell.openExternal(p.uri); log(`installer : ${it.name} → ${p.label}`); return { ok: true, label: p.label, name: it.name }; }
    catch (e) { return { ok: false, error: `${p.label} ne répond pas (${e.message})` }; }
  });
}

module.exports = { init };

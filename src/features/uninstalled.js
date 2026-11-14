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
  // ---- Bibliothèque familiale Steam : demande une session web Steam (fenêtre de connexion officielle, cookies conservés
  // dans une partition dédiée ; ni mot de passe ni jeton enregistrés par le launcher)
  const PART = 'persist:steam-web';
  const web = () => require('electron').session.fromPartition(PART);
  async function webToken() {
    const r = await web().fetch('https://store.steampowered.com/pointssummary/ajaxgetasyncconfig', { headers: { Accept: 'application/json' } });
    if (!r.ok) return '';
    const j = await r.json().catch(() => ({}));
    return String(j?.data?.webapi_token || '');
  }
  async function family(ownedIds) {
    const id = S().steamId64;
    if (!id) return { skipped: 'Renseigne ton profil Steam dans Réglages → Fonctions' };
    const tok = await webToken().catch(() => '');
    if (!tok) return { skipped: 'Famille Steam : connecte ton compte Steam (bouton ci-dessous)', needLogin: true };
    const api = (m, q) => web().fetch(`https://api.steampowered.com/IFamilyGroupsService/${m}/v1/?access_token=${encodeURIComponent(tok)}&${q}`).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const g = await api('GetFamilyGroupForUser', `steamid=${encodeURIComponent(id)}`);
    const gid = g?.response?.family_groupid;
    if (!gid || gid === '0') return { skipped: 'Famille Steam : ton compte n’est dans aucun groupe famille' };
    const j = await api('GetSharedLibraryApps', `family_groupid=${encodeURIComponent(gid)}&steamid=${encodeURIComponent(id)}&include_own=false&include_excluded=false&include_free=false&include_non_games=false`);
    return { items: core.steamFamily(j, ownedIds) };
  }
  let loginWin = null;
  function steamLogin() {
    return new Promise((resolve) => {
      if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return resolve({ ok: false, error: 'Fenêtre déjà ouverte' }); }
      const { BrowserWindow } = require('electron');
      loginWin = new BrowserWindow({ width: 520, height: 760, title: 'Connexion Steam', autoHideMenuBar: true, parent: ctx.getWin?.() || undefined, webPreferences: { partition: PART, contextIsolation: true, sandbox: true, nodeIntegration: false } });
      let done = false, timer = null;
      const finish = (r) => { if (done) return; done = true; clearInterval(timer); if (loginWin && !loginWin.isDestroyed()) loginWin.destroy(); resolve(r); };
      loginWin.on('closed', () => finish({ ok: false, cancelled: true }));
      loginWin.loadURL('https://store.steampowered.com/login/?redir=pointssummary');
      timer = setInterval(async () => { if (done) return; const t = await webToken().catch(() => ''); if (t) finish({ ok: true }); }, 2000);
    });
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
      let needLogin = false;
      try {
        const r = await family(new Set(items.filter((x) => x.store === 'steam').map((x) => x.id)));
        if (r.skipped) { errors.famille = r.skipped; needLogin = !!r.needLogin; } else items.push(...r.items);
      } catch (e) { errors.famille = `Famille Steam : ${e.message}`; log(`à installer famille : ${e.message}`); }
      Object.assign(D(), { at: Date.now(), items, errors, needLogin });
      store.save?.();
      return view();
    })().finally(() => { busy = null; });
    return busy;
  }
  function view() {
    const d = D();
    const list = core.notInstalled(d.items, store.data.games || []);
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    return { at: d.at, errors: d.errors, items: list, owned: d.items.length, needLogin: !!d.needLogin };
  }

  ipcMain.handle('x:uninst:steamLogin', async () => { const r = await steamLogin(); if (r.ok) await refresh(); return r; });
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

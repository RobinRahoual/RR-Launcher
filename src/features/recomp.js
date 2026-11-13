// RECOMP — boutique de recomp / portages PC (façon RecompLauncher) : catalogue (embarqué + copie distante sur
// GitHub), vérification de la copie du jeu fournie par le joueur, téléchargement de la dernière release GitHub,
// extraction, placement de la ROM quand la recomp la lit dans son dossier, ajout à la bibliothèque sous la console
// d'origine. Aucun fichier de jeu n'est téléchargé : seule la recomp (code libre) vient d'Internet.
// Fichiers : src/features/recomp/*. Canaux x:recomp:*. Données : store.data.recomps = { installs, roms, catalog }.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./recomp/core');
const { download, json } = require('./emu/download');
const { extract } = require('./emu/extract');
const GITHUB_API = process.env.RR_EMU_GITHUB_API || 'https://api.github.com';

function init(ctx) {
  const { ipcMain, store, send, log, commit } = ctx;
  store.data.recomps ||= {};
  const D = store.data.recomps;
  D.installs ||= {}; D.roms ||= {};
  const root = process.env.RR_RECOMP_ROOT || (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'RR Launcher', 'recomps') : path.join(ctx.DATA, 'recomps'));
  const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} };

  // ---------------------------------------------------------------- Catalogue
  let remoteAt = 0;
  async function catalog(force = false) {
    if (force || Date.now() - remoteAt > 6 * 3600e3) {
      remoteAt = Date.now();
      try {
        const r = await json(R.REMOTE_URL);
        if (Array.isArray(r?.recomps)) { D.catalog = { recomps: r.recomps, at: Date.now() }; commit(); }
      } catch (e) { log(`recomp : catalogue distant indisponible (${e.message}), copie locale utilisée`); }
    }
    return R.merge(D.catalog);
  }
  const entryById = async (id) => (await catalog()).find((e) => e.id === id);
  const latest = new Map(); // id → { tag, at }

  function state(e) {
    const ins = D.installs[e.id];
    const exists = !!(ins?.exe && fs.existsSync(ins.exe));
    const rom = D.roms[e.id];
    const lt = latest.get(e.id);
    return {
      ...e,
      installed: exists ? { version: ins.version, exe: ins.exe, dir: ins.dir, gameId: ins.gameId, date: ins.date } : null,
      mine: rom?.path && fs.existsSync(rom.path) ? rom : null, // copie du jeu choisie par le joueur
      latest: lt?.tag || null,
      update: !!(exists && lt?.tag && ins.version && lt.tag !== ins.version),
    };
  }
  ipcMain.handle('x:recomp:list', async (_e, o = {}) => ({ root, items: (await catalog(!!o.refresh)).map(state) }));

  // ---------------------------------------------------------------- Release GitHub
  async function release(e, { signal } = {}) {
    let rel = null;
    if (!e.prerelease) {
      try { rel = await json(`${GITHUB_API}/repos/${e.repo}/releases/latest`, { signal }); } catch (err) { if (err.name === 'AbortError') throw err; }
    }
    if (!R.pickAsset(rel)) {
      const list = await json(`${GITHUB_API}/repos/${e.repo}/releases?per_page=10`, { signal });
      rel = (list || []).find((r) => !r.draft && R.pickAsset(r)) || null;
    }
    const a = R.pickAsset(rel);
    if (!a) throw Object.assign(new Error(`Pas d’archive Windows dans les releases de ${e.name}`), { site: `https://github.com/${e.repo}/releases` });
    latest.set(e.id, { tag: rel.tag_name || rel.name || '', at: Date.now() });
    return { url: a.browser_download_url, file: a.name, size: a.size, sha256: /^sha256:([a-f0-9]{64})$/i.exec(a.digest || '')?.[1], version: rel.tag_name || rel.name || '' };
  }
  ipcMain.handle('x:recomp:checkUpdate', async (_e, id) => {
    const e = await entryById(id);
    if (!e) return null;
    try { await release(e); } catch (err) { return { ...state(e), error: String(err.message || err) }; }
    return state(e);
  });

  // ---------------------------------------------------------------- Copie du jeu (ROM / dump)
  ipcMain.handle('x:recomp:pickRom', async (_e, id) => {
    const e = await entryById(id);
    if (!e) return { ok: false, error: 'Recomp inconnue' };
    const { dialog } = require('electron');
    const folder = e.rom.system === 'folder';
    const exts = e.rom.system === 'n64' ? ['z64', 'n64', 'v64'] : e.rom.system === 'gc' ? ['iso', 'gcm', 'rvz', 'ciso', 'gcz'] : ['*'];
    const r = await dialog.showOpenDialog(ctx.getWin(), {
      title: `Ta copie : ${e.rom.label}`,
      properties: folder ? ['openDirectory', 'openFile'] : ['openFile'],
      filters: folder ? [] : [{ name: e.rom.system === 'n64' ? 'ROM Nintendo 64' : e.rom.system === 'gc' ? 'Image GameCube' : 'Fichier du jeu', extensions: exts }, { name: 'Tous', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const file = r.filePaths[0];
    const c = await R.checkRom(file, e.rom);
    if (c.ok) { D.roms[id] = { path: file, info: c.info || path.basename(file), warn: c.warn || null }; commit(); }
    return { ...c, path: file };
  });
  ipcMain.handle('x:recomp:clearRom', (_e, id) => { delete D.roms[id]; commit(); return true; });

  // ---------------------------------------------------------------- Installation
  let job = null;
  async function install(id, { update = false } = {}) {
    const e = await entryById(id);
    if (!e) return { ok: false, error: 'Recomp inconnue' };
    if (job) return { ok: false, error: 'Une installation est déjà en cours' };
    const rom = D.roms[id];
    if (e.rom.place === 'copy' && !rom?.path) return { ok: false, error: 'Choisis d’abord ta copie du jeu' };
    const ctrl = new AbortController();
    job = { id, ctrl };
    const step = (phase, extra = {}) => send('x:recomp:progress', { id, phase, ...extra });
    const dir = path.join(root, id);
    const dl = path.join(root, '_downloads');
    const staging = path.join(root, '_staging', id);
    try {
      fs.mkdirSync(dl, { recursive: true });
      step('resolve', { label: `Recherche de la dernière version de ${e.name}…` });
      const src = await release(e, { signal: ctrl.signal });
      const archive = path.join(dl, src.file.replace(/[^\w.-]+/g, '_'));
      const label = `Téléchargement de ${e.name} ${src.version}`;
      step('download', { label, got: 0, total: src.size || 0 });
      await download(src.url, archive, { signal: ctrl.signal, size: src.size, sha256: src.sha256, onProgress: (p) => step('download', { label, ...p }) });
      step('extract', { label: `Extraction de ${e.name}…` });
      rm(staging);
      await extract(archive, staging, { signal: ctrl.signal });
      const top = R.contentRoot(staging);
      if (!R.findExe(top, e.exe)) throw new Error(`Archive de ${e.name} inattendue : aucun exécutable Windows`);
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(top, dir, { recursive: true, force: true }); // une mise à jour garde sauvegardes, réglages et ROM
      rm(staging); rm(archive);
      const exe = R.findExe(dir, e.exe);

      // ROM : copiée là où la recomp la cherche (portages HarbourMasters, Perfect Dark…)
      let romNote = null;
      if (e.rom.place === 'copy' && rom?.path) {
        const dest = path.join(dir, e.rom.target || path.basename(rom.path));
        if (!fs.existsSync(dest)) {
          step('rom', { label: 'Copie de ta ROM dans le dossier de la recomp…' });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          await fs.promises.copyFile(rom.path, dest);
        }
        romNote = dest;
      }

      // Bibliothèque : rangée sous la console d'origine, fiche du jeu original (jaquette, fond, description)
      let gameId = D.installs[id]?.gameId;
      let g = gameId && ctx.findGame(gameId);
      if (g) { g.exePath = exe; g.installDir = dir; }
      else { g = ctx.addGame({ kind: 'exe', exePath: exe, installDir: dir, name: e.game || e.name, platform: e.platform, source: 'recomp' }); gameId = g?.id; }
      if (g) g.recomp = { id, place: e.rom.place, rom: rom?.path || null };
      D.installs[id] = { exe, dir, version: src.version, gameId, date: Date.now() };
      commit();
      log(`recomp : ${e.name} ${src.version} installé (${exe})`);
      step('done', { label: `${e.name} prêt` });
      return { ok: true, gameId, version: src.version, romCopied: romNote, ...state(e) };
    } catch (err) {
      const cancelled = err.name === 'AbortError' || ctrl.signal.aborted;
      rm(staging);
      log(`recomp : ${id} : ${err.message}`);
      const msg = cancelled ? 'Installation annulée' : String(err.message || err);
      step(cancelled ? 'cancelled' : 'error', { label: msg });
      return { ok: false, cancelled, error: msg, site: err.site };
    } finally { job = null; }
  }
  ipcMain.handle('x:recomp:install', (_e, id, o = {}) => install(String(id || ''), { update: !!o.update }));
  ipcMain.handle('x:recomp:cancel', () => { job?.ctrl.abort(); return true; });

  ipcMain.handle('x:recomp:uninstall', async (_e, id, o = {}) => {
    const ins = D.installs[id];
    if (!ins) return false;
    if (job?.id === id) return false;
    if (ins.dir && path.resolve(ins.dir).startsWith(path.resolve(root) + path.sep)) rm(ins.dir); // jamais hors du dossier recomps
    if (o.removeGame !== false && ins.gameId) {
      store.data.games = store.data.games.filter((g) => g.id !== ins.gameId);
      rm(path.join(ctx.MEDIA, path.basename(ins.gameId)));
    }
    delete D.installs[id];
    commit();
    return true;
  });
  ipcMain.handle('x:recomp:openFolder', (_e, id) => {
    const dir = D.installs[id]?.dir;
    if (!dir) return false;
    require('electron').shell.openPath(dir);
    return true;
  });
}

module.exports = { init };

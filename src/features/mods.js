// MODS — gestion des mods et patchs par jeu.
//  • Jeux ROM : patchs IPS / BPS / UPS. Une copie patchée « <ROM> (patché).<ext> » est fabriquée à côté (jamais la ROM d'origine)
//    et c'est elle qui est lancée tant qu'au moins un patch est activé (hub.prepareRom, appelé par main.js/launchGame).
//  • Jeux PC / recomps : mods de fichiers (dossier ou archive .zip / .7z…) copiés dans le dossier du jeu ; les originaux
//    écrasés sont sauvegardés et remis en place à la désactivation (voir mods/core.js).
// Données : store.data.mods[idJeu] = { list: [{ id, name, type: 'patch'|'files', enabled, file?, files?, addedAt }], state }.
// Fichiers : <données>/mods/<idJeu>/…  Canaux : x:mods:list | add | toggle | remove | move | open.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./mods/core');
const P = require('./mods/patch');

const ARCHIVES = ['zip', '7z', 'rar', 'tar', 'gz'];
const PATCH_EXT = ['ips', 'bps', 'ups'];

function init(ctx) {
  const { ipcMain, store, running, findGame, commit, DATA, log } = ctx;
  store.data.mods ||= {};
  const root = path.join(DATA, 'mods');
  const entry = (id) => (store.data.mods[id] ||= { list: [], state: { installed: {}, backed: [] } });
  const gameDir = (id) => path.join(root, id);
  const installDirOf = (g) => g.installDir || (g.exePath ? path.dirname(g.exePath) : '');
  const typeOf = (g) => (g.kind === 'rom' ? 'patch' : 'files');
  const view = (g) => {
    const e = entry(g.id);
    return { ok: true, type: typeOf(g), target: g.kind === 'rom' ? g.romPath : installDirOf(g), canFiles: typeOf(g) === 'patch' || !!installDirOf(g),
      running: running.has(g.id), list: e.list.map((m) => ({ id: m.id, name: m.name, type: m.type, enabled: m.enabled, count: m.files?.length, addedAt: m.addedAt })) };
  };
  const err = (error) => ({ ok: false, error });

  // Applique l'état voulu des mods de fichiers dans le dossier du jeu
  function syncGame(g) {
    const e = entry(g.id);
    const r = C.syncFiles({ installDir: installDirOf(g), gameDir: gameDir(g.id), mods: e.list.filter((m) => m.type === 'files'), state: e.state });
    e.state = r.state;
    commit();
    if (r.errors.length) log(`mods : ${g.name} : ${r.errors.join(' ; ')}`);
    return r.errors;
  }

  // ROM à lancer : copie patchée si des patchs sont activés (sinon la ROM d'origine)
  function prepareRom(g) {
    const patches = entry(g.id).list.filter((m) => m.type === 'patch' && m.enabled).map((m) => ({ id: m.id, file: m.file }));
    if (!patches.length) return { romPath: g.romPath };
    try {
      const r = C.buildPatched({ romPath: g.romPath, patches, outDir: path.join(gameDir(g.id), 'patched') });
      if (r.rebuilt) log(`mods : ROM patchée pour ${g.name} (${patches.length} patch${patches.length > 1 ? 's' : ''})`);
      return { romPath: r.path, patched: true };
    } catch (e) { return { error: `Patch impossible : ${e.message}` }; }
  }
  ctx.hub.prepareRom = prepareRom;

  ipcMain.handle('x:mods:list', (_e, id) => { const g = findGame(id); return g ? view(g) : err('Jeu introuvable'); });
  ipcMain.handle('x:mods:open', (_e, id) => { fs.mkdirSync(gameDir(id), { recursive: true }); require('electron').shell.openPath(gameDir(id)); return true; });

  ipcMain.handle('x:mods:add', async (_e, id) => {
    const g = findGame(id);
    if (!g) return err('Jeu introuvable');
    const { dialog } = require('electron');
    const rom = g.kind === 'rom';
    if (!rom && !installDirOf(g)) return err('Dossier du jeu inconnu : impossible d’y installer un mod');
    const r = await dialog.showOpenDialog(ctx.getWin(), rom
      ? { title: `Patch pour ${g.name}`, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Patchs ROM (IPS, BPS, UPS)', extensions: PATCH_EXT }, { name: 'Tous', extensions: ['*'] }] }
      : { title: `Mod pour ${g.name} (dossier ou archive)`, properties: ['openFile', 'openDirectory', 'multiSelections'], filters: [{ name: 'Archives', extensions: ARCHIVES }, { name: 'Tous', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return err('');
    return addPaths(g, r.filePaths);
  });
  async function addPaths(g, paths) {
    const e = entry(g.id);
    const errors = [];
    for (const src of paths) {
      const modId = crypto.randomBytes(4).toString('hex');
      const name = path.basename(src).replace(/\.[^.]+$/, '') || 'Mod';
      try {
        if (g.kind === 'rom') {
          const ext = path.extname(src).toLowerCase().slice(1);
          if (!PATCH_EXT.includes(ext)) throw new Error('format non géré (IPS, BPS ou UPS)');
          const dst = path.join(gameDir(g.id), 'patches', `${modId}.${ext}`);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          try { // essai à blanc : le patch correspond-il à cette ROM ?
            const rs = fs.statSync(g.romPath);
            if (rs.size > C.MAX_ROM) throw new Error('ROM trop volumineuse (256 Mo maximum)');
            P.apply(fs.readFileSync(g.romPath), fs.readFileSync(dst));
          } catch (x) { fs.rmSync(dst, { force: true }); throw x; }
          e.list.push({ id: modId, name, type: 'patch', enabled: true, file: dst, addedAt: Date.now() });
        } else {
          const out = path.join(gameDir(g.id), modId, 'files');
          fs.mkdirSync(out, { recursive: true });
          try {
            if (fs.statSync(src).isDirectory()) fs.cpSync(src, out, { recursive: true });
            else if (ARCHIVES.includes(path.extname(src).toLowerCase().slice(1))) { await require('./emu/extract').extract(src, out); C.flattenSingleRoot(out); }
            else fs.copyFileSync(src, path.join(out, path.basename(src))); // fichier seul (ex. une .dll)
            const files = C.listFiles(out);
            if (!files.length) throw new Error('aucun fichier');
            e.list.push({ id: modId, name, type: 'files', enabled: false, files, addedAt: Date.now() });
          } catch (x) { fs.rmSync(path.join(gameDir(g.id), modId), { recursive: true, force: true }); throw x; }
        }
      } catch (x) { errors.push(`${path.basename(src)} : ${x.message}`); }
    }
    commit();
    return { ...view(g), errors };
  }

  ipcMain.handle('x:mods:toggle', (_e, id, modId, on) => {
    const g = findGame(id), m = g && entry(id).list.find((x) => x.id === modId);
    if (!m) return err('Introuvable');
    if (m.type === 'files' && running.has(id)) return err('Ferme le jeu avant d’activer ou désactiver un mod.');
    m.enabled = !!on;
    const errors = m.type === 'files' ? syncGame(g) : (commit(), []);
    return { ...view(g), errors };
  });
  ipcMain.handle('x:mods:move', (_e, id, modId, delta) => {
    const g = findGame(id);
    if (!g) return err('Introuvable');
    const L = entry(id).list, i = L.findIndex((x) => x.id === modId), j = i + (delta < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= L.length) return view(g);
    if (running.has(id)) return err('Ferme le jeu avant de changer l’ordre.');
    [L[i], L[j]] = [L[j], L[i]];
    const errors = syncGame(g); // l'ordre décide du gagnant en cas de conflit
    return { ...view(g), errors };
  });
  ipcMain.handle('x:mods:remove', (_e, id, modId) => {
    const g = findGame(id), e = g && entry(id);
    const m = e?.list.find((x) => x.id === modId);
    if (!m) return err('Introuvable');
    if (m.type === 'files' && running.has(id)) return err('Ferme le jeu avant de supprimer un mod.');
    m.enabled = false;
    if (m.type === 'files') syncGame(g);
    e.list = e.list.filter((x) => x.id !== modId);
    try { if (m.type === 'patch') fs.rmSync(m.file, { force: true }); else fs.rmSync(path.join(gameDir(id), modId), { recursive: true, force: true }); } catch {}
    commit();
    return view(g);
  });
}

module.exports = { init };

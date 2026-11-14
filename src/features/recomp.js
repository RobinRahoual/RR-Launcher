// RECOMP — boutique de recomp / portages PC (façon RecompLauncher) : catalogue (embarqué + copie distante sur
// GitHub), vérification de la copie du jeu fournie par le joueur, téléchargement de la dernière release GitHub,
// extraction, placement de la ROM quand la recomp la lit dans son dossier, ajout à la bibliothèque sous la console
// d'origine. Aucun fichier de jeu n'est téléchargé : seule la recomp (code libre) vient d'Internet.
// Fichiers : src/features/recomp/*. Canaux x:recomp:*. Données : store.data.recomps = { installs, roms, catalog }.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
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
  // Catalogue complet de RecompLauncher (pc-catalog.json, ~1,7 Mo) gardé dans son propre fichier (pas dans
  // library.json), relu toutes les 6 h ou sur « Actualiser ». Hors ligne : la dernière copie, sinon les entrées embarquées.
  delete D.catalog; // ancien format (1.11–1.12)
  const catFile = path.join(ctx.DATA, 'recomp-catalog.json');
  let cat = null, catAt = 0, items = null, fetching = null;
  try { const c = JSON.parse(fs.readFileSync(catFile, 'utf8')); if (Array.isArray(c?.apps)) { cat = c; catAt = fs.statSync(catFile).mtimeMs; } } catch {}
  async function catalog(force = false) {
    if ((force || !cat || Date.now() - catAt > 6 * 3600e3) && !process.env.RR_RECOMP_OFFLINE) {
      fetching ||= (async () => {
        try {
          const r = await json(R.REMOTE_URL);
          if (Array.isArray(r?.apps) && r.apps.length) {
            cat = { origins: Array.isArray(r.origins) ? r.origins : [], apps: r.apps };
            catAt = Date.now(); items = null;
            fs.mkdirSync(path.dirname(catFile), { recursive: true });
            fs.writeFileSync(catFile + '.tmp', JSON.stringify(cat)); fs.renameSync(catFile + '.tmp', catFile);
            log(`recomp : catalogue RecompLauncher, ${r.apps.length} entrées`);
          }
        } catch (e) { catAt = Date.now() - 5.5 * 3600e3; log(`recomp : catalogue distant indisponible (${e.message}), copie locale utilisée`); }
        finally { fetching = null; }
      })();
      await fetching;
    }
    return (items ||= R.merge(cat));
  }
  const entryById = async (id) => (await catalog()).find((e) => e.id === id);
  const latest = new Map(); // id → { tag, at }

  function state(e, light = false) {
    const ins = D.installs[e.id];
    const exists = !!(ins?.exe && fs.existsSync(ins.exe));
    const rom = D.roms[e.id];
    const lt = latest.get(e.id);
    const { boot, ...rest } = e; // le manifeste reste côté main
    return {
      ...rest,
      ...(light ? { desc: undefined } : {}),
      hasBoot: !!boot,
      installable: !!(e.repo && e.windows && !e.soon),
      cover: e.cover || coverUrl(e.id),
      installed: exists ? { version: ins.version, exe: ins.exe, dir: ins.dir, gameId: ins.gameId, date: ins.date } : null,
      mine: rom?.path && fs.existsSync(rom.path) ? rom : null, // copie du jeu choisie par le joueur
      latest: lt?.tag || null,
      update: !!(exists && lt?.tag && ins.version && lt.tag !== ins.version),
    };
  }
  ipcMain.handle('x:recomp:list', async (_e, o = {}) => {
    const all = await catalog(!!o.refresh);
    const list = all.map((e) => state(e, true));
    if (!process.env.RR_RECOMP_NO_COVERS) setTimeout(() => fetchCovers(all.filter((e) => !e.cover)).catch((e) => log(`recomp : jaquettes ${e.message}`)), 50);
    return { root, items: list, at: catAt || null, source: cat ? 'recomplauncher' : 'embarqué' };
  });
  ipcMain.handle('x:recomp:get', async (_e, id) => { const e = await entryById(id); return e ? state(e) : null; });

  // ---------------------------------------------------------------- Jaquettes (rayons du catalogue)
  // Ordre : e.cover (URL du catalogue) → libretro-thumbnails (nom No-Intro / Redump le plus proche) → Wikipédia EN
  // (image de l'infobox). Cache : <DATA>/recomp-covers/<id>.<ext>, servi par rr://recomp/<id>.
  const coverDir = path.join(ctx.DATA, 'recomp-covers');
  const coverFile = (id) => { try { return fs.readdirSync(coverDir).find((f) => f.replace(/\.\w+$/, '') === id) || null; } catch { return null; } };
  const coverUrl = (id) => { const f = coverFile(id); if (!f) return null; let v = 0; try { v = Math.round(fs.statSync(path.join(coverDir, f)).mtimeMs); } catch {} return `rr://recomp/${encodeURIComponent(f)}?v=${v}`; };
  ctx.protoRoute?.('recomp', (_req, u) => {
    const f = path.basename(decodeURIComponent(u.pathname));
    const full = path.join(coverDir, f);
    if (!f || !fs.existsSync(full)) return new Response('Not found', { status: 404 });
    const type = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(f).toLowerCase()] || 'image/jpeg';
    return new Response(fs.readFileSync(full), { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } });
  });
  const tried = new Set();
  let coverBusy = false;
  async function fetchCovers(items) {
    if (coverBusy) return;
    coverBusy = true;
    try {
      const meta = require('../metadata');
      const { BY_ID } = require('../platforms');
      for (const e of items) {
        if (coverFile(e.id) || tried.has(e.id)) continue;
        tried.add(e.id);
        const urls = [];
        if (/^https:\/\//.test(e.cover || '')) urls.push(e.cover);
        const repo = BY_ID[e.platform]?.libretro;
        if (repo) {
          const name = await meta.libretroMatch(repo, [e.boxart || e.game, e.game]).catch(() => null);
          if (name) urls.push(`https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/${encodeURIComponent(name.replace(/[&*/:`<>?\\|"]/g, '_'))}.png`);
        }
        try {
          const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent((e.wiki || e.game).replace(/ /g, '_'))}`, { headers: { 'User-Agent': 'RR-Launcher' }, signal: AbortSignal.timeout(12000) }).then((r) => (r.ok ? r.json() : null));
          if (sum?.originalimage?.source) urls.push(sum.originalimage.source);
          else if (sum?.thumbnail?.source) urls.push(sum.thumbnail.source);
        } catch {}
        const f = await meta.downloadFirst(urls, coverDir, e.id).catch(() => null);
        if (f) send('x:recomp:cover', { id: e.id, url: coverUrl(e.id) });
      }
    } finally { coverBusy = false; }
  }

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
  ipcMain.handle('x:recomp:pickRom', async (_e, id, o = {}) => {
    const e = await entryById(id);
    if (!e) return { ok: false, error: 'Recomp inconnue' };
    const { dialog } = require('electron');
    const sys = e.rom.system;
    const folder = sys === 'folder';
    const both = sys === 'iso_or_folder' || sys === 'any';
    const exts = sys === 'n64' ? ['z64', 'n64', 'v64'] : sys === 'gc' ? ['iso', 'gcm', 'rvz', 'ciso', 'gcz'] : sys === 'iso' || sys === 'iso_or_folder' ? ['iso', 'xex', 'chd', 'rvz', 'nup', 'xci', 'nsp', 'cue', 'bin', 'pkg'] : ['*'];
    // Windows ne sait pas choisir fichier OU dossier dans la même fenêtre : on demande lequel au renderer (o.folder)
    const asFolder = folder || (both && !!o?.folder);
    const r = await dialog.showOpenDialog(ctx.getWin(), {
      title: `Ta copie : ${e.rom.label}`.slice(0, 120),
      properties: asFolder ? ['openDirectory'] : ['openFile'],
      filters: asFolder ? [] : [{ name: sys === 'n64' ? 'ROM Nintendo 64' : sys === 'gc' ? 'Image GameCube' : 'Copie du jeu', extensions: exts }, { name: 'Tous', extensions: ['*'] }],
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
    if (!e.repo) return { ok: false, error: 'Ce projet ne publie pas de version GitHub que le launcher sait installer : ouvre sa page.', site: e.url };
    if (!e.windows) return { ok: false, error: 'Ce projet ne propose pas de version Windows.', site: e.url };
    if (e.soon) return { ok: false, error: 'Ce projet n’est pas encore sorti.', site: e.url };
    if ((e.rom.place === 'copy' || e.rom.place === 'arg') && !rom?.path) return { ok: false, error: 'Choisis d’abord ta copie du jeu' };
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
      if (!R.findExe(top, e.exe, 4)) throw new Error(`Archive de ${e.name} inattendue : aucun exécutable Windows (peut-être un installateur : ouvre la page du projet)`);
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(top, dir, { recursive: true, force: true }); // une mise à jour garde sauvegardes, réglages et ROM
      rm(staging); rm(archive);
      // Manifeste « recomplauncher.json » de la release (sinon celui du catalogue) : programme, arguments, variables
      let boot = e.boot;
      try { const m = JSON.parse(fs.readFileSync(path.join(dir, 'recomplauncher.json'), 'utf8')); if (m?.format === 1 || m?.start) boot = m; } catch {}
      const { app } = require('electron');
      const vars = {
        game: rom?.path || '', documents: app?.getPath ? app.getPath('documents') : path.join(os.homedir(), 'Documents'),
        local: process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), config: process.env.APPDATA || path.join(os.homedir(), '.config'), home: os.homedir(), pad: 'xbox',
      };
      const start = R.startFrom(boot, dir, vars);
      const exe = start?.exe || R.findExe(dir, e.exe);
      if (!exe) throw new Error(`Archive de ${e.name} inattendue : aucun exécutable Windows`);

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
      else { g = ctx.addGame({ kind: 'exe', exePath: exe, installDir: dir, name: e.game || e.name, platform: e.platform || 'pc', source: 'recomp' }); gameId = g?.id; }
      if (g) {
        g.recomp = { id, place: e.rom.place, rom: rom?.path || null };
        if (start) {
          g.args = R.joinArgs(start.args);
          if (start.env.length) { g.launch ||= {}; g.launch.env = start.env.join('\n'); }
        }
      }
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

'use strict';
// Module IMPORTER (main) : nettoyage de la bibliothèque. (Les sources d'import des launchers sont dans importer/sources.js.)
// IPC : x:importer:analyze · x:importer:merge ({ groups:[{ keep, drop:[ids] }] }) · x:importer:remove ({ ids }) · x:importer:tried ({ ids })
// Données : store.data.importer = { tried: { <id>: horodatage } } (dernière tentative de récupération des visuels).
const fs = require('fs');
const path = require('path');
const cleanup = require('./importer/cleanup');

exports.init = (ctx) => {
  const { ipcMain, store, running, MEDIA, commit } = ctx;
  const games = () => store.data.games || [];
  const fsx = { exists: (p) => fs.promises.access(p).then(() => true, () => false) };
  const info = (g) => ({ id: g.id, name: g.name, platform: g.platform, kind: g.kind, source: g.source || '', playtime: g.playtime || 0, favorite: !!g.favorite, status: g.status || 'none', rating: g.rating || 0, cover: !!g.media?.cover, path: g.romPath || g.exePath || g.installDir || g.launchUri || '' });

  ipcMain.handle('x:importer:analyze', async () => {
    const list = games();
    const tried = store.data.importer?.tried || {};
    const r = await cleanup.analyze(list, { fsx, mediaDir: MEDIA, running: new Set(running.keys()), tried });
    const byId = r.byId; delete r.byId;
    const full = (e) => ({ ...e, ...info(byId.get(e.id)) });
    return {
      total: r.total, offline: r.offline,
      duplicates: r.duplicates.map((d) => ({ ...d, items: d.ids.map((i) => info(byId.get(i))) })),
      missing: r.missing.map(full), images: r.images.map(full), nometa: r.nometa.map(full),
    };
  });

  const dropGame = (id) => { store.data.games = games().filter((g) => g.id !== id); fs.rmSync(path.join(MEDIA, path.basename(id)), { recursive: true, force: true }); };

  ipcMain.handle('x:importer:merge', (_e, { groups } = {}) => {
    let merged = 0, removed = 0;
    for (const grp of groups || []) {
      const keep = ctx.findGame(grp.keep);
      const drops = (grp.drop || []).filter((id) => id !== grp.keep && !running.has(id)).map((id) => ctx.findGame(id)).filter(Boolean);
      if (!keep || !drops.length) continue;
      for (const c of cleanup.mergeInto(keep, drops)) {
        try {
          fs.mkdirSync(path.join(MEDIA, path.basename(c.to)), { recursive: true });
          fs.copyFileSync(path.join(MEDIA, path.basename(c.from), path.basename(c.file)), path.join(MEDIA, path.basename(c.to), path.basename(c.file)));
        } catch { delete keep.media[Object.keys(keep.media).find((k) => keep.media[k] === c.file)]; }
      }
      for (const d of drops) { dropGame(d.id); removed++; }
      merged++;
    }
    commit();
    return { ok: true, merged, removed };
  });

  ipcMain.handle('x:importer:remove', (_e, { ids } = {}) => {
    let removed = 0;
    for (const id of ids || []) if (!running.has(id) && ctx.findGame(id)) { dropGame(id); removed++; }
    commit();
    return { ok: true, removed };
  });

  ipcMain.handle('x:importer:tried', (_e, { ids } = {}) => {
    const t = ((store.data.importer ||= {}).tried ||= {});
    for (const id of ids || []) t[id] = Date.now();
    store.save();
    return true;
  });
};

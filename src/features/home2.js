'use strict';
// Module HOME2 (main) : « Multijoueur local » (marquage manuel + rattrapage des catégories Steam).
// IPC : x:home2:coop ({ id, value: true | false | null }) → g.localCoop (null = retour à l'auto, d'après les métadonnées)
// Données : g.localCoop (choix manuel), g.categories / g.localMulti / g.players (métadonnées, voir metadata.js coopInfo).
exports.init = (ctx) => {
  const { ipcMain, store, meta, findGame, commit } = ctx;

  ipcMain.handle('x:home2:coop', (_e, { id, value } = {}) => {
    const g = findGame(id);
    if (!g) return null;
    if (value === null || value === undefined) delete g.localCoop; else g.localCoop = !!value;
    commit();
    return g;
  });

  // Les jeux Steam importés avant la 1.9 n'ont pas de catégories : on les récupère doucement (1 fiche / 2,5 s, une fois).
  let busy = false;
  async function backfill() {
    if (busy || store.data.settings.home2Backfill === false) return;
    busy = true;
    try {
      let n = 0;
      for (const g of [...(store.data.games || [])]) {
        if (!g.appid || Array.isArray(g.categories) || g.kind === 'rom') continue;
        const d = await meta.steamDetails(g.appid).catch(() => null);
        if (d) { Object.assign(g, meta.coopInfo(d)); if (++n % 8 === 0) commit(); }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (n) commit();
    } catch (e) { meta.log(`home2 : ${e.message}`); } finally { busy = false; }
  }
  setTimeout(() => backfill(), 30000);
};

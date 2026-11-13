'use strict';
// Module LIBRARY (main) : statut / note / collections des jeux.
// IPC : x:library:patch ({ id, patch }) · x:library:op ({ op, name, to, id })
// Données : g.status, g.rating (0-5), g.collections (noms) ; settings.collections (liste ordonnée des noms).
const STATUS = ['none', 'todo', 'playing', 'done', 'complete', 'dropped'];
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

exports.init = (ctx) => {
  const { ipcMain, store, hub, findGame, commit } = ctx;
  const games = () => store.data.games || [];
  const list = () => (Array.isArray(store.data.settings.collections) ? store.data.settings.collections : (store.data.settings.collections = []));
  const has = (name) => list().some((n) => n.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));

  ipcMain.handle('x:library:patch', (_e, { id, patch } = {}) => {
    const g = findGame(id);
    if (!g || !patch) return null;
    if ('status' in patch) { if (STATUS.includes(patch.status)) g.status = patch.status; }
    if ('rating' in patch) g.rating = Math.max(0, Math.min(5, Math.round(Number(patch.rating) || 0)));
    if ('collections' in patch && Array.isArray(patch.collections)) {
      g.collections = [...new Set(patch.collections.map(clean).filter((n) => has(n)))];
    }
    commit();
    return g;
  });

  ipcMain.handle('x:library:op', (_e, { op, name, to, id } = {}) => {
    name = clean(name); to = clean(to);
    const L = list();
    if (op === 'create') {
      if (!name) return { ok: false, error: 'Nom vide' };
      if (has(name)) return { ok: false, error: 'Cette collection existe déjà' };
      L.push(name);
    } else if (op === 'rename') {
      const i = L.indexOf(name);
      if (i < 0 || !to) return { ok: false, error: 'Collection introuvable' };
      if (to !== name && has(to)) return { ok: false, error: 'Ce nom est déjà pris' };
      L[i] = to;
      for (const g of games()) if (g.collections?.includes(name)) g.collections = g.collections.map((n) => (n === name ? to : n));
    } else if (op === 'delete') {
      const i = L.indexOf(name);
      if (i < 0) return { ok: false, error: 'Collection introuvable' };
      L.splice(i, 1);
      for (const g of games()) if (g.collections?.includes(name)) g.collections = g.collections.filter((n) => n !== name);
    } else if (op === 'toggle') { // ajoute / retire le jeu `id` de la collection `name`
      const g = findGame(id);
      if (!g || !L.includes(name)) return { ok: false, error: 'Introuvable' };
      const c = new Set(g.collections || []);
      c.has(name) ? c.delete(name) : c.add(name);
      g.collections = [...c];
    } else return { ok: false, error: 'Opération inconnue' };
    commit();
    return { ok: true };
  });

  // Premier lancement : « À jouer » passe automatiquement en « En cours »
  hub.on('session:start', (id) => {
    const g = findGame(id);
    if (g && g.status === 'todo') { g.status = 'playing'; commit(); }
  });
};

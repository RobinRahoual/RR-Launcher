// GAMEACTIONS — boutons « Mettre à jour » et « Désinstaller » de la page d'un jeu (Steam, Epic, GOG, désinstalleur du jeu).
// La détection des mises à jour est dans extras.js (x:extras:updates). Canaux : x:gameact:caps | update | uninstall.
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
const core = require('./gameactions/core');

function init(ctx) {
  const { ipcMain, findGame, log } = ctx;
  const { shell } = require('electron');
  const filesOf = (g) => { try { return g.installDir ? fs.readdirSync(g.installDir) : []; } catch { return []; } };

  ipcMain.handle('x:gameact:caps', (_e, id) => {
    const g = findGame(id);
    if (!g) return { update: null, uninstall: null };
    const u = core.updatePlan(g), d = core.uninstallPlan(g, filesOf(g));
    return { update: u ? { via: u.via, label: u.label } : null, uninstall: d ? { via: d.via, label: d.label } : null };
  });
  ipcMain.handle('x:gameact:update', async (_e, id) => {
    const g = findGame(id), p = core.updatePlan(g);
    if (!p) return { ok: false, error: 'Mise à jour impossible depuis le launcher pour ce jeu' };
    try { await shell.openExternal(p.uri); log(`mise à jour : ${g.name} → ${p.via}`); return { ok: true, via: p.via, label: p.label, note: p.manual || '' }; }
    catch (e) { return { ok: false, error: `${p.label} ne répond pas (${e.message})` }; }
  });
  ipcMain.handle('x:gameact:uninstall', async (_e, id) => {
    const g = findGame(id);
    if (!g) return { ok: false, error: 'Jeu introuvable' };
    if (ctx.running?.has?.(id)) return { ok: false, error: 'Ferme le jeu avant de le désinstaller' };
    const p = core.uninstallPlan(g, filesOf(g));
    if (!p) return { ok: false, error: 'Aucun désinstalleur trouvé pour ce jeu' };
    try {
      if (p.uri) await shell.openExternal(p.uri);
      else spawn(p.exe, [], { cwd: p.dir, detached: true, stdio: 'ignore' }).unref();
      log(`désinstallation : ${g.name} → ${p.via}`);
      return { ok: true, via: p.via, label: p.label, note: p.manual || '' };
    } catch (e) { return { ok: false, error: `Impossible de lancer la désinstallation (${e.message})` }; }
  });
}
module.exports = { init };

// GAMEACTIONS — logique pure : « Mettre à jour » et « Désinstaller » un jeu de launcher depuis la page du jeu.
'use strict';
const path = require('path');

// Mise à jour : on déclenche le téléchargement dans le launcher d'origine (le launcher RR ne télécharge rien lui-même)
function updatePlan(g) {
  if (!g) return null;
  if (g.kind === 'steam' && g.appid) return { via: 'steam', uri: `steam://install/${Number(g.appid)}`, label: 'Steam' };
  if (g.kind === 'epic') return { via: 'epic', uri: 'com.epicgames.launcher://store/library', label: 'Epic Games', manual: 'Epic ne permet pas de lancer la mise à jour depuis une application tierce : sa bibliothèque s’ouvre, clique sur la mise à jour du jeu.' };
  if (g.source === 'gog' || g.galaxyId) return { via: 'gog', uri: g.galaxyId ? `goggalaxy://openGameView/${encodeURIComponent(g.galaxyId)}` : 'goggalaxy://', label: 'GOG Galaxy', manual: 'La page du jeu s’ouvre dans GOG Galaxy : lance la mise à jour depuis là.' };
  return null;
}

// Désinstallation : Steam (boîte de confirmation de Steam), Epic (bibliothèque Epic), sinon le désinstalleur du jeu s'il existe
// `files` = noms des fichiers à la racine du dossier d'installation.
function uninstallPlan(g, files = []) {
  if (!g || g.kind === 'rom') return null;
  if (g.kind === 'steam' && g.appid) return { via: 'steam', uri: `steam://uninstall/${Number(g.appid)}`, label: 'Steam' };
  if (g.kind === 'epic') return { via: 'epic', uri: 'com.epicgames.launcher://store/library', label: 'Epic Games', manual: 'Epic ne permet pas de désinstaller depuis une application tierce : sa bibliothèque s’ouvre, utilise « Désinstaller » sur le jeu.' };
  const name = files.find((f) => /^unins\d{3}\.exe$/i.test(f)) || files.find((f) => /^uninstall(er)?\.exe$/i.test(f)) || files.find((f) => /^uninst\.exe$/i.test(f));
  if (name && g.installDir) return { via: 'uninstaller', exe: path.win32.join(g.installDir, name), dir: g.installDir, label: name };
  return null;
}
module.exports = { updatePlan, uninstallPlan };

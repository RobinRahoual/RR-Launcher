// EXTRAS — état des mises à jour Steam / Epic, lu sur le disque (aucun appel réseau).
//
// Steam : steamapps/appmanifest_<appid>.acf → "AppState" { StateFlags, buildid, TargetBuildID,
//   BytesToDownload, BytesDownloaded, BytesToStage, BytesStaged … }. StateFlags = champ de bits EAppState
//   (Steamworks, isteamapps.h / steam_api) :
//     1 Uninstalled · 2 UpdateRequired · 4 FullyInstalled · 8 Encrypted · 16 Locked · 32 FilesMissing
//     64 AppRunning · 128 FilesCorrupt · 256 UpdateRunning · 512 UpdatePaused · 1024 UpdateStarted
//     2048 Uninstalling · 4096 BackupRunning · 65536 Reconfiguring · 131072 Validating · 262144 AddingFiles
//     524288 Preallocating · 1048576 Downloading · 2097152 Staging · 4194304 Committing · 8388608 UpdateStopping
//   Valeurs courantes : 4 = installé et à jour ; 6 = mise à jour requise ; 1026 = mise à jour en file / démarrée
//   (Steam ne tourne pas ou attend) ; 1030 / 1542 = démarrée + en pause (1542 = 1024+512+4+2).
//   Steam n'écrit le manifeste que par moments : pendant un téléchargement, BytesDownloaded progresse entre deux
//   lectures — on s'en sert comme indice « en cours » en plus des bits UpdateRunning / Downloading.
//
// Epic : C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item (JSON) — bIsIncompleteInstall (installation
//   ou mise à jour inachevée), bNeedsValidation (vérification demandée), AppVersionString ; un dossier
//   Manifests\Pending\ contient le manifeste de la version en cours d'installation. Fiabilité limitée : le launcher
//   Epic ne note pas localement qu'une mise à jour est disponible tant qu'il ne l'a pas commencée, et n'écrit pas
//   la progression. On n'affiche donc que « Mise à jour en cours » / « Vérification requise ».
'use strict';
const fs = require('fs');
const path = require('path');
const { parseVdf, ci } = require('./vdf');

const EAppState = {
  Uninstalled: 1, UpdateRequired: 2, FullyInstalled: 4, Encrypted: 8, Locked: 16, FilesMissing: 32,
  AppRunning: 64, FilesCorrupt: 128, UpdateRunning: 256, UpdatePaused: 512, UpdateStarted: 1024,
  Uninstalling: 2048, BackupRunning: 4096, Reconfiguring: 65536, Validating: 131072, AddingFiles: 262144,
  Preallocating: 524288, Downloading: 1048576, Staging: 2097152, Committing: 4194304, UpdateStopping: 8388608,
};
const ACTIVE = EAppState.UpdateRunning | EAppState.Downloading | EAppState.Staging | EAppState.Committing
  | EAppState.Preallocating | EAppState.AddingFiles | EAppState.Validating | EAppState.Reconfiguring;

/** 1542 → ['UpdateRequired', 'FullyInstalled', 'UpdatePaused', 'UpdateStarted'] */
function decodeStateFlags(n) {
  const v = Number(n) || 0;
  return Object.entries(EAppState).filter(([, bit]) => (v & bit) === bit).map(([k]) => k);
}

const pctOf = (done, total) => (total > 0 ? Math.max(0, Math.min(99, Math.floor((done / total) * 100))) : null);

/**
 * État d'un appmanifest (objet AppState) → null (à jour) | { state, pct, flags }
 *   state : 'downloading' | 'paused' | 'update' ; pct : 0–99 ou null
 * prev : état brut précédent ({ dl }) pour détecter une progression entre deux lectures.
 */
function steamStatus(appState, prev = null) {
  if (!appState) return null;
  const flags = Number(ci(appState, 'StateFlags')) || 0;
  const toDl = Number(ci(appState, 'BytesToDownload')) || 0, dl = Number(ci(appState, 'BytesDownloaded')) || 0;
  const toSt = Number(ci(appState, 'BytesToStage')) || 0, st = Number(ci(appState, 'BytesStaged')) || 0;
  const pct = toDl > 0 ? pctOf(dl, toDl) : toSt > 0 ? pctOf(st, toSt) : null;
  const build = String(ci(appState, 'buildid') || ''), target = String(ci(appState, 'TargetBuildID') || '');
  const base = { flags, pct, dl };
  if (flags & EAppState.UpdatePaused) return { ...base, state: 'paused' };
  if (flags & ACTIVE) return { ...base, state: 'downloading' };
  if (prev && dl > (prev.dl || 0) && toDl > 0 && dl < toDl) return { ...base, state: 'downloading' };
  if (flags & (EAppState.UpdateRequired | EAppState.UpdateStarted)) return { ...base, state: 'update', pct: dl > 0 ? pct : null };
  if (target && target !== '0' && build && target !== build) return { ...base, state: 'update', pct: null };
  return null;
}

/** Libellé court affiché sur la boîte et dans le bloc d'infos. */
function statusLabel(s) {
  if (!s) return '';
  const p = s.pct != null ? ` ${s.pct}\u202f%` : '';
  if (s.state === 'downloading') return s.pct != null ? `Téléchargement${p}` : 'Mise à jour en cours';
  if (s.state === 'paused') return 'Mise à jour en pause';
  if (s.state === 'validate') return 'Vérification requise';
  return 'Mise à jour disponible';
}

// installDir d'un jeu Steam importé = <bibliothèque>/steamapps/common/<dossier>
function steamappsOf(installDir) {
  if (!installDir) return '';
  const common = path.dirname(installDir);
  return path.basename(common).toLowerCase() === 'common' ? path.dirname(common) : '';
}

/** Chemin du manifeste d'un jeu Steam (bibliothèque du jeu d'abord, puis les autres bibliothèques connues). */
function findAppManifest(game, libraries = []) {
  const name = `appmanifest_${game.appid}.acf`;
  const dirs = [steamappsOf(game.installDir), ...libraries.map((l) => path.join(l, 'steamapps'))].filter(Boolean);
  for (const d of dirs) { const f = path.join(d, name); if (fs.existsSync(f)) return f; }
  return '';
}

function readAppState(file) {
  try { return ci(parseVdf(fs.readFileSync(file, 'utf8')), 'AppState') || null; } catch { return null; }
}

// --- Epic
/** AppName d'un jeu Epic importé (launchUri = com.epicgames.launcher://apps/<ns>%3A<item>%3A<AppName>?action=launch) */
function epicAppName(game) {
  const m = String(game.launchUri || '').match(/apps\/([^?]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]).split(':').pop(); } catch { return ''; }
}

function readEpicItems(dir) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); } catch { return out; }
  for (const f of files) { try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* illisible */ } }
  return out;
}

/** État Epic d'un jeu : item = manifeste installé, pending = manifeste de Pending\ (ou null). */
function epicStatus(item, pending = null) {
  if (!item) return null;
  if (item.bIsIncompleteInstall) return { state: 'downloading', pct: null };
  if (pending && pending.AppVersionString && pending.AppVersionString !== item.AppVersionString) return { state: 'downloading', pct: null };
  if (item.bNeedsValidation) return { state: 'validate', pct: null };
  return null;
}

function matchEpic(game, items) {
  const name = epicAppName(game).toLowerCase();
  const dir = String(game.installDir || '').toLowerCase().replace(/[\\/]+$/, '');
  return items.find((j) => (name && String(j.AppName || '').toLowerCase() === name)
    || (dir && String(j.InstallLocation || '').toLowerCase().replace(/[\\/]+$/, '') === dir)) || null;
}

module.exports = {
  EAppState, decodeStateFlags, steamStatus, statusLabel, steamappsOf, findAppManifest, readAppState,
  epicAppName, readEpicItems, epicStatus, matchEpic,
};

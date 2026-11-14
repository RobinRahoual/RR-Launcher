'use strict';
// STORES — import des jeux Epic Games et GOG avec lancement DIRECT.
//  Epic : manifestes « .item » (dossier lu dans le registre, sinon ProgramData) → exécutable + arguments du jeu.
//         Par défaut le jeu est lancé via le client (lien com.epicgames.launcher://, nécessaire aux jeux avec DRM Epic) ;
//         en « direct » l'exécutable est lancé sans ouvrir le client (réglage epicDirect ou option du jeu).
//  GOG  : registre GOG.com\Games + fichiers goggame-<id>.info (tâche de lecture principale) → exécutable direct
//         (sans Galaxy, par défaut) ou via Galaxy (/gameId= /command=runGame : succès, cloud, overlay).
// Rien n'est lu en ligne, aucun compte n'est connecté. Les analyses sont pures (testables sous Linux).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const isWin = process.platform === 'win32';
const pwin = (p) => (/\\/.test(p || '') || /^[A-Za-z]:/.test(p || '') ? path.win32 : path);
const joinP = (dir, f) => pwin(dir).join(dir, f);
const winPath = (p) => (/^[A-Za-z]:[\\/]/.test(p || '') ? p.replace(/\//g, '\\').replace(/\\+$/, '') : p || '');

// ---------------------------------------------------------------- Epic
function epicUri(j) {
  const e = encodeURIComponent;
  return `com.epicgames.launcher://apps/${e(j.CatalogNamespace)}%3A${e(j.CatalogItemId)}%3A${e(j.AppName)}?action=launch&silent=true`;
}
// Manifeste .item → entrée de bibliothèque (null si ce n'est pas un jeu installé)
function parseEpicManifest(j) {
  if (!j || j.bIsIncompleteInstall || !j.DisplayName || /unreal engine/i.test(j.DisplayName)) return null;
  if (Array.isArray(j.AppCategories) && !j.AppCategories.some((c) => /games/i.test(c))) return null;
  const dir = winPath(j.InstallLocation);
  return {
    kind: 'epic', source: 'epic', platform: 'pc', name: j.DisplayName, installDir: dir,
    exePath: j.LaunchExecutable ? joinP(dir, j.LaunchExecutable) : '',
    epicArgs: String(j.LaunchCommand || '').trim(),
    epicApp: j.AppName || '',
    launchUri: epicUri(j),
  };
}
const wantsEpicDirect = (g, s = {}) => g?.kind === 'epic' && !!g.exePath && (g.launch?.via === 'direct' || (g.launch?.via !== 'client' && s.epicDirect === true));
// → { via:'direct', file, args, cwd, followDir }
function epicDirectCommand(g, splitArgs, extra = '') {
  return { via: 'direct', file: g.exePath, args: [...splitArgs(g.epicArgs || ''), ...splitArgs(extra)], cwd: pwin(g.exePath).dirname(g.exePath), followDir: g.installDir || pwin(g.exePath).dirname(g.exePath) };
}

// ---------------------------------------------------------------- GOG
function regValues(block) {
  const v = {};
  for (const m of String(block).matchAll(/^\s+(\w+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/gm)) v[m[1].toLowerCase()] = m[2].trim();
  return v;
}
// Sortie de « reg query HKLM\…\GOG.com\Games /s » → [{ id, name, exe, args, dir }]
function parseGogRegistry(text) {
  const out = [];
  for (const block of String(text).split(/\r?\n(?=HKEY_)/)) {
    const v = regValues(block);
    const name = v.gamename, exeRaw = v.exe || v.launchcommand;
    if (!name || !exeRaw) continue;
    const exe = winPath(exeRaw.replace(/^"/, '').split(/"\s|"$/)[0]);
    if (!/\.exe$/i.test(exe)) continue;
    out.push({ id: v.gameid || v.gameId || '', name, exe, args: v.launchparam || '', dir: winPath(v.path || '') || pwin(exe).dirname(exe) });
  }
  return out;
}
// goggame-<id>.info : tâche de lecture principale (exécutable + arguments), plus fiable que le registre
function parseGogInfo(info, dir) {
  if (!info || !info.gameId) return null;
  const tasks = (info.playTasks || []).filter((t) => t.path && (!t.category || /game/i.test(t.category)));
  const t = tasks.find((x) => x.isPrimary) || tasks[0];
  if (!t) return null;
  const wd = t.workingDir ? joinP(dir, t.workingDir) : dir;
  return { id: String(info.gameId), name: info.name || '', exe: joinP(dir, t.path), args: String(t.arguments || '').trim(), dir, cwd: wd };
}
function gogItem(r) {
  return { kind: 'exe', source: 'gog', platform: 'pc', name: r.name, exePath: r.exe, installDir: r.dir, galaxyId: r.id || null, args: r.args || '' };
}
const wantsGalaxy = (g, s = {}) => g?.source === 'gog' && !!g.galaxyId && (g.launch?.via === 'galaxy' || (g.launch?.via !== 'direct' && s.gogGalaxy === true));
// → { via:'galaxy', file, args, cwd, followDir } — null si Galaxy est introuvable
function galaxyCommand(g, galaxyExe) {
  if (!galaxyExe) return null;
  return { via: 'galaxy', file: galaxyExe, args: [`/gameId=${g.galaxyId}`, '/command=runGame', `/path=${g.installDir}`], cwd: pwin(galaxyExe).dirname(galaxyExe), followDir: g.installDir };
}

// Un jeu déjà dans la bibliothèque reçoit les champs de lancement direct manquants (rescan d'une ancienne importation)
function enrich(g, it) {
  let changed = false;
  const fill = (k) => { if (it[k] && !g[k]) { g[k] = it[k]; changed = true; } };
  if (it.source === 'gog') { fill('galaxyId'); if (it.args && g.args === '') { g.args = it.args; changed = true; } }
  if (it.source === 'epic') { fill('epicApp'); fill('epicArgs'); fill('exePath'); }
  return changed;
}

// ---------------------------------------------------------------- Analyse du système (Windows)
function reg(key, value) {
  return new Promise((resolve) => {
    if (!isWin) return resolve('');
    execFile('reg', value ? ['query', key, '/v', value] : ['query', key, '/s'], { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}
const readTxt = (f, fsx = fs) => { try { return fsx.readFileSync(f, 'utf8'); } catch { return ''; } };

async function epicManifestDirs(deps = {}) {
  const r = deps.reg || reg, env = deps.env || process.env;
  const dirs = [];
  const m = (await r('HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher', 'AppDataPath')).match(/AppDataPath\s+REG_SZ\s+(.+)/);
  if (m) dirs.push(joinP(m[1].trim(), 'Manifests'));
  dirs.push(joinP(env.ProgramData || 'C:\\ProgramData', 'Epic\\EpicGamesLauncher\\Data\\Manifests'));
  return [...new Set(dirs)];
}
async function scanEpic(deps = {}) {
  const fsx = deps.fs || fs;
  const out = [], seen = new Set();
  let found = false;
  for (const dir of await epicManifestDirs(deps)) {
    let files = [];
    try { files = fsx.readdirSync(dir).filter((f) => f.endsWith('.item')); found = true; } catch { continue; }
    for (const f of files) {
      let it = null;
      try { it = parseEpicManifest(JSON.parse(readTxt(joinP(dir, f), fsx))); } catch { /* manifeste illisible */ }
      if (it && !seen.has(it.epicApp || it.name)) { seen.add(it.epicApp || it.name); out.push(it); }
    }
  }
  if (!found) return { ok: false, error: 'Epic Games Launcher introuvable.', items: [] };
  return { ok: true, items: out };
}
async function scanGog(deps = {}) {
  const r = deps.reg || reg, fsx = deps.fs || fs;
  const items = [];
  const seen = new Set();
  for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']) {
    for (const g of parseGogRegistry(await r(key))) {
      // Le fichier goggame-<id>.info du dossier d'installation donne l'exécutable et les arguments exacts
      const info = g.id ? (() => { try { return parseGogInfo(JSON.parse(readTxt(joinP(g.dir, `goggame-${g.id}.info`), fsx)), g.dir); } catch { return null; } })() : null;
      const merged = info ? { ...g, exe: info.exe, args: info.args, name: g.name || info.name } : g;
      if (seen.has(merged.exe.toLowerCase())) continue;
      seen.add(merged.exe.toLowerCase());
      items.push(gogItem(merged));
    }
  }
  if (!items.length) return { ok: false, error: 'Aucun jeu GOG trouvé.', items: [] };
  return { ok: true, items };
}
// GalaxyClient.exe (registre, sinon emplacements usuels) ; null si absent
async function findGalaxy(deps = {}) {
  const r = deps.reg || reg, exists = deps.exists || ((f) => { try { fs.accessSync(f); return true; } catch { return false; } });
  const m = (await r('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\GalaxyClient\\paths', 'client')).match(/client\s+REG_SZ\s+(.+)/);
  const cands = [m && joinP(m[1].trim(), 'GalaxyClient.exe'), 'C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe', 'C:\\Program Files\\GOG Galaxy\\GalaxyClient.exe'].filter(Boolean);
  return cands.find((c) => exists(c)) || null;
}

module.exports = {
  epicUri, parseEpicManifest, wantsEpicDirect, epicDirectCommand,
  enrich, regValues, parseGogRegistry, parseGogInfo, gogItem, wantsGalaxy, galaxyCommand,
  scanEpic, scanGog, findGalaxy, epicManifestDirs,
};

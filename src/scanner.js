// Détection des jeux : Steam, Epic Games, GOG, dossiers (jeux PC, ROMs, dumps PS3) et émulateurs.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { prettify } = require('./names');
const { BY_ID, platformForFile, folderHint, romExtensions, detectEmulator } = require('./platforms');
const { checkRom } = require('./romcheck');

const isWin = process.platform === 'win32';

function regQuery(key, value) {
  return new Promise((resolve) => {
    if (!isWin) return resolve('');
    const args = ['query', key];
    if (value) args.push('/v', value); else args.push('/s');
    execFile('reg', args, { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}

async function readText(f) { try { return await fsp.readFile(f, 'utf8'); } catch { return ''; } }
async function exists(f) { try { await fsp.access(f); return true; } catch { return false; } }

// ---------------------------------------------------------------- Noms
function cleanRomName(file) {
  return path.basename(file).replace(/\.[^.]+$/, '')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// PARAM.SFO (PS3/PSP/Vita) → TITLE
async function readSfoTitle(file) {
  try {
    const b = await fsp.readFile(file);
    if (b.readUInt32LE(0) !== 0x46535000) return null;
    const keyTable = b.readUInt32LE(8), dataTable = b.readUInt32LE(12), count = b.readUInt32LE(16);
    for (let i = 0; i < count; i++) {
      const e = 20 + i * 16;
      const keyOff = b.readUInt16LE(e), len = b.readUInt32LE(e + 4), dataOff = b.readUInt32LE(e + 12);
      let k = keyTable + keyOff, key = '';
      while (b[k]) key += String.fromCharCode(b[k++]);
      if (key === 'TITLE') return b.slice(dataTable + dataOff, dataTable + dataOff + len).toString('utf8').replace(/\0+$/, '').replace(/\s+/g, ' ').trim();
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- Steam
const STEAM_SKIP = new Set([228980, 1070560, 1391110, 1628350, 250820, 1493710, 2180100, 1826330]);
async function scanSteam() {
  const out = [];
  let steamPath = '';
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const m = reg.match(/SteamPath\s+REG_SZ\s+(.+)/);
  if (m) steamPath = m[1].trim().replace(/\//g, '\\');
  const candidates = [steamPath, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  let vdf = '';
  for (const c of candidates) {
    vdf = await readText(path.join(c, 'steamapps', 'libraryfolders.vdf'));
    if (vdf) { steamPath = c; break; }
  }
  if (!vdf) return { ok: false, error: 'Steam introuvable sur ce PC.', items: [] };
  const libs = new Set([steamPath]);
  for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(mm[1].replace(/\\\\/g, '\\'));
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = await fsp.readdir(apps); } catch { continue; }
    for (const f of files.filter((x) => /^appmanifest_\d+\.acf$/.test(x))) {
      const t = await readText(path.join(apps, f));
      const get = (k) => (t.match(new RegExp(`"${k}"\\s+"([^"]*)"`)) || [])[1];
      const appid = Number(get('appid'));
      const name = get('name');
      if (!appid || !name || STEAM_SKIP.has(appid)) continue;
      if (/redistributable|steamworks|proton|steam linux runtime|soundtrack|dedicated server|\bsdk\b|benchmark/i.test(name)) continue;
      out.push({ kind: 'steam', source: 'steam', platform: 'pc', appid, name, installDir: path.join(apps, 'common', get('installdir') || '') });
    }
  }
  return { ok: true, items: out };
}

// ---------------------------------------------------------------- Epic Games
async function scanEpic() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.item')); } catch { return { ok: false, error: 'Epic Games Launcher introuvable.', items: [] }; }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await readText(path.join(dir, f)));
      if (j.bIsIncompleteInstall || !j.DisplayName || /unreal engine/i.test(j.DisplayName)) continue;
      if (Array.isArray(j.AppCategories) && !j.AppCategories.some((c) => /games/i.test(c))) continue;
      out.push({
        kind: 'epic', source: 'epic', platform: 'pc', name: j.DisplayName,
        installDir: j.InstallLocation,
        exePath: j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : '',
        launchUri: `com.epicgames.launcher://apps/${encodeURIComponent(j.CatalogNamespace)}%3A${encodeURIComponent(j.CatalogItemId)}%3A${encodeURIComponent(j.AppName)}?action=launch&silent=true`,
      });
    } catch { /* manifeste illisible */ }
  }
  return { ok: true, items: out };
}

// ---------------------------------------------------------------- GOG Galaxy
async function scanGog() {
  const out = [];
  for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']) {
    const txt = await regQuery(key);
    if (!txt) continue;
    for (const block of txt.split(/\r?\n(?=HKEY_)/)) {
      const v = (k) => (block.match(new RegExp(`^\\s+${k}\\s+REG_SZ\\s+(.+)$`, 'mi')) || [])[1]?.trim();
      const name = v('gameName'), exe = v('exe') || v('launchCommand');
      if (!name || !exe) continue;
      const exePath = exe.replace(/^"|"$/g, '').split('" ')[0];
      if (!/\.exe$/i.test(exePath) || out.some((o) => o.exePath === exePath)) continue;
      out.push({ kind: 'exe', source: 'gog', platform: 'pc', name, exePath, installDir: v('path') || path.dirname(exePath) });
    }
  }
  if (!out.length) return { ok: false, error: 'Aucun jeu GOG trouvé.', items: [] };
  return { ok: true, items: out };
}

// ---------------------------------------------------------------- Dossiers
const SKIP_DIRS = /^(windows|\$recycle\.bin|system volume information|programdata|appdata|node_modules|\.git|\.svn|msocache|recovery|perflogs|intel|amd|nvidia( corporation)?|drivers|windowsapps|microsoft.*|common files|windows (defender|mail|media player|nt|photo viewer|portable devices|security|sidebar|kits)|internet explorer|reference assemblies|dotnet|packages|cache|temp|tmp|logs?|crashdumps|redist|_commonredist|directx|vcredist|__installer|installers?|support|prerequisites|steamapps|epic games|epicgameslauncher|steam|gog galaxy|shadercache|\.cache|site-packages|python\d*|jdk.*|java|bios|saves?|savestates?|states|shaders?|cheats|screenshots|themes|overlays|thumbnails|downloaded_media|manuals?|docs?|documentation|nand|sdmc|cores|autoconfig|assets)$/i;
const BAD_EXE = /unins|uninst|setup|install|redist|vcredist|vc_redist|dxsetup|directx|dotnet|crash|report|helper|updater|update|patch|config|settings|launcherpatcher|ue4prereq|ueprereq|prereq|easyanticheat|eac_|battleye|be_service|cefprocess|cefsharp|webhelper|quicksfv|7z|winrar|unity ?crash|crs-|benchmark|server|editor|modmanager|notification|overlay|feedback|activation|register|dxwebsetup|oalinst|physx|touchup|cleanup|repair|vulkan|nvidia|amd|python|pythonw|java|node|cmd|powershell|svchost|start_protected_game|anticheat/i;
// Indices qu'un dossier contient un JEU (moteurs, SDK de plateformes de jeu, middleware audio/vidéo de jeu)
const STRONG = /^(unityplayer\.dll|gameassembly\.dll|steam_api(64)?\.dll|steamclient(64)?\.dll|eossdk-win(32|64)-shipping\.dll|galaxy(64)?\.dll|goggame-\d+\.(info|ico|dll)|.*-win(32|64)-shipping\.exe|data\.win|.*\.rpa|rgss\d*\w*\.dll|fna\.dll|monogame\.framework\.dll|microsoft\.xna\.framework.*\.dll|.*\.pck|bink2w(32|64)\.dll|binkw(32|64)\.dll|aksoundengine.*\.dll|fmod(ex|_event|studio)?(64|_vc|l)?\.dll|amd_ags_x64\.dll|gfsdk_.*\.dll|nvngx_dlss\.dll|sl\.interposer\.dll|xinput1_3\.dll|d3dx9_\d+\.dll|d3dx11_\d+\.dll|physx3?(_|common_|cooking_)?x?(64|86)?\.dll|lua5\d\.dll|love\.dll|game\.ini|rpg_rt\.(exe|ini)|.*\.forge|.*\.big)$/i;
const STRONG_DIRS = /^(.*_data|engine|binaries|content|renpy|www|data\.cdp|shadercache|paks)$/i;
// Indices d'un LOGICIEL (Electron / CEF / Qt / Python / Java…) : exclus sauf indice de jeu fort
const SOFTWARE = /^(libcef\.dll|chrome_elf\.dll|icudtl\.dat|v8_context_snapshot\.bin|chrome_100_percent\.pak|qt[56]core\.dll|qt[56]gui\.dll|python3\d*\.dll|python\d\d\.dll|jvm\.dll|msvbvm60\.dll|app\.asar|electron\.exe|ffmpeg\.dll|libvlc\.dll|tbb\.dll|blender\.exe|obs64\.exe)$/i;
// Éditeurs / logiciels courants (nom du dossier) : jamais des jeux
const PUBLISHERS = /^(microsoft.*|adobe.*|autodesk.*|blender( foundation)?|google|mozilla.*|jetbrains|nvidia.*|amd|ati technologies|intel|logitech.*|razer.*|corsair|steelseries|discord|obs[- ]studio|videolan|vlc|7-zip|winrar|notepad\+\+|git|nodejs|python.*|docker|oracle|vmware|virtualbox|citrix|zoom|slack|spotify|dropbox|onedrive|teamviewer|anydesk|audacity|gimp.*|inkscape|krita|davinci resolve|blackmagic design|figma|affinity.*|serif|libreoffice|openoffice|office.*|realtek|asus|msi|gigabyte|cpuid|hwinfo|ccleaner|malwarebytes|avast.*|avg|kaspersky|norton.*|mcafee|bitdefender|windowsapps|common files|unity hub|unity|epic games launcher|ubisoft game launcher|ea app|electronic arts|origin|battle\.net|riot client|rockstar games launcher|playnite|launchbox|retroarch|rr launcher|wallpaper engine|msi afterburner|rivatuner.*)$/i;
// Exécutables de launchers / clients (pas des jeux)
const LAUNCHER_EXE = /^(steam|steamwebhelper|epicgameslauncher|galaxyclient|eadesktop|origin|ubisoftconnect|upc|battle\.net|battle\.net launcher|riotclientservices|launcher|playnite\.desktopapp|launchbox|bigbox)\.exe$/i;
const CONTAINERS = /^(program files( \(x86\))?|games?|jeux( vidéo| video)?|gog games|xboxgames|emulation|emulateurs?|emulators?|roms?|pc games?|my games|jeux pc|steamlibrary|common|ubisoft game launcher|origin games|ea games|amazon games|library)$/i;
// Dossiers où l'utilisateur range ses jeux : un exe sans indice y est proposé (non coché)
const GAME_CONTAINERS = /^(games?|jeux( vidéo| video)?|gog games|xboxgames|pc games?|jeux pc|steamlibrary|common|origin games|ea games|amazon games)$/i;
const ROM_EXTS = new Set(romExtensions());

/**
 * @param {string[]} roots dossiers à parcourir
 * @param {{wholePc?: boolean, onProgress?: Function, isCancelled?: Function}} opts
 */
async function scanFolders(roots, opts = {}) {
  const { wholePc = false, onProgress = () => {}, isCancelled = () => false } = opts;
  const maxDepth = wholePc ? 7 : 9;
  const roms = [];
  const ps3 = [];
  const exeGroups = new Map(); // gameRoot -> { exes: [], marker: bool, software: bool }
  const emulators = [];
  let dirs = 0, lastEmit = 0;

  const gameRootFor = (root, full) => {
    const rel = path.relative(root, full).split(path.sep).filter(Boolean);
    if (!rel.length) return null;
    // On saute les dossiers « conteneurs » (Jeux, Games, Program Files…) : Jeux\<Jeu>\…
    let i = 0;
    while (i < rel.length - 1 && CONTAINERS.test(rel[i])) i++;
    return path.join(root, ...rel.slice(0, i + 1));
  };

  async function walk(root, dir, depth) {
    if (isCancelled()) return;
    dirs++;
    if (dirs - lastEmit >= 150) { lastEmit = dirs; onProgress({ dirs, found: roms.length + ps3.length + exeGroups.size, current: dir }); }
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    // Dump PS3 (dossier contenant PS3_GAME\USRDIR\EBOOT.BIN)
    const ps3dir = entries.find((e) => e.isDirectory() && e.name.toUpperCase() === 'PS3_GAME');
    if (ps3dir) {
      const eboot = path.join(dir, ps3dir.name, 'USRDIR', 'EBOOT.BIN');
      if (await exists(eboot)) {
        const title = (await readSfoTitle(path.join(dir, ps3dir.name, 'PARAM.SFO'))) || cleanRomName(dir);
        ps3.push({ kind: 'rom', platform: 'ps3', name: title, romPath: eboot });
        return;
      }
    }

    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lowerFiles = files.map((f) => f.toLowerCase());
    const hasM3u = lowerFiles.some((f) => f.endsWith('.m3u'));
    const hasMarker = lowerFiles.some((f) => STRONG.test(f)) || entries.some((e) => e.isDirectory() && STRONG_DIRS.test(e.name));
    const hasSoftware = lowerFiles.some((f) => SOFTWARE.test(f));

    for (const f of files) {
      const lf = f.toLowerCase();
      const ext = lf.includes('.') ? lf.split('.').pop() : '';
      const full = path.join(dir, f);
      if (ext === 'exe') {
        const emu = detectEmulator(full);
        if (emu.length) { emulators.push({ path: full, matches: emu }); continue; }
        if (BAD_EXE.test(lf) || LAUNCHER_EXE.test(lf)) continue;
        const root = gameRootFor(currentRoot, full);
        if (!root) continue;
        let size = 0;
        try { size = (await fsp.stat(full)).size; } catch { continue; }
        if (size < 250 * 1024) continue;
        if (PUBLISHERS.test(path.basename(root))) continue;
        const g = exeGroups.get(root) || { exes: [], marker: false, software: false };
        g.exes.push({ path: full, size, depth: path.relative(root, full).split(path.sep).length });
        exeGroups.set(root, g);
      } else if (ROM_EXTS.has(ext)) {
        if (hasM3u && ['cue', 'chd', 'iso', 'img'].includes(ext)) continue;
        if (ext === 'cue' && lowerFiles.some((x) => x === lf.replace(/\.cue$/, '.chd'))) continue;
        if (/\(disc ?[2-9]\)|\(disk ?[2-9]\)|\(cd ?[2-9]\)/i.test(f)) continue; // les disques 2+ sont lancés depuis le 1
        let size = 0;
        try { size = (await fsp.stat(full)).size; } catch { continue; }
        if (size < (['cue', 'm3u', 'gdi', 'ccd'].includes(ext) ? 20 : 16 * 1024)) continue;
        if (ext === 'bin' && lowerFiles.some((x) => x.endsWith('.cue'))) continue; // la piste est lancée via son .cue
        // Vérification par le contenu (signature / en-tête) : .md Markdown, .wad Doom, .iso Windows… exclus
        let platform = await checkRom(full, ext, folderHint(full));
        if (platform === 'switch' && folderHint(full) === 'switch2') platform = 'switch2'; // même format que la Switch
        if (!platform || platform === 'unknown') continue;
        roms.push({ kind: 'rom', platform, name: cleanRomName(f), romPath: full });
      }
    }
    if (hasMarker || hasSoftware) {
      const root = gameRootFor(currentRoot, path.join(dir, 'x'));
      if (root) {
        const g = exeGroups.get(root) || { exes: [], marker: false, software: false };
        if (hasMarker) g.marker = true;
        if (hasSoftware) g.software = true;
        exeGroups.set(root, g);
      }
    }

    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.test(e.name) || e.name.startsWith('.')) continue;
      if (wholePc && depth === 0 && /^users$/i.test(e.name)) continue;
      await walk(root, path.join(dir, e.name), depth + 1);
      if (isCancelled()) return;
    }
  }

  let currentRoot = '';
  for (const r of roots) {
    currentRoot = r;
    await walk(r, r, 0);
  }

  // Choix du meilleur exécutable par dossier de jeu
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exeItems = [];
  for (const [root, g] of exeGroups) {
    if (!g.exes.length) continue;
    // Un jeu = indice de moteur / SDK de jeu, sans signe de logiciel (sauf indice fort).
    // Sans indice : proposé non coché seulement s'il est rangé dans un dossier de jeux (Games, Jeux…), et pas en scan du PC entier.
    const inGames = root.split(/[\\/]/).slice(0, -1).some((d) => GAME_CONTAINERS.test(d));
    let uncertain = false;
    if (!g.marker) {
      if (g.software || wholePc || !inGames) continue;
      uncertain = true;
    }
    const folder = norm(path.basename(root));
    let best = null, bestScore = -Infinity;
    for (const e of g.exes) {
      const n = norm(path.basename(e.path, '.exe'));
      let s = Math.min(e.size / (1024 * 1024), 120) / 3;
      if (folder && (n.includes(folder) || folder.includes(n)) && n.length > 2) s += 40;
      if (/launcher/i.test(e.path)) s -= 15;
      if (/win64|x64|shipping/i.test(e.path)) s += 6;
      s -= e.depth * 2;
      if (s > bestScore) { bestScore = s; best = e; }
    }
    const name = prettify(path.basename(root)); // « RedDeadRedemption2 » → « Red Dead Redemption 2 »
    exeItems.push({ kind: 'exe', source: 'scan', platform: 'pc', name, exePath: best.path, installDir: root, ...(uncertain ? { uncertain: true } : {}) });
  }

  // Émulateurs uniques
  const seen = new Set();
  const emus = emulators.filter((e) => (seen.has(e.path.toLowerCase()) ? false : seen.add(e.path.toLowerCase())));

  return { items: [...exeItems, ...ps3, ...roms], emulators: emus, dirs, cancelled: isCancelled() };
}

async function listDrives() {
  if (!isWin) return ['/'];
  const out = [];
  for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (await exists(`${l}:\\`)) out.push(`${l}:\\`);
  return out;
}

module.exports = { scanSteam, scanEpic, scanGog, scanFolders, listDrives, cleanRomName, readSfoTitle };

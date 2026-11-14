// Plateformes supportées : apparence des boîtes, extensions de ROM, émulateurs connus.
// Les boîtes évoquent le format physique de chaque support (couleur, proportions),
// sans reproduire de logo officiel : seul le nom de la plateforme est écrit.
// logos : noms exacts de fichiers Wikimedia Commons (wordmark officiel), par ordre de préférence.
//         Ils ne sont jamais copiés dans le dépôt : l'app les télécharge à l'exécution (voir metadata.platformLogo).

// case.style : dvd | bluray | small | jewel | card
// case.ratio : largeur / hauteur de la face avant
const P = (o) => o;

const PLATFORMS = [
  P({ id: 'pc', tgdb: 1, name: 'PC', short: 'PC', maker: 'Windows', year: '', color: '#3C91E6', wiki: null, libretro: null, logos: [],
    case: { style: 'dvd', ratio: 0.64 }, exts: [], hints: [], emulators: [] }),

  // Switch 2 : mêmes formats de fichiers que la Switch (.nsp / .xci) → rangée sous Switch 2 d'après le dossier
  // (« Switch 2 », « Switch2 », « NS2 ») ou en choisissant la console à l'ajout. sharedExts : jamais choisie sur la seule extension.
  P({ id: 'switch2', tgdb: null, name: 'Nintendo Switch 2', short: 'SWITCH 2', maker: 'Nintendo', year: '2025', color: '#e60012', wiki: 'Nintendo Switch 2', libretro: null,
    logos: ['Nintendo_Switch_2_logo.svg', 'Nintendo_Switch_2_Logo.svg', 'Nintendo_Switch_2_wordmark.svg'],
    case: { style: 'small', ratio: 0.62, body: '#c40d1b', band: '#e60012', fg: '#ffffff', label: 'NINTENDO SWITCH 2' },
    // .nup : archive « un seul fichier » de Fritchii / Lichii (jeu + mise à jour + DLC), propre à la Switch 2.
    exts: ['nsp', 'xci', 'nsz', 'xcz', 'nup'], ownExts: ['nup'], sharedExts: true, hints: [/switch ?2|\bns2\b/i],
    emulators: [
      // Fritchii (lichii.exe), Lichii, Eglantine : forks d'Eden/yuzu → mêmes options (-f plein écran, -g jeu)
      { name: 'Fritchii / Lichii', match: /lichii|fritchii|eglantine/i, args: '-f -g "{rom}"' },
      { name: 'Ryujinx', match: /ryujinx/i, args: '"{rom}"' },
      { name: 'Eden / Citron / Sudachi (yuzu)', match: /eden|citron|sudachi|yuzu|suyu/i, args: '-f -g "{rom}"' },
    ] }),

  P({ id: 'switch', tgdb: 4971, name: 'Nintendo Switch', short: 'SWITCH', maker: 'Nintendo', year: '2017', color: '#e60012', wiki: 'Nintendo Switch', libretro: null,
    logos: ['Nintendo_Switch_logo.svg'],
    case: { style: 'small', ratio: 0.62, body: '#d70f1e', band: '#e60012', fg: '#ffffff', label: 'NINTENDO SWITCH' },
    exts: ['nsp', 'xci', 'nsz', 'xcz'], hints: [/switch(?! ?2)/i],
    emulators: [
      { name: 'Ryujinx', match: /ryujinx/i, args: '"{rom}"' },
      { name: 'Eden / Citron / Sudachi (yuzu)', match: /eden|citron|sudachi|yuzu|suyu/i, args: '-f -g "{rom}"' },
      { name: 'Fritchii / Lichii', match: /lichii|fritchii|eglantine/i, args: '-f -g "{rom}"' },
    ] }),

  P({ id: 'wiiu', tgdb: 38, name: 'Wii U', short: 'Wii U', maker: 'Nintendo', year: '2012', color: '#1d9bd8', wiki: 'Wii U', libretro: null,
    logos: ['WiiU.svg', 'Nintendo_Wii_U.svg'],
    case: { style: 'dvd', ratio: 0.71, body: '#1d8fd0', band: '#1d9bd8', fg: '#ffffff', label: 'Wii U' },
    exts: ['wud', 'wux', 'wua', 'rpx'], hints: [/wii ?u/i],
    emulators: [{ name: 'Cemu', match: /cemu/i, args: '-f -g "{rom}"' }] }),

  P({ id: 'wii', tgdb: 9, name: 'Wii', short: 'Wii', maker: 'Nintendo', year: '2006', color: '#9fb4c2', wiki: 'Wii', libretro: 'Nintendo_-_Wii',
    logos: ['Wii.svg', 'Wii_logo.png'],
    case: { style: 'dvd', ratio: 0.71, body: '#f1f2f3', band: '#f1f2f3', fg: '#8b9299', label: 'Wii' },
    exts: ['wbfs', 'wad'], hints: [/\bwii\b(?! ?u)/i],
    emulators: [{ name: 'Dolphin', match: /dolphin/i, args: '-b -e "{rom}"' }] }),

  P({ id: 'gc', tgdb: 2, name: 'GameCube', short: 'GAMECUBE', maker: 'Nintendo', year: '2001', color: '#6a5acd', wiki: 'GameCube', libretro: 'Nintendo_-_GameCube',
    logos: ['Nintendo_GameCube_Official_Logo.svg', 'Nintendo_Gamecube-Logo.svg', 'GC_Logo.svg'],
    case: { style: 'small', ratio: 0.71, body: '#2b2b35', band: '#2b2b35', fg: '#ffffff', label: 'GAMECUBE' },
    exts: ['gcm', 'gcz', 'ciso'], hints: [/gamecube|\bngc\b|\bgcn?\b/i],
    emulators: [{ name: 'Dolphin', match: /dolphin/i, args: '-b -e "{rom}"' }] }),

  P({ id: 'n64', tgdb: 3, name: 'Nintendo 64', short: 'N64', maker: 'Nintendo', year: '1996', color: '#2a9d4a', wiki: 'Nintendo 64', image: 'Nintendo-64-wController-L.jpg', libretro: 'Nintendo_-_Nintendo_64',
    logos: ['Nintendo_64_wordmark.svg', 'Nintendo_64_logo.png'],
    case: { style: 'card', ratio: 1.38, body: '#1b1b1d', fg: '#ffffff', label: 'NINTENDO 64' },
    exts: ['n64', 'z64', 'v64'], hints: [/n64|nintendo ?64/i],
    emulators: [
      { name: 'Project64', match: /project64/i, args: '"{rom}"' },
      { name: 'simple64', match: /simple64/i, args: '--nogui "{rom}"' },
      { name: 'ares', match: /ares/i, args: '--fullscreen "{rom}"' },
      { name: 'RetroArch (Mupen64Plus-Next)', match: /retroarch/i, args: '-f -L "cores/mupen64plus_next_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'snes', tgdb: 6, name: 'Super Nintendo', short: 'SUPER NINTENDO', maker: 'Nintendo', year: '1990', color: '#7b5aa6', wiki: 'Super Nintendo Entertainment System', libretro: 'Nintendo_-_Super_Nintendo_Entertainment_System',
    logos: ['Super_Nintendo_Entertainment_System_logo.svg', 'SNES_logo.svg', 'Super_Famicom_logo.svg'],
    case: { style: 'card', ratio: 1.38, body: '#d9d6d0', fg: '#4a3f73', label: 'SUPER NINTENDO' },
    exts: ['sfc', 'smc', 'fig', 'swc'], hints: [/snes|super ?nintendo|super ?famicom/i],
    emulators: [
      { name: 'Mesen', match: /mesen/i, args: '"{rom}" --fullscreen' },
      { name: 'Snes9x', match: /snes9x/i, args: '-fullscreen "{rom}"' },
      { name: 'RetroArch (Snes9x)', match: /retroarch/i, args: '-f -L "cores/snes9x_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'nes', tgdb: 7, name: 'NES', short: 'NES', maker: 'Nintendo', year: '1985', color: '#c4161c', wiki: 'Nintendo Entertainment System', libretro: 'Nintendo_-_Nintendo_Entertainment_System',
    logos: ['NES_logo.svg', 'Nes_logo_en.svg'],
    case: { style: 'card', ratio: 0.72, body: '#151515', fg: '#ffffff', label: 'NES' },
    exts: ['nes', 'fds', 'unf', 'unif'], hints: [/\bnes\b|famicom/i],
    emulators: [
      { name: 'Mesen', match: /mesen/i, args: '"{rom}" --fullscreen' },
      { name: 'RetroArch (Mesen)', match: /retroarch/i, args: '-f -L "cores/mesen_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'gb', tgdb: 4, name: 'Game Boy / Color', short: 'GAME BOY', maker: 'Nintendo', year: '1989', color: '#8bac0f', wiki: 'Game Boy', libretro: 'Nintendo_-_Game_Boy',
    logos: ['Nintendo_Game_Boy_Logo.svg', 'Gameboy_logo.svg'],
    case: { style: 'card', ratio: 0.9, body: '#e7e3d6', fg: '#3d3d3d', label: 'GAME BOY' },
    exts: ['gb', 'gbc', 'sgb'], hints: [/game ?boy(?! ?adv)|\bgbc?\b/i],
    emulators: [
      { name: 'mGBA', match: /mgba/i, args: '-f "{rom}"' },
      { name: 'RetroArch (Gambatte)', match: /retroarch/i, args: '-f -L "cores/gambatte_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'gba', tgdb: 5, name: 'Game Boy Advance', short: 'GBA', maker: 'Nintendo', year: '2001', color: '#4b3f9e', wiki: 'Game Boy Advance', libretro: 'Nintendo_-_Game_Boy_Advance',
    logos: ['Game_Boy_Advance_logo.svg'],
    case: { style: 'card', ratio: 0.9, body: '#2f2a5c', fg: '#ffffff', label: 'GAME BOY ADVANCE' },
    exts: ['gba'], hints: [/gba|game ?boy ?advance/i],
    emulators: [
      { name: 'mGBA', match: /mgba/i, args: '-f "{rom}"' },
      { name: 'RetroArch (mGBA)', match: /retroarch/i, args: '-f -L "cores/mgba_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'nds', tgdb: 8, name: 'Nintendo DS', short: 'DS', maker: 'Nintendo', year: '2004', color: '#9aa0a6', wiki: 'Nintendo DS', libretro: 'Nintendo_-_Nintendo_DS',
    logos: ['Nintendo_DS_Logo.svg', 'Nintendo_DS_logo.png'],
    case: { style: 'small', ratio: 0.88, body: '#d9dcdf', band: '#c4c8cc', fg: '#2a2a2a', label: 'NINTENDO DS' },
    exts: ['nds', 'dsi'], hints: [/\bnds\b|nintendo ?ds(?!i)/i],
    emulators: [
      { name: 'melonDS', match: /melonds/i, args: '-f "{rom}"' },
      { name: 'DeSmuME', match: /desmume/i, args: '"{rom}"' },
    ] }),

  P({ id: '3ds', tgdb: 4912, name: 'Nintendo 3DS', short: '3DS', maker: 'Nintendo', year: '2011', color: '#ce181e', wiki: 'Nintendo 3DS', libretro: 'Nintendo_-_Nintendo_3DS',
    logos: ['3ds_logo.svg', '3ds_logo_3.svg'],
    case: { style: 'small', ratio: 0.88, body: '#f2f2f2', band: '#f2f2f2', fg: '#ce181e', label: 'NINTENDO 3DS' },
    exts: ['3ds', 'cci', 'cia', 'cxi', '3dsx'], hints: [/3ds/i],
    emulators: [{ name: 'Azahar / Citra / Lime3DS', match: /azahar|citra|lime3ds/i, args: '"{rom}"' }] }),

  P({ id: 'ps1', tgdb: 10, name: 'PlayStation', short: 'PlayStation', maker: 'Sony', year: '1994', color: '#9aa1ab', wiki: 'PlayStation (console)', libretro: 'Sony_-_PlayStation',
    logos: ['PlayStation_logo_and_wordmark.svg', 'PlayStation_wordmark_(1994-2009).svg', 'Playstation_logo_colour.svg'],
    case: { style: 'jewel', ratio: 1.0, body: '#0c0c0e', fg: '#ffffff', label: 'PlayStation' },
    exts: [], hints: [/\bps1\b|\bpsx\b|\bpsone\b|playstation ?(1|one)?(?! ?[2-5])\b/i],
    emulators: [
      { name: 'DuckStation', match: /duckstation/i, args: '-batch -fullscreen "{rom}"' },
      { name: 'RetroArch (SwanStation)', match: /retroarch/i, args: '-f -L "cores/swanstation_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'ps2', tgdb: 11, name: 'PlayStation 2', short: 'PS2', maker: 'Sony', year: '2000', color: '#2a4fa3', wiki: 'PlayStation 2', libretro: 'Sony_-_PlayStation_2',
    logos: ['PlayStation_2_logo.svg', 'PlayStation_2_wordmark.svg', 'Playstation2-Logo.svg'],
    case: { style: 'dvd', ratio: 0.7, body: '#0b0b0e', band: '#0b0b0e', fg: '#ffffff', label: 'PLAYSTATION 2' },
    exts: [], hints: [/\bps2\b|playstation ?2/i],
    emulators: [{ name: 'PCSX2', match: /pcsx2/i, args: '-batch -fullscreen -- "{rom}"' }] }),

  P({ id: 'ps3', tgdb: 12, name: 'PlayStation 3', short: 'PS3', maker: 'Sony', year: '2006', color: '#3b6fd8', wiki: 'PlayStation 3', libretro: null,
    logos: ['Logo_of_the_PlayStation_3_(2006–2009).svg', 'PlayStation_3_logo_(2009).svg', 'PS3-Logo.svg'],
    case: { style: 'bluray', ratio: 0.82, body: '#1d3557', band: '#0d0d10', fg: '#ffffff', label: 'PS3' },
    exts: ['pkg'], hints: [/\bps3\b|playstation ?3/i],
    emulators: [{ name: 'RPCS3', match: /rpcs3/i, args: '--no-gui "{rom}"' }] }),

  P({ id: 'psp', tgdb: 13, name: 'PSP', short: 'PSP', maker: 'Sony', year: '2004', color: '#4d4d55', wiki: 'PlayStation Portable', libretro: 'Sony_-_PlayStation_Portable',
    logos: ['PSP_Logo.svg', 'Logo_psp.svg'],
    case: { style: 'small', ratio: 0.58, body: '#0e0e10', band: '#0e0e10', fg: '#ffffff', label: 'PSP' },
    exts: ['cso', 'zso', 'pbp'], hints: [/\bpsp\b|playstation ?portable/i],
    emulators: [{ name: 'PPSSPP', match: /ppsspp/i, args: '"{rom}" --fullscreen' }] }),

  P({ id: 'vita', tgdb: 39, name: 'PS Vita', short: 'PS VITA', maker: 'Sony', year: '2011', color: '#1e5bd8', wiki: 'PlayStation Vita', libretro: null,
    logos: ['PlayStation_Vita_logo.svg'],
    case: { style: 'small', ratio: 0.62, body: '#17418f', band: '#0f2a63', fg: '#ffffff', label: 'PS VITA' },
    exts: ['vpk'], hints: [/vita/i],
    emulators: [{ name: 'Vita3K', match: /vita3k/i, args: '"{rom}"' }] }),

  P({ id: 'xbox', tgdb: 14, name: 'Xbox', short: 'XBOX', maker: 'Microsoft', year: '2001', color: '#5b9a2a', wiki: 'Xbox (console)', libretro: null,
    logos: ['Xbox_2001_(White).svg', 'Xbox_logo_(1999).svg', 'Xbox_wordmark.svg'],
    case: { style: 'dvd', ratio: 0.7, body: '#101210', band: '#3f7d1f', fg: '#ffffff', label: 'XBOX' },
    exts: ['xiso'], hints: [/\bxbox\b(?!.{0,3}360|.{0,3}one|.{0,3}series)/i],
    emulators: [{ name: 'xemu', match: /xemu/i, args: '-full-screen -dvd_path "{rom}"' }] }),

  P({ id: 'x360', tgdb: 15, name: 'Xbox 360', short: 'XBOX 360', maker: 'Microsoft', year: '2005', color: '#7cc142', wiki: 'Xbox 360', libretro: null,
    logos: ['Xbox_360_logo.svg', 'XBOX_360.svg', 'X_Box_360_logo.svg'],
    case: { style: 'dvd', ratio: 0.7, body: '#5aa02c', band: '#f0f0f0', fg: '#4f8f25', label: 'XBOX 360' },
    exts: ['xex'], hints: [/360/],
    emulators: [{ name: 'Xenia', match: /xenia/i, args: '"{rom}" --fullscreen' }] }),

  P({ id: 'dc', tgdb: 16, name: 'Dreamcast', short: 'DREAMCAST', maker: 'Sega', year: '1998', color: '#f26522', wiki: 'Dreamcast', libretro: 'Sega_-_Dreamcast',
    logos: ['Dreamcast_logo_NTSC.svg', 'Dreamcast_logo_PAL.svg', 'Dreamcast_logo_(orange).svg'],
    case: { style: 'jewel', ratio: 1.0, body: '#ececec', fg: '#f26522', label: 'DREAMCAST' },
    exts: ['gdi', 'cdi'], hints: [/dreamcast/i],
    emulators: [
      { name: 'Flycast', match: /flycast/i, args: '"{rom}"' },
      { name: 'RetroArch (Flycast)', match: /retroarch/i, args: '-f -L "cores/flycast_libretro.dll" "{rom}"' },
    ] }),

  P({ id: 'md', tgdb: 18, name: 'Mega Drive', short: 'MEGA DRIVE', maker: 'Sega', year: '1988', color: '#2b2b2b', wiki: 'Sega Genesis', libretro: 'Sega_-_Mega_Drive_-_Genesis',
    logos: ['MegaDriveJPLogo.svg', 'Sega_genesis_logo.svg'],
    case: { style: 'dvd', ratio: 0.7, body: '#101010', band: '#101010', fg: '#ffffff', label: 'MEGA DRIVE' },
    exts: ['md', 'gen', 'smd', '68k', 'sgd'], hints: [/mega ?drive|genesis/i],
    emulators: [
      { name: 'BlastEm', match: /blastem/i, args: '-f "{rom}"' },
      { name: 'RetroArch (Genesis Plus GX)', match: /retroarch/i, args: '-f -L "cores/genesis_plus_gx_libretro.dll" "{rom}"' },
    ] }),
];

const BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

// Extensions dont la plateforme ne peut être devinée que par le chemin (dossier "PS2", "GameCube"…).
const AMBIGUOUS = ['iso', 'chd', 'cue', 'm3u', 'rvz', 'wia', 'img', 'ecm', 'mdf', 'ccd', 'bin'];
const AMBIGUOUS_CANDIDATES = {
  iso: ['ps2', 'psp', 'gc', 'wii', 'xbox', 'x360', 'ps1', 'ps3', 'dc'],
  chd: ['ps1', 'ps2', 'dc', 'psp'],
  cue: ['ps1', 'dc'],
  m3u: ['ps1', 'dc', 'ps2'],
  rvz: ['gc', 'wii'],
  wia: ['gc', 'wii'],
  ccd: ['ps1'],
  bin: ['md', 'ps1'],
  img: ['ps1'],
  ecm: ['ps1'],
  mdf: ['ps1', 'ps2'],
};

function platformForFile(filePath) {
  const lower = filePath.toLowerCase();
  const base = lower.split(/[\\/]/).pop();
  const ext = base.includes('.') ? base.split('.').pop() : '';
  if (base === 'eboot.bin' && /usrdir/.test(lower)) return 'ps3';
  if (ext === 'bin') return /mega ?drive|genesis/i.test(lower) ? 'md' : AMBIGUOUS_CANDIDATES.bin.some((id) => BY_ID[id].hints.some((h) => h.test(lower))) ? 'ps1' : null;
  if (ext === 'exe') return null;
  for (const p of PLATFORMS) if (p.ownExts?.includes(ext)) return p.id; // extension propre malgré sharedExts (.nup → Switch 2)
  for (const p of PLATFORMS) {
    if (!p.exts.includes(ext) || p.sharedExts) continue;
    // Switch / Switch 2 : même format, le dossier tranche
    if (p.id === 'switch' && BY_ID.switch2.hints.some((h) => h.test(filePath.split(/[\\/]/).slice(0, -1).join('/')))) return 'switch2';
    return p.id;
  }
  if (AMBIGUOUS.includes(ext)) {
    const dirs = filePath.split(/[\\/]/).slice(0, -1).join('/');
    for (const id of AMBIGUOUS_CANDIDATES[ext]) {
      if (BY_ID[id].hints.some((h) => h.test(dirs))) return id;
    }
    if (ext === 'rvz') return 'gc';
    if (ext === 'cue' || ext === 'ecm' || ext === 'img') return 'ps1';
    return 'unknown';
  }
  return null;
}

// Plateforme suggérée par les noms de dossiers (« ROMs/PS2/… », « GameCube »…) — sans regarder le fichier.
function folderHint(filePath) {
  const dirs = filePath.split(/[\\/]/).slice(0, -1).join('/');
  for (const p of PLATFORMS) if (p.hints.length && p.hints.some((h) => h.test(dirs))) return p.id;
  return null;
}

function romExtensions() {
  const set = new Set(AMBIGUOUS);
  for (const p of PLATFORMS) p.exts.forEach((e) => set.add(e));
  return [...set];
}

// Émulateur reconnu d'après le nom de l'exécutable → plateformes compatibles + arguments.
function detectEmulator(exePath) {
  const name = exePath.split(/[\\/]/).pop();
  const found = [];
  for (const p of PLATFORMS) {
    for (const e of p.emulators) {
      if (e.match.test(name)) found.push({ platform: p.id, emulator: e.name, args: e.args });
    }
  }
  return found;
}

// Version sérialisable pour l'interface (sans RegExp).
function publicPlatforms() {
  return PLATFORMS.map((p) => ({
    id: p.id, tgdb: p.tgdb, name: p.name, short: p.short, maker: p.maker, year: p.year, color: p.color, case: p.case,
    emulators: p.emulators.map((e) => ({ name: e.name, args: e.args })),
    exts: p.exts,
  }));
}

module.exports = { PLATFORMS, BY_ID, platformForFile, folderHint, romExtensions, detectEmulator, publicPlatforms, AMBIGUOUS };

// EMU — catalogue : émulateurs installables, émulateur recommandé par console, cœurs libretro, BIOS.
// Sources vérifiées (nov. 2026) :
//  - RetroArch stable : https://buildbot.libretro.com/stable/<version>/windows/x86_64/RetroArch.7z (1.22.2 au moment
//    de l'écriture ; la version est relue dans l'index /stable/ à chaque installation, repli sur STABLE_FALLBACK).
//  - cœurs : https://buildbot.libretro.com/nightly/windows/x86_64/latest/<core>_libretro.dll.zip
//  - émulateurs dédiés : API GitHub releases/latest (asset choisi par expression régulière, pas par nom figé,
//    car le nom contient la version : pcsx2-v2.8.2-windows-x64-Qt.7z, azahar-windows-msvc-2126.2.zip…).
//  - Dolphin, PPSSPP, Eden, Citron, Ryujinx : pas d'archive portable stable à URL prévisible → site officiel.
'use strict';

const STABLE_FALLBACK = '1.22.2';
const BUILDBOT = process.env.RR_EMU_BUILDBOT || 'https://buildbot.libretro.com';
const GITHUB_API = process.env.RR_EMU_GITHUB_API || 'https://api.github.com';

// source.type : 'retroarch' (buildbot) | 'github' (releases/latest) | 'site' (ouvrir le site officiel)
// exe : nom de l'exécutable à trouver dans l'archive ; portable : fichiers à créer pour le mode portable
const EMULATORS = {
  retroarch: { name: 'RetroArch', source: { type: 'retroarch' }, exe: /^retroarch\.exe$/i, site: 'https://www.retroarch.com/?page=platforms' },
  pcsx2: { name: 'PCSX2', source: { type: 'github', repo: 'PCSX2/pcsx2', asset: /windows-x64-Qt\.7z$/i }, exe: /^pcsx2(-qt)?(x64)?[\w-]*\.exe$/i, portable: ['portable.ini'], site: 'https://pcsx2.net/downloads' },
  duckstation: { name: 'DuckStation', source: { type: 'github', repo: 'stenzek/duckstation', asset: /windows-x64-release\.zip$/i }, exe: /^duckstation-qt.*\.exe$/i, portable: ['portable.txt'], site: 'https://www.duckstation.org/' },
  rpcs3: { name: 'RPCS3', source: { type: 'github', repo: 'RPCS3/rpcs3-binaries-win', asset: /win64.*\.7z$/i }, exe: /^rpcs3\.exe$/i, site: 'https://rpcs3.net/download' },
  azahar: { name: 'Azahar', source: { type: 'github', repo: 'azahar-emu/azahar', asset: /windows-msvc.*\.zip$/i }, exe: /^azahar(-qt)?\.exe$/i, portableDir: 'user', site: 'https://azahar-emu.org/' },
  melonds: { name: 'melonDS', source: { type: 'github', repo: 'melonDS-emu/melonDS', asset: /windows.*x86_64.*\.zip$/i }, exe: /^melonds\.exe$/i, site: 'https://melonds.kuribo64.net/' },
  cemu: { name: 'Cemu', source: { type: 'github', repo: 'cemu-project/Cemu', asset: /windows-x64\.zip$/i }, exe: /^cemu\.exe$/i, portableDir: 'portable', site: 'https://cemu.info/' },
  xemu: { name: 'xemu', source: { type: 'github', repo: 'xemu-project/xemu', asset: /win.*(x86_64|x64).*release\.zip$/i }, exe: /^xemu\.exe$/i, site: 'https://xemu.app/' },
  xenia: { name: 'Xenia Canary', source: { type: 'github', repo: 'xenia-canary/xenia-canary-releases', asset: /xenia_canary.*windows.*\.zip$|xenia_canary\.zip$/i }, exe: /^xenia_canary\.exe$/i, site: 'https://xenia.jp/' },
  vita3k: { name: 'Vita3K', source: { type: 'github', repo: 'Vita3K/Vita3K', asset: /windows.*\.zip$/i }, exe: /^vita3k\.exe$/i, site: 'https://vita3k.org/' },
  dolphin: { name: 'Dolphin', source: { type: 'site' }, site: 'https://dolphin-emu.org/download/' },
  ppsspp: { name: 'PPSSPP', source: { type: 'site' }, site: 'https://www.ppsspp.org/download/' },
  // Switch 2 : Fritchii (fork de Lichii par Frizti, réglé pour Ocarina of Time) et Lichii (zortos293). Archive
  // « …-Windows-x64.zip » / « lichii-windows-x86_64.zip », exécutable lichii.exe. Données dans %APPDATA%\fritchii.
  fritchii: { name: 'Fritchii', source: { type: 'github', repo: 'Frizti/Fritchii', asset: /windows-x64\.zip$/i, prerelease: true }, exe: /^lichii\.exe$/i, site: 'https://github.com/Frizti/Fritchii/releases' },
  lichii: { name: 'Lichii', source: { type: 'github', repo: 'zortos293/Lichii', asset: /^lichii-windows-x86_64\.zip$/i, prerelease: true }, exe: /^lichii\.exe$/i, site: 'https://github.com/zortos293/Lichii/releases' },
  eden: { name: 'Eden', source: { type: 'site' }, site: 'https://eden-emu.dev/' },
  citron: { name: 'Citron', source: { type: 'site' }, site: 'https://citron-emu.org/' },
  ryujinx: { name: 'Ryujinx', source: { type: 'site' }, site: 'https://ryujinx.app/' },
};

// Cœur libretro par console (doit correspondre aux arguments de platforms.js « RetroArch (…) »)
const CORES = { nes: 'mesen', snes: 'snes9x', gb: 'gambatte', gba: 'mgba', n64: 'mupen64plus_next', md: 'genesis_plus_gx', ps1: 'swanstation', dc: 'flycast' };

// Options par console : la première est recommandée
const RECO = {
  nes: [{ emu: 'retroarch', core: 'mesen' }], snes: [{ emu: 'retroarch', core: 'snes9x' }],
  gb: [{ emu: 'retroarch', core: 'gambatte' }], gba: [{ emu: 'retroarch', core: 'mgba' }],
  n64: [{ emu: 'retroarch', core: 'mupen64plus_next' }], md: [{ emu: 'retroarch', core: 'genesis_plus_gx' }],
  dc: [{ emu: 'retroarch', core: 'flycast' }],
  ps1: [{ emu: 'retroarch', core: 'swanstation' }, { emu: 'duckstation' }],
  ps2: [{ emu: 'pcsx2' }], ps3: [{ emu: 'rpcs3' }], psp: [{ emu: 'ppsspp' }], vita: [{ emu: 'vita3k' }],
  gc: [{ emu: 'dolphin' }], wii: [{ emu: 'dolphin' }], wiiu: [{ emu: 'cemu' }],
  switch: [{ emu: 'eden' }, { emu: 'citron' }, { emu: 'ryujinx' }],
  switch2: [{ emu: 'fritchii' }, { emu: 'lichii' }, { emu: 'eden' }], // émulateurs Switch 2 expérimentaux (nov. 2026)
  '3ds': [{ emu: 'azahar' }], nds: [{ emu: 'melonds' }],
  xbox: [{ emu: 'xemu' }], x360: [{ emu: 'xenia' }],
};

// Empreintes MD5 de référence (nom de fichier en minuscules → empreintes acceptées) pour les BIOS courants
// (tables des documentations libretro / Redump). Un fichier présent mais à l'empreinte différente n'est PAS refusé :
// il est signalé (dump modifié, autre révision, fichier corrompu). Fichier sans référence connue : non vérifié.
const BIOS_MD5 = {
  'scph1001.bin': ['924e392ed05558ffdb115408c263dccf'],
  'scph5500.bin': ['8dd7d5296a650fac7319bce665a6a53c'],
  'scph5501.bin': ['490f666e1afb15b7362b406ed1cea246'],
  'scph5502.bin': ['32736f17079d0b2b7024407c39bd3050'],
  'scph7001.bin': ['1e68c231d0896b7eadcad1d7d8e76129'],
  'gba_bios.bin': ['a860e8c0b6d573d191e4ec7db1b1e4f6'],
  'gb_bios.bin': ['32fbbd84168d3482956eb3c5051637f5'],
  'gbc_bios.bin': ['dbfce9db9deaa2567f6a84fde55f9680'],
  'disksys.rom': ['ca30b50f880eb660a320674ed365ef7a'],
  'dc_boot.bin': ['e10c53c2f8b90bab96ead2d368858623'],
  'bios_cd_e.bin': ['e66fa1dc5820d254611fdcdba0662372'],
  'bios_cd_u.bin': ['2efd74e3232ff260e371b99f84024f7f'],
  'bios_cd_j.bin': ['278a9397d192149e84e820ac621a8edd'],
  'bios7.bin': ['df692a80a5b1bc90728bc3dfc76cd948'],
  'bios9.bin': ['a392174eb3e572fed6447e956bde4b25'],
};

// BIOS : jamais téléchargés (droits d'auteur) — détection seulement.
// where : 'system' (dossier system de RetroArch) | 'bios' (dossier bios de l'émulateur) | 'dir' (dossier de l'exe)
// any : au moins un des fichiers ; size : taille attendue (octets) ; optional : recommandé seulement
const BIOS = {
  retroarch: {
    ps1: [{ any: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin', 'scph1001.bin', 'scph7001.bin'], size: 524288, label: 'BIOS PlayStation (scph5501.bin pour les jeux US, scph5502.bin EU, scph5500.bin JP)' }],
    gba: [{ any: ['gba_bios.bin'], size: 16384, optional: true, label: 'BIOS Game Boy Advance (facultatif, mGBA a un BIOS de remplacement)' }],
    gb: [{ any: ['gb_bios.bin', 'gbc_bios.bin'], optional: true, label: 'BIOS Game Boy / Color (facultatif)' }],
    nes: [{ any: ['disksys.rom'], size: 8192, optional: true, label: 'BIOS Famicom Disk System (pour les jeux .fds)' }],
    dc: [{ any: ['dc/dc_boot.bin'], size: 2097152, optional: true, label: 'BIOS Dreamcast dc/dc_boot.bin (recommandé, Flycast a un BIOS de remplacement)' }],
    md: [{ any: ['bios_CD_E.bin', 'bios_CD_U.bin', 'bios_CD_J.bin'], optional: true, label: 'BIOS Mega-CD (seulement pour les jeux Mega-CD)' }],
  },
  duckstation: { ps1: [{ dir: 'bios', any: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin', 'scph1001.bin', 'scph7001.bin', '*.bin'], size: 524288, label: 'BIOS PlayStation (scph5501.bin…)' }] },
  pcsx2: { ps2: [{ dir: 'bios', any: ['*.bin', '*.rom0', '*.rom'], minSize: 4194304, label: 'BIOS PlayStation 2 (dump de ta console, ex. SCPH-70004.bin)' }] },
  rpcs3: { ps3: [{ dir: 'dev_flash/sys', anyDir: true, label: 'Firmware PS3 (PS3UPDAT.PUP à installer via RPCS3 → Fichier → Installer le firmware)' }] },
  vita3k: { vita: [{ note: true, label: 'Firmware PS Vita (PSVUPDAT.PUP) à installer depuis Vita3K au premier lancement' }] },
  melonds: { nds: [{ any: ['bios7.bin'], optional: true, label: 'BIOS DS bios7.bin / bios9.bin / firmware.bin (facultatifs, à indiquer dans melonDS)' }] },
  xemu: { xbox: [{ note: true, label: 'MCPX boot ROM, BIOS Xbox et disque dur (xbox_hdd.qcow2) à indiquer dans xemu → Paramètres → Système' }] },
  // eden : aussi Fritchii / Lichii / Eglantine (lichii.exe → même famille, voir launch.js/emuKind)
  eden: {
    switch: [{ note: true, label: 'Clés prod.keys et firmware de ta console à installer depuis l’émulateur' }],
    switch2: [{ note: true, label: 'Clés et firmware de ta Switch 2 à installer depuis l’émulateur (Outils → Installer les clés, puis le firmware)' }],
  },
  citron: { switch: [{ note: true, label: 'Clés prod.keys et firmware de ta console à installer depuis l’émulateur' }] },
  ryujinx: { switch: [{ note: true, label: 'Clés prod.keys et firmware de ta console à installer depuis Ryujinx' }] },
};

function coreUrl(core) { return `${BUILDBOT}/nightly/windows/x86_64/latest/${core}_libretro.dll.zip`; }
function retroarchUrl(version) { return `${BUILDBOT}/stable/${version}/windows/x86_64/RetroArch.7z`; }
// Plus haute version « x.y.z » d'un index HTML /stable/
function latestStable(html) {
  const v = [...String(html).matchAll(/href="(?:\/stable\/)?(\d+\.\d+\.\d+)\/?"/g)].map((m) => m[1]);
  const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  return v.sort(cmp).pop() || null;
}
// Asset Windows d'une release GitHub (exclut symboles, sources, installeurs)
function pickAsset(release, re) {
  const list = (release?.assets || []).filter((a) => re.test(a.name) && !/symbol|debug|pdb|source|setup|installer|\.msi$/i.test(a.name));
  return list[0] || null;
}

module.exports = { EMULATORS, CORES, RECO, BIOS, BIOS_MD5, STABLE_FALLBACK, BUILDBOT, GITHUB_API, coreUrl, retroarchUrl, latestStable, pickAsset };

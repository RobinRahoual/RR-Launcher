// EMU — construction de la ligne de commande (pure, testable) : profil par jeu g.launch =
//   { emuPath, emuArgs, emuName, args, env: "CLE=valeur\n…", admin, fullscreen: 'default'|'on'|'off', resolution: 0|1..8 }
'use strict';
const path = require('path');
const dirname = (p) => (String(p).includes('\\') ? path.win32 : path).dirname(p); // chemins Windows aussi dans les tests

// Identifiant d'émulateur d'après le nom de l'exécutable
const KINDS = [
  ['retroarch', /retroarch/i], ['dolphin', /dolphin/i], ['pcsx2', /pcsx2/i], ['duckstation', /duckstation/i],
  ['ppsspp', /ppsspp/i], ['cemu', /cemu/i], ['eden', /eden|citron|sudachi|yuzu|suyu|lichii|fritchii|eglantine/i], ['ryujinx', /ryujinx/i],
  ['mgba', /mgba/i], ['melonds', /melonds/i], ['azahar', /azahar|citra|lime3ds/i], ['xemu', /xemu/i], ['xenia', /xenia/i],
  ['rpcs3', /rpcs3/i], ['mesen', /mesen/i], ['snes9x', /snes9x/i], ['project64', /project64/i], ['flycast', /flycast/i],
  ['ares', /^ares/i], ['vita3k', /vita3k/i], ['blastem', /blastem/i], ['simple64', /simple64/i],
];
function emuKind(exePath) {
  const name = String(exePath || '').split(/[\\/]/).pop();
  for (const [id, re] of KINDS) if (re.test(name)) return id;
  return null;
}

// Plein écran : drapeaux connus (on = à ajouter, off = à ajouter pour forcer le fenêtré, strip = à retirer des presets)
const FULLSCREEN = {
  retroarch: { on: ['-f'], strip: ['-f', '--fullscreen'] },
  dolphin: { on: ['-C', 'Dolphin.Display.Fullscreen=True'], off: ['-C', 'Dolphin.Display.Fullscreen=False'] },
  pcsx2: { on: ['-fullscreen'], off: ['-nofullscreen'], strip: ['-fullscreen', '-nofullscreen'] },
  duckstation: { on: ['-fullscreen'], off: ['-nofullscreen'], strip: ['-fullscreen', '-nofullscreen'] },
  ppsspp: { on: ['--fullscreen'], strip: ['--fullscreen'] },
  cemu: { on: ['-f'], strip: ['-f', '--fullscreen'] },
  eden: { on: ['-f'], strip: ['-f'] },
  mgba: { on: ['-f'], strip: ['-f'] },
  melonds: { on: ['-f'], strip: ['-f'] },
  mesen: { on: ['--fullscreen'], strip: ['--fullscreen'] },
  ares: { on: ['--fullscreen'], strip: ['--fullscreen'] },
  xemu: { on: ['-full-screen'], strip: ['-full-screen'] },
  xenia: { on: ['--fullscreen'], strip: ['--fullscreen'] },
  snes9x: { on: ['-fullscreen'], strip: ['-fullscreen'] },
};
// Résolution interne : seul Dolphin a une option en ligne de commande (-C GFX.Settings.InternalResolution=N).
// RetroArch (option propre à chaque cœur) et PCSX2 n'en ont pas → non proposé.
const RESOLUTION = { dolphin: (n) => ['-C', `GFX.Settings.InternalResolution=${n}`] };

function parseEnv(s) {
  const env = {};
  if (s && typeof s === 'object') { for (const [k, v] of Object.entries(s)) if (/^[A-Za-z_][\w.()-]*$/.test(k)) env[k] = String(v); return env; }
  for (const line of String(s || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w.()-]*)\s*=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return env;
}

function emulatorFor(g, settings = {}) {
  const L = g?.launch || {};
  if (g?.kind === 'rom' && L.emuPath) {
    return { path: L.emuPath, args: L.emuArgs || '"{rom}"', name: L.emuName || path.basename(L.emuPath).replace(/\.\w+$/, ''), custom: true };
  }
  return settings.emulators?.[g?.platform] || null;
}

// PowerShell : chaîne entre apostrophes
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const winq = (a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a);

// Lancement en administrateur : Start-Process -Verb RunAs (fenêtre UAC). Le processus lancé n'est pas un enfant
// suivable : la fin de partie est détectée via le dossier (followDir). Les variables d'environnement ne sont pas
// transmises par l'élévation.
function elevate(file, args, cwd) {
  const list = args.length ? ` -ArgumentList ${psq(args.map(winq).join(' '))}` : '';
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath ${psq(file)}${list} -WorkingDirectory ${psq(cwd)} -Verb RunAs`] };
}

// → { file, args, cwd, spawn: { env? }, followDir?, admin, kind }
function command(g, emu, { splitArgs, env = process.env } = {}) {
  const L = g.launch || {};
  const extra = splitArgs(L.args || '');
  let file, args, cwd, followDir, kind = null;
  if (g.kind === 'rom') {
    file = emu.path; cwd = dirname(emu.path);
    kind = emuKind(emu.path);
    let t = splitArgs(emu.args || '"{rom}"');
    const fs = FULLSCREEN[kind];
    const pre = [];
    if (fs && (L.fullscreen === 'on' || L.fullscreen === 'off')) {
      const strip = new Set([...(fs.strip || []), ...(fs.on.length === 1 ? fs.on : [])]);
      t = t.filter((a) => !strip.has(a));
      if (fs.on.length === 2) { // paire « -C clé=valeur » : retirer aussi une éventuelle paire déjà présente
        const key = fs.on[1].split('=')[0];
        for (let i = t.length - 2; i >= 0; i--) if (t[i] === '-C' && t[i + 1].startsWith(key + '=')) t.splice(i, 2);
      }
      if (L.fullscreen === 'on') pre.push(...fs.on);
      else if (fs.off) pre.push(...fs.off);
    }
    const res = Number(L.resolution) || 0;
    if (res && RESOLUTION[kind]) pre.push(...RESOLUTION[kind](res));
    args = [...pre, ...extra, ...t].map((a) => a.replace('{rom}', g.romPath).replace('{romdir}', dirname(g.romPath)));
    // Fritchii / Lichii / Eden peuvent se mettre à jour au démarrage et se relancer : on suit leur dossier
    // pour ne pas croire la partie finie quand le premier processus se ferme.
    if (kind === 'eden') followDir = cwd;
  } else {
    cwd = dirname(g.exePath);
    const ext = path.extname(g.exePath).toLowerCase();
    const base = [...splitArgs(g.args), ...extra];
    if (ext === '.bat' || ext === '.cmd') { file = 'cmd.exe'; args = ['/c', g.exePath, ...base]; }
    else { file = g.exePath; args = base; followDir = g.installDir || cwd; }
  }
  const vars = parseEnv(L.env);
  const spawn = Object.keys(vars).length ? { env: { ...env, ...vars } } : {};
  if (L.admin) {
    const e = elevate(file, args, cwd);
    return { file: e.file, args: e.args, cwd, spawn: { windowsHide: true }, followDir: followDir || cwd, admin: true, kind, target: file };
  }
  return { file, args, cwd, spawn, followDir, admin: false, kind };
}

// Ce que l'interface peut proposer pour un émulateur donné
function capabilities(exePath) {
  const kind = emuKind(exePath);
  return { kind, fullscreen: !!FULLSCREEN[kind], resolution: !!RESOLUTION[kind] };
}

module.exports = { emuKind, emulatorFor, command, parseEnv, capabilities, FULLSCREEN, RESOLUTION, elevate };

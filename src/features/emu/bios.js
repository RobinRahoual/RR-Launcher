// EMU — détection des BIOS (jamais de téléchargement : droits d'auteur). Renvoie ce qui manque et où le placer.
'use strict';
const fs = require('fs');
const path = require('path');
const { BIOS } = require('./catalog');
const { emuKind } = require('./launch');

// Dossier « system » de RetroArch : system_directory de retroarch.cfg (":\" = dossier de l'exe), sinon <exe>/system
function retroarchSystemDir(exePath, fsx = fs) {
  const dir = path.dirname(exePath);
  try {
    const cfg = fsx.readFileSync(path.join(dir, 'retroarch.cfg'), 'utf8');
    const m = cfg.match(/^\s*system_directory\s*=\s*"([^"]*)"/m);
    if (m && m[1] && m[1] !== 'default') return m[1].replace(/^:[\\/]/, dir + path.sep);
  } catch {}
  return path.join(dir, 'system');
}
// Dossier de BIOS d'un émulateur dédié (portable si le fichier témoin existe, sinon Documents\<Émulateur>)
function emuDataDir(kind, exePath, env = process.env, fsx = fs) {
  const dir = path.dirname(exePath);
  const docs = path.join(env.USERPROFILE || env.HOME || '', 'Documents');
  if (kind === 'pcsx2') return fsx.existsSync(path.join(dir, 'portable.ini')) || fsx.existsSync(path.join(dir, 'portable.txt')) ? dir : path.join(docs, 'PCSX2');
  if (kind === 'duckstation') return fsx.existsSync(path.join(dir, 'portable.txt')) ? dir : path.join(docs, 'DuckStation');
  return dir;
}
function globMatch(pat, name) {
  if (!pat.includes('*')) return pat.toLowerCase() === name.toLowerCase();
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  return re.test(name);
}
function listDir(d, fsx) { try { return fsx.readdirSync(d); } catch { return null; } }

// → [{ label, optional, ok, found?, folder, files, note, warn? }]
function check(platform, emu, { env = process.env, fsx = fs } = {}) {
  if (!emu?.path) return [];
  const kind = emuKind(emu.path);
  const reqs = BIOS[kind]?.[platform] || [];
  const out = [];
  for (const r of reqs) {
    if (r.note) { out.push({ label: r.label, note: true, ok: null }); continue; }
    const base = kind === 'retroarch' ? retroarchSystemDir(emu.path, fsx) : emuDataDir(kind, emu.path, env, fsx);
    const folder = r.dir ? path.join(base, r.dir) : base;
    if (r.anyDir) { const ls = listDir(folder, fsx); out.push({ label: r.label, ok: !!(ls && ls.length), folder, files: [] }); continue; }
    let found = null, warn = null;
    for (const pat of r.any) {
      const sub = path.dirname(pat) === '.' ? folder : path.join(folder, path.dirname(pat));
      const ls = listDir(sub, fsx) || [];
      const hit = ls.find((n) => globMatch(path.basename(pat), n));
      if (!hit) continue;
      const full = path.join(sub, hit);
      let size = 0;
      try { size = fsx.statSync(full).size; } catch {}
      if (r.size && size !== r.size) { warn = `${hit} : taille inattendue (${size} octets)`; continue; }
      if (r.minSize && size < r.minSize) continue;
      found = full; break;
    }
    out.push({ label: r.label, optional: !!r.optional, ok: !!found, found, warn, folder, files: r.any.filter((x) => !x.includes('*')) });
  }
  return out;
}

module.exports = { check, retroarchSystemDir, emuDataDir, globMatch };

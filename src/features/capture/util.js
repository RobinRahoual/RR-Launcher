// RR Launcher — CAPTURE : utilitaires purs (testés dans test/capture.test.js)
'use strict';
const fs = require('fs');
const path = require('path');

const IMAGE = /\.(png|jpe?g)$/i;
const VIDEO = /\.webm$/i;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// Nom de dossier valide sous Windows à partir du nom d'un jeu
function safeName(name) {
  let s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
    .trim();
  if (!s || /^\.+$/.test(s)) return 'Autres';
  if (RESERVED.test(s)) s += '_';
  return s;
}

const p2 = (n) => String(n).padStart(2, '0');
// « 2026-11-13 21-04-05 » (triable, sans « : »)
function fileStamp(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
}

// Chemin libre : « base.ext », sinon « base (2).ext »…
function freePath(dir, base, ext) {
  let f = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${base} (${i})${ext}`);
  return f;
}

function inside(root, p) {
  const r = path.resolve(root);
  const x = path.resolve(p);
  return x.startsWith(r + path.sep);
}

// « <dossier du jeu>/<fichier> » relatif à la racine → chemin absolu, ou null (hors racine, profondeur, extension)
function resolveRel(root, rel) {
  const parts = String(rel || '').split(/[\\/]+/).filter(Boolean);
  if (parts.length !== 2 || parts.some((x) => x === '.' || x === '..')) return null;
  if (!IMAGE.test(parts[1]) && !VIDEO.test(parts[1])) return null;
  const full = path.resolve(root, parts[0], parts[1]);
  return inside(root, full) ? full : null;
}

// Images et vidéos d'un dossier, plus récentes d'abord
function listMedia(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const file of names) {
    const kind = IMAGE.test(file) ? 'image' : VIDEO.test(file) ? 'video' : null;
    if (!kind) continue;
    try {
      const st = fs.statSync(path.join(dir, file));
      if (st.isFile()) out.push({ file, kind, mtime: st.mtimeMs, size: st.size });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

module.exports = { safeName, fileStamp, freePath, inside, resolveRel, listMedia, IMAGE, VIDEO };

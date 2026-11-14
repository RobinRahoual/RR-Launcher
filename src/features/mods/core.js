// MODS — cœur testable : mods de fichiers (copie réversible dans le dossier du jeu, sauvegarde des originaux)
// et ROM patchée (copie à côté, la ROM d'origine n'est jamais touchée).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./patch');

const MAX_ROM = 256 * 1024 * 1024;

// Chemin relatif sûr (pas de « .. », pas de chemin absolu / lecteur) → chemin avec « / », ou null
function safeRel(rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!r || r.startsWith('/') || /^[A-Za-z]:/.test(r) || r.split('/').some((s) => s === '..' || s === '')) return null;
  return r;
}
function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function listFiles(dir, base = dir, fsx = fs) {
  const out = [];
  for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base, fsx));
    else if (e.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}
// Si l'archive contient un seul dossier racine (« MonMod/… »), on remonte son contenu d'un niveau
function flattenSingleRoot(dir, fsx = fs) {
  const ents = fsx.readdirSync(dir, { withFileTypes: true });
  if (ents.length === 1 && ents[0].isDirectory()) {
    const sub = path.join(dir, ents[0].name);
    for (const e of fsx.readdirSync(sub)) fsx.renameSync(path.join(sub, e), path.join(dir, e));
    fsx.rmdirSync(sub);
  }
}

/**
 * Applique l'ensemble des mods activés dans installDir. mods = [{ id, files: [rel…], enabled }] dans l'ordre (le dernier
 * gagne). gameDir contient <modId>/files/<rel> et reçoit _backup/<rel>. state = { installed: { rel: modId }, backed: [rel…] }.
 * → { state, errors: [] }
 */
function syncFiles({ installDir, gameDir, mods, state, fsx = fs }) {
  const st = { installed: { ...(state?.installed || {}) }, backed: [...(state?.backed || [])] };
  const errors = [];
  const owner = {};
  for (const m of mods) if (m.enabled) for (const raw of m.files || []) { const rel = safeRel(raw); if (rel) owner[rel] = m.id; }
  const backup = (rel) => path.join(gameDir, '_backup', rel);
  const target = (rel) => path.join(installDir, rel);
  const mkdir = (f) => fsx.mkdirSync(path.dirname(f), { recursive: true });

  // 1. Fichiers qui ne sont plus à nous : on remet l'original (ou on supprime ce que le mod avait ajouté)
  for (const rel of Object.keys(st.installed)) {
    if (owner[rel]) continue;
    try {
      if (!inside(installDir, target(rel))) continue;
      if (st.backed.includes(rel) && fsx.existsSync(backup(rel))) { mkdir(target(rel)); fsx.copyFileSync(backup(rel), target(rel)); fsx.rmSync(backup(rel), { force: true }); }
      else fsx.rmSync(target(rel), { force: true });
      st.backed = st.backed.filter((x) => x !== rel);
      delete st.installed[rel];
    } catch (e) { errors.push(`${rel} : ${e.message}`); }
  }
  // 2. Fichiers des mods activés
  for (const [rel, id] of Object.entries(owner)) {
    try {
      const dst = target(rel);
      if (!inside(installDir, dst)) { errors.push(`${rel} : chemin refusé`); continue; }
      const src = path.join(gameDir, id, 'files', rel);
      if (!fsx.existsSync(src)) { errors.push(`${rel} : fichier du mod introuvable`); continue; }
      if (!st.installed[rel] && fsx.existsSync(dst) && !st.backed.includes(rel)) { mkdir(backup(rel)); fsx.copyFileSync(dst, backup(rel)); st.backed.push(rel); }
      if (st.installed[rel] !== id || !fsx.existsSync(dst)) { mkdir(dst); fsx.copyFileSync(src, dst); }
      st.installed[rel] = id;
    } catch (e) { errors.push(`${rel} : ${e.message}`); }
  }
  return { state: st, errors };
}

/**
 * ROM patchée : applique les patchs activés dans l'ordre sur une copie. Le nom reste stable (« <ROM> (patché).<ext> »)
 * pour que les sauvegardes de l'émulateur suivent ; un fichier .stamp évite de recalculer quand rien n'a changé.
 * patches = [{ id, file }] → { path, rebuilt }  (patches vide → { path: romPath })
 */
function buildPatched({ romPath, patches, outDir, fsx = fs }) {
  if (!patches.length) return { path: romPath, rebuilt: false };
  const rs = fsx.statSync(romPath);
  if (rs.size > MAX_ROM) throw new Error('ROM trop volumineuse pour être patchée (256 Mo maximum)');
  const ext = path.extname(romPath);
  const out = path.join(outDir, `${path.basename(romPath, ext)} (patché)${ext}`);
  const stampFile = out + '.stamp';
  const stamp = crypto.createHash('sha1').update(JSON.stringify([romPath, rs.size, rs.mtimeMs, patches.map((p) => [p.id, fsx.statSync(p.file).size, fsx.statSync(p.file).mtimeMs])])).digest('hex');
  try { if (fsx.readFileSync(stampFile, 'utf8') === stamp && fsx.existsSync(out)) return { path: out, rebuilt: false }; } catch {}
  let buf = fsx.readFileSync(romPath);
  for (const p of patches) {
    try { buf = P.apply(buf, fsx.readFileSync(p.file)); } catch (e) { throw new Error(`${path.basename(p.file)} : ${e.message}`); }
  }
  fsx.mkdirSync(outDir, { recursive: true });
  fsx.writeFileSync(out, buf);
  fsx.writeFileSync(stampFile, stamp);
  return { path: out, rebuilt: true };
}

module.exports = { safeRel, inside, listFiles, flattenSingleRoot, syncFiles, buildPatched, MAX_ROM };

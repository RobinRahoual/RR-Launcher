// EMU — installation automatique d'un émulateur (et du cœur libretro) dans <root>/<émulateur>.
// Étapes : source (buildbot / GitHub) → téléchargement (reprise, taille, SHA-256 si fourni) → extraction dans un
// dossier temporaire → contrôle (exe présent) → fusion dans le dossier final (une mise à jour garde la config,
// les sauvegardes et le dossier system) → mode portable → cœur → retroarch.cfg (commandes réseau).
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./catalog');
const { download, json, text } = require('./download');
const { extract } = require('./extract');
const { enableNetCmd } = require('./states');
const { detectEmulator } = require('../../platforms');

function findFile(dir, re, depth = 4) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) if (e.isFile() && re.test(e.name)) return path.join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of ents) if (e.isDirectory() && !/^(cores|assets|system|shaders)$/i.test(e.name)) { const f = findFile(path.join(dir, e.name), re, depth - 1); if (f) return f; }
  return null;
}
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} };

async function resolveSource(emuId, { signal, fetchImpl } = {}) {
  const E = C.EMULATORS[emuId];
  if (!E) throw new Error('Émulateur inconnu');
  if (E.source.type === 'retroarch') {
    let v = null;
    try { v = C.latestStable(await text(`${C.BUILDBOT}/stable/`, { signal, fetchImpl })); } catch (e) { if (e.name === 'AbortError') throw e; }
    v ||= C.STABLE_FALLBACK;
    return { url: C.retroarchUrl(v), file: 'RetroArch.7z', version: v };
  }
  if (E.source.type === 'github') {
    let rel;
    const fromList = async () => {
      const list = await json(`${C.GITHUB_API}/repos/${E.source.repo}/releases?per_page=10`, { signal, fetchImpl });
      return (list || []).find((r) => !r.draft && C.pickAsset(r, E.source.asset));
    };
    // source.prerelease : projets qui ne publient que des pré-versions (Fritchii, Lichii) → /latest les ignore
    if (E.source.prerelease) rel = await fromList();
    else {
      try { rel = await json(`${C.GITHUB_API}/repos/${E.source.repo}/releases/latest`, { signal, fetchImpl }); } catch (e) {
        if (e.name === 'AbortError') throw e;
        rel = await fromList();
      }
    }
    const a = C.pickAsset(rel, E.source.asset);
    if (!a) throw new Error(`Pas d'archive Windows dans la dernière version de ${E.name} : installe-le depuis ${E.site}`);
    const digest = /^sha256:([a-f0-9]{64})$/i.exec(a.digest || '')?.[1];
    return { url: a.browser_download_url, file: a.name, size: a.size, sha256: digest, version: rel.tag_name || rel.name || '' };
  }
  throw Object.assign(new Error(`${E.name} s'installe depuis son site officiel`), { code: 'SITE', site: E.site });
}

// install({ platform, emu, core, update }, { root, onProgress, signal, installed }) → { conf, dir, version }
async function install({ platform, emu: emuId, core, update = false }, { root, onProgress = () => {}, signal, installed = {}, fetchImpl } = {}) {
  const E = C.EMULATORS[emuId];
  if (!E) throw new Error('Émulateur inconnu');
  const dir = path.join(root, emuId);
  const dl = path.join(root, '_downloads');
  fs.mkdirSync(dl, { recursive: true });
  const step = (phase, extra = {}) => onProgress({ phase, emu: emuId, platform, ...extra });
  let exe = installed[emuId]?.exe && fs.existsSync(installed[emuId].exe) ? installed[emuId].exe : null;
  let version = installed[emuId]?.version || '';

  if (!exe || update) {
    step('resolve', { label: `Recherche de la dernière version de ${E.name}…` });
    const src = await resolveSource(emuId, { signal, fetchImpl });
    version = src.version;
    const archive = path.join(dl, src.file.replace(/[^\w.-]+/g, '_'));
    step('download', { label: `Téléchargement de ${E.name} ${version}`, got: 0, total: src.size || 0 });
    await download(src.url, archive, { signal, size: src.size, sha256: src.sha256, fetchImpl, onProgress: (p) => step('download', { label: `Téléchargement de ${E.name} ${version}`, ...p }) });
    const staging = path.join(root, '_staging', emuId);
    rm(staging);
    step('extract', { label: `Extraction de ${E.name}…` });
    await extract(archive, staging, { signal });
    const found = findFile(staging, E.exe);
    if (!found) { rm(staging); throw new Error(`Archive de ${E.name} inattendue : ${'exécutable'} introuvable`); }
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(path.dirname(found), dir, { recursive: true, force: true });
    rm(staging); rm(archive);
    exe = path.join(dir, path.basename(found));
    for (const f of E.portable || []) { const p = path.join(dir, f); if (!fs.existsSync(p)) fs.writeFileSync(p, ''); }
    if (E.portableDir) fs.mkdirSync(path.join(dir, E.portableDir), { recursive: true });
  }

  if (emuId === 'retroarch') {
    if (core) {
      step('core', { label: `Téléchargement du cœur ${core}`, got: 0, total: 0 });
      const zip = path.join(dl, `${core}_libretro.dll.zip`);
      await download(C.coreUrl(core), zip, { signal, fetchImpl, onProgress: (p) => step('core', { label: `Téléchargement du cœur ${core}`, ...p }) });
      await extract(zip, path.join(dir, 'cores'), { signal });
      rm(zip);
      if (!fs.existsSync(path.join(dir, 'cores', `${core}_libretro.dll`))) throw new Error(`Cœur ${core} : archive inattendue`);
    }
    step('config', { label: 'Configuration de RetroArch…' });
    fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
    const cfg = path.join(dir, 'retroarch.cfg');
    let t = '';
    try { t = fs.readFileSync(cfg, 'utf8'); } catch {}
    fs.writeFileSync(cfg, enableNetCmd(t));
  }

  const preset = detectEmulator(exe).find((d) => d.platform === platform);
  const conf = { path: exe, args: preset?.args || '"{rom}"', name: preset?.emulator || E.name, installed: emuId };
  step('done', { label: `${E.name} prêt` });
  return { conf, dir, exe, version };
}

module.exports = { install, resolveSource, findFile };

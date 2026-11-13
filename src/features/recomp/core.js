// RECOMP — logique pure (testable) de la boutique : catalogue, choix de l'archive Windows d'une release GitHub,
// lecture de l'en-tête des ROMs (N64, GameCube) pour vérifier la copie du joueur, exécutable principal.
'use strict';
const fs = require('fs');
const path = require('path');

const BUNDLED = require('./recomps.json');
const REMOTE_URL = process.env.RR_RECOMP_CATALOG || 'https://raw.githubusercontent.com/RobinRahoual/RR-Launcher/main/src/features/recomp/recomps.json';
const PLACES = ['copy', 'select', 'installer'];

// Entrée valide : id simple, dépôt « owner/repo », règle ROM connue
function valid(e) {
  return !!(e && /^[a-z0-9][a-z0-9-]{1,40}$/.test(e.id) && typeof e.name === 'string' && /^[\w.-]+\/[\w.-]+$/.test(e.repo || '')
    && e.rom && PLACES.includes(e.rom.place) && (e.rom.place !== 'copy' || ['n64', 'gc', 'file'].includes(e.rom.system))
    && (!e.rom.target || (!path.isAbsolute(e.rom.target) && !e.rom.target.split(/[\\/]/).includes('..'))));
}
// Catalogue embarqué + catalogue distant (le distant gagne, entrée par entrée)
function merge(remote) {
  const out = new Map(BUNDLED.recomps.filter(valid).map((e) => [e.id, e]));
  for (const e of remote?.recomps || []) if (valid(e)) out.set(e.id, e);
  return [...out.values()];
}

// Archive Windows d'une release : on écarte sources, symboles, autres OS ; on préfère zip/7z « windows / win64 / x64 »
function scoreAsset(name) {
  const n = name.toLowerCase();
  if (!/\.(zip|7z)$/.test(n)) return -1;
  if (/linux|appimage|flatpak|mac|osx|darwin|android|switch|arm64|aarch64|debug|symbol|pdb|source|src\b/.test(n)) return -1;
  let s = 1;
  if (/windows|win64|win-?x64|msvc|\bwin\b|-win\.|_win\./.test(n)) s += 4;
  if (/x64|x86_64|amd64/.test(n)) s += 1;
  if (/win32|x86(?!_64)|i686/.test(n)) s -= 2;
  if (n.endsWith('.zip')) s += 0.5;
  return s;
}
function pickAsset(release) {
  let best = null, bs = 0;
  for (const a of release?.assets || []) { const s = scoreAsset(a.name); if (s > bs) { bs = s; best = a; } }
  return bs >= 3 ? best : null; // il faut au moins un indice « Windows »
}

// ---- ROMs
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n)).replace(/\0.*$/, '').trim();
const REGIONS = { E: 'USA', P: 'Europe', J: 'Japon', D: 'Allemagne', F: 'France', S: 'Espagne', I: 'Italie', U: 'Australie', X: 'Europe', Y: 'Europe', A: 'Asie', K: 'Corée', B: 'Brésil' };
// En-tête N64 (0x40 octets) dans les trois ordres d'octets : .z64 (grand-boutiste), .v64 (octets permutés), .n64 (petit-boutiste)
function n64Header(buf) {
  if (!buf || buf.length < 0x40) return null;
  const b = Buffer.from(buf.subarray(0, 0x40));
  const magic = b.readUInt32BE(0);
  let order;
  if (magic === 0x80371240) order = 'z64';
  else if (magic === 0x37804012) { order = 'v64'; for (let i = 0; i < 0x40; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; } }
  else if (magic === 0x40123780) { order = 'n64'; for (let i = 0; i < 0x40; i += 4) b.subarray(i, i + 4).reverse(); }
  else return null;
  const code = ascii(b, 0x3b, 4);
  return { order, title: ascii(b, 0x20, 20), code, region: REGIONS[code[3]] || code[3] || '?', version: b[0x3f] };
}
// Disque GameCube : identifiant (GZ2E…) dans les 6 premiers octets, nom à 0x20, mot magique 0xC2339F3D à 0x1C
function gcHeader(buf) {
  if (!buf || buf.length < 0x60 || buf.readUInt32BE(0x1c) !== 0xc2339f3d) return null;
  const code = ascii(buf, 0, 4);
  return { code, title: ascii(buf, 0x20, 0x40), region: REGIONS[code[3]] || '?' };
}

// → { ok, warn?, error?, info? } ; ok = utilisable ; warn = reconnu mais pas la version conseillée
async function checkRom(file, rule, fsp = fs.promises) {
  if (!rule || rule.system === 'folder') return { ok: true };
  let fd;
  try {
    fd = await fsp.open(file, 'r');
    const { size } = await fd.stat();
    const buf = Buffer.alloc(0x80);
    await fd.read(buf, 0, 0x80, 0);
    const re = rule.codes ? new RegExp(rule.codes) : null;
    if (rule.system === 'n64') {
      const h = n64Header(buf);
      if (!h) return { ok: false, error: 'Ce fichier n’est pas une ROM Nintendo 64.' };
      const info = `${h.title || 'ROM N64'} (${h.region}, ${h.code})`;
      if (re && !re.test(h.code)) {
        // même jeu, autre région ? (3 premiers caractères du code)
        const same = rule.codes.replace(/^\^|\$$/g, '').slice(0, 3);
        if (/^[A-Z0-9]{3}$/.test(same) && h.code.startsWith(same)) return { ok: true, warn: `Version ${h.region} : la recomp attend ${rule.label}. Elle risque de refuser cette ROM.`, info, header: h };
        return { ok: false, error: `Ce n’est pas le bon jeu : ${info}. Attendu : ${rule.label}.`, info };
      }
      return { ok: true, info, header: h, size };
    }
    if (rule.system === 'gc') {
      const h = gcHeader(buf);
      if (!h) return /\.(rvz|wia|ciso|gcz|nkit\.iso)$/i.test(file) ? { ok: true, warn: 'Image compressée : impossible de vérifier le jeu. Une image .iso complète est conseillée.' } : { ok: false, error: 'Ce fichier n’est pas une image de disque GameCube.' };
      const info = `${h.title} (${h.region}, ${h.code})`;
      if (re && !re.test(h.code)) return h.code.slice(0, 3) === rule.codes.replace(/^\^/, '').slice(0, 3) ? { ok: true, warn: `Version ${h.region} : la recomp attend ${rule.label}.`, info } : { ok: false, error: `Ce n’est pas le bon jeu : ${info}. Attendu : ${rule.label}.`, info };
      return { ok: true, info };
    }
    return { ok: size > 0 };
  } catch (e) {
    return { ok: false, error: `Lecture impossible : ${e.message}` };
  } finally { await fd?.close().catch(() => {}); }
}

// Exécutable principal d'un dossier de recomp : nom imposé (entry.exe) sinon le plus gros .exe hors outils
const NOT_GAME = /unins|crash|vc_?redist|vcredist|update|setup|install|helper|dxsetup|7z|launcher-?helper|elevate|dotnet/i;
function findExe(dir, want = null, depth = 3) {
  const found = [];
  const walk = (d, lvl) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (lvl < depth && !/^(mods|saves?|cache|shaders?|assets|data)$/i.test(e.name)) walk(p, lvl + 1); continue; }
      if (!/\.exe$/i.test(e.name)) continue;
      if (want ? new RegExp(want, 'i').test(e.name) : !NOT_GAME.test(e.name)) { let size = 0; try { size = fs.statSync(p).size; } catch {} found.push({ p, size, lvl }); }
    }
  };
  walk(dir, 0);
  found.sort((a, b) => a.lvl - b.lvl || b.size - a.size);
  return found[0]?.p || null;
}
// Dossier racine d'une archive extraite : on descend tant qu'il n'y a qu'un seul dossier
function contentRoot(dir) {
  let d = dir;
  for (let i = 0; i < 3; i++) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }).filter((e) => !/^(__MACOSX|\.DS_Store)$/.test(e.name)); } catch { break; }
    if (ents.length === 1 && ents[0].isDirectory()) d = path.join(d, ents[0].name); else break;
  }
  return d;
}

module.exports = { BUNDLED, REMOTE_URL, valid, merge, scoreAsset, pickAsset, n64Header, gcHeader, checkRom, findExe, contentRoot };

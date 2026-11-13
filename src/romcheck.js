// Vérification des ROMs par leur contenu (signature / en-tête) pour ne pas importer des fichiers
// qui ont seulement la bonne extension (.md = Markdown, .wad = Doom, .vpk = Valve, .pkg = macOS, .iso = Windows…).
// checkRom(file, ext, hintPlatform) → id de plateforme, null (pas une ROM) ou 'unknown' (impossible à dire).
const fs = require('fs');
const fsp = fs.promises;

async function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fd.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}
const ascii = (b, from, len) => b.subarray(from, from + len).toString('latin1');
const has = (b, off, bytes) => b.length >= off + bytes.length && bytes.every((x, i) => b[off + i] === x);

// Logo Nintendo (début) — Game Boy à 0x104, GBA à 0x04, DS à 0xC0
const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];
const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];

// ---------------------------------------------------------------- ISO 9660 (PS1 / PS2 / PSP)
// sectorSize 2048 (.iso) ou 2352 (.bin brut Mode 2, données à +24)
async function isoRootNames(fd, sectorSize = 2048, dataOff = 0) {
  const sec = (n) => n * sectorSize + dataOff;
  const pvd = await readAt(fd, sec(16), 2048);
  if (pvd.length < 2048 || pvd[0] !== 1 || ascii(pvd, 1, 5) !== 'CD001') return null;
  const rootLba = pvd.readUInt32LE(156 + 2), rootLen = Math.min(pvd.readUInt32LE(156 + 10), 64 * 1024);
  const names = [];
  for (let read = 0; read < rootLen; read += 2048) {
    const d = await readAt(fd, sec(rootLba + read / 2048), 2048);
    for (let i = 0; i < d.length;) {
      const len = d[i];
      if (!len) break;
      const nl = d[i + 32];
      names.push({ name: ascii(d, i + 33, nl).replace(/;1$/, '').toUpperCase(), lba: d.readUInt32LE(i + 2), size: d.readUInt32LE(i + 10) });
      i += len;
    }
  }
  return { names, sec, volume: ascii(pvd, 40, 32).trim() };
}
async function isoPlatform(fd, sectorSize, dataOff) {
  const r = await isoRootNames(fd, sectorSize, dataOff).catch(() => null);
  if (!r) return null;
  const find = (n) => r.names.find((x) => x.name === n);
  if (find('PSP_GAME') || find('UMD_DATA.BIN')) return 'psp';
  const cnf = find('SYSTEM.CNF');
  if (cnf) {
    const t = ascii(await readAt(fd, r.sec(cnf.lba), Math.min(cnf.size, 512)), 0, 512);
    if (/BOOT2\s*=/i.test(t)) return 'ps2';
    if (/BOOT\s*=/i.test(t)) return 'ps1';
  }
  if (find('PS3_GAME') || find('PS3_DISC.SFB')) return 'ps3';
  return 'iso9660'; // ISO « PC » (Windows, logiciels…) : pas une ROM
}

/**
 * @param {string} file chemin
 * @param {string} ext extension en minuscules
 * @param {string|null} hint plateforme suggérée par le dossier (PS2, GameCube…)
 */
async function checkRom(file, ext, hint = null) {
  let fd;
  try {
    fd = await fsp.open(file, 'r');
    const size = (await fd.stat()).size;
    const head = await readAt(fd, 0, 0x220);
    const at = async (pos, len) => readAt(fd, pos, len);
    switch (ext) {
      // ---- Nintendo cartouches
      case 'nes': return has(head, 0, [0x4e, 0x45, 0x53, 0x1a]) ? 'nes' : null;
      case 'unf': case 'unif': return ascii(head, 0, 4) === 'UNIF' ? 'nes' : null;
      case 'fds': return ascii(head, 0, 3) === 'FDS' || ascii(head, 1, 14) === '*NINTENDO-HVC*' ? 'nes' : null;
      case 'gb': case 'gbc': case 'sgb': return has(head, 0x104, GB_LOGO) ? 'gb' : null;
      case 'gba': return has(head, 0x04, GBA_LOGO) ? 'gba' : null;
      case 'nds': case 'dsi': return has(head, 0xc0, GBA_LOGO) || (size >= 128 * 1024 && size % 1024 === 0 && hint === 'nds') ? 'nds' : null;
      case 'n64': case 'z64': case 'v64': {
        const m = head.readUInt32BE(0);
        return [0x80371240, 0x37804012, 0x40123780, 0x80270740].includes(m) ? 'n64' : null;
      }
      case 'sfc': case 'smc': case 'fig': case 'swc': {
        // pas de signature fixe : taille multiple de 32 Ko (± en-tête copieur de 512 o) et ≥ 128 Ko
        const s = size % 1024 === 512 ? size - 512 : size;
        return s >= 128 * 1024 && s % (32 * 1024) === 0 ? 'snes' : null;
      }
      // ---- Sega
      case 'md': case 'gen': case 'bin': case '68k': case 'sgd': {
        if (ascii(head, 0x100, 4) === 'SEGA' || ascii(head, 0x101, 4) === 'SEGA') return 'md';
        if (ext !== 'bin') return null;
        // .bin d'image CD (PS1 / Saturn…) : seulement avec une piste en Mode 2 lisible
        if (has(head, 0, [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00])) {
          const p = await isoPlatform(fd, 2352, 24);
          if (p === 'ps1' || p === 'ps2') return p;
          if (p) return hint === 'ps1' ? 'ps1' : null;
        }
        return null;
      }
      case 'smd': return size >= 128 * 1024 && (size - 512) % 16384 === 0 && (head[8] === 0xaa && head[9] === 0xbb || hint === 'md') ? 'md' : null;
      case 'gdi': return /^\s*\d+\s*\r?\n\s*1\s+0\s+4\s+2352/.test(ascii(head, 0, 200)) ? 'dc' : null;
      case 'cdi': return size > 20 * 1024 * 1024 && (hint === 'dc' || !hint) ? 'dc' : null;
      // ---- Nintendo disques / numériques
      case 'gcm': return head.readUInt32BE(0x1c) === 0xc2339f3d ? 'gc' : null;
      case 'gcz': return head.readUInt32LE(0) === 0xb10bc001 ? (hint === 'wii' ? 'wii' : 'gc') : null;
      case 'rvz': case 'wia': {
        if (!['RVZ\x01', 'WIA\x01'].includes(ascii(head, 0, 4))) return null;
        const disc = await at(0x58, 0x20); // en-tête disque recopié dans le fichier RVZ/WIA
        if (disc.length >= 0x20 && disc.readUInt32BE(0x18) === 0x5d1c9ea3) return 'wii';
        if (disc.length >= 0x20 && disc.readUInt32BE(0x1c) === 0xc2339f3d) return 'gc';
        return hint === 'wii' ? 'wii' : 'gc';
      }
      case 'ciso': return ascii(head, 0, 4) === 'CISO' ? (hint === 'wii' ? 'wii' : 'gc') : null;
      case 'wbfs': return ascii(head, 0, 4) === 'WBFS' ? 'wii' : null;
      case 'wad': return has(head, 0, [0x00, 0x00, 0x00, 0x20]) && ['Is', 'ib', 'Bk'].includes(ascii(head, 4, 2)) ? 'wii' : null; // pas les WAD de Doom (IWAD/PWAD)
      case 'nsp': case 'nsz': return ascii(head, 0, 4) === 'PFS0' ? 'switch' : null;
      case 'xci': case 'xcz': return ascii(head, 0x100, 4) === 'HEAD' ? 'switch' : null;
      case '3ds': case 'cci': return ascii(head, 0x100, 4) === 'NCSD' ? '3ds' : null;
      case 'cxi': return ascii(head, 0x100, 4) === 'NCCH' ? '3ds' : null;
      case 'cia': return head.readUInt32LE(0) === 0x2020 ? '3ds' : null;
      case '3dsx': return ascii(head, 0, 4) === '3DSX' ? '3ds' : null;
      case 'wux': return ascii(head, 0, 4) === 'WUX0' ? 'wiiu' : null;
      case 'wud': return size > 1024 ** 3 ? 'wiiu' : null;
      case 'wua': return size > 1024 * 1024 ? 'wiiu' : null;
      case 'rpx': return ascii(head, 1, 3) === 'ELF' && /[\\/]code[\\/][^\\/]+$/i.test(file) ? 'wiiu' : null;
      // ---- Sony
      case 'pbp': {
        if (ascii(head, 0, 4) !== '\0PBP') return null;
        const psarOff = head.readUInt32LE(0x24);
        const psar = await at(psarOff, 8);
        return ascii(psar, 0, 8) === 'PSISOIMG' || ascii(psar, 0, 8) === 'PSTITLEI' ? 'ps1' : 'psp';
      }
      case 'cso': case 'zso': return ['CISO', 'ZISO'].includes(ascii(head, 0, 4)) ? (hint === 'ps2' ? 'ps2' : 'psp') : null;
      case 'pkg': return has(head, 0, [0x7f, 0x50, 0x4b, 0x47]) ? 'ps3' : null; // pas les .pkg macOS (xar!) ni PS4 (\x7FCNT)
      case 'vpk': return has(head, 0, [0x50, 0x4b, 0x03, 0x04]) ? 'vita' : null; // Vita = zip ; les VPK Valve commencent par 34 12 AA 55
      // ---- Microsoft
      case 'xex': return ascii(head, 0, 4) === 'XEX2' ? 'x360' : null;
      case 'xiso': {
        const m = await at(0x10000, 20);
        return ascii(m, 0, 20) === 'MICROSOFT*XBOX*MEDIA' ? (hint === 'x360' ? 'x360' : 'xbox') : null;
      }
      // ---- Images disque génériques
      case 'iso': {
        if (head.length >= 0x20 && head.readUInt32BE(0x18) === 0x5d1c9ea3) return 'wii';
        if (head.length >= 0x20 && head.readUInt32BE(0x1c) === 0xc2339f3d) return 'gc';
        const x = await at(0x10000, 20);
        if (ascii(x, 0, 20) === 'MICROSOFT*XBOX*MEDIA') return hint === 'x360' ? 'x360' : 'xbox';
        const x2 = await at(0xfd90000, 20); // XGD2 (Xbox 360) / XGD3
        if (ascii(x2, 0, 20) === 'MICROSOFT*XBOX*MEDIA') return 'x360';
        const p = await isoPlatform(fd, 2048, 0);
        if (p && p !== 'iso9660') return p;
        if (p === 'iso9660') return ['ps1', 'ps2', 'psp', 'dc'].includes(hint) ? hint : null; // ISO de logiciel PC
        return hint || null;
      }
      case 'img': case 'mdf': {
        const p = await isoPlatform(fd, 2352, 24).catch(() => null) || await isoPlatform(fd, 2352, 16).catch(() => null);
        if (p === 'ps1' || p === 'ps2') return p;
        return hint === 'ps1' || hint === 'ps2' ? hint : null;
      }
      case 'cue': {
        if (size > 64 * 1024) return null;
        const t = ascii(await at(0, Math.min(size, 16 * 1024)), 0, 16 * 1024);
        const m = t.match(/^\s*FILE\s+"(.+?)"\s+BINARY/im);
        if (!m) return null;
        // on regarde la 1re piste (.bin) : PS1 / PS2 si SYSTEM.CNF, sinon le dossier décide
        const bin = require('path').resolve(require('path').dirname(file), m[1]);
        let fd2;
        try {
          fd2 = await fsp.open(bin, 'r');
          const p = await isoPlatform(fd2, 2352, 24);
          if (p === 'ps1' || p === 'ps2') return p;
          if (p === 'iso9660') return hint || 'unknown';
        } catch { /* piste absente */ } finally { await fd2?.close().catch(() => {}); }
        return hint || 'unknown';
      }
      case 'ccd': case 'm3u': {
        if (size > 64 * 1024) return null;
        const t = ascii(await at(0, Math.min(size, 16 * 1024)), 0, 16 * 1024);
        if (ext === 'cue' && !/^\s*FILE\s+".+"\s+BINARY/im.test(t)) return null;
        if (ext === 'ccd' && !/\[CloneCD\]/i.test(t)) return null;
        if (ext === 'm3u' && !/\.(cue|chd|ccd|iso|cdi|gdi|m3u|pbp|img)\s*$/im.test(t)) return null; // pas les playlists audio
        return hint || 'unknown';
      }
      case 'chd': return ascii(head, 0, 8) === 'MComprHD' ? hint || 'unknown' : null;
      default: return hint || null;
    }
  } catch {
    return null;
  } finally {
    await fd?.close().catch(() => {});
  }
}

module.exports = { checkRom, isoPlatform };

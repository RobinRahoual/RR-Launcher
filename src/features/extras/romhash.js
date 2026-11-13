// EXTRAS — empreintes RetroAchievements des ROMs « cartouche ».
// RA identifie un jeu par un MD5 calculé selon des règles propres à chaque console (rcheevos / rc_hash) :
//   NES      : sans l'en-tête iNES « NES\x1A » (16 o) ou FDS « FDS\x1A » (16 o)
//   SNES     : sans l'en-tête de copieur de 512 o (taille % 8192 === 512)
//   N64      : ROM normalisée en big-endian (.z64 80 37 12 40) — .v64 (37 80 40 12) octets permutés 2 à 2,
//              .n64 (40 12 37 80) mots de 32 bits inversés
//   GB / GBC / GBA / Mega Drive : MD5 du fichier entier
// Non gérés (association manuelle par ID de jeu RA dans la page du jeu) : consoles disque (PS1, PS2, PSP, Dreamcast,
// GameCube, Wii…, hachage du contenu du disque), Nintendo DS (hachage partiel spécifique), fichiers .smd entrelacés,
// archives .zip / .7z.
'use strict';
const crypto = require('crypto');

// ID de console RetroAchievements (API_GetConsoleIDs)
const RA_CONSOLE = { md: 1, n64: 2, snes: 3, gb: 4, gba: 5, gbc: 6, nes: 7 };

/** Console RA d'une ROM (null si l'empreinte n'est pas calculable ici). */
function raConsoleFor(platform, file = '') {
  const ext = String(file).toLowerCase().split('.').pop();
  if (['zip', '7z', 'rar', 'smd'].includes(ext)) return null;
  if (platform === 'gb') return ext === 'gbc' ? RA_CONSOLE.gbc : RA_CONSOLE.gb;
  if (platform === 'nes' && ext === 'fds') return null; // FDS : console RA distincte (81), non gérée
  return RA_CONSOLE[platform] || null;
}

function swap16(b) { const o = Buffer.allocUnsafe(b.length - (b.length % 2)); for (let i = 0; i < o.length; i += 2) { o[i] = b[i + 1]; o[i + 1] = b[i]; } return o; }
function swap32(b) { const o = Buffer.allocUnsafe(b.length - (b.length % 4)); for (let i = 0; i < o.length; i += 4) { o[i] = b[i + 3]; o[i + 1] = b[i + 2]; o[i + 2] = b[i + 1]; o[i + 3] = b[i]; } return o; }

/** Données réellement hachées par RA pour cette console. */
function normalizeRom(consoleId, buf) {
  if (consoleId === RA_CONSOLE.nes) {
    if (buf.length > 16 && buf[0] === 0x4e && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1a) return buf.subarray(16);
    if (buf.length > 16 && buf[0] === 0x46 && buf[1] === 0x44 && buf[2] === 0x53 && buf[3] === 0x1a) return buf.subarray(16);
    return buf;
  }
  if (consoleId === RA_CONSOLE.snes) return buf.length % 8192 === 512 ? buf.subarray(512) : buf;
  if (consoleId === RA_CONSOLE.n64 && buf.length >= 4) {
    if (buf[0] === 0x80) return buf; // z64 : big-endian natif
    if (buf[0] === 0x37) return swap16(buf); // v64
    if (buf[0] === 0x40) return swap32(buf); // n64 (little-endian)
    return buf;
  }
  return buf;
}

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
/** MD5 RA d'un buffer de ROM pour une console RA donnée. */
function raHash(consoleId, buf) { return md5(normalizeRom(consoleId, buf)); }

module.exports = { RA_CONSOLE, raConsoleFor, normalizeRom, raHash, md5 };

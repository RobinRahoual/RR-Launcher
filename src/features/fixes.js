// Module FIXES (main) — correctifs 1.9 : vidéos, musique, bannières de l'accueil.
//  - serveFile(req, full) : réponse rr:// avec prise en charge de Range (206) pour <video>/<audio> (utilisé par main.js) ;
//  - migration unique : musique d'ambiance activée (réglage fixesMusicV1) ;
//  - x:fixes:sizes : dimensions des images des jeux / des consoles (lecture des en-têtes, sans décodage) ;
//  - photos de consoles téléchargées en basse définition (< 1000 px) : un nouvel essai en plus grand (une fois).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
};
const isStream = (full) => !!MIME[path.extname(full).toLowerCase()];

/** Réponse pour un fichier audio / vidéo, avec Range : Chromium lit, boucle et cherche sans tout recharger. */
function serveFile(req, full) {
  const size = fs.statSync(full).size;
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (!m || (!m[1] && !m[2])) {
    return new Response(Readable.toWeb(fs.createReadStream(full)), { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(full, { start, end })), {
    status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

/** Dimensions d'une image (PNG, JPEG, WebP, GIF) depuis son en-tête. → { w, h, alpha } | null */
function imageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const b = buf.subarray(0, n);
    if (b.length > 26 && b.readUInt32BE(0) === 0x89504e47) {
      const ct = b[25];
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: ct === 4 || ct === 6 || b.includes(Buffer.from('tRNS')) };
    }
    if (b.length > 10 && b.toString('latin1', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), alpha: true };
    if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const k = b.toString('latin1', 12, 16);
      if (k === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
      if (k === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, alpha: !!((v >> 28) & 1) }; }
      if (k === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: !!(b[20] & 0x10) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        const mk = b[p + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { p += mk === 0xff ? 1 : 2; continue; }
        const len = b.readUInt16BE(p + 2);
        if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5), alpha: false };
        p += 2 + len;
      }
    }
  } catch { /* illisible */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
  return null;
}

function init(ctx) {
  const { ipcMain, store, MEDIA, meta, log } = ctx;
  const s = store.data.settings;
  // ---- Volumes par défaut trop forts (1.20.1) : une fois, on baisse les valeurs restées à l'ancien défaut
  if (!s.volumeV2) {
    if (s.volume === undefined || Number(s.volume) === 0.7) s.volume = 0.35;
    if (s.mediaMusicVolume === undefined || String(s.mediaMusicVolume) === '0.3') s.mediaMusicVolume = '0.12';
    if (s.mediaVideoVolume === undefined || String(s.mediaVideoVolume) === '0.6') s.mediaVideoVolume = '0.3';
    s.volumeV2 = true;
    store.save();
  }
  // ---- Musique d'ambiance : activée par défaut (1.9) ; une seule fois pour les installations existantes
  if (!s.fixesMusicV1) {
    s.mediaMusic = true;
    if (s.mediaMusicVolume === undefined) s.mediaMusicVolume = '0.12';
    s.fixesMusicV1 = true;
    store.save();
  }

  // ---- Dimensions des images (cache : chemin + date de modification)
  const cache = new Map();
  const sizeOf = (full) => {
    let st; try { st = fs.statSync(full); } catch { return null; }
    const k = full + '|' + st.mtimeMs;
    if (!cache.has(k)) cache.set(k, imageSize(full));
    return cache.get(k);
  };
  const PLAT = path.join(MEDIA, '_platforms');
  ipcMain.handle('x:fixes:sizes', () => {
    const games = {};
    for (const g of store.data.games) {
      const files = new Set([g.media?.hero, g.media?.header, g.media?.cover, ...(g.screenshots || [])].filter(Boolean));
      const o = {};
      for (const f of files) { const d = sizeOf(path.join(MEDIA, path.basename(g.id), path.basename(f))); if (d) o[f] = d; }
      games[g.id] = o;
    }
    const plats = {};
    for (const [id, f] of Object.entries(store.data.settings.platformImages || {})) {
      const d = typeof f === 'string' && sizeOf(path.join(PLAT, path.basename(f)));
      if (d) plats[id] = { file: f, ...d };
    }
    return { games, plats };
  });

  // ---- Photos de consoles trop petites : un essai en 1280 px (miniature Wikimedia plus grande), une fois par console
  setTimeout(async () => {
    let BY_ID;
    try { ({ BY_ID } = require('../platforms')); } catch { return; }
    const done = (s.fixesPlatHd ||= {});
    for (const [id, f] of Object.entries({ ...(s.platformImages || {}) })) {
      if (done[id] || typeof f !== 'string' || f.includes('-custom-') || !BY_ID[id]?.wiki || ctx.running.size) continue;
      const before = sizeOf(path.join(PLAT, f));
      done[id] = Date.now();
      if (!before || before.w >= 1000) continue;
      try {
        const nf = await meta.platformImage(BY_ID[id].wiki, PLAT, id + '-hd', { minWidth: 1280 });
        const after = nf && sizeOf(path.join(PLAT, nf));
        if (after && after.w > before.w) { s.platformImages[id] = nf; log(`console ${id} : photo ${before.w}px → ${after.w}px`); ctx.commit(); }
        else if (nf && nf !== f) fs.rmSync(path.join(PLAT, nf), { force: true });
      } catch (e) { log(`console ${id} : photo HD : ${e.message}`); }
    }
    store.save();
  }, 30000);
}

module.exports = { init, serveFile, isStream, imageSize };

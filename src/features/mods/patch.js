// MODS — application de patchs ROM (IPS, BPS, UPS). Fonctions pures sur des Buffer : la ROM d'origine n'est jamais modifiée.
'use strict';

const crc32 = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

function kind(patch) {
  const h = patch.subarray(0, 5).toString('latin1');
  if (h === 'PATCH') return 'ips';
  if (h.startsWith('BPS1')) return 'bps';
  if (h.startsWith('UPS1')) return 'ups';
  return null;
}

// ---- IPS : « PATCH », enregistrements (offset 3 o, taille 2 o, données | RLE si taille 0), « EOF », troncature facultative (3 o)
function applyIps(rom, patch) {
  if (kind(patch) !== 'ips') throw new Error('Ce n’est pas un patch IPS');
  let out = Buffer.from(rom);
  const ensure = (n) => { if (n > out.length) { const b = Buffer.alloc(n); out.copy(b); out = b; } };
  let p = 5;
  for (;;) {
    if (p + 3 > patch.length) throw new Error('Patch IPS tronqué');
    if (patch.subarray(p, p + 3).toString('latin1') === 'EOF') { p += 3; break; }
    const off = patch.readUIntBE(p, 3); p += 3;
    if (p + 2 > patch.length) throw new Error('Patch IPS tronqué');
    const size = patch.readUInt16BE(p); p += 2;
    if (size === 0) {
      if (p + 3 > patch.length) throw new Error('Patch IPS tronqué');
      const run = patch.readUInt16BE(p), val = patch[p + 2]; p += 3;
      ensure(off + run); out.fill(val, off, off + run);
    } else {
      if (p + size > patch.length) throw new Error('Patch IPS tronqué');
      ensure(off + size); patch.copy(out, off, p, p + size); p += size;
    }
  }
  if (p + 3 <= patch.length) out = out.subarray(0, patch.readUIntBE(p, 3)); // extension « Lunar IPS » : taille finale
  return Buffer.from(out);
}

// ---- BPS (byuu) : en-tête « BPS1 », tailles en entiers variables, actions, puis CRC32 source / cible / patch
function varint(buf, st) {
  let data = 0, shift = 1;
  for (;;) {
    if (st.p >= buf.length) throw new Error('Patch BPS tronqué');
    const x = buf[st.p++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) break;
    shift *= 128; data += shift;
  }
  return data;
}
function applyBps(rom, patch, { verify = true } = {}) {
  if (kind(patch) !== 'bps') throw new Error('Ce n’est pas un patch BPS');
  if (patch.length < 4 + 3 + 12) throw new Error('Patch BPS tronqué');
  const end = patch.length - 12;
  const srcCrc = patch.readUInt32LE(end), tgtCrc = patch.readUInt32LE(end + 4), patCrc = patch.readUInt32LE(end + 8);
  if (verify && crc32(patch.subarray(0, patch.length - 4)) !== patCrc) throw new Error('Patch BPS corrompu (CRC32 du patch)');
  if (verify && crc32(rom) !== srcCrc) throw new Error('Ce patch ne correspond pas à cette ROM (CRC32 de la ROM différent)');
  const st = { p: 4 };
  const srcSize = varint(patch, st), tgtSize = varint(patch, st), metaSize = varint(patch, st);
  if (srcSize !== rom.length) throw new Error(`Taille de ROM inattendue (${rom.length} octets, ${srcSize} attendus)`);
  st.p += metaSize;
  const out = Buffer.alloc(tgtSize);
  let o = 0, srcRel = 0, tgtRel = 0;
  while (st.p < end) {
    const d = varint(patch, st);
    const len = (d >>> 2) + 1, type = d & 3;
    if (o + len > tgtSize) throw new Error('Patch BPS invalide (dépasse la taille cible)');
    if (type === 0) { // SourceRead
      for (let i = 0; i < len; i++, o++) out[o] = o < rom.length ? rom[o] : 0;
    } else if (type === 1) { // TargetRead : octets du patch
      if (st.p + len > end) throw new Error('Patch BPS tronqué');
      patch.copy(out, o, st.p, st.p + len); st.p += len; o += len;
    } else {
      const v = varint(patch, st);
      const delta = (v & 1 ? -1 : 1) * (v >>> 1);
      if (type === 2) { srcRel += delta; for (let i = 0; i < len; i++, o++) out[o] = rom[srcRel++] ?? 0; } // SourceCopy
      else { tgtRel += delta; for (let i = 0; i < len; i++, o++) out[o] = out[tgtRel++]; } // TargetCopy (peut se recouvrir)
    }
  }
  if (verify && crc32(out) !== tgtCrc) throw new Error('Résultat invalide (CRC32 de la ROM patchée)');
  return out;
}

// ---- UPS : « UPS1 », tailles source / cible (variables), XOR par blocs, CRC32 en fin
function applyUps(rom, patch, { verify = true } = {}) {
  if (kind(patch) !== 'ups') throw new Error('Ce n’est pas un patch UPS');
  if (patch.length < 4 + 2 + 12) throw new Error('Patch UPS tronqué');
  const end = patch.length - 12;
  const srcCrc = patch.readUInt32LE(end), tgtCrc = patch.readUInt32LE(end + 4), patCrc = patch.readUInt32LE(end + 8);
  if (verify && crc32(patch.subarray(0, patch.length - 4)) !== patCrc) throw new Error('Patch UPS corrompu (CRC32 du patch)');
  const st = { p: 4 };
  const srcSize = varint(patch, st), tgtSize = varint(patch, st);
  const reverse = verify && crc32(rom) === tgtCrc && crc32(rom) !== srcCrc; // patch appliqué à l'envers : on le refuse
  if (reverse) throw new Error('Cette ROM est déjà patchée');
  if (verify && crc32(rom) !== srcCrc) throw new Error('Ce patch ne correspond pas à cette ROM (CRC32 de la ROM différent)');
  if (srcSize !== rom.length) throw new Error(`Taille de ROM inattendue (${rom.length} octets, ${srcSize} attendus)`);
  const out = Buffer.alloc(tgtSize);
  rom.copy(out, 0, 0, Math.min(rom.length, tgtSize));
  let o = 0;
  while (st.p < end) {
    o += varint(patch, st);
    for (;;) {
      if (st.p >= end) throw new Error('Patch UPS tronqué');
      const x = patch[st.p++];
      if (o < tgtSize) out[o] ^= x;
      o++;
      if (x === 0) break;
    }
  }
  if (verify && crc32(out) !== tgtCrc) throw new Error('Résultat invalide (CRC32 de la ROM patchée)');
  return out;
}

function apply(rom, patch, opts) {
  const k = kind(patch);
  if (k === 'ips') return applyIps(rom, patch);
  if (k === 'bps') return applyBps(rom, patch, opts);
  if (k === 'ups') return applyUps(rom, patch, opts);
  throw new Error('Format de patch non reconnu (IPS, BPS et UPS sont gérés)');
}

module.exports = { crc32, kind, apply, applyIps, applyBps, applyUps };

'use strict';
// Décodeur protobuf minimal (varint, 64 bits, longueur-délimité, 32 bits) — sert à lire product.db de Battle.net.
function readVarint(b, o) {
  let v = 0, mul = 1;
  for (let i = 0; i < 10; i++) {
    if (o + i >= b.length) return null;
    const c = b[o + i];
    v += (c & 0x7f) * mul; mul *= 128;
    if (!(c & 0x80)) return [v, o + i + 1];
  }
  return null;
}
// → [{ field, wire, value }] ; null si le tampon n'est pas un message valide jusqu'au bout (strict).
function decode(b) {
  const out = [];
  let o = 0;
  while (o < b.length) {
    const k = readVarint(b, o); if (!k) return null;
    const field = Math.floor(k[0] / 8), wire = k[0] % 8; o = k[1];
    if (!field) return null;
    if (wire === 0) { const v = readVarint(b, o); if (!v) return null; out.push({ field, wire, value: v[0] }); o = v[1]; }
    else if (wire === 1) { if (o + 8 > b.length) return null; out.push({ field, wire, value: b.subarray(o, o + 8) }); o += 8; }
    else if (wire === 5) { if (o + 4 > b.length) return null; out.push({ field, wire, value: b.subarray(o, o + 4) }); o += 4; }
    else if (wire === 2) {
      const l = readVarint(b, o); if (!l || l[1] + l[0] > b.length) return null;
      out.push({ field, wire, value: b.subarray(l[1], l[1] + l[0]) }); o = l[1] + l[0];
    } else return null;
  }
  return out;
}
const isText = (b) => Buffer.isBuffer(b) && b.length > 0 && !/[\x00-\x08\x0b-\x1f]/.test(b.toString('utf8')) && !b.toString('utf8').includes('\ufffd');
module.exports = { decode, readVarint, isText };

'use strict';
// Lecteur SQLite minimal EN LECTURE SEULE, en JS pur (aucun module natif, aucune dépendance).
// Gère : B-arbres de tables (feuilles + nœuds intérieurs), pages de débordement, texte UTF-8 / UTF-16,
// colonnes INTEGER PRIMARY KEY (alias du rowid) et le journal WAL (trames validées jusqu'au dernier commit ;
// les sommes de contrôle ne sont pas vérifiées, les « salts » le sont).
// Limites : pas de SQL (on lit une table entière), pas de tables WITHOUT ROWID, pas de bases chiffrées.

function varint(b, o) {
  let v = 0n;
  for (let i = 0; i < 9; i++) {
    const c = b[o + i];
    if (i === 8) { v = (v << 8n) | BigInt(c); return [Number(v), o + 9]; }
    v = (v << 7n) | BigInt(c & 0x7f);
    if (!(c & 0x80)) return [Number(v), o + i + 1];
  }
}

function open(buf, walBuf) {
  if (!buf || buf.length < 100 || buf.toString('latin1', 0, 15) !== 'SQLite format 3') throw new Error('Pas une base SQLite');
  let ps = buf.readUInt16BE(16); if (ps === 1) ps = 65536;
  const usable = ps - buf[20];
  const enc = buf.readUInt32BE(56) || 1;
  const overlay = new Map();
  let pageCount = buf.readUInt32BE(28) || Math.floor(buf.length / ps);
  if (walBuf && walBuf.length >= 32 && [0x377f0682, 0x377f0683].includes(walBuf.readUInt32BE(0)) && walBuf.readUInt32BE(8) === ps) {
    const s1 = walBuf.readUInt32BE(16), s2 = walBuf.readUInt32BE(20);
    const pending = [];
    for (let o = 32; o + 24 + ps <= walBuf.length; o += 24 + ps) {
      if (walBuf.readUInt32BE(o + 8) !== s1 || walBuf.readUInt32BE(o + 12) !== s2) break;
      pending.push([walBuf.readUInt32BE(o), walBuf.subarray(o + 24, o + 24 + ps)]);
      const commit = walBuf.readUInt32BE(o + 4);
      if (commit) { for (const [n, p] of pending) overlay.set(n, p); pending.length = 0; pageCount = commit; }
    }
  }
  const page = (n) => {
    if (n < 1 || n > pageCount) throw new Error('Page invalide ' + n);
    return overlay.get(n) || buf.subarray((n - 1) * ps, n * ps);
  };
  const text = (b) => (enc === 1 ? b.toString('utf8') : enc === 2 ? b.toString('utf16le') : Buffer.from(b).swap16().toString('utf16le'));

  function record(payload) {
    const [hdrLen, p0] = varint(payload, 0);
    const types = [];
    let p = p0;
    while (p < hdrLen) { const [t, n] = varint(payload, p); types.push(t); p = n; }
    const out = [];
    let o = hdrLen;
    for (const t of types) {
      if (t === 0) out.push(null);
      else if (t === 8) out.push(0);
      else if (t === 9) out.push(1);
      else if (t >= 1 && t <= 6) {
        const n = [0, 1, 2, 3, 4, 6, 8][t];
        let v = 0n;
        for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(payload[o + i]);
        const bits = BigInt(n * 8);
        if (v >> (bits - 1n)) v -= 1n << bits;
        out.push(Number(v)); o += n;
      } else if (t === 7) { out.push(payload.readDoubleBE(o)); o += 8; }
      else if (t >= 12) {
        const n = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
        const slice = payload.subarray(o, o + n);
        out.push(t % 2 === 0 ? Buffer.from(slice) : text(slice)); o += n;
      } else out.push(null);
    }
    return out;
  }

  function readLeafCell(pg, off) {
    const [size, a] = varint(pg, off);
    const [rowid, b] = varint(pg, a);
    const maxLocal = usable - 35;
    if (size <= maxLocal) return [rowid, pg.subarray(b, b + size)];
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const k = minLocal + ((size - minLocal) % (usable - 4));
    const local = k <= maxLocal ? k : minLocal;
    const parts = [pg.subarray(b, b + local)];
    let next = pg.readUInt32BE(b + local), left = size - local, guard = 0;
    while (next && left > 0 && guard++ < 100000) {
      const op = page(next), take = Math.min(left, usable - 4);
      parts.push(op.subarray(4, 4 + take)); left -= take; next = op.readUInt32BE(0);
    }
    return [rowid, Buffer.concat(parts)];
  }
  function walkRows(root, cb, depth = 0) {
    if (depth > 40) throw new Error('B-arbre trop profond');
    const pg = page(root);
    const h = root === 1 ? 100 : 0;
    const type = pg[h], n = pg.readUInt16BE(h + 3);
    if (type === 0x0d) {
      for (let i = 0; i < n; i++) { const [rowid, payload] = readLeafCell(pg, pg.readUInt16BE(h + 8 + i * 2)); cb(rowid, record(payload)); }
    } else if (type === 0x05) {
      for (let i = 0; i < n; i++) walkRows(pg.readUInt32BE(pg.readUInt16BE(h + 12 + i * 2)), cb, depth + 1);
      walkRows(pg.readUInt32BE(h + 8), cb, depth + 1);
    } else throw new Error('Type de page non géré 0x' + type.toString(16));
  }

  // Noms de colonnes depuis le CREATE TABLE
  function columns(sql) {
    const s = String(sql || '');
    const a = s.indexOf('('), z = s.lastIndexOf(')');
    if (a < 0 || z < a) return [];
    const parts = [];
    let depth = 0, cur = '', q = '';
    for (const ch of s.slice(a + 1, z)) {
      if (q) { cur += ch; if (ch === q) q = ''; continue; }
      if ('"\'`'.includes(ch)) { q = ch; cur += ch; continue; }
      if (ch === '[') { q = ']'; cur += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const cols = [];
    for (const p of parts) {
      if (/^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(p)) continue;
      const m = p.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|'([^']+)'|(\S+))\s*(.*)$/s);
      if (!m) continue;
      const rest = m[6] || '';
      cols.push({ name: m[1] || m[2] || m[3] || m[4] || m[5], ipk: /\binteger\b/i.test(rest) && /primary\s+key/i.test(rest) && !/desc/i.test(rest) });
    }
    return cols;
  }

  const master = [];
  walkRows(1, (rowid, r) => master.push({ type: r[0], name: r[1], tbl: r[2], root: r[3], sql: r[4] }));
  const tableDef = (name) => master.find((m) => m.type === 'table' && String(m.name).toLowerCase() === String(name).toLowerCase());
  return {
    tables: () => master.filter((m) => m.type === 'table').map((m) => m.name),
    columns: (name) => columns(tableDef(name)?.sql).map((c) => c.name),
    rows(name) {
      const t = tableDef(name);
      if (!t) return [];
      const cols = columns(t.sql);
      const out = [];
      walkRows(t.root, (rowid, r) => {
        const o = {};
        cols.forEach((c, i) => { o[c.name] = c.ipk && (r[i] == null) ? rowid : r[i] ?? null; });
        out.push(o);
      });
      return out;
    },
  };
}

function openFile(fs, file) {
  const buf = fs.readFileSync(file);
  let wal = null;
  try { wal = fs.readFileSync(file + '-wal'); } catch { /* pas de WAL */ }
  return open(buf, wal);
}

module.exports = { open, openFile };

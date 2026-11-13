// Fausse Gateway Discord pour les tests : petit serveur WebSocket (RFC 6455, trames texte non fragmentées)
// sans dépendance. Chaque connexion appelle onConnection(conn) ; conn.send(obj), conn.close(code), conn.on(fn).
'use strict';
const http = require('http');
const crypto = require('crypto');

function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len])
    : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}

function startFakeGateway(onConnection) {
  const server = http.createServer((_q, r) => { r.writeHead(426); r.end(); });
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const listeners = [];
    let buf = Buffer.alloc(0), closed = false;
    const conn = {
      url: req.url, received: [],
      send(obj) { if (!closed) socket.write(frame(1, Buffer.from(JSON.stringify(obj)))); },
      close(code = 1000) {
        if (closed) return; closed = true;
        const b = Buffer.alloc(2); b.writeUInt16BE(code);
        socket.write(frame(8, b)); setTimeout(() => socket.destroy(), 20);
      },
      on(fn) { listeners.push(fn); },
      get closed() { return closed; },
    };
    conns.add(conn);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, masked = buf[1] & 128;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const need = off + (masked ? 4 : 0) + len;
        if (buf.length < need) return;
        let data = buf.subarray(off + (masked ? 4 : 0), need);
        if (masked) { const m = buf.subarray(off, off + 4); data = Buffer.from(data.map((x, i) => x ^ m[i % 4])); }
        buf = buf.subarray(need);
        if (op === 8) { conn.clientClose = data.length >= 2 ? data.readUInt16BE(0) : 1005; if (!closed) { closed = true; socket.write(frame(8, data.subarray(0, 2))); socket.end(); } continue; }
        if (op === 9) { socket.write(frame(10, data)); continue; }
        if (op !== 1) continue;
        const msg = JSON.parse(data.toString('utf8'));
        conn.received.push(msg);
        for (const fn of listeners) fn(msg);
      }
    });
    socket.on('close', () => { closed = true; conns.delete(conn); });
    socket.on('error', () => {});
    onConnection(conn);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      url: `ws://127.0.0.1:${port}/?v=10&encoding=json`, base: `ws://127.0.0.1:${port}`,
      close: () => new Promise((r) => { for (const c of conns) c.close(1001); server.close(() => r()); setTimeout(r, 200); }),
    });
  }));
}

module.exports = { startFakeGateway };

// EMU — téléchargement avec progression, reprise (.part + Range), annulation et contrôle d'intégrité.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

function getFetch() {
  try { const n = require('electron').net; if (n?.fetch) return (u, o) => n.fetch(u, o); } catch {}
  return (u, o) => fetch(u, o);
}
const UA = { 'User-Agent': 'RR-Launcher', Accept: '*/*' };

async function json(url, { signal, fetchImpl = getFetch() } = {}) {
  const r = await fetchImpl(url, { headers: { ...UA, Accept: 'application/vnd.github+json' }, signal });
  if (!r.ok) throw new Error(r.status === 403 ? 'Limite de l’API GitHub atteinte, réessaie dans une heure' : `HTTP ${r.status} (${url})`);
  return r.json();
}
async function text(url, { signal, fetchImpl = getFetch() } = {}) {
  const r = await fetchImpl(url, { headers: UA, signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} (${url})`);
  return r.text();
}

// download(url, dest, { onProgress({ got, total }), signal, size, sha256 }) → { bytes }
async function download(url, dest, { onProgress = () => {}, signal, size, sha256, fetchImpl = getFetch() } = {}) {
  const part = dest + '.part';
  let have = 0;
  try { have = fs.statSync(part).size; } catch {}
  const headers = { ...UA };
  if (have > 0) headers.Range = `bytes=${have}-`;
  const r = await fetchImpl(url, { headers, signal, redirect: 'follow' });
  if (r.status === 416) { have = 0; try { fs.unlinkSync(part); } catch {} return download(url, dest, { onProgress, signal, size, sha256, fetchImpl }); }
  if (!r.ok) throw new Error(r.status === 404 ? `Fichier introuvable sur le serveur (${url})` : `Téléchargement impossible : HTTP ${r.status}`);
  const resumed = r.status === 206 && have > 0;
  if (!resumed) have = 0;
  const len = Number(r.headers.get('content-length')) || 0;
  const total = size || (len ? len + have : 0);
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let got = have, last = 0;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      const now = Date.now();
      if (now - last > 150) { last = now; onProgress({ got, total }); }
    }
  } finally { await new Promise((res) => out.end(res)); }
  onProgress({ got, total });
  if (total && got !== total) throw new Error(`Téléchargement incomplet (${got} / ${total} octets) — relance pour reprendre`);
  if (sha256) {
    const h = await hashFile(part);
    if (h !== sha256.toLowerCase()) { try { fs.unlinkSync(part); } catch {} throw new Error('Fichier corrompu (empreinte SHA-256 différente) — relance l’installation'); }
  }
  fs.renameSync(part, dest);
  return { bytes: got };
}
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

module.exports = { download, json, text, hashFile, getFetch };

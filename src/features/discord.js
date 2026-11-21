// DISCORD — Rich Presence (« Joue à … » sur ton profil) et lancement rapide d'un stream (Go Live).
//
// Rich Presence : protocole IPC local de Discord (tube nommé \\?\pipe\discord-ipc-N sous Windows,
// trames [opcode int32 LE][longueur int32 LE][JSON]) — aucune bibliothèque, aucun compte à connecter.
// Il faut un « ID d'application » Discord (gratuit, discord.com/developers/applications) : son nom
// s'affiche (« Joue à RR Launcher »), le nom du jeu va dans les détails.
//
// Stream : Discord n'expose pas le partage d'écran aux applications tierces. Le launcher appuie donc
// à ta place sur le raccourci Discord « Démarrer / arrêter le stream » (à créer une fois dans
// Discord → Paramètres → Raccourcis clavier), depuis le menu en jeu ou avec Guide + Y.
'use strict';
const net = require('net');
const path = require('path');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0); head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}
function decoder(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      const op = buf.readInt32LE(0);
      let data = null;
      try { data = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
      buf = buf.subarray(8 + len);
      onFrame(op, data);
    }
  };
}
const pipePath = (i) => (process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `discord-ipc-${i}`));

// Activité Discord pour un jeu
function activityFor(g, plat, start, settings = {}) {
  if (!g) return null;
  const a = {
    details: String(g.name || 'Jeu').slice(0, 128),
    state: plat?.name ? `sur ${plat.name}`.slice(0, 128) : undefined,
    timestamps: start ? { start: Math.floor(start / 1000) } : undefined,
    type: 0,
    status_display_type: 2, // « Joue à <nom du jeu> » dans la liste des membres (versions récentes de Discord)
    instance: false,
  };
  // Image : Discord accepte une URL https publique. Jeux Steam : jaquette du CDN Steam.
  const img = g.appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg` : (settings.discordImageKey || 'logo');
  a.assets = { large_image: img, large_text: g.name, small_image: settings.discordImageKey || 'logo', small_text: 'RR Launcher' };
  if (img === a.assets.small_image) { delete a.assets.small_image; delete a.assets.small_text; }
  return a;
}

function createRpc({ log = () => {} } = {}) {
  let sock = null, ready = false, clientId = null, pending = null, connecting = null;
  const nonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function close() {
    ready = false;
    if (sock) { try { sock.destroy(); } catch {} sock = null; }
  }
  function connect(id) {
    if (ready && clientId === id) return Promise.resolve(true);
    if (connecting) return connecting;
    close();
    clientId = id;
    connecting = new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (i > 9) { connecting = null; return resolve(false); }
        const s = net.createConnection(pipePath(i++));
        let done = false;
        const fail = () => { if (done) return; done = true; s.destroy(); tryNext(); };
        s.once('error', fail);
        s.setTimeout(3000, fail);
        s.once('connect', () => {
          s.setTimeout(0);
          s.on('data', decoder((op, data) => {
            if (op === OP.PING) s.write(encode(OP.PONG, data));
            else if (op === OP.CLOSE) { log(`discord : fermé (${data?.message || ''})`); close(); }
            else if (op === OP.FRAME && data?.evt === 'READY') {
              ready = true; done = true; connecting = null;
              log(`discord : connecté (${data.data?.user?.username || '?'})`);
              resolve(true);
              if (pending) { const p = pending; pending = null; setActivity(p); }
            } else if (op === OP.FRAME && data?.evt === 'ERROR') log(`discord : erreur ${data.data?.message || ''}`);
          }));
          s.on('close', () => { if (sock === s) { ready = false; sock = null; } });
          s.removeListener('error', fail);
          s.on('error', () => {});
          sock = s;
          s.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(id) }));
          setTimeout(() => { if (!ready && !done) { done = true; connecting = null; log('discord : pas de réponse'); close(); resolve(false); } }, 5000);
        });
      };
      tryNext();
    });
    return connecting;
  }
  function setActivity(activity) {
    if (!ready || !sock) { pending = activity; return false; }
    sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || undefined }, nonce: nonce() }));
    return true;
  }
  return { connect, setActivity, close, get ready() { return ready; } };
}

// VK des touches du raccourci (« Ctrl+Shift+F9 » → [0x11, 0x10, 0x78])
const VK = { CTRL: 0x11, CONTROL: 0x11, SHIFT: 0x10, ALT: 0x12, WIN: 0x5b, SPACE: 0x20, TAB: 0x09, ENTER: 0x0d, ESC: 0x1b,
  INSERT: 0x2d, INSER: 0x2d, DELETE: 0x2e, SUPPR: 0x2e, HOME: 0x24, END: 0x23, PAGEUP: 0x21, PAGEDOWN: 0x22,
  UP: 0x26, DOWN: 0x28, LEFT: 0x25, RIGHT: 0x27, PAUSE: 0x13, SCROLLLOCK: 0x91 };
function parseCombo(str) {
  const vks = [];
  for (const raw of String(str || '').split('+').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (VK[raw]) vks.push(VK[raw]);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(raw)) vks.push(0x6f + Number(raw.slice(1)));
    else if (/^[A-Z0-9]$/.test(raw)) vks.push(raw.charCodeAt(0));
    else if (/^NUM([0-9])$/.test(raw)) vks.push(0x60 + Number(raw.slice(3)));
    else return null;
  }
  return vks.length ? vks : null;
}

function init(ctx) {
  const { ipcMain, store, hub, running, findGame, send, log } = ctx;
  const S = () => store.data.settings;
  if (S().discordRpc === undefined) S().discordRpc = true;
  if (S().discordStreamKeys === undefined) S().discordStreamKeys = 'Ctrl+Shift+F9';
  const { BY_ID } = require('../platforms');
  const rpc = createRpc({ log });
  let current = null, retry = null;

  async function update() {
    clearTimeout(retry);
    const id = String(S().discordClientId || require('../metadata').getShared().discordId || '').trim();
    if (!S().discordRpc || !/^\d{15,22}$/.test(id)) { if (rpc.ready) rpc.setActivity(null); return; }
    const runId = [...running.keys()].pop();
    const g = runId ? findGame(runId) : null;
    if (!g) {
      if (rpc.ready) rpc.setActivity(null);
      current = null;
      return;
    }
    current = activityFor(g, BY_ID[g.platform], running.get(runId)?.start || Date.now(), S());
    const ok = await rpc.connect(id);
    if (ok) rpc.setActivity(current);
    else retry = setTimeout(update, 30000); // Discord pas encore lancé : on réessaie pendant la partie
  }
  hub.on('session:start', () => setTimeout(update, 1500));
  hub.on('session:end', () => setTimeout(update, 300));

  // ---- Stream (Go Live) via le raccourci Discord
  let lastStream = 0, streaming = false; // le raccourci Discord est une bascule : on suit l'état de notre côté
  const setStreaming = (v) => { if (streaming !== v) { streaming = v; send('x:discord:streamState', { streaming }); } };
  hub.on('session:end', () => setStreaming(false));
  hub.on('discord:voice', (st) => { if (!st?.inVoice) setStreaming(false); }); // quitter le vocal coupe le stream
  function stream() {
    if (Date.now() - lastStream < 1500) return { ok: false, error: 'Patiente une seconde' };
    lastStream = Date.now();
    const vks = parseCombo(S().discordStreamKeys);
    if (!vks) return { ok: false, error: 'Raccourci invalide (Réglages → Fonctions → Discord)' };
    let native = null;
    try { native = ctx.winNative(); } catch {}
    if (!native?.sendKeys) return { ok: false, error: 'Disponible uniquement sous Windows' };
    const ok = native.sendKeys(vks);
    log(`discord : raccourci stream ${S().discordStreamKeys} → ${ok}`);
    if (ok) setStreaming(!streaming);
    return ok ? { ok: true, streaming } : { ok: false, error: 'Envoi du raccourci impossible' };
  }
  hub.on('pad:combo', (name) => {
    if (name !== 'stream' || S().discordStreamPad === false) return;
    const r = stream();
    send('x:discord:streamed', { ...r, origin: 'pad' });
  });

  ipcMain.handle('x:discord:stream', async (_e, o = {}) => {
    if (o.delay) await new Promise((r) => setTimeout(r, Math.min(2000, Number(o.delay) || 0)));
    return stream();
  });
  ipcMain.handle('x:discord:streamState', () => ({ streaming }));
  ipcMain.handle('x:discord:test', async () => {
    const id = String(S().discordClientId || require('../metadata').getShared().discordId || '').trim();
    if (!/^\d{15,22}$/.test(id)) return { ok: false, error: "ID d'application invalide" };
    const ok = await rpc.connect(id);
    if (!ok) return { ok: false, error: 'Discord est-il ouvert ? (application de bureau)' };
    rpc.setActivity({ details: 'Dans la bibliothèque', state: 'RR Launcher', type: 0, instance: false, timestamps: { start: Math.floor(Date.now() / 1000) } });
    setTimeout(update, 8000); // on remet l'état réel ensuite
    return { ok: true };
  });
  ipcMain.handle('x:discord:refresh', () => update());
}

module.exports = { init, activityFor, parseCombo, encode, decoder };

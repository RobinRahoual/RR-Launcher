// STREAM — streaming vers un autre écran (TV, Fire TV, Apple TV, iPhone, Mac, autre PC) en un clic, avec Apollo (serveur,
// fork de Sunshine) et Moonlight / Artemis (clients). Le launcher ne diffuse rien lui-même : il installe Apollo, le règle
// selon l'objectif (4K60, 1080p120…), la liaison et le receveur (src/features/stream-profile.js), mesure le débit LAN,
// appaire le receveur (PIN) et déclare « RR Launcher » (ou un jeu précis) comme application. Un jeu déclaré se lance avec
// « RR Launcher.exe --launch=<id> » (géré par main.js, voir launchArg()).
// Apollo : https://github.com/ClassicOldSong/Apollo — Moonlight : https://moonlight-stream.org
// Tout passe par l'API HTTP locale d'Apollo (https://localhost:47990, /api/login, /api/config, /api/apps, /api/pin…) :
// pas d'écriture dans Program Files, donc une seule invite UAC (l'installation).
// Canaux : x:stream:status | receivers | install | start | openUi | login | measure:start|get|stop | recommend | apply | pin |
//          register | unregister | moonlight | installMoonlight.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync, execFile } = require('child_process');

const APOLLO_PORT = 47990;
const APOLLO_UI = `https://localhost:${APOLLO_PORT}`;
const APOLLO_RELEASE_API = 'https://api.github.com/repos/ClassicOldSong/Apollo/releases/latest';
const APOLLO_RELEASES = 'https://github.com/ClassicOldSong/Apollo/releases/latest';
const MOONLIGHT_SITE = 'https://moonlight-stream.org/';
const SERVICE = 'ApolloService';
const MEASURE_PORT = 48100;

// ---- Pures
// --launch=<id> (ou --launch <id>) dans la ligne de commande → identifiant de jeu, ou null
function launchArg(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const m = String(argv[i]).match(/^--launch(?:=(.*))?$/);
    if (!m) continue;
    const v = (m[1] ?? argv[i + 1] ?? '').trim();
    return /^[\w-]{1,40}$/.test(v) ? v : null;
  }
  return null;
}
// Emplacements possibles d'Apollo (nom d'exécutable non garanti : Apollo.exe ou sunshine.exe selon la version)
function apolloCandidates(env = process.env) {
  const roots = [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'].map((p) => path.win32.join(p, 'Apollo'));
  if (env.LOCALAPPDATA) roots.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'Apollo'));
  return roots.flatMap((d) => ['Apollo.exe', 'sunshine.exe'].map((n) => path.win32.join(d, n)));
}
function moonlightCandidates(env = process.env) {
  const pf = [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
  const l = env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, 'Programs', 'Moonlight Game Streaming', 'Moonlight.exe')] : [];
  return [...pf.map((p) => path.win32.join(p, 'Moonlight Game Streaming', 'Moonlight.exe')), ...l];
}
// Adresses IPv4 privées (LAN) de ce PC, à saisir dans Moonlight : [{ name, address }]
function localAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address)) continue; // LAN + Tailscale / CGNAT
      out.push({ name, address: a.address });
    }
  }
  return out;
}
// Release GitHub d'Apollo → { name, url, size, sha256 } de l'installeur Windows (.exe), ou null
function pickAsset(release) {
  const a = (release?.assets || []).find((x) => /^Apollo[-_.\w]*\.exe$/i.test(x?.name || '') && x.browser_download_url);
  if (!a) return null;
  const m = String(a.digest || '').match(/^sha256:([0-9a-f]{64})$/i);
  return { name: a.name, url: a.browser_download_url, size: a.size || 0, sha256: m ? m[1].toLowerCase() : null, tag: release.tag_name || '' };
}
// Noms de cartes graphiques (Win32_VideoController) → { gpu: nvidia|amd|intel|unknown, av1Host, names }
function parseGpus(names = []) {
  const list = names.map((n) => String(n).trim()).filter(Boolean);
  const has = (re) => list.find((n) => re.test(n));
  const nv = has(/nvidia|geforce|rtx|gtx/i), amd = has(/radeon|amd/i), intel = has(/intel/i);
  const gpu = nv ? 'nvidia' : amd ? 'amd' : intel ? 'intel' : 'unknown';
  const main = nv || amd || intel || '';
  const av1Host = gpu === 'nvidia' ? /RTX\s*[45]\d{3}/i.test(main) : gpu === 'amd' ? /RX\s*[79]\d{3}/i.test(main) : gpu === 'intel' ? /Arc/i.test(main) : false;
  return { gpu, av1Host, names: list };
}
const q = (p) => `"${p}"`;
// Entrée d'application Apollo pour tout le launcher (game absent) ou un jeu précis
function appEntry(exe, game) {
  const dir = path.win32.dirname(exe);
  return {
    name: game ? `${game.name} (RR Launcher)`.slice(0, 80) : 'RR Launcher',
    cmd: game ? `${q(exe)} --launch=${game.id}` : q(exe),
    'working-dir': dir,
    'auto-detach': true, // le launcher est à instance unique : le second processus se ferme tout de suite
    'wait-all': true,
    'exit-timeout': 5,
    ...(game ? {} : { 'image-path': 'desktop.png' }),
  };
}
// Ajoute / remplace (même nom) dans un apps.json → { json, added } (repli manuel / tests)
function addApp(json, entry) {
  const data = json && typeof json === 'object' ? json : {};
  const apps = Array.isArray(data.apps) ? [...data.apps] : [];
  const i = apps.findIndex((a) => a?.name === entry.name);
  if (i >= 0) apps[i] = { ...apps[i], ...entry }; else apps.push(entry);
  return { json: { env: data.env || {}, ...data, apps }, added: i < 0 };
}
function removeApp(json, name) {
  const apps = (json?.apps || []).filter((a) => a?.name !== name);
  return { json: { ...json, apps }, removed: apps.length !== (json?.apps || []).length };
}
// Réponse de GET /api/config → objet plat de clés de sunshine.conf (sans les champs d'état renvoyés par l'API)
const CONF_NOISE = new Set(['vdisplayStatus', 'platform', 'version', 'status', 'status_code', 'error', 'commit', 'branch', 'notify_pre_releases']);
function cleanConfig(resp) {
  const src = resp && typeof resp.config === 'object' && resp.config ? resp.config : resp;
  const out = {};
  for (const [k, v] of Object.entries(src && typeof src === 'object' ? src : {})) {
    if (CONF_NOISE.has(k) || v === null || v === undefined || v === '' || typeof v === 'object') continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}
// Statistiques d'un test de débit : médiane et minimum (Mbps) de plusieurs téléchargements
function speedStats(samples = []) {
  const v = samples.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return { mbps: null, minMbps: null, n: 0 };
  const mid = v.length >> 1, med = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { mbps: Math.round(med), minMbps: Math.round(v[0]), n: v.length };
}
// Port ouvert sur cette machine (IPv4 ou IPv6) ? Apollo met plusieurs secondes à ouvrir son interface web.
function portOpen(port, timeout = 800) {
  const one = (host) => new Promise((res) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); res(v); };
    s.setTimeout(timeout, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
  });
  return one('127.0.0.1').then((v) => v || one('::1'));
}
async function waitPort(port, { tries = 30, every = 1000, check = portOpen, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < tries; i++) { if (await check(port)) return true; await sleep(every); }
  return false;
}
// PowerShell : '…' avec ' doublé
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const isLocalHost = (h) => LOCAL_HOSTS.includes(String(h || '').toLowerCase());
const psq = (v) => `'${String(v).replace(/'/g, "''")}'`;
// Installation silencieuse d'Apollo (installeur : /S), en administrateur. Sunshine, s'il est présent, est arrêté et désactivé
// dans la même invite UAC (il occuperait le port 47990 et les ports de flux).
const installScript = (exe, sunshineService = false) => {
  const pre = sunshineService ? `Start-Process -FilePath cmd.exe -ArgumentList '/c net stop SunshineService & sc config SunshineService start= disabled' -Verb RunAs -Wait -WindowStyle Hidden; ` : '';
  return `${pre}Start-Process -FilePath ${psq(exe)} -ArgumentList '/S' -Verb RunAs -Wait`;
};
const startServiceScript = (service) => `Start-Process -FilePath cmd.exe -ArgumentList ${psq('/c net start ' + service)} -Verb RunAs -Wait -WindowStyle Hidden`;
function runPs(script, { run = execFile, timeout = 90000 } = {}) {
  return new Promise((res) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout }, (err, stdout) => res(err ? false : (String(stdout || '').trim() || true))));
}
const moonlightArgs = (host, app) => ['stream', host, app || 'Desktop'];

// Page de mesure ouverte dans le navigateur du receveur : télécharge 6 blocs de 24 Mo, affiche le débit et le renvoie au launcher
const MEASURE_PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mesure du débit — RR Launcher</title>
<body style="margin:0;background:#101010;color:#fff;font:600 28px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center">
<div><div style="font-size:18px;opacity:.7">RR Launcher — test de débit vers cet appareil</div><div id="v" style="font-size:72px;margin:24px 0">…</div><div id="s" style="font-size:20px;opacity:.8">Mesure en cours, ne ferme pas cette page.</div></div>
<script>
(async()=>{const r=[],v=document.getElementById('v'),s=document.getElementById('s');
try{for(let i=0;i<6;i++){const t=performance.now();const b=await(await fetch('blob?mb=24&i='+i,{cache:'no-store'})).arrayBuffer();const m=b.byteLength*8/1e6/((performance.now()-t)/1000);r.push(m);v.textContent=Math.round(m)+' Mbps';}
await fetch('result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({samples:r})});
s.textContent='Terminé : retourne dans RR Launcher.';}catch(e){v.textContent='Échec';s.textContent='Vérifie le pare-feu Windows (autorise RR Launcher sur le réseau privé).';}})();
</script></body></html>`;

function init(ctx) {
  const { ipcMain, store, findGame, log, commit } = ctx;
  const { shell, app: eapp } = require('electron');
  const S = () => store.data.settings;
  if (store.data.sunshine) { delete store.data.sunshine; commit(); } // ancien identifiant Sunshine devenu inutile
  const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
  const find = (list) => list.find(exists) || null;
  const selfExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const fail = (e, extra = {}) => ({ ok: false, error: e?.message || String(e), ...(e?.code ? { code: e.code } : {}), ...extra });

  function isRunning(exe) {
    try {
      const n = ctx.winNative();
      const base = path.win32.basename(exe).toLowerCase();
      return !!n?.listProcesses?.().some((p) => p.path && path.win32.basename(p.path).toLowerCase() === base);
    } catch { return false; }
  }
  const hasService = () => { try { return spawnSync('sc', ['query', SERVICE], { windowsHide: true }).status === 0; } catch { return false; } };
  const serviceRunning = () => { try { const r = spawnSync('sc', ['query', SERVICE], { windowsHide: true, encoding: 'utf8' }); return r.status === 0 && /RUNNING/.test(r.stdout || ''); } catch { return false; } };
  const hasSunshine = () => { try { return spawnSync('sc', ['query', 'SunshineService'], { windowsHide: true }).status === 0; } catch { return false; } };
  const appsFile = (exe) => path.win32.join(path.win32.dirname(exe), 'config', 'apps.json');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let sudovdaCache = null;
  async function sudovda() { // écran virtuel Apollo : visible dans le Gestionnaire de périphériques si le pilote est installé
    const r = await runPs("(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*SudoVDA*' } | Measure-Object).Count", { timeout: 20000 });
    sudovdaCache = r === false ? null : Number(r) > 0;
    return sudovdaCache;
  }

  function status() {
    const apollo = find(apolloCandidates()), moon = find(moonlightCandidates());
    let registered = [];
    if (apollo) { try { registered = (JSON.parse(fs.readFileSync(appsFile(apollo), 'utf8')).apps || []).map((a) => a.name).filter((n) => /RR Launcher/.test(n || '')); } catch {} }
    const p = store.data.apollo?.profile || null;
    return { ok: true, platform: process.platform, apollo: { installed: !!apollo, exe: apollo, running: apollo ? isRunning(apollo) || serviceRunning() : false, ui: APOLLO_UI, service: apollo ? hasService() : false, sudovda: sudovdaCache },
      moonlight: { installed: !!moon, exe: moon }, addresses: localAddresses(), registered, hasLogin: !!creds()?.user, profile: p, selfExe: selfExe() };
  }
  ipcMain.handle('x:stream:status', () => status());
  ipcMain.handle('x:stream:receivers', () => { try { const P = require('./stream-profile'); return { ok: true, receivers: P.RECEIVERS, targets: P.TARGETS }; } catch (e) { return fail(e); } });
  ipcMain.handle('x:stream:installMoonlight', () => { shell.openExternal(MOONLIGHT_SITE); return true; });

  // ---- Identifiants de l'interface web d'Apollo (créés automatiquement ; chiffrés avec le coffre du système quand il est disponible)
  function creds() {
    const c = store.data.apollo?.cred;
    if (!c?.user) return null;
    try { return { user: c.user, pass: c.enc ? require('electron').safeStorage.decryptString(Buffer.from(c.pass, 'base64')) : c.pass }; } catch { return null; }
  }
  function saveCreds(user, pass) {
    user = String(user || '').trim().slice(0, 100); pass = String(pass || '').slice(0, 200);
    store.data.apollo = store.data.apollo || {};
    if (!user || !pass) { delete store.data.apollo.cred; commit(); return false; }
    let enc = false, p = pass;
    try { const { safeStorage } = require('electron'); if (safeStorage.isEncryptionAvailable()) { p = safeStorage.encryptString(pass).toString('base64'); enc = true; } } catch {}
    store.data.apollo.cred = { user, pass: p, enc }; commit();
    return true;
  }
  // ---- API HTTP d'Apollo (session « persist:apollo », certificat auto-signé accepté pour localhost uniquement)
  let ses = null;
  function apolloSession() {
    if (ses) return ses;
    ses = require('electron').session.fromPartition('persist:apollo');
    ses.setCertificateVerifyProc((req, cb) => cb(isLocalHost(req.hostname) ? 0 : -3));
    return ses;
  }
  async function raw(method, p, body) {
    const o = { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {} };
    if (body !== undefined) o.body = JSON.stringify(body);
    const r = await apolloSession().fetch(`${APOLLO_UI}${p}`, o);
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }
  const needsLogin = () => Object.assign(new Error('Apollo a déjà un identifiant que le launcher ne connaît pas : saisis-le dans Réglages → Streaming.'), { code: 'NEEDS_LOGIN' });
  async function login() {
    const c = creds(); if (!c) return false;
    const r = await raw('POST', '/api/login', { username: c.user, password: c.pass });
    return r.status === 200 && r.json?.status !== false;
  }
  // Premier démarrage : Apollo n'a pas d'identifiant → le launcher en crée un (mot de passe aléatoire, jamais affiché)
  async function setupCreds() {
    const user = 'rr-launcher', pass = crypto.randomBytes(18).toString('base64url');
    const r = await raw('POST', '/api/password', { currentUsername: '', currentPassword: '', newUsername: user, newPassword: pass, confirmNewPassword: pass });
    if (r.status !== 200 || r.json?.status === false) return false;
    saveCreds(user, pass); log('stream : identifiants Apollo créés');
    return true;
  }
  async function api(method, p, body) {
    if (!creds() && !(await setupCreds())) throw needsLogin();
    let r = await raw(method, p, body);
    if (r.status === 401 || r.status === 403 || r.json === null) { // session absente ou expirée
      if (!(await login()) && !(await setupCreds())) throw needsLogin(); // Apollo réinstallé (sans identifiant) : on recrée le nôtre
      r = await raw(method, p, body);
    }
    if (r.status >= 400) throw new Error(r.json?.error || `Apollo a répondu ${r.status} (${p})`);
    return r.json || {};
  }

  // Interface Apollo dans une fenêtre du launcher, déjà connectée
  let uiWin = null;
  async function openUi() {
    if (!creds()) { try { await setupCreds(); } catch {} }
    if (!creds()) { shell.openExternal(APOLLO_UI); return { ok: true, auth: false }; }
    if (uiWin && !uiWin.isDestroyed()) { uiWin.show(); uiWin.focus(); return { ok: true, auth: true }; }
    const { BrowserWindow } = require('electron');
    try { await login(); } catch (e) { log(`stream : connexion Apollo (${e.message})`); }
    const c = creds();
    uiWin = new BrowserWindow({ width: 1180, height: 820, autoHideMenuBar: true, title: 'Apollo', backgroundColor: '#1b1b1b', webPreferences: { session: apolloSession() } });
    uiWin.webContents.on('login', (e, _req, info, cb) => { if (info.isProxy || !isLocalHost(info.host) || !c) return; e.preventDefault(); cb(c.user, c.pass); });
    uiWin.on('closed', () => { uiWin = null; });
    uiWin.loadURL(APOLLO_UI);
    return { ok: true, auth: true };
  }
  ipcMain.handle('x:stream:openUi', () => openUi().catch((e) => fail(e)));
  // Repli : l'utilisateur avait déjà créé un identifiant dans Apollo
  ipcMain.handle('x:stream:login', async (_e, o = {}) => {
    const saved = saveCreds(o.user, o.pass);
    if (!saved) return { ok: true, saved: false };
    try { if (!(await login())) { delete store.data.apollo.cred; commit(); return { ok: false, error: 'Identifiant ou mot de passe refusé par Apollo' }; } } catch (e) { return fail(e); }
    return { ok: true, saved: true };
  });

  // ---- Installation (une seule invite UAC) : dernière release GitHub d'Apollo, installeur silencieux, vérification de taille / SHA-256
  ipcMain.handle('x:stream:install', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Apollo (écran virtuel) fonctionne sous Windows uniquement' };
    if (find(apolloCandidates())) return { ok: true, already: true, sudovda: await sudovda(), rebootAdvised: false };
    try {
      const { net: enet } = require('electron');
      const rel = await (await enet.fetch(APOLLO_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })).json();
      const asset = pickAsset(rel);
      if (!asset) throw new Error('Installeur Apollo introuvable dans la dernière release');
      const dir = path.join(eapp.getPath('temp'), 'rr-apollo'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, asset.name);
      const res = await enet.fetch(asset.url);
      if (!res.ok) throw new Error(`Téléchargement refusé (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (asset.size && buf.length !== asset.size) throw new Error('Téléchargement incomplet');
      if (asset.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== asset.sha256) throw new Error('Somme SHA-256 incorrecte');
      fs.writeFileSync(file, buf);
      log(`stream : installation d'Apollo ${asset.tag}`);
      await runPs(installScript(file, hasSunshine()), { timeout: 240000 });
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      if (!find(apolloCandidates())) return { ok: false, error: 'Installation annulée ou refusée (invite administrateur ?). Réessaie et accepte la fenêtre Windows.' };
      const sv = await sudovda();
      return { ok: true, tag: asset.tag, sudovda: sv, rebootAdvised: sv !== true }; // le pilote d'écran virtuel demande parfois un redémarrage de Windows
    } catch (e) { shell.openExternal(APOLLO_RELEASES); return fail(e, { manual: APOLLO_RELEASES }); }
  });
  // Démarre Apollo si besoin puis attend que son interface web (port 47990) réponde
  async function start() {
    const apollo = find(apolloCandidates());
    if (!apollo) return { ok: false, error: 'Apollo n’est pas installé' };
    if (!(await portOpen(APOLLO_PORT))) {
      if (hasService()) { if ((await runPs(startServiceScript(SERVICE), { timeout: 60000 })) === false) return { ok: false, error: 'Démarrage du service Apollo refusé (invite administrateur ?)' }; }
      else if (!isRunning(apollo)) {
        try { const c = spawn(apollo, [], { cwd: path.win32.dirname(apollo), detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); log('stream : Apollo démarré'); }
        catch (e) { return { ok: false, error: `Démarrage impossible : ${e.message}` }; }
      }
      if (!(await waitPort(APOLLO_PORT, { tries: 30 }))) return { ok: false, error: 'Apollo ne répond pas sur le port 47990 (démarrage trop long ou bloqué par le pare-feu). Vérifie l’icône Apollo près de l’horloge.' };
    }
    return { ...status(), ready: true };
  }
  ipcMain.handle('x:stream:start', () => start());

  // ---- Mesure du débit LAN : petit serveur HTTP temporaire, le receveur ouvre l'adresse dans son navigateur
  let mSrv = null, mTimer = null, mToken = '', mBlobs = 0, measured = { running: false, mbps: null, minMbps: null, at: 0 };
  const block = Buffer.alloc(1 << 20, 0x5a);
  function mStop() { clearTimeout(mTimer); try { mSrv?.close(); mSrv?.closeAllConnections?.(); } catch {} mSrv = null; measured.running = false; }
  ipcMain.handle('x:stream:measure:start', async () => {
    mStop(); measured = { running: true, mbps: null, minMbps: null, at: 0 };
    mToken = crypto.randomBytes(8).toString('hex'); mBlobs = 0; // jeton dans l'URL : seul le receveur à qui on l'a donnée peut utiliser le serveur
    mSrv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const pre = `/${mToken}/`;
      if (!u.pathname.startsWith(pre)) { res.writeHead(404); return res.end(); }
      u.pathname = '/' + u.pathname.slice(pre.length);
      if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(MEASURE_PAGE); }
      if (req.method === 'GET' && u.pathname === '/blob') {
        if (mBlobs >= 2) { res.writeHead(429); return res.end(); }
        const mb = Math.min(64, Math.max(1, parseInt(u.searchParams.get('mb'), 10) || 16));
        mBlobs++; res.on('close', () => { mBlobs--; });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': mb << 20, 'Cache-Control': 'no-store' });
        let i = 0;
        const pump = () => { while (i < mb) { i++; if (!res.write(block)) return res.once('drain', pump); } res.end(); };
        return pump();
      }
      if (req.method === 'POST' && u.pathname === '/result') {
        let b = ''; req.on('data', (c) => { if (b.length < 4096) b += c; });
        req.on('end', () => { try { const s = speedStats((JSON.parse(b).samples || []).slice(0, 12).map(Number)); if (s.mbps) { measured = { running: false, mbps: s.mbps, minMbps: s.minMbps, at: Date.now() }; log(`stream : débit LAN mesuré ${s.mbps} Mbps (min ${s.minMbps})`); setTimeout(() => { clearTimeout(mTimer); try { mSrv?.close(); mSrv?.closeAllConnections?.(); } catch {} mSrv = null; }, 1000); } } catch {} res.writeHead(204); res.end(); });
        return;
      }
      res.writeHead(404); res.end();
    });
    try { await new Promise((ok, ko) => { mSrv.once('error', ko); mSrv.listen(MEASURE_PORT, '0.0.0.0', ok); }); }
    catch (e) { mStop(); return fail(e); }
    mTimer = setTimeout(mStop, 5 * 60 * 1000);
    const urls = localAddresses().map((a) => `http://${a.address}:${MEASURE_PORT}/${mToken}/`);
    return { ok: true, url: urls[0] || '', urls };
  });
  // Ouvre l'adresse de mesure dans le navigateur de ce PC (seulement l'URL du test en cours : adresse LAN de ce PC + jeton)
  ipcMain.handle('x:stream:measure:open', (_e, url) => {
    const ok = mSrv && localAddresses().some((a) => url === `http://${a.address}:${MEASURE_PORT}/${mToken}/`);
    if (!ok) return { ok: false, error: 'Adresse de mesure non valide : relance la mesure' };
    shell.openExternal(url); return { ok: true };
  });
  ipcMain.handle('x:stream:measure:get', () => ({ ok: true, running: measured.running, mbps: measured.mbps, minMbps: measured.minMbps }));
  ipcMain.handle('x:stream:measure:stop', (_e, o = {}) => { mStop(); if (o?.reset) measured = { running: false, mbps: null, minMbps: null, at: 0 }; return { ok: true }; });

  // ---- Profil recommandé (cible + receveur + liaison + débit mesuré + GPU) et application dans Apollo
  async function gpuInfo() {
    const r = await runPs('(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "|"', { timeout: 20000 });
    return parseGpus(typeof r === 'string' ? r.split('|') : []);
  }
  async function recommend(o = {}) {
    const P = require('./stream-profile');
    const g = await gpuInfo();
    const measuredMbps = measured.mbps && Date.now() - measured.at < 60 * 60 * 1000 ? measured.mbps : null;
    const rec = P.recommend({ target: o.target, receiver: o.receiver, link: o.link, measuredMbps, gpu: g.gpu, av1Host: g.av1Host });
    return { ok: true, gpu: g, measuredMbps, rec };
  }
  ipcMain.handle('x:stream:recommend', (_e, o) => recommend(o).catch((e) => fail(e)));
  ipcMain.handle('x:stream:apply', async (_e, o = {}) => {
    try {
      const s = await start(); if (s.ok === false) return s;
      const { rec, gpu } = await recommend(o);
      const resp = await api('GET', '/api/config');
      if (!('vdisplayStatus' in ((resp && typeof resp.config === 'object' && resp.config) || resp || {}))) throw new Error('Le serveur qui répond sur le port 47990 n’est pas Apollo (Sunshine est peut-être encore actif) : ferme-le ou désinstalle-le, puis réessaie.');
      const cur = cleanConfig(resp);
      await api('POST', '/api/config', { ...cur, ...rec.hostConf });
      try { await raw('POST', '/api/restart', {}); } catch {} // l'appel peut ne pas revenir : Apollo redémarre
      for (let i = 0; i < 20 && (await portOpen(APOLLO_PORT)); i++) await sleep(500); // attend l'arrêt d'Apollo…
      const back = (await start()).ok !== false; // …puis le relance (Apollo lancé sans console ne se relance pas tout seul)
      store.data.apollo = store.data.apollo || {};
      store.data.apollo.profile = { label: rec.resolved?.label || '', codec: rec.codec, bitrateMbps: rec.bitrateMbps, receiver: String(o.receiver || ''), at: Date.now() }; commit();
      log(`stream : Apollo réglé — ${rec.resolved?.label} ${rec.codec} ${rec.bitrateMbps} Mbps (${gpu.gpu})`);
      return { ok: true, rec, restarted: back };
    } catch (e) { return fail(e); }
  });
  // PIN affiché par Moonlight / Artemis au premier appairage
  ipcMain.handle('x:stream:pin', async (_e, o = {}) => {
    const pin = String(o.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'Le code PIN compte 4 chiffres' };
    try {
      const s = await start(); if (s.ok === false) return s;
      const r = await api('POST', '/api/pin', { pin, name: String(o.name || 'Receveur').slice(0, 60) });
      return r.status === false ? { ok: false, error: 'PIN refusé : relance l’appairage dans Moonlight et réessaie' } : { ok: true };
    } catch (e) { return fail(e); }
  });

  // ---- Applications : « RR Launcher » ou un jeu précis (API /api/apps, pas d'écriture dans Program Files)
  ipcMain.handle('x:stream:register', async (_e, gameId) => {
    const g = gameId ? findGame(gameId) : null;
    if (gameId && !g) return { ok: false, error: 'Jeu introuvable' };
    const entry = appEntry(selfExe(), g);
    try {
      const s = await start(); if (s.ok === false) return s;
      const list = (await api('GET', '/api/apps')).apps || [];
      const old = list.find((a) => a?.name === entry.name);
      await api('POST', '/api/apps', old ? { ...old, ...entry } : entry);
      log(`stream : « ${entry.name} » ${old ? 'mis à jour dans' : 'ajouté à'} Apollo`);
      return { ok: true, name: entry.name, added: !old, restarted: false };
    } catch (e) { return fail(e, { manual: { name: entry.name, cmd: entry.cmd, dir: entry['working-dir'] } }); }
  });
  ipcMain.handle('x:stream:unregister', async (_e, name) => {
    try {
      const s = await start(); if (s.ok === false) return s;
      const old = ((await api('GET', '/api/apps')).apps || []).find((a) => a?.name === String(name));
      if (!old?.uuid) return { ok: true, removed: false };
      await api('POST', '/api/apps/delete', { uuid: old.uuid });
      return { ok: true, removed: true };
    } catch (e) { return fail(e); }
  });
  // Moonlight sur CE PC (pour recevoir le flux d'un autre PC) : hôte et application facultatifs
  ipcMain.handle('x:stream:moonlight', (_e, o = {}) => {
    const moon = find(moonlightCandidates());
    if (!moon) { shell.openExternal(MOONLIGHT_SITE); return { ok: false, error: 'Moonlight n’est pas installé (page de téléchargement ouverte)' }; }
    const host = String(o.host || S().streamHost || '').trim();
    const args = /^[\w.:-]{1,80}$/.test(host) ? moonlightArgs(host, String(o.app || '').slice(0, 80)) : [];
    try { const c = spawn(moon, args, { cwd: path.win32.dirname(moon), detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  eapp.on('before-quit', mStop);
}

module.exports = { init, isLocalHost, installScript, portOpen, waitPort, launchArg, apolloCandidates, moonlightCandidates, localAddresses, pickAsset, parseGpus,
  cleanConfig, speedStats, appEntry, addApp, removeApp, moonlightArgs, APOLLO_UI };

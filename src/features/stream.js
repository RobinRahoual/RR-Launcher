// STREAM — streaming vers un autre écran (TV, Steam Deck, téléphone, autre PC) en un clic, avec Sunshine (serveur) et
// Moonlight (client). Le launcher ne diffuse rien lui-même : il détecte / démarre Sunshine, ouvre son interface
// d'appairage, donne les adresses à saisir dans Moonlight, et déclare « RR Launcher » (ou un jeu précis) comme application
// Sunshine. Un jeu déclaré se lance avec « RR Launcher.exe --launch=<id> » (géré par main.js, voir launchArg()).
// Sunshine : https://github.com/LizardByte/Sunshine — Moonlight : https://moonlight-stream.org
// Canaux : x:stream:status | start | openUi | login | install | register | unregister | moonlight.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync, execFile } = require('child_process');

const SUNSHINE_PORT = 47990;
const SUNSHINE_UI = `https://localhost:${SUNSHINE_PORT}`;
const SUNSHINE_RELEASES = 'https://github.com/LizardByte/Sunshine/releases/latest';
const MOONLIGHT_SITE = 'https://moonlight-stream.org/';

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
function sunshineCandidates(env = process.env) {
  const pf = [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
  const l = env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, 'Programs', 'Sunshine', 'sunshine.exe')] : [];
  return [...pf.map((p) => path.win32.join(p, 'Sunshine', 'sunshine.exe')), ...l];
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
const q = (p) => `"${p}"`;
// Entrée d'application Sunshine pour tout le launcher (id absent) ou un jeu précis
function appEntry(exe, game) {
  const dir = path.win32.dirname(exe);
  return {
    name: game ? `${game.name} (RR Launcher)`.slice(0, 80) : 'RR Launcher',
    cmd: game ? `${q(exe)} --launch=${game.id}` : q(exe),
    'working-dir': dir,
    'auto-detach': 'true', // le launcher est à instance unique : le second processus se ferme tout de suite
    'wait-all': 'true',
    'exit-timeout': '5',
    ...(game ? {} : { 'image-path': 'desktop.png' }),
  };
}
// Ajoute / remplace (même nom) dans un apps.json → { json, added }
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
// Port ouvert sur cette machine (IPv4 ou IPv6) ? Sunshine met plusieurs secondes à ouvrir son interface web.
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
// Commande exécutée en administrateur (une invite UAC) : copie du fichier, puis redémarrage éventuel du service Sunshine
function elevatedScript(src, dest, service) {
  const steps = src ? [`copy /Y "${src}" "${dest}"`] : [];
  if (service) steps.push(`net stop ${service}`, `net start ${service}`);
  return `Start-Process -FilePath cmd.exe -ArgumentList ${psq('/c ' + steps.join(' & '))} -Verb RunAs -Wait -WindowStyle Hidden`;
}
function runPs(script, run = execFile) {
  return new Promise((res) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 90000 }, (err) => res(!err)));
}
const moonlightArgs = (host, app) => ['stream', host, app || 'Desktop'];

function init(ctx) {
  const { ipcMain, store, findGame, log, commit } = ctx;
  const { shell } = require('electron');
  const S = () => store.data.settings;
  const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
  const find = (list) => list.find(exists) || null;
  const selfExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

  function isRunning(exe) {
    try {
      const n = ctx.winNative();
      const base = path.win32.basename(exe).toLowerCase();
      return !!n?.listProcesses?.().some((p) => p.path && path.win32.basename(p.path).toLowerCase() === base);
    } catch { return false; }
  }
  const appsFile = (exe) => path.win32.join(path.win32.dirname(exe), 'config', 'apps.json');

  function status() {
    const sun = find(sunshineCandidates()), moon = find(moonlightCandidates());
    let registered = [];
    if (sun) { try { registered = (JSON.parse(fs.readFileSync(appsFile(sun), 'utf8')).apps || []).map((a) => a.name).filter((n) => /RR Launcher/.test(n || '')); } catch {} }
    return { ok: true, platform: process.platform, sunshine: { installed: !!sun, exe: sun, running: sun ? isRunning(sun) : false, ui: SUNSHINE_UI }, moonlight: { installed: !!moon, exe: moon },
      addresses: localAddresses(), registered, login: creds()?.user || '', selfExe: selfExe() };
  }
  ipcMain.handle('x:stream:status', () => status());
  ipcMain.handle('x:stream:install', () => { shell.openExternal(SUNSHINE_RELEASES); return true; });
  ipcMain.handle('x:stream:installMoonlight', () => { shell.openExternal(MOONLIGHT_SITE); return true; });
  // Identifiants de l'interface web de Sunshine (chiffrés avec le coffre du système quand il est disponible)
  function creds() {
    const c = store.data.sunshine;
    if (!c?.user) return null;
    try { return { user: c.user, pass: c.enc ? require('electron').safeStorage.decryptString(Buffer.from(c.pass, 'base64')) : c.pass }; } catch { return null; }
  }
  function saveCreds(user, pass) {
    user = String(user || '').trim().slice(0, 100); pass = String(pass || '').slice(0, 200);
    if (!user || !pass) { delete store.data.sunshine; commit(); return false; }
    let enc = false, p = pass;
    try { const { safeStorage } = require('electron'); if (safeStorage.isEncryptionAvailable()) { p = safeStorage.encryptString(pass).toString('base64'); enc = true; } } catch {}
    store.data.sunshine = { user, pass: p, enc }; commit();
    return true;
  }
  // Interface Sunshine dans une fenêtre du launcher, déjà connectée (certificat local auto-signé accepté pour localhost uniquement)
  let uiWin = null;
  async function openUi() {
    const c = creds();
    if (!c) { shell.openExternal(SUNSHINE_UI); return { ok: true, auth: false }; }
    if (uiWin && !uiWin.isDestroyed()) { uiWin.show(); uiWin.focus(); return { ok: true, auth: true }; }
    const { BrowserWindow, session } = require('electron');
    const ses = session.fromPartition('persist:sunshine');
    ses.setCertificateVerifyProc((req, cb) => cb(isLocalHost(req.hostname) ? 0 : -3));
    try { await ses.fetch(`${SUNSHINE_UI}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.user, password: c.pass }) }); }
    catch (e) { log(`stream : connexion Sunshine (${e.message})`); } // ancienne version : l'authentification HTTP ci-dessous prend le relais
    uiWin = new BrowserWindow({ width: 1180, height: 820, autoHideMenuBar: true, title: 'Sunshine', backgroundColor: '#1b1b1b', webPreferences: { session: ses } });
    uiWin.webContents.on('login', (e, _req, info, cb) => { if (info.isProxy || !isLocalHost(info.host)) return; e.preventDefault(); cb(c.user, c.pass); });
    uiWin.on('closed', () => { uiWin = null; });
    uiWin.loadURL(SUNSHINE_UI);
    return { ok: true, auth: true };
  }
  ipcMain.handle('x:stream:openUi', () => openUi());
  ipcMain.handle('x:stream:login', (_e, o = {}) => ({ ok: true, saved: saveCreds(o.user, o.pass) }));
  // Démarre Sunshine si besoin puis attend que son interface web (port 47990) réponde ; ne renvoie ok qu'à ce moment-là
  ipcMain.handle('x:stream:start', async () => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    if (!(await portOpen(SUNSHINE_PORT))) {
      if (!isRunning(sun)) {
        try { const c = spawn(sun, [], { cwd: path.win32.dirname(sun), detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); log('stream : Sunshine démarré'); }
        catch (e) { return { ok: false, error: `Démarrage impossible : ${e.message}` }; }
      }
      if (!(await waitPort(SUNSHINE_PORT, { tries: 30 }))) return { ok: false, error: 'Sunshine ne répond pas sur le port 47990 (démarrage trop long ou bloqué par le pare-feu). Vérifie l’icône Sunshine près de l’horloge.' };
    }
    return { ...status(), ready: true };
  });
  const SERVICE = 'SunshineService';
  const hasService = () => { try { return spawnSync('sc', ['query', SERVICE], { windowsHide: true }).status === 0; } catch { return false; } };
  const protectedErr = (e) => ['EPERM', 'EACCES', 'EBUSY', 'EROFS'].includes(e?.code);
  // Écrit apps.json ; dossier protégé (Program Files) → copie en administrateur (invite UAC) et redémarrage de Sunshine.
  // Renvoie { elevated, restarted } ou lève une erreur (UAC refusé…).
  async function writeApps(sun, json) {
    const dest = appsFile(sun), text = JSON.stringify(json, null, 2), service = hasService();
    let elevated = false, restarted = false;
    try { fs.writeFileSync(dest, text); }
    catch (e) {
      if (!protectedErr(e) || process.platform !== 'win32') throw e;
      const tmp = path.join(os.tmpdir(), `rr-sunshine-apps-${Date.now()}.json`);
      fs.writeFileSync(tmp, text);
      elevated = true; restarted = service;
      const ok = await runPs(elevatedScript(tmp, dest, service ? SERVICE : null));
      try { fs.rmSync(tmp, { force: true }); } catch {}
      let now = ''; try { now = fs.readFileSync(dest, 'utf8'); } catch {}
      if (!ok || now !== text) throw Object.assign(new Error('Autorisation administrateur refusée'), { code: 'UAC' });
    }
    if (!restarted) {
      if (service) restarted = await runPs(elevatedScript(null, null, SERVICE)); // service sans écriture protégée : redémarrage seul
      else if (isRunning(sun)) { // lancé par le launcher : on le relance simplement
        try { spawnSync('taskkill', ['/IM', path.win32.basename(sun), '/F'], { windowsHide: true }); await new Promise((r) => setTimeout(r, 800)); spawn(sun, [], { cwd: path.win32.dirname(sun), detached: true, stdio: 'ignore', windowsHide: true }).unref(); restarted = true; } catch {}
      }
    }
    return { elevated, restarted };
  }
  const readApps = (sun) => { try { return JSON.parse(fs.readFileSync(appsFile(sun), 'utf8')); } catch { return {}; } };
  // Déclare le launcher (ou un jeu) dans Sunshine
  ipcMain.handle('x:stream:register', async (_e, gameId) => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    const g = gameId ? findGame(gameId) : null;
    if (gameId && !g) return { ok: false, error: 'Jeu introuvable' };
    const entry = appEntry(selfExe(), g);
    try {
      const r = addApp(readApps(sun), entry);
      const w = await writeApps(sun, r.json);
      log(`stream : « ${entry.name} » ${r.added ? 'ajouté à' : 'mis à jour dans'} Sunshine${w.elevated ? ' (administrateur)' : ''}`);
      return { ok: true, name: entry.name, added: r.added, restarted: w.restarted };
    } catch (e) {
      return { ok: false, error: e.code === 'UAC' ? 'Autorisation administrateur refusée : réessaie et accepte la fenêtre Windows.' : `Écriture impossible : ${e.message}`, manual: { name: entry.name, cmd: entry.cmd, dir: entry['working-dir'] } };
    }
  });
  ipcMain.handle('x:stream:unregister', async (_e, name) => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    try {
      const r = removeApp(readApps(sun), String(name));
      await writeApps(sun, r.json);
      return { ok: true, removed: r.removed };
    } catch (e) { return { ok: false, error: e.code === 'UAC' ? 'Autorisation administrateur refusée' : e.message }; }
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
}

module.exports = { init, isLocalHost, elevatedScript, portOpen, waitPort, launchArg, sunshineCandidates, moonlightCandidates, localAddresses, appEntry, addApp, removeApp, moonlightArgs, SUNSHINE_UI };

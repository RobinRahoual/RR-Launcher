// STREAM — streaming vers un autre écran (TV, Steam Deck, téléphone, autre PC) en un clic, avec Sunshine (serveur) et
// Moonlight (client). Le launcher ne diffuse rien lui-même : il détecte / démarre Sunshine, ouvre son interface
// d'appairage, donne les adresses à saisir dans Moonlight, et déclare « RR Launcher » (ou un jeu précis) comme application
// Sunshine. Un jeu déclaré se lance avec « RR Launcher.exe --launch=<id> » (géré par main.js, voir launchArg()).
// Sunshine : https://github.com/LizardByte/Sunshine — Moonlight : https://moonlight-stream.org
// Canaux : x:stream:status | start | openUi | install | register | unregister | moonlight.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SUNSHINE_UI = 'https://localhost:47990';
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
const moonlightArgs = (host, app) => ['stream', host, app || 'Desktop'];

function init(ctx) {
  const { ipcMain, store, findGame, log } = ctx;
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
      addresses: localAddresses(), registered, selfExe: selfExe() };
  }
  ipcMain.handle('x:stream:status', () => status());
  ipcMain.handle('x:stream:install', () => { shell.openExternal(SUNSHINE_RELEASES); return true; });
  ipcMain.handle('x:stream:installMoonlight', () => { shell.openExternal(MOONLIGHT_SITE); return true; });
  ipcMain.handle('x:stream:openUi', () => { shell.openExternal(SUNSHINE_UI); return true; });
  ipcMain.handle('x:stream:start', async () => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    if (!isRunning(sun)) {
      try { const c = spawn(sun, [], { cwd: path.win32.dirname(sun), detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); log('stream : Sunshine démarré'); }
      catch (e) { return { ok: false, error: `Démarrage impossible : ${e.message}` }; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return status();
  });
  // Déclare le launcher (ou un jeu) dans Sunshine. Sans droit d'écriture (Program Files) : renvoie la commande à saisir à la main.
  ipcMain.handle('x:stream:register', (_e, gameId) => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    const g = gameId ? findGame(gameId) : null;
    if (gameId && !g) return { ok: false, error: 'Jeu introuvable' };
    const entry = appEntry(selfExe(), g);
    try {
      let json = {};
      try { json = JSON.parse(fs.readFileSync(appsFile(sun), 'utf8')); } catch {}
      const r = addApp(json, entry);
      fs.writeFileSync(appsFile(sun), JSON.stringify(r.json, null, 2));
      log(`stream : « ${entry.name} » ${r.added ? 'ajouté à' : 'mis à jour dans'} Sunshine`);
      return { ok: true, name: entry.name, added: r.added, restart: true };
    } catch (e) {
      return { ok: false, error: 'Sunshine est installé dans un dossier protégé : ajoute l’application à la main (Applications → Ajouter) avec la commande ci-dessous.', manual: { name: entry.name, cmd: entry.cmd, dir: entry['working-dir'] }, code: e.code };
    }
  });
  ipcMain.handle('x:stream:unregister', (_e, name) => {
    const sun = find(sunshineCandidates());
    if (!sun) return { ok: false, error: 'Sunshine n’est pas installé' };
    try {
      const r = removeApp(JSON.parse(fs.readFileSync(appsFile(sun), 'utf8')), String(name));
      fs.writeFileSync(appsFile(sun), JSON.stringify(r.json, null, 2));
      return { ok: true, removed: r.removed };
    } catch (e) { return { ok: false, error: e.code === 'EPERM' || e.code === 'EACCES' ? 'Dossier protégé : retire-la dans l’interface de Sunshine' : e.message }; }
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

module.exports = { init, launchArg, sunshineCandidates, moonlightCandidates, localAddresses, appEntry, addApp, removeApp, moonlightArgs, SUNSHINE_UI };

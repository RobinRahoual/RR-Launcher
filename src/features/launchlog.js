// LAUNCHLOG — journal de lancement : pour chaque lancement, la commande exacte (exécutable, arguments, dossier,
// noms des variables d'environnement — jamais leurs valeurs), le résultat (erreur de démarrage) et la sortie du
// processus (code, signal, durée). Sert à comprendre pourquoi un émulateur plante ou ne démarre pas.
// Fichier : <données>/launch-log.jsonl (une ligne JSON par évènement, rotation automatique).
// Évènements du hub (émis par main.js) : 'launch:cmd' (id, info), 'launch:note' (id, texte), 'launch:error' (id, message), 'launch:exit' (id, { code, signal }).
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;

function append(file, rec, { maxBytes = MAX_BYTES, fsx = fs } = {}) {
  try {
    fsx.mkdirSync(path.dirname(file), { recursive: true });
    fsx.appendFileSync(file, JSON.stringify(rec) + '\n');
    const size = fsx.statSync(file).size;
    if (size > maxBytes) { // on garde les ~60 % les plus récents, en repartant d'une ligne entière
      const lines = fsx.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      fsx.writeFileSync(file, lines.slice(Math.floor(lines.length * 0.4)).join('\n') + '\n');
    }
    return true;
  } catch { return false; }
}

function readRecords(file, fsx = fs) {
  let txt = '';
  try { txt = fsx.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* ligne tronquée */ }
  }
  return out;
}

// Fusionne les évènements d'un même lancement (n) → entrées, la plus récente d'abord
function fold(records, limit = 200) {
  const byN = new Map();
  for (const r of records) {
    if (!r || r.n == null) continue;
    let e = byN.get(r.n);
    if (!e) { e = { n: r.n, t: r.t }; byN.set(r.n, e); }
    if (r.ev === 'launch') Object.assign(e, r.info, { t: r.t, n: r.n });
    else if (r.ev === 'error') e.error = r.error;
    else if (r.ev === 'note') (e.notes ||= []).push(r.note);
    else if (r.ev === 'exit') { e.exit = { code: r.code, signal: r.signal }; e.seconds = r.seconds; }
  }
  return [...byN.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

const quote = (a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));
function commandLine(e) { return [e.file, ...(e.args || [])].filter((x) => x != null && x !== '').map(quote).join(' '); }

// Statut lisible : 'ok' | 'error' | 'crash' | 'running'
function statusOf(e) {
  if (e.error) return 'error';
  if (e.exit) {
    if (e.exit.signal) return 'crash';
    if (e.exit.code != null && e.exit.code !== 0 && e.seconds != null && e.seconds < 20) return 'crash'; // sortie anormale et rapide
    return 'ok';
  }
  return 'running';
}

function report(entries, { version = '', platform = process.platform } = {}) {
  const lines = [`RR Launcher ${version} — journal de lancement (${platform})`, ''];
  for (const e of entries) {
    lines.push(`[${new Date(e.t).toISOString()}] ${e.name || e.id} (${e.platformName || e.platform || '?'}) — ${statusOf(e)}`);
    lines.push(`  via : ${e.via || '?'}${e.admin ? ' (administrateur)' : ''}`);
    lines.push(`  commande : ${commandLine(e)}`);
    if (e.cwd) lines.push(`  dossier : ${e.cwd}`);
    if (e.env?.length) lines.push(`  variables : ${e.env.join(', ')}`);
    for (const n of e.notes || []) lines.push(`  note : ${n}`);
    if (e.error) lines.push(`  erreur : ${e.error}`);
    if (e.exit) lines.push(`  sortie : code ${e.exit.code ?? '—'}${e.exit.signal ? ', signal ' + e.exit.signal : ''}${e.seconds != null ? `, après ${e.seconds} s` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function init(ctx) {
  const { ipcMain, hub, findGame, DATA, log } = ctx;
  const file = path.join(DATA, 'launch-log.jsonl');
  const BY_ID = () => require('../platforms').BY_ID;
  const open = new Map(); // id → { n, at }
  let counter = readRecords(file).reduce((m, r) => Math.max(m, r.n || 0), 0);
  const now = () => Date.now();

  hub.on('launch:cmd', (id, info = {}) => {
    const g = findGame(id);
    const n = ++counter;
    open.set(id, { n, at: now() });
    append(file, { n, t: now(), ev: 'launch', info: {
      id, name: g?.name, platform: g?.platform, platformName: BY_ID()[g?.platform]?.name,
      via: info.via, file: info.file, args: (info.args || []).map(String), cwd: info.cwd, admin: !!info.admin, env: info.env || [],
    } });
  });
  hub.on('launch:error', (id, message) => {
    const o = open.get(id);
    if (!o) { // échec avant la construction de la commande (jeu introuvable, émulateur absent…)
      const g = findGame(id), n = ++counter;
      append(file, { n, t: now(), ev: 'launch', info: { id, name: g?.name, platform: g?.platform, platformName: BY_ID()[g?.platform]?.name, via: 'refus', file: g?.romPath || g?.exePath || '', args: [] } });
      append(file, { n, t: now(), ev: 'error', error: String(message || 'échec') });
      return;
    }
    append(file, { n: o.n, t: now(), ev: 'error', error: String(message || 'échec') });
    open.delete(id);
  });
  hub.on('launch:note', (id, note) => { const o = open.get(id); if (o) append(file, { n: o.n, t: now(), ev: 'note', note: String(note) }); });
  hub.on('launch:exit', (id, { code, signal } = {}) => {
    const o = open.get(id);
    if (!o) return;
    append(file, { n: o.n, t: now(), ev: 'exit', code: code ?? null, signal: signal || null, seconds: Math.round((now() - o.at) / 1000) });
    open.delete(id);
  });

  const list = (limit) => fold(readRecords(file), Math.max(1, Math.min(500, Number(limit) || 100))).map((e) => ({ ...e, status: statusOf(e), commandLine: commandLine(e) }));
  ipcMain.handle('x:launchlog:list', (_e, limit) => list(limit));
  ipcMain.handle('x:launchlog:clear', () => { try { fs.rmSync(file, { force: true }); } catch {} open.clear(); return true; });
  ipcMain.handle('x:launchlog:export', async () => {
    const { dialog, app } = require('electron');
    const r = await dialog.showSaveDialog(ctx.getWin(), { title: 'Exporter le journal de lancement', defaultPath: 'rr-launcher-journal.txt', filters: [{ name: 'Texte', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, report(fold(readRecords(file), 200), { version: app.getVersion() }));
    log(`journal de lancement exporté : ${r.filePath}`);
    return { ok: true, path: r.filePath };
  });
}

module.exports = { init, append, readRecords, fold, report, commandLine, statusOf, MAX_BYTES };

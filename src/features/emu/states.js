// EMU — sauvegardes d'état : raccourcis clavier par émulateur + commandes réseau RetroArch (UDP 55355).
// Raccourcis par défaut (vérifiés : wiki PCSX2, doc Dolphin, aide PPSSPP ; DuckStation : défauts du code source
// F1 charger / F2 sauver / F3-F4 emplacement ; Azahar : héritage Citra, à confirmer). Modifiables dans les réglages
// (settings.emuHotkeys[kind] = { save, load, prev, next }). « {slot} » = numéro d'emplacement géré par le launcher.
'use strict';
const dgram = require('dgram');

const HOTKEYS = {
  retroarch: { save: 'F2', load: 'F4', prev: 'F6', next: 'F7', slots: [0, 9], net: true },
  pcsx2: { save: 'F1', load: 'F3', prev: 'Shift+F2', next: 'F2', slots: [0, 9] },
  duckstation: { save: 'F2', load: 'F1', prev: 'F3', next: 'F4', slots: [1, 10] },
  ppsspp: { save: 'F2', load: 'F4', next: 'F3', slots: [0, 4] },
  dolphin: { save: 'Shift+F{slot}', load: 'F{slot}', slots: [1, 8] },
  melonds: { save: 'Shift+F{slot}', load: 'F{slot}', slots: [1, 8] },
  mgba: { save: 'Shift+F{slot}', load: 'F{slot}', slots: [1, 9] },
  snes9x: { save: 'Shift+F{slot}', load: 'F{slot}', slots: [1, 9] },
  mesen: { save: 'Shift+F{slot}', load: 'F{slot}', slots: [1, 7] },
  project64: { save: 'F5', load: 'F7', set: '{slot}', slots: [0, 9] },
  azahar: { save: 'Ctrl+C', load: 'Ctrl+V', slots: [1, 1], unverified: true },
};
const LABELS = { retroarch: 'RetroArch', pcsx2: 'PCSX2', duckstation: 'DuckStation', ppsspp: 'PPSSPP', dolphin: 'Dolphin', melonds: 'melonDS', mgba: 'mGBA', snes9x: 'Snes9x', mesen: 'Mesen', project64: 'Project64', azahar: 'Azahar' };

function table(kind, overrides = {}) {
  const base = HOTKEYS[kind];
  if (!base) return null;
  const o = overrides[kind] || {};
  const t = { ...base };
  for (const k of ['save', 'load', 'prev', 'next']) if (typeof o[k] === 'string' && o[k].trim()) t[k] = o[k].trim();
  return t;
}

const VK = { CTRL: 0x11, CONTROL: 0x11, SHIFT: 0x10, ALT: 0x12, SPACE: 0x20, TAB: 0x09, ENTER: 0x0d, ESC: 0x1b,
  INSERT: 0x2d, DELETE: 0x2e, HOME: 0x24, END: 0x23, PAGEUP: 0x21, PAGEDOWN: 0x22, UP: 0x26, DOWN: 0x28, LEFT: 0x25, RIGHT: 0x27 };
function parseKeys(str, slot = 1) {
  const vks = [];
  for (const raw of String(str || '').replace(/\{slot\}/g, String(slot)).split('+').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (VK[raw]) vks.push(VK[raw]);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(raw)) vks.push(0x6f + Number(raw.slice(1)));
    else if (/^[A-Z0-9]$/.test(raw)) vks.push(raw.charCodeAt(0));
    else return null;
  }
  return vks.length ? vks : null;
}

// Séquence de touches pour une action, en rattrapant l'emplacement voulu (want) depuis celui de l'émulateur (cur).
// → { steps: [vks…], slot } | null
function plan(t, action, cur, want) {
  if (!t || !t[action]) return null;
  const steps = [];
  const [lo, hi] = t.slots;
  want = Math.max(lo, Math.min(hi, want));
  if (!/\{slot\}/.test(t[action]) && cur !== want) {
    if (t.set) steps.push(parseKeys(t.set, want));
    else {
      const n = hi - lo + 1;
      let up = ((want - cur) % n + n) % n, down = n - up;
      if (!t.prev) down = Infinity;
      if (!t.next) up = Infinity;
      const [key, cnt] = up <= down ? [t.next, up] : [t.prev, down];
      if (key && Number.isFinite(cnt)) for (let i = 0; i < cnt; i++) steps.push(parseKeys(key));
    }
  }
  steps.push(parseKeys(t[action], want));
  if (steps.some((s) => !s)) return null;
  return { steps, slot: want };
}

// ---- RetroArch : commandes réseau (network_cmd_enable = "true", port 55355)
function udp(cmd, { port = 55355, host = '127.0.0.1', expectReply = false, timeout = 500 } = {}) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    let done = false;
    const end = (v) => { if (done) return; done = true; try { s.close(); } catch {} resolve(v); };
    s.on('error', () => end(expectReply ? null : false));
    s.on('message', (m) => end(String(m).trim()));
    s.send(Buffer.from(cmd + '\n'), port, host, (err) => {
      if (err) return end(expectReply ? null : false);
      if (!expectReply) end(true);
    });
    if (expectReply) setTimeout(() => end(null), timeout);
  });
}
// Commandes nécessaires pour passer de l'emplacement cur à want puis agir
function netCommands(action, cur, want) {
  const out = [];
  const d = want - cur;
  for (let i = 0; i < Math.abs(d); i++) out.push(d > 0 ? 'STATE_SLOT_PLUS' : 'STATE_SLOT_MINUS');
  out.push(action === 'save' ? 'SAVE_STATE' : 'LOAD_STATE');
  return out;
}
async function retroarchNet(action, cur, want, opts = {}) {
  const st = await udp('GET_STATUS', { ...opts, expectReply: true });
  if (!st) return { ok: false, error: 'NO_NET' };
  if (/CONTENTLESS/.test(st)) return { ok: false, error: 'Aucun jeu chargé dans RetroArch' };
  for (const c of netCommands(action, cur, want)) { await udp(c, opts); await new Promise((r) => setTimeout(r, 40)); }
  return { ok: true, via: 'net', slot: want };
}

// retroarch.cfg : active les commandes réseau (crée le fichier s'il n'existe pas ; RetroArch complète le reste)
function enableNetCmd(cfgText = '') {
  let t = String(cfgText);
  const set = (k, v) => {
    const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm');
    t = re.test(t) ? t.replace(re, `${k} = "${v}"`) : `${t}${t && !t.endsWith('\n') ? '\n' : ''}${k} = "${v}"\n`;
  };
  set('network_cmd_enable', 'true');
  set('network_cmd_port', '55355');
  return t;
}
const netEnabled = (cfgText) => /^\s*network_cmd_enable\s*=\s*"true"/m.test(String(cfgText || ''));

// ---- Reprise du dernier état au lancement
// info = résultat de infoFor() (emu.js). g.lastState = { slot, at } est posé à chaque sauvegarde faite via le launcher :
// sans elle, rien à reprendre. g.launch.resume : 'default' | 'on' | 'off' ; réglage global settings.emuResume.
function resumePlan(g, settings = {}, info = null) {
  if (!g || g.kind !== 'rom' || !info?.supported) return { resume: false, reason: 'unsupported' };
  const mode = g.launch?.resume || 'default';
  if (!(mode === 'on' || (mode === 'default' && settings.emuResume === true))) return { resume: false, reason: 'off' };
  if (!g.lastState) return { resume: false, reason: 'no-state' };
  if (info.admin && !info.net) return { resume: false, reason: 'admin' }; // Windows bloque l'envoi de touches vers un processus élevé
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const slot = clamp(Number.isFinite(Number(g.lastState.slot)) ? Number(g.lastState.slot) : info.min, info.min, info.max);
  const delaySec = clamp(Number(settings.emuResumeDelay) || 6, 2, 30);
  return { resume: true, slot, delayMs: delaySec * 1000, tries: info.kind === 'retroarch' && info.net ? 8 : 1 };
}

module.exports = { resumePlan, HOTKEYS, LABELS, table, parseKeys, plan, udp, netCommands, retroarchNet, enableNetCmd, netEnabled };

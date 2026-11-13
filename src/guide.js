// RR Launcher — bouton Guide de la manette (Xbox / PS / Home) détecté dans le processus principal.
//
// Pourquoi ici et pas dans le renderer : l'API Gamepad de Chromium ne reçoit rien quand la fenêtre
// n'a pas le focus (launcher masqué pendant le jeu) et, sous Windows, n'expose pas le bouton Xbox.
//
// Sources :
//  - XInput (manettes Xbox et la plupart des manettes PC) : XInputGetStateEx (native-win.js).
//  - HID (DualShock 4, DualSense, Switch Pro) en USB/Bluetooth via node-hid, lecture passive des
//    rapports d'entrée (aucune écriture vers la manette).
//
// Tout est optionnel : si un module natif ne charge pas, la source est simplement désactivée (log).
// Les boutons sont ramenés au format XInput (masque 16 bits) pour un traitement unique.
'use strict';
const { createPresence, createWakeGate, xinputKeys, hidPadKeys } = require('./padwake'); // WAKE

// ---------------------------------------------------------------- Masques (format XInput)
const BTN = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020,
  LB: 0x0100, RB: 0x0200, // CAPTURE : gâchettes hautes (XInput LEFT/RIGHT_SHOULDER)
  GUIDE: 0x0400,
  SHARE: 0x0800, // CAPTURE : bit libre d'XInput, pseudo-bouton « Share / Create / Capture » (manettes HID)
  A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
};
// Boutons relayés au renderer quand le menu en jeu est ouvert mais que la fenêtre n'a pas le focus
const REMOTE = [
  [BTN.UP, 'up'], [BTN.DOWN, 'down'], [BTN.LEFT, 'left'], [BTN.RIGHT, 'right'],
  [BTN.A, 'a'], [BTN.B, 'b'], [BTN.START, 'menu'],
];

// ---------------------------------------------------------------- Identification HID
const SONY = 0x054c, NINTENDO = 0x057e;
const HID_KINDS = {
  [`${SONY}:${0x05c4}`]: 'ds4', // DualShock 4 v1
  [`${SONY}:${0x09cc}`]: 'ds4', // DualShock 4 v2
  [`${SONY}:${0x0ba0}`]: 'ds4', // adaptateur sans fil DS4
  [`${SONY}:${0x0ce6}`]: 'dualsense',
  [`${SONY}:${0x0df2}`]: 'dualsense', // DualSense Edge
  [`${NINTENDO}:${0x2009}`]: 'switchpro',
};
function hidKind(vendorId, productId) {
  return HID_KINDS[`${vendorId}:${productId}`] || null;
}

// Croix directionnelle « hat » (0 = haut, sens horaire, 8+ = relâchée) → masque
const HAT = [BTN.UP, BTN.UP | BTN.RIGHT, BTN.RIGHT, BTN.DOWN | BTN.RIGHT, BTN.DOWN, BTN.DOWN | BTN.LEFT, BTN.LEFT, BTN.UP | BTN.LEFT];
const hat = (v) => HAT[v & 0x0f] || 0;

// Octet « boutons 1 » Sony (DS4 et DualSense) : bits 0-3 = hat, 0x10 carré, 0x20 croix, 0x40 rond, 0x80 triangle.
// Croix = A (valider), rond = B (retour), comme sur PC / Xbox.
function sonyFace(b) {
  let m = hat(b);
  if (b & 0x10) m |= BTN.X;
  if (b & 0x20) m |= BTN.A;
  if (b & 0x40) m |= BTN.B;
  if (b & 0x80) m |= BTN.Y;
  return m;
}

/*
 * Décodage d'un rapport d'entrée HID → masque XInput, ou null si le rapport n'est pas reconnu.
 * `data` commence par l'identifiant de rapport (node-hid le fournit pour les rapports numérotés).
 *
 * CAPTURE : octet « boutons 2 » Sony (o+1) = L1 0x01, R1 0x02, L2 0x04, R2 0x08, SHARE/CREATE 0x10,
 *   OPTIONS 0x20, L3 0x40, R3 0x80 → L1 = LB, R1 = RB, SHARE/CREATE = BACK + SHARE.
 *   Switch Pro : 0x30 [3] R 0x40, [5] L 0x40, [4] CAPTURE 0x20 ; 0x3F [1] L 0x10 R 0x20, [2] CAPTURE 0x20.
 *   Le bouton « − » de la Switch reste BACK (pas SHARE) : seul le bouton Capture fait une capture.
 *
 * DualShock 4
 *   USB  0x01 (64 o)          : [5] hat+face, [6] L1 R1 L2 R2 SHARE 0x10 OPTIONS 0x20, [7] bit0 = PS
 *   BT   0x01 réduit (≈10 o)  : même disposition que l'USB (mode par défaut avant activation complète)
 *   BT   0x11…0x19            : même disposition décalée de +2 → [7] face, [8] options, [9] bit0 = PS
 * DualSense
 *   USB  0x01 (64 o)          : [8] hat+face, [9] L1 R1 L2 R2 CREATE 0x10 OPTIONS 0x20, [10] bit0 = PS
 *   BT   0x01 réduit (≈10 o)  : [5] hat+face, [6] options 0x20, [7] bit0 = PS
 *   BT   0x31 (78 o)          : USB décalé de +1 → [9] face, [10] options, [11] bit0 = PS
 * Switch Pro
 *   0x30 complet (USB après poignée de main, BT) : [3] Y 0x01 X 0x02 B 0x04 A 0x08,
 *                               [4] − 0x01 + 0x02 HOME 0x10, [5] bas 0x01 haut 0x02 droite 0x04 gauche 0x08
 *   0x3F simple (BT par défaut) : [1] B 0x01 A 0x02 Y 0x04 X 0x08, [2] − 0x01 + 0x02 HOME 0x10, [3] hat
 *   Disposition Nintendo : A (à droite) = valider, B (en bas) = retour.
 *   En USB, la Switch Pro n'envoie rien tant qu'un programme (Steam…) n'a pas fait la poignée de
 *   main : RR Launcher n'écrit jamais vers la manette, il lit seulement.
 */
function decodeHidReport(kind, data) {
  if (!data || data.length < 4) return null;
  const id = data[0];
  const len = data.length;
  if (kind === 'ds4' || kind === 'dualsense') {
    let o; // index de l'octet « hat + face »
    if (kind === 'ds4') {
      if (id === 0x01 && len >= 8) o = 5;
      else if (id >= 0x11 && id <= 0x19 && len >= 10) o = 7;
    } else {
      if (id === 0x01 && len > 12) o = 8; // USB complet
      else if (id === 0x01 && len >= 8) o = 5; // BT réduit
      else if (id === 0x31 && len >= 12) o = 9;
    }
    if (o == null) return null;
    let m = sonyFace(data[o]);
    if (data[o + 1] & 0x20) m |= BTN.START;
    if (data[o + 1] & 0x10) m |= BTN.BACK | BTN.SHARE; // CAPTURE : Share (DS4) / Create (DualSense)
    if (data[o + 1] & 0x01) m |= BTN.LB; // CAPTURE : L1
    if (data[o + 1] & 0x02) m |= BTN.RB; // CAPTURE : R1
    if (data[o + 2] & 0x01) m |= BTN.GUIDE;
    return m;
  }
  if (kind === 'switchpro') {
    let m = 0, s;
    if (id === 0x30 && len >= 6) {
      const r = data[3], l = data[5];
      s = data[4];
      if (r & 0x08) m |= BTN.A;
      if (r & 0x04) m |= BTN.B;
      if (r & 0x02) m |= BTN.X;
      if (r & 0x01) m |= BTN.Y;
      if (l & 0x01) m |= BTN.DOWN;
      if (l & 0x02) m |= BTN.UP;
      if (l & 0x04) m |= BTN.RIGHT;
      if (l & 0x08) m |= BTN.LEFT;
      if (r & 0x40) m |= BTN.RB; // CAPTURE : R
      if (l & 0x40) m |= BTN.LB; // CAPTURE : L
    } else if (id === 0x3f && len >= 4) {
      const f = data[1];
      s = data[2];
      m = hat(data[3]);
      if (f & 0x02) m |= BTN.A;
      if (f & 0x01) m |= BTN.B;
      if (f & 0x08) m |= BTN.X;
      if (f & 0x04) m |= BTN.Y;
      if (f & 0x10) m |= BTN.LB; // CAPTURE : L
      if (f & 0x20) m |= BTN.RB; // CAPTURE : R
    } else return null;
    if (s & 0x02) m |= BTN.START;
    if (s & 0x01) m |= BTN.BACK;
    if (s & 0x10) m |= BTN.GUIDE;
    if (s & 0x20) m |= BTN.SHARE; // CAPTURE : bouton Capture
    return m;
  }
  return null;
}

// ---------------------------------------------------------------- Anti-rebond
// Détecteur de fronts par source : un appui = un événement, le maintien est ignoré.
// Un nouvel appui du même bouton n'est accepté qu'après `minGapMs` depuis le précédent
// (filtre les rebonds de contact et les rapports qui oscillent).
function makeEdges({ minGapMs = 150 } = {}) {
  const prev = new Map(); // source -> masque précédent
  const lastDown = new Map(); // `${source}:${bit}` -> instant du dernier front montant accepté
  return {
    // Renvoie le masque des boutons qui viennent d'être enfoncés
    feed(source, mask, now = Date.now()) {
      const before = prev.get(source) || 0;
      prev.set(source, mask);
      let down = mask & ~before;
      if (!down) return 0;
      for (let bit = 1; bit <= 0x8000; bit <<= 1) {
        if (!(down & bit)) continue;
        const k = `${source}:${bit}`;
        if (now - (lastDown.get(k) ?? -Infinity) < minGapMs) down &= ~bit;
        else lastDown.set(k, now);
      }
      return down;
    },
    forget(source) { prev.delete(source); },
    reset() { prev.clear(); lastDown.clear(); },
  };
}

// ---------------------------------------------------------------- CAPTURE : combinaisons avec le bouton Guide
/*
 * Machine à états pure (une par source), alimentée avec le masque complet à chaque rapport :
 *   Guide appuyé            → « maintien » (rien n'est émis tout de suite)
 *   + RB / LB / B pendant   → 'capture' / 'clip' / 'quit' (plusieurs possibles pendant un même maintien)
 *   maintien ≥ longMs       → 'power' (une fois, via feed ou tick ; aussi au relâchement si aucun tick)
 *   relâché < longMs seul   → 'guide' (comportement historique : menu en jeu)
 *   SHARE seul (hors maintien) → 'share'
 * Une combinaison n'émet jamais 'guide' : le menu en jeu ne s'ouvre pas en plus de la capture.
 * Anti-rebond : un front montant d'un même bouton n'est accepté que `minGapMs` après le précédent,
 * et un nouvel appui Guide moins de `guideCooldownMs` après un relâchement est ignoré.
 */
const COMBOS = [[BTN.RB, 'capture'], [BTN.LB, 'clip'], [BTN.B, 'quit'], [BTN.Y, 'stream']]; // DISCORD : Guide + Y = stream
function createComboMachine({ longMs = 1000, minGapMs = 150, guideCooldownMs = 120 } = {}) {
  let prev = 0, held = false, t0 = 0, used = false, lastRelease = -Infinity;
  const lastDown = new Map();
  function rising(mask, now) {
    let down = mask & ~prev;
    for (let bit = 1; bit <= 0x8000; bit <<= 1) {
      if (!(down & bit)) continue;
      if (now - (lastDown.get(bit) ?? -Infinity) < minGapMs) down &= ~bit;
      else lastDown.set(bit, now);
    }
    return down;
  }
  return {
    feed(mask, now = Date.now()) {
      const ev = [];
      const down = rising(mask, now);
      prev = mask;
      if (held) {
        for (const [bit, name] of COMBOS) if (down & bit) { ev.push(name); used = true; }
        if (!(mask & BTN.GUIDE)) {
          held = false;
          lastRelease = now;
          if (!used) ev.push(now - t0 >= longMs ? 'power' : 'guide');
        } else if (!used && now - t0 >= longMs) { used = true; ev.push('power'); }
      } else if ((down & BTN.GUIDE) && now - lastRelease >= guideCooldownMs) {
        held = true; t0 = now; used = false;
      } else if (down & BTN.SHARE) ev.push('share');
      return ev;
    },
    // À appeler pendant un maintien sans nouveau rapport (Switch Pro 0x3F : rapports sur changement seulement)
    tick(now = Date.now()) {
      if (held && !used && now - t0 >= longMs) { used = true; return ['power']; }
      return [];
    },
    get holding() { return held; },
    reset() { prev = 0; held = false; used = false; lastDown.clear(); },
  };
}

// ---------------------------------------------------------------- Surveillance
/*
 * createGuideWatcher({ log, onGuide, onRemote, wantRemote, onConnect })
 *   start() / stop()   : mode « Guide » — sondage XInput (~66 ms) + ouverture des manettes HID
 *   setConnect(bool)   : WAKE, mode « connexion » — signale l'arrivée d'une manette (onConnect) :
 *                        XInput sondé ~1 s si le mode Guide est arrêté, HID par devices() toutes les ~2 s
 *                        SANS ouvrir les périphériques. Les deux modes partagent les mêmes boucles.
 *   status()           : { xinput, hid, devices } pour l'aide des réglages
 * CAPTURE : options onCombo(nom, source) et combos() → bool. Quand combos() est vrai (pendant un jeu,
 * launcher non actif), le Guide passe par createComboMachine : 'guide' (appui court, relâché) → onGuide,
 * 'capture' | 'clip' | 'quit' | 'power' | 'share' → onCombo. Sinon : comportement historique (onGuide à l'appui).
 * Plusieurs sources peuvent voir le même appui (ex. DualSense lue en HID + exposée en XInput par
 * Steam/DS4Windows) : on ne garde qu'un appui Guide toutes les 400 ms, toutes sources confondues.
 */
function createGuideWatcher({
  log = () => {}, onGuide, onRemote, wantRemote = () => false, onConnect,
  onCombo, combos = () => true, longMs = 1000, // CAPTURE
  pollMs = 66, connectPollMs = 1000, hidScanMs = 2000, wakeCooldownMs = 10000,
  loadNative: loadNativeOpt, loadHid: loadHidOpt,
}) {
  const edges = makeEdges();
  const presence = createPresence(); // WAKE
  const gate = createWakeGate({ cooldownMs: wakeCooldownMs }); // WAKE
  let native = null, nativeErr = null, HID = null, hidErr = null;
  let timer = null, timerMs = 0, scanTimer = null, lastGuide = 0;
  let guideOn = false, connectOn = false;
  const hidOpen = new Map(); // path -> device (null = ouverture impossible, ne pas réessayer)

  function loadNative() {
    if (native || nativeErr) return native;
    try {
      if (loadNativeOpt) native = loadNativeOpt();
      else if (process.platform !== 'win32') throw new Error('Windows uniquement');
      else native = require('./native-win');
      if (!native.xinputOk) log(`guide : XInput indisponible (${native.xinputError || '?'})`);
    } catch (e) { native = null; nativeErr = e.message; log(`guide : module natif indisponible (${e.message})`); }
    return native;
  }
  function loadHid() {
    if (HID || hidErr) return HID;
    try { HID = loadHidOpt ? loadHidOpt() : require('node-hid'); }
    catch (e) { hidErr = e.message; log(`guide : node-hid indisponible (${e.message})`); }
    return HID;
  }

  // CAPTURE : une machine à états par source, minuterie d'appui long, dédoublonnage entre sources
  const machines = new Map(), holdTimers = new Map(), lastCombo = new Map();
  function emitCombo(name, source) {
    const now = Date.now();
    if (name === 'guide') {
      if (now - lastGuide < 400) return;
      lastGuide = now;
      try { onGuide?.(source); } catch (e) { log(`guide : ${e.message}`); }
      return;
    }
    if (now - (lastCombo.get(name) ?? -Infinity) < 400) return;
    lastCombo.set(name, now);
    try { onCombo?.(name, source); } catch (e) { log(`guide : combinaison ${name} : ${e.message}`); }
  }
  function comboHandle(source, mask, down) {
    if (source.startsWith('xi') && (mask & BTN.BACK)) mask |= BTN.SHARE; // XInput : View = Share
    let m = machines.get(source);
    if (!m) machines.set(source, (m = createComboMachine({ longMs })));
    const was = m.holding;
    const ev = m.feed(mask, Date.now());
    for (const n of ev) emitCombo(n, source);
    if (m.holding && !was) {
      clearTimeout(holdTimers.get(source));
      holdTimers.set(source, setTimeout(() => { holdTimers.delete(source); for (const n of m.tick(Date.now())) emitCombo(n, source); }, longMs + 20));
    }
    if (!m.holding) { clearTimeout(holdTimers.get(source)); holdTimers.delete(source); }
    if (m.holding || was || ev.length || !down) return; // consommé par la machine
    if (wantRemote()) for (const [bit, name] of REMOTE) if (down & bit) onRemote?.(name, source);
  }
  function comboReset() {
    for (const t of holdTimers.values()) clearTimeout(t);
    holdTimers.clear(); machines.clear();
  }

  function handle(source, mask) {
    const down = edges.feed(source, mask);
    let combo = false;
    try { combo = !!onCombo && !!combos(); } catch { combo = false; }
    if (combo) return comboHandle(source, mask, down); // CAPTURE
    if (machines.size) comboReset();
    if (!down) return;
    if (down & BTN.GUIDE) {
      const now = Date.now();
      if (now - lastGuide < 400) return;
      lastGuide = now;
      try { onGuide?.(source); } catch (e) { log(`guide : ${e.message}`); }
      return;
    }
    if (wantRemote()) for (const [bit, name] of REMOTE) if (down & bit) onRemote?.(name, source);
  }

  // WAKE : nouvelles manettes pour une source ('xinput' | 'hid')
  function seen(source, keys) {
    if (!connectOn) return;
    const added = presence.update(source, keys);
    if (!added.length) return;
    if (!gate.tryWake()) { log(`manette : ${added.join(', ')} ignorée (réveil récent)`); return; }
    log(`manette : connexion ${added.join(', ')} → ouverture du launcher`);
    try { onConnect?.(added[0]); } catch (e) { log(`manette : ${e.message}`); }
  }

  function pollXInput() {
    if (!native?.xinputOk) return;
    let states;
    try { states = native.xinputButtons(); } catch (e) { log(`guide : XInput ${e.message}`); native.xinputOk = false; return; }
    if (guideOn) {
      for (let i = 0; i < 4; i++) {
        if (states[i] == null) { edges.forget('xi' + i); machines.delete('xi' + i); } // CAPTURE
        else handle('xi' + i, states[i]);
      }
    }
    seen('xinput', xinputKeys(states));
  }

  function closeHid(p) {
    const dev = hidOpen.get(p);
    hidOpen.delete(p);
    edges.forget('hid:' + p);
    machines.delete('hid:' + p); // CAPTURE
    try { dev?.removeAllListeners?.('data'); dev?.close(); } catch {}
  }
  let scanning = false;
  async function scanHid() {
    if (!HID || !(guideOn || connectOn) || scanning) return;
    scanning = true;
    try {
      let list = [];
      try { list = HID.devicesAsync ? await HID.devicesAsync() : HID.devices(); } catch (e) { log(`guide : HID ${e.message}`); return; }
      seen('hid', hidPadKeys(list, hidKind)); // WAKE : liste seule, sans ouvrir
      if (guideOn) for (const d of list) {
        const kind = hidKind(d.vendorId, d.productId);
        if (!kind || !d.path || hidOpen.has(d.path) || !guideOn) continue;
        // Interface « manette » uniquement (usage page 1, usage 4/5) quand l'info existe
        if (d.usagePage && (d.usagePage !== 1 || (d.usage !== 4 && d.usage !== 5))) continue;
        try {
          const dev = HID.HIDAsync ? await HID.HIDAsync.open(d.path) : new HID.HID(d.path);
          if (!guideOn) { try { dev.close(); } catch {} return; }
          const src = 'hid:' + d.path;
          hidOpen.set(d.path, dev);
          log(`guide : manette HID ouverte (${kind}, ${d.product || 'sans nom'})`);
          dev.on('data', (buf) => {
            const m = decodeHidReport(kind, buf);
            if (m != null) handle(src, m);
          });
          dev.on('error', () => closeHid(d.path));
        } catch (e) {
          hidOpen.set(d.path, null);
          log(`guide : ouverture HID impossible (${kind}) : ${e.message}`);
        }
      }
      // Chemins disparus (manette débranchée) : on oublie, pour pouvoir la rouvrir plus tard
      const present = new Set(list.map((d) => d.path));
      for (const p of [...hidOpen.keys()]) if (!present.has(p)) closeHid(p);
    } finally { scanning = false; }
  }

  // Ajuste les boucles aux modes demandés (une seule boucle XInput, une seule boucle HID)
  function apply() {
    const active = guideOn || connectOn;
    if (active) { loadNative(); loadHid(); }
    const ms = guideOn ? pollMs : connectOn ? connectPollMs : 0;
    if (ms !== timerMs || (ms && !timer && native?.xinputOk)) {
      clearInterval(timer); timer = null; timerMs = ms;
      if (ms && native?.xinputOk) timer = setInterval(pollXInput, ms);
    }
    if (active && HID && !scanTimer) { scanTimer = setInterval(scanHid, hidScanMs); scanHid(); }
    if (!active && scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (!guideOn) { for (const p of [...hidOpen.keys()]) closeHid(p); edges.reset(); comboReset(); }
    if (!connectOn) presence.reset();
  }

  return {
    start() { if (guideOn) return; guideOn = true; apply(); if (HID) scanHid(); },
    stop() { if (!guideOn) return; guideOn = false; apply(); },
    // WAKE : surveillance des connexions (l'état présent au démarrage sert de référence)
    setConnect(on) {
      on = !!on;
      if (on === connectOn) return;
      connectOn = on;
      apply();
      if (on) { log('manette : surveillance des connexions active'); if (native?.xinputOk) pollXInput(); }
    },
    get running() { return guideOn; },
    get connecting() { return connectOn; },
    // Pour les tests : injecter un masque comme s'il venait d'une source
    _feed: handle,
    _seen: seen,
    status() {
      loadNative(); loadHid();
      return {
        platform: process.platform,
        xinput: !!native?.xinputOk,
        hid: !!HID,
        devices: [...hidOpen.values()].filter(Boolean).length,
        connect: connectOn,
        error: nativeErr || native?.xinputError || hidErr || null,
      };
    },
  };
}

module.exports = { BTN, hidKind, decodeHidReport, makeEdges, createComboMachine, createGuideWatcher };

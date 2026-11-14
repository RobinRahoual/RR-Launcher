/* Sons d'interface synthétisés, dans l'esprit d'un menu de console (doux, aérés, avec réverbération).
   Aucun échantillon externe : tout est généré avec Web Audio. */
'use strict';

const Sfx = (() => {
  let ctx, master, wet, dry, verb, enabled = true, volume = 0.35;

  function init() {
    if (ctx) return true;
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime); // montée douce : jamais de claque dans les oreilles au premier son
      master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.2);
      master.connect(ctx.destination);
      dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(master);
      wet = ctx.createGain(); wet.gain.value = 0.35;
      verb = ctx.createConvolver();
      verb.buffer = impulse(1.8, 2.6);
      wet.connect(verb).connect(master);
      return true;
    } catch { return false; }
  }

  function impulse(seconds, decay) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function out(node, wetAmt = 0.35) {
    node.connect(dry);
    const w = ctx.createGain();
    w.gain.value = wetAmt;
    node.connect(w).connect(wet);
  }

  // Note sinusoïdale avec enveloppe douce
  function tone(freq, start, dur, gain = 0.05, type = 'sine', wetAmt = 0.4, glide = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    out(g, wetAmt);
    o.start(start); o.stop(start + dur + 0.05);
  }

  // Souffle filtré (whoosh)
  function air(start, dur, from, to, gain = 0.05, q = 1.2) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, start);
    f.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g);
    out(g, 0.5);
    src.start(start); src.stop(start + dur);
  }

  // Petit "tic" feutré (déplacement)
  function tick(start, pitch = 1) {
    tone(2350 * pitch, start, 0.05, 0.022, 'sine', 0.3);
    tone(1180 * pitch, start, 0.07, 0.03, 'triangle', 0.35);
    air(start, 0.05, 5200 * pitch, 3800 * pitch, 0.012, 4);
  }

  const SOUNDS = {
    move: (t) => tick(t, 1),
    moveFast: (t) => tick(t, 1.06),
    tab: (t) => { tick(t, 0.82); air(t, 0.16, 900, 2600, 0.018, 1.5); },
    open: (t) => { // entrer dans une console / ouvrir
      air(t, 0.42, 300, 2400, 0.04, 0.9);
      tone(523.25, t + 0.04, 0.6, 0.035, 'sine', 0.6);
      tone(783.99, t + 0.1, 0.7, 0.03, 'sine', 0.6);
      tone(1046.5, t + 0.16, 0.8, 0.02, 'sine', 0.7);
    },
    confirm: (t) => {
      tone(880, t, 0.22, 0.04, 'sine', 0.5);
      tone(1318.5, t + 0.07, 0.35, 0.035, 'sine', 0.6);
    },
    back: (t) => {
      tone(1046.5, t, 0.14, 0.03, 'sine', 0.45);
      tone(698.46, t + 0.06, 0.22, 0.03, 'sine', 0.5);
      air(t, 0.2, 2400, 500, 0.02, 1.2);
    },
    launch: (t) => { // lancement de jeu
      air(t, 0.9, 200, 3800, 0.05, 0.7);
      [261.63, 329.63, 392, 523.25].forEach((f, i) => tone(f, t + i * 0.05, 1.3, 0.03, 'sine', 0.75));
      tone(1567.98, t + 0.35, 1.0, 0.012, 'sine', 0.9);
    },
    flip: (t) => { air(t, 0.32, 600, 3200, 0.035, 1.1); tick(t + 0.12, 0.9); },
    error: (t) => { tone(196, t, 0.16, 0.05, 'triangle', 0.3); tone(185, t + 0.14, 0.2, 0.05, 'triangle', 0.3); },
    toggle: (t) => { tone(1568, t, 0.06, 0.025, 'sine', 0.3); tone(2093, t + 0.04, 0.08, 0.02, 'sine', 0.35); },
    boxopen: (t) => { // BOXOPEN : loquet du boîtier, couvercle, disque qui prend de la vitesse
      air(t, 0.05, 6000, 3000, 0.03, 3);
      tone(2600, t, 0.04, 0.025, 'triangle', 0.2);
      tone(1700, t + 0.03, 0.05, 0.02, 'triangle', 0.25);
      air(t + 0.24, 0.42, 500, 2600, 0.03, 1);
      tone(220, t + 0.6, 0.75, 0.012, 'sine', 0.5, 6);
      tone(440, t + 0.62, 0.7, 0.008, 'sine', 0.6, 4);
      tone(659.25, t + 1.0, 0.7, 0.02, 'sine', 0.7);
      tone(987.77, t + 1.06, 0.8, 0.016, 'sine', 0.75);
    },
    'boxopen-disc': (t) => SOUNDS.boxopen(t), // BOXOPEN, disque : boîtier + disque qui prend de la vitesse
    'boxopen-cart': (t) => { // BOXOPEN, cartouche : glissement dans la fente puis petit « clac » de la broche
      air(t, 0.2, 800, 3200, 0.04, 1.4);
      tone(1800, t + 0.19, 0.05, 0.03, 'triangle', 0.2);
      air(t + 0.19, 0.035, 4800, 2400, 0.045, 3);
      tone(740, t + 0.19, 0.08, 0.03, 'triangle', 0.25);
      tone(880, t + 0.42, 0.45, 0.012, 'sine', 0.6, 1.5);
    },
    boxclose: (t) => { // BOXOPEN : le couvercle se referme (clac feutré)
      air(t, 0.24, 2400, 500, 0.022, 1.2);
      tone(1046.5, t, 0.12, 0.022, 'sine', 0.4);
      air(t + 0.3, 0.04, 5200, 2600, 0.035, 3);
      tone(1500, t + 0.3, 0.05, 0.03, 'triangle', 0.2);
      tone(620, t + 0.31, 0.08, 0.025, 'triangle', 0.25);
    },
    start: (t) => { // ouverture du launcher
      air(t, 1.6, 150, 1800, 0.035, 0.6);
      [196, 293.66, 392, 587.33].forEach((f, i) => tone(f, t + 0.1 + i * 0.12, 2.2, 0.022, 'sine', 0.85));
    },
  };

  let lastMove = 0;
  function play(name) {
    if (!enabled || !SOUNDS[name] || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.005;
    if (name === 'move' || name === 'moveFast') {
      if (performance.now() - lastMove < 45) return; // évite la bouillie en défilement rapide
      lastMove = performance.now();
    }
    SOUNDS[name](t);
  }

  return {
    play,
    set(on, vol) {
      enabled = !!on;
      if (typeof vol === 'number') { volume = vol; if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(vol, ctx.currentTime); } }
    },
  };
})();

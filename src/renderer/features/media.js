// Module MEDIA — vidéos de présentation, économiseur d'écran, musique d'ambiance.
// Accroches : RR 'selection' | 'view' | 'mode' | 'play' | 'session' | 'input' | 'library', rr.onVisible,
// canaux x:media:* (src/features/media.js). Insertion dans app.js : début d'onPadBtn / onPadDir (// MEDIA).
// Réglages (S.lib.settings, undefined = valeur par défaut ci-dessous) :
//   mediaVideos, mediaVideoDelay, mediaVideoSound, mediaVideoVolume,
//   mediaSsDelay (min, '0' = jamais), mediaSsMode (slides|videos|black),
//   mediaMusic, mediaMusicVolume, mediaMusicSource (synth|folder), mediaMusicDir (posé par le main).
(() => {
  // Musique désactivée par défaut : le launcher peut démarrer avec Windows et revenir seul au premier plan
  // en fin de partie ; un son qui part sans prévenir (appel vocal, nuit) surprendrait. Une ligne dans Réglages suffit.
  const DEF = {
    mediaVideos: true, mediaVideoDelay: '1.5', mediaVideoSound: false, mediaVideoVolume: '0.6',
    mediaSsDelay: '5', mediaSsMode: 'slides',
    mediaMusic: false, mediaMusicVolume: '0.3', mediaMusicSource: 'synth',
  };
  const opt = (k) => (S.lib.settings?.[k] ?? DEF[k]);
  const num = (k) => Number(opt(k)) || 0;
  let winVisible = true;
  const visible = () => winVisible && !document.hidden;
  const running = () => (S.lib.running || []).length > 0;
  const busy = () => (typeof LD !== 'undefined' && LD.active) || (typeof BO !== 'undefined' && BO.busy);
  window.ssActive = false;

  // ============================================================ 1. Vidéo de présentation (fond de l'écran jeux)
  const vid = document.createElement('video');
  vid.className = 'bg-video';
  vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto'; vid.disablePictureInPicture = true;
  vid.setAttribute('aria-hidden', 'true');
  $('#bg').insertBefore(vid, $('#bgTint'));
  const V = { timer: 0, want: null, on: null, gen: 0 };

  const canVideo = () => opt('mediaVideos') && S.view === 'games' && S.mode === 'main' && visible() && !running() && !window.ssActive && !busy();
  function vStop() {
    clearTimeout(V.timer);
    V.want = null;
    if (!V.on) return;
    V.on = null;
    const gen = ++V.gen;
    vid.classList.remove('on');
    document.body.classList.remove('has-trailer');
    Music.duck(false);
    setTimeout(() => { if (gen === V.gen && !V.on) { vid.pause(); vid.removeAttribute('src'); vid.load(); } }, 420);
  }
  function vArm(g = S.view === 'games' ? S.items[S.sel] : null) {
    vStop();
    if (!g || !canVideo()) return;
    V.want = g.id;
    V.timer = setTimeout(() => vLoad(g.id), Math.max(0.5, num('mediaVideoDelay')) * 1000);
  }
  async function vLoad(id) {
    const r = await rr.x('x:media:trailer', id).catch(() => null);
    if (V.want === id && r?.file && canVideo()) vPlay(id, r.file, r.v);
  }
  function vPlay(id, file, v = 0) {
    if (V.on === id) return;
    V.on = id;
    const gen = ++V.gen;
    vid.muted = !opt('mediaVideoSound');
    vid.volume = Math.min(1, num('mediaVideoVolume') || 0.6);
    vid.src = `rr://media/${encodeURIComponent(id)}/${encodeURIComponent(file)}?v=${v}`;
    vid.onplaying = () => {
      if (gen !== V.gen) return;
      vid.classList.add('on');
      document.body.classList.add('has-trailer');
      Music.duck(!vid.muted);
    };
    vid.onerror = () => { if (gen === V.gen) { V.on = null; vid.classList.remove('on'); } };
    vid.play().catch(() => {});
  }
  rr.onX('x:media:ready', ({ id, file }) => { if (V.want === id && !V.on && canVideo()) vPlay(id, file, Date.now() | 0); });
  RR.on('selection', (g) => vArm(g || null));

  // ============================================================ 3. Musique d'ambiance (WebAudio)
  const Music = (() => {
    let ctx = null, master, duckG, synthG, fileG, verb;
    let cur = null; // clé de la source jouée : 'synth' | 'folder' | 'game:<id>'
    let fading = 0, ducked = false, synthT = 0, nextChord = 0, chordI = 0, nextBell = 0;
    const audio = new Audio();
    audio.preload = 'auto';
    let blobUrl = '', playlist = [], plI = 0, loadGen = 0;

    function ensure() {
      if (ctx) return;
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 0;
      duckG = ctx.createGain(); duckG.gain.value = 1;
      master.connect(duckG).connect(ctx.destination);
      synthG = ctx.createGain(); synthG.gain.value = 0; synthG.connect(master);
      fileG = ctx.createGain(); fileG.gain.value = 0; fileG.connect(master);
      ctx.createMediaElementSource(audio).connect(fileG);
      // Réverbe : réponse impulsionnelle de bruit décroissant (générée, aucun fichier)
      verb = ctx.createConvolver();
      const len = ctx.sampleRate * 4.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      verb.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.55;
      verb.connect(wet).connect(synthG);
    }
    const ramp = (p, v, s) => { const t = ctx.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + s); };
    const vol = () => Math.min(1, num('mediaMusicVolume') || 0.3);

    // ---- Nappes synthétisées : accords lents (la mineur / do majeur), filtre passe-bas, réverbe longue, cloches rares
    const CHORDS = [[45, 57, 60, 64, 67, 71], [41, 53, 57, 60, 64, 67], [36, 48, 55, 60, 64, 67], [43, 55, 59, 62, 67, 69]];
    const BELLS = [72, 74, 76, 79, 81, 84];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function pad(t0, notes, dur) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(620, t0); lp.frequency.linearRampToValueAtTime(980, t0 + dur * 0.5); lp.frequency.linearRampToValueAtTime(640, t0 + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(1, t0 + 4); env.gain.setValueAtTime(1, t0 + dur - 5); env.gain.linearRampToValueAtTime(0, t0 + dur);
      lp.connect(env); env.connect(synthG); env.connect(verb);
      notes.forEach((m, i) => {
        const g = ctx.createGain(); g.gain.value = (i === 0 ? 0.05 : 0.026);
        g.connect(lp);
        for (const [type, cents] of [['triangle', -7], ['sine', 6]]) {
          const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(m); o.detune.value = cents;
          o.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
        }
      });
      setTimeout(() => { try { lp.disconnect(); env.disconnect(); } catch { /* déjà libéré */ } }, (dur + 1 + (t0 - ctx.currentTime)) * 1000);
    }
    function bell(t0) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(BELLS[Math.floor(Math.random() * BELLS.length)]);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.018, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5);
      o.connect(g); g.connect(verb); g.connect(synthG); o.start(t0); o.stop(t0 + 5.2);
    }
    function synthTick() {
      if (cur !== 'synth' || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (nextChord < now + 1.5) {
        const t0 = Math.max(nextChord, now + 0.05);
        pad(t0, CHORDS[chordI++ % CHORDS.length], 15);
        nextChord = t0 + 10; // 5 s de recouvrement entre deux accords
      }
      if (nextBell < now + 1.5) { if (nextBell) bell(Math.max(nextBell, now + 0.05)); nextBell = Math.max(nextBell, now) + 7 + Math.random() * 9; }
    }

    // ---- Fichiers (dossier ou musique du jeu) : octets reçus du main → URL blob (même origine, lisible par WebAudio)
    async function loadTrack(q, loop) {
      const gen = ++loadGen;
      const r = await rr.x('x:media:track', q).catch(() => null);
      if (gen !== loadGen) return false;
      if (!r?.data) return false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
      audio.loop = loop;
      audio.src = blobUrl;
      try { await audio.play(); } catch { return false; }
      return gen === loadGen;
    }
    async function nextFolderTrack() {
      if (!playlist.length || plI >= playlist.length) {
        playlist = (await rr.x('x:media:musicList').catch(() => [])) || [];
        for (let i = playlist.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [playlist[i], playlist[j]] = [playlist[j], playlist[i]]; }
        plI = 0;
      }
      if (!playlist.length) return false;
      return loadTrack({ name: playlist[plI++] }, false);
    }
    audio.addEventListener('ended', () => { if (cur === 'folder') nextFolderTrack(); });
    audio.addEventListener('error', () => { if (cur === 'folder' && audio.src) setTimeout(nextFolderTrack, 400); });

    async function start(key) {
      if (key === 'synth') {
        ramp(synthG.gain, 1, 2.5);
        nextChord = 0; nextBell = 0; synthTick();
        clearInterval(synthT); synthT = setInterval(synthTick, 1000);
        return true;
      }
      const ok = key === 'folder' ? await nextFolderTrack() : await loadTrack({ gameId: key.slice(5) }, true);
      if (ok && cur === key) ramp(fileG.gain, 1, 1.6);
      return ok;
    }
    function stopSrc(key, s = 0.8) {
      if (!key || !ctx) return;
      if (key === 'synth') { ramp(synthG.gain, 0, s); clearInterval(synthT); }
      else { ramp(fileG.gain, 0, s); loadGen++; const a = audio; setTimeout(() => { if (cur !== key) a.pause(); }, s * 1000 + 50); }
    }

    let gamesWithMusic = new Map(), noFolder = false;
    function desired() {
      if (!opt('mediaMusic') || !visible() || running() || busy() || S.mode === 'ingame') return null;
      const g = S.view === 'games' ? S.items[S.sel] : null;
      if (g && gamesWithMusic.get(g.id)) return 'game:' + g.id;
      if (opt('mediaMusicSource') === 'folder' && opt('mediaMusicDir') && !noFolder) return 'folder';
      return 'synth';
    }
    let applying = false;
    async function apply() {
      if (applying) return;
      const want = desired();
      if (want === cur) { if (ctx && want) ramp(master.gain, vol(), 0.6); return; }
      applying = true;
      try {
        if (!want) {
          if (ctx && cur) { ramp(master.gain, 0, 1); const was = cur; clearTimeout(fading); fading = setTimeout(() => { if (!desired()) { stopSrc(was, 0.05); ctx.suspend(); } }, 1100); }
          cur = null;
          return;
        }
        ensure();
        clearTimeout(fading);
        if (ctx.state !== 'running') await ctx.resume();
        ramp(master.gain, vol(), 1.4);
        const prev = cur; cur = want;
        stopSrc(prev);
        const ok = await start(want);
        if (!ok && cur === want) {
          if (want === 'folder') noFolder = true; // dossier vide / illisible → ambiance générée
          cur = null; // on retentera au prochain passage (ou on retombera sur l'ambiance générée)
          if (want.startsWith('game:')) gamesWithMusic.set(want.slice(5), false);
        }
      } finally { applying = false; }
    }
    return {
      apply,
      duck(on) { ducked = on; if (ctx) ramp(duckG.gain, on ? 0.22 : 1, on ? 0.5 : 1.2); },
      setGameMusic(id, has) { gamesWithMusic.set(id, !!has); },
      resetFolder() { noFolder = false; playlist = []; if (cur === 'folder') { cur = null; } },
      state: () => ({ cur, ctx: ctx?.state || 'none', gain: ctx ? +master.gain.value.toFixed(3) : 0, ducked }),
    };
  })();
  window.rrMusicState = Music.state; // banc de test / débogage

  // Musique propre au jeu sélectionné : interrogée après un court arrêt sur le jeu
  let infoT = 0;
  RR.on('selection', (g) => {
    clearTimeout(infoT);
    if (!g) return Music.apply();
    infoT = setTimeout(async () => {
      const r = await rr.x('x:media:info', g.id).catch(() => null);
      Music.setGameMusic(g.id, !!r?.music);
      Music.apply();
    }, 450);
    Music.apply();
  });

  // ============================================================ 2. Économiseur d'écran
  const ss = document.createElement('div');
  ss.id = 'screensaver';
  ss.dataset.theme = 'dark'; // toujours sombre, quel que soit le thème
  ss.hidden = true;
  ss.setAttribute('aria-hidden', 'true');
  ss.innerHTML = `
    <div class="ss-slide"></div><div class="ss-slide"></div>
    <video class="ss-video" muted playsinline disablepictureinpicture></video>
    <div class="ss-veil"></div>
    <div class="ss-clock"><time class="ss-time"></time><span class="ss-date"></span></div>
    <div class="ss-info"><img class="ss-logo" alt="" hidden /><strong class="ss-name"></strong><span class="ss-plat"></span></div>
    <div class="ss-hint"><span class="ss-go"></span><span>Aller au jeu</span></div>`;
  document.body.append(ss);
  const SS = { t: 0, clockT: 0, list: [], i: 0, vids: [], vi: 0, count: 0, slideFlip: false, game: null, wokeAt: 0 };
  const ssVideo = $('.ss-video', ss);
  ssVideo.muted = true;
  let lastInput = performance.now();
  const markInput = () => { lastInput = performance.now(); };
  RR.on('input', markInput);

  const canSS = () => S.mode === 'main' && visible() && !running() && !busy() && S.lib.games?.length > 0 && !(typeof shellSplashActive === 'function' && shellSplashActive());
  setInterval(() => {
    const d = num('mediaSsDelay');
    if (!window.ssActive && d > 0 && performance.now() - lastInput > d * 60000 && canSS()) ssStart();
    if (window.ssActive && (!visible() || running())) ssStop();
  }, 2000);

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const imagesOf = (g) => [g.media?.hero, g.media?.header, ...(g.screenshots || [])].filter(Boolean);
  function ssClock() {
    const d = new Date();
    $('.ss-time', ss).textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('.ss-date', ss).textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (opt('mediaSsMode') === 'black' && !reduceMotion) { // anti-marquage : l'heure se déplace un peu chaque minute
      ss.style.setProperty('--ss-cx', `${Math.round(Math.random() * 40 - 20)}vw`);
      ss.style.setProperty('--ss-cy', `${Math.round(Math.random() * 30 - 15)}vh`);
    }
  }
  function ssCaption(g) {
    SS.game = g;
    const logo = $('.ss-logo', ss), name = $('.ss-name', ss);
    const lf = g?.media?.logo;
    logo.hidden = !lf; name.hidden = !!lf;
    if (lf) { logo.src = mediaUrl(g, lf); logo.alt = g.name; } else logo.removeAttribute('src');
    name.textContent = g?.name || '';
    $('.ss-plat', ss).textContent = g ? plat(g.platform).name : '';
    const info = $('.ss-info', ss);
    info.classList.remove('in'); void info.offsetWidth; info.classList.toggle('in', !!g);
    ss.classList.toggle('has-game', !!g);
  }
  function ssShowImage(g, url) {
    const [a, b] = $$('.ss-slide', ss);
    const next = SS.slideFlip ? a : b, prev = SS.slideFlip ? b : a;
    SS.slideFlip = !SS.slideFlip;
    next.style.backgroundImage = `url("${url}")`;
    // Ken Burns : point de départ / d'arrivée tirés au hasard (désactivé si mouvement réduit)
    const r = () => (Math.random() * 4 - 2).toFixed(2) + '%';
    next.style.setProperty('--kb-x0', r()); next.style.setProperty('--kb-y0', r());
    next.style.setProperty('--kb-x1', r()); next.style.setProperty('--kb-y1', r());
    next.classList.remove('kb'); void next.offsetWidth; next.classList.add('kb', 'on');
    prev.classList.remove('on');
    ssVideo.classList.remove('on');
    setTimeout(() => { if (!ssVideo.classList.contains('on')) { ssVideo.pause(); } }, 1300);
    ssCaption(g);
  }
  function ssNext() {
    clearTimeout(SS.t);
    if (!window.ssActive) return;
    const mode = opt('mediaSsMode');
    if (mode === 'black') { ssCaption(null); return; }
    const useVideo = SS.vids.length && (mode === 'videos' || (SS.count % 3 === 2));
    SS.count++;
    if (useVideo) {
      const v = SS.vids[SS.vi++ % SS.vids.length];
      const g = S.lib.games.find((x) => x.id === v.id);
      if (g) {
        let started = false;
        ssVideo.onplaying = () => {
          if (started || !window.ssActive) return;
          started = true;
          ssVideo.classList.add('on');
          $$('.ss-slide', ss).forEach((s) => s.classList.remove('on'));
          ssCaption(g);
          SS.t = setTimeout(ssNext, Math.min(40, Math.max(8, (ssVideo.duration || 30) - 0.5)) * 1000);
        };
        ssVideo.onended = () => ssNext();
        ssVideo.onerror = () => { if (!started) ssNext(); };
        ssVideo.loop = false;
        ssVideo.src = mediaUrl(g, v.file);
        ssVideo.play().catch(() => {});
        SS.t = setTimeout(() => { if (!started) ssNext(); }, 4000);
        return;
      }
    }
    if (!SS.list.length) { ssCaption(null); return; }
    const g = SS.list[SS.i++ % SS.list.length];
    if (SS.i % SS.list.length === 0) shuffle(SS.list);
    const imgs = imagesOf(g);
    const url = mediaUrl(g, imgs[Math.floor(Math.random() * imgs.length)]);
    const img = new Image();
    img.onload = () => { if (window.ssActive) ssShowImage(g, url); };
    img.onerror = () => {};
    img.src = url;
    SS.t = setTimeout(ssNext, 9000);
  }
  async function ssStart(preview = false) {
    if (window.ssActive) return;
    window.ssActive = true;
    vStop();
    SS.list = shuffle(S.lib.games.filter((g) => imagesOf(g).length));
    SS.i = 0; SS.count = 0; SS.vi = 0; SS.vids = [];
    SS.preview = preview;
    // Repart d'un écran propre (un arrêt / redémarrage rapide peut précéder le nettoyage différé de ssStop)
    ssVideo.onplaying = ssVideo.onended = ssVideo.onerror = null;
    ssVideo.classList.remove('on'); ssVideo.pause(); ssVideo.removeAttribute('src');
    $$('.ss-slide', ss).forEach((s) => { s.classList.remove('on', 'kb'); s.style.backgroundImage = ''; });
    ss.classList.toggle('is-black', opt('mediaSsMode') === 'black');
    ss.classList.remove('has-game');
    ss.hidden = false;
    void ss.offsetWidth;
    ss.classList.add('on');
    document.body.classList.add('ss-on');
    const goGlyph = typeof glyph === 'function' ? glyph('a') : '';
    $('.ss-go', ss).innerHTML = goGlyph;
    ssClock(); clearInterval(SS.clockT); SS.clockT = setInterval(ssClock, 15000);
    if (opt('mediaSsMode') !== 'black') SS.vids = shuffle((await rr.x('x:media:cached').catch(() => [])) || []);
    if (window.ssActive) setTimeout(ssNext, 600);
  }
  function ssStop() {
    if (!window.ssActive) return;
    window.ssActive = false;
    clearTimeout(SS.t); clearInterval(SS.clockT);
    ssVideo.onplaying = ssVideo.onended = ssVideo.onerror = null;
    ss.classList.remove('on');
    document.body.classList.remove('ss-on');
    markInput();
    setTimeout(() => {
      if (window.ssActive) return;
      ss.hidden = true;
      ssVideo.pause(); ssVideo.removeAttribute('src'); ssVideo.load();
      $$('.ss-slide', ss).forEach((s) => { s.classList.remove('on', 'kb'); s.style.backgroundImage = ''; });
    }, reduceMotion ? 50 : 450);
    vArm();
    Music.apply();
  }
  // Sortie : toute entrée réveille SANS déclencher d'action. A / Entrée = aller au jeu affiché (option documentée).
  function ssWake(btn) {
    if (!window.ssActive) return false;
    SS.wokeAt = performance.now();
    const g = btn === 'a' && !SS.preview ? SS.game : null;
    ssStop();
    if (g && S.mode === 'main') goToGame(g);
    return true;
  }
  window.ssWake = ssWake;
  window.ssStart = ssStart; // banc de test / aperçu
  function goToGame(g) {
    try {
      if (typeof enterPlatform !== 'function') return;
      if (S.view !== 'games' || (S.plat !== g.platform && S.plat !== 'all')) enterPlatform(g.platform);
      let i = S.items.findIndex((x) => x.id === g.id);
      if (i < 0 && typeof setTab === 'function') { setTab('all'); i = S.items.findIndex((x) => x.id === g.id); }
      if (i >= 0) select(i, { spin: false });
    } catch (e) { console.warn('media : aller au jeu', e); }
  }
  // Capture (avant les gestionnaires d'app.js, qui écoutent en phase de bouillonnement) : l'entrée est consommée
  addEventListener('keydown', (e) => {
    if (!window.ssActive) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) ssWake(e.key === 'Enter' ? 'a' : null);
  }, true);
  const swallow = (e) => {
    if (window.ssActive || performance.now() - SS.wokeAt < 450) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.ssActive) ssWake();
    }
  };
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick']) addEventListener(t, swallow, true);
  addEventListener('wheel', swallow, { capture: true, passive: false });
  let mx = null, my = null;
  addEventListener('mousemove', (e) => {
    if (mx !== null && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 12) { markInput(); if (window.ssActive) ssWake(); }
    mx = e.clientX; my = e.clientY;
  }, true);

  // ============================================================ État global : fenêtre, sessions, overlays
  rr.onVisible((v) => { winVisible = !!v; sync(); });
  document.addEventListener('visibilitychange', () => sync());
  RR.on('view', () => sync());
  RR.on('mode', (m) => { if (m === 'main') vArm(); else vStop(); Music.apply(); });
  RR.on('play', () => { vStop(); ssStop(); setTimeout(() => Music.apply(), 50); });
  RR.on('session', () => sync());
  function sync() {
    if (!canVideo()) vStop();
    else if (!V.want && !V.on) vArm();
    if (window.ssActive && (!visible() || running())) ssStop();
    Music.apply();
  }
  // Filet de sécurité (lancement en cours, splash, etc. ne passent pas tous par le bus)
  setInterval(() => {
    if ((V.on || V.want) && !canVideo()) vStop();
    Music.apply();
  }, 700);

  // ============================================================ Page du jeu → Images : vidéo et musique
  const ICO = {
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  };
  async function decorateImageMenu() {
    const grid = $('#dSub .img-grid');
    const g = S.items[S.sel];
    if (!grid || !g || $('.m-tile', grid)) return;
    grid.insertAdjacentHTML('beforeend', `
      <button class="img-tile m-tile" data-mpick="trailer" data-nav><span class="img-prev m-prev">${ICO.video}<em>…</em></span><span class="img-l">Vidéo</span><span class="img-h">Choisir une vidéo… (MP4, WebM)</span></button>
      <button class="img-tile m-tile" data-mpick="music" data-nav><span class="img-prev m-prev">${ICO.music}<em>…</em></span><span class="img-l">Musique</span><span class="img-h">Choisir une musique… (MP3, OGG, FLAC, M4A)</span></button>`);
    const r = await rr.x('x:media:info', g.id).catch(() => ({}));
    const t = $('[data-mpick="trailer"] em', grid), m = $('[data-mpick="music"] em', grid);
    if (t) t.textContent = r?.trailer ? 'En cache' : 'Aucune';
    if (m) m.textContent = r?.music ? 'Définie' : 'Aucune';
  }
  new MutationObserver(() => { if (!$('#dSub').hidden) decorateImageMenu(); }).observe($('#dSub'), { childList: true, attributes: true, attributeFilter: ['hidden'] });
  $('#dSub').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mpick]');
    const g = S.items[S.sel];
    if (!b || !g) return;
    const kind = b.dataset.mpick;
    b.classList.add('is-busy');
    const r = await rr.x(kind === 'trailer' ? 'x:media:pickTrailer' : 'x:media:pickMusic', g.id).catch(() => null);
    b.classList.remove('is-busy');
    if (!r) return;
    $('em', b).textContent = kind === 'trailer' ? 'En cache' : 'Définie';
    if (kind === 'music') { Music.setGameMusic(g.id, true); Music.apply(); }
    toast(kind === 'trailer' ? 'Vidéo de présentation mise à jour' : 'Musique du jeu mise à jour', 'success');
  });

  // ============================================================ Réglages (onglet Fonctions → #set-media)
  const seg = (k, label, opts) => `<div class="seg" data-setting="${k}" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button data-value="${v}" data-nav>${l}</button>`).join('')}</div>`;
  const box = $('#set-media');
  if (box) {
    box.innerHTML = `
      <h3 class="set-group">Vidéos de présentation</h3>
      <div class="setting">
        <div><strong id="lbMVid">Vidéos de présentation</strong><span class="dim">Après un instant sur un jeu, sa bande-annonce remplace l’image de fond</span></div>
        <button class="toggle" data-toggle="mediaVideos" role="switch" aria-labelledby="lbMVid" data-nav></button>
      </div>
      <div class="setting">
        <div><strong id="lbMDelay">Délai avant la vidéo</strong></div>
        ${seg('mediaVideoDelay', 'Délai avant la vidéo', [['1', '1 s'], ['1.5', '1,5 s'], ['3', '3 s']])}
      </div>
      <div class="setting">
        <div><strong id="lbMSnd">Son des vidéos</strong><span class="dim">Coupé par défaut ; la musique baisse pendant la vidéo</span></div>
        <div class="row-gap">
          ${seg('mediaVideoVolume', 'Volume des vidéos', [['0.3', 'Doux'], ['0.6', 'Normal'], ['1', 'Fort']])}
          <button class="toggle" data-toggle="mediaVideoSound" role="switch" aria-labelledby="lbMSnd" data-nav></button>
        </div>
      </div>
      <p class="set-note m-note">Jeux Steam : vidéo téléchargée en arrière-plan (480p, 60 Mo max). Autres jeux : page du jeu → Images → Vidéo.</p>
      <h3 class="set-group">Économiseur d’écran</h3>
      <div class="setting">
        <div><strong id="lbMSs">Démarrer après</strong><span class="dim">Sans aucune action, hors jeu et menus</span></div>
        ${seg('mediaSsDelay', 'Délai de l’économiseur', [['0', 'Jamais'], ['2', '2 min'], ['5', '5 min'], ['10', '10 min'], ['20', '20 min']])}
      </div>
      <div class="setting">
        <div><strong id="lbMSsMode">Affichage</strong><span class="dim">Diaporama de tes jeux, vidéos en cache ou écran noir</span></div>
        <div class="row-gap">
          ${seg('mediaSsMode', 'Type d’économiseur', [['slides', 'Diaporama'], ['videos', 'Vidéos'], ['black', 'Noir']])}
          <button class="btn small" data-media-act="ssPreview" data-nav>Aperçu</button>
        </div>
      </div>
      <h3 class="set-group">Musique d’ambiance</h3>
      <div class="setting">
        <div><strong id="lbMMus">Musique</strong><span class="dim">Accueil et écran jeux ; coupée pendant une partie</span></div>
        <div class="row-gap">
          ${seg('mediaMusicVolume', 'Volume de la musique', [['0.15', 'Doux'], ['0.3', 'Normal'], ['0.5', 'Fort']])}
          <button class="toggle" data-toggle="mediaMusic" role="switch" aria-labelledby="lbMMus" data-nav></button>
        </div>
      </div>
      <div class="setting">
        <div><strong id="lbMSrc">Source</strong><span class="dim m-dir">Ambiance générée, sans fichier</span></div>
        <div class="row-gap">
          ${seg('mediaMusicSource', 'Source de la musique', [['synth', 'Ambiance'], ['folder', 'Mon dossier']])}
          <button class="btn small" data-media-act="musicDir" data-nav>Dossier…</button>
        </div>
      </div>
      <p class="set-note m-note">Une musique propre à un jeu : page du jeu → Images → Musique. Elle remplace l’ambiance quand ce jeu est sélectionné.</p>`;
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-media-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.mediaAct === 'musicDir') {
        const r = await rr.x('x:media:pickMusicDir').catch(() => null);
        if (r) { Music.resetFolder(); toast(r.count ? `${r.count} musique${r.count > 1 ? 's' : ''} trouvée${r.count > 1 ? 's' : ''}` : 'Aucune musique dans ce dossier (MP3, OGG, FLAC, M4A)', r.count ? 'success' : 'info'); }
      }
      if (b.dataset.mediaAct === 'ssPreview') { closeAll(); setTimeout(() => ssStart(true), 250); }
    });
  }
  function renderMediaSettings() {
    if (!box) return;
    const s = S.lib.settings || {};
    const dis = (k, off) => { const el = $(`.seg[data-setting="${k}"]`, box); if (!el) return; el.classList.toggle('is-off', off); $$('button', el).forEach((x) => { x.disabled = off; }); };
    dis('mediaVideoDelay', !opt('mediaVideos'));
    dis('mediaVideoVolume', !opt('mediaVideoSound'));
    dis('mediaMusicVolume', !opt('mediaMusic'));
    const dir = s.mediaMusicDir;
    $('.m-dir', box).textContent = opt('mediaMusicSource') === 'folder'
      ? (dir ? `Lecture aléatoire : ${dir}` : 'Choisis un dossier (MP3, OGG, FLAC, M4A)')
      : 'Ambiance générée, sans fichier';
    $('.m-dir', box).title = dir || '';
  }
  // Valeurs par défaut écrites une fois (les interrupteurs / segments génériques lisent S.lib.settings)
  let defaultsDone = false;
  let prevSrc = null, prevDir = null;
  function onLib(state) {
    const s = state.settings || {};
    const miss = Object.keys(DEF).filter((k) => s[k] === undefined);
    if (!defaultsDone && miss.length) { defaultsDone = true; rr.setSettings(Object.fromEntries(miss.map((k) => [k, DEF[k]]))); }
    defaultsDone = true;
    if (s.mediaMusicSource !== prevSrc || s.mediaMusicDir !== prevDir) { if (prevSrc !== null) Music.resetFolder(); prevSrc = s.mediaMusicSource; prevDir = s.mediaMusicDir; }
    renderMediaSettings();
    if (vid.src && V.on) { vid.muted = !opt('mediaVideoSound'); vid.volume = Math.min(1, num('mediaVideoVolume') || 0.6); Music.duck(!vid.muted); }
    if (!opt('mediaVideos')) vStop();
    Music.apply();
  }
  RR.on('library', onLib);
  // La bibliothèque peut déjà être chargée (réponse IPC arrivée entre app.js et ce script)
  if (S.lib?.platforms?.length) onLib(S.lib); else renderMediaSettings();
})();

// RR Launcher — CAPTURE (renderer) : entrées du menu en jeu + indicateur d'enregistrement, galerie « Captures »
// sur la page du jeu, visionneuse plein écran, réglages (#set-capture), retour sonore / toast.
// Processus principal : src/features/capture.js (canaux x:capture:*).
'use strict';
(() => {
  const CAP = { rec: { recording: false }, recTimer: null, list: [], gameId: null, idx: 0, keys: null, lastKeys: undefined };
  const ICO = {
    shot: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
    clip: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/></svg>',
    stop: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    play: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    folder: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    prev: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    next: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    close: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ---------------------------------------------------------------- Son de déclencheur (Web Audio, suit le réglage des sons)
  let actx = null;
  function shutter(kind = 'shot') {
    const s = S.lib?.settings || {};
    if (s.sounds === false) return;
    try {
      actx ||= new AudioContext();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + 0.01, vol = (s.volume ?? 0.7) * 0.5;
      const g = actx.createGain(); g.connect(actx.destination);
      if (kind === 'shot') { // clic d'obturateur : bruit court filtré, deux fois
        for (const dt of [0, 0.07]) {
          const len = Math.ceil(actx.sampleRate * 0.04), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
          const src = actx.createBufferSource(); src.buffer = buf;
          const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = dt ? 2400 : 3600; f.Q.value = 0.9;
          const e = actx.createGain(); e.gain.value = vol * (dt ? 0.7 : 1);
          src.connect(f).connect(e).connect(g); src.start(t + dt);
        }
      } else { // début / fin d'enregistrement : deux notes montantes ou descendantes
        const notes = kind === 'start' ? [660, 990] : [990, 660];
        notes.forEach((fq, i) => {
          const o = actx.createOscillator(), e = actx.createGain();
          o.frequency.value = fq; o.type = 'sine';
          e.gain.setValueAtTime(0.0001, t + i * 0.09);
          e.gain.exponentialRampToValueAtTime(vol * 0.12, t + i * 0.09 + 0.01);
          e.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.22);
          o.connect(e).connect(g); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.25);
        });
      }
    } catch {}
  }

  // ---------------------------------------------------------------- Menu en jeu : entrées, indicateur, légende
  function igInsert() {
    const main = $('#igMain');
    if (!main || $('[data-ig="cap-shot"]', main)) return;
    const sep = $('.ig-sep', main);
    const html = `
      <button class="ig-item cap-ig" data-ig="cap-shot" role="menuitem" data-nav>${ICO.shot}<span class="ig-label">Capture d’écran</span><span class="ig-meta cap-k" data-k="shot"></span></button>
      <button class="ig-item cap-ig" data-ig="cap-clip" role="menuitem" data-nav>${ICO.clip}<span class="ig-label">Enregistrer un clip</span><span class="ig-meta cap-k" data-k="clip"></span></button>`;
    sep.insertAdjacentHTML('beforebegin', '<div class="ig-sep" role="separator"></div>' + html);
    $('.ig-head').insertAdjacentHTML('beforeend', '<span class="cap-rec" id="capRecBadge" hidden role="status"><i class="cap-rec-dot" aria-hidden="true"></i><span>REC</span><b id="capRecTime">0:00</b></span>');
    $('#igFoot').insertAdjacentHTML('beforebegin', '<div class="cap-legend" id="capLegend" aria-label="Raccourcis de capture"></div>');
    $('.ig-head').insertBefore($('#capRecBadge'), $('#igClock'));
  }
  function legendHtml() {
    const s = S.lib?.settings || {};
    const pad = S.device === 'pad';
    const ps = S.padType === 'ps';
    const k = (t) => `<kbd>${t}</kbd>`;
    const G = ps ? 'PS' : 'Guide', RB = ps ? 'R1' : 'RB', LB = ps ? 'L1' : 'LB', B = ps ? '○' : 'B', SH = ps ? 'Share' : 'View';
    const rows = [];
    if (pad || s.captureKeys === false) {
      if (s.padShortcuts !== false && s.guideButton !== false) {
        rows.push([`${k(G)}+${k(RB)}`, 'Capture'], [`${k(G)}+${k(LB)}`, 'Clip'], [`${k(G)}+${k(B)}`, 'Quitter'], [`${k(G)} maintenu`, 'Alimentation']);
        if (s.captureShare === true) rows.push([k(SH), 'Capture']);
      }
    } else rows.push([k('Ctrl+Alt+S'), 'Capture'], [k('Ctrl+Alt+R'), 'Clip']);
    return rows.length ? `<p class="cap-legend-t">Raccourcis en jeu</p><ul>${rows.map(([a, b]) => `<li><span>${a}</span><em>${b}</em></li>`).join('')}</ul>` : '';
  }
  function igUpdate() {
    if (!$('#capLegend')) return;
    $('#capLegend').innerHTML = legendHtml();
    const kbd = S.device !== 'pad' && (S.lib?.settings?.captureKeys !== false);
    $$('.cap-k').forEach((el) => { el.textContent = kbd ? (el.dataset.k === 'shot' ? 'Ctrl+Alt+S' : 'Ctrl+Alt+R') : ''; });
    const clip = $('[data-ig="cap-clip"]');
    const r = CAP.rec;
    clip.classList.toggle('is-rec', !!r.recording);
    clip.querySelector('.ico').outerHTML = r.recording ? ICO.stop : ICO.clip;
    $('.ig-label', clip).textContent = r.recording ? 'Arrêter l’enregistrement' : 'Enregistrer un clip';
    $('#capRecBadge').hidden = !r.recording;
    recTick();
  }
  function recTick() {
    const r = CAP.rec;
    if (!r.recording) return;
    const t = fmtDur(Date.now() - r.start);
    if ($('#capRecTime')) $('#capRecTime').textContent = t;
    const meta = $('[data-ig="cap-clip"] .cap-k');
    if (meta) meta.textContent = `${t} / ${fmtDur(r.max || 300000)}`;
  }
  function setRec(r) {
    const was = CAP.rec.recording;
    CAP.rec = r || { recording: false };
    clearInterval(CAP.recTimer);
    if (CAP.rec.recording) CAP.recTimer = setInterval(recTick, 500);
    if (was !== CAP.rec.recording) shutter(CAP.rec.recording ? 'start' : 'stop');
    document.body.classList.toggle('cap-recording', !!CAP.rec.recording);
    igUpdate();
  }

  // Déclenche après avoir rendu la main au jeu (pour capturer le jeu, pas le menu)
  function leaveAndRun(channel) {
    const id = IG.id;
    closeAll(true);
    rr.resumeGame(id);
    return rr.x(channel, { delay: 600, origin: 'menu' });
  }
  $('#ingame').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ig^="cap-"]');
    if (!b) return;
    e.stopImmediatePropagation();
    if (b.dataset.ig === 'cap-shot') leaveAndRun('x:capture:shot');
    else if (CAP.rec.recording) { rr.x('x:capture:clip'); } // arrêter : on reste dans le menu
    else leaveAndRun('x:capture:clip');
  }, true);

  // ---------------------------------------------------------------- Retour après capture
  rr.onX('x:capture:rec', setRec);
  rr.onX('x:capture:done', (d = {}) => {
    if (d.kind === 'image' && d.ok) shutter('shot');
    const visible = document.visibilityState === 'visible';
    if (visible) {
      if (!d.ok) toast(`${d.kind === 'video' ? 'Clip' : 'Capture'} impossible : ${d.error || 'erreur'}`, true);
      else toast(d.kind === 'video' ? `Clip enregistré (${fmtDur((d.seconds || 0) * 1000)})` : 'Capture enregistrée', 'success');
    }
    if (d.ok && CAP.gameId && d.id === CAP.gameId) refreshGallery();
  });

  // ---------------------------------------------------------------- Galerie sur la page du jeu
  function galleryEl() {
    let el = $('#capRow');
    if (el) return el;
    const host = $('#details .details');
    if (!host) return null;
    el = document.createElement('section');
    el.id = 'capRow';
    el.className = 'cap-row';
    el.hidden = true;
    el.setAttribute('aria-label', 'Captures');
    host.appendChild(el);
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cap]');
      if (t) return openViewer(+t.dataset.cap);
      if (e.target.closest('[data-capfolder]')) rr.x('x:capture:openFolder', CAP.gameId);
    });
    return el;
  }
  const detailGame = () => (S.mode === 'details' || S.stack.includes('details') ? S.items[S.sel] || S.lib.games.find((x) => x.id === S.selId) : null);
  let galleryReq = 0;
  async function refreshGallery() {
    const el = galleryEl();
    const g = detailGame();
    if (!el) return;
    if (!g) { CAP.gameId = null; return; }
    const req = ++galleryReq;
    const r = await rr.x('x:capture:list', g.id).catch(() => null);
    if (req !== galleryReq) return;
    CAP.gameId = g.id;
    CAP.list = r?.items || [];
    if (!CAP.list.length) { el.hidden = true; el.innerHTML = ''; return; }
    const MAX = innerWidth <= 1360 ? 4 : 6; // 2 lignes
    const items = CAP.list.slice(0, CAP.list.length > MAX ? MAX - 1 : MAX);
    el.innerHTML = `
      <header class="cap-row-head"><h3>Captures</h3><span class="cap-count">${CAP.list.length}</span>
        <button class="tool cap-folder" data-capfolder data-nav aria-label="Ouvrir le dossier" title="Ouvrir le dossier">${ICO.folder}<span>Ouvrir le dossier</span></button></header>
      <div class="cap-strip">${items.map((x, i) => `
        <button class="cap-thumb${x.kind === 'video' ? ' is-video' : ''}" data-cap="${i}" data-nav aria-label="${x.kind === 'video' ? 'Clip' : 'Capture'} du ${esc(fmtDate(x.mtime))}">
          <img src="${esc(x.thumb)}" alt="" loading="lazy" decoding="async" />
          ${x.kind === 'video' ? `<span class="cap-badge">${ICO.play}Clip</span>` : ''}
        </button>`).join('')}${CAP.list.length > MAX ? `<button class="cap-thumb cap-more" data-cap="${MAX - 1}" data-nav aria-label="Voir les ${CAP.list.length - MAX + 1} autres">+${CAP.list.length - MAX + 1}</button>` : ''}</div>`;
    // miniature absente (ex. vidéo sans miniature) : vignette neutre
    $$('img', el).forEach((im) => im.addEventListener('error', () => im.closest('.cap-thumb')?.classList.add('no-thumb'), { once: true }));
    el.hidden = false;
  }
  RR.on('mode', (m) => {
    if (m === 'details') refreshGallery();
    if (m === 'ingame') igUpdate();
    if (m !== 'capview' && m !== 'prompt') $('#capVStage').innerHTML = ''; // visionneuse fermée : arrête la vidéo
  });
  RR.on('selection', () => { if (S.mode === 'details') refreshGallery(); });
  RR.on('input', () => { if (S.mode === 'ingame') igUpdate(); });
  RR.on('library', (state) => {
    const k = state?.settings?.captureKeys;
    if (k !== CAP.lastKeys) { CAP.lastKeys = k; rr.x('x:capture:refresh').catch(() => {}); }
    renderSettingsBlock(false);
  });

  // ---------------------------------------------------------------- Visionneuse plein écran
  const view = document.createElement('div');
  view.id = 'capView';
  view.className = 'overlay cap-view';
  view.hidden = true;
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-modal', 'true');
  view.setAttribute('aria-labelledby', 'capVTitle');
  view.innerHTML = `
    <div class="cap-v-stage" id="capVStage"></div>
    <header class="cap-v-top">
      <div><h2 id="capVTitle"></h2><span class="cap-v-meta" id="capVMeta"></span></div>
      <div class="cap-v-tools">
        <button class="tool" data-capv="folder" data-nav>${ICO.folder}<span>Ouvrir le dossier</span></button>
        <button class="tool danger" data-capv="delete" data-nav>${ICO.trash}<span>Supprimer</span></button>
        <button class="tool" data-capv="close" data-nav data-default aria-label="Fermer">${ICO.close}<span>Fermer</span></button>
      </div>
    </header>
    <button class="cap-v-nav prev" data-capv="prev" aria-label="Précédente">${ICO.prev}</button>
    <button class="cap-v-nav next" data-capv="next" aria-label="Suivante">${ICO.next}</button>`;
  ($('#prompt') ? $('#prompt').before(view) : document.body.append(view)); // avant #prompt : la confirmation passe au-dessus
  OVERLAYS.capview = '#capView';
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-capv]');
    if (!b) return;
    const a = b.dataset.capv;
    if (a === 'prev') viewStep(-1);
    else if (a === 'next') viewStep(1);
    else if (a === 'delete') confirmDelete();
    else if (a === 'folder') rr.x('x:capture:openFolder', CAP.gameId);
    else if (a === 'close') closeOverlay();
  });

  function openViewer(i) {
    if (!CAP.list.length) return;
    CAP.idx = clamp(i, 0, CAP.list.length - 1);
    renderViewer();
    openOverlay('capview');
  }
  function renderViewer() {
    const x = CAP.list[CAP.idx];
    const g = S.lib.games.find((y) => y.id === CAP.gameId);
    if (!x) return;
    const st = $('#capVStage');
    st.innerHTML = x.kind === 'video'
      ? `<video src="${esc(x.url)}" controls autoplay playsinline preload="metadata"></video>`
      : `<img src="${esc(x.url)}" alt="Capture de ${esc(g?.name || '')}" />`;
    $('#capVTitle').textContent = g?.name || 'Captures';
    $('#capVMeta').textContent = `${x.kind === 'video' ? 'Clip' : 'Capture'} · ${fmtDate(x.mtime)} · ${CAP.idx + 1} / ${CAP.list.length}`;
    $$('.cap-v-nav', view).forEach((b) => { b.disabled = CAP.list.length < 2; });
    renderHints();
  }
  function viewStep(d) {
    if (CAP.list.length < 2) return;
    CAP.idx = (CAP.idx + d + CAP.list.length) % CAP.list.length;
    renderViewer();
    sfx('move');
  }
  function confirmDelete() {
    const x = CAP.list[CAP.idx];
    if (!x) return;
    const vid = $('#capVStage video'); vid?.pause();
    openPrompt({
      title: x.kind === 'video' ? 'Supprimer ce clip ?' : 'Supprimer cette capture ?',
      icon: 'danger', tone: 'danger',
      body: `<p class="dim">« ${esc(x.file)} » part dans la corbeille de Windows.</p>`,
      actions: [
        { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
        { label: 'Supprimer', danger: true, primary: true, onClick: async () => {
          closeOverlay(true);
          const r = await rr.x('x:capture:delete', x.rel).catch((e) => ({ ok: false, error: e.message }));
          if (!r?.ok) return toast(r?.error || 'Suppression impossible', true);
          toast('Supprimé', 'success');
          await refreshGallery();
          if (!CAP.list.length) { if (S.mode === 'capview') closeOverlay(true); return; }
          CAP.idx = Math.min(CAP.idx, CAP.list.length - 1);
          renderViewer();
        } },
      ],
    });
  }

  // Clavier : ←/→ parcourir, X / Suppr supprimer, O dossier ; Échap = fermeture (géré par app.js)
  addEventListener('keydown', (e) => {
    if (S.mode !== 'capview' || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const m = { ArrowLeft: () => viewStep(-1), ArrowRight: () => viewStep(1), Delete: confirmDelete, x: confirmDelete, X: confirmDelete, o: () => rr.x('x:capture:openFolder', CAP.gameId), O: () => rr.x('x:capture:openFolder', CAP.gameId), Backspace: () => closeOverlay() }[k];
    if (!m) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setDevice('kbd');
    m();
  }, true);
  // Manette : la visionneuse prend ←/→, LB/RB, X, Y avant la navigation générique
  const padDir0 = onPadDir, padBtn0 = onPadBtn;
  onPadDir = function (dir, repeat) {
    if (S.mode === 'capview' && (dir === 'left' || dir === 'right')) { RR.emit('input', 'pad', dir); if (!repeat) viewStep(dir === 'left' ? -1 : 1); return; }
    return padDir0(dir, repeat);
  };
  onPadBtn = function (btn) {
    if (S.mode === 'capview') {
      const m = { b: () => closeOverlay(), x: confirmDelete, y: () => rr.x('x:capture:openFolder', CAP.gameId), lb: () => viewStep(-1), rb: () => viewStep(1), a: () => { const v = $('#capVStage video'); if (v) { if (v.paused) v.play(); else v.pause(); } } }[btn];
      RR.emit('input', 'pad', btn);
      return m && m();
    }
    return padBtn0(btn);
  };
  // Barre du bas de la visionneuse
  const renderHints0 = renderHints;
  renderHints = function () {
    renderHints0();
    if (S.mode !== 'capview') return;
    const pad = S.device === 'pad';
    const g = (btn, kb) => (pad ? glyph(btn) : `<span class="glyph kb ${kb.length === 1 || kb.startsWith('<svg') ? 'round g-ico' : 'pill'}">${kb}</span>`);
    const isVid = CAP.list[CAP.idx]?.kind === 'video';
    const H = [
      [g('b', 'Échap'), 'Fermer', () => closeOverlay()],
      [g('x', 'Suppr'), 'Supprimer', confirmDelete],
      [g('y', 'O'), 'Dossier', () => rr.x('x:capture:openFolder', CAP.gameId)],
      [g('lr', ICON.lr), 'Parcourir', null],
    ];
    if (isVid && pad) H.push([glyph('a'), 'Lecture / pause', null]);
    $('#hintList').innerHTML = H.map((x, i) => `<button class="hint" data-caph="${i}" ${x[2] ? '' : 'tabindex="-1"'}>${x[0]}<span class="hint-label">${esc(x[1])}</span></button>`).join('');
    $$('#hintList [data-caph]').forEach((b) => b.addEventListener('click', () => H[+b.dataset.caph][2]?.()));
  };

  // ---------------------------------------------------------------- Réglages (#set-capture)
  async function renderSettingsBlock(full = true) {
    const box = $('#set-capture');
    if (!box) return;
    if (full || !box.firstChild) {
      box.innerHTML = `
        <h3 class="set-group">Captures et clips</h3>
        <div class="setting">
          <div><strong id="lbCapPad">Raccourcis de la manette pendant un jeu</strong><span class="dim">Guide + RB (R1) : capture · Guide + LB (L1) : démarrer / arrêter un clip · Guide + B (○) : quitter le jeu · Guide maintenu 1 s : alimentation. Nécessite « Ouvrir le launcher avec le bouton Xbox / PS / Home ».</span></div>
          <button class="toggle" data-toggle="padShortcuts" role="switch" aria-labelledby="lbCapPad" data-nav></button>
        </div>
        <div class="setting">
          <div><strong id="lbCapShare">Bouton Share / Create / Capture : capture d’écran</strong><span class="dim">Aussi le bouton View des manettes Xbox — désactive si un jeu s’en sert (carte…).</span></div>
          <button class="toggle" data-toggle="captureShare" role="switch" aria-labelledby="lbCapShare" data-nav></button>
        </div>
        <div class="setting">
          <div><strong id="lbCapKeys">Raccourcis clavier</strong><span class="dim">Ctrl+Alt+S : capture · Ctrl+Alt+R : démarrer / arrêter un clip (5 min maximum)</span></div>
          <button class="toggle" data-toggle="captureKeys" role="switch" aria-labelledby="lbCapKeys" data-nav></button>
        </div>
        <div class="setting">
          <div><strong id="lbCapAudio">Son du jeu dans les clips</strong><span class="dim">Son du PC enregistré avec la vidéo (Windows). Sinon vidéo seule.</span></div>
          <button class="toggle" data-toggle="clipAudio" role="switch" aria-labelledby="lbCapAudio" data-nav></button>
        </div>
        <div class="setting cap-dir-setting">
          <div><strong id="lbCapDir">Dossier des captures</strong><span class="dim cap-dir" id="capDir"></span></div>
          <div class="cap-dir-actions">
            <button class="btn small" data-capset="pick" data-nav>Changer…</button>
            <button class="btn small" data-capset="reset" data-nav id="capDirReset">Par défaut</button>
            <button class="btn small" data-capset="open" data-nav>Ouvrir</button>
          </div>
        </div>`;
      box.addEventListener('click', onSetClick);
    }
    const st = await rr.x('x:capture:state').catch(() => null);
    if (st && $('#capDir')) { $('#capDir').textContent = ltr(st.dir); $('#capDir').title = st.dir; }
    if ($('#capDirReset')) $('#capDirReset').hidden = !S.lib?.settings?.captureDir;
  }
  async function onSetClick(e) {
    const b = e.target.closest('[data-capset]');
    if (!b) return;
    const a = b.dataset.capset;
    if (a === 'pick') { const r = await rr.x('x:capture:pickDir'); if (r?.ok) toast('Dossier des captures mis à jour', 'success'); }
    else if (a === 'reset') { await rr.x('x:capture:resetDir'); toast('Dossier par défaut rétabli', 'success'); }
    else if (a === 'open') rr.x('x:capture:openFolder');
    renderSettingsBlock(false);
  }

  // ---------------------------------------------------------------- Démarrage
  igInsert();
  renderSettingsBlock(true);
  rr.x('x:capture:state').then((st) => { if (st) setRec(st); }).catch(() => {});
  if (S.lib) CAP.lastKeys = S.lib.settings?.captureKeys;
  window.RRCapture = { refreshGallery, openViewer, setRec, state: CAP }; // banc de test
})();

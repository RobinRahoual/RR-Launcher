/* Module PROFILES (renderer) — profils joueurs façon Switch / Xbox.
   Les données du profil ACTIF sont dans les champs habituels des jeux (g.favorite, g.playtime, g.lastPlayed,
   g.playCount, g.status, g.rating, g.collections) : le reste de l'interface n'a rien à changer (voir src/features/profiles.js).
   Accesseur pour le code nouveau : window.profileGame(g [, profileId]) → { favorite, playtime, lastPlayed, playCount,
   status, rating, collections, totalPlaytime } (totalPlaytime = tous profils confondus).
   window.rrProfiles = { state, current(), avatarHTML(p), open(), switchTo(id) }.
   Accroches (aucune insertion dans app.js) : wrap() de renderDetails (temps total), igRender (avatar du menu en jeu),
   renderHints / onPadBtn (écran « Qui joue ? »), renderSettings ; OVERLAYS.pfWho / .pfEdit ; RR.actions.profiles ;
   bouton rond dans la barre du haut ; entrée du menu ; pastille « profil / tous » dans l'écran Statistiques. */
(() => {
  'use strict';
  const PF = { list: [], current: 'main', last: 'main', statsScope: 'active', avatars: [], colors: [], max: 8, running: false };
  const KEYS = ['favorite', 'playtime', 'lastPlayed', 'playCount', 'status', 'rating', 'collections'];
  const DEF = { favorite: false, playtime: 0, lastPlayed: 0, playCount: 0, status: 'none', rating: 0, collections: [] };
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const cur = () => PF.list.find((p) => p.id === PF.current) || PF.list[0] || { id: 'main', name: 'Joueur 1', avatar: 'star', color: '#3C91E6' };
  const byId = (id) => PF.list.find((p) => p.id === id);
  const multi = () => PF.list.length > 1;

  // ---------------------------------------------------------------- Accesseur public
  const totalPlaytime = (g) => (g?.playtime || 0) + Object.values(g?.pp || {}).reduce((a, r) => a + (r.playtime || 0), 0);
  function profileGame(g, pid = PF.current) {
    if (!g) return null;
    const src = pid === PF.current ? g : (g.pp?.[pid] || {});
    const o = {};
    for (const k of KEYS) o[k] = src[k] ?? DEF[k];
    o.totalPlaytime = totalPlaytime(g);
    return o;
  }
  window.profileGame = profileGame;

  // ---------------------------------------------------------------- Avatars (SVG générés localement)
  const GLYPH = {
    star: ['M32 14l5.3 11.6 12.7 1.3-9.5 8.6 2.7 12.5L32 41.6 20.8 48l2.7-12.5-9.5-8.6 12.7-1.3z'],
    bolt: ['M35 12 19 35h11l-3 17 18-24H34z'],
    heart: ['M32 48s-15-9-15-20c0-5 4-9 8.5-9 3 0 5.3 1.6 6.5 4 1.2-2.4 3.5-4 6.5-4 4.5 0 8.5 4 8.5 9 0 11-15 20-15 20z'],
    moon: ['M38 14a18 18 0 1 0 12 30A15 15 0 0 1 38 14z'],
    pad: ['M22 23h20a10 10 0 0 1 10 10v3a7 7 0 0 1-12.4 4.4L37 37H27l-2.6 3.4A7 7 0 0 1 12 36v-3a10 10 0 0 1 10-10z', 'M20 31h6M23 28v6M41 30.5h.01M44.5 33.5h.01'],
    rocket: ['M32 11c7 6 9.5 15 8.5 24l5.5 6v7l-8.5-3.5h-11L18 48v-7l5.5-6c-1-9 1.5-18 8.5-24z', 'M32 25.5v.01'],
    crown: ['M13 22l10 8 9-13 9 13 10-8-4.5 23h-29z'],
    leaf: ['M48 13C27 13 16 25 16 38c0 4 1 7.5 3 10 2.5-10 9-17 19-21-8 6-13 12.5-14.5 22.5 2.5 1.5 5.5 2 8.5 2 14 0 18-16 16-38.5z'],
    note: ['M26 19l20-5v24.5a6 6 0 1 1-4-5.6V21l-12 3v18.5a6 6 0 1 1-4-5.6z'],
    hex: ['M32 12l17.3 10v20L32 52 14.7 42V22z', 'M32 24l7 4v8l-7 4-7-4v-8z'],
    diamond: ['M22 15h20l8 11-18 24-18-24z', 'M14 26h36M27 15l-3 11 8 24 8-24-3-11'],
    flame: ['M32 11c2 8 12.5 12 12.5 24.5a12.5 12.5 0 0 1-25 0c0-6.5 3-9.5 5.5-11.5 0 4 1.8 6.5 4 7.5-1-8 1-14 3-20.5z'],
  };
  const avatarSVG = (id, color) => {
    const [a, b] = GLYPH[id] || GLYPH.star;
    return `<svg class="pf-svg" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${esc(color)}"/><path d="${a}" fill="#fff"/>${b ? `<path d="${b}" fill="none" stroke="${esc(color)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`;
  };
  const imgUrl = (f) => `rr://profiles/${encodeURIComponent(f)}`;
  function avatarHTML(p, cls = '') {
    if (!p) return '';
    const inner = p.image ? `<img src="${imgUrl(p.image)}" alt="" draggable="false">` : avatarSVG(p.avatar, p.color);
    return `<span class="pf-av ${cls}" style="--pf-c:${esc(p.color)}">${inner}</span>`;
  }

  // ---------------------------------------------------------------- Barre du haut (avatar rond à gauche, comme la Switch)
  const topBtn = document.createElement('button');
  topBtn.className = 'sys-btn pf-top';
  topBtn.dataset.action = 'profiles';
  $('.topbar .tb-left')?.prepend(topBtn);
  function renderTop() {
    const p = cur();
    topBtn.innerHTML = avatarHTML(p);
    topBtn.dataset.tip = p.name;
    topBtn.setAttribute('aria-label', `Profil : ${p.name} — changer de profil`);
  }

  // ---------------------------------------------------------------- Menu
  const menuItem = document.createElement('button');
  menuItem.className = 'menu-item';
  menuItem.dataset.action = 'profiles';
  menuItem.setAttribute('data-nav', '');
  const menuSettings = $('#menu .panel .menu-item[data-action="settings"]');
  menuSettings ? menuSettings.after(menuItem) : $('#menu .panel')?.append(menuItem);
  function renderMenu() {
    menuItem.innerHTML = `${avatarHTML(cur(), 'pf-mi')}<span class="mi-label">Changer de profil</span><span class="mi-key pf-mi-name">${esc(cur().name)}</span>`;
  }

  // ---------------------------------------------------------------- Écran « Qui joue ? »
  const who = document.createElement('div');
  who.className = 'overlay pf-who';
  who.id = 'pfWho'; who.hidden = true;
  who.setAttribute('role', 'dialog'); who.setAttribute('aria-modal', 'true'); who.setAttribute('aria-labelledby', 'pfWhoT');
  who.innerHTML = `<div class="pf-who-in"><h2 id="pfWhoT">Qui joue ?</h2><div class="pf-row" id="pfRow" role="listbox" aria-label="Profils"></div>
    <div class="pf-who-foot"><button type="button" class="btn small" data-nav data-pf="manage">Gérer les profils</button></div></div>`;
  document.body.append(who);
  OVERLAYS.pfWho = '#pfWho';
  function renderWho() {
    const sel = document.activeElement?.closest?.('[data-pfid]')?.dataset.pfid;
    $('#pfRow', who).innerHTML = PF.list.map((p) => `<button type="button" class="pf-tile${p.id === PF.current ? ' is-cur' : ''}" role="option" aria-selected="${p.id === PF.current}" data-nav data-pfid="${esc(p.id)}"${p.id === PF.current ? ' data-default' : ''}>
        ${avatarHTML(p, 'pf-big')}<span class="pf-name">${esc(p.name)}</span><span class="pf-sub">${p.id === 'main' ? 'Principal' : '&nbsp;'}</span></button>`).join('')
      + (PF.list.length < PF.max ? `<button type="button" class="pf-tile pf-add" data-nav data-pf="new"><span class="pf-av pf-big pf-plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></span><span class="pf-name">Ajouter</span><span class="pf-sub">&nbsp;</span></button>` : '');
    if (sel && S.mode === 'pfWho') { const el = $(`[data-pfid="${CSS.escape(sel)}"]`, who); if (el) setFocus(el); }
  }
  function openWho() {
    if (S.mode === 'pfWho') return;
    if (S.topFocus >= 0) shellLeaveTop(true);
    closeAll();
    renderWho();
    openOverlay('pfWho');
  }
  async function switchTo(id) {
    if (id === PF.current) { closeOverlay(true); sfx('confirm'); return; }
    const r = await rr.x('x:profiles:switch', id).catch(() => ({ ok: false, error: 'Erreur' }));
    if (!r.ok) return toast(r.error, true);
    apply(r.state);
    closeAll();
    if (S.view === 'games') { S.tab = 'all'; }
    sfx('start');
    toast(`Bonjour, ${cur().name}`, 'success');
  }
  who.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pfid]');
    if (t) return switchTo(t.dataset.pfid);
    const a = e.target.closest('[data-pf]')?.dataset.pf;
    if (a === 'new') openEdit(null);
    else if (a === 'manage') { closeAll(); action('settings').then(() => { setSettingsPage('more'); setTimeout(() => { const f = $('#set-profiles [data-nav]'); if (f) { f.scrollIntoView({ block: 'center' }); setFocus(f); } }, 60); }); }
  });
  const focusedProfile = () => document.activeElement?.closest?.('#pfWho [data-pfid]')?.dataset.pfid;
  addEventListener('keydown', (e) => {
    if (S.mode !== 'pfWho' || e.ctrlKey || e.altKey) return;
    if ((e.key === 'i' || e.key === 'I') && focusedProfile()) { e.preventDefault(); e.stopImmediatePropagation(); openEdit(focusedProfile()); }
    else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.closest?.('#pfWho [data-nav]')) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) document.activeElement.click(); }
  }, true);
  wrap('onPadBtn', (orig, btn) => {
    if (S.mode === 'pfWho' && btn === 'x' && focusedProfile()) { RR.emit('input', 'pad', btn); return openEdit(focusedProfile()); }
    return orig(btn);
  });

  // ---------------------------------------------------------------- Création / modification
  const ed = document.createElement('div');
  ed.className = 'overlay center';
  ed.id = 'pfEdit'; ed.hidden = true;
  ed.setAttribute('role', 'dialog'); ed.setAttribute('aria-modal', 'true'); ed.setAttribute('aria-labelledby', 'pfEdT');
  ed.innerHTML = `<div class="panel pf-panel">
    <div class="pf-ed-head"><span class="pf-prev-wrap"><span id="pfEdPrev"></span><button type="button" class="btn small pf-crop-btn" data-nav data-pfe="crop" hidden>Recadrer</button></span><div class="pf-ed-hd"><h2 id="pfEdT">Nouveau profil</h2>
      <label class="pf-field"><span class="dim">Nom</span><input id="pfName" type="text" maxlength="20" autocomplete="off" spellcheck="false" data-nav data-default></label></div></div>
    <h3 class="set-group">Avatar</h3><div class="pf-grid" id="pfAvs" role="radiogroup" aria-label="Avatar"></div>
    <h3 class="set-group">Couleur</h3><div class="pf-colors" id="pfCols" role="radiogroup" aria-label="Couleur"></div>
    <p class="set-note" id="pfEdNote"></p>
    <div class="pf-actions"><button type="button" class="btn danger" data-nav data-pfe="delete" id="pfDel">Supprimer</button><span class="pf-sp"></span>
      <button type="button" class="btn" data-nav data-pfe="cancel">Annuler</button><button type="button" class="btn primary" data-nav data-pfe="save">Enregistrer</button></div></div>`;
  document.body.append(ed);
  OVERLAYS.pfEdit = '#pfEdit';
  const E = { id: null, avatar: 'star', color: '#3C91E6', image: '', src: '' };

  // ---------------------------------------------------------------- Recadrage de la photo (cercle)
  // Glisser pour déplacer, molette / curseur / boutons pour zoomer ; manette : croix = déplacer, LB/RB ou ± = zoom.
  function cropImage(file) {
    return new Promise((resolve) => {
      const V = 300; // diamètre de la vue
      const C = { x: 0, y: 0, z: 1, min: 1, w: 0, h: 0 };
      let done = false;
      const finish = (v) => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); resolve(v); };
      openPrompt({
        title: 'Recadrer la photo',
        body: `<div class="pf-crop" style="--v:${V}px"><div class="pf-crop-view" tabindex="0" data-nav data-default aria-label="Zone de recadrage : flèches pour déplacer, + et − pour zoomer"><img alt="" draggable="false"></div><i class="pf-crop-ring" aria-hidden="true"></i></div>
          <div class="pf-crop-zoom"><button type="button" class="btn small" data-cz="-" data-nav aria-label="Dézoomer">−</button><input type="range" min="100" max="400" step="1" value="100" aria-label="Zoom" data-nav><button type="button" class="btn small" data-cz="+" data-nav aria-label="Zoomer">+</button></div>
          <p class="dim pf-crop-tip">Glisse la photo pour la centrer, zoome avec la molette.</p>`,
        actions: [
          { label: 'Annuler', onClick: () => { closeOverlay(); finish(null); } },
          { label: 'Valider', primary: true, onClick: async () => {
            const cv = document.createElement('canvas'); cv.width = cv.height = 512;
            const k = 512 / V, g = cv.getContext('2d');
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, (V / 2 + C.x - (C.w * C.z) / 2) * k, (V / 2 + C.y - (C.h * C.z) / 2) * k, C.w * C.z * k, C.h * C.z * k);
            const f = await rr.x('x:profiles:saveCrop', cv.toDataURL('image/jpeg', 0.9)).catch(() => null);
            closeOverlay(true);
            finish(f);
          } },
        ],
      });
      const box = $('#pBody'), img = $('.pf-crop-view img', box), view = $('.pf-crop-view', box), zr = $('input[type=range]', box);
      const clamp = () => {
        const mx = Math.max(0, (C.w * C.z - V) / 2), my = Math.max(0, (C.h * C.z - V) / 2);
        C.x = Math.max(-mx, Math.min(mx, C.x)); C.y = Math.max(-my, Math.min(my, C.y));
      };
      const paint = () => { clamp(); img.style.transform = `translate(-50%, -50%) translate(${C.x}px, ${C.y}px) scale(${C.z})`; zr.value = Math.round((C.z / C.min) * 100); };
      const zoom = (f) => { const z = Math.max(C.min, Math.min(C.min * 4, C.z * f)); C.x *= z / C.z; C.y *= z / C.z; C.z = z; paint(); };
      img.onload = () => {
        C.w = img.naturalWidth; C.h = img.naturalHeight;
        C.min = C.z = V / Math.min(C.w, C.h); // le cercle est toujours couvert
        img.style.width = `${C.w}px`; img.style.height = `${C.h}px`;
        paint();
      };
      img.onerror = () => { toast('Image illisible', true); closeOverlay(true); finish(null); };
      // via data: (et pas rr://) pour que le canvas ne soit pas « contaminé » au moment d'exporter
      fetch(imgUrl(file)).then((r) => r.blob()).then((b) => new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = ko; fr.readAsDataURL(b); }))
        .then((u) => { img.src = u; }).catch(() => img.onerror());
      let drag = null;
      view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - C.x, y: e.clientY - C.y }; view.setPointerCapture(e.pointerId); view.classList.add('is-drag'); });
      view.addEventListener('pointermove', (e) => { if (!drag) return; C.x = e.clientX - drag.x; C.y = e.clientY - drag.y; paint(); });
      view.addEventListener('pointerup', () => { drag = null; view.classList.remove('is-drag'); });
      view.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
      zr.addEventListener('input', () => { const z = C.min * (+zr.value / 100); C.x *= z / C.z; C.y *= z / C.z; C.z = z; paint(); });
      box.addEventListener('click', (e) => { if (done) return; const b = e.target.closest('[data-cz]'); if (b) zoom(b.dataset.cz === '+' ? 1.15 : 1 / 1.15); });
      function onKey(e) {
        if (S.mode !== 'prompt' || document.activeElement !== view) return;
        const d = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
        if (d) { e.preventDefault(); e.stopImmediatePropagation(); C.x += d[0]; C.y += d[1]; paint(); }
        else if (e.key === '+' || e.key === '=' || e.key === 'PageUp') { e.preventDefault(); zoom(1.15); }
        else if (e.key === '-' || e.key === 'PageDown') { e.preventDefault(); zoom(1 / 1.15); }
      }
      document.addEventListener('keydown', onKey, true);
      window.rrCropPad = (dir) => { if (done || document.activeElement !== view) return false; const d = { left: [12, 0], right: [-12, 0], up: [0, 12], down: [0, -12] }[dir]; if (!d) return false; C.x += d[0]; C.y += d[1]; paint(); return true; };
    });
  }
  function renderEdit() {
    const p = { name: $('#pfName', ed).value || '?', avatar: E.avatar, color: E.color, image: E.image };
    $('#pfEdPrev', ed).innerHTML = avatarHTML(p, 'pf-big');
    $('.pf-crop-btn', ed).hidden = !E.image;
    $('#pfAvs', ed).innerHTML = PF.avatars.map((a) => `<button type="button" class="pf-pick${!E.image && a === E.avatar ? ' on' : ''}" role="radio" aria-checked="${!E.image && a === E.avatar}" aria-label="Avatar ${a}" data-nav data-av="${a}">${avatarSVG(a, E.color)}</button>`).join('')
      + `<button type="button" class="pf-pick pf-img${E.image ? ' on' : ''}" role="radio" aria-checked="${!!E.image}" data-nav data-av="__img" title="Image du PC">${E.image ? `<img src="${imgUrl(E.image)}" alt="">` : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>'}<span>Image…</span></button>`;
    $('#pfCols', ed).innerHTML = PF.colors.map((c) => `<button type="button" class="pf-col${c === E.color ? ' on' : ''}" role="radio" aria-checked="${c === E.color}" aria-label="Couleur ${c}" data-nav data-col="${c}" style="--pf-c:${c}"></button>`).join('');
  }
  function openEdit(id) {
    const p = id ? byId(id) : null;
    if (!p && PF.list.length >= PF.max) return toast(`${PF.max} profils au maximum`, true);
    E.id = p?.id || null;
    E.avatar = p?.avatar || PF.avatars[PF.list.length % PF.avatars.length] || 'star';
    E.color = p?.color || PF.colors.find((c) => !PF.list.some((x) => x.color === c)) || PF.colors[0];
    E.image = p?.image || ''; E.src = '';
    $('#pfEdT', ed).textContent = p ? 'Modifier le profil' : 'Nouveau profil';
    $('#pfName', ed).value = p?.name || '';
    $('#pfDel', ed).hidden = !p || p.id === 'main';
    $('#pfEdNote', ed).textContent = p?.id === 'main'
      ? 'Profil principal : il ne peut pas être supprimé. Ses identifiants Steam / RetroAchievements servent aux profils qui n’en ont pas.'
      : 'Favoris, temps de jeu, statut, notes, collections et statistiques sont propres à chaque profil. Les identifiants Steam / RetroAchievements et le thème saisis quand ce profil est actif lui sont propres ; sinon ceux du principal sont utilisés.';
    renderEdit();
    openOverlay('pfEdit');
  }
  const typeName = () => {
    if (typeof window.rrKeyboard !== 'function') { $('#pfName', ed).focus(); return; }
    window.rrKeyboard({ mode: 'name', title: E.id ? 'Nom du profil' : 'Nouveau profil', value: $('#pfName', ed).value, max: 20, empty: 'Donne un nom au profil', onSubmit: (v) => { $('#pfName', ed).value = v; renderEdit(); } });
  };
  $('#pfName', ed).addEventListener('click', () => { if (S.device === 'pad') typeName(); });
  $('#pfName', ed).addEventListener('input', () => { const p = { avatar: E.avatar, color: E.color, image: E.image }; $('#pfEdPrev', ed).innerHTML = avatarHTML(p, 'pf-big'); });
  const keepFocus = (sel) => { renderEdit(); const el = $(sel, ed); if (el && S.device !== 'mouse') setFocus(el); };
  ed.addEventListener('click', async (e) => {
    const av = e.target.closest('[data-av]'), col = e.target.closest('[data-col]'), act = e.target.closest('[data-pfe]')?.dataset.pfe;
    if (av) {
      if (av.dataset.av === '__img') {
        const f = await rr.x('x:profiles:pickImage').catch(() => null);
        if (f) { const c = await cropImage(f); if (c) { E.src = f; E.image = c; } else if (!E.image) return; }
        else if (!E.image) return;
      }
      else { E.avatar = av.dataset.av; E.image = ''; }
      sfx('toggle'); return keepFocus(`[data-av="${av.dataset.av}"]`);
    }
    if (col) { E.color = col.dataset.col; sfx('toggle'); return keepFocus(`[data-col="${col.dataset.col}"]`); }
    if (act === 'cancel') return closeOverlay();
    if (act === 'crop') { const c = await cropImage(E.src || E.image); if (c) { E.image = c; renderEdit(); } return; }
    if (act === 'save') {
      const r = await rr.x('x:profiles:save', { id: E.id, name: $('#pfName', ed).value, avatar: E.avatar, color: E.color, image: E.image }).catch(() => ({ ok: false, error: 'Erreur' }));
      if (!r.ok) { toast(r.error, true); return; }
      apply(r.state);
      closeOverlay(true);
      toast(E.id ? 'Profil modifié' : 'Profil créé', 'success');
      return;
    }
    if (act === 'delete') {
      const p = byId(E.id);
      if (!p || p.id === 'main') return;
      openPrompt({
        title: `Supprimer « ${p.name} » ?`,
        body: '<p class="dim">Ses favoris, temps de jeu, statuts, notes et collections sont effacés. Les jeux restent dans la bibliothèque ; ses sessions restent visibles dans « Tous les profils ».</p>',
        actions: [
          { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
          { label: 'Supprimer', danger: true, primary: true, onClick: async () => {
            const r = await rr.x('x:profiles:remove', p.id).catch(() => ({ ok: false, error: 'Erreur' }));
            if (!r.ok) { closeOverlay(true); return toast(r.error, true); }
            apply(r.state); closeOverlay(true); closeOverlay(true); toast('Profil supprimé', 'success');
          } },
        ],
      });
    }
  });

  // ---------------------------------------------------------------- Aides (barre du bas) pour « Qui joue ? »
  wrap('renderHints', (orig, ...a) => {
    orig(...a);
    if (S.mode !== 'pfWho') return;
    const pad = S.device === 'pad';
    const hint = (g, l) => `<button class="hint" tabindex="-1">${g}<span class="hint-label">${esc(l)}</span></button>`;
    $('#hintList').innerHTML = hint(glyph('b'), 'Retour') + (focusedProfile() || !document.activeElement?.closest?.('#pfWho') ? hint(pad ? glyph('x') : '<span class="glyph kb round g-ico">I</span>', 'Modifier') : '') + hint(glyph('lr'), 'Choisir') + hint(glyph('a'), 'Valider');
  });
  who.addEventListener('focusin', () => renderHints());

  // ---------------------------------------------------------------- Menu en jeu : avatar du profil
  const igAv = document.createElement('span');
  igAv.className = 'pf-ig';
  $('#ingame .ig-head .ig-live')?.after(igAv);
  wrap('igRender', (orig, g, ...a) => {
    orig(g, ...a);
    igAv.innerHTML = `${avatarHTML(cur())}<span>${esc(cur().name)}</span>`;
    if (multi() && g) { const t = totalPlaytime(g); if (t !== (g.playtime || 0)) $('#igTotal').title = `Tous profils : ${fmtTime(t)}`; }
  });

  // ---------------------------------------------------------------- Page du jeu : temps total tous profils
  wrap('renderDetails', (orig, ...a) => {
    orig(...a);
    const g = S.items[S.sel] || S.lib.games.find((x) => x.id === S.selId);
    const box = $('#dStats');
    if (!g || !box || !multi()) return;
    const t = totalPlaytime(g);
    if (t > (g.playtime || 0)) box.insertAdjacentHTML('beforeend', `<div class="pf-total"><b>${fmtTime(t)}</b><span>Tous profils</span></div>`);
  });

  // ---------------------------------------------------------------- Statistiques : profil actif / tous les profils
  function mountStatsScope() {
    const host = $('#stats .st-range');
    if (!host) return false;
    let b = $('.pf-st', host);
    if (!b) {
      b = document.createElement('button');
      b.className = 'st-icon-btn pf-st'; b.tabIndex = -1;
      b.setAttribute('data-stitem', '');
      host.insertBefore(b, $('.st-close', host));
      b.addEventListener('click', async () => {
        PF.statsScope = await rr.x('x:profiles:statsScope', PF.statsScope === 'all' ? 'active' : 'all').catch(() => PF.statsScope);
        renderStatsScope(); sfx('toggle');
      });
    }
    renderStatsScope();
    return true;
  }
  function renderStatsScope() {
    const b = $('#stats .pf-st');
    if (!b) return;
    b.hidden = !multi();
    const all = PF.statsScope === 'all';
    b.innerHTML = all ? '<span class="pf-st-all" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><circle cx="16.5" cy="10" r="2.6"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c2.6-.4 5 .9 6 4.4"/></svg></span><span>Tous les profils</span>' : `${avatarHTML(cur())}<span>${esc(cur().name)}</span>`;
    b.setAttribute('aria-label', `Statistiques : ${all ? 'tous les profils' : cur().name} — changer`);
    b.dataset.tip = all ? 'Afficher seulement le profil actif' : 'Afficher tous les profils';
  }
  if (!mountStatsScope()) {
    const mo = new MutationObserver(() => { if (mountStatsScope()) mo.disconnect(); });
    mo.observe(document.body, { childList: true });
  }

  // ---------------------------------------------------------------- Réglages (#set-profiles)
  const setBox = $('#set-profiles');
  function renderSet() {
    if (!setBox) return;
    const ask = S.lib.settings?.profilesAsk !== 'last';
    setBox.innerHTML = `<h3 class="set-group">Profils</h3>
      ${PF.list.map((p) => `<div class="setting pf-set-row">${avatarHTML(p, 'pf-sm')}<div><strong>${esc(p.name)}${p.id === PF.current ? ' <span class="pf-tag">Actif</span>' : ''}</strong><span class="dim">${p.id === 'main' ? 'Profil principal' : p.own?.length ? 'Identifiants ou thème propres' : 'Identifiants du profil principal'}</span></div>
        <div class="pf-set-act">${p.id !== PF.current ? `<button class="btn small" data-nav data-pfs="use" data-id="${esc(p.id)}">Utiliser</button>` : ''}<button class="btn small" data-nav data-pfs="edit" data-id="${esc(p.id)}">Modifier</button></div></div>`).join('')}
      <div class="setting"><div><strong>Au démarrage</strong><span class="dim">Avec plusieurs profils, afficher « Qui joue ? » ou reprendre le dernier profil</span></div>
        <div class="seg" data-setting="profilesAsk"><button data-value="ask" data-nav aria-pressed="${ask}">Demander</button><button data-value="last" data-nav aria-pressed="${!ask}">Garder le dernier</button></div></div>
      ${PF.list.length < PF.max ? '<div class="setting"><div><strong>Nouveau profil</strong><span class="dim">Jusqu’à 8 profils : avatar, couleur, favoris et temps de jeu séparés</span></div><button class="btn small accent" data-nav data-pfs="new">Ajouter…</button></div>' : ''}
      <p class="set-note">Changer de profil : avatar en haut à gauche (↑ puis A), ou Menu → Changer de profil. Le temps total de tous les profils reste affiché sur la page du jeu.</p>`;
  }
  setBox?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pfs]');
    if (!b) return;
    const a = b.dataset.pfs;
    if (a === 'new') openEdit(null);
    else if (a === 'edit') openEdit(b.dataset.id);
    else if (a === 'use') rr.x('x:profiles:switch', b.dataset.id).then((r) => { if (!r.ok) return toast(r.error, true); apply(r.state); toast(`Profil : ${cur().name}`, 'success'); sfx('confirm'); });
  });
  wrap('renderSettings', (orig, ...a) => { orig(...a); if (!setBox?.contains(document.activeElement)) renderSet(); else $$('[data-setting="profilesAsk"] button', setBox).forEach((x) => x.setAttribute('aria-pressed', String((S.lib.settings?.profilesAsk || 'ask') === x.dataset.value))); });

  // ---------------------------------------------------------------- État
  function apply(st) {
    if (!st) return;
    Object.assign(PF, st);
    renderTop(); renderMenu(); renderStatsScope();
    if (S.mode === 'pfWho') renderWho();
    renderSet();
  }
  RR.actions.profiles = () => openWho();
  rr.onX('x:profiles:changed', apply);
  window.rrProfiles = { get state() { return PF; }, current: cur, avatarHTML, avatarSVG, open: openWho, switchTo, profileGame, edit: openEdit };
  renderTop(); renderMenu();

  rr.x('x:profiles:get').then((st) => {
    apply(st);
    // Premier lancement, ou profil encore nommé « Joueur 1 » : on propose d'abord de le personnaliser
    const me = cur();
    if (!st.running && (!S.lib.settings?.profileSetupDone || /^joueur\s*1$/i.test(me.name || ''))) {
      const t0 = performance.now();
      const tryEdit = () => {
        if (performance.now() - t0 > 15000) return;
        if (shellSplashActive() || LD.active || BO.busy || S.mode !== 'main' || (S.lib.running || []).length) return setTimeout(tryEdit, 250);
        openEdit(me.id);
        $('#pfEdT', ed).textContent = 'Bienvenue ! Choisis ton nom et ta photo';
        rr.setSettings({ profileSetupDone: true });
      };
      setTimeout(tryEdit, 400);
      return;
    }
    // Démarrage : « Qui joue ? » si plusieurs profils et l'option « Demander »
    if (multi() && S.lib.settings?.profilesAsk !== 'last' && !st.running) {
      const t0 = performance.now();
      const tryOpen = () => {
        if (performance.now() - t0 > 6000) return;
        if (shellSplashActive() || LD.active || BO.busy || S.mode !== 'main' || (S.lib.running || []).length) return setTimeout(tryOpen, 200);
        openWho();
      };
      setTimeout(tryOpen, 300);
    }
  }).catch(() => {});
})();

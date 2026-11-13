/* Module LIBRARY — recherche (clavier virtuel), filtres, collections, statut & note.
   Accroches (aucune insertion dans app.js) : les fonctions globales d'app.js sont enveloppées via wrap() :
   computeTabs / computeItems (onglets + filtrage), enterPlatform (filtres), renderDetails (bloc statut/note),
   renderCapBadges (pastille de statut), renderHints / glyph (aides), onPadBtn (clavier virtuel à la manette),
   renderSettings (réglages). Overlays : OVERLAYS.search / .filters / .collections.
   Entrées : « / » ou Ctrl+F (clavier), RS = clic du stick droit (manette), icône loupe de la barre du haut.
   Filtres : touche G ou icône de la barre du haut. Données : g.status, g.rating, g.collections ; settings.collections. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Données
  const STATUS = [
    { id: 'todo', label: 'À jouer' },
    { id: 'playing', label: 'En cours' },
    { id: 'done', label: 'Terminé' },
    { id: 'complete', label: 'Terminé à 100 %' },
    { id: 'dropped', label: 'Abandonné' },
    { id: 'none', label: 'Aucun' },
  ];
  const SORTS = [
    { id: '', label: 'Par défaut' }, { id: 'name', label: 'Nom' }, { id: 'recent', label: 'Dernière partie' },
    { id: 'year', label: 'Année' }, { id: 'playtime', label: 'Temps de jeu' }, { id: 'rating', label: 'Note' }, { id: 'added', label: 'Ajout récent' },
  ];
  const OPT = (k, d = true) => S.lib.settings?.[k] ?? d;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const stOf = (g) => (g.status && g.status !== 'none' ? g.status : 'none');
  const stLabel = (id) => STATUS.find((s) => s.id === id)?.label || '';
  const colls = () => (Array.isArray(S.lib.settings?.collections) ? S.lib.settings.collections : []);
  const gameById = (id) => S.lib.games.find((g) => g.id === id);
  const curGame = () => S.items[S.sel] || gameById(S.selId);
  const patchGame = (id, patch) => rr.x('x:library:patch', { id, patch }).catch(() => null);
  const collOp = (o) => rr.x('x:library:op', o).catch(() => ({ ok: false, error: 'Erreur' }));
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const ICO = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/><path d="m12.5 9.5 5 5m0-5-5 5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  };

  // ---------------------------------------------------------------- Filtres (session)
  const F = { genre: '', decade: '', status: '', fav: false, played: '', sort: '' };
  const fActive = () => !!(F.genre || F.decade || F.status || F.fav || F.played || F.sort);
  const fReset = () => { F.genre = F.decade = F.status = F.played = F.sort = ''; F.fav = false; };
  const playedOf = (g) => !!(g.lastPlayed || g.playtime > 0);
  function applyF(list) {
    let l = list;
    if (F.genre) l = l.filter((g) => (g.genres || []).includes(F.genre));
    if (F.decade) l = l.filter((g) => { const y = +yearOf(g); return y && Math.floor(y / 10) * 10 === +F.decade; });
    if (F.status) l = l.filter((g) => stOf(g) === F.status);
    if (F.fav) l = l.filter((g) => g.favorite);
    if (F.played) l = l.filter((g) => (F.played === 'played') === playedOf(g));
    if (F.sort) {
      l = [...l];
      const by = {
        name: (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
        recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
        year: (a, b) => (+yearOf(b) || 0) - (+yearOf(a) || 0),
        playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0),
        rating: (a, b) => (b.rating || 0) - (a.rating || 0),
        added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      }[F.sort];
      if (by) l.sort(by);
    }
    return l;
  }

  // ---------------------------------------------------------------- Onglets : Backlog / statuts / collections
  const backlogOf = (g) => g.status === 'todo' || g.status === 'playing';
  const isLibTab = (id) => id === 'lb' || id.startsWith('ls:') || id.startsWith('lc:');
  const tabMatch = (id, g) => (id === 'lb' ? backlogOf(g) : id.startsWith('ls:') ? stOf(g) === id.slice(3) : (g.collections || []).includes(id.slice(3)));
  wrap('computeTabs', (orig) => {
    const want = S.tab;
    orig();
    const g = inPlat(S.lib.games);
    const extra = [];
    if (OPT('libTabBacklog')) { const n = g.filter(backlogOf).length; if (n) extra.push({ id: 'lb', label: 'Backlog', n }); }
    if (OPT('libTabStatus', false)) for (const s of STATUS) if (s.id !== 'none') { const n = g.filter((x) => stOf(x) === s.id).length; if (n) extra.push({ id: 'ls:' + s.id, label: s.label, n }); }
    if (OPT('libTabColl')) for (const c of colls()) { const n = g.filter((x) => (x.collections || []).includes(c)).length; if (n) extra.push({ id: 'lc:' + c, label: c, n }); }
    let at = S.tabs.findIndex((t) => t.id === 'recent');
    if (at < 0) at = S.tabs.findIndex((t) => t.id === 'fav');
    if (at < 0) at = 0;
    S.tabs.splice(at + 1, 0, ...extra);
    if (S.tab === 'all' && want !== 'all' && S.tabs.some((t) => t.id === want)) S.tab = want;
  });
  wrap('computeItems', (orig) => {
    orig();
    if (isLibTab(S.tab)) S.items = sorted(inPlat(S.lib.games).filter((g) => tabMatch(S.tab, g)));
    if (S.view === 'games' && fActive()) S.items = applyF(S.items);
  });
  // Recalcule l'écran jeux après un changement de filtre (même effet qu'un changement d'onglet)
  function recompute() {
    S.flip = 0;
    computeTabs(); computeItems();
    S.sel = 0; S.pos = reduceMotion ? 0 : 1.6; S.vel = 0; S.selId = S.items[0]?.id || null;
    if (!S.items.length) setZone('row', true);
    renderTabs(); syncSlots(); updateChrome(true); renderPills(); renderHints();
    if (typeof scheduleSweep === 'function') scheduleSweep();
  }
  wrap('enterPlatform', (orig, ...a) => {
    orig(...a);
    if (S.view === 'games' && fActive()) recompute();
    renderPills(); syncTop();
  });
  $('#catEmptyAll')?.addEventListener('click', () => { if (fActive()) { fReset(); recompute(); } });

  // ---------------------------------------------------------------- Pastilles de filtres actifs (au-dessus des onglets)
  const pills = document.createElement('div');
  pills.className = 'lib-pills'; pills.id = 'libPills'; pills.hidden = true;
  document.body.append(pills);
  const fLabel = {
    genre: () => 'Genre : ' + F.genre, decade: () => 'Années ' + F.decade, status: () => 'Statut : ' + stLabel(F.status),
    fav: () => 'Favoris', played: () => (F.played === 'played' ? 'Déjà joués' : 'Jamais joués'), sort: () => 'Tri : ' + SORTS.find((s) => s.id === F.sort)?.label,
  };
  function renderPills() {
    const on = fActive() && S.view === 'games';
    pills.hidden = !on;
    syncTop();
    if (!on) { pills.innerHTML = ''; return; }
    const t = $('#tabs')?.getBoundingClientRect();
    if (t && t.width) { pills.style.left = t.left + 'px'; pills.style.top = Math.max(t.top - 40, 8) + 'px'; }
    pills.innerHTML = Object.keys(fLabel).filter((k) => F[k]).map((k) =>
      `<button type="button" class="lib-pill" data-fx="${k}" title="Retirer ce filtre"><span>${esc(fLabel[k]())}</span>${ICO.close}</button>`).join('')
      + `<button type="button" class="lib-pill clear" data-fx="all">Effacer</button>`;
  }
  pills.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    if (b.dataset.fx === 'all') fReset(); else if (b.dataset.fx === 'fav') F.fav = false; else F[b.dataset.fx] = '';
    sfx('toggle'); recompute();
  });

  // ---------------------------------------------------------------- Barre du haut : Rechercher, Filtres
  const sysbar = $('#sysbar');
  const mkBtn = (action, tip, icon) => {
    const b = document.createElement('button');
    b.className = 'sys-btn'; b.dataset.action = action; b.dataset.tip = tip; b.setAttribute('aria-label', tip);
    b.innerHTML = icon;
    return b;
  };
  const btnSearch = mkBtn('libSearch', 'Rechercher', ICO.search);
  const btnFilter = mkBtn('libFilters', 'Filtres', ICO.filter);
  sysbar?.append(btnSearch, btnFilter);
  function syncTop() {
    btnSearch.hidden = !S.lib.games.length;
    btnFilter.hidden = S.view !== 'games' || !S.items.length && !fActive();
    btnFilter.classList.toggle('has-dot', fActive());
  }
  addEventListener('resize', () => renderPills());
  RR.on('view', (v) => { if (v === 'home' && fActive()) fReset(); renderPills(); });
  RR.on('library', () => { syncTop(); renderPills(); if (S.mode === 'collections') renderColl(); if (S.mode === 'filters') renderFilters(); syncSettings(); });
  RR.on('selection', () => syncTop());

  // Menu : entrée « Rechercher »
  {
    const menu = $('#menu .panel');
    const ref = $('[data-action="addHub"]', menu);
    if (menu && ref) {
      const it = document.createElement('button');
      it.className = 'menu-item'; it.dataset.action = 'libSearch'; it.dataset.nav = '';
      it.innerHTML = `${ICO.search.replace('<svg ', '<svg class="ico" ')}<span class="mi-label">Rechercher un jeu</span><kbd class="mi-key">/</kbd>`;
      ref.before(it);
    }
  }

  // ---------------------------------------------------------------- Overlays (créés ici)
  const mkOverlay = (id, label, inner, cls = '') => {
    const el = document.createElement('div');
    el.className = 'overlay center ' + cls; el.id = id; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label);
    el.innerHTML = inner;
    el.addEventListener('mousedown', (e) => { if (e.target === el) closeOverlay(); });
    document.body.append(el);
    return el;
  };
  const focusKey = (root, fn) => {
    const k = document.activeElement?.closest?.('[data-fk]')?.dataset.fk;
    fn();
    if (k && S.device !== 'mouse') { const el = $(`[data-fk="${CSS.escape(k)}"]`, root); if (el) setFocus(el); }
  };

  // ================================================================ Recherche + clavier virtuel
  const ROWS = [
    [...'1234567890'].map((c) => ({ c })).concat([{ c: 'back', span: 2 }]),
    [...'AZERTYUIOP'].map((c) => ({ c })).concat([{ c: 'É' }, { c: 'È' }]),
    [...'QSDFGHJKLM'].map((c) => ({ c })).concat([{ c: 'À' }, { c: 'Ç' }]),
    [...'WXCVBN'].map((c) => ({ c })).concat([{ c: '\'' }, { c: '-' }, { c: ' ', span: 4 }]),
    [{ c: 'clear', span: 6 }, { c: 'ok', span: 6 }],
  ];
  const Q = { mode: 'search', value: '', title: '', ph: '', max: 60, onSubmit: null };
  const keysHTML = ROWS.flat().map(({ c, span }) => {
    const st = span ? ` style="grid-column: span ${span}"` : '';
    if (c === 'back') return `<button type="button" class="ls-key fn" data-k="back" data-fk="k-back" data-nav aria-label="Effacer un caractère"${st}>${ICO.back}</button>`;
    if (c === 'clear') return `<button type="button" class="ls-key fn" data-k="clear" data-fk="k-clear" data-nav${st}>Tout effacer</button>`;
    if (c === 'ok') return `<button type="button" class="ls-key fn ok" data-k="ok" data-fk="k-ok" data-nav${st}>${ICO.check}<span class="ls-ok-l">Valider</span></button>`;
    if (c === ' ') return `<button type="button" class="ls-key fn" data-k=" " data-fk="k-sp" data-nav aria-label="Espace"${st}>Espace</button>`;
    return `<button type="button" class="ls-key" data-k="${esc(c)}" data-fk="k-${esc(c)}" data-nav${c === 'A' ? ' data-default' : ''}${st}>${esc(c)}</button>`;
  }).join('');
  const elS = mkOverlay('libSearch', 'Recherche', `
    <div class="ls-wrap">
      <div class="ls-head">
        <span class="ls-ico">${ICO.search}</span>
        <div class="ls-field" id="lsField" role="textbox" aria-label="Recherche"><span class="ls-title" id="lsTitle" hidden></span><span class="ls-txt" id="lsTxt"></span><i class="ls-caret" aria-hidden="true"></i><span class="ls-ph" id="lsPh"></span></div>
        <span class="ls-count" id="lsCount" aria-live="polite"></span>
      </div>
      <div class="ls-results" id="lsResults" role="listbox" aria-label="Résultats"></div>
      <div class="ls-kbd" id="lsKbd" role="group" aria-label="Clavier">${keysHTML}</div>
    </div>`, 'lib-search');

  const hayCache = new WeakMap();
  const hay = (g) => {
    let h = hayCache.get(g);
    if (!h) {
      const p = plat(g.platform);
      h = { name: norm(g.name), all: norm([g.name, g.developer, g.publisher, (g.genres || []).join(' '), p.name, p.short, yearOf(g), (g.collections || []).join(' ')].join(' | ')) };
      hayCache.set(g, h);
    }
    return h;
  };
  function searchGames(q) {
    const nq = norm(q).trim();
    const toks = nq.split(/\s+/).filter(Boolean);
    if (!toks.length) return [...S.lib.games].sort((a, b) => (b.lastPlayed || b.addedAt || 0) - (a.lastPlayed || a.addedAt || 0)).slice(0, 14);
    const out = [];
    for (const g of S.lib.games) {
      const h = hay(g);
      if (!toks.every((t) => h.all.includes(t))) continue;
      const s = h.name.startsWith(nq) ? 0 : h.name.includes(nq) ? 1 : toks.every((t) => h.name.includes(t)) ? 2 : 3;
      out.push([s, g]);
    }
    return out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'fr', { sensitivity: 'base' })).map((x) => x[1]).slice(0, 60);
  }
  function renderResults() {
    const box = $('#lsResults', elS);
    if (Q.mode !== 'search') { box.innerHTML = ''; box.hidden = true; $('#lsCount', elS).textContent = ''; return; }
    box.hidden = false;
    const list = searchGames(Q.value);
    const none = Q.value.trim() && !list.length;
    $('#lsCount', elS).textContent = Q.value.trim() ? (list.length ? `${list.length} résultat${list.length > 1 ? 's' : ''}` : 'Aucun résultat') : 'Récemment joués';
    box.classList.toggle('is-empty', !!none);
    box.innerHTML = none ? `<p class="ls-none">Aucun jeu ne correspond à « ${esc(Q.value.trim())} ».<br><span class="dim">Cherche un titre, un studio, un genre ou une console.</span></p>`
      : list.map((g) => {
        const p = plat(g.platform), ci = caseInfo(g);
        const cover = g.media?.cover ? `style="--r:${ci.ratio || 0.7};background-image:url('${mediaUrl(g, g.media.cover)}')"` : `style="--r:${ci.ratio || 0.7};--c:${esc(p.color)}"`;
        return `<button type="button" class="ls-res" role="option" data-nav data-fk="r-${esc(g.id)}" data-id="${esc(g.id)}" title="${esc(g.name)}">
          <span class="ls-cov${g.media?.cover ? '' : ' ph'}" ${cover}>${g.media?.cover ? '' : esc((g.name || '?').slice(0, 1).toUpperCase())}</span>
          <span class="ls-rn">${esc(g.name)}</span><span class="ls-rp"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span></button>`;
      }).join('');
  }
  function renderField() {
    $('#lsTxt', elS).textContent = Q.value;
    $('#lsPh', elS).textContent = Q.value ? '' : Q.ph;
    const t = $('#lsTitle', elS);
    t.hidden = Q.mode !== 'name'; t.textContent = Q.title;
    elS.classList.toggle('is-name', Q.mode === 'name');
  }
  function typeKey(ch, virtual) {
    if (Q.value.length >= Q.max) return;
    if (Q.mode === 'name' && ch !== ' ') {
      if (!Q.value || Q.value.endsWith(' ')) ch = ch.toLocaleUpperCase('fr');
      else if (virtual) ch = ch.toLocaleLowerCase('fr');
    }
    if (ch === ' ' && (!Q.value || Q.value.endsWith(' '))) return;
    Q.value += ch;
    renderField(); renderResults(); sfx('move');
  }
  function backKey() { if (!Q.value) return false; Q.value = Q.value.slice(0, -1); renderField(); renderResults(); sfx('move'); return true; }
  function clearKey() { if (!Q.value) return; Q.value = ''; renderField(); renderResults(); sfx('toggle'); }
  function validate() {
    if (Q.mode === 'name') {
      const v = Q.value.trim();
      if (!v) return toast(Q.empty || 'Donne un nom à la collection', true);
      const cb = Q.onSubmit;
      closeOverlay(true);
      cb?.(v);
      return;
    }
    const first = $('.ls-res', elS);
    if (first) { setFocus(first); sfx('move'); } else toast('Aucun résultat', 'info');
  }
  elS.addEventListener('click', (e) => {
    const r = e.target.closest('.ls-res');
    if (r) { const g = gameById(r.dataset.id); if (g) gotoGame(g); return; }
    const k = e.target.closest('.ls-key');
    if (!k) return;
    const c = k.dataset.k;
    if (c === 'back') backKey(); else if (c === 'clear') clearKey(); else if (c === 'ok') validate(); else typeKey(c, true);
  });
  function openKeyboard(o = {}) {
    Object.assign(Q, { mode: o.mode || 'search', value: o.value || '', title: o.title || '', ph: o.ph || (o.mode === 'name' ? 'Nom' : 'Rechercher un jeu, un studio, un genre…'), max: o.max || 60, onSubmit: o.onSubmit || null, empty: o.empty || '' }); // PROFILES : empty = message si nom vide
    renderField(); renderResults();
    $('#lsKbd', elS).classList.toggle('is-name', Q.mode === 'name');
    openOverlay('search');
  }
  window.rrKeyboard = openKeyboard; // PROFILES : clavier virtuel réutilisé (mode 'name')
  function openSearch() {
    if (!S.lib.games.length || LD.active || BO.busy || shellSplashActive()) return;
    if (S.mode === 'search') return;
    if (S.mode !== 'main' && S.mode !== 'menu') return;
    if (S.mode === 'menu') closeOverlay(true);
    if (S.topFocus >= 0) shellLeaveTop(true);
    openKeyboard({ mode: 'search' });
  }
  // Va sur le jeu : entre dans sa console (écran jeux) et le sélectionne
  function gotoGame(g) {
    closeAll();
    fReset();
    S.tab = 'all';
    if (S.view === 'games') goHome();
    enterPlatform(g.platform);
    if (S.view !== 'games') return;
    const i = S.items.findIndex((x) => x.id === g.id);
    if (i >= 0) { S.sel = i; S.selId = g.id; S.pos = reduceMotion ? i : i - 1.4; S.vel = 0; syncSlots(); updateChrome(true); }
    setZone('row', true);
    renderPills(); renderHints();
    sfx('confirm');
  }
  // Clavier virtuel à la manette : A = taper (clic), B = effacer / fermer, X = espace, Y = tout effacer, RT / Menu = valider
  function padSearch(btn) {
    if (btn === 'a') { const el = document.activeElement; if (el && el !== document.body && navables().includes(el)) el.click(); else focusFirst(); }
    else if (btn === 'b') { if (!backKey()) closeOverlay(); }
    else if (btn === 'x') typeKey(' ', true);
    else if (btn === 'y') clearKey();
    else if (btn === 'rt' || btn === 'menu') validate();
  }
  wrap('onPadBtn', (orig, btn) => {
    if (S.mode === 'search') { RR.emit('input', 'pad', btn); return padSearch(btn); }
    return orig(btn);
  });
  // RS (clic du stick droit, bouton 11) = recherche, depuis l'accueil ou l'écran jeux
  let rsPrev = false;
  setInterval(() => {
    const p = !document.hidden && !!window.padSnapshot?.().b[11]; // NAV : API Gamepad + lecture native
    if (p && !rsPrev && !document.hidden && S.mode === 'main') { setDevice('pad'); openSearch(); }
    rsPrev = p;
  }, 50);
  // Clavier physique : « / » ou Ctrl+F ouvrent ; dans la recherche, la frappe va directement dans le champ
  addEventListener('keydown', (e) => {
    if (e.target?.matches?.('input, select, textarea')) return;
    if (S.mode === 'search') {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key;
      if (k.length === 1) { e.preventDefault(); e.stopImmediatePropagation(); setDevice('kbd'); typeKey(k, false); }
      else if (k === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); setDevice('kbd'); backKey(); }
      else if (k === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); clearKey(); }
      return;
    }
    if (S.mode !== 'main' || LD.active || BO.busy || e.repeat) return;
    const k = e.key;
    if (k === '/' || (e.ctrlKey && (k === 'f' || k === 'F'))) { e.preventDefault(); e.stopImmediatePropagation(); setDevice('kbd'); openSearch(); }
    else if ((k === 'g' || k === 'G') && !e.ctrlKey && !e.altKey && S.view === 'games' && S.lib.games.length) { e.preventDefault(); e.stopImmediatePropagation(); setDevice('kbd'); openFilters(); }
  }, true);

  // ================================================================ Panneau Filtres
  const elF = mkOverlay('libFilters', 'Filtres', `
    <div class="panel xwide lf-panel">
      <h2>Filtres</h2>
      <div class="lf-body" id="lfBody"></div>
      <div class="panel-actions"><button class="btn" data-nav data-lf-clear>Effacer les filtres</button><button class="btn primary" data-nav data-default data-lf-done>Terminé</button></div>
    </div>`);
  function renderFilters() {
    const g = inPlat(S.lib.games);
    const gen = new Map(), dec = new Set();
    for (const x of g) { for (const t of x.genres || []) gen.set(t, (gen.get(t) || 0) + 1); const y = +yearOf(x); if (y) dec.add(Math.floor(y / 10) * 10); }
    const genres = [...gen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 14).map(([t]) => t);
    if (F.genre && !genres.includes(F.genre)) genres.push(F.genre);
    const decades = [...dec].sort((a, b) => b - a);
    const chip = (grp, v, label, on) => `<button type="button" class="lib-chip" data-nav data-fk="f-${grp}-${esc(v)}" data-f="${grp}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
    const row = (label, chips) => `<div class="lf-row"><span class="lf-l">${label}</span><div class="lf-chips">${chips}</div></div>`;
    focusKey(elF, () => {
      $('#lfBody', elF).innerHTML =
        row('Genre', chip('genre', '', 'Tous', !F.genre) + genres.map((t) => chip('genre', t, t, F.genre === t)).join(''))
        + row('Décennie', chip('decade', '', 'Toutes', !F.decade) + decades.map((d) => chip('decade', d, d + 's', +F.decade === d)).join(''))
        + row('Statut', chip('status', '', 'Tous', !F.status) + STATUS.map((s) => chip('status', s.id, s.label, F.status === s.id)).join(''))
        + row('Affichage', chip('fav', '1', 'Favoris', F.fav) + chip('played', 'played', 'Déjà joués', F.played === 'played') + chip('played', 'never', 'Jamais joués', F.played === 'never'))
        + row('Tri', SORTS.map((s) => chip('sort', s.id, s.label, F.sort === s.id)).join(''));
    });
  }
  elF.addEventListener('click', (e) => {
    const c = e.target.closest('.lib-chip');
    if (c) {
      const k = c.dataset.f, v = c.dataset.v;
      if (k === 'fav') F.fav = !F.fav; else F[k] = F[k] === v ? '' : v;
      sfx('toggle'); renderFilters(); recompute(); return;
    }
    if (e.target.closest('[data-lf-clear]')) { fReset(); sfx('toggle'); renderFilters(); recompute(); }
    else if (e.target.closest('[data-lf-done]')) closeOverlay();
  });
  function openFilters() {
    if (S.mode !== 'main' || S.view !== 'games') return;
    if (S.topFocus >= 0) shellLeaveTop(true);
    renderFilters();
    openOverlay('filters');
  }

  // ================================================================ Collections
  const C = { game: null };
  const elC = mkOverlay('libColl', 'Collections', `
    <div class="panel wide lc-panel">
      <h2>Collections</h2>
      <p class="dim lc-sub" id="lcSub"></p>
      <div class="lc-list" id="lcList"></div>
    </div>`);
  function renderColl() {
    const g = C.game ? gameById(C.game) : null;
    $('#lcSub', elC).textContent = g ? `Ajoute ou retire « ${g.name} » d’une collection.` : 'Crée, renomme ou supprime tes collections.';
    const list = colls();
    focusKey(elC, () => {
      $('#lcList', elC).innerHTML = (list.length ? list.map((name) => {
        const n = S.lib.games.filter((x) => (x.collections || []).includes(name)).length;
        const on = !!g?.collections?.includes(name);
        return `<div class="lc-row">
          <button type="button" class="lc-main" data-nav data-fk="m-${esc(name)}" data-lc="${g ? 'toggle' : 'rename'}" data-name="${esc(name)}" ${g ? `role="checkbox" aria-checked="${on}"` : ''}>
            ${g ? `<span class="lc-check${on ? ' on' : ''}">${ICO.check}</span>` : `<span class="lc-fold">${ICO.folder}</span>`}
            <span class="lc-name">${esc(name)}</span><span class="lc-n">${n} jeu${n > 1 ? 'x' : ''}</span></button>
          <button type="button" class="lc-ico" data-nav data-fk="r-${esc(name)}" data-lc="rename" data-name="${esc(name)}" aria-label="Renommer ${esc(name)}" title="Renommer">${ICO.edit}</button>
          <button type="button" class="lc-ico danger" data-nav data-fk="d-${esc(name)}" data-lc="delete" data-name="${esc(name)}" aria-label="Supprimer ${esc(name)}" title="Supprimer">${ICO.trash}</button>
        </div>`;
      }).join('') : '<p class="lc-none dim">Aucune collection pour l’instant.</p>')
        + `<button type="button" class="btn primary lc-new" data-nav data-default data-fk="new" data-lc="new">${ICO.plus}<span>Nouvelle collection</span></button>`;
    });
  }
  elC.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lc]');
    if (!b) return;
    const name = b.dataset.name, a = b.dataset.lc, g = C.game ? gameById(C.game) : null;
    if (a === 'toggle' && g) {
      const r = await collOp({ op: 'toggle', id: g.id, name });
      if (r.ok) { sfx('toggle'); toast(g.collections?.includes(name) ? `Retiré de « ${name} »` : `Ajouté à « ${name} »`, 'success'); }
    } else if (a === 'new') {
      openKeyboard({ mode: 'name', title: 'Nouvelle collection', onSubmit: async (v) => {
        const r = await collOp({ op: 'create', name: v });
        if (!r.ok) return toast(r.error, true);
        if (g) await collOp({ op: 'toggle', id: g.id, name: v });
        toast(`Collection « ${v} » créée`, 'success');
      } });
    } else if (a === 'rename') {
      openKeyboard({ mode: 'name', title: 'Renommer la collection', value: name, onSubmit: async (v) => {
        if (v === name) return;
        const r = await collOp({ op: 'rename', name, to: v });
        if (!r.ok) return toast(r.error, true);
        if (S.tab === 'lc:' + name) S.tab = 'lc:' + v;
        toast('Collection renommée', 'success');
      } });
    } else if (a === 'delete') {
      openPrompt({
        title: `Supprimer « ${name} » ?`,
        body: '<p class="dim">Les jeux ne sont pas supprimés : seule la collection disparaît.</p>',
        actions: [
          { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
          { label: 'Supprimer', danger: true, onClick: async () => { closeOverlay(true); const r = await collOp({ op: 'delete', name }); if (r.ok) toast('Collection supprimée', 'success'); } },
        ],
      });
    }
  });
  function openColl(id = null) {
    C.game = id;
    renderColl();
    openOverlay('collections');
  }

  // ================================================================ Page du jeu : statut, note, collections
  const dBlock = document.createElement('div');
  dBlock.className = 'lib-d'; dBlock.id = 'libD';
  dBlock.innerHTML = `
    <div class="lib-d-row"><span class="lib-d-l" id="libStL">Statut</span>
      <div class="lib-chips" role="radiogroup" aria-labelledby="libStL">${STATUS.map((s) => `<button type="button" class="lib-chip st-${s.id}" data-nav data-st="${s.id}" role="radio" aria-checked="false">${esc(s.label)}</button>`).join('')}</div></div>
    <div class="lib-d-row"><span class="lib-d-l" id="libRtL">Note</span>
      <div class="lib-stars" role="radiogroup" aria-labelledby="libRtL">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="lib-star" data-nav data-star="${n}" role="radio" aria-checked="false" aria-label="${n} étoile${n > 1 ? 's' : ''}">${ICO.star}</button>`).join('')}</div>
      <button type="button" class="lib-chip lib-coll-btn" data-nav data-lib-coll>${ICO.folder}<span>Collections</span><b class="lib-coll-n"></b></button></div>`;
  $('#dSub')?.after(dBlock);
  function syncDetails(g = curGame()) {
    if (!g) return;
    const st = stOf(g), r = g.rating || 0;
    $$('[data-st]', dBlock).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.st === st)));
    $$('[data-star]', dBlock).forEach((b) => { const on = +b.dataset.star <= r; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(+b.dataset.star === r)); });
    const n = (g.collections || []).filter((c) => colls().includes(c)).length;
    $('.lib-coll-n', dBlock).textContent = n ? String(n) : '';
  }
  wrap('renderDetails', (orig, ...a) => { orig(...a); syncDetails(); });
  dBlock.addEventListener('click', async (e) => {
    const g = curGame();
    if (!g) return;
    const st = e.target.closest('[data-st]'), star = e.target.closest('[data-star]');
    if (st) { await patchGame(g.id, { status: st.dataset.st }); sfx('toggle'); }
    else if (star) {
      const n = +star.dataset.star, next = (g.rating || 0) === n ? 0 : n;
      await patchGame(g.id, { rating: next }); sfx('toggle');
    } else if (e.target.closest('[data-lib-coll]')) openColl(g.id);
  });
  // Les flèches gauche / droite sur une étoile : survol d'aperçu à la manette = focus (déjà géré par spatial())

  // ---------------------------------------------------------------- Écran jeux : pastille de statut / note dans le bloc infos
  wrap('renderCapBadges', (orig, g, ...a) => {
    orig(g, ...a);
    if (!g) return;
    const box = $('#capBadges');
    const st = stOf(g);
    let h = '';
    if (st !== 'none') h += `<span class="badge lib-badge st-${st}"><i class="lib-dot"></i>${esc(stLabel(st))}</span>`;
    if (g.rating) h += `<span class="badge lib-badge rate" aria-label="Note ${g.rating} sur 5">${ICO.star}${g.rating}/5</span>`;
    if (h) box.insertAdjacentHTML('afterbegin', h);
  });

  // ---------------------------------------------------------------- Aides (barre du bas)
  wrap('glyph', (orig, btn) => {
    const pad = S.device === 'pad', ps = S.padType === 'ps';
    if (btn === 'rs') return pad ? `<span class="glyph pill">${ps ? 'R3' : 'RS'}</span>` : '<span class="glyph kb round g-ico">/</span>';
    if (btn === 'rt') return pad ? `<span class="glyph pill">${ps ? 'R2' : 'RT'}</span>` : '<span class="glyph kb pill">Entrée</span>';
    return orig(btn);
  });
  RR.hints.push((h) => { if (S.lib.games.length && S.topFocus < 0) h(['rs'], 'Rechercher', 'libSearch'); });
  wrap('renderHints', (orig, ...a) => {
    orig(...a);
    if (S.mode !== 'search') return;
    const pad = S.device === 'pad';
    const hint = (g, l) => `<button class="hint" tabindex="-1">${g}<span class="hint-label">${esc(l)}</span></button>`;
    const kb = (t) => `<span class="glyph kb pill">${t}</span>`;
    $('#hintList').innerHTML = pad
      ? hint(glyph('b'), 'Effacer · fermer') + hint(glyph('y'), 'Tout effacer') + hint(glyph('x'), 'Espace') + hint(glyph('rt'), 'Valider') + hint(glyph('a'), 'Taper')
      : hint(kb('Échap'), 'Fermer') + hint(kb('⌫'), 'Effacer') + hint(glyph('ud'), 'Se déplacer') + hint(kb('Entrée'), 'Choisir') + hint(kb('A–Z'), 'Taper');
  });

  // ================================================================ Réglages (#set-library)
  const setBox = $('#set-library');
  const TOG = [
    ['libTabBacklog', 'Onglet Backlog', 'Les jeux « À jouer » et « En cours » réunis dans un onglet'],
    ['libTabStatus', 'Onglets par statut', 'Un onglet par statut utilisé (Terminé, Abandonné…)'],
    ['libTabColl', 'Onglets des collections', 'Une collection = un onglet sur l’écran des jeux'],
  ];
  if (setBox) {
    setBox.innerHTML = `<h3 class="set-group">Bibliothèque</h3>`
      + TOG.map(([k, t, d]) => `<div class="setting"><div><strong id="lb-${k}">${t}</strong><span class="dim">${d}</span></div><button class="toggle" data-libtoggle="${k}" role="switch" aria-labelledby="lb-${k}" data-nav></button></div>`).join('')
      + `<div class="setting"><div><strong>Collections</strong><span class="dim" id="libCollCount"></span></div><button class="btn small" data-nav data-lib-manage>Gérer…</button></div>
         <p class="set-note">Recherche : <b>/</b> ou <b>Ctrl+F</b> au clavier, clic sur le stick droit (RS) à la manette, ou la loupe en haut. Filtres : touche <b>G</b> ou l’icône en haut. Statut, note et collections se règlent sur la page du jeu.</p>`;
    setBox.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-libtoggle]');
      if (t) { await rr.setSettings({ [t.dataset.libtoggle]: !OPT(t.dataset.libtoggle, t.dataset.libtoggle !== 'libTabStatus') }); sfx('toggle'); }
      else if (e.target.closest('[data-lib-manage]')) openColl(null);
    });
  }
  function syncSettings() {
    if (!setBox) return;
    $$('[data-libtoggle]', setBox).forEach((b) => b.setAttribute('aria-checked', String(!!OPT(b.dataset.libtoggle, b.dataset.libtoggle !== 'libTabStatus'))));
    const n = colls().length;
    const c = $('#libCollCount', setBox);
    if (c) c.textContent = n ? `${n} collection${n > 1 ? 's' : ''}` : 'Aucune collection';
  }
  wrap('renderSettings', (orig, ...a) => { orig(...a); syncSettings(); });
  syncSettings();

  // ---------------------------------------------------------------- Actions (boutons data-action, menu, aides)
  RR.actions.libSearch = () => { if (S.mode === 'menu') closeOverlay(true); openSearch(); };
  RR.actions.libFilters = () => openFilters();
  OVERLAYS.search = '#libSearch';
  OVERLAYS.filters = '#libFilters';
  OVERLAYS.collections = '#libColl';
  syncTop();
})();

// Module RECOMP — « Recomps » : tout le catalogue de RecompLauncher (recomp, décompilations, portages PC) rangé
// comme dans une ludothèque. Une section par console, des planches où les boîtes sont debout, tranche vers soi
// (boîtes en 3D : tranche + face). Survoler / sélectionner une boîte la tire à moitié du rayon et la tourne vers
// soi ; la choisir la sort complètement : elle pivote face à soi et glisse jusqu'à la fiche, où on la tient en
// main. « Remettre sur le rayon » (B / Échap) fait le chemin inverse.
// Côté main : src/features/recomp.js (x:recomp:*). Accroches : OVERLAYS.recomp, overlayBack (window.recompBack),
// entrée du menu, carte du hub d'ajout.
(() => {
  const ICO = {
    shelf: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M3 12h18M4 4v16M20 4v16"/><path d="M7 12V6h3v6M12 12V7l3-.5L16 12M7 20v-5h3v5M13 20v-6h3v6"/></svg>',
    ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    back: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    search: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    ext: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };
  const mo = (b) => (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const PLACE = {
    copy: 'Le launcher copie ta ROM dans le dossier de la recomp : rien à faire au lancement.',
    arg: 'Le launcher donne ta copie à la recomp à chaque lancement : rien à faire.',
    select: 'Au premier lancement, la recomp te demande ta copie (ou la trouve seule) : le chemin du fichier choisi plus haut est copié pour toi.',
    installer: 'Au premier lancement, l’assistant de la recomp te demande les fichiers de ton jeu : indique le dossier choisi plus haut.',
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ST = { items: [], root: '', at: null, source: '', view: 'shelves', cur: null, full: null, prog: {}, busy: null, filter: 'all', q: '', anim: false, scroll: 0 };

  // Dimensions des boîtes (px) : hauteur de rayon, épaisseur de la tranche ; largeur = hauteur × format de la console
  const SH = 178, GAP = 3;
  const dims = (x) => {
    const r = Math.max(0.55, Math.min(1.45, (x.platform && plat(x.platform)?.case?.ratio) || 0.7));
    const h = r >= 1 ? Math.round(SH * 0.74) : SH; // boîtes à l'italienne (N64, SNES…) : plus basses
    return { w: Math.round(h * r), h, d: Math.round(SH * (r >= 1 ? 0.17 : 0.13)) };
  };
  const pc = (x) => (x.platform ? plat(x.platform).color : '#5b6b7c');
  const shortOf = (x) => (x.platform ? plat(x.platform).short || plat(x.platform).name : x.originName || x.origin);

  const ov = document.createElement('div');
  ov.className = 'overlay center'; ov.id = 'recompStore'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'rcTitle');
  ov.innerHTML = '<div class="panel wide rc-panel"></div>';
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });
  OVERLAYS.recomp = '#recompStore';
  const panel = $('.panel', ov);

  async function open(id = null) {
    ST.view = id ? 'detail' : 'shelves'; ST.cur = id;
    panel.classList.remove('is-detail');
    panel.innerHTML = '<h2 id="rcTitle">Recomps</h2><p class="panel-lead"><span class="spinner tiny"></span> Chargement du catalogue RecompLauncher…</p>';
    openOverlay('recomp');
    await refresh();
  }
  async function refresh(force = false) {
    const r = await rr.x('x:recomp:list', { refresh: force }).catch(() => null);
    if (r) { ST.items = r.items; ST.root = r.root; ST.at = r.at; ST.source = r.source; }
    if (ST.view === 'detail' && ST.cur) ST.full = await rr.x('x:recomp:get', ST.cur).catch(() => null);
    render();
  }
  const item = (id) => ST.items.find((x) => x.id === id);
  const cur = (id = ST.cur) => (ST.full?.id === id ? ST.full : item(id));

  function keepFocus(fn) {
    const a = document.activeElement;
    const key = a && ov.contains(a) ? [...a.attributes].find((x) => x.name.startsWith('data-rc'))?.name : null;
    const val = key ? a.getAttribute(key) : null;
    fn();
    const room = $('.rc-room', panel);
    if (room) room.scrollTop = ST.scroll;
    const f = key ? $(`[${key}="${CSS.escape(val)}"]`, panel) : null;
    if (f) setFocus(f); else if (S.mode === 'recomp' && !ov.contains(document.activeElement)) focusFirst();
  }
  function render() {
    const room = $('.rc-room', panel);
    if (room) ST.scroll = room.scrollTop;
    keepFocus(() => {
      const x = ST.view === 'detail' && cur();
      panel.classList.toggle('is-detail', !!x);
      panel.innerHTML = x ? detailHtml(x) : shelvesHtml();
      if (!x) watchShelves();
    });
  }

  // ---------------------------------------------------------------- Boîte 3D (face, tranche, dessus, dos)
  function cubeHtml(x, { big = false } = {}) {
    const { w, h, d } = dims(x);
    const k = big ? 2.1 : 1;
    const label = x.game && x.game !== x.name ? x.game : x.name;
    // Titre de la tranche : taille réduite pour les titres longs (jamais coupé)
    const room = h * k - d * k * 0.95 - 14;
    const fs = Math.max(6.5 * k, Math.min(d * k * 0.46, 22, room / (x.name.length * 0.66)));
    return `<span class="rc-cube${big && x.cover ? ' has-img' : ''}" style="--w:${Math.round(w * k)}px;--h:${Math.round(h * k)}px;--d:${Math.round(d * k)}px;--pc:${pc(x)}${big && x.cover ? `;--img:url(&quot;${esc(x.cover)}&quot;)` : ''}" ${x.cover ? `data-img="${esc(x.cover)}"` : ''}>
      <span class="f f-front"><span class="f-blank"><small>${esc(shortOf(x))}</small><b>${esc(label)}</b></span></span>
      <span class="f f-spine"><i class="sp-band">${esc(shortOf(x))}</i><b class="sp-title" style="--fs:${fs.toFixed(1)}px">${esc(x.name)}</b></span>
      <span class="f f-top"></span><span class="f f-back"></span><span class="f f-right"></span>
    </span>`;
  }
  function badge(x) {
    if (ST.busy === x.id) return '<span class="rc-dot busy" title="Installation…"></span>';
    if (x.update) return '<span class="rc-dot up" title="Mise à jour disponible"></span>';
    if (x.installed) return '<span class="rc-dot ok" title="Installé"></span>';
    return '';
  }
  function slotHtml(x) {
    const { d, h } = dims(x);
    const cls = [x.soon && 'is-soon', !x.installable && !x.soon && 'is-off', x.installed && 'is-mine'].filter(Boolean).join(' ');
    return `<button class="rc-slot ${cls}" data-rc-open="${esc(x.id)}" data-nav style="--d:${d}px;--h:${h}px" aria-label="${esc(`${x.name} — ${x.game}${x.installed ? ', installé' : x.soon ? ', à venir' : !x.installable ? ', page du projet' : ''}`)}">${cubeHtml(x)}${badge(x)}</button>`;
  }

  // ---------------------------------------------------------------- Ludothèque
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const gid = (k) => `rcs-${k.replace(/[^\w-]/g, '_')}`;
  function visible() {
    const q = norm(ST.q).trim();
    return ST.items.filter((x) => (ST.filter === 'all' || (ST.filter === 'mine' ? x.installed : x.installable))
      && (!q || norm(`${x.name} ${x.game} ${x.originName}`).includes(q)));
  }
  function groups(list) {
    const order = Object.keys(S.P || {});
    const by = new Map();
    for (const x of list) {
      const k = x.platform || `o:${x.origin}`;
      if (!by.has(k)) by.set(k, { key: k, name: x.platform ? plat(x.platform).name : x.originName, color: pc(x), list: [] });
      by.get(k).list.push(x);
    }
    const rank = (g) => (g.key.startsWith('o:') ? 1000 : order.indexOf(g.key));
    return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.list.length - a.list.length);
  }
  function roomHtml() {
    const gs = groups(visible());
    const room = $('.rc-room', panel);
    const rowW = Math.max(400, (room?.clientWidth || (panel.clientWidth || 1100) - 70) - 2 * 52);
    const sections = gs.map((g) => {
      g.list.sort((a, b) => Number(!!b.installed) - Number(!!a.installed) || Number(!!a.soon) - Number(!!b.soon) || Number(!!b.installable) - Number(!!a.installable) || a.name.localeCompare(b.name, 'fr'));
      const rows = [];
      let row = [], used = 0;
      for (const x of g.list) {
        const wd = dims(x).d + GAP;
        if (row.length && used + wd > rowW) { rows.push(row); row = []; used = 0; }
        row.push(x); used += wd;
      }
      if (row.length) rows.push(row);
      return `<section class="rc-section" id="${gid(g.key)}" style="--pc:${g.color}" aria-label="${esc(g.name)}">
        ${rows.map((r, i) => `<div class="rc-shelf">${i === 0 ? `<div class="rc-plaque"><b>${esc(g.name)}</b><i>${g.list.length}</i></div>` : ''}<div class="rc-row">${r.map(slotHtml).join('')}</div><div class="rc-plank"></div></div>`).join('')}
      </section>`;
    }).join('');
    return `<div class="rc-room"><div class="rc-case">${sections || `<p class="dim rc-empty">${ST.q ? 'Aucun jeu ne correspond.' : 'Rien ici pour l’instant.'}</p>`}</div></div>`;
  }
  function shelvesHtml() {
    const all = groups(ST.items);
    const n = ST.items.length;
    return `
      <div class="rc-head">
        <h2 id="rcTitle">Recomps</h2>
        <label class="rc-search">${ICO.search}<input type="search" placeholder="Rechercher parmi ${n} jeux…" value="${esc(ST.q)}" data-rc-q aria-label="Rechercher un jeu" /></label>
        <div class="rc-tabs" role="tablist">
          <button class="rc-tab" role="tab" aria-selected="true" data-nav>Recomps &amp; portages</button>
          <button class="rc-tab" role="tab" aria-selected="false" data-rc-emu data-nav>Émulateurs</button>
        </div>
      </div>
      <div class="rc-filters">
        <span role="radiogroup" aria-label="Afficher" class="rc-fgroup">${[['all', 'Tout'], ['win', 'Installables'], ['mine', 'Installés']].map(([v, l]) => `<button class="ew-opt" role="radio" aria-checked="${ST.filter === v}" data-rc-filter="${v}" data-nav>${l}</button>`).join('')}</span>
        <span class="rc-jumps" aria-label="Aller à une console">${all.map((g) => `<button class="rc-jump" data-rc-jump="${gid(g.key)}" style="--pc:${g.color}" data-nav>${esc(g.name)}<i>${g.list.length}</i></button>`).join('')}</span>
      </div>
      ${roomHtml()}
      <div class="rc-caption" aria-live="polite"><span id="rcCap">${n} jeux · catalogue ${esc(ST.source || '')}${ST.at ? ` du ${new Date(ST.at).toLocaleDateString('fr-FR')}` : ''} — prends une boîte sur le rayon.</span></div>
      <div class="ew-foot"><button class="btn" data-rc-refresh data-nav>Actualiser le catalogue</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }
  // Jaquettes chargées seulement pour les planches proches de l'écran (plusieurs centaines de boîtes)
  let io = null;
  function watchShelves() {
    io?.disconnect();
    const room = $('.rc-room', panel);
    if (!room) return;
    io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        for (const c of $$('.rc-cube[data-img]', en.target)) {
          c.style.setProperty('--img', `url("${c.dataset.img.replace(/"/g, '%22')}")`);
          c.classList.add('has-img');
        }
      }
    }, { root: room, rootMargin: '400px 0px' });
    for (const s of $$('.rc-shelf', panel)) io.observe(s);
  }
  function caption(id) {
    const x = item(id), c = $('#rcCap', panel);
    if (!c || !x) return;
    const st = x.installed ? `installé (${x.installed.version || '?'})` : x.soon ? 'à venir' : !x.installable ? (x.repo && !x.windows ? 'pas de version Windows' : 'page du projet') : 'installable';
    c.innerHTML = `<b>${esc(x.name)}</b> · ${esc(x.game)} <span class="dim">· ${esc(x.originName || '')} · ${esc(st)}</span>`;
  }
  ov.addEventListener('focusin', (e) => { const b = e.target.closest?.('[data-rc-open]'); if (b) caption(b.dataset.rcOpen); });
  ov.addEventListener('mouseover', (e) => { const b = e.target.closest?.('[data-rc-open]'); if (b) caption(b.dataset.rcOpen); });
  let qt;
  ov.addEventListener('input', (e) => {
    if (!e.target.matches('[data-rc-q]')) return;
    ST.q = e.target.value;
    clearTimeout(qt);
    qt = setTimeout(() => {
      const room = $('.rc-room', panel);
      if (!room) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = roomHtml();
      room.replaceWith(tmp.firstElementChild);
      ST.scroll = 0;
      const cap = $('#rcCap', panel);
      if (cap) cap.textContent = ST.q ? `${visible().length} jeu(x) trouvé(s)` : `${ST.items.length} jeux`;
      watchShelves();
    }, 140);
  });

  // ---------------------------------------------------------------- Fiche (jeu sorti du rayon)
  function progHtml(id) {
    const p = ST.prog[id];
    if (!p) return '';
    const pct = p.total ? Math.min(100, Math.round((p.got / p.total) * 100)) : null;
    const err = p.phase === 'error' || p.phase === 'cancelled';
    const size = p.got ? (p.total ? `${mo(p.got)} / ${mo(p.total)} Mo` : `${mo(p.got)} Mo`) : '';
    return `<div class="ew-prog ${err ? 'is-err' : ''} ${pct == null && !err && p.phase !== 'done' ? 'is-indet' : ''}" role="progressbar" aria-label="${esc(p.label || '')}" ${pct != null ? `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"` : ''}>
      <div class="ew-bar"><i style="transform:scaleX(${p.phase === 'done' ? 1 : (pct ?? 0) / 100})"></i></div>
      <div class="ew-pl"><span>${esc(p.label || '')}</span><span class="ew-mo">${pct != null && !err ? `${pct} % · ` : ''}${size}</span></div></div>`;
  }
  function detailHtml(x) {
    const r = x.mine; // copie choisie par le joueur
    const busy = ST.busy === x.id;
    const sys = x.rom.system;
    const needCopy = x.rom.place === 'copy' || x.rom.place === 'arg';
    const canInstall = x.installable && !busy && !ST.busy && (!needCopy || r);
    const step = (n, done, title, body) => `<li class="rc-step ${done ? 'done' : ''}"><span class="rc-n">${done ? ICO.ok : n}</span><div><b>${title}</b>${body}</div></li>`;
    const pickBtns = sys === 'iso_or_folder' || sys === 'any'
      ? `<button class="btn small ${!r && needCopy ? 'primary' : ''}" data-rc-rom="${esc(x.id)}" data-nav>${r ? 'Changer de fichier' : 'Choisir un fichier…'}</button><button class="btn small" data-rc-rom="${esc(x.id)}" data-folder data-nav>Choisir un dossier…</button>`
      : `<button class="btn small ${r ? '' : 'primary'}" data-rc-rom="${esc(x.id)}" data-nav>${r ? 'Changer' : sys === 'folder' ? 'Choisir le dossier du jeu…' : sys === 'n64' ? 'Choisir ma ROM…' : 'Choisir ma copie…'}</button>`;
    const romBody = `
      <p class="dim">${esc(x.rom.label)}</p>
      ${r ? `<div class="ew-bios ${r.warn ? 'warn' : 'ok'}">${r.warn ? ICO.warn : ICO.ok}<span><b>${esc(r.info || '')}</b><br/><code>${esc(ltr(r.path))}</code>${r.warn ? `<br/>${esc(r.warn)}` : ''}</span></div>` : ''}
      <div class="rc-row">${pickBtns}${needCopy ? '' : '<span class="dim">Facultatif : sert à vérifier ta copie et à copier son chemin.</span>'}</div>
      <p class="dim rc-legal">Le launcher ne télécharge jamais de jeu : utilise le dump de ta propre cartouche ou de ton propre disque.</p>`;
    const why = x.soon ? 'Ce projet n’est pas encore sorti.' : !x.repo ? 'Ce projet ne publie pas de version GitHub que le launcher sait installer.' : !x.windows ? 'Ce projet ne propose pas de version Windows.' : '';
    const insBody = !x.installable && !x.installed
      ? `<p class="dim">${esc(why)} Sa page RecompLauncher explique comment l’obtenir.</p><div class="rc-row"><button class="btn small" data-rc-url="${esc(x.url)}" data-nav>${ICO.ext}Ouvrir la page du projet</button></div>`
      : x.installed
        ? `<p class="dim">Version ${esc(x.installed.version || '?')} dans <code>${esc(ltr(x.installed.dir))}</code>${x.latest ? ` · dernière : ${esc(x.latest)}` : ''}</p>
         <div class="rc-row">${x.update ? `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-update data-nav ${canInstall ? '' : 'disabled'}>Mettre à jour (${esc(x.latest)})</button>` : `<button class="btn small" data-rc-check="${esc(x.id)}" data-nav>Rechercher une mise à jour</button>`}
         <button class="btn small" data-rc-folder="${esc(x.id)}" data-nav>Ouvrir le dossier</button>
         <button class="btn small danger" data-rc-uninstall="${esc(x.id)}" data-nav>Désinstaller</button></div>`
        : `<p class="dim">Dernière release de <code>${esc(x.repo)}</code>, installée dans <code>${esc(ltr(ST.root))}</code>.</p>
         <div class="rc-row">${busy ? '<button class="btn small danger" data-rc-cancel data-nav>Annuler</button>' : `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-nav ${canInstall ? '' : 'disabled'}>Installer</button>`}
         ${!canInstall && !busy && needCopy && !r ? '<span class="dim">Choisis d’abord ta copie (étape 1).</span>' : ''}</div>`;
    const playBody = `<p class="dim">${esc(PLACE[x.rom.place] || '')}</p>
      ${x.installed ? `<div class="rc-row"><button class="btn small primary" data-rc-play="${esc(x.id)}" data-nav>Jouer</button>${x.rom.place === 'select' && r ? `<button class="btn small" data-rc-copy="${esc(r.path)}" data-nav>Copier le chemin de ma copie</button>` : ''}</div>` : ''}`;
    return `
      <div class="rc-detail">
        <div class="rc-held">
          <button class="btn small rc-back" data-rc-back data-nav>${ICO.back}Remettre sur le rayon</button>
          <div class="rc-stage"><span class="rc-hold" data-rc-held>${cubeHtml(x, { big: true })}</span></div>
          <div class="rc-held-meta"><span class="rc-plat" style="--pc:${pc(x)}">${esc(shortOf(x))}</span><span class="dim">${esc(x.kind || 'Recomp')}${x.author ? ` · ${esc(x.author)}` : ''}</span></div>
        </div>
        <div class="rc-info">
          <h2 id="rcTitle">${esc(x.name)}</h2>
          <p class="rc-orig">${esc(x.game)}${x.genre ? ` <span class="dim">· ${esc(x.genre)}</span>` : ''}</p>
          ${x.desc ? `<p class="dim rc-about">${esc(x.desc)}</p>` : ''}
          ${x.archived ? '<p class="rc-warn">Projet arrêté par ses auteurs : plus de mises à jour.</p>' : ''}
          <ol class="rc-steps">
            ${step(1, !!r || (!needCopy && !!x.installed), 'Ta copie du jeu', romBody)}
            ${step(2, !!x.installed && !x.update, x.installed ? 'Installée' : 'Installer la recomp', insBody + `<div class="ew-progwrap">${progHtml(x.id)}</div>`)}
            ${step(3, false, 'Jouer', playBody)}
          </ol>
        </div>
      </div>
      <div class="ew-foot"><button class="btn" data-rc-url="${esc(x.url)}" data-nav>${ICO.ext}Page du projet</button>${x.repo ? `<button class="btn" data-rc-url="https://github.com/${esc(x.repo)}" data-nav>GitHub</button>` : ''}<button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }

  // ---------------------------------------------------------------- Sortir / reposer une boîte (3D)
  // La boîte volante est une copie de la grande boîte de la fiche. Pose de départ : même centre et même taille
  // que la boîte sur le rayon (échelle k), tournée de 90° (tranche vers soi), reculée de la moitié de sa largeur
  // pour que la tranche soit dans le plan de l'étagère. Le point de fuite glisse de celui de la planche à celui
  // de la fiche pendant le vol, et une image figée du rayon s'efface sous la boîte.
  function flyer(holdEl) {
    const box = holdEl.getBoundingClientRect();
    const st = (holdEl.closest('.rc-stage') || holdEl).getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'rc-flywrap';
    const f = holdEl.cloneNode(true);
    f.removeAttribute('data-rc-held');
    f.classList.remove('is-hidden');
    f.classList.add('rc-flyer');
    Object.assign(f.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    wrap.append(f);
    document.body.append(wrap);
    const cube = $('.rc-cube', holdEl);
    return { wrap, cube: $('.rc-cube', f), r: box, W: cube.offsetWidth, H: cube.offsetHeight, eye: `${st.left + st.width / 2}px ${st.top + st.height / 2}px` };
  }
  // Mesures d'une boîte sur le rayon : centre, bas, hauteur, point de fuite de sa planche
  function slotGeo(slot) {
    const c = $('.rc-cube', slot), sr = c.getBoundingClientRect(), row = slot.closest('.rc-row').getBoundingClientRect();
    return { cx: sr.left + sr.width / 2, bottom: slot.getBoundingClientRect().bottom, h: c.offsetHeight, eye: `${row.left + row.width / 2}px ${row.top + row.height * 0.3}px` };
  }
  function pose(g, fl) {
    return { k: g.h / fl.H, dx: g.cx - (fl.r.left + fl.r.width / 2), dy: g.bottom - g.h / 2 - (fl.r.top + fl.r.height / 2), W: fl.W };
  }
  function keys(p) {
    // Même liste de fonctions à chaque étape : l'interpolation reste une vraie rotation (pas une matrice mélangée)
    const t = (x, y, z, k, tz, ry, rx) => `translate3d(${x}px,${y}px,${z}px) scale3d(${k},${k},${k}) translateZ(${tz}px) rotateY(${ry}deg) rotateX(${rx}deg)`;
    const back = -p.W / 2;
    return [
      { transform: t(p.dx, p.dy, 0, p.k, back, 90, 0), offset: 0 }, // sur le rayon, tranche vers soi
      { transform: t(p.dx, p.dy - 8, 0, p.k * 1.04, back + 90 / p.k, 86, 0), offset: 0.2 }, // tirée hors du rayon
      { transform: t(p.dx, p.dy - 16, 50, p.k * 1.12, back / 2, 42, 2), offset: 0.42 }, // on la tourne vers soi
      { transform: t(p.dx * 0.35, p.dy * 0.35 - 30, 70, 0.6 + p.k * 0.4, 0, 18, 6), offset: 0.72 }, // on l'amène
      { transform: t(0, 0, 0, 1, 0, 24, 3), offset: 1 }, // tenue en main (= .rc-hold .rc-cube)
    ];
  }
  // Image figée d'une zone (rayon ou fiche) qui s'efface pendant le vol
  function ghostOf(el, scrollTop = 0) {
    const r = el.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'rc-ghost';
    Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const inner = el.cloneNode(true);
    inner.style.transform = `translateY(${-scrollTop}px)`;
    if (inner.classList.contains('rc-room')) { inner.style.overflow = 'visible'; inner.style.height = 'auto'; inner.style.margin = '0'; }
    g.append(inner);
    document.body.append(g);
    return g;
  }
  async function takeFromShelf(id, slot) {
    if (ST.anim) return;
    const roomEl = $('.rc-room', panel);
    ST.scroll = roomEl?.scrollTop || 0;
    sfx('confirm');
    const full = rr.x('x:recomp:get', id).catch(() => null);
    if (reduced() || !slot) { ST.view = 'detail'; ST.cur = id; ST.full = await full; render(); setTimeout(focusFirst, 30); return; }
    ST.anim = true;
    // 1) sur le rayon : la boîte glisse vers soi (CSS .is-pulling), les autres s'assombrissent
    slot.classList.add('is-pulling');
    panel.classList.add('is-taking');
    await wait(240);
    const g = slotGeo(slot);
    slot.classList.add('is-gone');
    const ghost = roomEl ? ghostOf(roomEl, ST.scroll) : null;
    // 2) la fiche se met en place derrière ; la boîte vole jusqu'à la main pendant que le rayon s'efface
    ST.view = 'detail'; ST.cur = id; ST.full = (await full) || item(id);
    render();
    panel.classList.remove('is-taking');
    const hold = $('[data-rc-held]', panel);
    const fl = flyer(hold);
    hold.classList.add('is-hidden');
    panel.classList.add('is-arriving');
    const T = { duration: 1000, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' };
    fl.wrap.animate([{ perspectiveOrigin: g.eye }, { perspectiveOrigin: fl.eye }], T);
    ghost?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.75 }, { opacity: 0 }], { ...T, easing: 'linear' });
    try { await fl.cube.animate(keys(pose(g, fl)), T).finished; } catch {}
    hold.classList.remove('is-hidden');
    panel.classList.remove('is-arriving');
    fl.wrap.remove(); ghost?.remove();
    ST.anim = false;
    focusFirst();
  }
  async function putBack() {
    if (ST.anim) return;
    const id = ST.cur;
    const hold = $('[data-rc-held]', panel);
    ST.view = 'shelves';
    sfx('back');
    if (reduced() || !hold) { render(); const c = $(`[data-rc-open="${CSS.escape(id)}"]`, panel); if (c) { c.scrollIntoView({ block: 'nearest' }); setFocus(c); } return; }
    ST.anim = true;
    const fl = flyer(hold);
    const det = $('.rc-detail', panel);
    const ghost = det ? ghostOf(det) : null;
    if (ghost) $('[data-rc-held]', ghost)?.classList.add('is-hidden');
    render();
    const slot = $(`[data-rc-open="${CSS.escape(id)}"]`, panel);
    if (slot) {
      slot.scrollIntoView({ block: 'nearest' });
      slot.classList.add('is-gone');
      const g = slotGeo(slot);
      const T = { duration: 860, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' };
      fl.wrap.animate([{ perspectiveOrigin: fl.eye }, { perspectiveOrigin: g.eye }], T);
      ghost?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { ...T, easing: 'linear' });
      $('.rc-room', panel)?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], T);
      try { await fl.cube.animate(keys(pose(g, fl)).map((k) => ({ ...k, offset: 1 - k.offset })).reverse(), T).finished; } catch {}
      slot.classList.remove('is-gone');
      setFocus(slot);
      caption(id);
    }
    fl.wrap.remove(); ghost?.remove();
    ST.anim = false;
  }

  // ---------------------------------------------------------------- Évènements
  rr.onX('x:recomp:progress', (p) => {
    if (!p?.id) return;
    ST.prog[p.id] = { ...(ST.prog[p.id] || {}), ...p, ...(p.phase !== 'download' ? { got: 0, total: 0 } : {}) };
    const box = ST.view === 'detail' && ST.cur === p.id ? $('.ew-progwrap', panel) : null;
    if (box) box.innerHTML = progHtml(p.id);
  });
  rr.onX('x:recomp:cover', (c) => {
    const x = c && item(c.id);
    if (!x || !c.url) return;
    x.cover = c.url;
    for (const cube of $$(`[data-rc-open="${CSS.escape(c.id)}"] .rc-cube`, panel)) {
      cube.dataset.img = c.url; cube.style.setProperty('--img', `url("${c.url}")`); cube.classList.add('has-img');
    }
  });

  async function install(id, update = false) {
    const x = cur(id);
    if (!x) return;
    ST.busy = id; ST.prog[id] = { phase: 'resolve', label: 'Préparation…' };
    render();
    const r = await rr.x('x:recomp:install', id, { update }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    ST.busy = null;
    if (r.ok) {
      delete ST.prog[id];
      toast(`${x.name} ${r.version || ''} installé${r.romCopied ? ' · ROM en place' : ''}`, 'success');
      sfx('confirm');
    } else if (!r.cancelled) toast(`${x.name} : ${r.error}`, true);
    await refresh();
  }
  function confirmUninstall(x) {
    openPrompt({
      title: `Désinstaller « ${x.name} » ?`, icon: 'danger', tone: 'danger',
      body: `<p class="dim">Le dossier <code>${esc(ltr(x.installed.dir))}</code> est supprimé, avec la copie de ta ROM qu’il contient et les réglages de la recomp. Les sauvegardes rangées ailleurs (Documents, AppData) sont conservées. Ta copie d’origine n’est pas touchée.</p>`,
      actions: [
        { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
        { label: 'Désinstaller', danger: true, primary: true, onClick: async () => { closeOverlay(true); await rr.x('x:recomp:uninstall', x.id); toast(`${x.name} désinstallé`, 'success'); refresh(); } },
      ],
    });
  }

  ov.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if (ST.anim) return;
    if (t('[data-rc-close]')) return closeOverlay();
    if (t('[data-rc-emu]')) { closeOverlay(true); return RR.actions.emuWizardAll?.(); }
    if (t('[data-rc-refresh]')) { toast('Actualisation du catalogue…'); return refresh(true); }
    if ((b = t('[data-rc-filter]'))) { ST.filter = b.dataset.rcFilter; ST.scroll = 0; sfx('toggle'); return render(); }
    if ((b = t('[data-rc-jump]'))) {
      const s = $(`#${CSS.escape(b.dataset.rcJump)}`, panel);
      if (s) { s.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); const f = $('[data-rc-open]', s); if (f) setTimeout(() => setFocus(f), reduced() ? 0 : 350); }
      return;
    }
    if ((b = t('[data-rc-open]'))) return takeFromShelf(b.dataset.rcOpen, b);
    if (t('[data-rc-back]')) return putBack();
    if ((b = t('[data-rc-rom]'))) {
      const r = await rr.x('x:recomp:pickRom', b.dataset.rcRom, { folder: 'folder' in b.dataset });
      if (r?.cancelled) return;
      if (!r?.ok) { toast(r?.error || 'Fichier refusé', true); return; }
      toast(r.warn ? 'Copie reconnue, avec un avertissement' : `Copie reconnue${r.info ? ' : ' + r.info : ''}`, r.warn ? 'info' : 'success');
      return refresh();
    }
    if ((b = t('[data-rc-install]'))) return install(b.dataset.rcInstall, 'update' in b.dataset);
    if (t('[data-rc-cancel]')) return rr.x('x:recomp:cancel');
    if ((b = t('[data-rc-check]'))) {
      b.disabled = true;
      const r = await rr.x('x:recomp:checkUpdate', b.dataset.rcCheck);
      if (r?.error) toast(r.error, true); else toast(r?.update ? `Mise à jour disponible : ${r.latest}` : 'Déjà à jour', r?.update ? 'info' : 'success');
      return refresh();
    }
    if ((b = t('[data-rc-folder]'))) return rr.x('x:recomp:openFolder', b.dataset.rcFolder);
    if ((b = t('[data-rc-uninstall]'))) { const x = cur(b.dataset.rcUninstall); if (x?.installed) confirmUninstall(x); return; }
    if ((b = t('[data-rc-url]'))) { rr.openExternal(b.dataset.rcUrl); return; }
    if ((b = t('[data-rc-copy]'))) { try { await navigator.clipboard.writeText(b.dataset.rcCopy); toast('Chemin copié : colle-le quand la recomp le demande', 'success'); } catch { toast('Copie impossible', true); } return; }
    if ((b = t('[data-rc-play]'))) {
      const x = cur(b.dataset.rcPlay);
      if (!x?.installed?.gameId) return;
      if (x.rom.place === 'select' && x.mine?.path) { try { await navigator.clipboard.writeText(x.mine.path); } catch {} toast('Chemin de ta copie copié : colle-le quand la recomp le demande'); }
      closeAll();
      rr.launch(x.installed.gameId);
    }
  });
  // B / Échap sur la fiche : la boîte retourne sur le rayon au lieu de fermer (appelé par overlayBack)
  window.recompBack = () => {
    if (S.mode !== 'recomp' || ST.view !== 'detail') return false;
    putBack();
    return true;
  };
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.mode === 'recomp' && ST.view === 'shelves' && !ST.anim) render(); }, 150); });

  RR.actions.recompStore = () => { closeAll(); open(); };
  window.openRecompStore = open;

  // Menu : « Recomps » sous « Ajouter des jeux » ; hub d'ajout : carte « Recomps »
  const add = $('#menu [data-action="addHub"]');
  add?.insertAdjacentHTML('afterend', `<button class="menu-item" data-action="recompStore" data-nav>${ICO.shelf}<span class="mi-label">Recomps</span><kbd class="mi-key">R</kbd></button>`);
  $('#addHub .hub-grid')?.insertAdjacentHTML('beforeend', `
    <button class="hub-card" data-action="recompStore" data-nav>
      <span class="hub-ico"><svg viewBox="0 0 24 24"><path d="M3 20h18M3 12h18M4 4v16M20 4v16"/><path d="M7 12V6h3v6M12 12V7l3-.5L16 12M7 20v-5h3v5M13 20v-6h3v6"/></svg></span>
      <strong>Recomps</strong><span class="dim">Tout le catalogue RecompLauncher : Zelda, Mario Kart 64, Sonic Unleashed, Skate 3… recompilés pour PC</span>
      <span class="hub-meta">Avec ta propre copie du jeu · installation et mises à jour automatiques</span>
    </button>`);
  // Raccourci clavier R dans l'interface principale (hors saisie)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if (e.ctrlKey || e.altKey || e.metaKey || S.mode !== 'main' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    e.preventDefault();
    open();
  });
})();

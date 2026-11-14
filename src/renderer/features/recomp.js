// Module RECOMP — « Recomps » : tout le catalogue de RecompLauncher (recomp, décompilations, portages PC) rangé
// en étagères par console, jaquettes de face. Choisir une boîte joue l'ouverture de la liste des jeux : la boîte
// s'ouvre, le disque (ou la cartouche) sort en tournant, puis la fiche s'affiche. « Remettre sur le rayon »
// (B / Échap) y repose la jaquette. Onglet « Émulateurs » : les consoles en 3D, un clic propose d'installer
// l'émulateur conseillé.
// Côté main : src/features/recomp.js (x:recomp:*) et src/features/emu.js (x:emu:*). Réutilise boMediaHTML /
// caseInfo (app.js, BOXOPEN) et les styles de boxopen.css. Accroches : OVERLAYS.recomp, overlayBack
// (window.recompBack), entrée du menu, carte du hub d'ajout.
(() => {
  const ICO = {
    shelf: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M3 12h18M4 4v16M20 4v16"/><path d="M7 12V6h3v6M12 12V7l3-.5L16 12M7 20v-5h3v5M13 20v-6h3v6"/></svg>',
    ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    info: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    back: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    up: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
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
  const ST = {
    tab: 'recomp', items: [], root: '', at: null, source: '', view: 'shelves', cur: null, full: null, prog: {}, busy: null, filter: 'all', q: '', anim: false, scroll: 0,
    emu: null, emuSel: null, emuChoice: {}, emuProg: {}, emuBusy: null,
  };

  const ov = document.createElement('div');
  ov.className = 'overlay center'; ov.id = 'recompStore'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'rcTitle');
  ov.innerHTML = '<div class="panel wide rc-panel"></div>';
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });
  OVERLAYS.recomp = '#recompStore';
  const panel = $('.panel', ov);

  async function open(tab = 'recomp') {
    ST.tab = tab; ST.view = 'shelves'; ST.cur = null; ST.emuSel = null;
    panel.classList.remove('is-detail');
    panel.innerHTML = '<h2 id="rcTitle">Recomps</h2><p class="panel-lead"><span class="spinner tiny"></span> Chargement du catalogue…</p>';
    openOverlay('recomp');
    await refresh();
  }
  async function refresh(force = false) {
    if (ST.tab === 'emu') {
      ST.emu = await rr.x('x:emu:overview', { all: true }).catch(() => null);
      for (const p of ST.emu?.platforms || []) if (S.platImg[p.id] === undefined) loadImg(p.id);
    } else {
      const r = await rr.x('x:recomp:list', { refresh: force }).catch(() => null);
      if (r) { ST.items = r.items; ST.root = r.root; ST.at = r.at; ST.source = r.source; }
      if (ST.view === 'detail' && ST.cur) ST.full = await rr.x('x:recomp:get', ST.cur).catch(() => null);
    }
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
      if (ST.tab === 'emu') { panel.classList.remove('is-detail'); panel.innerHTML = emuHtml(); return; }
      const x = ST.view === 'detail' && cur();
      panel.classList.toggle('is-detail', !!x);
      panel.innerHTML = x ? detailHtml(x) : shelvesHtml();
    });
  }
  const tabsHtml = () => `<div class="rc-tabs" role="tablist">
      <button class="rc-tab" role="tab" aria-selected="${ST.tab === 'recomp'}" data-rc-tab="recomp" data-nav>Recomps &amp; portages</button>
      <button class="rc-tab" role="tab" aria-selected="${ST.tab === 'emu'}" data-rc-tab="emu" data-nav>Émulateurs</button>
    </div>`;

  // ---------------------------------------------------------------- Boîtes (jaquettes de face)
  const ratio = (x) => Math.max(0.6, Math.min(1.45, plat(x.platform).case?.ratio || 0.7));
  const pc = (x) => (x.platform ? plat(x.platform).color : '#5b6b7c');
  const shortOf = (x) => (x.platform ? plat(x.platform).short || plat(x.platform).name : x.originName || x.origin);
  function boxFace(x, big = false) {
    return x.cover
      ? `<img src="${esc(x.cover)}" alt="" draggable="false" ${big ? '' : 'loading="lazy" decoding="async"'} />`
      : `<span class="rc-blank" style="--pc:${pc(x)}"><small>${esc(shortOf(x))}</small><b>${esc(big ? x.name : x.game)}</b></span>`;
  }
  function badge(x) {
    if (ST.busy === x.id) return '<span class="rc-tag busy">Installation…</span>';
    if (x.update) return `<span class="rc-tag up">${ICO.up}Mise à jour</span>`;
    if (x.installed) return `<span class="rc-tag ok">${ICO.ok}Installé</span>`;
    if (x.soon) return '<span class="rc-tag soon">À venir</span>';
    return '';
  }
  function boxHtml(x) {
    const cls = [x.soon && 'is-soon', !x.installable && !x.soon && !x.installed && 'is-off'].filter(Boolean).join(' ');
    return `<button class="rc-box ${cls}" data-rc-open="${esc(x.id)}" data-nav style="--r:${ratio(x)};--pc:${pc(x)}" aria-label="${esc(`${x.name} — ${x.game}${x.installed ? ', installé' : x.soon ? ', à venir' : ''}`)}">
      <span class="rc-front">${boxFace(x)}</span><span class="rc-side"></span>${badge(x)}
    </button>`;
  }

  // ---------------------------------------------------------------- Étagères par console
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const gid = (k) => `rcs-${k.replace(/[^\w-]/g, '_')}`;
  const SHELF_H = 176, GAP = 18; // = --shelf-h et gap de .rc-boxes (recomp.css)
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
    const roomW = Math.max(480, (panel.clientWidth || 1100) - 2 * 32 - 2 * 26 + 16 - 2 * 18);
    const shelves = groups(visible()).map((g) => {
      g.list.sort((a, b) => Number(!!b.installed) - Number(!!a.installed) || Number(!!a.soon) - Number(!!b.soon) || Number(!!b.installable) - Number(!!a.installable) || a.name.localeCompare(b.name, 'fr'));
      const r = ratio(g.list[0]);
      const boxW = SHELF_H * (r >= 1 ? 0.72 : 1) * r + 7;
      const per = Math.max(1, Math.floor((roomW + GAP) / (boxW + GAP)));
      const rows = [];
      for (let i = 0; i < g.list.length; i += per) rows.push(g.list.slice(i, i + per));
      return `<section id="${gid(g.key)}" aria-label="${esc(g.name)}">${rows.map((row, i) => `<div class="rc-shelf" style="--pc:${g.color}">
        <div class="rc-boxes">${row.map(boxHtml).join('')}</div>
        <div class="rc-plank">${i === 0 ? `<span class="rc-plaque">${esc(g.name)}<i>${g.list.length}</i></span>` : ''}</div>
      </div>`).join('')}</section>`;
    }).join('');
    return `<div class="rc-room">${shelves || `<p class="dim rc-empty">${ST.q ? 'Aucun jeu ne correspond.' : ST.filter === 'mine' ? 'Aucune recomp installée pour l’instant.' : 'Rien ici pour l’instant.'}</p>`}</div>`;
  }
  function shelvesHtml() {
    const all = groups(ST.items);
    return `
      <div class="rc-head">
        <h2 id="rcTitle">Recomps</h2>
        <label class="rc-search">${ICO.search}<input type="search" placeholder="Rechercher parmi ${ST.items.length} jeux…" value="${esc(ST.q)}" data-rc-q aria-label="Rechercher un jeu" /></label>
        ${tabsHtml()}
      </div>
      <div class="rc-filters">
        <span role="radiogroup" aria-label="Afficher" class="rc-fgroup">${[['all', 'Tout'], ['win', 'Installables'], ['mine', 'Installés']].map(([v, l]) => `<button class="ew-opt" role="radio" aria-checked="${ST.filter === v}" data-rc-filter="${v}" data-nav>${l}</button>`).join('')}</span>
        <span class="rc-jumps" aria-label="Aller à une console">${all.map((g) => `<button class="rc-jump" data-rc-jump="${gid(g.key)}" style="--pc:${g.color}" data-nav>${esc(g.name)}<i>${g.list.length}</i></button>`).join('')}</span>
      </div>
      ${roomHtml()}
      <div class="rc-caption" aria-live="polite"><span id="rcCap">${ST.items.length} jeux · catalogue ${esc(ST.source || '')}${ST.at ? ` du ${new Date(ST.at).toLocaleDateString('fr-FR')}` : ''}</span></div>
      <div class="ew-foot"><button class="btn" data-rc-refresh data-nav>Actualiser le catalogue</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
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
    }, 140);
  });

  // ---------------------------------------------------------------- Fiche
  function progHtml(p) {
    if (!p) return '';
    const pct = p.total ? Math.min(100, Math.round((p.got / p.total) * 100)) : null;
    const err = p.phase === 'error' || p.phase === 'cancelled';
    const size = p.got ? (p.total ? `${mo(p.got)} / ${mo(p.total)} Mo` : `${mo(p.got)} Mo`) : '';
    return `<div class="ew-prog ${err ? 'is-err' : ''} ${pct == null && !err && p.phase !== 'done' ? 'is-indet' : ''}" role="progressbar" aria-label="${esc(p.label || '')}" ${pct != null ? `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"` : ''}>
      <div class="ew-bar"><i style="transform:scaleX(${p.phase === 'done' ? 1 : (pct ?? 0) / 100})"></i></div>
      <div class="ew-pl"><span>${esc(p.label || '')}</span><span class="ew-mo">${pct != null && !err ? `${pct} % · ` : ''}${size}</span></div></div>`;
  }
  // Disque / cartouche de la console d'origine (même rendu que la page d'un jeu), étiquette = jaquette
  function mediaFor(x, ref) {
    const m = boMediaHTML({ id: x.id, platform: x.platform || 'pc', color: pc(x) }, ref);
    const label = x.cover ? `url('${x.cover.replace(/'/g, '%27')}') center / cover no-repeat, linear-gradient(150deg, ${pc(x)}, #0b0b16)` : `linear-gradient(150deg, ${pc(x)}, #0b0b16)`;
    return { ...m, html: m.html.replace(/--label:[^"]*"/, `--label:${label.replace(/"/g, '&quot;')}"`) };
  }
  function detailHtml(x) {
    const r = x.mine;
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
    const m = mediaFor(x, 118);
    return `
      <div class="rc-detail">
        <div class="rc-held">
          <button class="btn small rc-back" data-rc-back data-nav>${ICO.back}Remettre sur le rayon</button>
          <div class="rc-box is-held" data-rc-held style="--r:${ratio(x)};--pc:${pc(x)}"><span class="rc-front">${boxFace(x, true)}</span><span class="rc-side"></span></div>
          <div class="rc-held-meta"><span class="rc-plat" style="--pc:${pc(x)}">${esc(shortOf(x))}</span><span class="dim">${esc(x.kind || 'Recomp')}${x.author ? ` · ${esc(x.author)}` : ''}</span></div>
        </div>
        <div class="rc-info">
          <div class="d-head rc-dhead"><div class="d-media" data-media="${m.type}">${m.html}</div>
            <div><h2 id="rcTitle">${esc(x.name)}</h2><p class="rc-orig">${esc(x.game)}${x.genre ? ` <span class="dim">· ${esc(x.genre)}</span>` : ''}</p></div></div>
          ${x.desc ? `<p class="dim rc-about">${esc(x.desc)}</p>` : ''}
          ${x.archived ? '<p class="rc-warn">Projet arrêté par ses auteurs : plus de mises à jour.</p>' : ''}
          <ol class="rc-steps">
            ${step(1, !!r || (!needCopy && !!x.installed), 'Ta copie du jeu', romBody)}
            ${step(2, !!x.installed && !x.update, x.installed ? 'Installée' : 'Installer la recomp', insBody + `<div class="ew-progwrap">${progHtml(ST.prog[x.id])}</div>`)}
            ${step(3, false, 'Jouer', playBody)}
          </ol>
        </div>
      </div>
      <div class="ew-foot"><button class="btn" data-rc-url="${esc(x.url)}" data-nav>${ICO.ext}Page du projet</button>${x.repo ? `<button class="btn" data-rc-url="https://github.com/${esc(x.repo)}" data-nav>GitHub</button>` : ''}<button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }

  // ---------------------------------------------------------------- Ouverture de la boîte (comme la liste des jeux)
  // Boîtier 3D construit avec les classes de boxopen.css (plateau, parois, couvercle qui pivote sur la charnière),
  // jaquette en couvercle ; le disque ou la cartouche sort en tournant, puis la scène s'efface sur la fiche.
  const T = { move: 420, doorAt: 240, door: 460, liftAt: 600, lift: 420, spinAt: 600, outAt: 1040, end: 1360 };
  let opening = null;
  function openBox(x, slot) {
    return new Promise((resolve) => {
      const front = $('.rc-front', slot).getBoundingClientRect();
      const r = ratio(x);
      const H = 320, W = Math.round(H * r), D = Math.round(H * (r >= 1 ? 0.12 : 0.085));
      const ci = caseInfo({ platform: x.platform || 'pc', color: pc(x) });
      const m = mediaFor(x, 0.9 * Math.min(W, H));
      const root = document.createElement('div');
      root.className = 'rc-open';
      root.innerHTML = `<div class="rc-open-bg"${x.cover ? ` style="--bgimg:url('${x.cover.replace(/'/g, '%27')}')"` : ''}></div><div class="rc-open-scene"><div class="rc-open-rig"></div></div>`;
      const rig = $('.rc-open-rig', root);
      rig.style.cssText = `--box-w:${W}px;--box-h:${H}px;--box-d:${D}px;--case:${ci.body || pc(x)};width:${W}px;height:${H}px`;
      rig.innerHTML = `<div class="rc-obox bo-box" data-style="${esc(ci.style || 'dvd')}" style="width:${W}px;height:${H}px">
        <div class="bo-tray" data-media="${m.type}"><i class="bo-holder" style="width:${m.w * 1.05}px;height:${m.h * 1.05}px"></i></div>
        <div class="bo-wall l"></div><div class="bo-wall r"></div><div class="bo-wall t"></div><div class="bo-wall b"></div>
        <div class="bo-door"><div class="rc-oface">${boxFace(x, true)}</div><div class="bo-door-in"><i></i><i></i></div></div>
        <div class="bo-media" style="left:${(W - m.w) / 2}px;top:${(H - m.h) / 2}px;width:${m.w}px;height:${m.h}px"><div class="bo-flip">${m.html}</div></div>
      </div>`;
      document.body.append(root);
      const L = { door: $('.bo-door', root), media: $('.bo-media', root), flip: $('.bo-flip', root), spin: $('.disc-spin, .cart-spin', root), scene: $('.rc-open-scene', root), bg: $('.rc-open-bg', root) };
      const from = { x: front.left + front.width / 2, y: front.top + front.height / 2, s: front.height / H, ry: 0, rx: 0 };
      const s = Math.min(innerHeight * 0.56 / H, innerWidth * 0.26 / W);
      const to = { x: Math.max(innerWidth * 0.36, innerWidth * 0.05 + 1.45 * W * s), y: innerHeight * 0.5, s, ry: -20, rx: 6 };
      const pose = (p) => `translate3d(${(p.x - W / 2).toFixed(1)}px, ${(p.y - H / 2).toFixed(1)}px, 0) rotateY(${p.ry}deg) rotateX(${p.rx}deg) scale(${p.s.toFixed(4)})`;
      L.scene.style.perspectiveOrigin = `${to.x}px ${to.y}px`;
      const anims = [];
      const A = (el, frames, delay, duration, easing = 'cubic-bezier(.2,.8,.2,1)') => { const a = el.animate(frames, { delay, duration, easing, fill: 'both' }); anims.push(a); return a; };
      slot.classList.add('is-gone');
      sfx('boxopen');
      A(L.bg, [{ opacity: 0 }, { opacity: 1 }], 0, 320, 'ease-out');
      A(rig, [{ transform: pose(from) }, { transform: pose(to) }], 0, T.move);
      A(L.door, [
        { transform: `translateZ(${D / 2}px) rotateY(0deg)` },
        { transform: `translateZ(${D / 2}px) rotateY(-12deg)`, offset: 0.18 },
        { transform: `translateZ(${D / 2}px) rotateY(-160deg)` },
      ], T.doorAt, T.door, 'cubic-bezier(.55,0,.25,1)');
      const outX = W * 0.95, outZ = D * 2.6 + H * 0.08;
      A(L.media, [
        { transform: `translate3d(0px, 0px, ${-D / 2 + 2}px) rotateY(0deg) rotateX(0deg) scale(1)` },
        { transform: `translate3d(${W * 0.08}px, ${-H * 0.02}px, ${D * 1.6}px) rotateY(4deg) rotateX(0deg) scale(1.02)`, offset: 0.3 },
        { transform: `translate3d(${outX}px, ${-H * 0.03}px, ${outZ}px) rotateY(${-to.ry + 2}deg) rotateX(${-to.rx - 4}deg) scale(1.16)` },
      ], T.liftAt, T.lift, 'cubic-bezier(.45,0,.2,1)');
      A(L.flip, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(360deg)' }], T.liftAt + 80, 520, 'cubic-bezier(.5,0,.3,1)');
      if (L.spin) {
        if (m.type === 'disc') A(L.spin, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(1620deg)' }], T.spinAt, T.end - T.spinAt, 'cubic-bezier(.55,0,1,.7)');
        else A(L.spin, [{ transform: 'rotate(0deg) translateY(0)' }, { transform: 'rotate(-6deg) translateY(-4%)' }, { transform: 'rotate(0deg) translateY(0)' }], T.spinAt + 400, 360, 'ease-in-out');
      }
      L.scene.style.transformOrigin = `${to.x + outX * to.s * 0.8}px ${to.y}px`;
      A(L.scene, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.14)' }], T.outAt, T.end - T.outAt, 'cubic-bezier(.5,0,.75,0)');
      A(L.bg, [{ opacity: 1 }, { opacity: 0 }], T.outAt + 60, T.end - T.outAt - 60, 'ease-in');
      let shown = false;
      const show = () => { if (!shown) { shown = true; resolve('page'); } };
      const end = () => { anims.forEach((a) => a.cancel()); clearTimeout(t1); clearTimeout(t2); root.remove(); opening = null; };
      const t1 = setTimeout(show, T.outAt);
      const t2 = setTimeout(end, T.end + 20);
      // Clic / A pendant l'animation : on saute à la fiche ; B / Échap : on annule
      opening = { skip: () => { show(); end(); }, cancel: () => { end(); slot.classList.remove('is-gone'); resolve('cancel'); } };
      root.addEventListener('mousedown', (e) => { e.preventDefault(); opening?.skip(); });
    });
  }
  async function takeFromShelf(id, slot) {
    if (ST.anim) return;
    ST.scroll = $('.rc-room', panel)?.scrollTop || 0;
    const full = rr.x('x:recomp:get', id).catch(() => null);
    const x = item(id);
    if (reduced() || !slot || !x || typeof boMediaHTML !== 'function') {
      sfx('confirm');
      ST.view = 'detail'; ST.cur = id; ST.full = (await full) || x; render(); setTimeout(focusFirst, 30); return;
    }
    ST.anim = true;
    const res = await openBox(x, slot);
    ST.anim = false;
    if (res === 'cancel') return;
    ST.view = 'detail'; ST.cur = id; ST.full = (await full) || x;
    render();
    panel.classList.add('is-arriving');
    setTimeout(() => panel.classList.remove('is-arriving'), 700);
    focusFirst();
  }
  // Retour : la jaquette tenue en main revole à sa place sur le rayon
  function flyer(fromEl) {
    const front = $('.rc-front', fromEl) || fromEl;
    const r = front.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'rc-flyer';
    f.style.setProperty('--pc', fromEl.style.getPropertyValue('--pc'));
    f.innerHTML = `<span class="rc-front">${front.innerHTML}</span>`;
    Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(f);
    return { f, r };
  }
  async function putBack() {
    if (ST.anim) return;
    const id = ST.cur;
    const held = $('[data-rc-held]', panel);
    ST.view = 'shelves';
    sfx('back');
    if (reduced() || !held) { render(); const c = $(`[data-rc-open="${CSS.escape(id)}"]`, panel); if (c) { c.scrollIntoView({ block: 'nearest' }); setFocus(c); } return; }
    ST.anim = true;
    const { f, r } = flyer(held);
    render();
    const slot = $(`[data-rc-open="${CSS.escape(id)}"]`, panel);
    if (slot) {
      slot.scrollIntoView({ block: 'nearest' });
      slot.classList.add('is-gone');
      const to = $('.rc-front', slot).getBoundingClientRect();
      const dx = to.left - r.left, dy = to.top - r.top, sx = to.width / r.width, sy = to.height / r.height;
      try {
        await f.animate([
          { transform: 'translate(0,0) scale(1,1)', boxShadow: '0 30px 60px rgba(0,0,0,.3)' },
          { transform: `translate(${dx}px,${dy - Math.min(36, to.height * 0.2)}px) scale(${sx * 1.06},${sy * 1.06})`, boxShadow: '0 22px 36px rgba(0,0,0,.3)', offset: 0.72 },
          { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, boxShadow: '0 4px 10px rgba(0,0,0,.25)' },
        ], { duration: 540, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).finished;
      } catch {}
      slot.classList.remove('is-gone');
      setFocus(slot);
      caption(id);
    }
    f.remove();
    ST.anim = false;
  }

  // ---------------------------------------------------------------- Émulateurs : les consoles en 3D
  async function loadImg(id) {
    S.platImg[id] = null;
    const f = await rr.platformImage(id).catch(() => null);
    if (!f) return;
    S.platImg[id] = f;
    const img = $(`[data-rc-con="${CSS.escape(id)}"] .rc-con-img`, panel);
    if (img) img.outerHTML = conImg(id);
  }
  const conImg = (id) => (S.platImg[id] ? `<img class="rc-con-img" src="${platUrl(S.platImg[id])}" alt="" draggable="false" />` : `<span class="rc-con-img rc-con-ph" style="--pc:${plat(id).color}">${esc(plat(id).short || plat(id).name)}</span>`);
  const emuOpt = (p) => { const opts = p.reco || []; const i = Math.min(ST.emuChoice[p.id] ?? 0, Math.max(0, opts.length - 1)); return { opt: opts[i], i }; };
  const optName = (r) => (window.emuOptLabel ? window.emuOptLabel(r) : r.name);
  function conStatus(p) {
    if (ST.emuBusy === p.id) return '<span class="rc-tag busy">Installation…</span>';
    if (p.conf) return `<span class="rc-tag ok">${ICO.ok}${esc(p.conf.name || 'Configuré')}</span>`;
    return '<span class="rc-tag">À installer</span>';
  }
  function emuHtml() {
    const d = ST.emu;
    const sel = d?.platforms.find((p) => p.id === ST.emuSel);
    return `
      <div class="rc-head"><h2 id="rcTitle">Émulateurs</h2>${tabsHtml()}</div>
      <p class="panel-lead">Choisis une console : le launcher installe l’émulateur conseillé dans <code>${esc(ltr(d?.root || ''))}</code> et le configure. Les BIOS ne sont jamais téléchargés.</p>
      <div class="rc-emu ${sel ? 'has-sel' : ''}">
        <div class="rc-cons" role="list">${(d?.platforms || []).map((p) => `
          <button class="rc-con ${p.conf ? 'is-set' : ''} ${ST.emuSel === p.id ? 'is-sel' : ''}" role="listitem" data-rc-con="${esc(p.id)}" data-nav style="--pc:${p.color}" aria-label="${esc(`${p.name}${p.conf ? ', émulateur installé' : ', émulateur à installer'}`)}">
            <span class="rc-con-stage"><span class="rc-con-3d">${conImg(p.id)}</span><span class="rc-con-floor"></span></span>
            <b>${esc(p.name)}</b>${conStatus(p)}
          </button>`).join('') || '<p class="dim">Chargement…</p>'}</div>
        ${sel ? conPanel(sel) : ''}
      </div>
      <div class="ew-foot"><button class="btn" data-rc-wizard data-nav>Vue en liste</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }
  function conPanel(p) {
    const { opt, i } = emuOpt(p);
    const busy = ST.emuBusy === p.id;
    const chips = (p.reco || []).length > 1 && !p.conf ? `<div class="ew-opts" role="radiogroup" aria-label="Émulateur pour ${esc(p.name)}">${p.reco.map((r, k) => `<button class="ew-opt" role="radio" aria-checked="${k === i}" data-rc-eopt="${p.id}:${k}" data-nav>${esc(optName(r))}${k === 0 ? ' <small>conseillé</small>' : ''}</button>`).join('')}</div>` : '';
    let act = '';
    if (busy) act = '<button class="btn danger" data-rc-ecancel data-nav>Annuler</button>';
    else if (p.conf && p.conf.installed) act = `<button class="btn" data-rc-einstall="${p.id}" data-update data-nav>Mettre à jour</button><button class="btn" data-rc-epick="${p.id}" data-nav>Choisir un autre exe…</button>`;
    else if (p.conf) act = `<button class="btn" data-rc-epick="${p.id}" data-nav>Changer d’exe…</button>`;
    else if (!opt) act = `<button class="btn primary" data-rc-epick="${p.id}" data-nav>Choisir l’exe…</button>`;
    else if (opt.auto) act = `<button class="btn primary" data-rc-einstall="${p.id}" data-nav data-default>Installer ${esc(optName(opt))}</button><button class="btn" data-rc-epick="${p.id}" data-nav>J’ai déjà l’exe…</button>`;
    else act = `<button class="btn primary" data-rc-url="${esc(opt.site)}" data-nav>Site de ${esc(opt.name)}</button><button class="btn" data-rc-epick="${p.id}" data-nav>Choisir l’exe…</button>`;
    const bios = (p.bios || []).map((b) => b.note ? `<div class="ew-bios note">${ICO.info}<span>${esc(b.label)}</span></div>`
      : b.ok ? `<div class="ew-bios ok">${ICO.ok}<span>BIOS présent : ${esc(String(b.found).split(/[\\/]/).pop())}</span></div>`
      : `<div class="ew-bios ${b.optional ? 'opt' : 'warn'}">${ICO.warn}<span><b>${b.optional ? 'BIOS conseillé' : 'BIOS manquant'} : ${esc(b.files?.slice(0, 3).join(' ou ') || b.label)}</b> — à placer dans <code>${esc(ltr(b.folder))}</code></span></div>`).join('');
    return `<div class="rc-conpanel" style="--pc:${p.color}">
      <div class="rc-conhero"><span class="rc-con-3d big">${conImg(p.id)}</span></div>
      <div class="rc-coninfo">
        <h3>${esc(p.name)}</h3>
        <p class="dim">${p.games ? `${p.games} jeu${p.games > 1 ? 'x' : ''} dans ta bibliothèque` : 'Aucun jeu dans ta bibliothèque pour l’instant'}</p>
        ${p.conf ? `<p><span class="ew-st ok"><i class="dot"></i>${esc(p.conf.name)}${p.conf.exists ? '' : ' — exécutable introuvable'}</span></p>` : opt ? `<p>Émulateur conseillé : <b>${esc(optName(opt))}</b>${opt.auto ? '' : ' <span class="dim">(pas d’archive officielle à adresse stable : télécharge-le sur son site, puis « Choisir l’exe… »)</span>'}</p>` : ''}
        ${chips}
        <div class="rc-row">${act}</div>
        <div class="ew-progwrap">${progHtml(ST.emuProg[p.id])}</div>
        ${bios}
      </div>
    </div>`;
  }
  // Inclinaison des consoles qui suit la souris
  ov.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.rc-con');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--tx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    c.style.setProperty('--ty', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  });
  ov.addEventListener('pointerout', (e) => { const c = e.target.closest?.('.rc-con'); if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--tx'); c.style.removeProperty('--ty'); } });
  rr.onX('x:emu:progress', (p) => {
    if (!p?.platform) return;
    ST.emuProg[p.platform] = { ...(ST.emuProg[p.platform] || {}), ...p, ...(p.phase !== 'download' && p.phase !== 'core' ? { got: 0, total: 0 } : {}) };
    const box = ST.tab === 'emu' && ST.emuSel === p.platform ? $('.rc-conpanel .ew-progwrap', panel) : null;
    if (box) box.innerHTML = progHtml(ST.emuProg[p.platform]);
  });
  async function emuInstall(pid, update) {
    const p = ST.emu?.platforms.find((x) => x.id === pid);
    if (!p) return;
    const opt = update ? (p.reco || []).find((r) => r.emu === p.conf?.installed) || emuOpt(p).opt : emuOpt(p).opt;
    if (!opt?.auto) return;
    ST.emuBusy = pid; ST.emuProg[pid] = { phase: 'resolve', label: 'Préparation…' };
    render();
    const r = await rr.x('x:emu:install', { platform: pid, emu: opt.emu, core: opt.core, update }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    ST.emuBusy = null;
    if (r.ok) { delete ST.emuProg[pid]; toast(`${optName(opt)} prêt pour ${p.name}`, 'success'); sfx('confirm'); }
    else if (!r.cancelled) toast(`${p.name} : ${r.error}`, true);
    await refresh();
  }
  async function selectConsole(id, btn) {
    if (ST.emuSel === id) return;
    const from = btn ? $('.rc-con-3d', btn).getBoundingClientRect() : null;
    ST.emuSel = id;
    sfx('confirm');
    render();
    const hero = $('.rc-conhero .rc-con-3d', panel);
    if (from && hero && !reduced()) {
      // la console quitte son socle et vient se poser en grand dans le panneau
      const to = hero.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const s = from.width / to.width;
      hero.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotateY(-24deg)` },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 30}px) scale(${(1 + s) / 2}) rotateY(200deg)`, offset: 0.6 },
        { transform: 'translate(0,0) scale(1) rotateY(360deg)' },
      ], { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' });
    }
    const f = $('.rc-conpanel [data-default], .rc-conpanel .btn', panel);
    if (f) setFocus(f);
  }

  // ---------------------------------------------------------------- Évènements
  rr.onX('x:recomp:progress', (p) => {
    if (!p?.id) return;
    ST.prog[p.id] = { ...(ST.prog[p.id] || {}), ...p, ...(p.phase !== 'download' ? { got: 0, total: 0 } : {}) };
    const box = ST.tab === 'recomp' && ST.view === 'detail' && ST.cur === p.id ? $('.ew-progwrap', panel) : null;
    if (box) box.innerHTML = progHtml(ST.prog[p.id]);
  });
  rr.onX('x:recomp:cover', (c) => {
    const x = c && item(c.id);
    if (!x || !c.url) return;
    x.cover = c.url;
    for (const front of $$(`[data-rc-open="${CSS.escape(c.id)}"] .rc-front`, panel)) front.innerHTML = `<img src="${esc(c.url)}" alt="" draggable="false" />`;
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
    if ((b = t('[data-rc-tab]'))) { if (ST.tab !== b.dataset.rcTab) { ST.tab = b.dataset.rcTab; ST.view = 'shelves'; ST.scroll = 0; sfx('toggle'); panel.innerHTML = '<p class="panel-lead"><span class="spinner tiny"></span> Chargement…</p>'; await refresh(); } return; }
    if (t('[data-rc-wizard]')) { closeOverlay(true); return RR.actions.emuWizardAll?.(); }
    if (t('[data-rc-refresh]')) { toast('Actualisation du catalogue…'); return refresh(true); }
    if ((b = t('[data-rc-filter]'))) { ST.filter = b.dataset.rcFilter; ST.scroll = 0; sfx('toggle'); return render(); }
    if ((b = t('[data-rc-jump]'))) {
      const s = $(`#${CSS.escape(b.dataset.rcJump)}`, panel);
      if (s) { s.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); const f = $('[data-rc-open]', s); if (f) setTimeout(() => setFocus(f), reduced() ? 0 : 350); }
      return;
    }
    if ((b = t('[data-rc-open]'))) return takeFromShelf(b.dataset.rcOpen, b);
    if (t('[data-rc-back]')) return putBack();
    if ((b = t('[data-rc-con]'))) return selectConsole(b.dataset.rcCon, b);
    if ((b = t('[data-rc-eopt]'))) { const [pid, k] = b.dataset.rcEopt.split(':'); ST.emuChoice[pid] = +k; sfx('toggle'); return render(); }
    if ((b = t('[data-rc-einstall]'))) return emuInstall(b.dataset.rcEinstall, 'update' in b.dataset);
    if (t('[data-rc-ecancel]')) return rr.x('x:emu:cancel');
    if ((b = t('[data-rc-epick]'))) { const c = await rr.pickEmulator(b.dataset.rcEpick); if (c) { toast(`${c.name} configuré`, 'success'); refresh(); } return; }
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
  // Pendant l'ouverture : A / Entrée saute à la fiche, B / Échap annule
  document.addEventListener('keydown', (e) => {
    if (!opening) return;
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); opening.cancel(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); opening.skip(); }
  }, true);
  // B / Échap : la fiche repose la jaquette sur le rayon ; la console choisie se referme (appelé par overlayBack)
  window.recompBack = () => {
    if (S.mode !== 'recomp') return false;
    if (opening) { opening.cancel(); return true; }
    if (ST.tab === 'emu' && ST.emuSel) { ST.emuSel = null; sfx('back'); render(); return true; }
    if (ST.tab === 'recomp' && ST.view === 'detail') { putBack(); return true; }
    return false;
  };
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.mode === 'recomp' && ST.tab === 'recomp' && ST.view === 'shelves' && !ST.anim) render(); }, 150); });

  RR.actions.recompStore = () => { closeAll(); open(); };
  RR.actions.recompEmu = () => { closeAll(); open('emu'); };
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

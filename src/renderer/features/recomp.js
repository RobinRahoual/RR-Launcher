// Module RECOMP — « Recomps » : catalogue de recomp et portages PC (façon RecompLauncher) présenté comme une
// ludothèque : une étagère par console, les boîtes de face sur les rayons. Choisir un jeu le sort du rayon
// (la boîte glisse jusqu'à la fiche) ; revenir l'y repose. La copie du jeu du joueur est vérifiée puis placée
// au bon endroit. Onglet « Émulateurs » → assistant EMU.
// Côté main : src/features/recomp.js (x:recomp:*). Accroches : OVERLAYS.recomp, overlayBack (window.recompBack),
// entrée du menu, carte du hub d'ajout.
(() => {
  const ICO = {
    shelf: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M3 12h18M4 4v16M20 4v16"/><path d="M7 12V6h3v6M12 12V7l3-.5L16 12M7 20v-5h3v5M13 20v-6h3v6"/></svg>',
    ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    back: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    up: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  };
  const mo = (b) => (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const PLACE = {
    copy: 'Le launcher copie ta ROM dans le dossier de la recomp : rien à faire au lancement.',
    select: 'Au premier lancement, la recomp te demande ta ROM (« Select ROM ») : choisis le fichier indiqué plus haut, son chemin est copié pour toi.',
    installer: 'Au premier lancement, l’assistant de la recomp te demande les fichiers de ton jeu : indique le dossier choisi plus haut.',
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ST = { items: [], root: '', view: 'shelves', cur: null, prog: {}, busy: null, filter: 'all', anim: false };

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
    panel.innerHTML = '<h2 id="rcTitle">Recomps</h2><p class="panel-lead"><span class="spinner tiny"></span> Chargement du catalogue…</p>';
    openOverlay('recomp');
    await refresh();
  }
  async function refresh(force = false) {
    const r = await rr.x('x:recomp:list', { refresh: force }).catch(() => null);
    if (r) { ST.items = r.items; ST.root = r.root; }
    render();
  }
  const item = (id) => ST.items.find((x) => x.id === id);

  function keepFocus(fn) {
    const a = document.activeElement;
    const key = a && ov.contains(a) ? [...a.attributes].find((x) => x.name.startsWith('data-rc'))?.name : null;
    const val = key ? a.getAttribute(key) : null;
    fn();
    const f = key ? $(`[${key}="${CSS.escape(val)}"]`, panel) : null;
    if (f) setFocus(f); else if (S.mode === 'recomp' && !ov.contains(document.activeElement)) focusFirst();
  }
  function render() {
    keepFocus(() => {
      const x = ST.view === 'detail' && item(ST.cur);
      panel.classList.toggle('is-detail', !!x);
      panel.innerHTML = x ? detailHtml(x) : shelvesHtml();
    });
  }

  // ---------------------------------------------------------------- Boîtes
  const SHELF_H = 176, GAP = 18; // = --shelf-h et gap de .rc-boxes (recomp.css)
  const ratio = (x) => Math.max(0.6, Math.min(1.45, plat(x.platform).case?.ratio || 0.7));
  function boxFace(x, big = false) {
    const p = plat(x.platform);
    return x.cover
      ? `<img src="${esc(x.cover)}" alt="" draggable="false" />`
      : `<span class="rc-blank" style="--pc:${p.color}"><small>${esc(p.short || p.name)}</small><b>${esc(big ? x.name : x.game)}</b></span>`;
  }
  function badge(x) {
    if (ST.busy === x.id) return '<span class="rc-tag busy">Installation…</span>';
    if (x.update) return `<span class="rc-tag up">${ICO.up}Mise à jour</span>`;
    if (x.installed) return `<span class="rc-tag ok">${ICO.ok}Installé</span>`;
    return '';
  }
  function boxHtml(x) {
    return `<button class="rc-box" data-rc-open="${esc(x.id)}" data-nav style="--r:${ratio(x)};--pc:${plat(x.platform).color}" aria-label="${esc(`${x.name} — ${x.game}${x.installed ? ', installé' : ''}`)}">
      <span class="rc-front">${boxFace(x)}</span><span class="rc-side"></span>${badge(x)}
    </button>`;
  }

  // ---------------------------------------------------------------- Ludothèque : une étagère par console
  function shelvesHtml() {
    const list = ST.items.filter((x) => ST.filter === 'all' || x.installed);
    const order = Object.keys(S.P || {});
    const plats = [...new Set(list.map((x) => x.platform))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    // Largeur utile d'un rayon (panneau - marges de la pièce) → nombre de boîtes par planche, une planche de plus si besoin
    const roomW = Math.max(480, (panel.clientWidth || 1100) - 2 * 32 - 2 * 26 + 16 - 2 * 18);
    const shelves = plats.map((pid) => {
      const p = plat(pid);
      const xs = list.filter((x) => x.platform === pid);
      const r = ratio(xs[0]);
      const boxW = SHELF_H * (r >= 1 ? 0.72 : 1) * r + 7; // + tranche
      const per = Math.max(1, Math.floor((roomW + GAP) / (boxW + GAP)));
      const rows = [];
      for (let i = 0; i < xs.length; i += per) rows.push(xs.slice(i, i + per));
      return rows.map((row, i) => `<section class="rc-shelf" style="--pc:${p.color}" aria-label="${esc(p.name)}${rows.length > 1 ? ` (${i + 1}/${rows.length})` : ''}">
        <div class="rc-boxes">${row.map(boxHtml).join('')}</div>
        <div class="rc-plank">${i === 0 ? `<span class="rc-plaque">${esc(p.name)}<i>${xs.length}</i></span>` : ''}</div>
      </section>`).join('');
    }).join('');
    return `
      <div class="rc-head">
        <h2 id="rcTitle">Recomps</h2>
        <div class="rc-tabs" role="tablist">
          <button class="rc-tab" role="tab" aria-selected="true" data-nav>Recomps &amp; portages</button>
          <button class="rc-tab" role="tab" aria-selected="false" data-rc-emu data-nav>Émulateurs</button>
        </div>
      </div>
      <div class="rc-sub">
        <p class="panel-lead">Des jeux console recompilés pour tourner nativement sur PC. Prends un jeu sur le rayon : tu fournis ta copie, le launcher la vérifie et installe la recomp depuis le GitHub de ses auteurs.</p>
        <div class="rc-filters" role="radiogroup" aria-label="Afficher">
          ${[['all', 'Tout le catalogue'], ['mine', 'Installés']].map(([v, l]) => `<button class="ew-opt" role="radio" aria-checked="${ST.filter === v}" data-rc-filter="${v}" data-nav>${l}</button>`).join('')}
        </div>
      </div>
      <div class="rc-room">${shelves || '<p class="dim rc-empty">Aucune recomp installée pour l’instant.</p>'}</div>
      <div class="rc-caption" aria-live="polite"><span id="rcCap">Choisis un jeu sur les rayons.</span></div>
      <div class="ew-foot"><button class="btn" data-rc-refresh data-nav>Actualiser le catalogue</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }
  function caption(id) {
    const x = item(id), c = $('#rcCap', panel);
    if (!c || !x) return;
    c.innerHTML = `<b>${esc(x.name)}</b> · ${esc(x.game)} <span class="dim">· ${esc(x.kind || 'Recomp')}${x.installed ? ` · installé (${esc(x.installed.version || '?')})` : ''}</span>`;
  }
  ov.addEventListener('focusin', (e) => { const b = e.target.closest?.('[data-rc-open]'); if (b) caption(b.dataset.rcOpen); });
  ov.addEventListener('mouseover', (e) => { const b = e.target.closest?.('[data-rc-open]'); if (b) caption(b.dataset.rcOpen); });

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
    const p = plat(x.platform);
    const needRom = x.rom.system !== 'folder';
    const r = x.mine; // copie choisie par le joueur
    const busy = ST.busy === x.id;
    const canInstall = !busy && !ST.busy && (x.rom.place !== 'copy' || r);
    const step = (n, done, title, body) => `<li class="rc-step ${done ? 'done' : ''}"><span class="rc-n">${done ? ICO.ok : n}</span><div><b>${title}</b>${body}</div></li>`;
    const romBody = `
      <p class="dim">${esc(x.rom.label)}</p>
      ${r ? `<div class="ew-bios ${r.warn ? 'warn' : 'ok'}">${r.warn ? ICO.warn : ICO.ok}<span><b>${esc(r.info || '')}</b><br/><code>${esc(ltr(r.path))}</code>${r.warn ? `<br/>${esc(r.warn)}` : ''}</span></div>` : ''}
      <div class="rc-row"><button class="btn small ${r ? '' : 'primary'}" data-rc-rom="${esc(x.id)}" data-nav>${r ? 'Changer de fichier' : needRom ? 'Choisir ma ROM…' : 'Choisir le dossier du jeu…'}</button>
      ${x.rom.place === 'copy' ? '' : '<span class="dim">Facultatif : sert à vérifier ta copie et à copier son chemin.</span>'}</div>
      <p class="dim rc-legal">Le launcher ne télécharge jamais de jeu : utilise le dump de ta propre cartouche ou de ton propre disque.</p>`;
    const insBody = x.installed
      ? `<p class="dim">Version ${esc(x.installed.version || '?')} dans <code>${esc(ltr(x.installed.dir))}</code>${x.latest ? ` · dernière : ${esc(x.latest)}` : ''}</p>
         <div class="rc-row">${x.update ? `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-update data-nav ${canInstall ? '' : 'disabled'}>Mettre à jour (${esc(x.latest)})</button>` : `<button class="btn small" data-rc-check="${esc(x.id)}" data-nav>Rechercher une mise à jour</button>`}
         <button class="btn small" data-rc-folder="${esc(x.id)}" data-nav>Ouvrir le dossier</button>
         <button class="btn small danger" data-rc-uninstall="${esc(x.id)}" data-nav>Désinstaller</button></div>`
      : `<p class="dim">Dernière release de <code>${esc(x.repo)}</code>, installée dans <code>${esc(ltr(ST.root))}</code>.</p>
         <div class="rc-row">${busy ? '<button class="btn small danger" data-rc-cancel data-nav>Annuler</button>' : `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-nav ${canInstall ? '' : 'disabled'}>Installer</button>`}
         ${!canInstall && !busy && x.rom.place === 'copy' ? '<span class="dim">Choisis d’abord ta ROM (étape 1).</span>' : ''}</div>`;
    const playBody = `<p class="dim">${esc(PLACE[x.rom.place] || '')}</p>
      ${x.installed ? `<div class="rc-row"><button class="btn small primary" data-rc-play="${esc(x.id)}" data-nav>Jouer</button>${x.rom.place !== 'copy' && r ? `<button class="btn small" data-rc-copy="${esc(r.path)}" data-nav>Copier le chemin de ma copie</button>` : ''}</div>` : ''}`;
    return `
      <div class="rc-detail">
        <div class="rc-held">
          <button class="btn small rc-back" data-rc-back data-nav>${ICO.back}Remettre sur le rayon</button>
          <div class="rc-box is-held" data-rc-held style="--r:${ratio(x)};--pc:${p.color}"><span class="rc-front">${boxFace(x, true)}</span><span class="rc-side"></span></div>
          <div class="rc-held-meta"><span class="rc-plat" style="--pc:${p.color}">${esc(p.short || p.name)}</span><span class="dim">${esc(x.kind || 'Recomp')} · ${esc(x.repo)}</span></div>
        </div>
        <div class="rc-info">
          <h2 id="rcTitle">${esc(x.name)}</h2>
          <p class="rc-orig">${esc(x.game)}</p>
          <p class="dim rc-about">${esc(x.desc || '')}</p>
          <ol class="rc-steps">
            ${step(1, !!r || (!needRom && x.installed), 'Ta copie du jeu', romBody)}
            ${step(2, !!x.installed && !x.update, x.installed ? 'Installée' : 'Installer la recomp', insBody + `<div class="ew-progwrap">${progHtml(x.id)}</div>`)}
            ${step(3, false, 'Jouer', playBody)}
          </ol>
        </div>
      </div>
      <div class="ew-foot"><button class="btn" data-rc-repo="${esc(x.repo)}" data-nav>Page GitHub</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }

  // ---------------------------------------------------------------- Prendre / reposer une boîte (FLIP)
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
  function fly(f, from, to, dir) {
    const dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = to.height / from.height;
    const kf = dir === 'out'
      ? [ // sortie du rayon : la boîte avance vers soi, puis glisse jusqu'à la fiche
        { transform: 'translate(0,0) scale(1,1)', boxShadow: '0 4px 10px rgba(0,0,0,.25)' },
        { transform: `translate(0,-${Math.min(36, from.height * 0.2)}px) scale(1.08,1.08)`, boxShadow: '0 22px 36px rgba(0,0,0,.35)', offset: 0.3 },
        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, boxShadow: '0 30px 60px rgba(0,0,0,.3)' },
      ]
      : [ // retour : la boîte revient au-dessus de sa place puis redescend sur la planche
        { transform: 'translate(0,0) scale(1,1)', boxShadow: '0 30px 60px rgba(0,0,0,.3)' },
        { transform: `translate(${dx}px,${dy - Math.min(36, to.height * 0.2)}px) scale(${sx * 1.06},${sy * 1.06})`, boxShadow: '0 22px 36px rgba(0,0,0,.3)', offset: 0.72 },
        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, boxShadow: '0 4px 10px rgba(0,0,0,.25)' },
      ];
    return f.animate(kf, { duration: dir === 'out' ? 640 : 540, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).finished;
  }
  async function takeFromShelf(id, src) {
    if (ST.anim) return;
    ST.view = 'detail'; ST.cur = id;
    sfx('confirm');
    if (reduced() || !src) { render(); setTimeout(focusFirst, 30); return; }
    ST.anim = true;
    const { f, r } = flyer(src);
    render();
    const held = $('[data-rc-held]', panel);
    held.classList.add('is-hidden');
    panel.classList.add('is-arriving');
    try { await fly(f, r, $('.rc-front', held).getBoundingClientRect(), 'out'); } catch {}
    held.classList.remove('is-hidden');
    panel.classList.remove('is-arriving');
    f.remove();
    ST.anim = false;
    focusFirst();
  }
  async function putBack() {
    if (ST.anim) return;
    const id = ST.cur;
    const held = $('[data-rc-held]', panel);
    ST.view = 'shelves';
    sfx('back');
    if (reduced() || !held) { render(); const c = $(`[data-rc-open="${CSS.escape(id)}"]`, panel); if (c) setFocus(c); return; }
    ST.anim = true;
    const { f, r } = flyer(held);
    render();
    const slot = $(`[data-rc-open="${CSS.escape(id)}"]`, panel);
    if (slot) {
      slot.scrollIntoView({ block: 'nearest' });
      slot.classList.add('is-gone');
      try { await fly(f, r, $('.rc-front', slot).getBoundingClientRect(), 'in'); } catch {}
      slot.classList.remove('is-gone');
      setFocus(slot);
      caption(id);
    }
    f.remove();
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
    const sel = `[data-rc-open="${CSS.escape(c.id)}"] .rc-front` + (ST.view === 'detail' && ST.cur === c.id ? ', [data-rc-held] .rc-front' : '');
    for (const front of $$(sel, panel)) front.innerHTML = `<img src="${esc(c.url)}" alt="" draggable="false" />`;
  });

  async function install(id, update = false) {
    const x = item(id);
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
      body: `<p class="dim">Le dossier <code>${esc(ltr(x.installed.dir))}</code> est supprimé, avec la copie de ta ROM qu’il contient et les réglages de la recomp. Les sauvegardes rangées ailleurs (AppData) sont conservées. Ta ROM d’origine n’est pas touchée.</p>`,
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
    if (t('[data-rc-refresh]')) { toast('Catalogue actualisé'); return refresh(true); }
    if ((b = t('[data-rc-filter]'))) { ST.filter = b.dataset.rcFilter; sfx('toggle'); return render(); }
    if ((b = t('[data-rc-open]'))) return takeFromShelf(b.dataset.rcOpen, b);
    if (t('[data-rc-back]')) return putBack();
    if ((b = t('[data-rc-rom]'))) {
      const r = await rr.x('x:recomp:pickRom', b.dataset.rcRom);
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
    if ((b = t('[data-rc-uninstall]'))) { const x = item(b.dataset.rcUninstall); if (x?.installed) confirmUninstall(x); return; }
    if ((b = t('[data-rc-repo]'))) { rr.openExternal(`https://github.com/${b.dataset.rcRepo}`); return; }
    if ((b = t('[data-rc-copy]'))) { try { await navigator.clipboard.writeText(b.dataset.rcCopy); toast('Chemin copié : colle-le dans la fenêtre « Select ROM »', 'success'); } catch { toast('Copie impossible', true); } return; }
    if ((b = t('[data-rc-play]'))) {
      const x = item(b.dataset.rcPlay);
      if (!x?.installed?.gameId) return;
      if (x.rom.place !== 'copy' && x.mine?.path) { try { await navigator.clipboard.writeText(x.mine.path); } catch {} toast('Chemin de ta copie copié : colle-le quand la recomp le demande'); }
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
      <strong>Recomps</strong><span class="dim">Zelda, Mario Kart 64, Star Fox, Sonic Unleashed… recompilés pour PC, avec ta propre copie du jeu</span>
      <span class="hub-meta">Installation et mises à jour automatiques</span>
    </button>`);
  // Raccourci clavier R dans l'interface principale (hors saisie)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if (e.ctrlKey || e.altKey || e.metaKey || S.mode !== 'main' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    e.preventDefault();
    open();
  });
})();

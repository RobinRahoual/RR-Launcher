// Module RECOMP — boutique : recomp et portages PC à installer en un clic (catalogue façon RecompLauncher),
// avec la copie du jeu du joueur vérifiée puis placée au bon endroit. Onglet « Émulateurs » → assistant EMU.
// Côté main : src/features/recomp.js (x:recomp:*). Accroches : OVERLAYS.recomp, entrée du menu, carte du hub d'ajout.
(() => {
  const ICO = {
    shop: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1 11H5z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>',
    ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    back: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const mo = (b) => (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const PLACE = {
    copy: 'Le launcher copie ta ROM dans le dossier de la recomp : rien à faire au lancement.',
    select: 'Au premier lancement, la recomp te demande ta ROM (« Select ROM ») : choisis le fichier indiqué ci-dessous, son chemin est copié pour toi.',
    installer: 'Au premier lancement, l’assistant de la recomp te demande les fichiers de ton jeu : indique le dossier ci-dessous.',
  };
  const ST = { items: [], root: '', view: 'grid', cur: null, prog: {}, busy: null, filter: 'all' };

  const ov = document.createElement('div');
  ov.className = 'overlay center'; ov.id = 'recompStore'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'rcTitle');
  ov.innerHTML = '<div class="panel wide rc-panel"></div>';
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });
  OVERLAYS.recomp = '#recompStore';
  const panel = $('.panel', ov);

  async function open(id = null) {
    ST.view = id ? 'detail' : 'grid'; ST.cur = id;
    panel.innerHTML = '<h2 id="rcTitle">Boutique</h2><p class="panel-lead"><span class="spinner tiny"></span> Chargement du catalogue…</p>';
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
  function render() { keepFocus(() => { panel.innerHTML = ST.view === 'detail' && item(ST.cur) ? detailHtml(item(ST.cur)) : gridHtml(); }); }

  function badge(x) {
    if (ST.busy === x.id) return '<span class="rc-badge busy">Installation…</span>';
    if (x.update) return '<span class="rc-badge up">Mise à jour</span>';
    if (x.installed) return `<span class="rc-badge ok">${ICO.ok}Installé</span>`;
    return '';
  }
  function gridHtml() {
    const plats = [...new Set(ST.items.map((x) => x.platform))];
    const list = ST.items.filter((x) => ST.filter === 'all' || (ST.filter === 'mine' ? x.installed : x.platform === ST.filter));
    return `
      <div class="rc-head">
        <h2 id="rcTitle">Boutique</h2>
        <div class="rc-tabs" role="tablist">
          <button class="rc-tab" role="tab" aria-selected="true" data-nav>Recomp &amp; portages</button>
          <button class="rc-tab" role="tab" aria-selected="false" data-rc-emu data-nav>Émulateurs</button>
        </div>
      </div>
      <p class="panel-lead">Des jeux console recompilés pour tourner nativement sur PC. Tu fournis ta propre copie du jeu : le launcher la vérifie, télécharge la recomp depuis le GitHub de ses auteurs et range le jeu sous sa console.</p>
      <div class="rc-filters" role="radiogroup" aria-label="Filtrer">
        ${[['all', 'Tout'], ['mine', 'Installés'], ...plats.map((p) => [p, plat(p).short || plat(p).name])].map(([v, l]) => `<button class="ew-opt" role="radio" aria-checked="${ST.filter === v}" data-rc-filter="${esc(v)}" data-nav>${esc(l)}</button>`).join('')}
      </div>
      <div class="rc-grid">${list.map((x) => `
        <button class="rc-card" data-rc-open="${esc(x.id)}" data-nav style="--pc:${plat(x.platform).color}">
          <span class="rc-plat">${esc(plat(x.platform).short || x.platform)}</span>${badge(x)}
          <strong>${esc(x.name)}</strong>
          <span class="rc-game">${esc(x.game)}</span>
          <span class="dim rc-desc">${esc(x.desc || '')}</span>
          <span class="rc-kind">${esc(x.kind || 'Recomp')} · ${esc(x.repo)}</span>
        </button>`).join('') || '<p class="dim">Rien ici pour l’instant.</p>'}
      </div>
      <div class="ew-foot"><button class="btn" data-rc-refresh data-nav>Actualiser le catalogue</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }

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
    const needRom = x.rom.system !== 'folder';
    const r = x.mine; // copie choisie par le joueur
    const busy = ST.busy === x.id;
    const canInstall = !busy && !ST.busy && (x.rom.place !== 'copy' || r);
    const step = (n, done, title, body) => `<li class="rc-step ${done ? 'done' : ''}"><span class="rc-n">${done ? ICO.ok : n}</span><div><b>${title}</b>${body}</div></li>`;
    const romBody = `
      <p class="dim">${esc(x.rom.label)}</p>
      ${r ? `<div class="ew-bios ${r.warn ? 'warn' : 'ok'}">${r.warn ? ICO.warn : ICO.ok}<span><b>${esc(r.info || '')}</b><br/><code>${esc(ltr(r.path))}</code>${r.warn ? `<br/>${esc(r.warn)}` : ''}</span></div>` : ''}
      <div class="rc-row"><button class="btn small ${r ? '' : 'primary'}" data-rc-rom="${esc(x.id)}" data-nav>${r ? 'Changer de fichier' : needRom ? 'Choisir ma ROM…' : 'Choisir le dossier du jeu…'}</button>
      ${x.rom.place === 'copy' ? '' : `<span class="dim">Facultatif ici : sert à vérifier ta copie et à copier son chemin.</span>`}</div>
      <p class="dim rc-legal">Le launcher ne télécharge jamais de jeu : utilise le dump de ta propre cartouche ou de ton propre disque.</p>`;
    const insBody = x.installed
      ? `<p class="dim">Version ${esc(x.installed.version || '?')} dans <code>${esc(ltr(x.installed.dir))}</code>${x.latest ? ` · dernière : ${esc(x.latest)}` : ''}</p>
         <div class="rc-row">${x.update ? `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-update data-nav ${canInstall ? '' : 'disabled'}>Mettre à jour (${esc(x.latest)})</button>` : `<button class="btn small" data-rc-check="${esc(x.id)}" data-nav>Rechercher une mise à jour</button>`}
         <button class="btn small" data-rc-folder="${esc(x.id)}" data-nav>Ouvrir le dossier</button>
         <button class="btn small danger" data-rc-uninstall="${esc(x.id)}" data-nav>Désinstaller</button></div>`
      : `<p class="dim">Dernière release de <code>${esc(x.repo)}</code>, installée dans <code>${esc(ltr(ST.root))}</code>.</p>
         <div class="rc-row">${busy ? `<button class="btn small danger" data-rc-cancel data-nav>Annuler</button>` : `<button class="btn small primary" data-rc-install="${esc(x.id)}" data-nav ${canInstall ? '' : 'disabled'}>Installer</button>`}
         ${!canInstall && !busy && x.rom.place === 'copy' ? '<span class="dim">Choisis d’abord ta ROM (étape 1).</span>' : ''}</div>`;
    const playBody = `<p class="dim">${esc(PLACE[x.rom.place] || '')}</p>
      ${x.installed ? `<div class="rc-row"><button class="btn small primary" data-rc-play="${esc(x.id)}" data-nav>Jouer</button>${x.rom.place !== 'copy' && r ? `<button class="btn small" data-rc-copy="${esc(r.path)}" data-nav>Copier le chemin de ma copie</button>` : ''}</div>` : ''}`;
    return `
      <div class="rc-head"><button class="btn small rc-back" data-rc-back data-nav>${ICO.back}Boutique</button><h2 id="rcTitle">${esc(x.name)}</h2></div>
      <p class="panel-lead"><span class="rc-plat inline" style="--pc:${plat(x.platform).color}">${esc(plat(x.platform).short || x.platform)}</span> ${esc(x.game)} · ${esc(x.kind || 'Recomp')} — ${esc(x.desc || '')}</p>
      <ol class="rc-steps">
        ${step(1, !!r || (!needRom && x.installed), 'Ta copie du jeu', romBody)}
        ${step(2, !!x.installed && !x.update, x.installed ? 'Installée' : 'Installer la recomp', insBody + `<div class="ew-progwrap">${progHtml(x.id)}</div>`)}
        ${step(3, false, 'Jouer', playBody)}
      </ol>
      <div class="ew-foot"><button class="btn" data-rc-repo="${esc(x.repo)}" data-nav>Page GitHub</button><button class="btn" data-rc-close data-nav>Fermer</button></div>`;
  }

  rr.onX('x:recomp:progress', (p) => {
    if (!p?.id) return;
    ST.prog[p.id] = { ...(ST.prog[p.id] || {}), ...p, ...(p.phase !== 'download' ? { got: 0, total: 0 } : {}) };
    const box = ST.view === 'detail' && ST.cur === p.id ? $('.ew-progwrap', panel) : null;
    if (box) box.innerHTML = progHtml(p.id);
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
    if (t('[data-rc-close]')) return closeOverlay();
    if (t('[data-rc-emu]')) { closeOverlay(true); return RR.actions.emuWizardAll?.(); }
    if (t('[data-rc-refresh]')) { toast('Catalogue actualisé'); return refresh(true); }
    if ((b = t('[data-rc-filter]'))) { ST.filter = b.dataset.rcFilter; sfx('toggle'); return render(); }
    if ((b = t('[data-rc-open]'))) { ST.view = 'detail'; ST.cur = b.dataset.rcOpen; sfx('confirm'); render(); setTimeout(focusFirst, 30); return; }
    if (t('[data-rc-back]')) { const id = ST.cur; ST.view = 'grid'; render(); const c = $(`[data-rc-open="${CSS.escape(id)}"]`, panel); if (c) setFocus(c); sfx('back'); return; }
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

  RR.actions.recompStore = () => { closeAll(); open(); };
  window.openRecompStore = open;

  // Menu : « Boutique » sous « Ajouter des jeux » ; hub d'ajout : carte « Boutique de recomp »
  const add = $('#menu [data-action="addHub"]');
  add?.insertAdjacentHTML('afterend', `<button class="menu-item" data-action="recompStore" data-nav>${ICO.shop}<span class="mi-label">Boutique</span><kbd class="mi-key">B</kbd></button>`);
  $('#addHub .hub-grid')?.insertAdjacentHTML('beforeend', `
    <button class="hub-card" data-action="recompStore" data-nav>
      <span class="hub-ico"><svg viewBox="0 0 24 24"><path d="M4 9h16l-1 11H5z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg></span>
      <strong>Boutique de recomp</strong><span class="dim">Zelda, Mario Kart 64, Star Fox, Sonic Unleashed… avec ta propre copie du jeu</span>
      <span class="hub-meta">Installation et mises à jour automatiques</span>
    </button>`);
  // Raccourci clavier B dans l'interface principale (hors saisie)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.ctrlKey || e.altKey || e.metaKey || S.mode !== 'main' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    e.preventDefault();
    open();
  });
})();

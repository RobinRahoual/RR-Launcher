// Module EMU — émulateurs : assistant d'installation (RetroArch + cœurs, émulateurs dédiés) et BIOS,
// sauvegardes d'état dans le menu en jeu, options de lancement par jeu. Côté main : src/features/emu.js (x:emu:*).
// Accroches : OVERLAYS.emuwiz / .emulaunch / .emukeys, wrap(askEmulator | renderDetails | renderCapActions | igQuit),
// entrées #igMain, bloc #set-emu, bouton dans l'onglet « Consoles & émulateurs ».
(() => {
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const ICO = {
    wand: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3l1 1"/><path d="m13 8 3 3"/></svg>',
    save: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
    load: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    slot: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>',
    opts: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    info: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg>',
  };
  const mo = (b) => (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const CORE_LABEL = { mesen: 'Mesen', snes9x: 'Snes9x', gambatte: 'Gambatte', mgba: 'mGBA', mupen64plus_next: 'Mupen64Plus-Next', genesis_plus_gx: 'Genesis Plus GX', swanstation: 'SwanStation', flycast: 'Flycast' };
  const optLabel = (r) => r.name + (r.core ? ` (${CORE_LABEL[r.core] || r.core})` : '');
  const mkOverlay = (id, cls, labelId) => {
    const ov = document.createElement('div');
    ov.className = 'overlay center';
    ov.id = id; ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', labelId);
    ov.innerHTML = `<div class="panel ${cls}"></div>`;
    ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov)); // la confirmation passe au-dessus
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });
    return ov;
  };

  // ================================================================ A. Assistant « Configurer les émulateurs »
  const EW = { data: null, choice: {}, prog: {}, busy: new Set(), focusPlat: null, all: false };
  const wiz = mkOverlay('emuWiz', 'wide emu-wiz', 'ewTitle');
  OVERLAYS.emuwiz = '#emuWiz';

  async function openWizard(focusPlat = null, { all = null } = {}) {
    EW.focusPlat = focusPlat;
    // Bibliothèque sans ROM (ou ouverture depuis la boutique) : toutes les consoles d'emblée
    EW.all = all ?? (EW.all || !S.lib?.games?.some((g) => g.kind === 'rom'));
    if (S.mode !== 'emuwiz') { $('.panel', wiz).innerHTML = '<h2 id="ewTitle">Configurer les émulateurs</h2><p class="panel-lead"><span class="spinner tiny"></span> Analyse de ta bibliothèque…</p>'; openOverlay('emuwiz'); await new Promise((r) => setTimeout(r, 45)); } // après le focusFirst d'openOverlay
    await refresh();
  }
  async function refresh() {
    EW.data = await rr.x('x:emu:overview', { all: EW.all }).catch(() => null);
    renderWizard();
  }
  function rowState(p) {
    const opts = p.reco || [];
    const i = Math.min(EW.choice[p.id] ?? 0, Math.max(0, opts.length - 1));
    return { opt: opts[i], i };
  }
  function biosHtml(p) {
    return (p.bios || []).map((b) => {
      if (b.note) return `<div class="ew-bios note">${ICO.info}<span>${esc(b.label)}</span></div>`;
      if (b.ok && b.verified === false) return `<div class="ew-bios warn">${ICO.warn}<span><b>BIOS présent mais non conforme : ${esc(b.found.split(/[\\/]/).pop())}</b><br/>${esc(b.warn || '')}</span></div>`;
      if (b.ok) return `<div class="ew-bios ok">${ICO.ok}<span>BIOS présent : ${esc(b.found.split(/[\\/]/).pop())}${b.verified ? ' <span class="dim">· empreinte vérifiée ✓</span>' : ''}</span></div>`;
      const what = b.files?.length ? b.files.slice(0, 3).join(' ou ') : b.label;
      return `<div class="ew-bios ${b.optional ? 'opt' : 'warn'}">${ICO.warn}<span><b>${b.optional ? 'BIOS conseillé' : 'BIOS manquant'} : ${esc(what)}</b> — à placer dans <code>${esc(ltr(b.folder))}</code>${b.warn ? `<br/>${esc(b.warn)}` : ''}<br/><span class="dim">${esc(b.label)}. Le launcher ne télécharge jamais de BIOS : utilise le dump de ta propre console.</span></span><button class="btn small" data-ew-folder="${esc(b.folder)}" data-nav>Ouvrir le dossier</button></div>`;
    }).join('');
  }
  function progHtml(pid) {
    const p = EW.prog[pid];
    if (!p) return '';
    const pct = p.total ? Math.min(100, Math.round((p.got / p.total) * 100)) : null;
    const size = p.got ? (p.total ? `${mo(p.got)} / ${mo(p.total)} Mo` : `${mo(p.got)} Mo`) : '';
    const err = p.phase === 'error' || p.phase === 'cancelled';
    return `<div class="ew-prog ${err ? 'is-err' : ''} ${pct == null && !err && p.phase !== 'done' ? 'is-indet' : ''}" role="progressbar" aria-label="${esc(p.label || '')}" ${pct != null ? `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"` : ''}>
      <div class="ew-bar"><i style="transform:scaleX(${p.phase === 'done' ? 1 : (pct ?? 0) / 100})"></i></div>
      <div class="ew-pl"><span>${esc(p.label || '')}</span><span class="ew-mo">${pct != null && !err ? `${pct} % · ` : ''}${size}</span></div></div>`;
  }
  function rowHtml(p) {
    const { opt, i } = rowState(p);
    const busy = EW.busy.has(p.id);
    const status = p.conf
      ? `<span class="ew-st ok"><i class="dot"></i>${esc(p.conf.name)}${p.conf.exists ? '' : ' — exécutable introuvable'}</span>`
      : `<span class="ew-st none">Émulateur à configurer</span>`;
    const chips = (p.reco || []).length > 1 && !p.conf ? `<div class="ew-opts" role="radiogroup" aria-label="Émulateur pour ${esc(p.name)}">${p.reco.map((r, k) => `<button class="ew-opt" role="radio" aria-checked="${k === i}" data-ew-opt="${p.id}:${k}" data-nav>${esc(optLabel(r))}${k === 0 ? ' <small>conseillé</small>' : ''}</button>`).join('')}</div>` : '';
    let act = '';
    if (busy) act = `<button class="btn small danger" data-ew-cancel data-nav>Annuler</button>`;
    else if (!opt) act = `<button class="btn small" data-ew-pick="${p.id}" data-nav>Choisir l’exe…</button>`;
    else if (p.conf && p.conf.installed) act = `<button class="btn small" data-ew-update="${p.id}" data-nav>Mettre à jour</button>`;
    else if (p.conf) act = '';
    else if (opt.auto) act = `<button class="btn small primary" data-ew-install="${p.id}" data-nav>Installer ${esc(optLabel(opt))}</button><button class="btn small" data-ew-pick="${p.id}" data-nav>Choisir l’exe…</button>`;
    else act = `<button class="btn small primary" data-ew-site="${esc(opt.site)}" data-nav>Site de ${esc(opt.name)}</button><button class="btn small" data-ew-pick="${p.id}" data-nav>Choisir l’exe…</button>`;
    const siteNote = !p.conf && opt && !opt.auto && !busy ? `<p class="dim ew-note">${esc(opt.name)} n’a pas d’archive portable officielle à adresse stable : télécharge-le sur son site, puis « Choisir l’exe… ».</p>` : '';
    return `<div class="ew-row" data-plat="${p.id}">
      <div class="ew-name"><i style="background:${p.color}"></i><div><b>${esc(p.name)}</b><span class="dim">${p.games ? `${p.games} jeu${p.games > 1 ? "x" : ""}` : "aucun jeu"}</span></div></div>
      <div class="ew-body">${status}${chips}${siteNote}<div class="ew-progwrap">${progHtml(p.id)}</div>${biosHtml(p)}</div>
      <div class="ew-act">${act}</div>
    </div>`;
  }
  function renderWizard() {
    const d = EW.data;
    const panel = $('.panel', wiz);
    const keep = document.activeElement && wiz.contains(document.activeElement) ? [...document.activeElement.attributes].find((a) => a.name.startsWith('data-ew'))?.name : null;
    const keepVal = keep ? document.activeElement.getAttribute(keep) : null;
    if (!d) { panel.innerHTML = '<h2 id="ewTitle">Configurer les émulateurs</h2><p class="panel-lead">Impossible de lire la bibliothèque.</p>'; return; }
    const todo = d.platforms.filter((p) => !p.conf && rowState(p).opt?.auto);
    panel.innerHTML = `
      <h2 id="ewTitle">Configurer les émulateurs</h2>
      <p class="panel-lead">Pour chaque console de ta bibliothèque, l’émulateur conseillé est installé dans <code>${esc(ltr(d.root))}</code> et configuré avec les bons paramètres. Les BIOS ne sont jamais téléchargés : le launcher vérifie seulement leur présence.</p>
      <div class="ew-list">${d.platforms.length ? d.platforms.map(rowHtml).join('') : '<p class="dim">Aucune ROM dans la bibliothèque. « Toutes les consoles » pour installer un émulateur à l’avance.</p>'}</div>
      <div class="ew-foot">
        <button class="btn" data-ew-close data-nav>Fermer</button>
        <button class="btn" data-ew-all-plat aria-pressed="${EW.all}" data-nav>${EW.all ? 'Seulement mes consoles' : 'Toutes les consoles'}</button>
        ${todo.length ? `<button class="btn primary" data-ew-all data-nav ${EW.busy.size ? 'disabled' : ''}>Tout installer (${todo.length})</button>` : ''}
      </div>`;
    let f = keep ? $(`[${keep}="${CSS.escape(keepVal)}"]`, panel) : null;
    if (!f && EW.focusPlat) { f = $(`.ew-row[data-plat="${EW.focusPlat}"] [data-nav]`, panel); EW.focusPlat = null; }
    if (f) setFocus(f); else if (S.mode === 'emuwiz' && !wiz.contains(document.activeElement)) focusFirst();
  }
  function updateProg(pid) {
    const box = $(`.ew-row[data-plat="${pid}"] .ew-progwrap`, wiz);
    if (box) box.innerHTML = progHtml(pid);
  }
  rr.onX('x:emu:progress', (p) => {
    if (!p?.platform) return;
    EW.prog[p.platform] = { ...(EW.prog[p.platform] || {}), ...p, ...(p.phase !== 'download' && p.phase !== 'core' ? { got: 0, total: 0 } : {}) };
    updateProg(p.platform);
  });
  async function installRow(pid, update = false) {
    const p = EW.data?.platforms.find((x) => x.id === pid);
    if (!p) return;
    const opt = update ? (p.reco || []).find((r) => r.emu === p.conf?.installed) || rowState(p).opt : rowState(p).opt;
    if (!opt?.auto) return;
    EW.busy.add(pid);
    EW.prog[pid] = { phase: 'resolve', label: 'Préparation…' };
    renderWizard();
    const r = await rr.x('x:emu:install', { platform: pid, emu: opt.emu, core: opt.core, update }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    EW.busy.delete(pid);
    if (r.ok) { delete EW.prog[pid]; toast(`${optLabel(opt)} prêt pour ${p.name}`, 'success'); }
    else if (!r.cancelled) toast(`${p.name} : ${r.error}`, true);
    await refresh();
    return r;
  }
  wiz.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if (t('[data-ew-close]')) return closeOverlay();
    if ((b = t('[data-ew-opt]'))) { const [pid, k] = b.dataset.ewOpt.split(':'); EW.choice[pid] = +k; sfx('toggle'); return renderWizard(); }
    if ((b = t('[data-ew-install]'))) return installRow(b.dataset.ewInstall);
    if ((b = t('[data-ew-update]'))) return installRow(b.dataset.ewUpdate, true);
    if (t('[data-ew-all-plat]')) { EW.all = !EW.all; sfx('toggle'); return refresh(); }
    if (t('[data-ew-cancel]')) { await rr.x('x:emu:cancel'); return; }
    if ((b = t('[data-ew-site]'))) { rr.openExternal(b.dataset.ewSite); toast('Site officiel ouvert dans le navigateur'); return; }
    if ((b = t('[data-ew-folder]'))) { rr.x('x:emu:openFolder', b.dataset.ewFolder); return; }
    if ((b = t('[data-ew-pick]'))) { const c = await rr.pickEmulator(b.dataset.ewPick); if (c) { toast(`${c.name} configuré`, 'success'); refresh(); } return; }
    if (t('[data-ew-all]')) {
      const todo = EW.data.platforms.filter((p) => !p.conf && rowState(p).opt?.auto).map((p) => p.id);
      for (const pid of todo) { const r = await installRow(pid); if (r?.cancelled) break; }
    }
  });
  RR.actions.emuWizard = () => openWizard();
  RR.actions.emuWizardAll = () => { closeAll(); openWizard(null, { all: true }); }; // RECOMP : onglet « Émulateurs » de la boutique
  window.openEmuWizard = openWizard;
  window.emuOptLabel = optLabel; // RECOMP : onglet Émulateurs (consoles en 3D)

  // Prompt « Aucun émulateur » (A sur un jeu sans émulateur) : installation automatique en premier choix
  wrap('askEmulator', (orig, pid, gameId) => {
    orig(pid, gameId);
    const p = plat(pid);
    $('#pBody').insertAdjacentHTML('beforeend', '<p class="dim">Ou laisse le launcher installer et configurer l’émulateur conseillé.</p>');
    const b = document.createElement('button');
    b.className = 'btn primary'; b.dataset.nav = ''; b.dataset.default = '';
    b.textContent = 'Installer automatiquement';
    b.addEventListener('click', () => { closeAll(true); openWizard(pid); });
    const box = $('#pActions');
    $$('.btn.primary', box).forEach((x) => x.classList.remove('primary'));
    box.append(b);
    setTimeout(() => setFocus(b), 40);
    void p;
  });
  // Écran jeux : bouton « Configurer » à côté de Jouer quand la console n'a pas d'émulateur
  wrap('renderCapActions', (orig, g, ...a) => {
    orig(g, ...a);
    const box = $('#capActions');
    let b = $('[data-cap="emu-setup"]', box);
    const need = g && g.kind === 'rom' && !S.lib.settings.emulators?.[g.platform] && !g.launch?.emuPath;
    if (need && !b) {
      box.insertAdjacentHTML('beforeend', `<button class="cap-btn emu-cap" type="button" data-cap="emu-setup">${ICO.wand}<span>Configurer</span></button>`);
      S._actKey = '';
    } else if (!need && b) { b.remove(); S.act = Math.min(S.act || 0, $$('#capActions .cap-btn').length - 1); S._actKey = ''; }
  });
  $('#capActions').addEventListener('click', (e) => {
    if (!e.target.closest('[data-cap="emu-setup"]') || S.mode !== 'main') return;
    openWizard(S.items[S.sel]?.platform);
  });
  $('#capBadges').addEventListener('click', (e) => { if (e.target.closest('.badge.warn')) openWizard(S.items[S.sel]?.platform); });

  // ================================================================ C. Options de lancement (page du jeu)
  const lo = mkOverlay('emuLaunch', 'wide emu-lo', 'eloTitle');
  OVERLAYS.emulaunch = '#emuLaunch';
  const LO = { g: null, v: null, caps: {} };
  const tools = $('#dActions .d-tools');
  tools?.insertAdjacentHTML('afterbegin', `<button class="tool" data-act="emu-launch" data-nav>${ICO.opts}<span>Options de lancement</span></button>`);
  $('#dActions').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="emu-launch"]')) return;
    const g = S.items[S.sel];
    if (g) openLaunch(g);
  });
  wrap('renderDetails', (orig, ...a) => {
    orig(...a);
    const g = S.items[S.sel];
    const b = $('[data-act="emu-launch"]');
    if (b && g) { b.hidden = g.kind !== 'rom' && !g.exePath; b.classList.toggle('is-set', !!g.launch); }
  });
  async function openLaunch(g) {
    LO.g = g;
    LO.v = { emuPath: '', emuArgs: '', emuName: '', args: '', env: '', admin: false, fullscreen: 'default', resolution: 0, resume: 'default', via: '', ...(g.launch || {}) };
    renderLaunch(true);
    openOverlay('emulaunch');
    await preview();
  }
  const seg = (key, opts) => `<div class="seg emu-seg" role="radiogroup" data-lo-seg="${key}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-pressed="${String(LO.v[key]) === String(v)}" aria-checked="${String(LO.v[key]) === String(v)}" data-v="${v}" data-nav>${l}</button>`).join('')}</div>`;
  function renderLaunch() {
    const g = LO.g, v = LO.v, rom = g.kind === 'rom';
    const base = S.lib.settings.emulators?.[g.platform];
    const caps = LO.caps || {};
    $('.panel', lo).innerHTML = `
      <h2 id="eloTitle">Options de lancement</h2>
      <p class="panel-lead">${esc(g.name)} · ${esc(plat(g.platform).name)}</p>
      <div class="elo-list">
        ${rom ? `<div class="setting col"><div><strong>Émulateur pour ce jeu</strong><span class="dim">${v.emuPath ? 'Spécifique à ce jeu (ex. un autre cœur RetroArch).' : `Celui de la console : ${esc(base?.name || 'aucun')}`}</span></div>
          ${v.emuPath ? `<code class="elo-path">${esc(ltr(v.emuPath))}</code><input id="eloEmuArgs" value="${esc(v.emuArgs)}" placeholder='-f -L "cores/snes9x_libretro.dll" "{rom}"' spellcheck="false" aria-label="Arguments de l’émulateur ({rom} = chemin du jeu)" data-nav />` : ''}
          <div class="elo-row"><button class="btn small" data-lo="pick" data-nav>${v.emuPath ? 'Changer' : 'Choisir un autre émulateur…'}</button>${v.emuPath ? '<button class="btn small" data-lo="unpick" data-nav>Celui de la console</button>' : ''}</div></div>` : ''}
        <div class="setting col"><div><label for="eloArgs"><strong>Arguments supplémentaires</strong></label><span class="dim">${rom ? 'Ajoutés avant les arguments de l’émulateur.' : 'Ajoutés après ceux du jeu (ex. -windowed, -dx11).'}</span></div>
          <input id="eloArgs" value="${esc(v.args)}" spellcheck="false" data-nav /></div>
        ${rom && caps.fullscreen ? `<div class="setting"><div><strong>Plein écran</strong><span class="dim">Option de ligne de commande de l’émulateur.</span></div>${seg('fullscreen', [['default', 'Par défaut'], ['on', 'Oui'], ['off', 'Non']])}</div>` : ''}
        ${rom && caps.resolution ? `<div class="setting"><div><strong>Résolution interne</strong><span class="dim">Dolphin (-C GFX.Settings.InternalResolution).</span></div>${seg('resolution', [[0, 'Défaut'], [1, 'Native'], [2, '2×'], [3, '3×'], [4, '4×'], [6, '6×']])}</div>` : ''}
        ${g.source === 'epic' ? `<div class="setting"><div><strong>Lancement Epic</strong><span class="dim">« Direct » lance l'exécutable sans le client (jeux sans DRM Epic).</span></div>${seg('via', [['', 'Selon réglage'], ['direct', 'Direct'], ['client', 'Via le client']])}</div>` : ''}
        ${g.source === 'gog' && g.galaxyId ? `<div class="setting"><div><strong>Lancement GOG</strong><span class="dim">« Via Galaxy » : succès, cloud et overlay.</span></div>${seg('via', [['', 'Selon réglage'], ['direct', 'Direct'], ['galaxy', 'Via Galaxy']])}</div>` : ''}
        ${rom && caps.states ? `<div class="setting"><div><strong>Reprendre le dernier état</strong><span class="dim">Au lancement, charge la dernière sauvegarde rapide faite depuis le launcher.</span></div>${seg('resume', [['default', 'Selon réglage'], ['on', 'Oui'], ['off', 'Non']])}</div>` : ''}
        <div class="setting col"><div><label for="eloEnv"><strong>Variables d’environnement</strong></label><span class="dim">Une par ligne : <code>NOM=valeur</code> (ex. <code>DXVK_HUD=fps</code>).</span></div>
          <textarea id="eloEnv" rows="2" spellcheck="false" data-nav>${esc(v.env)}</textarea></div>
        <div class="setting"><div><strong id="eloAdmL">Lancer en administrateur</strong><span class="dim">Fenêtre UAC à chaque lancement. Les variables d’environnement ne sont pas transmises et Windows bloque l’envoi des raccourcis de sauvegarde vers un jeu administrateur.</span></div>
          <button class="toggle" role="switch" aria-checked="${!!v.admin}" aria-labelledby="eloAdmL" data-lo="admin" data-nav></button></div>
        <div class="elo-prev"><span class="dim">Commande</span><code id="eloPrev">…</code></div>
      </div>
      <div class="ew-foot">
        <button class="btn" data-lo="reset" data-nav>Réinitialiser</button>
        <button class="btn" data-lo="cancel" data-nav>Annuler</button>
        <button class="btn primary" data-lo="save" data-nav data-default>Enregistrer</button>
      </div>`;
  }
  function readInputs() {
    const v = LO.v;
    if ($('#eloArgs', lo)) v.args = $('#eloArgs', lo).value.trim();
    if ($('#eloEnv', lo)) v.env = $('#eloEnv', lo).value.trim();
    if ($('#eloEmuArgs', lo)) v.emuArgs = $('#eloEmuArgs', lo).value.trim();
  }
  async function preview() {
    readInputs();
    const r = await rr.x('x:emu:preview', LO.g.id, LO.v).catch(() => null);
    const had = JSON.stringify(LO.caps);
    LO.caps = r?.caps || {};
    if (JSON.stringify(LO.caps) !== had) { const f = document.activeElement?.dataset?.lo; renderLaunch(); if (f) setFocus($(`[data-lo="${f}"]`, lo)); }
    const el = $('#eloPrev', lo);
    if (el) el.textContent = r?.error || (r ? `${r.admin ? '[admin] ' : ''}${r.file.split(/[\\/]/).pop()} ${r.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}` : '');
  }
  lo.addEventListener('input', () => { clearTimeout(LO.t); LO.t = setTimeout(preview, 250); });
  lo.addEventListener('click', async (e) => {
    const sb = e.target.closest('[data-lo-seg] button');
    if (sb) {
      readInputs();
      const k = sb.parentElement.dataset.loSeg;
      LO.v[k] = k === 'resolution' ? Number(sb.dataset.v) : sb.dataset.v;
      $$('button', sb.parentElement).forEach((x) => { const on = x === sb; x.setAttribute('aria-pressed', on); x.setAttribute('aria-checked', on); });
      sfx('toggle'); preview(); return;
    }
    const b = e.target.closest('[data-lo]');
    if (!b) return;
    const a = b.dataset.lo;
    readInputs();
    if (a === 'admin') { LO.v.admin = !LO.v.admin; b.setAttribute('aria-checked', LO.v.admin); sfx('toggle'); preview(); }
    else if (a === 'pick') {
      const f = await rr.x('x:emu:pickExe', `Émulateur pour ${LO.g.name}`);
      if (!f) return;
      const ex = (plat(LO.g.platform).emulators || []);
      LO.v.emuPath = f; LO.v.emuName = f.split(/[\\/]/).pop().replace(/\.\w+$/, '');
      LO.v.emuArgs ||= (S.lib.settings.emulators?.[LO.g.platform]?.args) || ex[0]?.args || '"{rom}"';
      renderLaunch(); setFocus($('#eloEmuArgs', lo)); preview();
    } else if (a === 'unpick') { LO.v.emuPath = ''; LO.v.emuArgs = ''; LO.v.emuName = ''; renderLaunch(); setFocus($('[data-lo="pick"]', lo)); preview(); }
    else if (a === 'reset') { LO.v = { emuPath: '', emuArgs: '', emuName: '', args: '', env: '', admin: false, fullscreen: 'default', resolution: 0, resume: 'default', via: '' }; renderLaunch(); setFocus($('[data-lo="save"]', lo)); preview(); }
    else if (a === 'cancel') closeOverlay();
    else if (a === 'save') {
      const r = await rr.x('x:emu:setLaunch', LO.g.id, LO.v);
      closeOverlay();
      toast(r ? 'Options de lancement enregistrées' : 'Options de lancement par défaut', 'success');
    }
  });

  // ================================================================ B. Menu en jeu : sauvegardes d'état
  const IGE = { info: null };
  function igInsert() {
    const main = $('#igMain');
    if (!main || $('[data-ig="emu-save"]', main)) return;
    const quit = $('[data-ig="quit"]', main);
    quit.insertAdjacentHTML('beforebegin', `
      <button class="ig-item emu-ig" data-ig="emu-save" role="menuitem" data-nav hidden>${ICO.save}<span class="ig-label">Sauvegarde rapide</span><span class="ig-meta" id="emuSaveMeta"></span></button>
      <button class="ig-item emu-ig" data-ig="emu-load" role="menuitem" data-nav hidden>${ICO.load}<span class="ig-label">Charger la sauvegarde</span><span class="ig-meta" id="emuLoadMeta"></span></button>
      <div class="ig-item emu-ig emu-slot" id="emuSlotRow" role="group" aria-label="Emplacement de sauvegarde" hidden>${ICO.slot}<span class="ig-label">Emplacement</span>
        <button class="emu-slot-b" data-ig="emu-slot-" aria-label="Emplacement précédent" data-nav>${ICO.minus}</button><b id="emuSlotN" aria-live="polite">1</b><button class="emu-slot-b" data-ig="emu-slot+" aria-label="Emplacement suivant" data-nav>${ICO.plus}</button></div>`);
  }
  async function igUpdate() {
    const els = $$('.emu-ig');
    const id = IG.id;
    const info = id ? await rr.x('x:emu:info', id).catch(() => null) : null;
    IGE.info = info;
    const on = !!info?.supported && S.lib.settings.emuStates !== false;
    els.forEach((el) => { el.hidden = !on; });
    if (!on) return;
    const pad = S.device === 'pad' && S.lib.settings.emuPadStates === true;
    const G = S.padType === 'ps' ? 'PS' : 'Guide';
    $('#emuSaveMeta').textContent = pad ? `${G} + ↑` : info.net ? `${info.name} · réseau` : `${info.name} · ${info.save.replace('{slot}', info.slot)}`;
    $('#emuLoadMeta').textContent = pad ? `${G} + ↓` : info.net ? '' : info.load.replace('{slot}', info.slot);
    $('#emuSlotN').textContent = String(info.slot);
    $('#emuSlotRow').hidden = info.min === info.max;
  }
  igInsert();
  $('#ingame').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ig^="emu-"]');
    if (!b) return;
    e.stopImmediatePropagation();
    const act = b.dataset.ig;
    if (act === 'emu-slot-' || act === 'emu-slot+') {
      const n = await rr.x('x:emu:slot', IG.id, act.endsWith('+') ? 1 : -1);
      if (n != null) { sfx('move'); igUpdate(); }
      return;
    }
    const id = IG.id;
    const action = act === 'emu-load' ? 'load' : 'save';
    closeAll(true);
    rr.resumeGame(id); // le jeu reprend le focus, puis le raccourci / la commande est envoyé
    const r = await rr.x('x:emu:state', { id, action, delay: 700 });
    if (!r?.ok) toast(`Sauvegarde d’état : ${r?.error || 'échec'}`, true);
  }, true);
  rr.onX('x:emu:done', (r) => { if (document.visibilityState === 'visible' && r && !r.ok) toast(`Sauvegarde d’état : ${r.error}`, true); });
  RR.on('mode', (m) => { if (m === 'ingame') igUpdate(); });
  wrap('openIngame', async (orig, g, ...a) => { const r = await orig(g, ...a); igUpdate(); return r; });
  // « Quitter le jeu ? » : prévenir de la sauvegarde automatique
  wrap('igQuit', (orig, ...a) => {
    const r = orig(...a);
    if (S.lib.settings.emuSaveOnQuit === true && IGE.info?.supported && S.mode === 'prompt') {
      $('#pBody').insertAdjacentHTML('beforeend', `<p class="emu-autosave">${ICO.save}<span>Sauvegarde rapide automatique avant de fermer (emplacement ${IGE.info.slot}).</span></p>`);
    }
    return r;
  });

  // ================================================================ Raccourcis de sauvegarde (réglages)
  const keys = mkOverlay('emuKeys', 'wide emu-keys', 'ekTitle');
  OVERLAYS.emukeys = '#emuKeys';
  let HK = null;
  async function openKeys() {
    HK ||= await rr.x('x:emu:hotkeys');
    const ov = S.lib.settings.emuHotkeys || {};
    const cell = (k, f) => {
      const d = HK.defaults[k][f];
      if (!d && f !== 'save' && f !== 'load') return '<span class="dim">—</span>';
      return `<input data-hk="${k}.${f}" value="${esc(ov[k]?.[f] || '')}" placeholder="${esc(d || '')}" spellcheck="false" aria-label="${esc(HK.labels[k])} : ${f}" data-nav />`;
    };
    $('.panel', keys).innerHTML = `
      <h2 id="ekTitle">Raccourcis de sauvegarde d’état</h2>
      <p class="panel-lead">Raccourcis clavier par défaut de chaque émulateur, envoyés par le launcher. Change-les seulement si tu les as modifiés dans l’émulateur. <code>{slot}</code> = numéro d’emplacement. RetroArch passe d’abord par ses commandes réseau.</p>
      <div class="ek-table" role="table">
        <div class="ek-h" role="row"><span>Émulateur</span><span>Sauver</span><span>Charger</span><span>Empl. −</span><span>Empl. +</span></div>
        ${Object.keys(HK.defaults).map((k) => `<div class="ek-r" role="row"><span>${esc(HK.labels[k])}${HK.defaults[k].unverified ? ' <small class="dim">(à vérifier)</small>' : ''}</span>${cell(k, 'save')}${cell(k, 'load')}${cell(k, 'prev')}${cell(k, 'next')}</div>`).join('')}
      </div>
      <div class="ew-foot"><button class="btn" data-ek-reset data-nav>Valeurs par défaut</button><button class="btn primary" data-ek-close data-nav>Terminé</button></div>`;
    if (S.mode !== 'emukeys') openOverlay('emukeys');
  }
  keys.addEventListener('change', (e) => {
    const i = e.target.closest('[data-hk]');
    if (!i) return;
    const [k, f] = i.dataset.hk.split('.');
    const all = JSON.parse(JSON.stringify(S.lib.settings.emuHotkeys || {}));
    const v = i.value.trim().replace(/\s*\+\s*/g, '+');
    if (v && !/^((ctrl|shift|alt)\+)*(f([1-9]|1\d|2[0-4]|\{slot\})|[a-z0-9]|\{slot\})$/i.test(v)) { toast('Raccourci non reconnu (ex. Shift+F2, F{slot})', true); return; }
    all[k] = { ...(all[k] || {}), [f]: v };
    if (!v) delete all[k][f];
    rr.setSettings({ emuHotkeys: all });
    toast('Raccourci enregistré', 'success');
  });
  keys.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ek-close]')) return closeOverlay();
    if (e.target.closest('[data-ek-reset]')) { await rr.setSettings({ emuHotkeys: {} }); openKeys(); toast('Raccourcis par défaut', 'success'); }
  });

  // ================================================================ Réglages
  $('#set-emu').innerHTML = `
    <h3 class="set-group">Émulateurs</h3>
    <div class="setting">
      <div><strong>Configurer les émulateurs</strong><span class="dim">Installe et configure automatiquement l’émulateur conseillé de chaque console de ta bibliothèque (RetroArch et ses cœurs, PCSX2, RPCS3…), vérifie les BIOS.</span></div>
      <button class="btn accent" data-action="emuWizard" id="emuWizBtn" data-nav>Configurer…</button>
    </div>
    <div class="setting">
      <div><strong id="lbEmuStates">Sauvegardes d’état dans le menu en jeu</strong><span class="dim">« Sauvegarde rapide » et « Charger la sauvegarde » quand le jeu tourne dans un émulateur connu.</span></div>
      <button class="toggle" data-toggle="emuStates" role="switch" aria-labelledby="lbEmuStates" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbEmuQuit">Sauvegarde automatique avant de quitter</strong><span class="dim">« Quitter le jeu » fait une sauvegarde rapide, attend 1,5 s, puis ferme l’émulateur.</span></div>
      <button class="toggle" data-toggle="emuSaveOnQuit" role="switch" aria-labelledby="lbEmuQuit" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbEmuResume">Reprendre le dernier état au lancement</strong><span class="dim">Après une sauvegarde rapide faite depuis le launcher, le jeu repart de là au prochain lancement (réglable jeu par jeu dans les options de lancement). Compter ~6 s d'attente le temps que l'émulateur charge le jeu.</span></div>
      <button class="toggle" data-toggle="emuResume" role="switch" aria-labelledby="lbEmuResume" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbEmuPad">Manette : Guide + ↑ sauvegarde, Guide + ↓ charge</strong><span class="dim">Pendant le jeu, sans ouvrir le menu (PS + ↑ / ↓ sur PlayStation). Le jeu reçoit aussi la flèche.</span></div>
      <button class="toggle" data-toggle="emuPadStates" role="switch" aria-labelledby="lbEmuPad" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbEmuNet">RetroArch : commandes réseau</strong><span class="dim">Sauvegarde sans passer par le clavier (UDP 55355, activé dans retroarch.cfg par l’installation automatique).</span></div>
      <button class="toggle" data-toggle="emuNetCmd" role="switch" aria-labelledby="lbEmuNet" data-nav></button>
    </div>
    <div class="setting">
      <div><strong>Raccourcis de sauvegarde</strong><span class="dim">Touches envoyées à chaque émulateur (F2 / F4 pour RetroArch, Shift+F1 / F1 pour Dolphin…).</span></div>
      <button class="btn" id="emuKeysBtn" data-nav>Modifier…</button>
    </div>`;
  $('#emuKeysBtn').addEventListener('click', () => openKeys());
  // Onglet « Consoles & émulateurs » : accès direct à l'assistant
  $('[data-page="emus"] .set-intro')?.insertAdjacentHTML('afterend', `<div class="emu-intro-act"><button class="btn accent" data-action="emuWizard" data-nav>${ICO.wand}<span>Configurer automatiquement…</span></button></div>`);

  function applyState(st) {
    const s = st.settings || {};
    const def = {};
    for (const k of ['emuStates', 'emuNetCmd']) if (s[k] === undefined) def[k] = true;
    if (Object.keys(def).length) rr.setSettings(def);
    if (S.mode === 'emuwiz' && !EW.busy.size) refresh();
  }
  RR.on('library', applyState);
  rr.getLibrary().then(applyState);
})();

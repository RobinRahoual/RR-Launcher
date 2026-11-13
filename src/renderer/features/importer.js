/* Module IMPORTER — « Nettoyer la bibliothèque » : doublons, jeux désinstallés, visuels manquants, métadonnées en échec.
   Points d'accroche : OVERLAYS.ximp (#xImpClean), RR.actions.xImpClean, entrée du menu latéral, bloc #set-importer.
   Côté main : src/features/importer.js (x:importer:analyze | merge | remove | tried) ; re-téléchargement = rr.refetch (existant).
   L'import des autres launchers passe par le bouton existant « Launchers installés » (scan:run, mode 'launchers'). */
(() => {
  const X = { d: null, checked: new Set(), keeper: {}, phase: 'idle', busy: null };
  const ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
  const SECTIONS = [
    { id: 'd', title: 'Doublons', hint: 'Fusionne les entrées d’un même jeu en gardant la plus complète (temps de jeu, favori, statut additionnés).' },
    { id: 'm', title: 'Jeux désinstallés', hint: 'Fichier, ROM ou dossier introuvable. Retiré du launcher seulement : rien n’est supprimé sur ton disque.' },
    { id: 'i', title: 'Visuels manquants', hint: 'Jaquette, fond ou logo absents : récupérés de nouveau.' },
    { id: 'n', title: 'Sans métadonnées', hint: 'La recherche a échoué : elle est relancée.' },
  ];
  const sec = (id) => SECTIONS.find((s) => s.id === id);
  const days = (ts) => Math.floor((Date.now() - ts) / 864e5);
  const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
  const sub = (g) => [plat(g.platform).short || plat(g.platform).name, g.source && SRC_LABEL[g.source] || (g.kind === 'steam' ? 'Steam' : g.kind === 'epic' ? 'Epic' : '')].filter(Boolean).join(' · ');

  // ---------------------------------------------------------------- Overlay
  const ov = document.createElement('div');
  ov.className = 'overlay center';
  ov.id = 'xImpClean';
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', 'xiTitle');
  ov.innerHTML = `<div class="panel xwide xi-panel">
    <h2 id="xiTitle">Nettoyer la bibliothèque</h2>
    <p class="panel-lead" id="xiLead" role="status"></p>
    <div class="progress xi-progress" id="xiProg" hidden role="progressbar" aria-label="Progression"><i></i></div>
    <div class="scan-list xi-list" id="xiList"></div>
    <div class="panel-actions"><button class="btn" data-action="close" id="xiClose" data-nav>Fermer</button><button class="btn primary" id="xiApply" data-nav>Appliquer</button></div>
  </div>`;
  document.body.append(ov);
  OVERLAYS.ximp = '#xImpClean';
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && X.phase !== 'busy') closeOverlay(); });

  async function analyze() {
    X.phase = 'loading';
    X.checked = new Set(); X.keeper = {};
    render();
    let d = null;
    try { d = await rr.x('x:importer:analyze'); } catch (e) { console.error(e); }
    if (S.mode !== 'ximp') return;
    X.d = d;
    if (d) {
      d.duplicates.forEach((g, i) => { X.keeper[i] = g.keep; if (g.strong) X.checked.add('d:' + i); });
      d.images.forEach((g) => { if (!g.triedAt || days(g.triedAt) >= 7) X.checked.add('i:' + g.id); });
      d.nometa.forEach((g) => { if (!g.triedAt || days(g.triedAt) >= 7) X.checked.add('n:' + g.id); });
    }
    X.phase = 'ready';
    render();
    setTimeout(focusFirst, 30);
  }

  function rowHtml(key, aria, name, subText, tag, extra = '') {
    return `<div class="xi-row"><button class="scan-item" role="checkbox" aria-checked="${aria}" data-xi="${esc(key)}" data-nav>
      <span class="chk"></span><span><span class="si-name">${esc(name)}</span><span class="si-path">${subText}</span></span><span class="si-src">${esc(tag)}</span></button>${extra}</div>`;
  }
  const count = (id) => [...X.checked].filter((k) => k.startsWith(id + ':')).length;
  const total = (id) => ({ d: X.d.duplicates.length, m: X.d.missing.length, i: X.d.images.length, n: X.d.nometa.length })[id];

  function render() {
    const list = $('#xiList'), lead = $('#xiLead');
    $('#xiProg').hidden = X.phase !== 'busy';
    $('#xiApply').hidden = X.phase !== 'ready';
    $('#xiClose').textContent = X.phase === 'done' ? 'Terminer' : 'Fermer';
    if (X.phase === 'loading') { lead.textContent = 'Analyse de la bibliothèque…'; list.innerHTML = '<p class="results-empty">Vérification des fichiers et des visuels…</p>'; return; }
    if (X.phase === 'busy') { lead.textContent = X.busy || 'Nettoyage en cours…'; return; }
    if (X.phase === 'done') {
      lead.textContent = 'Nettoyage terminé';
      list.innerHTML = `<ul class="xi-summary">${X.summary.map((l) => `<li>${l}</li>`).join('')}</ul>` + (X.summary.length ? '' : '<p class="results-empty">Rien à faire.</p>');
      return;
    }
    const d = X.d;
    if (!d) { lead.textContent = 'Analyse impossible.'; list.innerHTML = ''; return; }
    const n = d.duplicates.length + d.missing.length + d.images.length + d.nometa.length;
    lead.innerHTML = n ? `<b>${plural(n, 'point à examiner', 'points à examiner')}</b> sur ${plural(d.total, 'jeu', 'jeux')}` + (d.offline ? `<span class="dim"> · ${plural(d.offline, 'jeu sur un disque absent ignoré', 'jeux sur un disque absent ignorés')}</span>` : '') : 'Bibliothèque propre : rien à nettoyer.';
    list.innerHTML = SECTIONS.map((s) => {
      const t = total(s.id);
      if (!t) return '';
      let rows = '';
      if (s.id === 'd') rows = d.duplicates.map((g, i) => {
        const keep = g.items.find((x) => x.id === X.keeper[i]) || g.items[0];
        const others = g.items.filter((x) => x.id !== keep.id);
        const info = (x) => `${esc(x.name)}${x.playtime ? ' · ' + esc(fmtTime(x.playtime)) : ''}${x.favorite ? ' · favori' : ''}`;
        return rowHtml('d:' + i, X.checked.has('d:' + i), keep.name, `Garde : ${info(keep)} — retire : ${others.map((o) => info(o)).join(' ; ')}`, g.strong ? 'DOUBLON' : 'MÊME NOM',
          `<button class="btn small xi-cycle" data-xi-cycle="${i}" data-nav aria-label="Changer le jeu conservé pour ${esc(keep.name)}">Garder un autre</button>`);
      }).join('');
      else if (s.id === 'm') rows = d.missing.map((g) => rowHtml('m:' + g.id, X.checked.has('m:' + g.id), g.name, esc(ltr(g.path)), g.reason.toUpperCase().slice(0, 18)))
        .join('');
      else if (s.id === 'i') rows = d.images.map((g) => rowHtml('i:' + g.id, X.checked.has('i:' + g.id), g.name, `${esc(sub(g))} · manque : ${esc(g.missing.join(', '))}${g.triedAt ? ` · déjà tenté il y a ${days(g.triedAt) || '< 1'} j` : ''}`, 'VISUELS')).join('');
      else rows = d.nometa.map((g) => rowHtml('n:' + g.id, X.checked.has('n:' + g.id), g.name, `${esc(sub(g))}${g.triedAt ? ` · déjà tenté il y a ${days(g.triedAt) || '< 1'} j` : ''}`, 'RECHERCHE')).join('');
      return `<div class="xi-sec"><div class="xi-head"><div><div class="scan-group xi-title">${esc(s.title)} · ${t}</div><p class="scan-sub">${esc(s.hint)}</p></div>
        <div class="scan-tools"><button class="btn small" data-xi-all="${s.id}" data-nav>Tout cocher</button><button class="btn small" data-xi-none="${s.id}" data-nav>Aucun</button></div></div>${rows}</div>`;
    }).join('') || '<p class="results-empty">Aucune entrée en double, aucun jeu désinstallé, aucun visuel manquant.</p>';
    update();
  }
  function update() {
    if (X.phase !== 'ready') return;
    const n = X.checked.size;
    const b = $('#xiApply');
    b.textContent = n ? `Appliquer (${n})` : 'Appliquer';
    b.disabled = !n;
  }

  ov.addEventListener('click', (e) => {
    const t = e.target.closest('[data-xi], [data-xi-cycle], [data-xi-all], [data-xi-none]');
    if (!t || X.phase !== 'ready') return;
    if (t.dataset.xi) {
      const k = t.dataset.xi;
      X.checked.has(k) ? X.checked.delete(k) : X.checked.add(k);
      t.setAttribute('aria-checked', X.checked.has(k));
      sfx('toggle'); update();
    } else if (t.dataset.xiCycle != null) {
      const i = +t.dataset.xiCycle, g = X.d.duplicates[i];
      const at = g.items.findIndex((x) => x.id === X.keeper[i]);
      X.keeper[i] = g.items[(at + 1) % g.items.length].id;
      sfx('move');
      render();
      setFocus($(`[data-xi-cycle="${i}"]`, ov));
    } else {
      const id = t.dataset.xiAll || t.dataset.xiNone, on = !!t.dataset.xiAll;
      const map = { m: 'missing', i: 'images', n: 'nometa' };
      const keys = id === 'd' ? X.d.duplicates.map((_, i) => 'd:' + i) : X.d[map[id]].map((g) => id + ':' + g.id);
      keys.forEach((k) => (on ? X.checked.add(k) : X.checked.delete(k)));
      render();
      setFocus($(`[data-xi-${on ? 'all' : 'none'}="${id}"]`, ov));
      sfx('toggle');
    }
  });

  // ---------------------------------------------------------------- Application
  function apply() {
    const dup = X.d.duplicates.map((g, i) => ({ g, i })).filter(({ i }) => X.checked.has('d:' + i));
    const rm = X.d.missing.filter((g) => X.checked.has('m:' + g.id));
    const img = X.d.images.filter((g) => X.checked.has('i:' + g.id));
    const nm = X.d.nometa.filter((g) => X.checked.has('n:' + g.id));
    const lines = [];
    if (dup.length) lines.push(`<li>Fusionner ${plural(dup.length, 'doublon', 'doublons')} (${plural(dup.reduce((a, { g }) => a + g.ids.length - 1, 0), 'entrée retirée', 'entrées retirées')})</li>`);
    if (rm.length) lines.push(`<li>Retirer ${plural(rm.length, 'jeu désinstallé', 'jeux désinstallés')} du launcher</li>`);
    if (img.length) lines.push(`<li>Re-télécharger les visuels de ${plural(img.length, 'jeu', 'jeux')}</li>`);
    if (nm.length) lines.push(`<li>Relancer la recherche pour ${plural(nm.length, 'jeu', 'jeux')}</li>`);
    const destructive = dup.length || rm.length;
    const go = () => run(dup, rm, img, nm);
    if (!destructive) { go(); return; }
    openPrompt({
      title: 'Appliquer le nettoyage ?', icon: 'danger', tone: 'danger',
      body: `<ul class="xi-confirm">${lines.join('')}</ul><p class="dim">Seules les entrées du launcher sont retirées : tes fichiers, ROMs et sauvegardes restent sur le disque.</p>`,
      actions: [
        { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
        { label: 'Appliquer', danger: true, onClick: () => { closeOverlay(true); go(); } },
      ],
    });
  }
  $('#xiApply').addEventListener('click', apply);

  async function run(dup, rm, img, nm) {
    X.phase = 'busy'; X.summary = [];
    const prog = $('#xiProg i');
    const set = (msg, p) => { X.busy = msg; $('#xiLead').textContent = msg; if (p != null) prog.style.width = Math.round(p * 100) + '%'; };
    $('#xiList').innerHTML = ''; render(); set('Nettoyage en cours…', 0);
    try {
      if (dup.length) {
        set('Fusion des doublons…');
        const r = await rr.x('x:importer:merge', { groups: dup.map(({ g, i }) => ({ keep: X.keeper[i], drop: g.ids.filter((id) => id !== X.keeper[i]) })) });
        X.summary.push(`Doublons : <b>${plural(r.merged, 'fusionné', 'fusionnés')}</b>, ${plural(r.removed, 'entrée retirée', 'entrées retirées')}`);
      }
      if (rm.length) {
        set('Retrait des jeux désinstallés…');
        const r = await rr.x('x:importer:remove', { ids: rm.map((g) => g.id) });
        X.summary.push(`Désinstallés : <b>${plural(r.removed, 'jeu retiré', 'jeux retirés')}</b>`);
      }
      const todo = [...img.map((g) => g.id), ...nm.map((g) => g.id)];
      if (todo.length) {
        await rr.x('x:importer:tried', { ids: todo });
        let done = 0, good = 0, next = 0;
        const worker = async () => {
          while (next < todo.length) {
            const id = todo[next++];
            const g = await rr.refetch(id, null).catch(() => null);
            done++;
            if (g && (g.metaStatus === 'ok' || g.media?.cover)) good++;
            set(`Visuels et recherche : ${done} / ${todo.length}`, done / todo.length);
          }
        };
        set(`Visuels et recherche : 0 / ${todo.length}`, 0);
        await Promise.all([worker(), worker(), worker()]);
        if (img.length) X.summary.push(`Visuels : ${plural(img.length, 'jeu traité', 'jeux traités')}`);
        if (nm.length) X.summary.push(`Recherche : ${plural(nm.length, 'jeu relancé', 'jeux relancés')}`);
        X.summary.push(`<b>${good} / ${todo.length}</b> avec une jaquette ou un fond à présent${good < todo.length ? ' <span class="dim">— les autres restent introuvables avec les sources actuelles (une clé SteamGridDB peut aider)</span>' : ''}`);
      }
    } catch (e) { console.error(e); X.summary.push('Une erreur est survenue pendant le nettoyage.'); }
    if (S.mode !== 'ximp') { toast('Nettoyage terminé', 'success'); return; }
    X.phase = 'done'; sfx('confirm'); render();
    $('#xiList').insertAdjacentHTML('beforeend', '<div class="xi-again"><button class="btn small" id="xiAgain" data-nav>Analyser à nouveau</button></div>');
    $('#xiAgain').addEventListener('click', analyze);
    setTimeout(() => setFocus($('#xiClose')), 30);
  }

  function open() { closeAll(); openOverlay('ximp'); analyze(); }
  RR.actions.xImpClean = open;
  RR.on('mode', () => { if (S.mode !== 'ximp' && X.phase !== 'busy') X.phase = 'idle'; });

  // ---------------------------------------------------------------- Menu latéral
  const menuBtn = document.createElement('button');
  menuBtn.className = 'menu-item';
  menuBtn.dataset.action = 'xImpClean';
  menuBtn.dataset.nav = '';
  menuBtn.innerHTML = `${ICON}<span class="mi-label">Nettoyer la bibliothèque</span>`;
  $('#menu [data-action="addHub"]')?.after(menuBtn);

  // ---------------------------------------------------------------- Réglages (#set-importer)
  const set = $('#set-importer');
  if (set) {
    set.innerHTML = `<h3 class="set-group">Import et nettoyage</h3>
      <div class="setting">
        <div><strong>Importer les launchers installés</strong><span class="dim">Steam, Epic, GOG, Xbox / Game Pass, EA app, Ubisoft Connect, Battle.net, Amazon Games, itch.io. Lecture locale seulement, aucun compte demandé.</span></div>
        <button class="btn small" id="xiImport" data-nav>Importer…</button>
      </div>
      <div class="setting">
        <div><strong>Nettoyer la bibliothèque</strong><span class="dim">Doublons, jeux désinstallés, visuels manquants, métadonnées en échec : tu coches, rien n’est supprimé sans confirmation.</span></div>
        <button class="btn small" id="xiClean" data-nav>Nettoyer…</button>
      </div>`;
    $('#xiClean').addEventListener('click', open);
    $('#xiImport').addEventListener('click', () => action('scanLaunchers'));
  }
  window.RRImporter = { X, open, render };
})();

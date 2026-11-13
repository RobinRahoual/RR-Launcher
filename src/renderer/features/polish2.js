// Module polish2 (renderer) — batterie de la manette dans la barre du haut, thème « Horaire »,
// chargement plus rapide des visuels (lazy/async + préchargement des voisins).
(() => {
  'use strict';

  // ---------------------------------------------------------------- 1. Batterie de la manette
  const ICON_PAD_BAT = (level, wired) => {
    if (wired) return '<svg viewBox="0 0 30 14" aria-hidden="true"><path d="M3 7h13M16 4.5 19 7l-3 2.5"/><path d="M23 1v4M26 1v4M22 5h5v3a2.5 2.5 0 0 1-5 0z"/></svg>';
    const cells = level > 0 ? Math.ceil(level / 25) : 0;
    const bars = [0, 1, 2, 3].map((i) => `<rect class="pb-cell${i < cells ? ' on' : ''}" x="${4 + i * 5}" y="3" width="3.8" height="8" rx="1"/>`).join('');
    return `<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="pb-shell" x="1" y="1" width="24" height="12" rx="3"/><path class="pb-shell" d="M26.5 5v4"/>${bars}</svg>`;
  };

  let padBatEl = null;
  let warnedLow = false;
  function padBatNode() {
    if (padBatEl?.isConnected) return padBatEl;
    padBatEl = document.createElement('span');
    padBatEl.className = 'pad-bat';
    padBatEl.id = 'padBat';
    padBatEl.setAttribute('role', 'img');
    padBatEl.hidden = true;
    const anchor = $('#padInd') || $('#inputInd');
    if (anchor) anchor.insertAdjacentElement('afterend', padBatEl);
    else $('.status-ind')?.prepend(padBatEl);
    return padBatEl;
  }

  // b = { level: 0..100 | null, charging, wired } (envoyé par src/features/polish2.js toutes les 30 s)
  function renderPadBat(b) {
    const el = padBatNode();
    if (!b || (b.level == null && !b.wired)) { el.hidden = true; warnedLow = false; return; }
    el.hidden = false;
    const low = b.level != null && !b.charging && b.level < 20;
    const critical = b.level != null && !b.charging && b.level < 15;
    el.classList.toggle('low', low && !critical);
    el.classList.toggle('critical', critical);
    el.innerHTML = ICON_PAD_BAT(b.level, b.wired) + (b.wired ? '<b>filaire</b>' : `<b>${b.level}&thinsp;%</b>`);
    const label = b.wired ? 'Manette branchée en USB' : `Batterie de la manette ${b.level} %${b.charging ? ', en charge' : ''}`;
    el.title = label; el.setAttribute('aria-label', label);
    if (b.charging || b.level >= 25) warnedLow = false;
    if (critical && !warnedLow) { warnedLow = true; toast('Batterie de la manette faible', 'error'); }
  }
  rr.onX('x:polish2:battery', renderPadBat);

  // ---------------------------------------------------------------- 2. Thème « Horaire »
  const HOURS_DAY = [6, 7, 8, 9];
  const HOURS_NIGHT = [18, 19, 20, 21, 22];
  const dayFrom = () => Number(S.lib?.settings?.polish2Day ?? 7);
  const nightFrom = () => Number(S.lib?.settings?.polish2Night ?? 20);
  // Clair de « jour » (inclus) à « nuit » (exclu) ; supporte un intervalle qui passe minuit
  function scheduledTheme(now = new Date()) {
    const h = now.getHours() + now.getMinutes() / 60;
    const d = dayFrom(), n = nightFrom();
    const light = d < n ? h >= d && h < n : h >= d || h < n;
    return light ? 'light' : 'dark';
  }
  const prevApplyTheme = window.applyTheme;
  function applyThemeWithSchedule() {
    if (S.lib?.settings?.theme !== 'schedule') return prevApplyTheme();
    const t = scheduledTheme();
    if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
  }
  window.applyTheme = applyThemeWithSchedule;
  // L'écouteur système d'app.js appelle l'ancienne fonction directement : on recorrige après elle
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeWithSchedule);
  setInterval(() => { if (S.lib?.settings?.theme === 'schedule') applyThemeWithSchedule(); }, 60000);

  // Bouton « Horaire » ajouté au réglage de thème
  const themeSeg = $('.seg[data-setting="theme"]');
  if (themeSeg && !themeSeg.querySelector('[data-value="schedule"]')) {
    const b = document.createElement('button');
    b.dataset.value = 'schedule';
    b.dataset.nav = '';
    b.textContent = 'Horaire';
    themeSeg.append(b);
  }

  // Heures réglables dans #set-polish2
  const hourSeg = (key, label, hours) => `
    <div class="setting">
      <div><strong id="lb-${key}">${label}</strong><span class="dim">Utilisé quand le thème est réglé sur « Horaire »</span></div>
      <div class="seg" data-setting="${key}" role="group" aria-labelledby="lb-${key}">
        ${hours.map((h) => `<button data-value="${h}" data-nav>${h} h</button>`).join('')}
      </div>
    </div>`;
  const setBox = $('#set-polish2');
  if (setBox && !setBox.hasChildNodes()) {
    setBox.innerHTML = `
      <h3 class="set-group">Mode jour / nuit</h3>
      ${hourSeg('polish2Day', 'Clair dès', HOURS_DAY)}
      ${hourSeg('polish2Night', 'Sombre dès', HOURS_NIGHT)}`;
  }

  // ---------------------------------------------------------------- 3. Chargement plus rapide
  const SELECTED = '.is-sel, .is-selected, .is-current';
  function lazyImages(root) {
    const imgs = root.tagName === 'IMG' ? [root] : root.querySelectorAll?.('img') || [];
    for (const img of imgs) {
      if (!img.hasAttribute('decoding')) img.decoding = 'async';
      if (img.hasAttribute('loading') || img.closest(SELECTED)) continue;
      img.loading = 'lazy';
    }
  }
  lazyImages(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) lazyImages(n);
  }).observe(document.body, { childList: true, subtree: true });

  // Préchargement des visuels des voisins de la sélection (6 requêtes max en parallèle)
  const PRE = { max: 6, inflight: 0, queue: [], done: new Set() };
  function pump() {
    while (PRE.inflight < PRE.max && PRE.queue.length) {
      const url = PRE.queue.shift();
      PRE.inflight++;
      const im = new Image();
      const end = () => { PRE.done.add(url); PRE.inflight--; pump(); };
      im.onload = end; im.onerror = end;
      im.decoding = 'async';
      im.src = url;
    }
  }
  function neighbourUrls(g) {
    const m = g?.media || {};
    return [m.hero || m.header, m.cover].filter(Boolean).map((f) => mediaUrl(g, f));
  }
  RR.on('selection', (g) => {
    // La jaquette sélectionnée n'est jamais en chargement paresseux
    for (const img of document.querySelectorAll(`${SELECTED} img[loading="lazy"]`)) img.removeAttribute('loading');
    if (!g || S.view !== 'games') { PRE.queue = []; return; }
    const i = S.items.findIndex((x) => x.id === g.id);
    if (i < 0) return;
    const order = [1, -1, 2, -2];
    const want = [];
    for (const d of order) {
      const n = S.items[i + d];
      if (n) want.push(...neighbourUrls(n));
    }
    // Les plus proches d'abord ; on remplace la file (les anciennes sélections sont périmées)
    PRE.queue = [...new Set(want)].filter((u) => !PRE.done.has(u));
    pump();
  });

  RR.polish2 = { renderPadBat, scheduledTheme };
})();

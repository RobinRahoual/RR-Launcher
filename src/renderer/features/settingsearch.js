// Module SETTINGSEARCH (renderer) — barre de recherche dans les Réglages : filtre les réglages de tous les onglets.
(() => {
  'use strict';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tabs = $('#settings .set-tabs');
  if (!tabs || $('#setSearch')) return;
  tabs.insertAdjacentHTML('afterend', '<div class="set-search"><input id="setSearch" type="search" placeholder="Rechercher un réglage…" autocomplete="off" spellcheck="false" data-nav aria-label="Rechercher un réglage" /><span class="dim" id="setSearchN"></span></div>');
  const input = $('#setSearch');
  const root = $('#settings');
  // Un seul conteneur défilant pendant la recherche (sinon chaque page a sa propre barre de défilement)
  const wrapEl = document.createElement('div');
  wrapEl.className = 'set-scroll';
  const pages = $$('#settings .set-page');
  pages[0].before(wrapEl);
  pages.forEach((p) => wrapEl.append(p));

  function apply() {
    const q = norm(input.value).trim();
    root.classList.toggle('searching', !!q);
    if (!q) { $$('#settings .sx-hide').forEach((e) => e.classList.remove('sx-hide')); $('#setSearchN').textContent = ''; renderSettings(); return; }
    const words = q.split(/\s+/);
    let hits = 0;
    $$('#settings .set-page').forEach((page) => {
      page.hidden = false;
      page.dataset.sxHits = '0';
      let group = null, groupTxt = "";
      for (const el of $$('.setting, .set-group, .set-sep, .set-intro, .set-note', page)) {
        if (el.matches('.set-group')) { group = el; groupTxt = norm(el.textContent); el.classList.add('sx-hide'); continue; }
        if (!el.matches('.setting')) { el.classList.add('sx-hide'); continue; }
        if (el.parentElement.closest('.setting')) continue; // réglage imbriqué : suit son parent
        const t = norm(el.textContent) + ' ' + groupTxt;
        const ok = words.every((w) => t.includes(w));
        el.classList.toggle('sx-hide', !ok);
        if (ok) { hits++; page.dataset.sxHits = String(+page.dataset.sxHits + 1); if (group) group.classList.remove('sx-hide'); }
      }
    });
    $$('#settings .set-page').forEach((page) => { page.hidden = page.dataset.sxHits === '0'; });
    wrapEl.scrollTop = 0;
    $('#setSearchN').textContent = hits ? `${hits} réglage${hits > 1 ? 's' : ''}` : 'Aucun résultat';
  }
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; apply(); } });
  const orig = window.renderSettings;
  if (typeof orig === 'function') window.renderSettings = function (...a) { const r = orig.apply(this, a); if (input.value) apply(); return r; };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-settab]') && input.value) { input.value = ''; apply(); renderSettings(); } });
})();

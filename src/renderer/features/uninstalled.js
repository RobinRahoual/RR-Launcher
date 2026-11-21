// Module UNINSTALLED (renderer) — écran « Jeux à installer » : jeux possédés sur Steam / Epic / GOG, pas encore installés.
// Menu → « Jeux à installer ». Processus principal : src/features/uninstalled.js (x:uninst:*).
(() => {
  'use strict';
  const NAMES = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', famille: 'Famille' };
  const ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  const U = { items: [], errors: {}, at: 0, store: 'all', q: '', loading: false };

  const ov = document.createElement('div');
  ov.id = 'uninst'; ov.className = 'overlay cap-gal'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'unTitle');
  ov.innerHTML = `
    <div class="cap-g-panel">
      <header class="cap-g-head">
        <h2 id="unTitle">Jeux à installer</h2><span class="cap-count" id="unCount"></span>
        <div class="cap-g-filters" role="group" aria-label="Filtres">
          <button class="tool" data-un-store="all" data-nav>Tout</button>
          <button class="tool" data-un-store="steam" data-nav>Steam</button>
          <button class="tool" data-un-store="epic" data-nav>Epic</button>
          <button class="tool" data-un-store="gog" data-nav>GOG</button>
          <input id="unQ" type="search" placeholder="Rechercher…" autocomplete="off" spellcheck="false" data-nav aria-label="Rechercher un jeu" />
        </div>
        <div class="cap-g-tools">
          <button class="tool" data-un="refresh" data-nav><span id="unRefLbl">Actualiser</span></button>
          <button class="tool" data-un="close" data-nav data-default aria-label="Fermer"><span>Fermer</span></button>
        </div>
      </header>
      <div class="cap-g-dir dim"><span id="unNote"></span> <button class="tool" data-un="steamLogin" data-nav id="unLogin" hidden>Connecter Steam (famille)</button></div>
      <div class="cap-g-scroll"><div class="un-grid" id="unGrid"></div></div>
    </div>`;
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  OVERLAYS.uninst = '#uninst';

  const filtered = () => {
    const q = (U.q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return U.items.filter((x) => (U.store === 'all' || x.store === U.store) && (!q || x.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q)));
  };
  function render() {
    const list = filtered();
    $$('[data-un-store]', ov).forEach((b) => b.classList.toggle('primary', b.dataset.unStore === U.store));
    $('#unCount').textContent = String(list.length);
    $('#unRefLbl').textContent = U.loading ? 'Actualisation…' : 'Actualiser';
    const errs = Object.entries(U.errors || {}).map(([k, v]) => `${NAMES[k] || k} : ${v}`);
    $('#unNote').textContent = errs.join(' · ');
    $('#unLogin').hidden = !U.needLogin;
    const grid = $('#unGrid');
    if (!list.length) { grid.innerHTML = `<p class="dim cap-g-empty">${U.loading ? 'Chargement de tes bibliothèques…' : U.items.length ? 'Aucun résultat.' : 'Aucun jeu à installer trouvé.'}</p>`; return; }
    grid.innerHTML = list.slice(0, 600).map((x) => `
      <button class="un-card" data-un-i="${esc(x.store)}|${esc(x.id)}" data-nav aria-label="Installer ${esc(x.name)} (${esc(NAMES[x.store])})">
        <span class="un-art"><img src="${esc(x.art || x.alt || '')}"${x.alt ? ` data-alt="${esc(x.alt)}"` : ''} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /><span class="un-letter">${esc((x.name[0] || '?').toUpperCase())}</span></span>
        <span class="un-name">${esc(x.name)}</span>
        <span class="un-sub"><i class="un-store un-${esc(x.store)}">${esc(x.family ? 'Steam · Famille' : NAMES[x.store])}</i>${ICO}Installer</span>
      </button>`).join('');
    $$('img', grid).forEach((im) => im.addEventListener('error', () => {
      if (im.dataset.alt && im.src !== im.dataset.alt) { im.src = im.dataset.alt; delete im.dataset.alt; im.closest('.un-art')?.classList.add('wide'); }
      else { im.remove(); }
    }));
  }
  async function load(refresh) {
    U.loading = !!refresh; render();
    const r = await rr.x(refresh ? 'x:uninst:refresh' : 'x:uninst:list').catch(() => null);
    U.loading = false;
    if (r) { U.items = r.items || []; U.errors = r.errors || {}; U.at = r.at || 0; U.needLogin = !!r.needLogin; }
    render();
    // premier affichage sans données : on synchronise
    if (!refresh && !U.at) load(true);
  }
  ov.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-un-i]');
    if (c) {
      const [st, id] = c.dataset.unI.split('|');
      const r = await rr.x('x:uninst:install', st, id);
      if (!r.ok) return toast(r.error, true);
      sfx('confirm');
      return toast(`Ouverture de ${r.label} pour installer ${r.name}…`, 'success');
    }
    const s = e.target.closest('[data-un-store]');
    if (s) { U.store = s.dataset.unStore; render(); return sfx('move'); }
    const a = e.target.closest('[data-un]')?.dataset.un;
    if (a === 'close') closeOverlay();
    else if (a === 'refresh') load(true);
    else if (a === 'steamLogin') { toast('Connecte-toi dans la fenêtre Steam qui s’ouvre', 'info'); const r = await rr.x('x:uninst:steamLogin'); if (r?.ok) { toast('Steam connecté', 'success'); load(false); } else if (!r?.cancelled) toast(r?.error || 'Connexion Steam impossible', true); }
  });
  $('#unQ').addEventListener('input', (e) => { U.q = e.target.value; render(); });
  RR.actions.uninstalled = async () => { closeAll(); U.store = 'all'; U.q = ''; $('#unQ').value = ''; openOverlay('uninst'); load(false); };

  const mi = $('#menu .panel [data-action="settings"]');
  if (mi && !$('#menu [data-action="uninstalled"]')) mi.insertAdjacentHTML('beforebegin', `<button class="menu-item" data-action="uninstalled" data-nav>${ICO}<span class="mi-label">Jeux à installer</span></button>`);
})();

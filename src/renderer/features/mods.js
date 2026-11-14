// Module MODS (renderer) — « Mods & patchs » sur la page du jeu. Côté main : src/features/mods.js (canaux x:mods:*).
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 18 9l-8 8H6.5v-3.5z"/><path d="M13 7l4 4M4 20h16"/></svg>';

  const ov = document.createElement('div');
  ov.className = 'overlay center'; ov.id = 'modsPanel'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'modsTitle');
  ov.innerHTML = '<div class="panel wide"></div>';
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });
  OVERLAYS.mods = '#modsPanel';

  const M = { g: null, v: null };
  $('#dActions .d-tools')?.insertAdjacentHTML('afterbegin', `<button class="tool" data-act="mods" data-nav>${ICO}<span>Mods &amp; patchs</span></button>`);
  $('#dActions').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="mods"]')) return;
    const g = S.items[S.sel];
    if (g) open(g);
  });
  wrap('renderDetails', (orig, ...a) => {
    orig(...a);
    const g = S.items[S.sel], b = $('[data-act="mods"]');
    if (b && g) b.hidden = !(g.kind === 'rom' || g.installDir || g.exePath);
  });

  async function open(g) {
    M.g = g;
    M.v = await rr.x('x:mods:list', g.id);
    render();
    openOverlay('mods');
  }
  function render(msg) {
    const v = M.v, g = M.g;
    if (!v?.ok) return;
    const rom = v.type === 'patch';
    const rows = v.list.map((m, i) => `
      <div class="setting"><div><strong>${esc(m.name)}</strong><span class="dim">${m.type === 'patch' ? 'Patch ROM' : `${m.count} fichier${m.count > 1 ? 's' : ''}`}</span></div>
        <div class="v119-row">
          <button class="btn small" data-md="up" data-id="${m.id}" ${i === 0 ? 'disabled' : ''} aria-label="Monter" data-nav>↑</button>
          <button class="btn small" data-md="down" data-id="${m.id}" ${i === v.list.length - 1 ? 'disabled' : ''} aria-label="Descendre" data-nav>↓</button>
          <button class="toggle" data-md="toggle" data-id="${m.id}" role="switch" aria-checked="${m.enabled}" aria-label="Activer ${esc(m.name)}" data-nav></button>
          <button class="btn small" data-md="remove" data-id="${m.id}" data-nav>Supprimer</button>
        </div></div>`).join('');
    $('.panel', ov).innerHTML = `
      <h2 id="modsTitle">Mods &amp; patchs</h2>
      <p class="panel-lead">${esc(g.name)}</p>
      <p class="dim">${rom
        ? 'Les patchs IPS / BPS / UPS sont appliqués sur une <b>copie</b> de la ROM (« … (patché) »), l’original n’est jamais modifié. L’ordre compte : ils sont appliqués de haut en bas.'
        : `Les fichiers du mod sont copiés dans <code>${esc(v.target || '')}</code> ; les fichiers qu’ils remplacent sont sauvegardés et remis en place à la désactivation. En cas de conflit, le mod le plus bas gagne.`}</p>
      ${v.running ? '<p class="dim"><b>Le jeu est en cours</b> : ferme-le pour activer ou désactiver un mod.</p>' : ''}
      ${msg ? `<p class="dim">${esc(msg)}</p>` : ''}
      <div class="elo-list">${rows || '<p class="dim">Aucun mod pour ce jeu.</p>'}</div>
      <div class="ew-foot">
        <button class="btn" data-md="folder" data-nav>Ouvrir le dossier</button>
        <button class="btn" data-md="close" data-nav>Fermer</button>
        <button class="btn primary" data-md="add" data-nav data-default>${rom ? 'Ajouter un patch…' : 'Ajouter un mod…'}</button>
      </div>`;
    setTimeout(() => { const d = $('[data-default]', ov); if (d && S.mode === 'mods') setFocus(d); }, 30);
  }
  const report = (r, okMsg) => {
    if (r?.ok === false) { if (r.error) toast(r.error, true); return false; }
    if (r?.errors?.length) { toast(r.errors[0], true); return true; }
    if (okMsg) toast(okMsg, 'success');
    return true;
  };
  ov.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-md]');
    if (!b) return;
    const k = b.dataset.md, id = b.dataset.id, gid = M.g.id;
    if (k === 'close') return closeOverlay();
    if (k === 'folder') return rr.x('x:mods:open', gid);
    let r;
    if (k === 'add') { r = await rr.x('x:mods:add', gid); if (r?.ok) { M.v = r; render(); report(r, 'Ajouté'); } else report(r); return; }
    if (k === 'toggle') r = await rr.x('x:mods:toggle', gid, id, b.getAttribute('aria-checked') !== 'true');
    else if (k === 'up' || k === 'down') r = await rr.x('x:mods:move', gid, id, k === 'up' ? -1 : 1);
    else if (k === 'remove') {
      const m = M.v.list.find((x) => x.id === id);
      r = await rr.x('x:mods:remove', gid, id);
      if (r?.ok) toast(`« ${m?.name} » supprimé`, 'success');
    }
    if (r?.ok) { M.v = r; render(); report(r); sfx('toggle'); } else report(r);
  });
})();

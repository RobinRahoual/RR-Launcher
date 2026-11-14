// Module STREAM (renderer) — streaming vers un autre écran (Sunshine + Moonlight). Côté main : src/features/stream.js (x:stream:*).
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.createElement('div');
  box.id = 'set-stream';
  $('#set-v119').append(box);
  let st = null;

  async function refresh() { st = await rr.x('x:stream:status').catch(() => null); draw(); }
  function draw() {
    if (!st) { box.innerHTML = ''; return; }
    const sun = st.sunshine, moon = st.moonlight, games = (S.lib?.games || []).filter((g) => !g.hidden).sort((a, b) => a.name.localeCompare(b.name));
    box.innerHTML = `
      <h3 class="set-group">Streaming vers un autre écran</h3>
      <p class="set-note">Diffuse ton PC vers une TV, un Steam Deck, un téléphone ou un autre PC avec <b>Sunshine</b> (ici) et <b>Moonlight</b> (sur l'écran qui reçoit).</p>
      <div class="setting"><div><strong>Sunshine ${sun.installed ? (sun.running ? '— actif' : '— installé') : '— non installé'}</strong><span class="dim">${sun.installed ? 'Premier appairage : ouvre l’interface, crée l’identifiant, puis saisis dans Moonlight le code PIN.' : 'Serveur de streaming gratuit (LizardByte).'}</span></div>
        <span class="set-btns">${sun.installed ? `<button class="btn" data-st="start" data-nav>${sun.running ? 'Interface' : 'Démarrer'}</button>` : '<button class="btn" data-st="install" data-nav>Télécharger</button>'}</span></div>
      ${st.addresses.length ? `<div class="setting"><div><strong>Adresse à saisir dans Moonlight</strong><span class="dim">${st.addresses.map((a) => `<code>${esc(a.address)}</code> (${esc(a.name)})`).join(' · ')}</span></div></div>` : ''}
      ${sun.installed ? `<div class="setting"><div><strong>Applications Sunshine</strong><span class="dim">${st.registered.length ? esc(st.registered.join(', ')) : 'Aucune. Ajoute « RR Launcher » : tu choisis ensuite le jeu depuis Moonlight.'}</span></div>
        <span class="set-btns"><button class="btn" data-st="reg" data-nav>Ajouter RR Launcher</button></span></div>
      <div class="setting"><div><strong>Ajouter un jeu précis</strong><span class="dim">Il apparaît comme une application dans Moonlight et se lance tout seul.</span></div>
        <span class="set-btns"><select id="stGame" data-nav>${games.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select><button class="btn" data-st="regGame" data-nav>Ajouter</button></span></div>` : ''}
      <div class="setting"><div><strong>Moonlight ${moon.installed ? '— installé' : '— non installé'}</strong><span class="dim">Pour recevoir le flux d’un autre PC sur celui-ci.</span></div>
        <span class="set-btns"><button class="btn" data-st="moon" data-nav>${moon.installed ? 'Ouvrir' : 'Télécharger'}</button></span></div>
      <div id="stManual" class="set-note" hidden></div>`;
  }
  async function reg(id) {
    const r = await rr.x('x:stream:register', id).catch((e) => ({ ok: false, error: e.message }));
    if (r.ok) { toast(`« ${r.name} » ${r.added ? 'ajouté' : 'mis à jour'}${r.restarted ? ' — Sunshine redémarré' : ' — redémarre Sunshine pour l’afficher'}`, 'success'); refresh(); return; }
    toast(r.error, true);
    if (r.manual) { const m = $('#stManual'); m.hidden = false; m.innerHTML = `Dans Sunshine (Applications → Ajouter) : nom <code>${esc(r.manual.name)}</code>, commande <code>${esc(r.manual.cmd)}</code>, dossier <code>${esc(r.manual.dir)}</code>.`; }
  }
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.dataset.st;
    if (k === 'install') rr.x('x:stream:install');
    else if (k === 'start') { b.disabled = true; toast('Démarrage de Sunshine…', 'progress'); const r = await rr.x('x:stream:start'); b.disabled = false; if (r.ok === false) toast(r.error, true); else { rr.x('x:stream:openUi'); st = r; draw(); } }
    else if (k === 'reg') reg(null);
    else if (k === 'regGame') reg($('#stGame').value);
    else if (k === 'moon') { const r = await rr.x('x:stream:moonlight', {}); if (r.ok === false) toast(r.error, 'error'); }
  });
  refresh();
  document.addEventListener('settings:open', refresh);
})();

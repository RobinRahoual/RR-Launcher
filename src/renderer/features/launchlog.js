// Module LAUNCHLOG (renderer) — journal de lancement dans Réglages → Plus. Côté main : src/features/launchlog.js.
(() => {
  'use strict';
  const box = document.createElement('div');
  box.id = 'set-launchlog';
  $('#set-v119').append(box);
  box.innerHTML = `
    <h3 class="set-group">Journal de lancement</h3>
    <div class="setting col">
      <div><strong>Derniers lancements</strong><span class="dim">Commande exacte, erreurs et code de sortie : utile quand un émulateur plante ou ne démarre pas.</span></div>
      <div class="v119-row"><button class="btn" id="llRefresh" data-nav>Actualiser</button><button class="btn" id="llExport" data-nav>Exporter…</button><button class="btn" id="llClear" data-nav>Vider</button></div>
      <div class="v119-list" id="llList"></div>
    </div>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LABEL = { ok: ['OK', 'ok'], running: ['en cours', ''], error: ['échec', 'ko'], crash: ['plantage ?', 'ko'] };
  async function refresh() {
    const list = await rr.x('x:launchlog:list', 40);
    $('#llList').innerHTML = list.length ? list.map((e) => {
      const [txt, cls] = LABEL[e.status] || ['', ''];
      const when = new Date(e.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const detail = e.error ? e.error : e.exit ? `code ${e.exit.code ?? '—'}${e.exit.signal ? ' / ' + e.exit.signal : ''}${e.seconds != null ? ' · ' + e.seconds + ' s' : ''}` : '';
      return `<div class="v119-item" title="${esc(e.commandLine)}"><span class="${cls}">${txt}</span><span><b>${esc(e.name || e.id)}</b> <code>${esc(detail || e.commandLine)}</code></span><span class="dim">${when}</span></div>`;
    }).join('') : '<p class="dim">Aucun lancement enregistré.</p>';
  }
  $('#llRefresh').addEventListener('click', refresh);
  $('#llClear').addEventListener('click', async () => { await rr.x('x:launchlog:clear'); refresh(); toast('Journal vidé', 'success'); });
  $('#llExport').addEventListener('click', async () => { const r = await rr.x('x:launchlog:export'); if (r?.ok) toast('Journal exporté', 'success'); });
  RR.on('mode', (m) => { if (m === 'settings') refresh(); });
  RR.on('session', refresh);
})();

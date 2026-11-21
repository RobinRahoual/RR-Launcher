// Module GAMEACTIONS (renderer) — « Mettre à jour » / « Désinstaller » sur la page du jeu + onglet « À mettre à jour ».
// Détection des mises à jour : features/extras.js (RRExtras.X.upd). Côté main : src/features/gameactions.js (x:gameact:*).
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const ICO_UP = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>';
  const ICO_DEL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>';
  const upd = () => window.RRExtras?.X?.upd || {};

  const tools = $('#dActions .d-tools');
  tools?.insertAdjacentHTML('beforeend', `<button class="tool" data-act="gUpdate" data-nav hidden>${ICO_UP}<span id="gUpdateLbl">Mettre à jour</span></button><button class="tool danger" data-act="gUninstall" data-nav hidden>${ICO_DEL}<span>Désinstaller</span></button>`);

  let caps = { id: null };
  async function paint() {
    const g = S.items[S.sel];
    const bu = $('[data-act="gUpdate"]'), bd = $('[data-act="gUninstall"]');
    if (!bu || !bd) return;
    if (!g) { bu.hidden = bd.hidden = true; return; }
    if (caps.id !== g.id) { const id = g.id; const c = await rr.x('x:gameact:caps', id).catch(() => null); if (S.items[S.sel]?.id !== id) return; caps = { id, ...(c || {}) }; }
    const u = upd()[g.id];
    bu.hidden = !caps.update;
    bd.hidden = !caps.uninstall;
    const lbl = $('#gUpdateLbl');
    if (lbl) lbl.textContent = u?.state === 'downloading' ? (u.pct != null ? `Téléchargement ${u.pct} %` : 'Mise à jour en cours…') : u ? 'Mettre à jour' : 'Vérifier les mises à jour';
    bu.classList.toggle('primary', !!u && u.state !== 'downloading');
  }
  wrap('renderDetails', (orig, ...a) => { orig(...a); caps = { id: null }; paint(); });
  setInterval(() => { if (S.mode === 'details') paint(); }, 4000);

  $('#dActions').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="gUpdate"], [data-act="gUninstall"]');
    if (!b) return;
    const g = S.items[S.sel];
    if (!g) return;
    if (b.dataset.act === 'gUpdate') {
      const r = await rr.x('x:gameact:update', g.id);
      if (!r.ok) return toast(r.error, true);
      toast(r.note || `Mise à jour demandée à ${r.label}`, r.note ? 'info' : 'success');
    } else {
      openPrompt({
        title: `Désinstaller « ${g.name} » ?`, icon: 'danger', tone: 'danger',
        body: `<p class="dim">${caps.uninstall?.via === 'steam' ? 'Steam te demandera de confirmer, puis supprimera les fichiers du jeu.' : caps.uninstall?.via === 'epic' ? 'La bibliothèque Epic s’ouvre : choisis « Désinstaller » sur le jeu.' : 'Le désinstalleur du jeu va se lancer.'} Tes sauvegardes dans le cloud ne sont pas touchées. Le jeu reste dans le launcher (« Retirer du launcher » pour l’enlever).</p>`,
        actions: [
          { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
          { label: 'Désinstaller', danger: true, primary: true, onClick: async () => {
            closeOverlay();
            const r = await rr.x('x:gameact:uninstall', g.id);
            toast(r.ok ? (r.note || `Désinstallation lancée (${r.label})`) : r.error, r.ok ? (r.note ? 'info' : 'success') : true);
          } },
        ],
      });
    }
  });

  // ---- Onglet « À mettre à jour » sur l'écran des jeux
  const pending = () => S.lib.games.filter((g) => upd()[g.id]);
  wrap('computeTabs', (orig) => {
    const want = S.tab;
    orig();
    const n = inPlat(pending()).length;
    if (n) {
      let at = S.tabs.findIndex((t) => t.id === 'recent'); if (at < 0) at = 0;
      S.tabs.splice(at + 1, 0, { id: 'upd', label: 'À mettre à jour', n });
    }
    if (S.tab === 'all' && want === 'upd' && S.tabs.some((t) => t.id === 'upd')) S.tab = 'upd';
  });
  wrap('computeItems', (orig) => {
    orig();
    if (S.tab === 'upd') S.items = sorted(inPlat(pending()));
  });
  let sig = '';
  setInterval(() => {
    const k = Object.keys(upd()).sort().join(',');
    if (k !== sig) { sig = k; if (typeof refresh === 'function' && S.lib && S.mode === 'main') refresh(); }
  }, 5000);
})();

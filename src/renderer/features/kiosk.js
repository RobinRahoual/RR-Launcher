// Module KIOSK (renderer) — mode Kiosque / TV : actif tout seul dès qu'une manette est connectée.
// Côté main : src/features/kiosk.js (canaux x:kiosk:*). Classe « kiosk » sur <html> : curseur masqué (réapparaît
// quand la souris bouge), boutons de fenêtre cachés, interface agrandie.
(() => {
  'use strict';
  const root = $('#set-v119');
  const box = document.createElement('div');
  box.id = 'set-kiosk';
  root.append(box);
  box.innerHTML = `
    <h3 class="set-group">Mode Kiosque / TV</h3>
    <div class="setting">
      <div><strong id="lbKiosk">Mode Kiosque</strong><span class="dim">Plein écran, curseur masqué et interface agrandie pour jouer au canapé. « Auto » s'active dès qu'une manette est connectée et s'éteint quand elle est débranchée.</span></div>
      <div class="seg" data-kiosk-seg role="group" aria-labelledby="lbKiosk">
        <button data-value="auto" data-nav>Auto</button><button data-value="on" data-nav>Toujours</button><button data-value="off" data-nav>Jamais</button>
      </div>
    </div>`;
  const syncSeg = (mode) => $$('[data-kiosk-seg] button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === mode)));
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kiosk-seg] button');
    if (!b) return;
    const r = await rr.x('x:kiosk:mode', b.dataset.value);
    syncSeg(r.mode); apply(r.active); sfx('toggle');
  });

  // ---- Application visuelle
  let on = false, idle = null;
  function scale() {
    if (!on) return;
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
    if (!document.documentElement.dataset.kioskBase) document.documentElement.dataset.kioskBase = String(cur);
    document.documentElement.style.setProperty('--ui', (Number(document.documentElement.dataset.kioskBase) * 1.15).toFixed(3));
  }
  function apply(active) {
    if (active === on) return;
    on = !!active;
    const h = document.documentElement;
    h.classList.toggle('kiosk', on);
    if (on) { scale(); }
    else {
      delete h.dataset.kioskBase;
      if (typeof uiScale === 'function') uiScale();
    }
    toast(on ? 'Mode Kiosque activé' : 'Mode Kiosque désactivé', 'info');
  }
  addEventListener('resize', () => { if (on) { delete document.documentElement.dataset.kioskBase; if (typeof uiScale === 'function') uiScale(); scale(); } });
  addEventListener('mousemove', () => {
    if (!on) return;
    document.documentElement.classList.add('kiosk-mouse');
    clearTimeout(idle);
    idle = setTimeout(() => document.documentElement.classList.remove('kiosk-mouse'), 3000);
  });
  rr.onX('x:kiosk:state', (st) => { syncSeg(st.mode); apply(st.active); });

  // ---- Comptage des manettes (API Gamepad) → main décide (en plus de la lecture native du main)
  let last = -1, timer = null;
  const count = () => [...(navigator.getGamepads?.() || [])].filter((g) => g && g.connected).length;
  async function report() {
    const n = count();
    if (n === last) return;
    last = n;
    const r = await rr.x('x:kiosk:pads', n);
    syncSeg(r.mode); apply(r.active);
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(report, 800); };
  addEventListener('gamepadconnected', soon);
  addEventListener('gamepaddisconnected', soon);
  rr.x('x:kiosk:get').then((st) => { syncSeg(st.mode); apply(st.active); report(); });
})();

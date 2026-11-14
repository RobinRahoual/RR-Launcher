// KIOSK — mode Kiosque / TV : s'active tout seul quand une manette est connectée à l'ordinateur.
// Le renderer compte les manettes (API Gamepad + lecture native) et appelle x:kiosk:pads ; ici on décide
// (logique pure, testable) puis on passe la fenêtre en plein écran et on prévient le renderer, qui applique
// la classe « kiosk » (curseur masqué, boutons de fenêtre cachés, interface agrandie).
// Réglage : settings.kioskMode = 'auto' (défaut) | 'on' | 'off'. En quittant le mode, le plein écran d'origine est rétabli.
'use strict';

const MODES = ['auto', 'on', 'off'];
const normMode = (m) => (MODES.includes(m) ? m : 'auto');

/**
 * decide({ mode, pads, active, forcedFullscreen, fullscreen })
 *  → { active, setFullscreen: true|false|null, forcedFullscreen }
 * setFullscreen : valeur à appliquer à la fenêtre (null = ne rien changer).
 */
function decide({ mode = 'auto', pads = 0, active = false, forcedFullscreen = false, fullscreen = false } = {}) {
  mode = normMode(mode);
  const want = mode === 'on' || (mode === 'auto' && Number(pads) > 0);
  if (want && !active) {
    return { active: true, setFullscreen: fullscreen ? null : true, forcedFullscreen: !fullscreen };
  }
  if (!want && active) {
    // On ne rétablit le fenêtré que si c'est le mode kiosque qui avait forcé le plein écran
    return { active: false, setFullscreen: forcedFullscreen ? false : null, forcedFullscreen: false };
  }
  return { active: want, setFullscreen: null, forcedFullscreen };
}

function init(ctx) {
  const { ipcMain, store, send, getWin, log } = ctx;
  const S = () => store.data.settings;
  if (!MODES.includes(S().kioskMode)) S().kioskMode = 'auto';
  let active = false, forced = false, pads = 0, nativePads = 0;

  function apply() {
    const win = getWin();
    const r = decide({ mode: S().kioskMode, pads: Math.max(pads, nativePads), active, forcedFullscreen: forced, fullscreen: !!win?.isFullScreen?.() });
    active = r.active; forced = r.forcedFullscreen;
    if (r.setFullscreen !== null && win && !win.isDestroyed()) {
      win.setFullScreen(r.setFullscreen);
      log(`kiosque : ${active ? 'activé' : 'désactivé'} (plein écran ${r.setFullscreen})`);
    }
    send('x:kiosk:state', { active, mode: S().kioskMode });
    return { active, mode: S().kioskMode };
  }
  // Lecture native (XInput / HID) : voit les manettes que Chromium ne montre qu'après un premier appui
  const poll = setInterval(() => {
    let n = 0;
    try { n = ctx.padCount?.() || 0; } catch {}
    if (n !== nativePads) { nativePads = n; apply(); }
  }, 2000);
  poll.unref?.();
  ipcMain.handle('x:kiosk:pads', (_e, n) => { pads = Math.max(0, Math.min(16, Number(n) || 0)); return apply(); });
  ipcMain.handle('x:kiosk:get', () => ({ active, mode: S().kioskMode, pads }));
  ipcMain.handle('x:kiosk:mode', (_e, mode) => {
    S().kioskMode = normMode(mode);
    ctx.commit();
    return apply();
  });
}

module.exports = { init, decide, normMode, MODES };

// Module polish — finitions : sons selon le support, vibrations, notifications façon console, taille de l'interface.
// Voir RR dans app.js (bus d'évènements) et sounds.js (Sfx).

// ---------------------------------------------------------------- Sons : boîte disque ou cartouche
// BOXOPEN joue sfx('boxopen') ; on choisit la variante selon le support du jeu (même test que boMediaKind).
const polishSfxPlay = Sfx.play;
Sfx.play = (name) => {
  if (name === 'boxopen') {
    const g = S.items?.[S.sel];
    name = g && boMediaKind(g).type === 'cart' ? 'boxopen-cart' : 'boxopen-disc';
  }
  return polishSfxPlay(name);
};

// ---------------------------------------------------------------- Vibrations de la manette
let lastBuzz = 0, lastA = 0;
function buzz(ms, strong = 0.25, weak = 0.4) {
  if (S.lib.settings?.vibration === false) return;
  try {
    const pad = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected && g.vibrationActuator);
    if (!pad) return;
    lastBuzz = performance.now();
    pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  } catch { /* pas de vibration sur ce périphérique */ }
}
RR.on('input', (src, btn) => {
  if (src === 'pad' && btn === 'a') { lastA = performance.now(); buzz(60); }
});
// Ouverture d'un jeu sans passer par A (souris, clic) : petite vibration, sauf si A vient de la déclencher
RR.on('mode', (m) => {
  if (m === 'details' && performance.now() - lastA > 400) buzz(60);
});
RR.on('play', () => buzz(150, 0.6, 0.8));

// ---------------------------------------------------------------- Notifications façon console (haut à droite)
const PN_ICON = {
  pad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7h11A4.5 4.5 0 0 1 22 11.5v.5a4.5 4.5 0 0 1-7.3 3.5L12 14l-2.7 1.5A4.5 4.5 0 0 1 2 12v-.5A4.5 4.5 0 0 1 6.5 7Z"/><path d="M6 10v3M4.5 11.5h3M15.5 11h.01M17.5 12.5h.01"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7h11A4.5 4.5 0 0 1 22 11.5v.5a4.5 4.5 0 0 1-7.3 3.5L12 14l-2.7 1.5A4.5 4.5 0 0 1 2 12v-.5A4.5 4.5 0 0 1 6.5 7Z"/><path d="M4 4l16 16"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
};
let pnStack = null, gamesCount = null;
function note(title, icon = 'pad', sub = '') {
  if (!pnStack) {
    pnStack = document.createElement('div');
    pnStack.className = 'pn-stack';
    pnStack.setAttribute('role', 'status');
    pnStack.setAttribute('aria-live', 'polite');
    document.body.append(pnStack);
  }
  const card = document.createElement('div');
  card.className = 'pn-card';
  card.innerHTML = `<span class="pn-ico">${PN_ICON[icon]}</span><span class="pn-txt"><strong></strong><small></small></span>`;
  $('strong', card).textContent = title;
  $('small', card).textContent = sub;
  if (!sub) $('small', card).remove();
  pnStack.append(card);
  while (pnStack.children.length > 3) pnStack.firstElementChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('in')));
  setTimeout(() => {
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => card.remove(), 320);
  }, 3000);
}
// Nom simplifié du contrôleur
const padName = (id = '') => (/xbox|xinput/i.test(id) ? 'Xbox' : /playstation|dualshock|dualsense|054c/i.test(id) ? 'PlayStation' : 'Manette');
addEventListener('gamepadconnected', (e) => note('Manette connectée', 'pad', padName(e.gamepad?.id)));
addEventListener('gamepaddisconnected', (e) => note('Manette déconnectée', 'off', padName(e.gamepad?.id)));
RR.on('library', (st) => {
  const games = st.games || [];
  if (gamesCount !== null && games.length > gamesCount) {
    const last = games.reduce((a, b) => ((b.addedAt || 0) > (a.addedAt || 0) ? b : a));
    note('Jeu ajouté', 'add', last.name || '');
  }
  gamesCount = games.length;
});

// ---------------------------------------------------------------- Taille de l'interface (TV à distance)
// Zoom global : au-delà de 1.2, les zones dimensionnées en vh (barre du bas, légende) débordent sur 1280×720
const UI_ZOOM = { normal: 1, large: 1.1, xl: 1.15 };
let uiApplied = null;
function applyUiSize(v) {
  const key = UI_ZOOM[v] ? v : 'normal';
  if (key === uiApplied) return;
  uiApplied = key;
  document.documentElement.style.zoom = UI_ZOOM[key] === 1 ? '' : String(UI_ZOOM[key]);
  measure(); // les boîtes sont mesurées en px CSS : à refaire après le zoom
  refresh();
}

// ---------------------------------------------------------------- Réglages « Confort » (onglet Fonctions)
$('#set-polish').innerHTML = `
  <h3 class="set-group">Confort</h3>
  <div class="setting">
    <div><strong id="lbPadVib">Vibrations de la manette</strong><span class="dim">Validation, ouverture et lancement d’un jeu</span></div>
    <button class="toggle" data-toggle="vibration" role="switch" aria-labelledby="lbPadVib" data-nav></button>
  </div>
  <div class="setting">
    <div><strong id="lbUiSize">Taille de l’interface</strong><span class="dim">Pour jouer sur une TV à 3 m</span></div>
    <div class="seg" data-setting="uiSize" role="group" aria-labelledby="lbUiSize">
      <button data-value="normal" data-nav>Normale</button><button data-value="large" data-nav>Grande</button><button data-value="xl" data-nav>Très grande</button>
    </div>
  </div>`;

// Valeurs par défaut écrites une fois (les interrupteurs affichent « coché » seulement si la clé est vraie)
function applyPolishState(st) {
  const s = st.settings || {};
  if (s.vibration === undefined) rr.setSettings({ vibration: true });
  if (s.uiSize === undefined) rr.setSettings({ uiSize: 'normal' });
  applyUiSize(s.uiSize);
}
RR.on('library', applyPolishState);
// Le premier état peut arriver avant l'abonnement ci-dessus : on le relit une fois (base de comptage des jeux comprise)
rr.getLibrary().then((st) => {
  if (gamesCount === null) gamesCount = (st.games || []).length;
  applyPolishState(st);
});

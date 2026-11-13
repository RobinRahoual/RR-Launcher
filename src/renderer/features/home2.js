// Module HOME2 — « Continuer » (accueil), Multijoueur local (onglet, manettes, marquage manuel), accent qui suit le jeu.
// Accroches : wrap() des globales d'app.js (computeHome, tileHTML, homeArt, homeName, homeLogoHTML, openHomeItem,
// updateHomeChrome, frameHome, syncCards, computeTabs, computeItems, renderCapBadges, renderDetails, renderSettings),
// bus RR ('selection', 'library', 'session'). Données : g.localCoop (manuel), g.categories / g.localMulti (métadonnées).
// Réglages : homeContinue (défaut oui), homeAccent ('game' défaut | 'fixed'). IPC : x:home2:coop.
(() => {
  'use strict';
  const OPT = (k, d = true) => S.lib.settings?.[k] ?? d;
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const gameById = (id) => S.lib.games.find((g) => g.id === id);
  const EXT = 0.8; // la grande tuile mesure 1 + EXT fois une tuile console (garder en phase avec --cont-ext du CSS)
  S.platLogo.continue = null; // pas de logo de console à télécharger pour « continue »

  // ================================================================ 1. Continuer
  const cont = { gid: null, had: false, seen: false };
  const isRunning = (g) => !!g && S.lib.running.includes(g.id);
  function contGame() {
    if (!OPT('homeContinue')) return null;
    const run = (S.lib.running || []).map(gameById).filter(Boolean).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
    if (run) return run;
    return S.lib.games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }
  function ago(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'à l’instant';
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.round(h / 24);
    if (d < 14) return `il y a ${d} j`;
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  wrap('computeHome', (orig) => {
    const prev = S.home.selId;
    orig();
    const g = contGame();
    if (g !== null && g !== undefined) {
      S.home.items.unshift({ id: 'continue', n: 1, fav: 0, gid: g.id });
      if (!cont.had) S.home.pos += 1;
      const want = !cont.seen || !prev || prev === 'continue' ? 'continue' : prev; // 1re apparition = sélection par défaut
      cont.seen = true;
      const i = S.home.items.findIndex((x) => x.id === want);
      S.home.sel = i >= 0 ? i : 0;
      S.home.selId = S.home.items[S.home.sel].id;
    } else if (cont.had) S.home.pos -= 1;
    if (cont.gid !== (g?.id || null) || cont.run !== isRunning(g)) { const b = $('#homeLogo'); if (b) b._sig = null; }
    cont.gid = g?.id || null; cont.run = isRunning(g); cont.had = !!g;
  });
  const cur = () => (cont.gid ? gameById(cont.gid) : null);
  wrap('homeArt', (orig, id) => {
    if (id !== 'continue') return orig(id);
    const g = cur();
    const bg = g ? (typeof bannerOf === 'function' ? bannerOf(g) : '') : '';
    return { bg, gid: g?.id || null, tid: g?.id || null, tile: g ? `${g.id}|${g.lastPlayed}|${isRunning(g)}|${g.mediaVersion || 0}|${g.media?.cover || ''}` : '' };
  });
  wrap('homeName', (orig, id) => (id === 'continue' ? `Continuer : ${cur()?.name || ''}` : orig(id)));
  wrap('tileHTML', (orig, it) => {
    if (it.id !== 'continue') return orig(it);
    const g = cur();
    if (!g) return '<div class="t-in t-cont"></div>';
    const m = g.media || {};
    const ban = typeof bannerOf === 'function' ? bannerOf(g) : '';
    const run = isRunning(g);
    return `<div class="t-in t-cont">${ban ? `<img class="t-art" src="${ban}" alt="" decoding="async" />` : ''}<div class="c-shade"></div>`
      + (m.cover ? `<img class="c-cover" src="${mediaUrl(g, m.cover)}" alt="" decoding="async" />` : '')
      + `<div class="c-txt"><span class="c-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l12-7.4c.6-.4.6-1.4 0-1.8l-12-7.4C7.9 3.3 7 3.8 7 4.6z"/></svg>Continuer</span>`
      + `<b class="c-name">${esc(g.name)}</b>`
      + (run ? `<span class="c-sub is-run"><i class="c-dot"></i>En cours — Reprendre</span>` : `<span class="c-sub" data-ts="${g.lastPlayed}">${esc(ago(g.lastPlayed))}</span>`)
      + `</div></div>`;
  });
  wrap('syncCards', (orig, ...a) => {
    orig(...a);
    const el = cards.get('continue');
    const g = cur();
    if (el && g) el.setAttribute('aria-label', `Continuer : ${g.name}, ${isRunning(g) ? 'en cours, reprendre' : ago(g.lastPlayed)}`);
  });
  setInterval(() => { for (const s of $$('.c-sub[data-ts]')) s.textContent = ago(+s.dataset.ts); }, 30000);
  wrap('homeLogoHTML', (orig, id) => {
    if (id !== 'continue') return orig(id);
    const g = cur();
    if (!g) return '';
    if (g.media?.logo) return `<img class="h-logo-img" crossorigin="anonymous" src="${mediaUrl(g, g.media.logo)}" alt="${esc(g.name)}" />`;
    const lines = [];
    for (const w of g.name.split(/\s+/)) { const l = lines.length - 1; if (l >= 0 && (lines[l] + ' ' + w).length <= 8) lines[l] += ' ' + w; else lines.push(w); }
    const fit = Math.min(1, 4.4 / Math.max(3, ...lines.map((x) => x.length)), 1.7 / lines.length);
    return `<div class="h-brand"><span class="h-maker">Continuer</span><span class="h-name" style="--fit:${fit.toFixed(2)}">${lines.slice(0, 4).map(esc).join('<br>')}</span></div>`;
  });
  wrap('openHomeItem', (orig) => {
    const it = S.home.items[S.home.sel];
    if (it?.id === 'continue') { const g = cur(); if (g) { sfx('open'); return play(g.id); } }
    return orig();
  });
  wrap('updateHomeChrome', (orig, ...a) => {
    orig(...a);
    const it = S.home.items[S.home.sel];
    if (it?.id === 'continue' && cur()) setFootInfo(`${cur().name.toUpperCase()} · ${plat(cur().platform).name.toUpperCase()}`);
  });
  // Disposition : la grande tuile (index 0) prend plus de place ; les autres sont décalées. Même ressort / même boucle que l'original.
  wrap('frameHome', (orig, ...a) => {
    orig(...a);
    const items = S.home.items, n = items.length, cEl = cards.get('continue');
    if (!cEl || items[0]?.id !== 'continue') return;
    const other = [...cards.values()].find((e) => e !== cEl);
    const T = (other || cEl).offsetWidth;
    if (!T) return;
    const pitch = T * 1.163, E = T * EXT + T * 0.08, W = T * (1 + EXT);
    const cen = (i) => (i === 0 ? (T + E) / 2 : i * pitch + E + T / 2);
    const tot = n * pitch + E, P = S.home.pos;
    let C;
    if (n >= HOME_WRAP) {
      const k = Math.floor(P / n), q = P - k * n, i0 = Math.floor(q), f = q - i0;
      const nx = i0 + 1 >= n ? tot + cen(0) : cen(i0 + 1);
      C = k * tot + cen(i0) + f * (nx - cen(i0));
    } else if (P < 0) C = cen(0) + P * pitch;
    else if (P > n - 1) C = cen(n - 1) + (P - (n - 1)) * pitch;
    else { const i0 = Math.floor(P); C = cen(i0) + (P - i0) * ((i0 + 1 < n ? cen(i0 + 1) : cen(i0)) - cen(i0)); }
    const anchor = innerWidth * 0.226;
    items.forEach((it, i) => {
      const el = cards.get(it.id);
      if (!el) return;
      let rel = cen(i) - C;
      if (n >= HOME_WRAP) rel = ((rel + tot / 2) % tot + tot) % tot - tot / 2;
      const w = i === 0 ? W : T, x = anchor + rel - w / 2;
      if (!(x > -w * 1.3 && x < innerWidth + T * 0.3)) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; return; }
      el.style.visibility = '';
      el.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    });
  });

  // ================================================================ 2. Multijoueur local
  const COOP_RE = /shared\/split|split.?screen|local (co-?op|multi)|écran (partagé|divisé)/i;
  const autoCoop = (g) => g.localMulti === true || (Array.isArray(g.categories) && g.categories.some((c) => COOP_RE.test(c)));
  const isCoop = (g) => (typeof g.localCoop === 'boolean' ? g.localCoop : autoCoop(g));
  const NEED = 2;
  const padCount = () => [...(navigator.getGamepads?.() || [])].filter((p) => p && p.connected).length;
  wrap('computeTabs', (orig, ...a) => {
    const want = S.tab;
    orig(...a);
    const n = inPlat(S.lib.games).filter(isCoop).length;
    if (n) {
      let at = 0;
      S.tabs.forEach((t, i) => { if (['all', 'fav', 'recent', 'lb'].includes(t.id) || /^l[sc]:/.test(t.id)) at = i + 1; });
      S.tabs.splice(at, 0, { id: 'lm', label: 'Multijoueur local', n });
    }
    if (S.tab === 'all' && want === 'lm' && n) S.tab = 'lm';
  });
  wrap('computeItems', (orig, ...a) => {
    orig(...a);
    if (S.tab === 'lm') S.items = sorted(inPlat(S.lib.games).filter(isCoop));
  });
  const ICO_PADS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M3 20c0-3.3 2.4-5.5 5.5-5.5S14 16.7 14 20M10.5 14.9c.6-.3 1.3-.4 2-.4 3.1 0 5.5 2.2 5.5 5.5"/></svg>';
  const ICO_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const coopBadge = (g) => {
    const ok = padCount() >= NEED;
    return `<span class="badge coop${ok ? ' is-ok' : ''}" title="${ok ? 'Assez de manettes connectées' : `Multijoueur local : ${NEED} manettes recommandées`}">${ICO_PADS}${NEED} joueurs${ok ? ICO_CHECK : ''}</span>`;
  };
  wrap('renderCapBadges', (orig, g, ...a) => {
    orig(g, ...a);
    if (g && isCoop(g)) $('#capBadges')?.insertAdjacentHTML('beforeend', coopBadge(g));
  });
  // Page du jeu : étiquette + bouton de marquage manuel
  const toolBtn = document.createElement('button');
  toolBtn.className = 'tool'; toolBtn.dataset.act = 'h2coop'; toolBtn.dataset.nav = ''; toolBtn.setAttribute('aria-pressed', 'false');
  toolBtn.innerHTML = `${ICO_PADS}<span>Multi local</span>`;
  const danger = $('#dActions .tool.danger');
  if (danger) danger.before(toolBtn); else $('#dActions .d-tools')?.append(toolBtn);
  function syncDetails() {
    const g = S.items[S.sel] || gameById(S.selId);
    if (!g) return;
    const on = isCoop(g);
    toolBtn.setAttribute('aria-pressed', String(on));
    toolBtn.title = on ? 'Retirer de « Multijoueur local »' : 'Marquer comme jeu multijoueur local (même écran, plusieurs manettes)';
    const tags = $('#dTags');
    if (tags && !$('.tag-coop', tags) && on) tags.insertAdjacentHTML('beforeend', `<span class="tag-coop">${NEED} joueurs${padCount() >= NEED ? ' ✓' : ''}</span>`);
  }
  wrap('renderDetails', (orig, ...a) => { orig(...a); syncDetails(); });
  $('#dActions').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="h2coop"]')) return;
    const g = S.items[S.sel] || gameById(S.selId);
    if (!g) return;
    const want = !isCoop(g);
    await rr.x('x:home2:coop', { id: g.id, value: want === autoCoop(g) ? null : want }).catch(() => null);
    sfx('toggle');
    toast(want ? 'Ajouté à « Multijoueur local »' : 'Retiré de « Multijoueur local »', 'success');
  });
  // Barre du haut : nombre de manettes (à partir de 2)
  const padEl = document.createElement('span');
  padEl.id = 'h2Pads'; padEl.className = 'pad-ind h2-pads'; padEl.setAttribute('role', 'img'); padEl.hidden = true;
  $('#padInd')?.after(padEl);
  let lastN = -1;
  function syncPads() {
    const n = padCount();
    if (n === lastN) return;
    lastN = n;
    padEl.hidden = n < 2;
    padEl.innerHTML = `${ICON.pad}<b>×${n}</b>`;
    padEl.title = `${n} manettes connectées`; padEl.setAttribute('aria-label', padEl.title);
    if (S.view === 'games') updateChrome(true);
    if (S.mode === 'details') { $('.tag-coop')?.remove(); syncDetails(); }
  }
  addEventListener('gamepadconnected', () => setTimeout(syncPads, 30));
  addEventListener('gamepaddisconnected', () => setTimeout(syncPads, 60));
  setInterval(syncPads, 2500);
  syncPads();

  // ================================================================ 3. Accent qui suit le jeu
  const root = document.documentElement;
  const colorCache = new Map();
  function sample(g) {
    const f = g.media?.cover || g.media?.header || g.media?.hero;
    if (!f) return Promise.resolve(null);
    const key = `${g.id}|${f}|${g.mediaVersion || 0}`;
    if (colorCache.has(key)) return Promise.resolve(colorCache.get(key));
    return new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        let out = null;
        try {
          const c = document.createElement('canvas'); c.width = 24; c.height = 36;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, 0, 0, 24, 36);
          const d = x.getImageData(0, 0, 24, 36).data, bk = new Map();
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), sat = mx ? (mx - Math.min(r, gg, b)) / mx : 0;
            if (mx / 255 < 0.18 || (mx / 255 > 0.92 && sat < 0.2)) continue;
            const k = `${r >> 5}-${gg >> 5}-${b >> 5}`, e = bk.get(k) || { r: 0, g: 0, b: 0, n: 0, s: 0 };
            e.r += r; e.g += gg; e.b += b; e.n++; e.s += sat; bk.set(k, e);
          }
          let best = null, sc = -1;
          for (const e of bk.values()) { const s = e.n * (0.35 + e.s / e.n); if (s > sc) { sc = s; best = e; } }
          if (best) out = [best.r / best.n, best.g / best.n, best.b / best.n];
        } catch { /* image non lisible */ }
        colorCache.set(key, out); res(out);
      };
      im.onerror = () => res(null);
      im.src = mediaUrl(g, f);
    });
  }
  let accTok = 0;
  const theme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  function setAccent(hex) {
    if (!hex || hex.toUpperCase() === H2C.BLUE) root.style.removeProperty('--accent'); else root.style.setProperty('--accent', hex);
  }
  async function updateAccent() {
    const tok = ++accTok;
    const g = S.view === 'games' ? S.items[S.sel] || null : null;
    if (!g || OPT('homeAccent', 'game') === 'fixed') return setAccent(null);
    const c = g.color || (await sample(g));
    if (tok !== accTok) return;
    setAccent(H2C.accentFor(c, theme()));
  }
  RR.on('selection', updateAccent);
  RR.on('view', updateAccent);
  RR.on('library', () => { updateAccent(); syncDetails(); if (S.mode === 'details') $('.tag-coop')?.remove(), syncDetails(); });
  RR.on('session', () => { if (S.view === 'home') syncCards(); });
  RR.on('library', () => { if (S.view === 'home') syncCards(); });

  // ================================================================ Réglages
  const box = $('#set-home2');
  if (box) {
    box.innerHTML = `<h3 class="set-group">Accueil, multijoueur et couleurs</h3>
      <div class="setting"><div><strong id="h2c">Afficher « Continuer »</strong><span class="dim">Le dernier jeu joué en grande tuile, en premier sur l’accueil</span></div><button class="toggle" data-h2toggle="homeContinue" role="switch" aria-labelledby="h2c" data-nav></button></div>
      <div class="setting"><div><strong id="h2a">Couleur d’accent</strong><span class="dim">« Suit le jeu » reprend la couleur de la jaquette (contraste garanti)</span></div>
        <div class="seg" data-setting="homeAccent" role="group" aria-labelledby="h2a"><button data-value="fixed" data-nav><i class="swatch" style="background:#3C91E6"></i>Fixe (bleu)</button><button data-value="game" data-nav>Suit le jeu</button></div></div>
      <p class="set-note">Multijoueur local : l’onglet réunit les jeux Steam « écran partagé » ; pour une ROM, marque le jeu depuis sa page (bouton « Multijoueur local »). L’icône manette ×2 en haut indique les manettes branchées.</p>`;
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-h2toggle]');
      if (t) { await rr.setSettings({ [t.dataset.h2toggle]: !OPT(t.dataset.h2toggle) }); sfx('toggle'); }
    });
  }
  function syncSettings() {
    if (!box) return;
    $$('[data-h2toggle]', box).forEach((b) => b.setAttribute('aria-checked', String(!!OPT(b.dataset.h2toggle))));
    $$('.seg[data-setting="homeAccent"] button', box).forEach((b) => b.setAttribute('aria-pressed', String(OPT('homeAccent', 'game') === b.dataset.value)));
  }
  wrap('renderSettings', (orig, ...a) => { orig(...a); syncSettings(); });
  syncSettings();
})();

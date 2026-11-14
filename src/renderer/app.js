/* RR Launcher — interface : accueil consoles, carrousel 3D de boîtes, manette / clavier / souris */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- État
const S = {
  lib: { games: [], settings: {}, running: [], platforms: [] },
  P: {}, // plateformes par id
  view: 'home', // home | games
  plat: 'all',
  items: [],
  tabs: [],
  tab: 'all',
  sel: 0,
  selId: null,
  pos: -4,
  vel: 0,
  flip: 0,
  flipCur: 0,
  spin: new Map(),
  home: { items: [], sel: 0, pos: -2, vel: 0, selId: null },
  platImg: {},
  platLogo: {},
  progress: {},
  mode: 'main',
  stack: [],
  device: 'kbd',
  padType: 'xbox',
  dims: { W: 300, H: 470, D: 40, CW: 420, CH: 320 },
  mouse: { x: 0, y: 0 },
  update: null,
  topFocus: -1, // SHELL : index de l'icône focalisée dans la barre du haut (-1 = aucune)
};
// ---------------------------------------------------------------- Points d'accroche des modules (features/*.js)
// RR.on(évènement, fn) / RR.emit(évènement, …) ; RR.actions[nom] = fn étend action() ;
// RR.hints.push((h) => …) ajoute des aides à la barre du bas (h(['a'], 'Libellé', 'action')).
// Évènements : 'library' (state), 'selection' (jeu), 'view' (home|games), 'mode' (mode), 'play' (jeu),
// 'session' ({ id, running }), 'input' (source) — toute entrée clavier / manette / souris.
const RR = {
  _h: {}, actions: {}, hints: [],
  on(e, f) { (this._h[e] ||= []).push(f); },
  emit(e, ...a) { for (const f of this._h[e] || []) { try { f(...a); } catch (err) { console.error('RR.' + e, err); } } },
};
const slots = new Map();
const cards = new Map();

const CASES = { red: '#d4142c', black: '#1c1c24', blue: '#3C91E6' };
const DEPTH = { dvd: 0.085, bluray: 0.07, small: 0.07, card: 0.17, jewel: 0.075 };

// ---------------------------------------------------------------- Utilitaires
const mediaUrl = (g, file) => (file ? `rr://media/${g.id}/${encodeURIComponent(file)}?v=${g.mediaVersion || 0}` : '');
const logoCss = (id) => (S.platLogo[id] ? `--logo:url('rr://media/_platforms/${encodeURIComponent(S.platLogo[id])}')` : '');
const platUrl = (file) => (file ? `rr://media/_platforms/${encodeURIComponent(file)}` : '');
const yearOf = (g) => (String(g.releaseDate || '').match(/\d{4}/) || [])[0] || '';
const plat = (id) => S.P[id] || S.P.pc || { id: 'pc', name: 'PC', short: 'PC', color: '#3C91E6', case: { style: 'dvd', ratio: 0.64 } };
function fmtTime(sec = 0) {
  const m = Math.round(sec / 60);
  if (m < 1) return '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r && h < 10 ? `${h} h ${r}` : `${h} h`;
}
function fmtLast(ts) {
  if (!ts) return 'Jamais';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'Aujourd’hui';
  if (d === 1) return 'Hier';
  if (d < 30) return `Il y a ${d} jours`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function caseInfo(g) {
  const p = plat(g.platform);
  if (p.id === 'pc') {
    const st = S.lib.settings.caseStyle || 'red';
    const c = st === 'auto' ? (g.color ? `color-mix(in oklab, ${g.color} 72%, black)` : CASES.red) : CASES[st] || CASES.red;
    return { style: 'dvd', ratio: 0.64, body: c, band: c, fg: '#fff', label: null, pc: true };
  }
  return { ...p.case, band: p.case.band || p.case.body, label: p.case.label };
}
const sfx = (n) => Sfx.play(n);

// Chemins affichés en direction rtl (troncature à gauche) : on isole le texte en ltr pour garder les « / » à leur place
const ltr = (s = '') => `‎${s}‎`;

// ---------------------------------------------------------------- Toasts
// toast(msg) → info ; toast(msg, true) → erreur ; toast(msg, 'success' | 'progress' | 'error' | 'info')
const TOAST_ICON = {
  success: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24"><path d="M12 7.5v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.5h.01"/></svg>',
  progress: '<span class="spinner tiny"></span>',
};
function toast(msg, type = 'info') {
  if (type === true) type = 'error';
  if (!type || !TOAST_ICON[type]) type = 'info';
  const box = $('#toast');
  // Pas de doublon : un message identique déjà affiché est simplement prolongé
  let t = $$('.toast', box).find((x) => x._msg === msg && !x.classList.contains('out'));
  if (!t) {
    t = document.createElement('div');
    t._msg = msg;
    t.className = `toast t-${type}`;
    t.innerHTML = `<span class="t-ico" aria-hidden="true">${TOAST_ICON[type]}</span><span class="t-msg"></span>`;
    $('.t-msg', t).textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const all = $$('.toast:not(.out)', box);
    if (all.length > 3) dismissToast(all[0]);
  }
  clearTimeout(t._timer);
  t._timer = setTimeout(() => dismissToast(t), type === 'error' ? 6000 : type === 'progress' ? 4200 : 3400);
  if (type === 'error') sfx('error');
}
function dismissToast(t) {
  clearTimeout(t._timer);
  t.classList.add('out');
  t.classList.remove('show');
  setTimeout(() => t.remove(), reduceMotion ? 0 : 260);
}

// ---------------------------------------------------------------- Accueil : choix de la console (façon ES-DE)
// Fond = bannière d'un jeu de la console, panneau en biais avec le grand logo, rangée de tuiles en bas.
const LAY = { k: 0, edge: 0, anchor: 0, R: 400, cx: 0, cy: 0 }; // géométrie partagée (layout / frameGames)
const HOME_FADE = reduceMotion ? 0 : 350;
const HOME_WRAP = 5; // LOOK : à partir de 5 tuiles, la rangée boucle (assez de tuiles pour cacher la couture hors écran)
// La rangée ne boucle que si elle est nettement plus large que l'écran : sinon la tuile qui passe d'un bord
// à l'autre apparaît puis disparaît (« la dernière clignote ») au lieu de rester hors champ.
function homeLoops() {
  const n = S.home.items.length;
  if (n < HOME_WRAP) return false;
  let T = 0;
  for (const el of cards.values()) { if (el.dataset.id !== 'continue') { T = el.offsetWidth; break; } }
  T ||= 200;
  return n * T * 1.163 >= innerWidth + T * 3.2;
}

function computeHome() {
  const g = S.lib.games;
  const by = new Map();
  for (const x of g) {
    const e = by.get(x.platform) || { n: 0, last: 0, fav: 0 };
    e.n++; e.last = Math.max(e.last, x.lastPlayed || 0, x.addedAt || 0);
    if (x.favorite) e.fav++;
    by.set(x.platform, e);
  }
  const plats = [...by.entries()].sort((a, b) => b[1].last - a[1].last).map(([id, e]) => ({ id, n: e.n, fav: e.fav }));
  const items = [];
  if (plats.length > 1) items.push({ id: 'all', n: g.length, fav: g.filter((x) => x.favorite).length });
  items.push(...plats);
  items.push({ id: 'add', n: 0, fav: 0 });
  S.home.items = items;
  const i = items.findIndex((x) => x.id === S.home.selId);
  S.home.sel = i >= 0 ? i : 0;
  S.home.selId = items[S.home.sel]?.id;
}
// Pochettes des derniers jeux joués (visuel « Tous les jeux »)
function recentCovers(n = 4) {
  return [...S.lib.games].filter((g) => g.media?.cover)
    .sort((a, b) => (b.lastPlayed || b.addedAt || 0) - (a.lastPlayed || a.addedAt || 0))
    .slice(0, n).map((g) => mediaUrl(g, g.media.cover));
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Bannière d'un jeu : hero, puis header, puis une capture, puis la jaquette
function bannerOf(g) {
  const m = g.media || {};
  const f = m.hero || m.header || (g.screenshots || [])[0] || m.cover;
  return f ? mediaUrl(g, f) : '';
}
// Visuels tirés au hasard une fois par lancement (S.home.art) : même image en revenant sur une console
function homeArt(id) {
  if (typeof fixesHomeArt === 'function') return fixesHomeArt(id); // FIXES : images nettes seulement (features/fixes.js)
  S.home.art ||= {};
  const games = id === 'all' ? S.lib.games : S.lib.games.filter((g) => g.platform === id);
  const ids = new Set(games.map((g) => g.id));
  let a = S.home.art[id];
  if (a && (!a.gid || ids.has(a.gid)) && (!a.tid || ids.has(a.tid))) return a;
  a = { bg: '', gid: null, tile: '', tid: null };
  const withArt = games.filter((g) => bannerOf(g));
  if (withArt.length) { const g = pick(withArt); a.gid = g.id; a.bg = bannerOf(g); }
  // Tuile : une capture ou un hero, différent de la bannière si possible
  const pool = [];
  for (const g of games) {
    for (const s of g.screenshots || []) pool.push([g.id, mediaUrl(g, s)]);
    if (g.media?.hero) pool.push([g.id, mediaUrl(g, g.media.hero)]);
  }
  const other = pool.filter(([, u]) => u !== a.bg);
  const t = pick(other.length ? other : pool);
  if (t) { a.tid = t[0]; a.tile = t[1]; } else { a.tile = a.bg; a.tid = a.gid; }
  S.home.art[id] = a;
  return a;
}
function homeName(id) { return id === 'add' ? 'Ajouter des jeux' : id === 'all' ? 'Tous les jeux' : plat(id).name; }
function tileHTML(it) {
  const p = plat(it.id);
  if (it.id === 'add') {
    return `<div class="t-in t-add"><span class="t-plus" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><b>Ajouter</b></div>`;
  }
  if (it.id === 'all') {
    const cv = recentCovers(4);
    while (cv.length && cv.length < 4) cv.push(cv[cv.length % Math.max(1, cv.length)]);
    return `<div class="t-in t-all"><div class="t-mosaic">${cv.map((u) => `<img src="${u}" alt="" decoding="async" />`).join('')}</div>`
      + `<div class="t-shade"></div><b class="t-name">Tous<br>les jeux</b></div>`;
  }
  const a = homeArt(it.id);
  const logo = S.platLogo[it.id];
  const mark = logo ? `<img class="t-logo" crossorigin="anonymous" src="${platUrl(logo)}" alt="" />`
    : `<b class="t-name" style="--fit:${Math.min(1, 6 / Math.max(3, (p.short || p.name).length)).toFixed(2)}">${esc(p.short || p.name)}</b>`;
  return `<div class="t-in" style="--pc:${p.color || '#3C91E6'}">${a.tile ? `<img class="t-art${a.tileCls ? ' ' + a.tileCls : ''}" src="${a.tile}" alt="" decoding="async" />` : ''}` // FIXES : tileCls
    + `<div class="t-tint"></div><div class="t-shade"></div>${mark}</div>`;
}
// Logo très clair (blanc sur transparent) : illisible sur le panneau clair → on le fonce
function checkLogoTone(img) {
  try {
    const c = document.createElement('canvas'), w = 48, h = 24;
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    img.classList.toggle('is-light', n > 0 && sum / n > 205);
  } catch { /* image non lisible (origine) : on garde le rendu d'origine */ }
}
// Logos de console : forcer un logo en silhouette (blanc sur les tuiles, noir sur la barre claire) n'a de sens
// que pour un logo d'UNE couleur. Un logo multicolore (lettres blanches cernées, dégradés…) devient un pavé
// illisible : on le garde en couleurs, sur une petite plaque claire si le fond est sombre.
// → data-tone = 'mono' | 'multi' (plaque claire) | 'multi-light' (logo surtout clair : plaque sombre) | 'opaque' sur les <img> .t-logo / .brand-plat-logo / .h-logo-img
const logoToneCache = new Map();
function logoTone(img) {
  const key = img.currentSrc || img.src;
  if (logoToneCache.has(key)) return logoToneCache.get(key);
  let tone = 'multi';
  try {
    const c = document.createElement('canvas'), w = 120, h = 60;
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let n = 0, opaque = 0, light = 0, dark = 0, sum = 0, sum2 = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 245) opaque++;
      if (d[i + 3] < 110) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; sum += l; sum2 += l * l;
      if (l > 200) light++; else if (l < 70) dark++;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
    }
    if (opaque / (w * h) > 0.96) tone = 'opaque'; // pas de transparence : c'est une image, pas un tracé
    else if (n) {
      const std = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
      // une seule teinte : peu d'écart de luminosité, et pas de mélange clair + foncé
      const mixed = light / n > 0.12 && dark / n > 0.12;
      tone = !mixed && std < 48 ? 'mono' : sum / n > 165 ? 'multi-light' : 'multi';
    }
  } catch { tone = 'multi'; }
  logoToneCache.set(key, tone);
  return tone;
}
// (l'évènement load d'une image ne passe pas par window : écoute sur document + rattrapage des images déjà chargées)
function toneLogos(root = document) {
  for (const img of root.querySelectorAll('img.t-logo:not([data-tone]), img.brand-plat-logo:not([data-tone]), img.h-logo-img:not([data-tone])')) {
    if (img.complete && img.naturalWidth) img.dataset.tone = logoTone(img);
  }
}
document.addEventListener('load', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.matches('.t-logo, .brand-plat-logo, .h-logo-img')) img.dataset.tone = logoTone(img);
}, true);
new MutationObserver(() => toneLogos()).observe(document.documentElement, { childList: true, subtree: true });

function syncCards() {
  const root = $('#homeRow');
  $('#home').classList.toggle('no-games', !S.lib.games.length);
  const ids = new Set(S.home.items.map((x) => x.id));
  for (const [id, el] of cards) if (!ids.has(id)) { el.remove(); cards.delete(id); }
  const covers = recentCovers().join(' ');
  S.home.items.forEach((it, i) => {
    let el = cards.get(it.id);
    const sig = `${it.n}|${S.platLogo[it.id] || ''}|${it.id === 'all' ? covers : it.id === 'add' ? '' : homeArt(it.id).tile}`;
    if (!el) {
      el = document.createElement('div');
      el.className = 'h-tile';
      el.dataset.id = it.id;
      el.setAttribute('role', 'option');
      el.addEventListener('click', (e) => { e.stopPropagation(); onCardClick(it.id); });
      root.appendChild(el);
      cards.set(it.id, el);
    }
    el.setAttribute('aria-label', `${homeName(it.id)}${it.id === 'add' ? '' : `, ${it.n} jeu${it.n > 1 ? 'x' : ''}`}`);
    el.dataset.i = i;
    if (el._sig !== sig) { el.innerHTML = tileHTML(it); el._sig = sig; }
    loadPlatLogo(it.id);
  });
  markSelTile();
}
function markSelTile() {
  for (const [id, el] of cards) {
    const on = id === S.home.selId;
    el.classList.toggle('is-sel', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}
async function loadPlatLogo(id) {
  if (!id || ['pc', 'all', 'add'].includes(id) || S.platLogo[id] !== undefined) return;
  S.platLogo[id] = null;
  const f = await rr.platformLogo(id).catch(() => null);
  if (f) {
    S.platLogo[id] = f;
    syncCards(); syncSlots();
    if (S.view === 'home') updateHomeChrome(); else updateBrand();
  }
}
async function loadPlatImage(id) {
  S.platImg[id] = null;
  const f = await rr.platformImage(id).catch(() => null);
  if (f) S.platImg[id] = f;
}
function onCardClick(id) {
  if (S.mode !== 'main' || S.view !== 'home') return;
  const i = S.home.items.findIndex((x) => x.id === id);
  if (i === S.home.sel) openHomeItem(); else homeSelect(i);
}
function homeSelect(i) {
  // LOOK : la rangée boucle comme ES-DE (← sur la 1re tuile → dernière) ; pos décalé de n pour un glissement continu
  const n = S.home.items.length;
  if (homeLoops() && (i < 0 || i >= n)) { S.home.pos += i < 0 ? n : -n; i = (i + n) % n; }
  i = clamp(i, 0, n - 1);
  if (i === S.home.sel) return;
  S.home.sel = i;
  S.home.selId = S.home.items[i].id;
  sfx('tab');
  markSelTile();
  updateHomeChrome();
}
// Console « préparée » derrière l'accueil : on garde celle d'où l'on vient (pas d'aperçu des jeux sur l'accueil)
function previewPlat() {
  return S.plat === 'all' || S.lib.games.some((g) => g.platform === S.plat) ? S.plat : '__none';
}
// Prépare la console (S.plat / S.items / onglets) avant d'afficher ses jeux
function setPreview(id = S.home.selId) {
  S.plat = !id || id === 'add' ? '__none' : id;
  S.tab = 'all';
  S.flip = 0;
  computeTabs(); computeItems();
  S.sel = 0; S.pos = -1.4; S.vel = 0; S.selId = S.items[0]?.id || null;
  renderTabs(); syncSlots();
}
function openHomeItem() {
  const it = S.home.items[S.home.sel];
  if (!it) return;
  if (it.id === 'add') { sfx('open'); return action('addHub'); }
  enterPlatform(it.id);
}
function setCapLogo(id) {
  const el = $('#capLogo');
  const has = id && S.platLogo[id];
  el.hidden = !has;
  el.style.cssText = has ? logoCss(id) : '';
  $('#title').classList.toggle('sr-only', !!has);
}
// Fond + panneau : préchargement puis fondu enchaîné ; la dernière demande gagne
let homeArtTok = 0, homeArtCur = null;
function setHomeArt(id) {
  const art = id === 'add' ? null : homeArt(id); // FIXES : art.decorate (photo de console / mosaïque) + art.key
  const url = art ? art.bg : '';
  const deco = art && art.decorate;
  const key = (art && art.key) || url || (id === 'add' ? '#add' : '#none');
  if (key === homeArtCur) return;
  homeArtCur = key;
  const tok = ++homeArtTok;
  const apply = () => {
    if (tok !== homeArtTok) return;
    const style = url && !deco ? `background-image:url("${url}")` : '';
    const cls = url || deco ? '' : ' is-brand';
    for (const [root, c] of [[$('#homeScene'), 'h-bg'], [$('#homePanel'), 'h-pbg']]) {
      const old = $$(`.${c}`, root);
      const el = document.createElement('div');
      el.className = c + cls;
      el.style.cssText = style;
      if (deco) deco(el, c === 'h-pbg'); else markLowRes(el, url); // FIXES
      root.appendChild(el);
      old.forEach((o) => { o.classList.add('out'); setTimeout(() => o.remove(), HOME_FADE + 60); });
      if (HOME_FADE) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: HOME_FADE, easing: 'ease-out' });
    }
  };
  if (!url) return apply();
  const img = new Image();
  img.onload = apply; img.onerror = apply;
  img.src = url;
}
// Préchargement des bannières voisines : pas d'attente au prochain déplacement
function warmHomeArt() {
  for (const d of [-1, 1]) {
    const it = S.home.items[S.home.sel + d];
    if (it && it.id !== 'add') { const u = homeArt(it.id).bg; if (u) new Image().src = u; }
  }
}
function homeLogoHTML(id) {
  // LOOK : petite pastille de marque au-dessus d'un nom énorme (réf. ES-DE « Nintendo » / « Wii »)
  const big = (maker, name) => {
    // Lignes de ≤ 8 caractères ; taille ajustée à la plus longue ligne et au nombre de lignes
    const lines = [];
    for (const w of name.split(/\s+/)) {
      const l = lines.length - 1;
      if (l >= 0 && (lines[l] + ' ' + w).length <= 8) lines[l] += ' ' + w; else lines.push(w);
    }
    const fit = Math.min(1, 4.4 / Math.max(3, ...lines.map((x) => x.length)), 1.7 / lines.length);
    return `<div class="h-brand">${maker ? `<span class="h-maker">${maker}</span>` : ''}`
      + `<span class="h-name" style="--fit:${fit.toFixed(2)}">${lines.map(esc).join('<br>')}</span></div>`;
  };
  if (id === 'all' || id === 'add') return big('<span class="brand-rr">RR</span> Launcher', id === 'all' ? 'Tous les jeux' : 'Ajouter');
  const p = plat(id);
  if (S.platLogo[id]) return `<img class="h-logo-img" crossorigin="anonymous" src="${platUrl(S.platLogo[id])}" alt="${esc(p.name)}" />`;
  const m = p.name.match(/^(Nintendo|Sony|Sega|Microsoft|Atari|NEC|SNK|Bandai|Valve)\s+(.+)$/i);
  return m ? big(esc(m[1]), m[2]) : big('', p.name);
}
function setHomeLogo(id) {
  const box = $('#homeLogo');
  const sig = `${id}|${S.platLogo[id] || ''}`;
  if (box._sig === sig) return;
  box._sig = sig;
  const el = document.createElement('div');
  el.className = 'h-logo-in';
  el.innerHTML = homeLogoHTML(id);
  const img = $('img', el);
  if (img) { if (img.complete && img.naturalWidth) checkLogoTone(img); else img.addEventListener('load', () => checkLogoTone(img), { once: true }); }
  $$('.h-logo-in', box).forEach((o) => {
    if (o._anim) o._anim.cancel();
    if (!HOME_FADE) return o.remove();
    o.style.pointerEvents = 'none';
    o.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-2vw)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' })
      .onfinish = () => o.remove();
  });
  box.appendChild(el);
  if (HOME_FADE) el._anim = el.animate([{ opacity: 0, transform: 'translateX(3vw)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
}
function updateHomeChrome() {
  const it = S.home.items[S.home.sel];
  updateBrand();
  $('#counter').textContent = '';
  if (!it) return;
  setHomeArt(it.id);
  setHomeLogo(it.id);
  warmHomeArt();
  if (typeof setFootInfo === 'function') {
    setFootInfo(it.id === 'add' ? 'AJOUTER DES JEUX PC, STEAM, EPIC, GOG OU DES ROMS'
      : `${it.n} JEU${it.n > 1 ? 'X' : ''} (${it.fav} FAVORI${it.fav > 1 ? 'S' : ''})`);
  }
}
function recentGame(pid) {
  return [...S.lib.games].filter((g) => !pid || g.platform === pid).sort((a, b) => (b.lastPlayed || b.addedAt) - (a.lastPlayed || a.addedAt))[0];
}
function heroOf(g) {
  const f = g.media?.hero || g.media?.header || g.media?.cover;
  return f ? mediaUrl(g, f) : '';
}

function enterPlatform(id) {
  if (id) {
    const i = S.home.items.findIndex((x) => x.id === id);
    if (i >= 0) { S.home.sel = i; S.home.selId = id; markSelTile(); }
  }
  setPreview(S.home.selId);
  if (!S.items.length) return;
  S.view = 'games';
  document.body.dataset.view = 'games';
  S.sel = 0; S.selId = S.items[0]?.id || null;
  renderTabs(); updateChrome(true);
  $('#btnBack').hidden = false;
  sfx('open');
  renderHints();
  scheduleSweep();
}
function goHome() {
  if (S.view === 'home') return;
  S.view = 'home';
  document.body.dataset.view = 'home';
  $('#btnBack').hidden = true;
  S.flip = 0;
  // Retour sur la console d'où l'on vient
  const i = S.home.items.findIndex((x) => x.id === S.plat);
  if (i >= 0) { S.home.sel = i; S.home.selId = S.plat; S.home.pos = i; S.home.vel = 0; markSelTile(); }
  updateHomeChrome();
  sfx('back');
  renderHints();
}
// Rangée de tuiles : la tuile choisie reste ancrée en 2e position (≈ 22,6 % de la largeur), ressort sur S.home.pos
function frameHome() {
  const row = $('#homeRow');
  if (!row || !cards.size) return;
  const first = cards.values().next().value;
  const T = first.offsetWidth || 200;
  const pitch = T * 1.163;
  const x0 = innerWidth * 0.226 - T / 2;
  const n = S.home.items.length;
  const loop = homeLoops();
  // Plus de boucle (fenêtre agrandie, console retirée…) : on ramène la position sur la sélection sans tour complet
  if (!loop && Math.abs(S.home.pos - S.home.sel) >= n - 0.5) { S.home.pos = S.home.sel; S.home.vel = 0; }
  const c = (innerWidth / 2 - x0 - T / 2) / pitch; // fenêtre de boucle centrée sur l'écran (pas sur la tuile choisie)
  S.home.items.forEach((it, i) => {
    const el = cards.get(it.id);
    if (!el) return;
    let d = i - S.home.pos;
    if (loop) d = ((d - c + n / 2) % n + n) % n - n / 2 + c; // LOOK : rangée bouclée, couture hors écran
    const x = x0 + d * pitch;
    const vis = x > -T * 1.3 && x < innerWidth + T * 0.3;
    if (!vis) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; return; }
    el.style.visibility = '';
    el.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  });
}

// ---------------------------------------------------------------- Bibliothèque / filtres
function inPlat(list) { return S.plat === 'all' ? list : S.plat === '__none' ? [] : list.filter((g) => g.platform === S.plat); }
function sorted(list) {
  const s = S.lib.settings.sort || 'recent';
  const arr = [...list];
  if (s === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  else if (s === 'added') arr.sort((a, b) => b.addedAt - a.addedAt);
  else if (s === 'playtime') arr.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
  else arr.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.addedAt - a.addedAt);
  return arr;
}
function computeTabs() {
  const g = inPlat(S.lib.games);
  const tabs = [{ id: 'all', label: 'Tous', n: g.length }];
  const fav = g.filter((x) => x.favorite).length;
  const rec = g.filter((x) => x.lastPlayed).length;
  if (fav) tabs.push({ id: 'fav', label: 'Favoris', n: fav });
  if (rec) tabs.push({ id: 'recent', label: 'Récents', n: rec });
  if (S.plat === 'all') {
    const plats = new Map();
    for (const x of g) plats.set(x.platform, (plats.get(x.platform) || 0) + 1);
    if (plats.size > 1) [...plats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([pid, n]) => tabs.push({ id: 'p:' + pid, label: plat(pid).short === 'PC' ? 'PC' : plat(pid).name, n }));
  } else {
    const genres = new Map();
    for (const x of g) for (const gen of x.genres || []) genres.set(gen, (genres.get(gen) || 0) + 1);
    [...genres.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([gen, n]) => tabs.push({ id: 'g:' + gen, label: gen, n }));
  }
  S.tabs = tabs;
  if (!tabs.some((t) => t.id === S.tab)) S.tab = 'all';
}
function computeItems() {
  let list = inPlat(S.lib.games);
  if (S.tab === 'fav') list = list.filter((x) => x.favorite);
  else if (S.tab === 'recent') list = [...list].filter((x) => x.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  else if (S.tab.startsWith('g:')) list = list.filter((x) => (x.genres || []).includes(S.tab.slice(2)));
  else if (S.tab.startsWith('p:')) list = list.filter((x) => x.platform === S.tab.slice(2));
  S.items = S.tab === 'recent' ? list : sorted(list);
}

function refresh() {
  computeHome();
  syncCards();
  if (S.view === 'home') S.plat = previewPlat();
  else if (S.plat !== 'all' && !S.lib.games.some((g) => g.platform === S.plat)) {
    S.view = 'home'; document.body.dataset.view = 'home'; $('#btnBack').hidden = true; S.plat = previewPlat();
  }
  computeTabs();
  computeItems();
  if (S.selId) {
    const i = S.items.findIndex((g) => g.id === S.selId);
    if (i >= 0) { const d = i - S.sel; S.sel = i; S.pos += d; }
  }
  if (S.view === 'home') S.sel = 0;
  S.sel = clamp(S.sel, 0, Math.max(0, S.items.length - 1));
  S.selId = S.items[S.sel]?.id || null;
  renderTabs();
  syncSlots();
  $('#empty').hidden = S.lib.games.length > 0;
  if (S.view === 'games') updateChrome(true); else updateHomeChrome();
  if (S.mode === 'details') renderDetails();
  renderHints();
}

// ---------------------------------------------------------------- Boîtes
function artHTML(g, lazy) {
  const src = (f) => (lazy ? `data-src="${mediaUrl(g, f)}"` : `src="${mediaUrl(g, f)}"`);
  if (g.media?.cover) return `<img class="cover" ${src(g.media.cover)} alt="" decoding="async" />`;
  const bg = g.media?.hero || g.media?.header;
  const style = bg ? `style="background-image:url('${mediaUrl(g, bg)}')"` : `style="background:linear-gradient(160deg, ${g.color || plat(g.platform).color}, #0b0b16)"`;
  const logo = g.media?.logo ? `<img ${src(g.media.logo)} alt="" />` : `<span>${esc(g.name)}</span>`;
  return `<div class="gen" ${style}>${logo}</div>`;
}
function backHTML(g) {
  if (g.media?.back) return `<div class="b-scan"><img data-src="${mediaUrl(g, g.media.back)}" alt="" /></div><div class="gloss"></div>`;
  const hero = g.media?.hero || g.media?.header;
  const shots = (g.screenshots || []).slice(0, 2).map((s) => `<div style="background-image:url('${mediaUrl(g, s)}')"></div>`).join('');
  return `
    <div class="b-hero" style="${hero ? `background-image:url('${mediaUrl(g, hero)}')` : ''}">${g.media?.logo ? `<img src="${mediaUrl(g, g.media.logo)}" alt="" />` : ''}</div>
    <div class="b-text">${esc(g.description || 'Aucune description disponible.')}</div>
    ${shots ? `<div class="b-shots">${shots}</div>` : ''}
    <div class="b-foot"><span>${esc(g.developer || plat(g.platform).name)}</span><span>${esc(yearOf(g))}</span></div>`;
}
function slotHTML(g) {
  const c = caseInfo(g);
  const name = esc(g.name);
  const loading = g.metaStatus === 'loading'
    ? `<div class="loading-veil"><div class="spinner"></div><div class="lv-msg">${esc(S.progress[g.id] || 'Recherche…')}</div></div>` : '';
  const fav = g.favorite ? `<div class="fav-badge"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg></div>` : '';
  const running = S.lib.running.includes(g.id) ? `<div class="running-badge">EN COURS</div>` : '';
  const reflectImg = g.media?.cover ? `<img data-src="${mediaUrl(g, g.media.cover)}" alt="" />` : '';
  const bandInner = c.pc
    ? `<span class="band-mark"><span class="band-rr">RR</span><span class="band-pc"><span>PC</span><span>GAMES</span></span></span>`
    : S.platLogo[g.platform] ? `<span class="band-logo" style="${logoCss(g.platform)}" role="img" aria-label="${esc(c.label)}"></span>`
    : `<span class="band-label">${esc(c.label)}</span>`;
  let front;
  if (c.style === 'card') front = `<div class="art">${artHTML(g, true)}<div class="gloss"></div><div class="sweep"></div>${loading}</div>`;
  else if (c.style === 'jewel') front = `<div class="jewel-hinge"></div><div class="art">${artHTML(g, true)}<div class="gloss"></div><div class="sweep"></div>${loading}</div>`;
  else front = `<div class="sheet"><div class="band">${bandInner}</div><div class="art">${artHTML(g, true)}<div class="sweep"></div>${loading}</div></div><div class="gloss"></div><i class="clip"></i>`;
  const spine = c.pc
    ? `<span class="s-rr">RR</span><span class="s-name">${name}</span>`
    : `<span class="s-top">${S.platLogo[g.platform] ? `<span class="s-logo" style="${logoCss(g.platform)}"></span>` : `<span class="s-plat" style="writing-mode:horizontal-tb;font-size:calc(var(--box-d)*.26)">${esc(plat(g.platform).short.slice(0, 6))}</span>`}</span><span class="s-name">${name}</span>`;
  return `
    <div class="halo"></div>
    <div class="box" data-style="${c.style}" style="--case:${c.body};--band:${c.band};--band-fg:${c.fg || '#fff'};--spine-fg:${c.fg && c.style !== 'card' && c.band === c.body ? c.fg : '#fff'}">
      <div class="face front">${front}${fav}${running}</div>
      <div class="face back">${backHTML(g)}</div>
      <div class="face spine left">${spine}</div>
      <div class="face spine right">${spine}</div>
      <div class="face cap top"></div>
      <div class="face cap bottom"></div>
      <div class="face reflect">${reflectImg}</div>
    </div>
    <div class="shadow"></div>`;
}
const sig = (g) => JSON.stringify([S.platLogo[g.platform] || '', g.name, g.media, g.mediaVersion, g.metaStatus, g.favorite, g.color, g.platform, S.lib.settings.caseStyle, S.lib.running.includes(g.id), g.description, g.screenshots, S.dims.H]);

function slotDims(g) {
  const c = caseInfo(g);
  const H0 = S.dims.H;
  let W, H;
  // LOOK : hauteur commune (rangée alignée façon tuiles Switch) ; seuls les boîtiers très larges sont plafonnés
  H = H0; W = H * c.ratio;
  if (W > H0 * 1.3) { W = H0 * 1.3; H = W / c.ratio; }
  return { W, H, D: H * (DEPTH[c.style] || 0.085) };
}
function syncSlots() {
  const car = $('#carousel');
  const ids = new Set(S.items.map((g) => g.id));
  for (const [id, el] of slots) if (!ids.has(id)) { el.remove(); slots.delete(id); }
  new Set(S.items.map((g) => g.platform)).forEach(loadPlatLogo);
  S.items.forEach((g, i) => {
    let el = slots.get(g.id);
    const s = sig(g);
    if (!el) {
      el = document.createElement('div');
      el.className = 'slot';
      el.style.display = 'none';
      el.addEventListener('click', () => onSlotClick(g.id));
      el.addEventListener('dblclick', () => { clearTimeout(slotClickT); if (BO.kind === 'open') boCancel(); if (S.mode === 'main' && S.items[S.sel]?.id === g.id) play(); });
      car.appendChild(el);
      slots.set(g.id, el);
    }
    if (el._sig !== s) {
      const d = slotDims(g);
      el.style.setProperty('--box-w', d.W + 'px');
      el.style.setProperty('--box-h', d.H + 'px');
      el.style.setProperty('--box-d', d.D + 'px');
      el._dims = d;
      el.innerHTML = slotHTML(g);
      el._sig = s;
      el._hydrated = false;
    }
    el._index = i;
  });
  S.dims.Wref = S.dims.H * 0.66;
  // Position gauche de chaque boîte : largeurs réelles + écart fixe (rangée serrée façon tuiles)
  const gap = S.dims.H * 0.15;
  S.cum = [];
  let acc = 0;
  S.items.forEach((g) => { S.cum.push(acc); acc += (slots.get(g.id)?._dims?.W || S.dims.Wref) + gap; });
  S.cumStep = S.dims.Wref + gap;
  S.dims.gap = gap;
  const none = S.view === 'games' && S.lib.games.length > 0 && !S.items.length;
  $('#catEmpty').hidden = !none;
  if (S.view === 'games') $('#caption').hidden = S.items.length === 0;
}
function hydrate(el) {
  if (el._hydrated) return;
  el._hydrated = true;
  $$('[data-src]', el).forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
}
function updateProgressText(id) {
  const el = slots.get(id);
  const m = el && $('.lv-msg', el);
  if (m) m.textContent = S.progress[id] || '';
  if (S.view === 'games' && S.items[S.sel]?.id === id) renderCapBadges(S.items[S.sel]);
}
let sweepT;
function scheduleSweep() {
  clearTimeout(sweepT);
  sweepT = setTimeout(() => {
    const el = slots.get(S.items[S.sel]?.id);
    const sw = el && $('.front .sweep', el);
    if (!sw) return;
    sw.classList.remove('go'); void sw.offsetWidth; sw.classList.add('go');
  }, 230);
}

// ---------------------------------------------------------------- Dimensions
// Rangée de jeux : sous la barre système et les onglets, sélection ancrée à gauche (façon PS5 / Switch)
const SEL_K = 1.5; // échelle de la boîte sélectionnée (réf. Switch : 1re tuile 1,5× plus grande)
function cssPx(name, fb) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fb;
}
function measure() {
  const vh = innerHeight;
  // Hauteurs réelles des barres (les variables CSS sont des clamp() que getPropertyValue ne résout pas)
  const topH = $('.topbar')?.getBoundingClientRect().height || cssPx('--top-h', 88);
  const botH = $('#hints')?.getBoundingClientRect().height || cssPx('--bottom-h', 72);
  // Place pour la rangée d'onglets + respiration au-dessus de l'anneau de la boîte sélectionnée
  const rowTop = topH + clamp(vh * 0.105, 70, 160);
  // Hauteur dispo pour la boîte sélectionnée : il faut garder la place du bloc d'infos dessous
  const info = clamp(vh * 0.3, 250, 340);
  const selH = clamp(Math.min(vh * 0.415, vh - rowTop - botH - info), 170, 600);
  const H = selH / SEL_K;
  S.dims.H = H;
  S.dims.rowTop = rowTop;
  S.dims.selH = selH;
  S.dims.left = clamp(innerWidth * 0.056, 56, 150);
  const r0 = document.documentElement.style;
  r0.setProperty('--g-left', S.dims.left + 'px');
  r0.setProperty('--g-row-top', rowTop + 'px');
  r0.setProperty('--g-sel-h', selH + 'px');
  const R = innerHeight * 0.53;
  const r = document.documentElement.style;
  r.setProperty('--box-h', H + 'px');
  r.setProperty('--box-w', H * 0.64 + 'px');
  r.setProperty('--box-d', H * 0.085 + 'px');
  r.setProperty('--R', R + 'px');
  r.setProperty('--wi', R * 0.56 + 'px');
  if (S.lib.games.length) syncSlots();
}
addEventListener('resize', measure);

// ---------------------------------------------------------------- Boucle d'animation
let last = performance.now();
let visible = new Set();
function spring(o, target, dt) {
  const k = reduceMotion ? 0.5 : 0.085, damp = reduceMotion ? 0.3 : 0.74;
  o.vel += (target - o.pos) * k * dt;
  o.vel *= Math.pow(damp, dt);
  o.pos += o.vel * dt;
  if (Math.abs(target - o.pos) < 0.0008 && Math.abs(o.vel) < 0.0008) { o.pos = target; o.vel = 0; }
}
function frame(t) {
  const dt = Math.min(3, (t - last) / 16.667);
  last = t;
  pollPad(t);
  spring(S.home, S.home.sel, dt);
  const target = S.view === 'games' ? 1 : 0;
  LAY.k += (target - LAY.k) * Math.min(1, (reduceMotion ? 1 : 0.1) * dt);
  if (Math.abs(target - LAY.k) < 0.001) LAY.k = target;
  layout();
  frameHome();
  frameGames(t, dt);
  drawMotes(t);
  requestAnimationFrame(frame);
}
// Géométrie : roue à gauche (bord à 28 % de l'écran sur l'accueil, 11,5 % une console ouverte)
function layout() {
  const W = innerWidth, H = innerHeight;
  const R = H * 0.53;
  const ease = LAY.k * LAY.k * (3 - 2 * LAY.k);
  const edgeHome = clamp(W * 0.28, R * 0.62, R * 0.95);
  const edgeGames = clamp(W * 0.115, 110, R * 0.45);
  const edge = edgeHome + (edgeGames - edgeHome) * ease;
  const gap = W * 0.17 * (1 - ease) + W * 0.06 * ease;
  Object.assign(LAY, { R, edge, cx: edge - R, cy: H * 0.5, anchor: edge + gap, ease });
  const r = document.documentElement.style;
  r.setProperty('--edge', edge + 'px');
  r.setProperty('--anchor', LAY.anchor + 'px');
  r.setProperty('--glow-x', (LAY.anchor + W * 0.16) + 'px');
}
function cumAt(p) {
  const c = S.cum || [];
  if (!c.length) return p * (S.cumStep || 1);
  if (p <= 0) return p * (S.cumStep || 1);
  const n = c.length - 1;
  if (p >= n) return c[n] + (p - n) * (S.cumStep || 1);
  const f = Math.floor(p);
  return c[f] + (p - f) * (c[f + 1] - c[f]);
}
let lastGamesView = false;
function frameGames(t, dt) {
  const games = S.view === 'games';
  if (games !== lastGamesView) {
    lastGamesView = games;
    // Entrée dans une console : la rangée glisse depuis la droite ; sortie : on revient sur la rangée
    if (games) { S.pos = S.sel + (reduceMotion ? 0 : 1.6); S.vel = 0; }
    setZone('row', true);
  }
  if (!games) {
    if (visible.size) { for (const el of visible) el.style.display = 'none'; visible = new Set(); }
    return;
  }
  spring(S, S.sel, dt);
  S.flipCur += (S.flip - S.flipCur) * Math.min(1, 0.13 * dt);
  const { H } = S.dims;
  const W = S.dims.Wref || H * 0.66;
  const gap = S.dims.gap || H * 0.13;
  const anchor = S.dims.left || 100;
  const top = S.dims.rowTop || 140;
  const k = SEL_K - 1;
  const lo = Math.floor(S.pos) - 1, hi = Math.ceil(S.pos) + Math.ceil(innerWidth / (W + gap)) + 1;
  // Surplus de largeur des boîtes « en cours de sélection » (au plus deux, autour de S.pos)
  const grow = (j) => { const g = S.items[j]; const el = g && slots.get(g.id); return el ? (el._dims?.W || W) * k * clamp(1 - Math.abs(j - S.pos), 0, 1) : 0; };
  const f0 = Math.floor(S.pos), g0 = grow(f0), g1 = grow(f0 + 1);
  const base = cumAt(S.pos);
  const now = new Set();
  for (let i = Math.max(0, lo); i <= Math.min(S.items.length - 1, hi); i++) {
    const g = S.items[i];
    const el = slots.get(g.id);
    if (!el) continue;
    now.add(el);
    if (el.style.display === 'none') el.style.display = '';
    if (!el._hydrated) hydrate(el);
    const o = i - S.pos, a = Math.abs(o);
    const bw = el._dims?.W || W, bh = el._dims?.H || H;
    const selW = clamp(1 - a, 0, 1);
    const sc = 1 + k * selW;
    // Bord gauche : position cumulée + surplus des boîtes sélectionnées situées avant
    const extra = (i > f0 ? g0 : 0) + (i > f0 + 1 ? g1 : 0);
    const left = anchor + cumAt(i) - base + extra;
    const x = left + (bw * sc) / 2;
    const y = top + (bh * sc) / 2;
    const sel = i === S.sel;
    // Boîtes en 3D comme avant : les jeux suivants sont tournés et montrent leur tranche,
    // la sélectionnée garde un léger angle pour qu'on voie son épaisseur
    let ry = reduceMotion ? 0 : (o > 0 ? 26 : 14) * (1 - selW) + 20 * selW, rx = 0, fy = 0;
    if (!reduceMotion) {
      ry += clamp(S.vel * 90, -22, 22);
      let sp = S.spin.get(i);
      if (sp) {
        ry -= sp;
        sp *= Math.pow(0.9, dt);
        if (sp < 0.4) S.spin.delete(i); else S.spin.set(i, sp);
      }
      if (selW > 0) {
        ry += (S.device === 'mouse' ? S.mouse.x * 6 : Math.sin(t / 1700) * 3.5) * selW;
        rx = (S.device === 'mouse' ? -S.mouse.y * 3 : Math.sin(t / 2300) * 1.2) * selW;
        fy = Math.sin(t / 1900) * 2.5 * selW;
      }
    }
    if (sel) ry += S.flipCur * 180;
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${(y + fy).toFixed(2)}px, 0) rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
    // Les jeux déjà passés s'effacent vite à gauche de l'ancre
    el.style.opacity = (o < 0 ? clamp(1 + o * 1.6, 0, 1) : 1).toFixed(3);
    el.style.setProperty('--dim', (0.34 * (1 - selW)).toFixed(3));
    el.classList.toggle('is-selected', sel);
  }
  for (const el of visible) if (!now.has(el)) el.style.display = 'none';
  visible = now;
  syncActFocus();
}

// ---------------------------------------------------------------- Fond
let bgFlip = false, bgCurrent = null, bgTimer;
// Images de fond en basse définition (captures natives des consoles rétro : 240×160 en GBA…) : au lieu d'un
// agrandissement pixelisé, on les floute en fond d'ambiance (classe .is-lowres). Mesure mise en cache par URL.
const LOWRES_W = 960;
const imgWidthCache = new Map();
// Fond en basse définition (capture rétro 240×160…) : au lieu de l'agrandir (pixels baveux) ou de le flouter,
// on l'affiche net, agrandi d'un facteur ENTIER (pixel art propre), dans un cadre façon écran, sur un fond
// aux couleurs du jeu. Variables posées sur l'élément : --lr-w / --lr-h (taille affichée), --lr-img.
const imgSizeCache = new Map();
function markLowRes(el, url) {
  if (!el) return;
  if (!url) { el.classList.remove('is-lowres'); if (el.matches('.bg-layer')) document.body.classList.remove('bg-lowres'); return; }
  const set = (w, h) => {
    const low = w > 0 && w < LOWRES_W;
    el.classList.toggle('is-lowres', low);
    if (el.matches('.bg-layer')) document.body.classList.toggle('bg-lowres', low); // voiles allégés (capture encadrée)
    if (!low) return;
    let maxW = innerWidth * 0.5, maxH = innerHeight * 0.62;
    if (el.matches('.bg-layer')) {
      // écran jeux : en bas à droite, sous la rangée de boîtes et à droite du bloc d'infos
      const top = (S.dims.rowTop || innerHeight * 0.2) + (S.dims.H || innerHeight * 0.3) + innerHeight * 0.05;
      const bottom = ($('#hints')?.getBoundingClientRect().height || 80) + innerHeight * 0.05;
      maxW = innerWidth * 0.42; maxH = Math.max(innerHeight * 0.2, innerHeight - top - bottom);
      el.style.setProperty('--lr-bottom', `${bottom}px`);
    }
    // facteur entier si possible (pixels réguliers) ; au-delà de ×3, un facteur fractionnaire reste propre en « pixelated »
    const fit = Math.min(maxW / w, maxH / h);
    const k = Math.max(1, fit >= 3 ? Math.round(fit * 4) / 4 - (Math.round(fit * 4) / 4 > fit ? 0.25 : 0) : Math.floor(fit));
    el.style.setProperty('--lr-w', `${w * k}px`);
    el.style.setProperty('--lr-h', `${h * k}px`);
    el.style.setProperty('--lr-img', `url("${url}")`);
  };
  if (imgSizeCache.has(url)) return set(...imgSizeCache.get(url));
  const im = new Image();
  im.onload = () => { imgSizeCache.set(url, [im.naturalWidth, im.naturalHeight]); set(im.naturalWidth, im.naturalHeight); };
  im.src = url;
}
let bgTintColor = '';
function setBackground(url, tint) {
  bgTintColor = tint;
  $('#bgTint').style.background = `radial-gradient(ellipse 34% 48% at var(--glow-x, 50%) 50%, ${tint || 'transparent'}, transparent 100%)`;
  if (url === bgCurrent) return;
  bgCurrent = url;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => { // ≈150 ms : pas de scintillement quand on défile vite
    const next = bgFlip ? $('#bgA') : $('#bgB');
    const prev = bgFlip ? $('#bgB') : $('#bgA');
    bgFlip = !bgFlip;
    const apply = () => { next.style.backgroundImage = url ? `url("${url}")` : 'none'; next.style.setProperty('--lr-tint', bgTintColor || 'var(--accent)'); markLowRes(next, url); next.classList.add('on'); prev.classList.remove('on'); };
    if (!url) return apply();
    const img = new Image();
    img.onload = apply; img.onerror = apply;
    img.src = url;
  }, 150);
}

const motes = [];
let motesCtx, motesLast = 0;
function initMotes() {
  const c = $('#motes');
  motesCtx = c.getContext('2d');
  const fit = () => { c.width = innerWidth; c.height = innerHeight; };
  fit(); addEventListener('resize', fit);
  for (let i = 0; i < 42; i++) motes.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, s: 0.15 + Math.random() * 0.5, p: Math.random() * 6.28 });
}
let motesOff = false;
function drawMotes(t) {
  if (reduceMotion || !motesCtx || t - motesLast < 33 || document.hidden) return;
  motesLast = t;
  const c = motesCtx, w = c.canvas.width, h = c.canvas.height;
  // Écran jeux : pas de particules, le visuel du jeu suffit
  if (S.view === 'games') { if (!motesOff) { c.clearRect(0, 0, w, h); motesOff = true; } return; }
  motesOff = false;
  c.clearRect(0, 0, w, h);
  for (const m of motes) {
    m.y -= m.s / 2400; m.x += Math.sin(t / 3000 + m.p) / 9000;
    if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
    const a = 0.25 + 0.35 * Math.sin(t / 900 + m.p * 3);
    const gr = c.createRadialGradient(m.x * w, m.y * h, 0, m.x * w, m.y * h, m.r * 6);
    gr.addColorStop(0, `rgba(156, 200, 242, ${a})`);
    gr.addColorStop(1, 'rgba(156, 200, 242, 0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(m.x * w, m.y * h, m.r * 6, 0, 6.283); c.fill();
  }
}

// ---------------------------------------------------------------- Chrome
function updateBrand() {
  const t = $('#brandTitle');
  if (S.view === 'home') {
    t.className = 'brand-title is-home';
    t.innerHTML = '<span class="brand-mark" role="img" aria-label="RR Launcher">RR</span>';
    return;
  }
  const p = S.plat === 'all' ? null : plat(S.plat);
  t.className = 'brand-title platform';
  t.innerHTML = !p ? '<span class="brand-name">Tous les jeux</span>'
    : (S.platLogo[p.id] ? `<img class="brand-plat-logo" crossorigin="anonymous" src="${platUrl(S.platLogo[p.id])}" alt="" aria-hidden="true" />` : '')
      + `<span class="brand-name">${esc(p.name)}</span>`;
}
function updateChrome(force = false) {
  queueMicrotask(emitSelection);
  updateBrand();
  const g = S.items[S.sel];
  if (typeof setFootInfo === 'function') setFootInfo(S.items.length ? `${S.sel + 1} / ${S.items.length}` : '');
  if (!g) { setBackground('', S.plat !== 'all' ? plat(S.plat).color : ''); $('#capBadges').innerHTML = ''; return; }
  $('#capLogo').hidden = true;
  const title = $('#title');
  title.classList.remove('sr-only');
  if (force || title.dataset.id !== g.id) {
    const cap = $('#caption');
    cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
    title.textContent = g.name;
    title.dataset.id = g.id;
    const logo = $('#capGameLogo');
    // LOOK : nom du jeu en texte simple sous la rangée (réf. Switch) ; le logo image n'est plus affiché
    logo.hidden = true; logo.removeAttribute('src');
  }
  const p = plat(g.platform);
  const bits = [p.name, g.source === 'recomp' ? 'Recomp PC' : null, g.developer?.split(',')[0], yearOf(g), (g.genres || [])[0]].filter(Boolean); // RECOMP
  $('#subtitle').textContent = bits.join(' · ');
  renderCapBadges(g);
  renderCapActions(g);
  setBackground(heroOf(g), g.color || p.color);
}
// Puces d'état sous le titre du jeu : en cours, récupération des infos, temps de jeu, dernière session, favori
const BADGE_ICON = {
  fav: '<svg aria-hidden="true" viewBox="0 0 24 24" class="fill"><path d="M12 20.5s-7.5-4.6-9.6-9.2C.9 7.9 3 4 6.7 4c2.1 0 3.6 1.2 4.3 2.4h2C13.7 5.2 15.2 4 17.3 4 21 4 23.1 7.9 21.6 11.3 19.5 15.9 12 20.5 12 20.5z"/></svg>',
  time: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  last: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  emu: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 7.5v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
};
function renderCapBadges(g) {
  const box = $('#capBadges');
  if (!g) { box.innerHTML = ''; return; }
  const b = [];
  if (S.lib.running.includes(g.id)) b.push('<span class="badge live"><i class="dot"></i>En cours</span>');
  if (g.source === 'recomp') b.push('<span class="badge recomp">Recomp PC</span>'); // RECOMP : portage natif installé depuis Recomps
  if (g.metaStatus === 'loading') b.push(`<span class="badge busy"><span class="spinner tiny"></span>${esc(S.progress[g.id] || 'Récupération des infos…')}</span>`);
  if (g.kind === 'rom' && !S.lib.settings.emulators?.[g.platform]) b.push(`<span class="badge warn">${BADGE_ICON.emu}Émulateur à configurer</span>`);
  if (g.lastPlayed) {
    b.push(`<span class="badge time">${BADGE_ICON.time}${esc(fmtTime(g.playtime || 0))}</span>`);
    b.push(`<span class="badge last">${BADGE_ICON.last}${esc(fmtLast(g.lastPlayed))}</span>`);
  } else b.push(`<span class="badge time">${BADGE_ICON.time}Jamais lancé</span>`);
  if (g.favorite) b.push(`<span class="badge fav">${BADGE_ICON.fav}Favori</span>`);
  box.innerHTML = b.slice(0, 5).join('');
}
function renderCapActions(g) {
  const running = S.lib.running.includes(g.id);
  $('.cap-play-label').textContent = running ? 'En cours' : 'Jouer';
  $('.cap-play').classList.toggle('is-running', running);
  const fav = $('[data-cap="fav"]');
  fav.setAttribute('aria-pressed', String(!!g.favorite));
  const l = g.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
  fav.setAttribute('aria-label', l); fav.title = l;
}

// Zone de focus de l'écran jeux : la rangée de boîtes ou les boutons sous les infos (↓ / ↑)
const capBtns = () => $$('#capActions .cap-btn');
function setZone(z, silent = false) {
  if (z === 'actions' && (!S.items.length || S.view !== 'games')) return;
  if (S.zone === z) return;
  S.zone = z;
  if (z === 'actions') S.act = 0;
  document.body.classList.toggle('zone-actions', z === 'actions');
  S._actKey = '';
  if (z === 'row' && document.activeElement?.closest?.('#capActions')) document.activeElement.blur();
  if (!silent) sfx('move');
  renderHints();
}
function moveAct(d) {
  const n = capBtns().length;
  const i = clamp((S.act || 0) + d, 0, n - 1);
  if (i === S.act) return;
  S.act = i; S._actKey = ''; sfx('move');
}
function pressAct() { capBtns()[S.act || 0]?.click(); }
// Remet le focus visuel / DOM sur le bon bouton (y compris au retour d'un overlay, qui retire .is-focus)
function syncActFocus() {
  const on = S.zone === 'actions' && S.mode === 'main' && S.view === 'games' && S.items.length > 0;
  const key = on ? `${S.act}|${S.device}` : 'off';
  if (key === S._actKey) return;
  S._actKey = key;
  capBtns().forEach((b, i) => {
    const f = on && i === S.act;
    b.classList.toggle('is-focus', f && S.device !== 'mouse');
    b.classList.toggle('is-current', f);
    b.tabIndex = f || (!on && i === 0) ? 0 : -1;
  });
  if (on) capBtns()[S.act]?.focus({ preventScroll: true });
  if (!on && S.zone !== 'actions') document.body.classList.remove('zone-actions');
}
$('#capActions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cap]');
  if (!b || S.mode !== 'main') return;
  const i = capBtns().indexOf(b);
  if (S.zone === 'actions' && i >= 0) { S.act = i; S._actKey = ''; }
  const a = b.dataset.cap;
  if (a === 'play') play();
  else if (a === 'details') openGame(); // BOXOPEN
  else if (a === 'fav') toggleFav();
  if (S.device === 'mouse' && S.zone !== 'actions') b.blur();
});
// Un overlay qui se ferme retire .is-focus : on force la resynchronisation
document.addEventListener('focusin', () => { if (S.mode === 'main') S._actKey = ''; });
$('#catEmptyAll').addEventListener('click', () => setTab('all'));

function renderTabs() {
  const nav = $('#tabs');
  const pg = (k) => (S.device === 'pad' ? (S.padType === 'ps' ? { lb: 'L1', rb: 'R1' } : { lb: 'LB', rb: 'RB' })[k] : '');
  const g = (k, key) => (S.tabs.length > 1 ? `<span class="key-mini tab-glyph" data-glyph="${k}" data-key="${key}" aria-hidden="true">${pg(k)}</span>` : '');
  nav.innerHTML = g('lb', 'Q') + S.tabs.map((t) =>
    `<button class="tab" role="tab" aria-selected="${t.id === S.tab}" data-tab="${esc(t.id)}">${esc(t.label)}<span class="count">${t.n}</span></button>`).join('') + g('rb', 'E');
  const act = $('.tab[aria-selected="true"]', nav);
  if (act && S.view === 'games') act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});
function setTab(id) {
  if (id === S.tab) return;
  S.tab = id;
  S.flip = 0;
  computeItems();
  S.sel = 0; S.pos = reduceMotion ? 0 : 1.6; S.vel = 0; S.selId = S.items[0]?.id || null;
  if (!S.items.length) setZone('row', true);
  renderTabs(); syncSlots(); updateChrome(true);
  sfx('tab');
  scheduleSweep();
}
function cycleTab(d) {
  if (S.tabs.length < 2) return;
  const i = S.tabs.findIndex((t) => t.id === S.tab);
  setTab(S.tabs[(i + d + S.tabs.length) % S.tabs.length].id);
}

// ---------------------------------------------------------------- Navigation jeux
function select(i, { spin = true } = {}) {
  if (!S.items.length) return;
  i = clamp(i, 0, S.items.length - 1);
  if (i === S.sel) return;
  if (spin && !reduceMotion) S.spin.set(i, 360);
  S.sel = i;
  S.selId = S.items[i].id;
  S.flip = 0;
  updateChrome();
  sfx('move');
  scheduleSweep();
}
// Sélection courante (écran jeux) → RR 'selection' (appelé à chaque changement de jeu affiché)
let lastSelEmit = null;
function emitSelection() {
  const g = S.view === 'games' ? S.items[S.sel] || null : null;
  if (g?.id === lastSelEmit) return;
  lastSelEmit = g?.id || null;
  RR.emit('selection', g);
}
const move = (d) => select(S.sel + d, { spin: Math.abs(d) === 1 });
let slotClickT;
function onSlotClick(id) {
  if (S.mode !== 'main' || S.view !== 'games') return;
  const i = S.items.findIndex((g) => g.id === id);
  setZone('row', true);
  clearTimeout(slotClickT);
  // Clic sur la sélection = page du jeu (BOXOPEN ; différé pour laisser passer un double-clic = jouer)
  if (i === S.sel) slotClickT = setTimeout(() => { if (S.mode === 'main' && S.items[S.sel]?.id === id) openGame(); }, 240);
  else select(i);
}
function flip() { if (S.items.length) { S.flip = S.flip ? 0 : 1; sfx('flip'); } }

async function play(id = S.items[S.sel]?.id, opts = {}) {
  const g = S.lib.games.find((x) => x.id === id);
  if (!g) return;
  RR.emit('play', g, opts);
  if (!opts.force && guideBeforePlay(g)) return; // GUIDE : jeu déjà en cours → reprendre ; autre jeu en cours → demander
  if (LD.active) return; // LOADING : un lancement est déjà en cours
  if (!(await ldShow(g))) return; // LOADING : écran de chargement ; false = annulé (B / Échap)
  const r = await rr.launch(id);
  if (r.resumed) return ldHide();
  if (!r.ok) {
    ldHide();
    if (r.error === 'NO_EMULATOR') return askEmulator(r.platform, id);
    return toast(r.error || 'Impossible de lancer le jeu.', true);
  }
  ldCommitted(); // LOADING : l'écran reste jusqu'à l'apparition du jeu (launcher masqué), sa fin, ou 60 s
}
// ================================================================ LOADING : écran de lancement façon console
// Overlay plein écran #launching affiché AVANT rr.launch : bannière du jeu (zoom lent), logo au centre, anneau « Lancement… ».
// Reste ≥ 0,7 s (0,3 s si reduceMotion), puis rr.launch. B / Échap annulent tant que rr.launch n'est pas appelé.
// Après un lancement réussi, il disparaît au retour du launcher (win:visible / fin de session) ou après 12 s.
const LD = { active: false, committed: false, t0: 0, tCommit: 0, resolve: null, minT: null, safeT: null, hideT: null, id: null };
const LD_MIN = reduceMotion ? 300 : 700; // court : le lancement réel démarre après ce délai (B / Échap pour annuler)
function ldShow(g) {
  const el = $('#launching');
  const m = g.media || {};
  const p = plat(g.platform);
  const banner = m.hero || m.header || (g.screenshots || [])[0];
  const url = banner ? mediaUrl(g, banner) : m.cover ? mediaUrl(g, m.cover) : '';
  const kind = banner ? '' : m.cover ? 'is-cover' : 'is-none';
  clearTimeout(LD.hideT);
  Object.assign(LD, { active: true, committed: false, id: g.id, t0: performance.now() });
  el.className = '';
  el.innerHTML = `<div class="ld-bg ${kind}"></div><div class="ld-veil"></div>
    <div class="ld-logo">${m.logo ? `<img src="${mediaUrl(g, m.logo)}" alt="${esc(g.name)}" />` : `<div class="ld-name">${esc(g.name)}</div>`}</div>
    <div class="ld-hint">${glyph('b')}<span>Annuler</span></div>
    <div class="ld-status"><div class="ld-ring"></div><div class="ld-txt"><b>Lancement…</b><span>${esc(p.name || '')}</span></div></div>`;
  el.setAttribute('aria-label', `Lancement de ${g.name}`);
  el.hidden = false;
  sfx('launch');
  return new Promise((resolve) => {
    LD.resolve = resolve;
    const show = () => { if (!LD.active || LD.id !== g.id) return; void el.offsetWidth; el.classList.add('in'); LD.minT = setTimeout(() => { LD.minT = null; LD.resolve = null; resolve(true); }, LD_MIN); };
    if (!url) return show();
    // bannière décodée avant le fondu (évite un fond noir qui « saute »), 300 ms au plus
    $('.ld-bg', el).style.backgroundImage = `url("${url}")`;
    markLowRes($('.ld-bg', el), url);
    const im = new Image(); im.src = url;
    Promise.race([im.decode().catch(() => {}), new Promise((r) => setTimeout(r, 300))]).then(show);
  });
}
function ldCommitted() {
  LD.committed = true; LD.tCommit = performance.now();
  $('#launching').classList.add('go');
  clearTimeout(LD.safeT);
  LD.safeT = setTimeout(() => ldHide(), 60000); // le launcher se masque dès que la fenêtre du jeu apparaît (processus principal)
}
function ldHide(now = false) {
  if (!LD.active) return;
  const el = $('#launching');
  clearTimeout(LD.minT); clearTimeout(LD.safeT);
  if (LD.resolve) { LD.resolve(false); LD.resolve = null; }
  LD.active = false; LD.committed = false; LD.id = null;
  const end = () => { if (!LD.active) { el.hidden = true; el.className = ''; el.innerHTML = ''; } };
  if (now || reduceMotion) return end();
  el.classList.add('out');
  LD.hideT = setTimeout(end, 320);
}
function ldCancel() { if (!LD.active || LD.committed) return; sfx('back'); ldHide(); }
rr.onVisible((v) => { if (v && LD.active && LD.committed && performance.now() - LD.tCommit > 1000) ldHide(); });
rr.onRunning(({ id, running }) => { if (!running && LD.active && LD.committed && id === LD.id) ldHide(); });
// ================================================================ fin LOADING

function askEmulator(pid, gameId) {
  const p = plat(pid);
  const names = (p.emulators || []).map((e) => e.name).join(', ');
  openPrompt({
    title: `Aucun émulateur pour ${p.name}`,
    icon: 'emu',
    body: `<p class="dim">Choisis l’exécutable de ton émulateur ${names ? `(${esc(names)})` : ''}. Les bons paramètres de lancement sont appliqués automatiquement.</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Choisir l’émulateur…', primary: true, onClick: async () => {
        const conf = await rr.pickEmulator(pid);
        if (!conf) return;
        closeOverlay();
        toast(`${conf.name} configuré pour ${p.name}`, 'success');
        if (gameId) play(gameId);
      } },
    ],
  });
}
async function toggleFav(id = S.items[S.sel]?.id) {
  const g = S.lib.games.find((x) => x.id === id);
  if (!g) return;
  await rr.updateGame(id, { favorite: !g.favorite });
  sfx('toggle');
  toast(!g.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'success');
}

// ---------------------------------------------------------------- Overlays & focus spatial
// IMPORTER : libellés des launchers importés
const SRC_LABEL = { recomp: 'Recomp PC',  xbox: 'Xbox', ea: 'EA app', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net', amazon: 'Amazon Games', itch: 'itch.io' };
const OVERLAYS = { details: '#details', add: '#addDialog', hub: '#addHub', scan: '#scan', menu: '#menu', settings: '#settings', prompt: '#prompt', ingame: '#ingame' };
// Affichage / masquage des overlays avec une courte sortie animée (plus rapide que l'entrée)
function showOverlayEl(el) {
  clearTimeout(el._closeT);
  el.classList.remove('is-closing');
  el.hidden = false;
}
function hideOverlayEl(el, animate) {
  if (el.hidden) return;
  clearTimeout(el._closeT);
  if (!animate || reduceMotion) { el.classList.remove('is-closing'); el.hidden = true; return; }
  el.classList.add('is-closing');
  el._closeT = setTimeout(() => { el.hidden = true; el.classList.remove('is-closing'); }, 170);
}
const returnFocus = {};
function openOverlay(mode) {
  if (S.mode === mode) return;
  if (S.mode !== 'main') { S.stack.push(S.mode); returnFocus[S.mode] = document.activeElement; }
  S.mode = mode;
  for (const [m, sel] of Object.entries(OVERLAYS)) {
    if (m === mode || S.stack.includes(m)) showOverlayEl($(sel)); else hideOverlayEl($(sel), false);
  }
  document.body.classList.add('has-overlay');
  setTimeout(() => focusFirst(), 30);
  renderHints();
  sfx('confirm');
}
function closeOverlay(silent = false) {
  if (S.mode === 'main') return;
  if (S.mode === 'scan') rr.cancelScan();
  if (S.mode === 'ingame') igOnClose(); // GUIDE
  hideOverlayEl($(OVERLAYS[S.mode]), true);
  S.mode = S.stack.pop() || 'main';
  if (S.mode !== 'main') {
    const back = returnFocus[S.mode];
    delete returnFocus[S.mode];
    setTimeout(() => (back && navables().includes(back) ? setFocus(back) : focusFirst()), 30);
  } else { document.activeElement?.blur(); document.body.classList.remove('has-overlay'); }
  renderHints();
  if (!silent) sfx('back');
}
function closeAll() { while (S.mode !== 'main') closeOverlay(true); }
// Retour contextuel : ferme d'abord un sous-menu ouvert, sinon l'overlay
function overlayBack() {
  if (S.mode === 'recomp' && window.recompBack?.()) return; // RECOMP : la fiche repose la boîte sur le rayon
  if (S.mode === 'details' && !$('#dSub').hidden) return toggleImageMenu(false);
  if (S.mode === 'ingame') return igBack(); // GUIDE : B / Échap = sous-menu précédent, sinon reprendre le jeu
  if (S.mode === 'details' && !S.stack.length) return closeGamePage(); // BOXOPEN : la boîte se referme
  closeOverlay();
}
function navables() {
  const root = $(OVERLAYS[S.mode]) || $('#empty');
  return $$('[data-nav]', root).filter((el) => el.offsetParent !== null && !el.disabled);
}
function setFocus(el) {
  $$('.is-focus').forEach((x) => x.classList.remove('is-focus'));
  if (!el) return;
  el.focus({ preventScroll: false });
  if (S.device !== 'mouse') el.classList.add('is-focus');
  el.scrollIntoView({ block: 'nearest' });
  if (S.mode === 'details') renderHints(); // BOXOPEN : libellé de A selon le bouton focalisé
}
function focusFirst() {
  const list = navables();
  const pref = list.find((el) => el.matches('[data-default]')) || list.find((el) => el.matches('.primary, [aria-selected="true"]')) || list[0];
  setFocus(S.mode === 'add' && !$('#addStep2').hidden ? $('#addConfirm') : pref);
}
function spatial(dir) {
  const list = navables();
  if (!list.length) return;
  const cur = list.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) return setFocus(list[0]);
  const r0 = cur.getBoundingClientRect();
  const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bestD = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    const ok = { left: dx < -4 && Math.abs(dy) < r0.height * 1.2 + 20, right: dx > 4 && Math.abs(dy) < r0.height * 1.2 + 20, up: dy < -4, down: dy > 4 }[dir];
    if (!ok) continue;
    const d = dir === 'left' || dir === 'right' ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
    if (d < bestD) { bestD = d; best = el; }
  }
  if (!best && (dir === 'down' || dir === 'right')) best = list[(list.indexOf(cur) + 1) % list.length];
  if (!best && (dir === 'up' || dir === 'left')) best = list[(list.indexOf(cur) - 1 + list.length) % list.length];
  if (best) { setFocus(best); sfx('move'); }
}

// ---------------------------------------------------------------- Détails
function openDetails() {
  if (!S.items[S.sel]) return;
  $('#dSub').hidden = true;
  $('[data-act="images"]').setAttribute('aria-expanded', 'false');
  renderDetails();
  openOverlay('details');
}
function renderDetails() {
  const g = S.items[S.sel] || S.lib.games.find((x) => x.id === S.selId);
  if (!g) return closeAll();
  const p = plat(g.platform);
  $('#dBg').style.backgroundImage = heroOf(g) ? `url("${heroOf(g)}")` : 'none';
  markLowRes($('#dBg'), heroOf(g));
  $('#dPlatform').innerHTML = `<i style="background:${p.color}"></i>${esc(p.name)}${g.kind === 'steam' ? ' · Steam' : g.kind === 'epic' ? ' · Epic Games' : g.source === 'gog' ? ' · GOG' : SRC_LABEL[g.source] ? ' · ' + SRC_LABEL[g.source] : g.kind === 'rom' ? ' · Émulation' : ''}`;
  const logo = $('#dLogo');
  if (g.media?.logo) { logo.src = mediaUrl(g, g.media.logo); logo.alt = g.name; logo.hidden = false; $('#dTitle').hidden = true; }
  else { logo.hidden = true; $('#dTitle').hidden = false; }
  $('#dTitle').textContent = g.name;
  $('#dMeta').textContent = [g.developer, g.publisher && g.publisher !== g.developer ? g.publisher : '', g.releaseDate].filter(Boolean).join(' · ');
  $('#dTags').innerHTML = (g.genres || []).map((x) => `<span>${esc(x)}</span>`).join('') + (g.metacritic ? `<span>Metacritic ${g.metacritic}</span>` : '');
  const desc = [g.description, g.about && g.about !== g.description ? g.about : ''].filter(Boolean).join('\n\n');
  $('#dDesc').textContent = g.metaStatus === 'loading' ? 'Récupération des informations…' : desc || 'Aucune description trouvée. Utilise « Corriger le jeu » pour choisir la bonne correspondance.';
  $('#dStats').innerHTML = `
    <div><b>${fmtTime(g.playtime)}</b><span>Temps de jeu</span></div>
    <div><b>${fmtLast(g.lastPlayed)}</b><span>Dernière session</span></div>
    <div><b>${g.playCount || 0}</b><span>Lancement${(g.playCount || 0) > 1 ? 's' : ''}</span></div>`;
  $('#dDesc').classList.toggle('is-loading', g.metaStatus === 'loading');
  requestAnimationFrame(() => { const d = $('#dDesc'); d.classList.toggle('is-overflow', d.scrollHeight > d.clientHeight + 2); });
  const fav = $('#dFav');
  fav.setAttribute('aria-pressed', !!g.favorite);
  $('.d-fav-label', fav).textContent = g.favorite ? 'Favori' : 'Ajouter aux favoris';
  fav.title = g.favorite ? 'Retirer des favoris' : '';
  const running = S.lib.running.includes(g.id);
  $('.d-play-label').textContent = running ? 'En cours…' : 'Jouer';
  $('.d-play').classList.toggle('is-running', running);
  // BOXOPEN : bande jaquette + captures en bas de la page du jeu
  const shots = (g.screenshots || []).slice(0, 5);
  $('#dShots').classList.toggle('cover-only', !shots.length);
  $('#dShots').innerHTML = (g.media?.cover ? `<div class="d-shot d-cover-tile" style="background-image:url('${mediaUrl(g, g.media.cover)}')"></div>` : '')
    + shots.map((s) => `<div class="d-shot" style="background-image:url('${mediaUrl(g, s)}')"></div>`).join('');
  renderDetailsMedia(g); // BOXOPEN
  if (!$('#dSub').hidden) renderImageMenu(g);
}
const IMG_KINDS = [
  { k: 'cover', l: 'Jaquette', h: 'Avant de la boîte' },
  { k: 'back', l: 'Dos', h: 'Arrière de la boîte' },
  { k: 'hero', l: 'Fond', h: 'Image plein écran' },
  { k: 'logo', l: 'Logo', h: 'Titre détouré' },
];
function renderImageMenu(g) {
  const fileOf = (k) => (k === 'hero' ? g.media?.hero || g.media?.header : g.media?.[k]);
  $('#dSub').innerHTML = `
    <div class="d-sub-head"><strong id="dSubTitle">Remplacer une image</strong><span class="dim">Choisis un fichier sur ton PC (PNG, JPG, WebP)</span></div>
    <div class="img-grid">${IMG_KINDS.map(({ k, l, h }) => {
      const f = fileOf(k);
      const prev = f ? `<span class="img-prev ${k}" style="background-image:url('${mediaUrl(g, f)}')"></span>` : '<span class="img-prev none">Aucune</span>';
      return `<button class="img-tile" data-img="${k}" data-nav>${prev}<span class="img-l">${l}</span><span class="img-h">${h}</span></button>`;
    }).join('')}</div>`;
}
function toggleImageMenu(open) {
  const sub = $('#dSub');
  const btn = $('[data-act="images"]');
  const g = S.items[S.sel];
  open = open ?? sub.hidden;
  if (open && g) renderImageMenu(g);
  sub.hidden = !open;
  btn.setAttribute('aria-expanded', open);
  if (open) { setFocus($('[data-img]', sub)); sfx('toggle'); } else setFocus(btn);
  renderHints();
}
$('#dActions').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const g = S.items[S.sel];
  if (!g) return;
  const act = b.dataset.act;
  if (act === 'play') play(g.id);
  if (act === 'fav') toggleFav(g.id);
  if (act === 'rematch') openAdd({ rematch: g });
  if (act === 'folder') rr.openFolder(g.id);
  if (act === 'remove') confirmRemove(g);
  if (act === 'edit') openEdit(g);
  if (act === 'images') toggleImageMenu();
});
$('#dSub').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-img]');
  if (!b) return;
  b.classList.add('is-busy');
  const r = await rr.setImage(S.items[S.sel].id, b.dataset.img).catch(() => null);
  b.classList.remove('is-busy');
  if (r) toast(`Image « ${IMG_KINDS.find((x) => x.k === b.dataset.img)?.l || ''} » mise à jour`, 'success');
});

// ================================================================ BOXOPEN : la boîte s'ouvre, le disque (ou la cartouche) sort → page du jeu
// Couche d'animation indépendante (#boxopen, styles dans boxopen.css) : on clone la boîte sélectionnée, on la pose
// au centre-gauche, le couvercle (.front) pivote sur la charnière, le support sort et tourne, puis fondu vers #details.
// Tout passe par Web Animations (transform / opacity). Interruptible : B annule, A saute. Mouvement réduit : simple fondu.
const BO_MEDIA = {
  pc: 'dvd', xbox: 'dvd', x360: 'dvd', ps2: 'ps2', ps3: 'bluray', wiiu: 'bluray', ps1: 'ps1', wii: 'wii', gc: 'mini', psp: 'umd', dc: 'gd',
  switch: 'c:switch', switch2: 'c:switch', nds: 'c:ds', '3ds': 'c:ds3', gb: 'c:gb', gba: 'c:gba', snes: 'c:snes', n64: 'c:n64', nes: 'c:nes', md: 'c:md', vita: 'c:vita',
};
// Disques : taille relative, face argentée (dessus) et face gravée (dessous) — couleurs d'objets physiques, pas d'interface
const BO_DISC = {
  dvd: { s: 1, base: '#d6dae0', under: '#b7b2cc' },
  ps2: { s: 1, base: '#d6dae0', under: '#3b4c9e' },
  ps1: { s: 1, base: '#d0d3d8', under: '#0d0d11' },
  bluray: { s: 1, base: '#c3d0ec', under: '#5f80d0' },
  wii: { s: 1, base: '#e3e5e9', under: '#c4c8d0' },
  mini: { s: 0.66, base: '#d6dae0', under: '#bdbdc8' },
  umd: { s: 0.56, base: '#d6dae0', under: '#b9bcc6' },
  gd: { s: 1, base: '#d9d5c8', under: '#cbbd93' },
};
// Cartouches : r = largeur / hauteur, k = grand côté relatif à la boîte, c = plastique, li = marges de l'étiquette
const BO_CART = {
  switch: { r: 0.68, k: 0.6, c: '#2b2b30', li: '8% 8% 15% 8%', cr: '10%' },
  ds: { r: 1.06, k: 0.5, c: '#3a3a40', li: '8% 8% 28% 8%', cr: '7%', grip: 1 },
  ds3: { r: 1.06, k: 0.5, c: '#e6e7ea', li: '8% 8% 28% 8%', cr: '7%', grip: 1 },
  gb: { r: 0.88, k: 0.72, c: '#a9a7a2', li: '25% 11% 13% 11%', cr: '3% 3% 9% 9%', clip: 'polygon(0 0, 89% 0, 100% 10%, 100% 100%, 0 100%)', top: 1 },
  gba: { r: 1.6, k: 0.72, c: '#3d3a48', li: '16% 9% 11% 9%', cr: '6% 6% 12% 12%' },
  snes: { r: 1.3, k: 0.86, c: '#9b99a2', li: '8% 12% 36% 12%', cr: '6% 6% 3% 3%', grip: 1 },
  n64: { r: 1.3, k: 0.86, c: '#36363c', li: '10% 12% 33% 12%', cr: '4%', clip: 'polygon(5% 0, 95% 0, 100% 14%, 100% 100%, 0 100%, 0 14%)', grip: 1 },
  nes: { r: 0.9, k: 0.8, c: '#8d8d92', li: '7% 10% 40% 10%', cr: '3%', grip: 1 },
  md: { r: 0.95, k: 0.8, c: '#17171a', li: '8% 9% 30% 9%', cr: '5% 5% 3% 3%', grip: 1 },
  vita: { r: 0.73, k: 0.54, c: '#1d1d22', li: '9% 8% 14% 8%', cr: '9%' },
};
function boMediaKind(g) {
  const k = BO_MEDIA[g.platform] || (caseInfo(g).style === 'card' ? 'c:snes' : 'dvd');
  return k.startsWith('c:') ? { type: 'cart', v: k.slice(2) } : { type: 'disc', v: k };
}
function boLabel(g) {
  const f = g.media?.cover || g.media?.hero || g.media?.header;
  const fb = `linear-gradient(150deg, ${g.color || plat(g.platform).color}, #0b0b16)`;
  return f ? `url('${mediaUrl(g, f)}') center / cover no-repeat, ${fb}` : fb;
}
// HTML d'un disque / d'une cartouche à l'échelle « ref » (px) : utilisé par l'animation et par la page du jeu
function boMediaHTML(g, ref) {
  const m = boMediaKind(g);
  if (m.type === 'disc') {
    const d = BO_DISC[m.v] || BO_DISC.dvd;
    const dia = Math.round(ref * d.s);
    return { ...m, w: dia, h: dia, html: `
      <div class="rr-disc" data-disc="${m.v}" style="--d:${dia}px;--disc-base:${d.base};--disc-under:${d.under};--label:${boLabel(g)}">
        <div class="disc-spin"><div class="disc-face disc-top"><div class="disc-label"></div></div><div class="disc-face disc-under"></div></div>
        <div class="disc-sheen"></div>
      </div>` };
  }
  const c = BO_CART[m.v] || BO_CART.snes;
  const long = ref * c.k;
  const w = Math.round(c.r >= 1 ? long : long * c.r), h = Math.round(c.r >= 1 ? long / c.r : long);
  const clip = c.clip ? `--clip:${c.clip};` : '';
  return { ...m, w, h, html: `
    <div class="rr-cart" data-cart="${m.v}" style="width:${w}px;height:${h}px;--cart:${c.c};--li:${c.li};--cr:${c.cr};${clip}--label:${boLabel(g)}">
      <div class="cart-spin">
        <div class="cart-face cart-front"><div class="cart-label"></div>${c.grip ? '<i class="cart-grip"></i>' : ''}${c.top ? '<i class="cart-grip top"></i>' : ''}</div>
        <div class="cart-face cart-back"><i class="cart-grip"></i><i class="cart-pins"></i></div>
      </div>
    </div>` };
}

const BO = { busy: false, kind: '', anims: [], timers: [], root: null, slot: null, opened: false, gameId: null };
const BO_T = { move: 420, doorAt: 240, door: 460, liftAt: 600, lift: 420, spinAt: 600, outAt: 1040, end: 1360 };
const BO_DOOR = -160;
// Pose de la boîte ouverte (centre-gauche, légèrement tournée face caméra)
function boPose(d) {
  const s = Math.min(innerHeight * 0.58 / d.H, innerWidth * 0.27 / d.W);
  // le couvercle s'ouvre vers la gauche : on garde sa largeur à l'écran
  return { x: Math.max(innerWidth * 0.36, innerWidth * 0.05 + 1.45 * d.W * s), y: innerHeight * 0.5, s, ry: -20, rx: 6 };
}
const boRig = (d, p) => `translate3d(${(p.x - d.W / 2).toFixed(1)}px, ${(p.y - d.H / 2).toFixed(1)}px, 0) rotateY(${p.ry}deg) rotateX(${p.rx}deg) scale(${p.s.toFixed(4)})`;
function boFrom(slot, d) {
  const r = $('.front', slot).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.height / d.H, ry: 0, rx: 0 };
}
function boBuild(g, slot) {
  const d = slot._dims || { W: S.dims.H * 0.64, H: S.dims.H, D: S.dims.H * 0.085 };
  const m = boMediaHTML(g, 0.9 * Math.min(d.W, d.H));
  const root = document.createElement('div');
  root.id = 'boxopen';
  root.setAttribute('aria-hidden', 'true');
  const hero = heroOf(g);
  root.innerHTML = `<div class="bo-bg"${hero ? ` style="background-image:url('${hero}')"` : ''}></div><div class="bo-scene"><div class="bo-rig"></div></div>`;
  const rig = $('.bo-rig', root);
  rig.style.cssText = `--box-w:${d.W}px;--box-h:${d.H}px;--box-d:${d.D}px;width:${d.W}px;height:${d.H}px`;
  const box = $('.box', slot).cloneNode(true);
  $('.reflect', box)?.remove();
  box.classList.add('bo-box');
  const front = $('.front', box);
  const door = document.createElement('div');
  door.className = 'bo-door';
  front.replaceWith(door);
  door.append(front);
  door.insertAdjacentHTML('beforeend', '<div class="bo-door-in"><i></i><i></i></div>');
  box.insertAdjacentHTML('afterbegin', `<div class="bo-tray" data-media="${m.type}"><i class="bo-holder" style="width:${m.w * 1.05}px;height:${m.h * 1.05}px"></i></div><div class="bo-wall l"></div><div class="bo-wall r"></div><div class="bo-wall t"></div><div class="bo-wall b"></div>`);
  box.insertAdjacentHTML('beforeend', `<div class="bo-media" style="left:${(d.W - m.w) / 2}px;top:${(d.H - m.h) / 2}px;width:${m.w}px;height:${m.h}px"><div class="bo-flip">${m.html}</div></div>`);
  rig.append(box);
  root.addEventListener('mousedown', (e) => { e.preventDefault(); if (BO.kind === 'open') boSkip(); else boFinish(); });
  document.body.append(root);
  return { root, rig, door, d, m, bg: $('.bo-bg', root), scene: $('.bo-scene', root), media: $('.bo-media', root), flip: $('.bo-flip', root), spin: $('.disc-spin, .cart-spin', root) };
}
function boAnim(el, frames, delay, duration, easing = 'cubic-bezier(.2,.8,.2,1)') {
  const a = el.animate(frames, { delay, duration, easing, fill: 'both' });
  BO.anims.push(a);
  return a;
}
function boClear() {
  BO.anims.forEach((a) => a.cancel());
  BO.timers.forEach(clearTimeout);
  BO.anims = []; BO.timers = [];
  BO.root?.remove(); BO.root = null;
  BO.slot?.classList.remove('bo-hide'); BO.slot = null;
  BO.busy = false; BO.kind = '';
  document.body.classList.remove('bo-on');
}
// Point d'entrée : A / Entrée / clic / X / I / « Détails » dans l'écran jeux
function openGame() {
  if (BO.busy || S.mode !== 'main' || S.view !== 'games') return;
  const g = S.items[S.sel];
  if (!g) return;
  const slot = slots.get(g.id);
  if (reduceMotion || !slot || slot.style.display === 'none' || !$('.front', slot)) return openDetails();
  S.flip = 0; S.flipCur = 0;
  frameGames(performance.now(), 0); // repose la boîte (sans retournement) avant de la mesurer
  const L = boBuild(g, slot);
  const { d } = L;
  const from = boFrom(slot, d), to = boPose(d);
  Object.assign(BO, { busy: true, kind: 'open', root: L.root, slot, opened: false, gameId: g.id });
  slot.classList.add('bo-hide');
  document.body.classList.add('bo-on');
  L.scene.style.perspectiveOrigin = `${to.x}px ${to.y}px`;
  const zIn = -d.D / 2 + 2;
  sfx('boxopen');
  boAnim(L.bg, [{ opacity: 0 }, { opacity: 1 }], 0, 320, 'ease-out');
  boAnim(L.rig, [{ transform: boRig(d, from) }, { transform: boRig(d, to) }], 0, BO_T.move);
  boAnim(L.door, [
    { transform: `translateZ(${d.D / 2}px) rotateY(0deg)` },
    { transform: `translateZ(${d.D / 2}px) rotateY(-12deg)`, offset: 0.18 },
    { transform: `translateZ(${d.D / 2}px) rotateY(${BO_DOOR}deg)` },
  ], BO_T.doorAt, BO_T.door, 'cubic-bezier(.55,0,.25,1)');
  const outX = d.W * 0.95, outZ = d.D * 2.6 + d.H * 0.08;
  boAnim(L.media, [
    { transform: `translate3d(0px, 0px, ${zIn}px) rotateY(0deg) rotateX(0deg) scale(1)` },
    { transform: `translate3d(${d.W * 0.08}px, ${-d.H * 0.02}px, ${d.D * 1.6}px) rotateY(4deg) rotateX(0deg) scale(1.02)`, offset: 0.3 },
    { transform: `translate3d(${outX}px, ${-d.H * 0.03}px, ${outZ}px) rotateY(${-to.ry + 2}deg) rotateX(${-to.rx - 4}deg) scale(1.16)` },
  ], BO_T.liftAt, BO_T.lift, 'cubic-bezier(.45,0,.2,1)');
  boAnim(L.flip, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(360deg)' }], BO_T.liftAt + 80, 520, 'cubic-bezier(.5,0,.3,1)');
  if (L.m.type === 'disc') {
    boAnim(L.spin, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(1620deg)' }], BO_T.spinAt, BO_T.end - BO_T.spinAt, 'cubic-bezier(.55,0,1,.7)');
  } else {
    boAnim(L.spin, [{ transform: 'rotate(0deg) translateY(0)' }, { transform: 'rotate(-6deg) translateY(-4%)' }, { transform: 'rotate(0deg) translateY(0)' }], BO_T.spinAt + 400, 360, 'ease-in-out');
  }
  // Fondu / zoom vers la page du jeu
  L.scene.style.transformOrigin = `${to.x + outX * to.s * 0.8}px ${to.y}px`;
  boAnim(L.scene, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.14)' }], BO_T.outAt, BO_T.end - BO_T.outAt, 'cubic-bezier(.5,0,.75,0)');
  boAnim(L.bg, [{ opacity: 1 }, { opacity: 0 }], BO_T.outAt + 60, BO_T.end - BO_T.outAt - 60, 'ease-in');
  BO.timers.push(setTimeout(boOpenPage, BO_T.outAt));
  BO.timers.push(setTimeout(() => { boClear(); renderHints(); }, BO_T.end + 20));
  renderHints();
}
function boOpenPage() {
  if (BO.opened) return;
  BO.opened = true;
  if (S.mode === 'main' && S.items[S.sel]?.id === BO.gameId) openDetails();
}
// A pendant l'ouverture : on arrive tout de suite sur la page
function boSkip() {
  if (BO.kind !== 'open') return;
  boOpenPage();
  boClear();
  renderHints();
}
// B pendant l'ouverture : on annule, la boîte reprend sa place
function boCancel() {
  if (BO.kind !== 'open') return;
  BO.timers.forEach(clearTimeout); BO.timers = [];
  if (BO.opened) closeOverlay(true);
  BO.kind = 'cancel';
  sfx('back');
  const a = BO.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'both' });
  BO.anims.push(a);
  a.onfinish = () => { boClear(); renderHints(); };
  renderHints();
}
// Fin immédiate (fermeture ou annulation en cours)
function boFinish() { if (BO.busy && BO.kind !== 'open') { boClear(); renderHints(); } }
// B sur la page du jeu : la boîte se referme et retourne dans la rangée
function closeGamePage() {
  const g = S.items[S.sel];
  const slot = g && slots.get(g.id);
  if (BO.busy) boClear();
  if (reduceMotion || S.view !== 'games' || !slot || slot.style.display === 'none' || !$('.front', slot)) return closeOverlay();
  const L = boBuild(g, slot);
  const { d } = L;
  const to = boPose(d), from = boFrom(slot, d);
  closeOverlay(true);
  Object.assign(BO, { busy: true, kind: 'close', root: L.root, slot, opened: false, gameId: g.id });
  slot.classList.add('bo-hide');
  document.body.classList.add('bo-on');
  L.scene.style.perspectiveOrigin = `${to.x}px ${to.y}px`;
  sfx('boxclose');
  const zIn = -d.D / 2 + 2;
  boAnim(L.media, [
    { transform: `translate3d(${d.W * 0.6}px, 0px, ${d.D * 2}px) scale(1.06)`, opacity: 0.4 },
    { transform: `translate3d(0px, 0px, ${zIn}px) scale(1)`, opacity: 1 },
  ], 0, 200, 'cubic-bezier(.3,0,.2,1)');
  boAnim(L.door, [
    { transform: `translateZ(${d.D / 2}px) rotateY(${BO_DOOR}deg)` },
    { transform: `translateZ(${d.D / 2}px) rotateY(0deg)` },
  ], 80, 280, 'cubic-bezier(.5,0,.4,1)');
  boAnim(L.rig, [{ transform: boRig(d, to) }, { transform: boRig(d, from) }], 280, 300, 'cubic-bezier(.4,0,.2,1)');
  boAnim(L.bg, [{ opacity: 1 }, { opacity: 0 }], 240, 320, 'ease-in-out');
  BO.timers.push(setTimeout(() => { boClear(); renderHints(); }, 600));
  renderHints();
}
// Petit disque / petite cartouche à côté du titre, sur la page du jeu
function renderDetailsMedia(g) {
  const el = $('#dMedia');
  if (!el) return;
  const key = `${g.id}|${g.mediaVersion || 0}|${g.platform}`;
  if (el._key === key) return;
  el._key = key;
  const m = boMediaHTML(g, 118);
  el.dataset.media = m.type;
  el.innerHTML = m.html;
}
// ================================================================ fin BOXOPEN

// ---------------------------------------------------------------- Invites
const PROMPT_ICON = {
  danger: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg>',
  emu: '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-3.95 3.4l-.9 6.1A2.9 2.9 0 0 0 6.6 16.8L8.5 15h7l1.9 1.8a2.9 2.9 0 0 0 4.75-2.3l-.9-6.1A4 4 0 0 0 17.3 5z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M13 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5V8H16"/></svg>',
};
function openPrompt({ title, body = '', actions, icon = null, tone = '' }) {
  $('#pTitle').textContent = title;
  $('#pBody').innerHTML = body;
  const ic = $('#pIcon');
  ic.hidden = !icon;
  ic.className = 'p-icon' + (tone ? ' ' + tone : '');
  ic.innerHTML = icon ? PROMPT_ICON[icon] || '' : '';
  const box = $('#pActions');
  box.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
    b.textContent = a.label;
    b.dataset.nav = '';
    if (a.focus) b.dataset.default = '';
    b.addEventListener('click', a.onClick);
    box.appendChild(b);
  });
  if (S.mode === 'prompt') { showOverlayEl($('#prompt')); setTimeout(focusFirst, 30); }
  else openOverlay('prompt');
}
function confirmRemove(g) {
  openPrompt({
    title: `Retirer « ${g.name} » ?`,
    icon: 'danger', tone: 'danger',
    body: `<p class="dim">Le jeu est seulement retiré du launcher : ses fichiers et ses sauvegardes restent sur ton disque. Tu pourras le rajouter à tout moment.</p>`,
    actions: [
      { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
      { label: 'Retirer du launcher', danger: true, primary: true, onClick: async () => { await rr.removeGame(g.id); closeAll(); toast(`« ${g.name} » retiré`, 'success'); } },
    ],
  });
}
function quitAsk() {
  closeAll();
  openPrompt({
    title: 'Quitter RR Launcher ?',
    icon: 'power',
    body: `<p class="dim">« Réduire » le garde prêt en arrière-plan (icône près de l’horloge Windows, ou <b>Ctrl+Alt+L</b>).</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Réduire', onClick: () => { closeAll(); rr.minimize(); } },
      { label: 'Quitter', primary: true, onClick: () => rr.quit() },
    ],
  });
}
function openEdit(g) {
  const isRom = g.kind === 'rom';
  const file = g.romPath || g.exePath || g.launchUri || '';
  openPrompt({
    title: `Modifier « ${g.name} »`,
    icon: 'edit',
    body: `
      <div class="field"><label for="eName">Nom affiché</label><input id="eName" type="text" value="${esc(g.name)}" data-nav /></div>
      <div class="field"><label for="ePlat">Console</label><select id="ePlat" data-nav>${platformOptions(g.platform)}</select></div>
      ${g.kind === 'exe' ? `<div class="field"><label for="eArgs">Arguments de lancement <span class="dim">(optionnel)</span></label><input id="eArgs" type="text" value="${esc(g.args || '')}" placeholder="-fullscreen -novid" data-nav /></div>` : ''}
      <div class="field"><label>${isRom ? 'ROM' : g.kind === 'exe' ? 'Exécutable' : 'Lancement'}</label><div class="path-row"><code id="eExe" title="${esc(file)}">${esc(ltr(file))}</code>${g.kind === 'exe' || isRom ? '<button class="btn small" id="eRepick" data-nav>Changer</button>' : ''}</div></div>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Enregistrer', primary: true, onClick: async () => {
        const patch = { name: $('#eName').value.trim() || g.name, platform: $('#ePlat').value };
        if ($('#eArgs')) patch.args = $('#eArgs').value.trim();
        if ($('#eExe').dataset.changed) patch[isRom ? 'romPath' : 'exePath'] = $('#eExe').textContent.replace(/\u200E/g, '');
        await rr.updateGame(g.id, patch);
        closeOverlay();
        toast('Modifications enregistrées', 'success');
      } },
    ],
  });
  $('#eRepick')?.addEventListener('click', async () => {
    const r = await rr.pickFile();
    if (r) { $('#eExe').textContent = ltr(r.path); $('#eExe').title = r.path; $('#eExe').dataset.changed = '1'; }
  });
}
function platformOptions(sel) {
  return S.lib.platforms.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

// ---------------------------------------------------------------- Ajout d'un jeu
const add = { file: '', results: [], chosen: 0, rematch: null, timer: null, token: 0 };
async function openAdd({ path, rematch } = {}) {
  add.rematch = rematch || null;
  add.file = rematch ? (rematch.romPath || rematch.exePath) : '';
  $('#addTitle').textContent = rematch ? `Corriger « ${rematch.name} »` : 'Ajouter un jeu ou une ROM';
  $('#addConfirm').textContent = rematch ? 'Mettre à jour' : 'Ajouter le jeu';
  $('#addRepick').hidden = !!rematch;
  $('#addPlatform').innerHTML = platformOptions(rematch ? rematch.platform : S.plat !== 'all' ? S.plat : 'pc');
  $('#addPlatform').disabled = !!rematch;
  $('#addStep1').hidden = !!rematch || !!path;
  $('#addStep2').hidden = !rematch && !path;
  $('#addStepper').hidden = !!rematch;
  setAddStep(rematch || path ? 2 : 1);
  if (S.mode !== 'add') openOverlay('add');
  if (rematch) toStep2({ path: add.file || rematch.launchUri || '', name: rematch.name, platform: rematch.platform });
  else if (path) toStep2(await rr.inspectFile(path));
}
function setAddStep(n) {
  $$('#addStepper li').forEach((li) => {
    const k = +li.dataset.step;
    li.classList.toggle('is-current', k === n);
    li.classList.toggle('is-done', k < n);
    if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}
function toStep2(info) {
  add.file = info.path;
  $('#addStep1').hidden = true;
  $('#addStep2').hidden = false;
  setAddStep(2);
  $('#addPath').textContent = ltr(info.path);
  $('#addPath').title = info.path || '';
  $('#addName').value = info.name || '';
  $('#addPlatform').value = info.platform || 'pc';
  $('#addPlatform').classList.toggle('needs-check', !!info.ambiguous);
  if (info.ambiguous) toast('Console non reconnue : vérifie le choix de la console', 'info');
  runSearch();
  setTimeout(() => setFocus($('#addConfirm')), 30);
}
async function pickFile() {
  const r = await rr.pickFile();
  if (r) {
    if (S.mode !== 'add') await openAdd();
    toStep2(r);
  }
}
function runSearch() {
  clearTimeout(add.timer);
  const term = $('#addName').value.trim();
  const box = $('#addResults');
  if (!term) { box.innerHTML = '<p class="results-empty">Saisis le nom du jeu pour chercher sa fiche.</p>'; $('#addStatus').textContent = ''; return; }
  $('#addStatus').innerHTML = '<span class="spinner tiny"></span> recherche…';
  box.setAttribute('aria-busy', 'true');
  if (!box.querySelector('.result')) box.innerHTML = '<span class="result skeleton"></span>'.repeat(3);
  add.timer = setTimeout(async () => {
    const tok = ++add.token;
    const platform = $('#addPlatform').value;
    const r = await rr.search(term, platform);
    if (tok !== add.token) return;
    const auto = platform !== 'pc' ? [{ source: 'auto', name: term }] : [];
    add.results = [...auto, ...r.results, { source: 'none', name: term }];
    add.chosen = 0;
    $('#addStatus').textContent = r.ok ? (r.results.length ? `· ${r.results.length} résultat${r.results.length > 1 ? 's' : ''}` : '· aucun résultat en ligne') : '· recherche impossible (hors ligne ?)';
    $('#addStatus').classList.toggle('is-error', !r.ok);
    box.removeAttribute('aria-busy');
    renderResults();
  }, 350);
}
function renderResults() {
  $('#addResults').innerHTML = add.results.map((x, i) => {
    const thumb = x.thumb ? `style="background-image:url('${esc(x.thumb)}')"` : `style="background:rgba(255,255,255,.06)"`;
    const src = { steam: 'STEAM', sgdb: 'STEAMGRIDDB', wiki: 'WIKIPÉDIA', auto: 'AUTO', none: 'SANS INFOS' }[x.source];
    const name = x.source === 'none' ? `Ajouter « ${esc(x.name)} » sans infos en ligne`
      : x.source === 'auto' ? `Recherche automatique : « ${esc(x.name)} »`
      : esc(x.name) + (x.year ? ` <span class="dim">(${x.year})</span>` : '');
    return `<button class="result" role="option" aria-selected="${i === add.chosen}" data-i="${i}" data-nav><span class="thumb" ${thumb}></span><span class="r-name">${name}</span><span class="r-src">${src}</span></button>`;
  }).join('');
}
$('#addResults').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  add.chosen = +b.dataset.i;
  $$('.result').forEach((r) => r.setAttribute('aria-selected', r === b));
  sfx('toggle');
});
$('#addName').addEventListener('input', runSearch);
$('#addPlatform').addEventListener('change', runSearch);
$('#addName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); } });
$('#addConfirm').addEventListener('click', confirmAdd);
async function confirmAdd() {
  let match = add.results[add.chosen] || null;
  const name = $('#addName').value.trim();
  const platform = $('#addPlatform').value;
  if (!match || match.source === 'auto') match = null;
  if (add.rematch) {
    const id = add.rematch.id;
    closeAll();
    toast('Mise à jour des infos…', 'progress');
    rr.refetch(id, match || (platform === 'pc' ? { source: 'none', name } : { source: 'auto', name }));
    return;
  }
  if (!add.file) return;
  const r = await rr.addGame({ file: add.file, name: match && match.source !== 'none' && platform === 'pc' ? match.name : name, platform, match });
  if (!r.ok) { toast(r.error, true); return; }
  closeAll();
  sfx('confirm');
  toast('Jeu ajouté — récupération des visuels…', 'success');
  S.selId = r.id;
  S.home.selId = platform;
  setTimeout(() => { if (S.view === 'games' && S.plat === platform) return; enterPlatform(platform); }, 150);
}

// Glisser-déposer
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropzone').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropzone').hidden = true;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  closeAll();
  openAdd({ path: rr.pathForFile(f) });
});

// ---------------------------------------------------------------- Scan
const scan = { items: [], emulators: [], checked: new Set() };
async function runScan(mode) {
  let folders;
  if (mode === 'folders') {
    folders = await rr.pickScanFolders();
    if (!folders?.length) return;
  }
  closeAll();
  $('#scanTitle').textContent = { launchers: 'Import des launchers installés', folders: 'Scan des dossiers', pc: 'Scan de tout le PC' }[mode];
  $('#scanRunning').hidden = false;
  $('#scanResults').hidden = true;
  $('#scanFound').textContent = '0'; $('#scanDirs').textContent = '0'; $('#scanPath').textContent = 'Préparation…';
  $('#scanStop').disabled = false;
  openOverlay('scan');
  const res = await rr.scan(mode, folders);
  if (S.mode !== 'scan') return;
  if (!res.items.length && !res.emulators.length) {
    closeOverlay(true);
    return toast(res.error || 'Aucun jeu trouvé.', res.error ? 'error' : 'info');
  }
  scan.items = res.items;
  scan.emulators = res.emulators;
  scan.checked = new Set(res.items.filter((x) => !x.exists && !x.uncertain).map((x) => x.key)); // « à vérifier » : non cochés
  renderScanResults(res);
  sfx('confirm');
}
rr.onScanProgress((p) => {
  $('#scanFound').textContent = p.found;
  $('#scanDirs').textContent = p.dirs.toLocaleString('fr-FR');
  $('#scanPath').textContent = ltr(p.current);
});
function renderScanResults(res) {
  $('#scanRunning').hidden = true;
  $('#scanResults').hidden = false;
  const fresh = scan.items.filter((x) => !x.exists).length;
  $('#scanTitle').textContent = 'Résultats du scan';
  $('#scanSummary').innerHTML = `<b>${fresh} nouveau${fresh > 1 ? 'x' : ''} jeu${fresh > 1 ? 'x' : ''}</b> trouvé${fresh > 1 ? 's' : ''}` + (scan.items.length - fresh ? `<span class="dim"> · ${scan.items.length - fresh} déjà dans la bibliothèque</span>` : '') + (res.cancelled ? '<span class="dim"> · scan interrompu</span>' : '');
  const emuBox = $('#scanEmus');
  if (scan.emulators.length) {
    const names = [...new Set(scan.emulators.flatMap((e) => e.matches.map((m) => m.emulator)))];
    emuBox.hidden = false;
    emuBox.innerHTML = `<span><b>${names.length} émulateur${names.length > 1 ? 's' : ''} détecté${names.length > 1 ? 's' : ''}</b> : ${esc(names.join(', '))} — configurer automatiquement</span><button class="toggle" id="emuAuto" role="switch" aria-checked="true" aria-label="Configurer automatiquement les émulateurs détectés" data-nav></button>`;
    $('#emuAuto').addEventListener('click', (e) => { const b = e.currentTarget; b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true'); sfx('toggle'); });
  } else emuBox.hidden = true;
  const groups = new Map();
  for (const it of scan.items) {
    if (!groups.has(it.platform)) groups.set(it.platform, []);
    groups.get(it.platform).push(it);
  }
  const src = (it) => ({ steam: 'STEAM', epic: 'EPIC', gog: 'GOG', scan: 'DOSSIER', xbox: 'XBOX', ea: 'EA', ubisoft: 'UBISOFT', battlenet: 'BATTLE.NET', amazon: 'AMAZON', itch: 'ITCH.IO' }[it.source] || (it.kind === 'rom' ? 'ROM' : 'EXE'));
  $('#scanList').innerHTML = [...groups.entries()].map(([pid, list]) => `
    <div class="scan-group"><i style="background:${plat(pid).color}"></i>${esc(plat(pid).name)} · ${list.length}</div>
    ${list.map((it) => `
      <button class="scan-item ${it.exists ? 'exists' : ''}" role="checkbox" aria-checked="${scan.checked.has(it.key)}" data-key="${it.key}" data-nav>
        <span class="chk"></span>
        <span><span class="si-name">${esc(it.name)}</span><span class="si-path">${esc(ltr(it.romPath || it.exePath || it.installDir || ''))}</span></span>
        <span class="si-src">${it.exists ? 'DÉJÀ AJOUTÉ' : it.uncertain ? 'À VÉRIFIER' : src(it)}</span>
      </button>`).join('')}`).join('') || '<p class="results-empty">Aucun jeu trouvé dans ces dossiers. Les émulateurs détectés peuvent quand même être configurés.</p>';
  updateScanButton();
  renderHints();
  setTimeout(() => setFocus($('#scanImport')), 30);
}
function updateScanButton() {
  const n = scan.checked.size;
  $('#scanImport').textContent = n ? `Ajouter ${n} jeu${n > 1 ? 'x' : ''}` : 'Terminer';
  const total = scan.items.filter((x) => !x.exists).length;
  $('#scanAll').disabled = !total || scan.items.every((x) => x.exists || scan.checked.has(x.key));
  $('#scanNone').disabled = !n;
}
$('#scanList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  const k = +b.dataset.key;
  if (scan.checked.has(k)) scan.checked.delete(k); else scan.checked.add(k);
  b.setAttribute('aria-checked', scan.checked.has(k));
  updateScanButton();
  sfx('toggle');
});
$('#scanAll').addEventListener('click', () => { scan.items.filter((x) => !x.exists).forEach((x) => scan.checked.add(x.key)); $$('#scanList [data-key]').forEach((b) => b.setAttribute('aria-checked', scan.checked.has(+b.dataset.key))); updateScanButton(); });
$('#scanNone').addEventListener('click', () => { scan.checked.clear(); $$('#scanList [data-key]').forEach((b) => b.setAttribute('aria-checked', false)); updateScanButton(); });
$('#scanStop').addEventListener('click', () => { rr.cancelScan(); $('#scanPath').textContent = 'Arrêt en cours…'; $('#scanStop').disabled = true; });
$('#scanImport').addEventListener('click', async () => {
  const items = scan.items.filter((x) => scan.checked.has(x.key)).map(({ key, exists, ...rest }) => rest);
  let emus = 0;
  if (scan.emulators.length && $('#emuAuto')?.getAttribute('aria-checked') === 'true') emus = await rr.applyDetectedEmulators(scan.emulators);
  closeAll();
  if (!items.length) { if (emus) toast(`${emus} émulateur${emus > 1 ? 's' : ''} configuré${emus > 1 ? 's' : ''}`, 'success'); return; }
  const r = await rr.addMany(items);
  sfx('confirm');
  toast(`${r.count} jeu${r.count > 1 ? 'x' : ''} ajouté${r.count > 1 ? 's' : ''}${emus ? ` · ${emus} émulateur${emus > 1 ? 's' : ''} configuré${emus > 1 ? 's' : ''}` : ''} — récupération des visuels…`, 'success');
  goHome();
});

// ---------------------------------------------------------------- Curseurs de volume (sons, vidéos, musique)
// <label class="vol" data-vol="clé"><input type="range"> : 0–100 % ↔ 0–1 dans les réglages. Aperçu en direct,
// enregistrement groupé ; flèches gauche / droite au clavier comme à la manette.
const VOL_DEF = { volume: 0.7, mediaVideoVolume: 0.6, mediaMusicVolume: 0.3 };
function volSlider(k, label) {
  return `<label class="vol" data-vol="${k}"><input type="range" min="0" max="100" step="5" aria-label="${label}" data-nav /><output></output></label>`;
}
function volOf(k) { const n = Number(S.lib?.settings?.[k]); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : VOL_DEF[k] ?? 0.5; }
function paintVol(el, pct) {
  el.style.setProperty('--p', `${pct}%`);
  $('output', el).textContent = `${pct} %`;
  $('input', el).setAttribute('aria-valuetext', `${pct} %`);
}
function syncVolSliders(root = document) {
  $$('.vol[data-vol]', root).forEach((el) => {
    const inp = $('input', el);
    if (document.activeElement === inp && el._t) return; // en cours de réglage
    const pct = Math.round(volOf(el.dataset.vol) * 100);
    inp.value = pct; paintVol(el, pct);
  });
}
document.addEventListener('input', (e) => {
  const el = e.target.closest?.('.vol[data-vol]');
  if (!el) return;
  const k = el.dataset.vol, pct = +e.target.value;
  paintVol(el, pct);
  const v = Math.round(pct) / 100;
  S.lib.settings[k] = k === 'volume' ? v : String(v); // valeurs des médias en texte, comme avant
  if (k === 'volume') { Sfx.set(S.lib.settings.sounds, v); clearTimeout(el._s); el._s = setTimeout(() => sfx('move'), 60); }
  clearTimeout(el._t);
  el._t = setTimeout(() => { el._t = null; rr.setSettings({ [k]: S.lib.settings[k] }); }, 180);
});
function volStep(dir) {
  const inp = document.activeElement;
  if (!inp?.matches?.('.vol input[type="range"]') || inp.disabled || (dir !== 'left' && dir !== 'right')) return false;
  inp.value = Math.max(0, Math.min(100, +inp.value + (dir === 'right' ? 5 : -5)));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

// ---------------------------------------------------------------- Réglages
let setPage = 'general';
function renderSettings() {
  const s = S.lib.settings;
  $$('#settings .seg').forEach((seg) => $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(s[seg.dataset.setting]) === b.dataset.value)));
  $$('#settings [data-toggle]').forEach((b) => b.setAttribute('aria-checked', !!s[b.dataset.toggle]));
  // Le volume n'a de sens que si les sons sont activés
  const vol = $('#settings [data-vol="volume"]');
  vol.classList.toggle('is-off', !s.sounds);
  $('input', vol).disabled = !s.sounds;
  syncVolSliders($('#settings'));
  if (document.activeElement !== $('#sgdbKey')) $('#sgdbKey').value = s.sgdbKey || '';
  if (document.activeElement !== $('#tgdbKey')) $('#tgdbKey').value = s.tgdbKey || '';
  $$('.set-tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.settab === setPage));
  $$('.set-page').forEach((p) => { p.hidden = p.dataset.page !== setPage; });
  if (setPage === 'emus') renderEmus();
  if (setPage === 'general') renderGuideStatus(); // GUIDE
}
function renderEmus() {
  const emus = S.lib.settings.emulators || {};
  const list = $('#emuList');
  if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  list.innerHTML = S.lib.platforms.filter((p) => p.id !== 'pc').map((p) => {
    const c = emus[p.id];
    const conf = c
      ? `<span class="e-ok"><i class="dot"></i>${esc(c.name || 'Émulateur')}</span><code title="${esc(c.path)}">${esc(ltr(c.path))}</code><input type="text" value="${esc(c.args || '')}" data-args="${p.id}" spellcheck="false" aria-label="Arguments de lancement pour ${esc(p.name)}" data-nav />`
      : `<span class="e-none">Aucun émulateur${p.emulators.length ? ` · conseillé : ${esc(p.emulators.map((e) => e.name).join(', '))}` : ''}</span>`;
    return `<div class="emu-row">
      <div class="e-name"><i style="background:${p.color}"></i>${esc(p.name)}</div>
      <div class="e-conf">${conf}</div>
      <div class="e-actions">
        <button class="btn small ${c ? '' : 'accent'}" data-emupick="${p.id}" data-nav>${c ? 'Changer' : 'Choisir…'}</button>
        <button class="btn small" data-platimg="${p.id}" data-nav title="Image de la console sur l’accueil">Image</button>
        <button class="btn small" data-platlogo="${p.id}" data-nav title="Logo de la console">Logo</button>
        ${c ? `<button class="btn small danger" data-emudel="${p.id}" data-nav>Retirer</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
$('#settings').addEventListener('click', async (e) => {
  const seg = e.target.closest('.seg button');
  const tg = e.target.closest('[data-toggle]');
  const link = e.target.closest('[data-link]');
  const tab = e.target.closest('[data-settab]');
  const pick = e.target.closest('[data-emupick]');
  const del = e.target.closest('[data-emudel]');
  const pimg = e.target.closest('[data-platimg]');
  const plogo = e.target.closest('[data-platlogo]');
  if (plogo) { const f = await rr.setPlatformLogo(plogo.dataset.platlogo); if (f) { S.platLogo[plogo.dataset.platlogo] = f; syncCards(); syncSlots(); updateBrand(); toast('Logo mis à jour', 'success'); } return; }
  if (tab) { setSettingsPage(tab.dataset.settab); return; }
  if (seg) { const k = seg.parentElement.dataset.setting; const v = k === 'volume' ? parseFloat(seg.dataset.value) : seg.dataset.value; await rr.setSettings({ [k]: v }); }
  if (tg) await rr.setSettings({ [tg.dataset.toggle]: !S.lib.settings[tg.dataset.toggle] });
  if (link) { e.preventDefault(); rr.openExternal(link.dataset.link); }
  if (pick) { const c = await rr.pickEmulator(pick.dataset.emupick); if (c) toast(`${c.name} configuré`, 'success'); }
  if (del) await rr.setEmulator(del.dataset.emudel, null);
  if (pimg) { const f = await rr.setPlatformImage(pimg.dataset.platimg); if (f) { S.platImg[pimg.dataset.platimg] = f; syncCards(); toast('Image de la console mise à jour', 'success'); } }
  if (seg || tg) sfx('toggle');
  // Clic sur le libellé d'un réglage à interrupteur unique : bascule l'interrupteur
  const row = !seg && !tg && !link && !e.target.closest('button, input, a') && e.target.closest('.setting');
  const only = row && $$('[data-toggle]', row);
  if (only?.length === 1 && !$('.seg', row)) only[0].click();
});
$('#settings').addEventListener('change', (e) => {
  const a = e.target.closest('[data-args]');
  if (a) rr.setEmulator(a.dataset.args, { args: a.value.trim() });
});
$('#sgdbKey').addEventListener('change', () => { const v = $('#sgdbKey').value.trim(); rr.setSettings({ sgdbKey: v }); toast(v ? 'Clé SteamGridDB enregistrée' : 'Clé SteamGridDB retirée', 'success'); });
$('#tgdbKey').addEventListener('change', () => { const v = $('#tgdbKey').value.trim(); rr.setSettings({ tgdbKey: v }); toast(v ? 'Clé TheGamesDB enregistrée' : 'Clé TheGamesDB retirée', 'success'); });
$('#refetchAll').addEventListener('click', () => {
  openPrompt({
    title: 'Re-télécharger tous les visuels ?',
    icon: 'refresh',
    body: `<p class="dim">Jaquettes, dos, fonds, logos et descriptions de tous les jeux sont récupérés à nouveau avec les sources actuelles. Les images choisies à la main sont conservées.</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Re-télécharger', primary: true, onClick: async () => { const n = await rr.refetchAll(); closeAll(); toast(`Mise à jour des visuels de ${n} jeu${n > 1 ? 'x' : ''}…`, 'progress'); } },
    ],
  });
});

function setSettingsPage(id, focusTab = false) {
  if (id === setPage) return;
  setPage = id;
  renderSettings();
  sfx('tab');
  if (focusTab) setFocus($(`[data-settab="${id}"]`));
}
function cycleSettingsPage(d) {
  const ids = $$('.set-tab').map((t) => t.dataset.settab);
  setSettingsPage(ids[(ids.indexOf(setPage) + d + ids.length) % ids.length], true);
}

// ---------------------------------------------------------------- Actions
async function action(name) {
  switch (name) {
    case 'home': closeAll(); goHome(); break;
    case 'addHub': closeAll(); openOverlay('hub'); break;
    case 'addOne': closeAll(); openAdd(); break;
    case 'pick': pickFile(); break;
    case 'scanLaunchers': runScan('launchers'); break;
    case 'scanFolders': runScan('folders'); break;
    case 'scanPc': runScan('pc'); break;
    case 'menu': S.mode === 'menu' ? closeOverlay() : (closeAll(), openOverlay('menu')); break;
    case 'settings': closeAll(); renderSettings(); openOverlay('settings'); break;
    case 'fullscreen': await rr.toggleFullscreen(); break;
    case 'minimize': closeAll(); sfx('back'); rr.minimize(); break;
    case 'quitAsk': quitAsk(); break;
    case 'quit': rr.quit(); break;
    case 'close': overlayBack(); break;
    case 'checkUpdate': checkUpdate(); break;
    case 'installUpdate': if (S.update?.state === 'ready') { toast('Installation de la mise à jour…', 'progress'); rr.installUpdate(); } break;
    case 'play': play(); break;
    case 'details': openGame(); break; // BOXOPEN
    case 'boCancel': boCancel(); break;
    case 'boSkip': boSkip(); break;
    case 'flip': flip(); break;
    case 'tabNext': cycleTab(1); break;
    case 'open': openHomeItem(); break;
    case 'closeSub': toggleImageMenu(false); break;
    case 'setNext': cycleSettingsPage(1); break;
    case 'power': openPowerMenu(); break; // GUIDE
    case 'igBack': igBack(); break; // GUIDE
    default: if (RR.actions[name]) await RR.actions[name](); // modules
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) action(b.dataset.action);
});

// ---------------------------------------------------------------- Aide contextuelle
const ICON = {
  pad: '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-3.95 3.4l-.9 6.1A2.9 2.9 0 0 0 6.6 16.8L8.5 15h7l1.9 1.8a2.9 2.9 0 0 0 4.75-2.3l-.9-6.1A4 4 0 0 0 17.3 5z"/></svg>',
  kbd: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
  mouse: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/></svg>',
  lr: '<svg viewBox="0 0 24 24"><path d="m9 6-6 6 6 6M15 6l6 6-6 6"/></svg>',
  ud: '<svg viewBox="0 0 24 24"><path d="m6 9 6-6 6 6M6 15l6 6 6-6"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M6 8h12M6 12h12M6 16h12"/></svg>',
  view: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="11" height="9" rx="1.5"/><path d="M9 18h9.5a1.5 1.5 0 0 0 1.5-1.5V10"/></svg>',
};
function glyph(btn) {
  if (S.device === 'pad') {
    const ps = S.padType === 'ps';
    const map = { a: ps ? ['✕', 'g-a'] : ['A', 'g-a'], b: ps ? ['○', 'g-b'] : ['B', 'g-b'], x: ps ? ['□', 'g-x'] : ['X', 'g-x'], y: ps ? ['△', 'g-y'] : ['Y', 'g-y'] };
    if (map[btn]) return `<span class="glyph round ${ps ? 'ps ' : ''}${map[btn][1]}">${map[btn][0]}</span>`;
    // LOOK : boutons Menu / Vue / croix en glyphes ronds (réf. ES-DE « ⊜ MENU », Switch « ⊕ Options »)
    const roundIco = { menu: ICON.menu, view: ICON.view, lr: ICON.lr, ud: ICON.ud }[btn];
    if (roundIco) return `<span class="glyph round g-ico">${roundIco}</span>`;
    const pill = { lb: ps ? 'L1' : 'LB', rb: ps ? 'R1' : 'RB' }[btn];
    return `<span class="glyph pill">${pill}</span>`;
  }
  const keys = { a: 'Entrée', b: 'Échap', x: 'I', y: S.mode === 'details' ? 'Ctrl+Entrée' : 'Espace', lb: 'Tab', tab: 'Ctrl+Tab', view: 'N', menu: S.view === 'home' ? 'Échap' : 'M', lr: ICON.lr, ud: ICON.ud };
  const k = keys[btn];
  if (!k) return '';
  // LOOK : touche d'un caractère ou flèches → glyphe rond ; nom de touche → pastille arrondie
  return `<span class="glyph kb ${k.startsWith('<svg') || k.length === 1 ? 'round g-ico' : 'pill'}">${k}</span>`;
}
// Barre du bas façon console : commandes alignées à droite, la plus importante (A) tout à droite
function renderHints() {
  const H = [];
  const h = (btns, label, act) => H.push({ btns, label, act });
  document.body.classList.toggle('in-ingame', S.mode === 'ingame' || BO.kind === 'open'); // masque l'info de bibliothèque (menu en jeu / animation)
  if (BO.kind === 'open') { h(['b'], 'Annuler', 'boCancel'); h(['a'], 'Passer', 'boSkip'); } // BOXOPEN
  else if (S.mode === 'ingame') { // GUIDE : menu en jeu
    h(['b'], igPowerOpen() ? 'Retour' : 'Reprendre le jeu', 'igBack');
    h(['ud'], 'Se déplacer', null);
    h(['a'], 'Valider', null);
  }
  else if (S.mode !== 'main') {
    const sub = S.mode === 'details' && !$('#dSub').hidden;
    h(['b'], sub ? 'Fermer les images' : S.mode === 'menu' ? 'Fermer' : 'Retour', sub ? 'closeSub' : 'close');
    if (S.mode === 'settings') h(S.device === 'pad' ? ['lb', 'rb'] : ['tab'], 'Sections', 'setNext');
    const onPlay = S.mode === 'details' && document.activeElement?.matches?.('.d-play'); // BOXOPEN : A = Jouer sur la page du jeu
    if (S.mode === 'details' && !onPlay) h(['y'], 'Jouer', 'play');
    h(['ud'], 'Se déplacer', null);
    h(['a'], onPlay ? 'Jouer' : S.mode === 'scan' && !$('#scanResults').hidden ? 'Cocher / valider' : 'Valider', null);
  }
  else if (!S.lib.games.length) { h(['menu'], 'Menu', 'menu'); h(['view'], 'Ajouter des jeux', 'addHub'); h(['a'], 'Importer', 'scanLaunchers'); }
  else if (S.topFocus >= 0) { h(['b'], 'Retour', null); h(['lr'], 'Choisir', null); h(['a'], 'Ouvrir', null); }
  else if (S.view === 'home') {
    h(['menu'], 'Menu', 'menu');
    h(['view'], 'Ajouter', 'addHub');
    h(['lr'], 'Consoles', null);
    h(['a'], 'Ouvrir', 'open');
  } else if (S.zone === 'actions' && S.items.length) {
    h(['b'], 'Jeux', null);
    h(['lr'], 'Choisir', null);
    h(['a'], 'Valider', null);
  } else {
    h(['menu'], 'Menu', 'menu');
    h(['b'], 'Consoles', 'home');
    if (S.items.length) {
      if (S.tabs.length > 1) h(S.device === 'pad' ? ['lb', 'rb'] : ['lb'], 'Catégories', 'tabNext');
      h(['y'], 'Retourner', 'flip');
      h(['lr'], 'Naviguer', null);
      h(['a'], 'Ouvrir', 'details'); // BOXOPEN : A ouvre la page du jeu (Jouer y est focalisé)
    }
  }
  if (S.mode === 'main') for (const f of RR.hints) { try { f(h); } catch (err) { console.error(err); } }
  $('#hintList').innerHTML = H.map((x, i) => `<button class="hint" data-hint="${i}" ${x.act ? '' : 'tabindex="-1"'}>${x.btns.map(glyph).join('')}<span class="hint-label">${esc(x.label)}</span></button>`).join('');
  $$('#hints .hint').forEach((b) => b.addEventListener('click', () => { const a = H[+b.dataset.hint].act; if (a) action(a); }));
  $$('[data-glyph]').forEach((el) => {
    const k = ['menu', 'a', 'lb', 'rb'].includes(el.dataset.glyph) ? el.dataset.glyph : 'a';
    el.innerHTML = S.device === 'pad' ? glyph(k).replace(/<\/?span[^>]*>/g, '') : '';
    el.classList.toggle('is-a', S.device === 'pad' && k === 'a');
  });
  renderStatus();
}
function setDevice(d) {
  if (S.device === d) return;
  S.device = d;
  document.body.classList.toggle('pad-mode', d === 'pad');
  if (d === 'mouse') { $$('.is-focus').forEach((x) => x.classList.remove('is-focus')); if (S.topFocus >= 0) { S.topFocus = -1; document.body.classList.remove('top-focus'); } }
  renderHints();
}

// ---------------------------------------------------------------- Clavier
addEventListener('keydown', (e) => {
  setDevice('kbd');
  if (LD.active && e.key !== 'F11' && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!e.repeat && (e.key === 'Escape' || e.key === 'Backspace')) ldCancel(); return; } // LOADING
  // BOXOPEN : pendant l'ouverture, Entrée/Espace saute, Échap/Retour annule ; une fermeture en cours se termine net
  if (BO.kind === 'open' || BO.kind === 'cancel') {
    e.preventDefault();
    if (BO.kind === 'open' && !e.repeat) { if (e.key === 'Enter' || e.key === ' ') boSkip(); else if (e.key === 'Escape' || e.key === 'Backspace') boCancel(); }
    return;
  }
  if (BO.busy) { const closing = BO.kind === 'close'; boFinish(); if (closing && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); return; } } // BOXOPEN : Échap pendant la fermeture = terminer net
  if (S.topFocus >= 0 && SHELL_KEYS[e.key] && !e.ctrlKey && !e.altKey) { if (shellTopInput(SHELL_KEYS[e.key])) { e.preventDefault(); return; } } // SHELL : barre du haut
  else if (S.topFocus >= 0) shellTopInput(e.key === 'Tab' ? 'tab' : 'other'); // SHELL : autre touche → rend la main
  const inInput = !!e.target.matches?.('input, select');
  if (e.key === 'F11') { e.preventDefault(); action('fullscreen'); return; }
  if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); rr.quit(); return; }
  if (S.mode !== 'main') {
    if (e.key === 'Escape') { e.preventDefault(); overlayBack(); return; }
    // Piège de focus : Tab / Maj+Tab restent dans l'overlay ; Ctrl+Tab change de section dans les réglages
    if (e.key === 'Tab') {
      e.preventDefault();
      if (S.mode === 'settings' && e.ctrlKey) return cycleSettingsPage(e.shiftKey ? -1 : 1);
      const list = navables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      setFocus(list[i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
      return;
    }
    if (S.mode === 'details' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); play(); return; }
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[e.key] && !(inInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.target.tagName === 'SELECT'))) { e.preventDefault(); spatial(dirs[e.key]); }
    return;
  }
  if (inInput) return;
  const k = e.key;
  if (!S.lib.games.length) {
    const m = { n: () => action('addHub'), N: () => action('addHub'), Escape: () => action('menu'), ArrowLeft: () => spatial('left'), ArrowRight: () => spatial('right') };
    if (m[k]) { e.preventDefault(); m[k](); }
    return;
  }
  if (S.view === 'home') {
    const m = {
      ArrowRight: () => homeSelect(S.home.sel + 1), ArrowLeft: () => homeSelect(S.home.sel - 1),
      Home: () => homeSelect(0), End: () => homeSelect(S.home.items.length - 1), ArrowUp: () => shellFocusTop(),
      Enter: openHomeItem, ' ': openHomeItem, n: () => action('addHub'), N: () => action('addHub'),
      s: () => action('settings'), S: () => action('settings'), Escape: () => action('menu'), m: () => action('menu'), M: () => action('menu'),
    };
    if (m[k]) { e.preventDefault(); m[k](); }
    return;
  }
  if (S.zone === 'actions') {
    const z = {
      ArrowLeft: () => moveAct(-1), ArrowRight: () => moveAct(1), ArrowUp: () => setZone('row'), ArrowDown: () => {},
      Enter: pressAct, ' ': pressAct, Escape: () => setZone('row'), Backspace: () => setZone('row'),
    }[k];
    if (z) { e.preventDefault(); z(); return; }
  }
  const map = {
    ArrowRight: () => move(1), ArrowLeft: () => (S.sel === 0 ? goHome() : move(-1)), Home: () => select(0, { spin: false }), End: () => select(S.items.length - 1, { spin: false }),
    PageDown: () => move(5), PageUp: () => move(-5), Enter: () => (S.items.length ? openGame() : setTab('all')), // BOXOPEN
    ArrowDown: () => setZone('actions'), ArrowUp: () => shellFocusTop(),
    i: openGame, I: openGame, ' ': flip, f: () => toggleFav(), F: () => toggleFav(),
    n: () => action('addHub'), N: () => action('addHub'), Insert: () => action('addOne'), s: () => action('settings'), S: () => action('settings'),
    Escape: () => (S.flip ? flip() : goHome()), Backspace: goHome, m: () => action('menu'), M: () => action('menu'),
    Delete: () => S.items[S.sel] && confirmRemove(S.items[S.sel]),
    Tab: () => cycleTab(e.shiftKey ? -1 : 1), q: () => cycleTab(-1), e: () => cycleTab(1),
  };
  if (map[k]) { e.preventDefault(); map[k](); }
});

// ---------------------------------------------------------------- Souris
let lastMouse = [0, 0];
addEventListener('mousemove', (e) => {
  if (Math.abs(e.clientX - lastMouse[0]) + Math.abs(e.clientY - lastMouse[1]) > 6) setDevice('mouse');
  lastMouse = [e.clientX, e.clientY];
  S.mouse.x = (e.clientX / innerWidth - 0.5) * 2;
  S.mouse.y = (e.clientY / innerHeight - 0.5) * 2;
});
let wheelAcc = 0, wheelT = 0;
function onWheel(e) {
  if (S.mode !== 'main' || BO.busy) return; // BOXOPEN
  e.preventDefault();
  const now = performance.now();
  if (now - wheelT > 250) wheelAcc = 0;
  wheelT = now;
  wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  while (Math.abs(wheelAcc) >= 60) {
    const d = Math.sign(wheelAcc);
    if (S.view === 'home') homeSelect(S.home.sel + d);
    else move(d);
    wheelAcc -= d * 60;
  }
}
$('#stage').addEventListener('wheel', onWheel, { passive: false });
$('#home').addEventListener('wheel', onWheel, { passive: false });
$$('.overlay').forEach((o) => o.addEventListener('mousedown', (e) => { if (e.target === o && S.mode !== 'details' && S.mode !== 'scan') closeOverlay(); }));
$('#details').addEventListener('mousedown', (e) => { if (e.target.closest('.details') === null || e.target.classList.contains('details')) overlayBack(); });

// ---------------------------------------------------------------- Manette
const pad = { prev: [], axisDir: null };
const REPEAT_DELAY = 360, REPEAT_RATE = 95;
// NAV : deux sources fusionnées (OU logique, un même appui vu deux fois ne compte qu'une fois) :
//  - l'API Gamepad de Chromium, TOUTES les manettes au mapping « standard » (pas seulement la première :
//    une manette virtuelle ou un volant branché en premier masquait la vraie manette) ;
//  - la lecture native du processus principal (XInput / HID : Xbox, DualShock, DualSense, Switch Pro), qui
//    marche aussi quand Chromium ne voit pas la manette ou que la fenêtre n'a pas le focus clavier.
const NATIVE = { mask: 0, at: 0 };
rr.onPadNav?.((m) => { NATIVE.mask = m >>> 0; NATIVE.at = performance.now(); });
// bit du masque natif (format XInput + gâchettes) → index du bouton « standard » de l'API Gamepad
const NAV_BITS = [[0x1000, 0], [0x2000, 1], [0x4000, 2], [0x8000, 3], [0x0100, 4], [0x0200, 5], [1 << 16, 6], [1 << 17, 7],
  [0x0020, 8], [0x0010, 9], [0x0080, 11], [0x0001, 12], [0x0002, 13], [0x0004, 14], [0x0008, 15]];
const padKind = (id) => (/054c|dualsense|dualshock|wireless controller|playstation/i.test(id) ? 'ps' : 'xbox');
function padSnapshot(useApi = document.hasFocus()) {
  const b = new Array(17).fill(false);
  let ax = 0, ay = 0, any = false, kind = null;
  const pads = useApi ? [...(navigator.getGamepads?.() || [])].filter((g) => g && g.connected) : [];
  const std = pads.filter((g) => g.mapping === 'standard');
  const native = NATIVE.mask && performance.now() - NATIVE.at < 1200 ? NATIVE.mask : 0;
  // Manettes au mapping non standard (DirectInput) : seulement s'il n'y a rien d'autre (boutons dans un autre ordre)
  for (const gp of std.length || native ? std : pads) {
    any = true;
    kind ||= padKind(gp.id);
    gp.buttons.forEach((x, i) => { if (i < 17 && (x.pressed || x.value > 0.5)) b[i] = true; });
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.abs(x) > Math.abs(ax)) ax = x;
    if (Math.abs(y) > Math.abs(ay)) ay = y;
  }
  if (native) { any = true; for (const [bit, i] of NAV_BITS) if (native & bit) b[i] = true; }
  return { b, ax, ay, any, kind };
}
window.padSnapshot = padSnapshot;
function pollPad(t) {
  if (document.hidden) return;
  const snap = padSnapshot();
  if (!snap.any) { pad.prev = []; pad.axisDir = null; return; }
  if (snap.kind) S.padType = snap.kind;
  const b = snap.b;
  const ax = snap.ax, ay = snap.ay;
  const dir = b[14] || ax < -0.55 ? 'left' : b[15] || ax > 0.55 ? 'right' : b[12] || ay < -0.55 ? 'up' : b[13] || ay > 0.55 ? 'down' : null;
  const pressed = (i) => b[i] && !pad.prev[i];
  if (b.some(Boolean) || dir) setDevice('pad');
  if (dir) {
    if (pad.axisDir !== dir) { pad.axisDir = dir; pad.next = t + REPEAT_DELAY; onPadDir(dir, false); }
    else if (t >= pad.next) { pad.next = t + REPEAT_RATE; onPadDir(dir, true); }
  } else pad.axisDir = null;
  ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu'].forEach((n, i) => { if (pressed(i)) onPadBtn(n); });
  if (pressed(16)) guidePress({ source: 'gamepad' }); // GUIDE : bouton central (PS / Home ; Xbox via le processus principal)
  pad.prev = b;
}
function onPadDir(dir, repeat) {
  RR.emit('input', 'pad', dir);
  if (window.ssActive && ssWake()) return; // MEDIA : économiseur d'écran actif → la manette le quitte sans autre action
  if (LD.active) return; // LOADING
  if (shellSplashActive()) return endSplash(); // SHELL
  if (BO.kind === 'open' || BO.kind === 'cancel') return; // BOXOPEN
  if (BO.busy) boFinish();
  if (S.topFocus >= 0 && shellTopInput(dir)) return; // SHELL : barre du haut
  if (S.mode !== 'main') return volStep(dir) || spatial(dir);
  if (!S.lib.games.length) { if (!repeat) spatial(dir); return; }
  if (S.view === 'home') {
    if (dir === 'left') homeSelect(S.home.sel - 1);
    else if (dir === 'right') homeSelect(S.home.sel + 1);
    else if (dir === 'up' && !repeat) shellFocusTop();
    return;
  }
  if (S.zone === 'actions') {
    if (repeat) return;
    if (dir === 'left') moveAct(-1); else if (dir === 'right') moveAct(1); else if (dir === 'up') setZone('row');
    return;
  }
  if (dir === 'left') { if (S.sel === 0) { if (!repeat) goHome(); } else move(-1); }
  else if (dir === 'right') move(1);
  else if (dir === 'down' && !repeat) setZone('actions');
  else if (dir === 'up' && !repeat) shellFocusTop();
}
function onPadBtn(btn) {
  RR.emit('input', 'pad', btn);
  if (window.ssActive && ssWake(btn)) return; // MEDIA : économiseur d'écran actif → A = aller au jeu affiché, sinon simple réveil
  if (LD.active) { if (btn === 'b') ldCancel(); return; } // LOADING
  if (shellSplashActive()) return endSplash(); // SHELL
  if (BO.kind === 'open') { if (btn === 'a') boSkip(); else if (btn === 'b') boCancel(); return; } // BOXOPEN
  if (BO.kind === 'cancel') return;
  if (BO.busy) { const closing = BO.kind === 'close'; boFinish(); if (closing && btn === 'b') return; } // BOXOPEN : B pendant la fermeture = terminer, pas « retour à l'accueil »
  if (S.mode === 'ingame') { if (btn === 'a') document.activeElement?.click?.(); else if (btn === 'b') igBack(); return; } // GUIDE : seuls A / B comptent dans le menu en jeu
  if (S.topFocus >= 0 && shellTopInput(btn === 'a' || btn === 'b' ? btn : 'other')) return; // SHELL : barre du haut
  if (S.mode === 'main' && !S.lib.games.length) {
    if (btn === 'a') { const el = document.activeElement; if (el?.matches?.('[data-nav]')) el.click(); else action('scanLaunchers'); }
    else if (btn === 'menu') action('menu');
    else if (btn === 'view' || btn === 'x') action('addHub');
    return;
  }
  if (S.mode === 'main' && S.view === 'home') {
    const m = { a: openHomeItem, x: () => action('addHub'), view: () => action('addHub'), menu: () => action('menu'), lb: () => homeSelect(S.home.sel - 1), rb: () => homeSelect(S.home.sel + 1) }[btn];
    return m && m();
  }
  if (S.mode === 'main') {
    if (S.zone === 'actions' && (btn === 'a' || btn === 'b')) return btn === 'a' ? pressAct() : setZone('row');
    const m = {
      a: () => (S.items.length ? openGame() : setTab('all')), b: () => (S.flip ? flip() : goHome()), x: openGame, y: flip, // BOXOPEN
      lb: () => cycleTab(-1), rb: () => cycleTab(1), lt: () => move(-5), rt: () => move(5), view: () => action('addHub'), menu: () => action('menu'),
    }[btn];
    return m && m();
  }
  if (btn === 'a') { const el = document.activeElement; if (el && el !== document.body) el.click(); }
  else if (btn === 'b') overlayBack();
  else if (btn === 'menu') action('menu');
  else if (btn === 'y' && S.mode === 'details') play();
  else if (S.mode === 'settings' && (btn === 'lb' || btn === 'rb')) cycleSettingsPage(btn === 'lb' ? -1 : 1);
}
addEventListener('gamepadconnected', () => { setDevice('pad'); }); // la notification est affichée par features/polish.js

// ---------------------------------------------------------------- Échelle des panneaux (1280×720 → 2560×1440)
function uiScale() {
  document.documentElement.style.setProperty('--ui', clamp(Math.min(innerHeight / 900, innerWidth / 1600), 1, 1.6).toFixed(3));
}
addEventListener('resize', uiScale);
uiScale();

// ---------------------------------------------------------------- SHELL : horloge, statut, barres système
function tick() {
  const d = new Date();
  $('#date').textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#time').textContent = hm;
  $('#time').dateTime = hm;
}
// Mise à jour alignée sur le changement de minute (pas de rafraîchissement inutile chaque seconde)
let clockT;
function startClock() {
  clearTimeout(clockT); clearInterval(clockT);
  tick();
  const d = new Date();
  clockT = setTimeout(() => { tick(); clockT = setInterval(tick, 60000); }, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 30);
}
// Texte d'info à gauche de la barre du bas (appelé par l'accueil et l'écran jeux)
function setFootInfo(text = '') {
  const el = $('#footInfo');
  if (el && el.textContent !== String(text)) el.textContent = text;
}

const SICON = {
  wifi: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/></svg>',
  wifiOff: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M5 12.6a10 10 0 0 1 5.2-2.7M16.8 11a10 10 0 0 1 2.2 1.6"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="m3 3 18 18"/></svg>',
};
// Manette connectée (même si le périphérique actif est le clavier) : icône allumée + type
function padInfo() {
  const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected && g.mapping === 'standard')
    || [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
  if (!gp) return NATIVE.at && performance.now() - NATIVE.at < 60000 ? S.padType || 'xbox' : null;
  return padKind(gp.id);
}
let battery = null;
function renderStatus() {
  const dev = S.device === 'pad' ? 'pad' : S.device === 'mouse' ? 'mouse' : 'kbd';
  const pt = padInfo();
  const padEl = $('#padInd');
  padEl.hidden = !pt && dev !== 'pad';
  if (!padEl.hidden) {
    const type = (pt || S.padType) === 'ps' ? 'PS' : 'Xbox';
    padEl.innerHTML = `${ICON.pad}<b>${type}</b>`;
    padEl.classList.toggle('is-active', dev === 'pad');
    padEl.title = `Manette ${type} ${dev === 'pad' ? 'active' : 'connectée'}`; padEl.setAttribute('aria-label', padEl.title);
  }
  const ind = $('#inputInd');
  ind.hidden = dev === 'pad';
  ind.innerHTML = ICON[dev];
  ind.title = { pad: 'Manette active', mouse: 'Souris active', kbd: 'Clavier actif' }[dev]; ind.setAttribute('aria-label', ind.title);
  const on = navigator.onLine !== false;
  const net = $('#netInd');
  net.innerHTML = on ? SICON.wifi : SICON.wifiOff;
  net.classList.toggle('off', !on);
  net.title = on ? 'Connecté à Internet' : 'Hors ligne'; net.setAttribute('aria-label', net.title);
  renderBattery(battery);
}
// Batterie : uniquement sur un PC portable (un PC fixe rapporte « 100 %, en charge, durée infinie »)
function renderBattery(b) {
  const el = $('#batInd');
  const none = !b || (b.charging && b.level >= 1 && b.chargingTime === 0 && b.dischargingTime === Infinity);
  el.hidden = none;
  if (none) return;
  const pct = Math.round(b.level * 100);
  const low = !b.charging && pct <= 15;
  el.classList.toggle('low', low);
  el.innerHTML = `<span class="bat-pct">${pct}%</span><svg viewBox="0 0 28 14"><rect x="1" y="1" width="23" height="12" rx="3"/><path d="M26.5 5v4"/><rect class="bat-fill" x="3" y="3" width="${(19 * b.level).toFixed(1)}" height="8" rx="1.5"/>${b.charging ? '<path class="bat-bolt" d="M13.5 2.5 10 7.5h4l-2 4"/>' : ''}</svg>`;
  el.title = `Batterie ${pct} %${b.charging ? ' · en charge' : ''}`; el.setAttribute('aria-label', el.title);
}
navigator.getBattery?.().then((b) => {
  battery = b;
  ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, () => renderBattery(b)));
  renderBattery(b);
}).catch(() => {});
addEventListener('online', renderStatus);
addEventListener('offline', renderStatus);
addEventListener('gamepadconnected', renderStatus);
addEventListener('gamepaddisconnected', () => setTimeout(renderStatus, 50));

// Barre du haut à la manette / au clavier : ↑ depuis la ligne la plus haute de l'écran → shellFocusTop()
const topBtns = () => $$('.topbar .sys-btn').filter((b) => b.offsetParent !== null && !b.hidden);
function shellTopSet(i) {
  const list = topBtns();
  if (!list.length) return shellLeaveTop();
  S.topFocus = clamp(i, 0, list.length - 1);
  $$('.is-focus').forEach((x) => x.classList.remove('is-focus'));
  const el = list[S.topFocus];
  el.focus({ preventScroll: true });
  if (S.device !== 'mouse') el.classList.add('is-focus');
}
function shellFocusTop() {
  if (S.mode !== 'main') return false;
  const list = topBtns();
  if (!list.length) return false;
  // Sur l'écran jeux, on arrive sur la 1re icône système (pas sur « retour »)
  const first = list.findIndex((b) => !b.classList.contains('back-btn'));
  document.body.classList.add('top-focus');
  shellTopSet(first < 0 ? 0 : first);
  sfx('move');
  renderHints();
  return true;
}
function shellLeaveTop(silent = false) {
  if (S.topFocus < 0) return;
  S.topFocus = -1;
  document.body.classList.remove('top-focus');
  $$('.topbar .is-focus').forEach((x) => x.classList.remove('is-focus'));
  if (document.activeElement?.closest?.('.topbar')) document.activeElement.blur();
  if (!silent) sfx('back');
  renderHints();
  typeof onShellLeave === 'function' && onShellLeave();
}
function shellTopActivate() {
  const el = topBtns()[S.topFocus];
  shellLeaveTop(true);
  el?.click();
}
// Entrées pendant que la barre du haut a le focus. Retourne true si l'entrée est consommée.
function shellTopInput(k) {
  if (S.topFocus < 0) return false;
  if (S.mode !== 'main') { shellLeaveTop(true); return false; }
  const n = topBtns().length;
  switch (k) {
    case 'left': if (S.topFocus > 0) { shellTopSet(S.topFocus - 1); sfx('move'); } return true;
    case 'right': if (S.topFocus < n - 1) { shellTopSet(S.topFocus + 1); sfx('move'); } return true;
    case 'up': return true;
    case 'down': case 'b': shellLeaveTop(); return true;
    case 'a': shellTopActivate(); return true;
    default: shellLeaveTop(true); return false; // autre touche : on rend la main à l'écran et on la laisse passer
  }
}
const SHELL_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Escape: 'b', Backspace: 'b', Enter: 'a', ' ': 'a' };

// Écran de démarrage : ≤ 1,2 s, sautable par n'importe quelle touche / clic / bouton, absent si reduceMotion
let splashT = null;
const shellSplashActive = () => !!splashT;
function shellSplash() {
  const el = $('#splash');
  if (!el) return;
  if (reduceMotion) { el.remove(); return; }
  el.hidden = false; el.classList.remove('out'); void el.offsetWidth; el.classList.add('play');
  clearTimeout(splashT);
  splashT = setTimeout(endSplash, 850);
}
function endSplash() {
  const el = $('#splash');
  clearTimeout(splashT); splashT = null;
  if (!el || el.hidden) return;
  el.classList.add('out');
  setTimeout(() => { el.hidden = true; el.classList.remove('play', 'out'); }, reduceMotion ? 0 : 320);
}
function skipSplash(e) {
  if (!shellSplashActive()) return;
  e?.preventDefault?.(); e?.stopImmediatePropagation?.();
  endSplash();
}
addEventListener('keydown', skipSplash, true);
addEventListener('mousedown', skipSplash, true);

// ---------------------------------------------------------------- Mises à jour
function renderUpdate(u) {
  S.update = u;
  const chip = $('#btnUpdate');
  $('#menuVersion').textContent = 'v' + (u.current || '');
  $('#menuInstall').hidden = u.state !== 'ready';
  const dl = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>';
  if (u.state === 'ready') { chip.hidden = false; chip.classList.remove('busy'); chip.innerHTML = `${dl}<span>v${esc(u.version || '')} prête · Redémarrer</span>`; }
  else if (u.state === 'downloading') {
    chip.hidden = false; chip.classList.add('busy');
    chip.style.setProperty('--p', (u.progress || 0) + '%');
    chip.innerHTML = `<span class="spinner tiny"></span><span>Téléchargement v${esc(u.version || '')} · ${u.progress || 0} %</span>`;
  } else chip.hidden = true;
}
let manualCheck = false;
async function checkUpdate() {
  manualCheck = true;
  toast('Recherche de mises à jour…', 'progress');
  const u = await rr.checkUpdate();
  if (u.state === 'dev') toast('Mises à jour désactivées en mode développement');
}
rr.onUpdate((u) => {
  const prev = S.update?.state;
  renderUpdate(u);
  if (u.state === 'ready' && prev !== 'ready') toast(`Version ${u.version} prête : « Redémarrer » en haut à droite`, 'success');
  if (manualCheck && u.state === 'uptodate') { toast(`Tu as la dernière version (v${u.current})`, 'success'); manualCheck = false; }
  if (manualCheck && u.state === 'error') { toast('Impossible de vérifier les mises à jour', true); manualCheck = false; }
  if (u.state === 'downloading' && prev !== 'downloading') toast(`Nouvelle version ${u.version} : téléchargement…`, 'progress');
});

// ---------------------------------------------------------------- Événements du processus principal
// Thème clair / sombre (réglage « theme » : light | dark | system)
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = S.lib.settings?.theme || 'light';
  const t = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}
darkQuery.addEventListener('change', applyTheme);
function applyLib(state) {
  S.lib = state;
  applyTheme();
  S.P = Object.fromEntries(state.platforms.map((p) => [p.id, p]));
  Sfx.set(state.settings.sounds, state.settings.volume ?? 0.7);
  refresh();
  if (S.mode === 'settings') renderSettings();
  RR.emit('library', state);
}
rr.onLibrary(applyLib);
// view / mode : observés sur <body data-view> et S.mode
new MutationObserver(() => { RR.emit('view', document.body.dataset.view); queueMicrotask(emitSelection); }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
{ let m = S.mode; setInterval(() => { if (S.mode !== m) { m = S.mode; RR.emit('mode', m); } }, 120); }
rr.onRunning((x) => RR.emit('session', x));
addEventListener('keydown', () => RR.emit('input', 'kbd'), true);
addEventListener('pointerdown', () => RR.emit('input', 'mouse'), true);
addEventListener('wheel', () => RR.emit('input', 'mouse'), { capture: true, passive: true });
rr.onProgress(({ id, msg, done }) => {
  if (done) delete S.progress[id];
  else { S.progress[id] = msg; updateProgressText(id); }
});
rr.onRunning(({ running, name }) => {
  if (!running) toast(name ? `Session de ${name} terminée` : 'Session terminée');
});
rr.onVisible((v) => { if (v) { startClock(); sfx('open'); } });

// ---------------------------------------------------------------- GUIDE : menu en jeu (bouton Xbox / PS / Home)
// Le processus principal détecte le bouton Guide (XInput / HID, même launcher masqué) et Ctrl+Alt+L,
// remet le launcher au premier plan puis envoie « guide:press ». Launcher actif : l'API Gamepad
// (bouton 16) déclenche aussi guidePress ; les doublons sont filtrés.
const IG = { id: null, start: 0, timer: null, lastGuide: 0 };
const igPowerOpen = () => !$('#igPower').hidden;
const igIsOpen = () => S.mode === 'ingame' || S.stack.includes('ingame');
function runningGame(ids = S.lib.running || []) {
  const id = IG.id && ids.includes(IG.id) ? IG.id : ids[ids.length - 1];
  return S.lib.games.find((g) => g.id === id) || null;
}
function fmtSession(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

function guidePress(info = {}) {
  const now = performance.now();
  if (now - IG.lastGuide < 450) return; // même appui vu par plusieurs sources (HID + API Gamepad)
  IG.lastGuide = now;
  if (shellSplashActive()) endSplash();
  const g = runningGame(info.running || S.lib.running || []);
  // CAPTURE : Guide + B → « Quitter le jeu ? », Guide maintenu → Alimentation (menu en jeu ouvert directement dessus)
  if (g && (info.intent === 'quit' || info.intent === 'power')) { openIngame(g); if (info.intent === 'power') igShowList('power'); else igQuit(); return; }
  if (g) {
    if (S.mode === 'ingame' && !info.summoned) return igResume(); // rappuyer sur Guide = retour au jeu
    return openIngame(g);
  }
  if (!info.summoned) action('menu'); // pas de jeu : le bouton Guide ouvre / ferme le menu
}

async function openIngame(g) {
  ldHide(true); // LOADING : le menu en jeu est prioritaire
  IG.id = g.id;
  if (BO.busy) boClear(); // BOXOPEN : une animation de boîte en cours ne doit pas rester par-dessus le menu en jeu
  if (S.mode !== 'ingame') closeAll();
  if (S.topFocus >= 0) shellLeaveTop(true);
  igRender(g);
  igShowList('main', false);
  openOverlay('ingame');
  rr.setIngame(true);
  IG.start = Date.now();
  igTick();
  clearInterval(IG.timer);
  IG.timer = setInterval(igTick, 1000);
  const ses = await rr.sessions().catch(() => []);
  const cur = ses.find((x) => x.id === g.id);
  if (cur) { IG.start = cur.start; igTick(); }
}
function igRender(g) {
  const p = plat(g.platform);
  const hero = heroOf(g);
  $('#igBg').style.backgroundImage = hero ? `url("${hero}")` : 'none';
  markLowRes($('#igBg'), hero);
  const cover = g.media?.cover ? mediaUrl(g, g.media.cover) : '';
  const cv = $('#igCover');
  cv.style.backgroundImage = cover ? `url("${cover}")` : 'none';
  cv.classList.toggle('none', !cover);
  cv.textContent = cover ? '' : (p.short || p.name || '');
  $('#igPlat').textContent = p.name;
  $('#igTitle').textContent = g.name;
  $('#igTotal').textContent = fmtTime(g.playtime);
  $('#igFoot').innerHTML = S.device === 'pad' ? 'Bouton Guide ou B : retour au jeu' : '<kbd>Échap</kbd> ou <kbd>Ctrl+Alt+L</kbd> : retour au jeu';
}
function igTick() {
  $('#igSession').textContent = fmtSession((Date.now() - IG.start) / 1000);
  const c = $('#igClock');
  const hm = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (c.textContent !== hm) { c.textContent = hm; c.dateTime = hm; }
}
function igOnClose() {
  clearInterval(IG.timer);
  IG.timer = null;
  rr.setIngame(false);
}
function igShowList(which, focus = true) {
  const power = which === 'power';
  $('#igMain').hidden = power;
  $('#igPower').hidden = !power;
  if (focus) { setFocus(power ? $('#igPower [data-default]') : $('#igMain [data-ig="power"]')); sfx(power ? 'confirm' : 'back'); }
  renderHints();
}
function igBack() {
  if (igPowerOpen()) return igShowList('main');
  igResume();
}
function igResume() {
  const id = IG.id;
  closeAll(true);
  sfx('back');
  rr.resumeGame(id);
}
function igQuit() {
  const g = runningGame();
  if (!g) return closeAll();
  openPrompt({
    title: `Quitter « ${g.name} » ?`,
    icon: 'danger', tone: 'danger',
    body: `<p class="dim">Le jeu est fermé tout de suite : ce qui n’a pas été sauvegardé est perdu. Le temps de jeu est enregistré.</p>`,
    actions: [
      { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
      { label: 'Quitter le jeu', danger: true, primary: true, onClick: async () => {
        closeAll(true);
        const r = await rr.quitGame(g.id);
        if (!r?.ok) toast(r?.error || 'Impossible de quitter le jeu.', true);
      } },
    ],
  });
}
function igSwitch() {
  const g = runningGame();
  closeAll();
  if (g) toast(`${g.name} continue en arrière-plan`);
}
$('#ingame').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ig]');
  if (!b) return;
  const act = b.dataset.ig;
  if (act === 'resume') igResume();
  else if (act === 'switch') igSwitch();
  else if (act === 'quit') igQuit();
  else if (act === 'power') igShowList('power');
  else if (act === 'back') igShowList('main');
  else confirmPower(act);
});
$('#ingame').addEventListener('mousedown', (e) => { if (e.target.id === 'igBg') igResume(); });

// Lancer un jeu alors qu'un autre tourne. Renvoie true si play() doit s'arrêter là.
function guideBeforePlay(g) {
  const ids = S.lib.running || [];
  if (ids.includes(g.id)) { // le jeu en cours : on le reprend, on n'en lance pas un 2e
    closeAll(true);
    sfx('launch');
    toast(`Reprise de ${g.name}`, 'progress');
    rr.resumeGame(g.id);
    return true;
  }
  const cur = runningGame(ids);
  if (!cur) return false;
  openPrompt({
    title: `${cur.name} est en cours`,
    icon: 'emu',
    body: `<p class="dim">Quitter « ${esc(cur.name)} » avant de lancer « ${esc(g.name)} » ? Ce qui n’a pas été sauvegardé dans le jeu en cours sera perdu.</p>`,
    actions: [
      { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
      { label: 'Lancer sans quitter', onClick: () => { closeAll(true); play(g.id, { force: true }); } },
      { label: 'Quitter et lancer', primary: true, onClick: async () => { closeAll(true); await rr.quitGame(cur.id); play(g.id, { force: true }); } },
    ],
  });
  return true;
}

// ---------- Alimentation (menu principal et menu en jeu)
function openPowerMenu() {
  openPrompt({
    title: 'Alimentation',
    icon: 'power',
    body: `<p class="dim">Mettre le PC en veille, le redémarrer ou l’éteindre.</p>`,
    actions: [
      { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
      { label: 'Mettre en veille', onClick: () => confirmPower('sleep') },
      { label: 'Redémarrer', onClick: () => confirmPower('restart') },
      { label: 'Éteindre', danger: true, onClick: () => confirmPower('shutdown') },
    ],
  });
}
const POWER = {
  sleep: { title: 'Mettre le PC en veille ?', btn: 'Mettre en veille', what: 'Le PC se met en veille' },
  restart: { title: 'Redémarrer le PC ?', btn: 'Redémarrer', what: 'Le PC redémarre tout de suite' },
  shutdown: { title: 'Éteindre le PC ?', btn: 'Éteindre', what: 'Le PC s’éteint tout de suite' },
};
function confirmPower(act) {
  const P = POWER[act];
  if (!P) return;
  const g = runningGame();
  const warn = act === 'sleep'
    ? (g ? ` « ${esc(g.name)} » reste ouvert et reprendra au réveil.` : '')
    : `${g ? ` « ${esc(g.name)} » sera fermé : sauvegarde ta partie avant.` : ''} Les programmes ouverts seront fermés.`;
  openPrompt({
    title: P.title,
    icon: 'power', tone: act === 'sleep' ? '' : 'danger',
    body: `<p class="dim">${P.what}.${warn}</p>`,
    actions: [
      { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
      { label: P.btn, primary: true, danger: act !== 'sleep', onClick: () => powerAct(act) },
    ],
  });
}
async function powerAct(act) {
  closeAll(true);
  const r = await rr.power(act).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (!r?.ok) return toast(r?.error || 'Action impossible', true);
  toast(act === 'sleep' ? 'Mise en veille…' : act === 'restart' ? 'Redémarrage…' : 'Extinction…', 'progress');
}

// ---------- Réglages : état de la détection
async function renderGuideStatus() {
  const el = $('#guideStatus');
  if (!el) return;
  const st = await rr.guideStatus().catch(() => null);
  if (!st) return;
  if (st.platform !== 'win32') el.textContent = 'Détection en arrière-plan : Windows uniquement.';
  else if (st.xinput || st.hid) el.textContent = `Détection active : ${[st.xinput && 'Xbox / XInput', st.hid && 'PlayStation · Switch Pro (HID)'].filter(Boolean).join(' · ')}.`;
  else el.textContent = 'Détection native indisponible (détails dans metadata.log) : Ctrl+Alt+L fonctionne toujours.';
}

// ---------- Événements du processus principal
rr.onGuide((info) => guidePress(info || {}));
// Menu en jeu affiché sans le focus clavier (Windows l'a refusé) : la manette est relayée par le processus principal
rr.onPadRemote((btn) => {
  if (document.hasFocus() || rr.onPadNav) return; // NAV : remplacé par le relais natif « pad:nav »
  setDevice('pad');
  if (['up', 'down', 'left', 'right'].includes(btn)) onPadDir(btn, false); else onPadBtn(btn);
});
rr.onRunning(({ id, running }) => {
  if (!running && igIsOpen() && IG.id === id) closeAll(true); // le jeu s'est fermé tout seul
});

// ---------------------------------------------------------------- WAKE : retour au premier plan
// Le processus principal ramène le launcher devant tout (fin de la dernière session, manette allumée)
// puis envoie « win:wake » { reason: 'session-end' | 'pad', id, platform, wasHidden, wasFront }.
function wakeQuiet(fn) { // navigation sans les sons intermédiaires : un seul son d'ouverture
  const s = S.lib.settings || {};
  Sfx.set(false);
  try { fn(); } finally { Sfx.set(s.sounds, s.volume ?? 0.7); }
}
// Rangée de jeux de la console du jeu quitté, sélection sur ce jeu
function wakeShowGame(id, pid) {
  const g = S.lib.games.find((x) => x.id === id);
  const p = g?.platform || pid;
  if (!p || !S.home.items.some((x) => x.id === p)) return;
  if (S.view !== 'games' || S.plat !== p) enterPlatform(p);
  if (!g || S.view !== 'games') return;
  let i = S.items.findIndex((x) => x.id === g.id);
  if (i < 0 && S.tab !== 'all') { setTab('all'); i = S.items.findIndex((x) => x.id === g.id); }
  if (i >= 0) select(i, { spin: false });
}
rr.onWake((w = {}) => {
  if (shellSplashActive()) endSplash();
  if (w.reason === 'session-end') {
    if (igIsOpen()) closeAll(true); // fin de partie détectée menu en jeu ouvert : on le ferme
    if (S.mode === 'main') wakeQuiet(() => wakeShowGame(w.id, w.platform));
  } else if (w.reason === 'pad') {
    wakeQuiet(() => { closeAll(true); if (S.topFocus >= 0) shellLeaveTop(true); goHome(); }); // accueil des consoles
  }
  // Fenêtre masquée : « win:visible » joue déjà le son d'ouverture ; déjà devant : pas de son
  if (!w.wasHidden && !w.wasFront) sfx('open');
  renderHints();
});

// ---------------------------------------------------------------- Démarrage
(async function init() {
  initMotes();
  shellSplash(); startClock();
  measure();
  applyLib(await rr.getLibrary());
  measure();
  renderUpdate(await rr.getUpdate());
  requestAnimationFrame(frame);
  setTimeout(() => sfx('start'), 250);
})();

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
};
const slots = new Map();
const cards = new Map();

const CASES = { red: '#d4142c', black: '#1c1c24', blue: '#1b55c9' };
const DEPTH = { dvd: 0.085, bluray: 0.07, small: 0.07, card: 0.17, jewel: 0.075 };

// ---------------------------------------------------------------- Utilitaires
const mediaUrl = (g, file) => (file ? `rr://media/${g.id}/${encodeURIComponent(file)}?v=${g.mediaVersion || 0}` : '');
const logoCss = (id) => (S.platLogo[id] ? `--logo:url('rr://media/_platforms/${encodeURIComponent(S.platLogo[id])}')` : '');
const platUrl = (file) => (file ? `rr://media/_platforms/${encodeURIComponent(file)}` : '');
const yearOf = (g) => (String(g.releaseDate || '').match(/\d{4}/) || [])[0] || '';
const plat = (id) => S.P[id] || S.P.pc || { id: 'pc', name: 'PC', short: 'PC', color: '#F43F5E', case: { style: 'dvd', ratio: 0.64 } };
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
  const mark = logo ? `<img class="t-logo" src="${platUrl(logo)}" alt="" />`
    : `<b class="t-name" style="--fit:${Math.min(1, 6 / Math.max(3, (p.short || p.name).length)).toFixed(2)}">${esc(p.short || p.name)}</b>`;
  return `<div class="t-in" style="--pc:${p.color || '#F43F5E'}">${a.tile ? `<img class="t-art" src="${a.tile}" alt="" decoding="async" />` : ''}`
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
  i = clamp(i, 0, S.home.items.length - 1);
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
  const url = id === 'add' ? '' : homeArt(id).bg;
  const key = url || (id === 'add' ? '#add' : '#none');
  if (key === homeArtCur) return;
  homeArtCur = key;
  const tok = ++homeArtTok;
  const apply = () => {
    if (tok !== homeArtTok) return;
    const style = url ? `background-image:url("${url}")` : '';
    const cls = url ? '' : ' is-brand';
    for (const [root, c] of [[$('#homeScene'), 'h-bg'], [$('#homePanel'), 'h-pbg']]) {
      const old = $$(`.${c}`, root);
      const el = document.createElement('div');
      el.className = c + cls;
      el.style.cssText = style;
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
  if (id === 'all' || id === 'add') {
    return `<div class="h-brand"><span class="h-brand-t"><span class="brand-rr">RR</span> LAUNCHER</span>`
      + `<span class="h-brand-s">${id === 'all' ? 'Tous les jeux' : 'Ajouter des jeux'}</span></div>`;
  }
  const p = plat(id);
  if (S.platLogo[id]) return `<img class="h-logo-img" src="${platUrl(S.platLogo[id])}" alt="${esc(p.name)}" />`;
  return `<div class="h-name" style="--fit:${Math.min(1, 7 / Math.max(3, p.name.length)).toFixed(2)}">${esc(p.name)}</div>`;
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
  S.home.items.forEach((it, i) => {
    const el = cards.get(it.id);
    if (!el) return;
    const x = x0 + (i - S.home.pos) * pitch;
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
  if (c.ratio <= 0.8) { H = H0 * (c.style === 'small' ? 0.92 : 1); W = H * c.ratio; }
  else if (c.ratio <= 1.05) { W = H0 * 0.8; H = W / c.ratio; }
  else { W = H0 * 1.05; H = W / c.ratio; }
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
      el.addEventListener('dblclick', () => { if (S.items[S.sel]?.id === g.id) play(); });
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
  // Position gauche de chaque boîte : largeurs réelles + écart fixe
  const gap = S.dims.H * 0.24;
  S.cum = [];
  let acc = 0;
  S.items.forEach((g) => { S.cum.push(acc); acc += (slots.get(g.id)?._dims?.W || S.dims.Wref) + gap; });
  S.cumStep = S.dims.Wref + gap;
  if (S.view === 'games') {
    $('#caption').hidden = S.items.length === 0;
    if (S.lib.games.length && !S.items.length) { $('#title').textContent = 'Aucun jeu dans cette catégorie'; $('#caption').hidden = false; $('#subtitle').textContent = ''; }
  }
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
function measure() {
  const H = clamp(innerHeight * 0.44, 220, 620);
  S.dims.H = H;
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
function frameGames(t, dt) {
  spring(S, S.sel, dt);
  S.flipCur += (S.flip - S.flipCur) * Math.min(1, 0.13 * dt);
  const { H } = S.dims;
  const W = S.dims.Wref || H * 0.72;
  const step = W * 1.32;
  const games = S.view === 'games';
  const half = innerWidth / 2, midY = innerHeight / 2;
  const lo = Math.floor(S.pos) - 2, hi = Math.ceil(S.pos) + Math.ceil(innerWidth / step) + 1;
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
    const left = LAY.anchor + cumAt(i) - cumAt(S.pos);
    const x = left + bw / 2 - half;
    const sel = games && i === S.sel;
    const selW = games ? clamp(1 - a, 0, 1) : 0; // poids « sélectionné » continu
    let ry = 0, rx = 0, y = 0;
    if (!reduceMotion) {
      ry += clamp(S.vel * 120, -30, 30);
      let sp = S.spin.get(i);
      if (sp) {
        ry -= sp;
        sp *= Math.pow(0.9, dt);
        if (sp < 0.4) S.spin.delete(i); else S.spin.set(i, sp);
      }
      if (selW > 0) {
        ry += Math.sin(t / 1500) * 5 * selW + (S.device === 'mouse' ? S.mouse.x * 7 * selW : 0);
        rx = (S.device === 'mouse' ? -S.mouse.y * 4 : Math.sin(t / 2100) * 1.5) * selW;
        y = Math.sin(t / 1800) * 5 * selW;
      }
    }
    if (sel) ry += S.flipCur * 180;
    const dy = (H - bh) / 2;
    const sc = 1 + 0.1 * selW;
    const z = 50 * selW;
    el.style.transform = `translate3d(${x}px, ${y + dy}px, ${z}px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${sc})`;
    // Les jeux déjà passés glissent sous la roue
    el.style.opacity = o < 0 ? clamp(1 + o * 1.4, 0, 1) : 1;
    el.style.setProperty('--dim', (games ? clamp(0.38 - selW * 0.38, 0, 0.6) : 0.12 + clamp(o * 0.05, 0, 0.25)).toFixed(3));
    el.classList.toggle('is-selected', sel);
  }
  for (const el of visible) if (!now.has(el)) el.style.display = 'none';
  visible = now;
}

// ---------------------------------------------------------------- Fond
let bgFlip = false, bgCurrent = null, bgTimer;
function setBackground(url, tint) {
  $('#bgTint').style.background = `radial-gradient(ellipse 34% 48% at var(--glow-x, 50%) 50%, ${tint || 'transparent'}, transparent 100%)`;
  if (url === bgCurrent) return;
  bgCurrent = url;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => {
    const next = bgFlip ? $('#bgA') : $('#bgB');
    const prev = bgFlip ? $('#bgB') : $('#bgA');
    bgFlip = !bgFlip;
    const apply = () => { next.style.backgroundImage = url ? `url("${url}")` : 'none'; next.classList.add('on'); prev.classList.remove('on'); };
    if (!url) return apply();
    const img = new Image();
    img.onload = apply; img.onerror = apply;
    img.src = url;
  }, 140);
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
function drawMotes(t) {
  if (reduceMotion || !motesCtx || t - motesLast < 33 || document.hidden) return;
  motesLast = t;
  const c = motesCtx, w = c.canvas.width, h = c.canvas.height;
  c.clearRect(0, 0, w, h);
  for (const m of motes) {
    m.y -= m.s / 2400; m.x += Math.sin(t / 3000 + m.p) / 9000;
    if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
    const a = 0.25 + 0.35 * Math.sin(t / 900 + m.p * 3);
    const gr = c.createRadialGradient(m.x * w, m.y * h, 0, m.x * w, m.y * h, m.r * 6);
    gr.addColorStop(0, `rgba(255, 214, 170, ${a})`);
    gr.addColorStop(1, 'rgba(255, 214, 170, 0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(m.x * w, m.y * h, m.r * 6, 0, 6.283); c.fill();
  }
}

// ---------------------------------------------------------------- Chrome
function updateBrand() {
  const t = $('#brandTitle');
  const n = S.lib.games.length;
  if (S.view === 'home') {
    t.className = 'brand-title';
    t.innerHTML = '<span class="brand-rr">RR</span> LAUNCHER';
    $('#brandSub').textContent = `Choisis ta console · ${n} jeu${n > 1 ? 'x' : ''}`;
    $('#brandSort').textContent = '';
    return;
  }
  const p = S.plat === 'all' ? null : plat(S.plat);
  t.className = 'brand-title platform';
  const col = ['#2b2b2b', '#4d4d55', '#9aa0a6', '#1a1a1a'].includes(p?.color) ? '#fff' : p?.color;
  t.innerHTML = !p ? '<span class="brand-rr">TOUS</span> LES JEUX'
    : S.platLogo[p.id] ? `<span class="brand-logo" style="${logoCss(p.id)};--c:${col}" role="img" aria-label="${esc(p.name)}"></span>`
    : `<span style="color:${col}">${esc(p.name.toUpperCase())}</span>`;
  const count = inPlat(S.lib.games).length;
  const tabLabel = S.tabs.find((x) => x.id === S.tab)?.label || 'Tous';
  $('#brandSub').textContent = [p?.maker, p?.year, `${count} jeu${count > 1 ? 'x' : ''}`, tabLabel].filter(Boolean).join(' · ');
  $('#brandSort').textContent = { recent: 'Tri : récents', name: 'Tri : A → Z', added: 'Tri : ajout', playtime: 'Tri : temps de jeu' }[S.lib.settings.sort || 'recent'];
}
function updateChrome(force = false) {
  updateBrand();
  const g = S.items[S.sel];
  $('#counter').textContent = S.items.length ? `${S.sel + 1} / ${S.items.length}` : '';
  if (!g) { setBackground('', S.plat !== 'all' ? plat(S.plat).color : ''); $('#capBadges').innerHTML = ''; return; }
  setCapLogo(null);
  if (force || $('#title').dataset.id !== g.id) {
    const cap = $('#caption');
    cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
    $('#title').textContent = g.name;
    $('#title').dataset.id = g.id;
  }
  const p = plat(g.platform);
  const bits = [S.plat === 'all' ? p.name : '', g.developer?.split(',')[0], yearOf(g), (g.genres || [])[0]].filter(Boolean);
  $('#subtitle').textContent = bits.join(' · ') || p.name;
  renderCapBadges(g);
  setBackground(heroOf(g), p.color);
}
// Puces d'état sous le titre du jeu : en cours, récupération des infos, favori, dernière session
const BADGE_ICON = {
  fav: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 20.5s-7.5-4.6-9.6-9.2C.9 7.9 3 4 6.7 4c2.1 0 3.6 1.2 4.3 2.4h2C13.7 5.2 15.2 4 17.3 4 21 4 23.1 7.9 21.6 11.3 19.5 15.9 12 20.5 12 20.5z"/></svg>',
  time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  emu: '<svg viewBox="0 0 24 24"><path d="M12 7.5v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
};
function renderCapBadges(g) {
  const box = $('#capBadges');
  if (!g) { box.innerHTML = ''; return; }
  const b = [];
  if (S.lib.running.includes(g.id)) b.push('<span class="badge live"><i class="dot"></i>En cours</span>');
  if (g.metaStatus === 'loading') b.push(`<span class="badge busy"><span class="spinner tiny"></span>${esc(S.progress[g.id] || 'Récupération des infos…')}</span>`);
  if (g.favorite) b.push(`<span class="badge fav">${BADGE_ICON.fav}Favori</span>`);
  if (g.kind === 'rom' && !S.lib.settings.emulators?.[g.platform]) b.push(`<span class="badge warn">${BADGE_ICON.emu}Émulateur à configurer</span>`);
  b.push(`<span class="badge time">${BADGE_ICON.time}${g.lastPlayed ? `${esc(fmtLast(g.lastPlayed))}${g.playtime ? ` · ${esc(fmtTime(g.playtime))}` : ''}` : 'Jamais lancé'}</span>`);
  box.innerHTML = b.slice(0, 4).join('');
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = S.tabs.map((t) =>
    `<button class="tab" role="tab" aria-selected="${t.id === S.tab}" data-tab="${esc(t.id)}">${esc(t.label)}<span class="count">${t.n}</span></button>`).join('');
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
  S.sel = 0; S.pos = -3; S.vel = 0; S.selId = S.items[0]?.id || null;
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
const move = (d) => select(S.sel + d, { spin: Math.abs(d) === 1 });
function onSlotClick(id) {
  if (S.mode !== 'main') return;
  const i = S.items.findIndex((g) => g.id === id);
  if (i === S.sel) openDetails(); else select(i);
}
function flip() { if (S.items.length) { S.flip = S.flip ? 0 : 1; sfx('flip'); } }

async function play(id = S.items[S.sel]?.id) {
  const g = S.lib.games.find((x) => x.id === id);
  if (!g) return;
  const r = await rr.launch(id);
  if (!r.ok) {
    if (r.error === 'NO_EMULATOR') return askEmulator(r.platform, id);
    return toast(r.error || 'Impossible de lancer le jeu.', true);
  }
  sfx('launch');
  const f = $('#launchFlash');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  toast(`Lancement de ${g.name}…`, 'progress');
}
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
const OVERLAYS = { details: '#details', add: '#addDialog', hub: '#addHub', scan: '#scan', menu: '#menu', settings: '#settings', prompt: '#prompt' };
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
  if (S.mode === 'details' && !$('#dSub').hidden) return toggleImageMenu(false);
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
  $('#dPlatform').innerHTML = `<i style="background:${p.color}"></i>${esc(p.name)}${g.kind === 'steam' ? ' · Steam' : g.kind === 'epic' ? ' · Epic Games' : g.source === 'gog' ? ' · GOG' : g.kind === 'rom' ? ' · Émulation' : ''}`;
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
  const shots = (g.screenshots || []).slice(0, 3);
  $('#dShots').classList.toggle('cover-only', !shots.length);
  $('#dShots').innerHTML = shots.length
    ? shots.map((s) => `<div class="d-shot" style="background-image:url('${mediaUrl(g, s)}')"></div>`).join('')
    : g.media?.cover ? `<img class="d-cover" src="${mediaUrl(g, g.media.cover)}" alt="" />` : '';
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
  $('#scanTitle').textContent = { launchers: 'Import Steam, Epic & GOG', folders: 'Scan des dossiers', pc: 'Scan de tout le PC' }[mode];
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
  scan.checked = new Set(res.items.filter((x) => !x.exists).map((x) => x.key));
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
  const src = (it) => ({ steam: 'STEAM', epic: 'EPIC', gog: 'GOG', scan: 'DOSSIER' }[it.source] || (it.kind === 'rom' ? 'ROM' : 'EXE'));
  $('#scanList').innerHTML = [...groups.entries()].map(([pid, list]) => `
    <div class="scan-group"><i style="background:${plat(pid).color}"></i>${esc(plat(pid).name)} · ${list.length}</div>
    ${list.map((it) => `
      <button class="scan-item ${it.exists ? 'exists' : ''}" role="checkbox" aria-checked="${scan.checked.has(it.key)}" data-key="${it.key}" data-nav>
        <span class="chk"></span>
        <span><span class="si-name">${esc(it.name)}</span><span class="si-path">${esc(ltr(it.romPath || it.exePath || it.installDir || ''))}</span></span>
        <span class="si-src">${it.exists ? 'DÉJÀ AJOUTÉ' : src(it)}</span>
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

// ---------------------------------------------------------------- Réglages
let setPage = 'general';
function renderSettings() {
  const s = S.lib.settings;
  $$('#settings .seg').forEach((seg) => $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(s[seg.dataset.setting]) === b.dataset.value)));
  $$('#settings [data-toggle]').forEach((b) => b.setAttribute('aria-checked', !!s[b.dataset.toggle]));
  // Le volume n'a de sens que si les sons sont activés
  const vol = $('#settings [data-setting="volume"]');
  vol.classList.toggle('is-off', !s.sounds);
  $$('button', vol).forEach((b) => { b.disabled = !s.sounds; });
  if (document.activeElement !== $('#sgdbKey')) $('#sgdbKey').value = s.sgdbKey || '';
  if (document.activeElement !== $('#tgdbKey')) $('#tgdbKey').value = s.tgdbKey || '';
  $$('.set-tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.settab === setPage));
  $$('.set-page').forEach((p) => { p.hidden = p.dataset.page !== setPage; });
  if (setPage === 'emus') renderEmus();
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
    case 'close': closeOverlay(); break;
    case 'checkUpdate': checkUpdate(); break;
    case 'installUpdate': if (S.update?.state === 'ready') { toast('Installation de la mise à jour…', 'progress'); rr.installUpdate(); } break;
    case 'play': play(); break;
    case 'details': openDetails(); break;
    case 'flip': flip(); break;
    case 'tabNext': cycleTab(1); break;
    case 'open': openHomeItem(); break;
    case 'closeSub': toggleImageMenu(false); break;
    case 'setNext': cycleSettingsPage(1); break;
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
};
function glyph(btn) {
  if (S.device === 'pad') {
    const ps = S.padType === 'ps';
    const map = { a: ps ? ['✕', 'g-a'] : ['A', 'g-a'], b: ps ? ['○', 'g-b'] : ['B', 'g-b'], x: ps ? ['□', 'g-x'] : ['X', 'g-x'], y: ps ? ['△', 'g-y'] : ['Y', 'g-y'] };
    if (map[btn]) return `<span class="glyph round ${ps ? 'ps ' : ''}${map[btn][1]}">${map[btn][0]}</span>`;
    const pill = { lb: ps ? 'L1' : 'LB', rb: ps ? 'R1' : 'RB', view: ps ? 'SHARE' : 'VIEW', menu: ps ? 'OPTIONS' : 'MENU', lr: ICON.lr, ud: ICON.ud }[btn];
    return `<span class="glyph pill">${pill}</span>`;
  }
  const keys = { a: 'Entrée', b: 'Échap', x: 'I', y: S.mode === 'details' ? 'Ctrl+Entrée' : 'Espace', lb: 'Tab', tab: 'Ctrl+Tab', view: 'N', menu: S.view === 'home' ? 'Échap' : 'M', lr: ICON.lr, ud: ICON.ud };
  return keys[btn] ? `<span class="glyph">${keys[btn]}</span>` : '';
}
function renderHints() {
  const H = [];
  const h = (btns, label, act) => H.push({ btns, label, act });
  if (S.mode !== 'main') {
    h(['ud'], 'Se déplacer', null);
    h(['a'], S.mode === 'scan' && !$('#scanResults').hidden ? 'Cocher / valider' : 'Valider', null);
    if (S.mode === 'details') { h(['y'], 'Jouer', 'play'); if (!$('#dSub').hidden) { h(['b'], 'Fermer les images', 'closeSub'); } }
    if (S.mode === 'settings') h(S.device === 'pad' ? ['lb', 'rb'] : ['tab'], 'Sections', 'setNext');
    if (!(S.mode === 'details' && !$('#dSub').hidden)) h(['b'], S.mode === 'menu' ? 'Fermer' : 'Retour', 'close');
  }
  else if (!S.lib.games.length) { h(['a'], 'Importer', 'scanLaunchers'); h(['view'], 'Ajouter des jeux', 'addHub'); h(['menu'], 'Menu', 'menu'); }
  else if (S.view === 'home') {
    h(['ud'], 'Consoles', null);
    h(['a'], 'Ouvrir', 'open');
    h(['view'], 'Ajouter des jeux', 'addHub');
    h(['menu'], 'Menu', 'menu');
  } else {
    if (S.items.length) {
      h(['lr'], 'Naviguer', null);
      h(['a'], 'Jouer', 'play');
      h(['x'], 'Détails', 'details');
      h(['y'], 'Retourner', 'flip');
      if (S.tabs.length > 1) h(S.device === 'pad' ? ['lb', 'rb'] : ['lb'], 'Catégories', 'tabNext');
    }
    h(['b'], 'Consoles', 'home');
    h(['menu'], 'Menu', 'menu');
  }
  $('#hints').innerHTML = H.map((x, i) => `<button class="hint" data-hint="${i}" ${x.act ? '' : 'tabindex="-1"'}>${x.btns.map(glyph).join('')}${esc(x.label)}</button>`).join('');
  $$('#hints .hint').forEach((b) => b.addEventListener('click', () => { const a = H[+b.dataset.hint].act; if (a) action(a); }));
  $$('[data-glyph]').forEach((el) => {
    const k = ['menu', 'a', 'lb', 'rb'].includes(el.dataset.glyph) ? el.dataset.glyph : 'a';
    el.innerHTML = S.device === 'pad' ? glyph(k).replace(/<\/?span[^>]*>/g, '') : '';
    el.classList.toggle('is-a', S.device === 'pad' && k === 'a');
  });
  const dev = S.device === 'pad' ? 'pad' : S.device === 'mouse' ? 'mouse' : 'kbd';
  $('#inputInd').innerHTML = ICON[dev];
  $('#inputInd').title = { pad: 'Manette active', mouse: 'Souris active', kbd: 'Clavier actif' }[dev];
}
function setDevice(d) {
  if (S.device === d) return;
  S.device = d;
  document.body.classList.toggle('pad-mode', d === 'pad');
  if (d === 'mouse') $$('.is-focus').forEach((x) => x.classList.remove('is-focus'));
  renderHints();
}

// ---------------------------------------------------------------- Clavier
addEventListener('keydown', (e) => {
  setDevice('kbd');
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
      Home: () => homeSelect(0), End: () => homeSelect(S.home.items.length - 1),
      Enter: openHomeItem, ' ': openHomeItem, n: () => action('addHub'), N: () => action('addHub'),
      s: () => action('settings'), S: () => action('settings'), Escape: () => action('menu'), m: () => action('menu'), M: () => action('menu'),
    };
    if (m[k]) { e.preventDefault(); m[k](); }
    return;
  }
  const map = {
    ArrowRight: () => move(1), ArrowLeft: () => (S.sel === 0 ? goHome() : move(-1)), Home: () => select(0, { spin: false }), End: () => select(S.items.length - 1, { spin: false }),
    PageDown: () => move(5), PageUp: () => move(-5), Enter: () => play(),
    ArrowUp: openDetails, i: openDetails, I: openDetails, ' ': flip, f: () => toggleFav(), F: () => toggleFav(),
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
  if (S.mode !== 'main') return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelT > 250) wheelAcc = 0;
  wheelT = now;
  wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  while (Math.abs(wheelAcc) >= 60) {
    const d = Math.sign(wheelAcc);
    if (S.view === 'home') homeSelect(S.home.sel + d);
    else if (e.clientX < LAY.edge) { goHome(); wheelAcc = 0; break; }
    else move(d);
    wheelAcc -= d * 60;
  }
}
$('#stage').addEventListener('wheel', onWheel, { passive: false });
$('#home').addEventListener('wheel', onWheel, { passive: false });
$$('.overlay').forEach((o) => o.addEventListener('mousedown', (e) => { if (e.target === o && S.mode !== 'details' && S.mode !== 'scan') closeOverlay(); }));
$('#details').addEventListener('mousedown', (e) => { if (e.target.closest('.details') === null || e.target.classList.contains('details')) closeOverlay(); });

// ---------------------------------------------------------------- Manette
const pad = { prev: [], axisDir: null };
const REPEAT_DELAY = 360, REPEAT_RATE = 95;
function pollPad(t) {
  if (!document.hasFocus() || document.hidden) return;
  const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
  if (!gp) return;
  S.padType = /054c|dualsense|dualshock|wireless controller|playstation/i.test(gp.id) ? 'ps' : 'xbox';
  const b = gp.buttons.map((x) => x.pressed || x.value > 0.5);
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const dir = b[14] || ax < -0.55 ? 'left' : b[15] || ax > 0.55 ? 'right' : b[12] || ay < -0.55 ? 'up' : b[13] || ay > 0.55 ? 'down' : null;
  const pressed = (i) => b[i] && !pad.prev[i];
  if (b.some(Boolean) || dir) setDevice('pad');
  if (dir) {
    if (pad.axisDir !== dir) { pad.axisDir = dir; pad.next = t + REPEAT_DELAY; onPadDir(dir, false); }
    else if (t >= pad.next) { pad.next = t + REPEAT_RATE; onPadDir(dir, true); }
  } else pad.axisDir = null;
  ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu'].forEach((n, i) => { if (pressed(i)) onPadBtn(n); });
  pad.prev = b;
}
function onPadDir(dir, repeat) {
  if (S.mode !== 'main') return spatial(dir);
  if (!S.lib.games.length) { if (!repeat) spatial(dir); return; }
  if (S.view === 'home') {
    if (dir === 'left') homeSelect(S.home.sel - 1);
    else if (dir === 'right') homeSelect(S.home.sel + 1);
    return;
  }
  if (dir === 'left') { if (S.sel === 0) { if (!repeat) goHome(); } else move(-1); }
  else if (dir === 'right') move(1);
  else if (dir === 'up' && !repeat) openDetails();
}
function onPadBtn(btn) {
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
    const m = {
      a: () => play(), b: () => (S.flip ? flip() : goHome()), x: openDetails, y: flip,
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
addEventListener('gamepadconnected', () => { setDevice('pad'); toast('Manette connectée', 'success'); });

// ---------------------------------------------------------------- Échelle des panneaux (1280×720 → 2560×1440)
function uiScale() {
  document.documentElement.style.setProperty('--ui', clamp(Math.min(innerHeight / 900, innerWidth / 1600), 1, 1.6).toFixed(3));
}
addEventListener('resize', uiScale);
uiScale();

// ---------------------------------------------------------------- Horloge
function tick() {
  const d = new Date();
  $('#date').textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#time').textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

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
function applyLib(state) {
  S.lib = state;
  S.P = Object.fromEntries(state.platforms.map((p) => [p.id, p]));
  Sfx.set(state.settings.sounds, state.settings.volume ?? 0.7);
  refresh();
  if (S.mode === 'settings') renderSettings();
}
rr.onLibrary(applyLib);
rr.onProgress(({ id, msg, done }) => {
  if (done) delete S.progress[id];
  else { S.progress[id] = msg; updateProgressText(id); }
});
rr.onRunning(({ running, name }) => {
  if (!running) toast(name ? `Session de ${name} terminée` : 'Session terminée');
});
rr.onVisible((v) => { if (v) { tick(); sfx('open'); } });

// ---------------------------------------------------------------- Démarrage
(async function init() {
  initMotes();
  tick(); setInterval(tick, 10000);
  measure();
  applyLib(await rr.getLibrary());
  measure();
  renderUpdate(await rr.getUpdate());
  requestAnimationFrame(frame);
  setTimeout(() => sfx('start'), 250);
})();

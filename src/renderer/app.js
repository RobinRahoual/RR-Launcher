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

// ---------------------------------------------------------------- Toast
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  if (error) sfx('error');
}

// ---------------------------------------------------------------- Accueil (consoles)
function computeHome() {
  const g = S.lib.games;
  const by = new Map();
  for (const x of g) {
    const e = by.get(x.platform) || { n: 0, last: 0 };
    e.n++; e.last = Math.max(e.last, x.lastPlayed || 0, x.addedAt || 0);
    by.set(x.platform, e);
  }
  const plats = [...by.entries()].sort((a, b) => b[1].last - a[1].last).map(([id, e]) => ({ id, n: e.n }));
  const items = [];
  if (plats.length > 1) items.push({ id: 'all', n: g.length });
  items.push(...plats);
  items.push({ id: 'add', n: 0 });
  S.home.items = items;
  const i = items.findIndex((x) => x.id === S.home.selId);
  S.home.sel = i >= 0 ? i : 0;
  S.home.selId = items[S.home.sel]?.id;
}
function cardHTML(it) {
  if (it.id === 'add') return `<div class="c-glow"></div><div class="c-img"><div class="c-fallback add">+</div></div><div class="c-name">Ajouter</div>`;
  if (it.id === 'all') return `<div class="c-glow"></div><div class="c-floor"></div><div class="c-img"><div class="c-fallback all">TOUS<br/>LES JEUX</div></div><div class="c-count">${it.n}</div><div class="c-name">Tous les jeux</div>`;
  const p = plat(it.id);
  const img = S.platImg[it.id];
  const inner = img ? `<img src="${platUrl(img)}" alt="${esc(p.name)}" />`
    : it.id === 'pc' ? `<img src="assets/pc.svg" alt="PC" />`
    : S.platLogo[it.id] ? `<div class="c-fallback"><span class="c-logo" style="${logoCss(it.id)}" role="img" aria-label="${esc(p.name)}"></span></div>`
    : `<div class="c-fallback">${esc(p.short)}</div>`;
  const mask = img ? `style="--mask:url('${platUrl(img)}')"` : it.id === 'pc' ? `style="--mask:url('assets/pc.svg')"` : '';
  return `<div class="c-glow"></div><div class="c-floor"></div><div class="c-img">${inner}</div><div class="sweep" ${mask}></div><div class="c-count">${it.n}</div><div class="c-name">${esc(p.name)}</div>`;
}
function syncCards() {
  const root = $('#consoles');
  const ids = new Set(S.home.items.map((x) => x.id));
  for (const [id, el] of cards) if (!ids.has(id)) { el.remove(); cards.delete(id); }
  S.home.items.forEach((it) => {
    let el = cards.get(it.id);
    const sig = `${it.n}|${S.platImg[it.id] || ''}|${S.platLogo[it.id] || ''}`;
    if (!el) {
      el = document.createElement('div');
      el.className = 'ccard';
      el.addEventListener('click', () => onCardClick(it.id));
      root.appendChild(el);
      cards.set(it.id, el);
    }
    el.style.setProperty('--pc', it.id === 'all' || it.id === 'add' ? '#F43F5E' : plat(it.id).color);
    if (el._sig !== sig) { el.innerHTML = cardHTML(it); el._sig = sig; }
    if (it.id !== 'all' && it.id !== 'add' && it.id !== 'pc' && S.platImg[it.id] === undefined) loadPlatImage(it.id);
    loadPlatLogo(it.id);
  });
}
async function loadPlatLogo(id) {
  if (!id || id === 'pc' || id === 'all' || id === 'add' || S.platLogo[id] !== undefined) return;
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
  if (f) { S.platImg[id] = f; syncCards(); }
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
  updateHomeChrome();
}
function openHomeItem() {
  const it = S.home.items[S.home.sel];
  if (!it) return;
  if (it.id === 'add') return action('addHub');
  enterPlatform(it.id);
}
function updateHomeChrome() {
  const it = S.home.items[S.home.sel];
  if (!it) return;
  const cap = $('#homeCaption');
  cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
  if (it.id === 'add' || it.id === 'all') setHomeLogo(null);
  if (it.id === 'add') {
    $('#homeTitle').textContent = 'Ajouter des jeux';
    $('#homeSub').textContent = 'Jeux PC, Steam, Epic, GOG, ROMs et émulateurs';
    setBackground('', '#F43F5E');
  } else if (it.id === 'all') {
    $('#homeTitle').textContent = 'Tous les jeux';
    $('#homeSub').textContent = `${it.n} jeu${it.n > 1 ? 'x' : ''} · toutes consoles`;
    const g = recentGame();
    setBackground(g ? heroOf(g) : '', '#F43F5E');
  } else {
    const p = plat(it.id);
    $('#homeTitle').textContent = p.name;
    setHomeLogo(it.id);
    const emu = p.id !== 'pc' && !S.lib.settings.emulators?.[p.id] && S.lib.games.some((x) => x.platform === p.id && x.kind === 'rom') ? ' · émulateur à configurer' : '';
    $('#homeSub').textContent = [p.maker, p.year, `${it.n} jeu${it.n > 1 ? 'x' : ''}`].filter(Boolean).join(' · ') + emu;
    const g = recentGame(p.id);
    setBackground(g ? heroOf(g) : '', p.color);
  }
  $('#counter').textContent = '';
  sweepCard();
}
function setHomeLogo(id) {
  const el = $('#homeLogo');
  const has = id && S.platLogo[id];
  el.hidden = !has;
  el.style.cssText = has ? logoCss(id) : '';
  $('#homeTitle').classList.toggle('sr-only', !!has);
}
function recentGame(pid) {
  return [...S.lib.games].filter((g) => !pid || g.platform === pid).sort((a, b) => (b.lastPlayed || b.addedAt) - (a.lastPlayed || a.addedAt))[0];
}
function heroOf(g) {
  const f = g.media?.hero || g.media?.header || g.media?.cover;
  return f ? mediaUrl(g, f) : '';
}
let sweepTimer;
function sweepCard() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    const el = cards.get(S.home.selId);
    const sw = el && $('.sweep', el);
    if (!sw) return;
    sw.classList.remove('go'); void sw.offsetWidth; sw.classList.add('go');
  }, 260);
}

function enterPlatform(id) {
  S.plat = id;
  S.view = 'games';
  document.body.dataset.view = 'games';
  S.tab = 'all';
  S.flip = 0;
  computeTabs(); computeItems();
  S.sel = 0; S.pos = -3; S.vel = 0; S.selId = S.items[0]?.id || null;
  renderTabs(); syncSlots(); updateChrome(true);
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
  computeHome();
  const i = S.home.items.findIndex((x) => x.id === S.plat);
  if (i >= 0) { S.home.sel = i; S.home.selId = S.plat; }
  syncCards();
  updateBrand();
  updateHomeChrome();
  sfx('back');
  renderHints();
}

// ---------------------------------------------------------------- Bibliothèque / filtres
function inPlat(list) { return S.plat === 'all' ? list : list.filter((g) => g.platform === S.plat); }
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
  if (S.view === 'games' && S.plat !== 'all' && !S.lib.games.some((g) => g.platform === S.plat)) { S.view = 'home'; document.body.dataset.view = 'home'; $('#btnBack').hidden = true; }
  computeHome();
  syncCards();
  computeTabs();
  computeItems();
  if (S.selId) {
    const i = S.items.findIndex((g) => g.id === S.selId);
    if (i >= 0) { const d = i - S.sel; S.sel = i; S.pos += d; }
  }
  S.sel = clamp(S.sel, 0, Math.max(0, S.items.length - 1));
  S.selId = S.items[S.sel]?.id || null;
  renderTabs();
  syncSlots();
  $('#empty').hidden = S.lib.games.length > 0;
  if (S.view === 'games') updateChrome(true); else { updateBrand(); updateHomeChrome(); }
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
  else if (c.ratio <= 1.05) { W = H0 * 0.74; H = W / c.ratio; }
  else { W = H0 * 0.98; H = W / c.ratio; }
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
  S.dims.Wref = Math.max(S.dims.H * 0.64, ...S.items.slice(0, 200).map((g) => slots.get(g.id)?._dims?.W || 0));
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
  if (S.view === 'games' && S.items[S.sel]?.id === id) $('#subtitle').textContent = S.progress[id] || '';
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
  const H = clamp(Math.min(innerHeight * 0.5, innerWidth * 0.42), 240, 640);
  S.dims.H = H;
  const CH = clamp(innerHeight * 0.44, 220, 520), CW = CH * 1.35;
  S.dims.CH = CH; S.dims.CW = CW;
  const r = document.documentElement.style;
  r.setProperty('--box-h', H + 'px');
  r.setProperty('--box-w', H * 0.64 + 'px');
  r.setProperty('--box-d', H * 0.085 + 'px');
  r.setProperty('--ch', CH + 'px');
  r.setProperty('--cw', CW + 'px');
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
  if (S.view === 'games') frameGames(t, dt); else frameHome(t, dt);
  drawMotes(t);
  requestAnimationFrame(frame);
}
function frameHome(t, dt) {
  const h = S.home;
  spring(h, h.sel, dt);
  const { CW } = S.dims;
  h.items.forEach((it, i) => {
    const el = cards.get(it.id);
    if (!el) return;
    const o = i - h.pos, a = Math.abs(o), sgn = Math.sign(o);
    const x = a <= 1 ? o * CW * 0.92 : sgn * (CW * 0.92 + (a - 1) * CW * 0.62);
    const z = -(Math.min(a, 1) * 260 + Math.max(a - 1, 0) * 120);
    let ry = clamp(-o * 24, -30, 30);
    if (!reduceMotion) ry += clamp(-h.vel * 60, -20, 20) + (a < 0.5 && S.device === 'mouse' ? S.mouse.x * 6 : 0);
    const sc = 1 - Math.min(a, 1) * 0.28 - Math.max(a - 1, 0) * 0.06;
    el.style.transform = `translate3d(${x}px, 0, ${z}px) rotateY(${ry}deg) scale(${sc})`;
    el.style.opacity = a > 3.2 ? clamp(1 - (a - 3.2), 0, 1) : 1;
    el.style.setProperty('--focus', clamp(1 - a, 0, 1).toFixed(3));
    el.style.zIndex = String(100 - Math.round(a * 10));
  });
}
function frameGames(t, dt) {
  spring(S, S.sel, dt);
  S.flipCur += (S.flip - S.flipCur) * Math.min(1, 0.13 * dt);
  const { H } = S.dims;
  const W = S.dims.Wref || H * 0.64;
  const lo = Math.floor(S.pos) - 6, hi = Math.ceil(S.pos) + 6;
  const now = new Set();
  for (let i = Math.max(0, lo); i <= Math.min(S.items.length - 1, hi); i++) {
    const g = S.items[i];
    const el = slots.get(g.id);
    if (!el) continue;
    now.add(el);
    if (el.style.display === 'none') el.style.display = '';
    if (!el._hydrated) hydrate(el);
    const o = i - S.pos, a = Math.abs(o), sgn = Math.sign(o);
    const x = a <= 1 ? o * W * 1.2 : sgn * (W * 1.2 + (a - 1) * W * 0.8);
    const z = -(Math.min(a, 1) * H * 0.42 + Math.max(a - 1, 0) * H * 0.16);
    let ry = clamp(o * 40, -44, 44);
    let rx = 0, y = 0;
    if (!reduceMotion) {
      ry += clamp(S.vel * 140, -38, 38);
      let sp = S.spin.get(i);
      if (sp) {
        ry -= sp;
        sp *= Math.pow(0.9, dt);
        if (sp < 0.4) S.spin.delete(i); else S.spin.set(i, sp);
      }
      if (a < 0.5) {
        const w = 1 - a * 2;
        ry += Math.sin(t / 1500) * 6 * w + (S.device === 'mouse' ? S.mouse.x * 9 * w : 0);
        rx = (S.device === 'mouse' ? -S.mouse.y * 5 : Math.sin(t / 2100) * 1.5) * w;
        y = Math.sin(t / 1800) * 5 * w;
      }
    }
    if (i === S.sel) ry += S.flipCur * 180;
    const dy = (H - (el._dims?.H || H)) / 2; // aligne le bas des boîtes de tailles différentes
    const sc = 1 - Math.min(a, 1) * 0.08 - Math.max(a - 1, 0) * 0.04;
    el.style.transform = `translate3d(${x}px, ${y + dy}px, ${z}px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${sc})`;
    el.style.opacity = a > 4.2 ? clamp(1 - (a - 4.2) / 1.3, 0, 1) : 1;
    el.style.setProperty('--dim', clamp(a * 0.32, 0, 0.6).toFixed(3));
    el.classList.toggle('is-selected', i === S.sel);
  }
  for (const el of visible) if (!now.has(el)) el.style.display = 'none';
  visible = now;
}

// ---------------------------------------------------------------- Fond
let bgFlip = false, bgCurrent = null, bgTimer;
function setBackground(url, tint) {
  $('#bgTint').style.background = `radial-gradient(ellipse 80% 70% at 50% 45%, ${tint || 'transparent'}, transparent 75%)`;
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
  if (!g) { setBackground('', S.plat !== 'all' ? plat(S.plat).color : ''); return; }
  if (force || $('#title').dataset.id !== g.id) {
    const cap = $('#caption');
    cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
    $('#title').textContent = g.name;
    $('#title').dataset.id = g.id;
  }
  const p = plat(g.platform);
  const bits = [S.plat === 'all' ? p.name : '', g.developer?.split(',')[0], yearOf(g), g.playtime ? fmtTime(g.playtime) + ' de jeu' : ''].filter(Boolean);
  $('#subtitle').textContent = g.metaStatus === 'loading' ? (S.progress[g.id] || 'Recherche des infos…') : bits.join(' · ') || p.name;
  setBackground(heroOf(g), p.color);
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
  toast(`Lancement de ${g.name}…`);
}
function askEmulator(pid, gameId) {
  const p = plat(pid);
  const names = (p.emulators || []).map((e) => e.name).join(', ');
  openPrompt({
    title: `Aucun émulateur pour ${p.name}`,
    body: `<p class="dim">Choisis l’exécutable de ton émulateur ${names ? `(${esc(names)})` : ''}. Les bons paramètres de lancement sont appliqués automatiquement.</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Choisir l’émulateur…', primary: true, onClick: async () => {
        const conf = await rr.pickEmulator(pid);
        if (!conf) return;
        closeOverlay();
        toast(`${conf.name} configuré pour ${p.name}`);
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
  toast(!g.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
}

// ---------------------------------------------------------------- Overlays & focus spatial
const OVERLAYS = { details: '#details', add: '#addDialog', hub: '#addHub', scan: '#scan', menu: '#menu', settings: '#settings', prompt: '#prompt' };
function openOverlay(mode) {
  if (S.mode === mode) return;
  if (S.mode !== 'main') S.stack.push(S.mode);
  S.mode = mode;
  for (const [m, sel] of Object.entries(OVERLAYS)) $(sel).hidden = !(m === mode || S.stack.includes(m));
  setTimeout(() => focusFirst(), 30);
  renderHints();
  sfx('confirm');
}
function closeOverlay(silent = false) {
  if (S.mode === 'main') return;
  if (S.mode === 'scan') rr.cancelScan();
  $(OVERLAYS[S.mode]).hidden = true;
  S.mode = S.stack.pop() || 'main';
  if (S.mode !== 'main') setTimeout(() => focusFirst(), 30);
  else document.activeElement?.blur();
  renderHints();
  if (!silent) sfx('back');
}
function closeAll() { while (S.mode !== 'main') closeOverlay(true); }
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
  const pref = list.find((el) => el.matches('.primary, [aria-selected="true"]')) || list[0];
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
  renderDetails();
  $('#dSub').hidden = true;
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
    <div><b>${g.playCount || 0}</b><span>Lancements</span></div>`;
  $('#dFav').textContent = g.favorite ? 'Retirer des favoris' : 'Favori';
  const running = S.lib.running.includes(g.id);
  $('[data-act="play"] span:last-child').textContent = running ? 'En cours…' : 'Jouer';
  $('#dShots').innerHTML = (g.screenshots || []).slice(0, 3).map((s) => `<div style="background-image:url('${mediaUrl(g, s)}')"></div>`).join('');
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
  if (act === 'images') {
    const sub = $('#dSub');
    sub.hidden = !sub.hidden;
    sub.innerHTML = ['cover:Jaquette', 'back:Dos de la boîte', 'hero:Image de fond', 'logo:Logo'].map((x) => {
      const [k, l] = x.split(':');
      return `<button class="btn small" data-img="${k}" data-nav>${l}…</button>`;
    }).join('');
    if (!sub.hidden) setFocus($('[data-img]', sub));
  }
});
$('#dSub').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-img]');
  if (!b) return;
  const r = await rr.setImage(S.items[S.sel].id, b.dataset.img);
  if (r) toast('Image mise à jour');
});

// ---------------------------------------------------------------- Invites
function openPrompt({ title, body = '', actions }) {
  $('#pTitle').textContent = title;
  $('#pBody').innerHTML = body;
  const box = $('#pActions');
  box.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
    b.textContent = a.label;
    b.dataset.nav = '';
    b.addEventListener('click', a.onClick);
    box.appendChild(b);
  });
  if (S.mode === 'prompt') { $('#prompt').hidden = false; setTimeout(focusFirst, 30); }
  else openOverlay('prompt');
}
function confirmRemove(g) {
  openPrompt({
    title: `Retirer « ${g.name} » ?`,
    body: `<p class="dim">Le jeu est seulement retiré du launcher. Ses fichiers restent sur ton disque.</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Retirer', danger: true, primary: true, onClick: async () => { await rr.removeGame(g.id); closeAll(); toast('Jeu retiré'); } },
    ],
  });
}
function quitAsk() {
  closeAll();
  openPrompt({
    title: 'Quitter RR Launcher ?',
    body: `<p class="dim">« Réduire » le garde prêt en arrière-plan (icône près de l’horloge Windows, ou <b>Ctrl+Alt+L</b>).</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Réduire', onClick: () => { closeAll(); rr.minimize(); } },
      { label: 'Quitter', primary: true, danger: true, onClick: () => rr.quit() },
    ],
  });
}
function openEdit(g) {
  const isRom = g.kind === 'rom';
  const file = g.romPath || g.exePath || g.launchUri || '';
  openPrompt({
    title: 'Modifier',
    body: `
      <div class="field"><label for="eName">Nom affiché</label><input id="eName" type="text" value="${esc(g.name)}" data-nav /></div>
      <div class="field"><label for="ePlat">Console</label><select id="ePlat" data-nav>${platformOptions(g.platform)}</select></div>
      ${g.kind === 'exe' ? `<div class="field"><label for="eArgs">Arguments de lancement <span class="dim">(optionnel)</span></label><input id="eArgs" type="text" value="${esc(g.args || '')}" placeholder="-fullscreen -novid" data-nav /></div>` : ''}
      <div class="field"><label>${isRom ? 'ROM' : g.kind === 'exe' ? 'Exécutable' : 'Lancement'}</label><div class="path-row"><code id="eExe">${esc(file)}&lrm;</code>${g.kind === 'exe' || isRom ? '<button class="btn small" id="eRepick" data-nav>Changer</button>' : ''}</div></div>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Enregistrer', primary: true, onClick: async () => {
        const patch = { name: $('#eName').value.trim() || g.name, platform: $('#ePlat').value };
        if ($('#eArgs')) patch.args = $('#eArgs').value.trim();
        if ($('#eExe').dataset.changed) patch[isRom ? 'romPath' : 'exePath'] = $('#eExe').textContent.replace(/\u200E/g, '');
        await rr.updateGame(g.id, patch);
        closeOverlay();
        toast('Modifications enregistrées');
      } },
    ],
  });
  $('#eRepick')?.addEventListener('click', async () => {
    const r = await rr.pickFile();
    if (r) { $('#eExe').textContent = r.path; $('#eExe').dataset.changed = '1'; }
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
  $('#addConfirm').textContent = rematch ? 'Mettre à jour' : 'Ajouter';
  $('#addRepick').hidden = !!rematch;
  $('#addPlatform').innerHTML = platformOptions(rematch ? rematch.platform : S.plat !== 'all' ? S.plat : 'pc');
  $('#addPlatform').disabled = !!rematch;
  $('#addStep1').hidden = !!rematch || !!path;
  $('#addStep2').hidden = !rematch && !path;
  if (S.mode !== 'add') openOverlay('add');
  if (rematch) toStep2({ path: add.file || rematch.launchUri || '', name: rematch.name, platform: rematch.platform });
  else if (path) toStep2(await rr.inspectFile(path));
}
function toStep2(info) {
  add.file = info.path;
  $('#addStep1').hidden = true;
  $('#addStep2').hidden = false;
  $('#addPath').textContent = info.path + '\u200E';
  $('#addName').value = info.name || '';
  $('#addPlatform').value = info.platform || 'pc';
  if (info.ambiguous) toast('Console non reconnue : vérifie le choix de la console');
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
  if (!term) { box.innerHTML = ''; return; }
  $('#addStatus').textContent = '· recherche…';
  add.timer = setTimeout(async () => {
    const tok = ++add.token;
    const platform = $('#addPlatform').value;
    const r = await rr.search(term, platform);
    if (tok !== add.token) return;
    const auto = platform !== 'pc' ? [{ source: 'auto', name: term }] : [];
    add.results = [...auto, ...r.results, { source: 'none', name: term }];
    add.chosen = 0;
    $('#addStatus').textContent = r.ok ? (r.results.length ? `· ${r.results.length} résultat${r.results.length > 1 ? 's' : ''}` : '· aucun résultat en ligne') : '· hors ligne ?';
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
    toast('Mise à jour des infos…');
    rr.refetch(id, match || (platform === 'pc' ? { source: 'none', name } : { source: 'auto', name }));
    return;
  }
  if (!add.file) return;
  const r = await rr.addGame({ file: add.file, name: match && match.source !== 'none' && platform === 'pc' ? match.name : name, platform, match });
  if (!r.ok) { toast(r.error, true); return; }
  closeAll();
  sfx('confirm');
  toast('Jeu ajouté — récupération des visuels…');
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
  $('#scanFound').textContent = '0'; $('#scanDirs').textContent = '0'; $('#scanPath').textContent = '';
  openOverlay('scan');
  const res = await rr.scan(mode, folders);
  if (S.mode !== 'scan') return;
  if (!res.items.length && !res.emulators.length) {
    closeOverlay(true);
    return toast(res.error || 'Aucun jeu trouvé.', true);
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
  $('#scanPath').textContent = p.current + '\u200E';
});
function renderScanResults(res) {
  $('#scanRunning').hidden = true;
  $('#scanResults').hidden = false;
  const fresh = scan.items.filter((x) => !x.exists).length;
  $('#scanSummary').textContent = `${fresh} nouveau${fresh > 1 ? 'x' : ''} jeu${fresh > 1 ? 'x' : ''} trouvé${fresh > 1 ? 's' : ''}` + (scan.items.length - fresh ? ` · ${scan.items.length - fresh} déjà dans la bibliothèque` : '') + (res.cancelled ? ' · scan interrompu' : '');
  const emuBox = $('#scanEmus');
  if (scan.emulators.length) {
    const names = [...new Set(scan.emulators.flatMap((e) => e.matches.map((m) => m.emulator)))];
    emuBox.hidden = false;
    emuBox.innerHTML = `<span><b>${names.length} émulateur${names.length > 1 ? 's' : ''} détecté${names.length > 1 ? 's' : ''}</b> : ${esc(names.join(', '))} — configurer automatiquement</span><button class="toggle" id="emuAuto" role="switch" aria-checked="true" data-nav></button>`;
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
        <span><span class="si-name">${esc(it.name)}</span><span class="si-path">${esc(it.romPath || it.exePath || it.installDir || '')}&lrm;</span></span>
        <span class="si-src">${it.exists ? 'DÉJÀ AJOUTÉ' : src(it)}</span>
      </button>`).join('')}`).join('') || '<p class="dim">Aucun nouveau jeu.</p>';
  updateScanButton();
  setTimeout(() => setFocus($('#scanImport')), 30);
}
function updateScanButton() {
  const n = scan.checked.size;
  $('#scanImport').textContent = n ? `Ajouter ${n} jeu${n > 1 ? 'x' : ''}` : 'Terminer';
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
$('#scanStop').addEventListener('click', () => { rr.cancelScan(); $('#scanPath').textContent = 'Arrêt…'; });
$('#scanImport').addEventListener('click', async () => {
  const items = scan.items.filter((x) => scan.checked.has(x.key)).map(({ key, exists, ...rest }) => rest);
  let emus = 0;
  if (scan.emulators.length && $('#emuAuto')?.getAttribute('aria-checked') === 'true') emus = await rr.applyDetectedEmulators(scan.emulators);
  closeAll();
  if (!items.length) { if (emus) toast(`${emus} émulateur${emus > 1 ? 's' : ''} configuré${emus > 1 ? 's' : ''}`); return; }
  const r = await rr.addMany(items);
  sfx('confirm');
  toast(`${r.count} jeu${r.count > 1 ? 'x' : ''} ajouté${r.count > 1 ? 's' : ''}${emus ? ` · ${emus} émulateur${emus > 1 ? 's' : ''} configuré${emus > 1 ? 's' : ''}` : ''} — récupération des visuels…`);
  goHome();
});

// ---------------------------------------------------------------- Réglages
let setPage = 'general';
function renderSettings() {
  const s = S.lib.settings;
  $$('#settings .seg').forEach((seg) => $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(s[seg.dataset.setting]) === b.dataset.value)));
  $$('#settings [data-toggle]').forEach((b) => b.setAttribute('aria-checked', !!s[b.dataset.toggle]));
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
      ? `<span>${esc(c.name || 'Émulateur')}</span><code>${esc(c.path)}&lrm;</code><input type="text" value="${esc(c.args || '')}" data-args="${p.id}" spellcheck="false" data-nav />`
      : `<span class="e-none">Aucun émulateur${p.emulators.length ? ` · conseillé : ${esc(p.emulators.map((e) => e.name).join(', '))}` : ''}</span>`;
    return `<div class="emu-row">
      <div class="e-name"><i style="background:${p.color}"></i>${esc(p.name)}</div>
      <div class="e-conf">${conf}</div>
      <div class="e-actions">
        <button class="btn small" data-emupick="${p.id}" data-nav>${c ? 'Changer' : 'Choisir…'}</button>
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
  if (plogo) { const f = await rr.setPlatformLogo(plogo.dataset.platlogo); if (f) { S.platLogo[plogo.dataset.platlogo] = f; syncCards(); syncSlots(); updateBrand(); toast('Logo mis à jour'); } return; }
  if (tab) { setPage = tab.dataset.settab; renderSettings(); sfx('tab'); return; }
  if (seg) { const k = seg.parentElement.dataset.setting; const v = k === 'volume' ? parseFloat(seg.dataset.value) : seg.dataset.value; await rr.setSettings({ [k]: v }); }
  if (tg) await rr.setSettings({ [tg.dataset.toggle]: !S.lib.settings[tg.dataset.toggle] });
  if (link) { e.preventDefault(); rr.openExternal(link.dataset.link); }
  if (pick) { const c = await rr.pickEmulator(pick.dataset.emupick); if (c) toast(`${c.name} configuré`); }
  if (del) await rr.setEmulator(del.dataset.emudel, null);
  if (pimg) { const f = await rr.setPlatformImage(pimg.dataset.platimg); if (f) { S.platImg[pimg.dataset.platimg] = f; syncCards(); toast('Image de la console mise à jour'); } }
  if (seg || tg) sfx('toggle');
});
$('#settings').addEventListener('change', (e) => {
  const a = e.target.closest('[data-args]');
  if (a) rr.setEmulator(a.dataset.args, { args: a.value.trim() });
});
$('#sgdbKey').addEventListener('change', () => rr.setSettings({ sgdbKey: $('#sgdbKey').value.trim() }));
$('#tgdbKey').addEventListener('change', () => rr.setSettings({ tgdbKey: $('#tgdbKey').value.trim() }));
$('#refetchAll').addEventListener('click', () => {
  openPrompt({
    title: 'Re-télécharger tous les visuels ?',
    body: `<p class="dim">Jaquettes, dos, fonds, logos et descriptions de tous les jeux sont récupérés à nouveau avec les sources actuelles. Les images choisies à la main sont conservées.</p>`,
    actions: [
      { label: 'Annuler', onClick: () => closeOverlay() },
      { label: 'Re-télécharger', primary: true, onClick: async () => { const n = await rr.refetchAll(); closeAll(); toast(`Mise à jour des visuels de ${n} jeu${n > 1 ? 'x' : ''}…`); } },
    ],
  });
});

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
    case 'installUpdate': if (S.update?.state === 'ready') { toast('Installation de la mise à jour…'); rr.installUpdate(); } break;
    case 'play': play(); break;
    case 'details': openDetails(); break;
    case 'flip': flip(); break;
    case 'tabNext': cycleTab(1); break;
    case 'open': openHomeItem(); break;
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
};
function glyph(btn) {
  if (S.device === 'pad') {
    const ps = S.padType === 'ps';
    const map = { a: ps ? ['✕', 'g-a'] : ['A', 'g-a'], b: ps ? ['○', 'g-b'] : ['B', 'g-b'], x: ps ? ['□', 'g-x'] : ['X', 'g-x'], y: ps ? ['△', 'g-y'] : ['Y', 'g-y'] };
    if (map[btn]) return `<span class="glyph round ${ps ? 'ps ' : ''}${map[btn][1]}">${map[btn][0]}</span>`;
    const pill = { lb: ps ? 'L1' : 'LB', rb: ps ? 'R1' : 'RB', view: ps ? 'SHARE' : 'VIEW', menu: ps ? 'OPTIONS' : 'MENU', lr: ICON.lr }[btn];
    return `<span class="glyph pill">${pill}</span>`;
  }
  const keys = { a: 'Entrée', b: S.mode === 'main' ? 'Échap' : 'Échap', x: 'I', y: 'Espace', lb: 'Tab', view: 'N', menu: S.view === 'home' ? 'Échap' : 'M', lr: ICON.lr };
  return keys[btn] ? `<span class="glyph">${keys[btn]}</span>` : '';
}
function renderHints() {
  const H = [];
  const h = (btns, label, act) => H.push({ btns, label, act });
  if (S.mode !== 'main') { h(['a'], 'Valider', null); h(['b'], 'Retour', 'close'); }
  else if (!S.lib.games.length) { h(['a'], 'Importer', 'scanLaunchers'); h(['view'], 'Ajouter des jeux', 'addHub'); h(['menu'], 'Menu', 'menu'); }
  else if (S.view === 'home') {
    h(['lr'], 'Naviguer', null);
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
  $$('[data-glyph]').forEach((el) => { el.innerHTML = S.device === 'pad' ? glyph({ menu: 'menu', a: 'a' }[el.dataset.glyph] || 'a').replace(/<\/?span[^>]*>/g, '') : ''; });
  $('#inputInd').innerHTML = ICON[S.device === 'pad' ? 'pad' : S.device === 'mouse' ? 'mouse' : 'kbd'];
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
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
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
    ArrowRight: () => move(1), ArrowLeft: () => move(-1), Home: () => select(0, { spin: false }), End: () => select(S.items.length - 1, { spin: false }),
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
    if (S.view === 'home') homeSelect(S.home.sel + d); else move(d);
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
  if (dir === 'left') move(-1);
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
  else if (btn === 'b') closeOverlay();
  else if (btn === 'menu') action('menu');
  else if (btn === 'y' && S.mode === 'details') play();
}
addEventListener('gamepadconnected', () => { setDevice('pad'); toast('Manette connectée'); });

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
  if (u.state === 'ready') { chip.hidden = false; chip.classList.remove('busy'); chip.textContent = `Mise à jour ${u.version} · Redémarrer`; }
  else if (u.state === 'downloading') { chip.hidden = false; chip.classList.add('busy'); chip.textContent = `Téléchargement v${u.version || ''} · ${u.progress || 0} %`; }
  else chip.hidden = true;
}
let manualCheck = false;
async function checkUpdate() {
  manualCheck = true;
  toast('Recherche de mises à jour…');
  const u = await rr.checkUpdate();
  if (u.state === 'dev') toast('Mises à jour désactivées en mode développement');
}
rr.onUpdate((u) => {
  const prev = S.update?.state;
  renderUpdate(u);
  if (u.state === 'ready' && prev !== 'ready') toast(`Version ${u.version} prête : « Redémarrer » en haut à droite`);
  if (manualCheck && u.state === 'uptodate') { toast(`Tu as la dernière version (v${u.current})`); manualCheck = false; }
  if (manualCheck && u.state === 'error') { toast('Impossible de vérifier les mises à jour', true); manualCheck = false; }
  if (u.state === 'downloading' && prev !== 'downloading') toast(`Nouvelle version ${u.version} : téléchargement…`);
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

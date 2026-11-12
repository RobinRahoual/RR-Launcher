/* RR Launcher — interface (carrousel 3D, manette / clavier / souris) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- État
const S = {
  lib: { games: [], settings: {}, running: [] },
  items: [],
  tabs: [],
  tab: 'all',
  sel: 0,
  selId: null,
  pos: -4,
  vel: 0,
  flip: 0,
  flipCur: 0,
  spin: new Map(), // index -> degrés restants
  progress: {},
  mode: 'main', // main | details | add | menu | settings | prompt
  stack: [],
  device: 'kbd',
  padType: 'xbox',
  dims: { W: 300, H: 470, D: 40 },
  mouse: { x: 0, y: 0 },
};
const slots = new Map(); // id -> élément

const CASES = { red: '#d4142c', black: '#1c1c24', blue: '#1b55c9' };

// ---------------------------------------------------------------- Utilitaires
const mediaUrl = (g, file) => (file ? `rr://media/${g.id}/${encodeURIComponent(file)}?v=${g.mediaVersion || 0}` : '');
const yearOf = (g) => (String(g.releaseDate || '').match(/\d{4}/) || [])[0] || '';
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
function caseColor(g) {
  const st = S.lib.settings.caseStyle || 'red';
  if (st === 'auto') return g.color ? `color-mix(in oklab, ${g.color} 72%, black)` : CASES.red;
  return CASES[st] || CASES.red;
}

// ---------------------------------------------------------------- Sons
let audio;
function beep(kind) {
  if (!S.lib.settings.sounds) return;
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    const tones = { move: [[660, 0.025]], ok: [[740, 0.04], [990, 0.06]], back: [[520, 0.04], [390, 0.05]], tab: [[880, 0.03]] }[kind] || [[600, 0.03]];
    let at = t;
    for (const [f, d] of tones) {
      const o = audio.createOscillator(), gn = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(0.05, at + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(gn).connect(audio.destination);
      o.start(at); o.stop(at + d + 0.02);
      at += d * 0.9;
    }
  } catch { /* pas de son */ }
}

// ---------------------------------------------------------------- Toast
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- Bibliothèque / filtres
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
  const g = S.lib.games;
  const tabs = [{ id: 'all', label: 'Tous', n: g.length }];
  const fav = g.filter((x) => x.favorite).length;
  const rec = g.filter((x) => x.lastPlayed).length;
  if (fav) tabs.push({ id: 'fav', label: 'Favoris', n: fav });
  if (rec) tabs.push({ id: 'recent', label: 'Récents', n: rec });
  const genres = new Map();
  for (const x of g) for (const gen of x.genres || []) genres.set(gen, (genres.get(gen) || 0) + 1);
  [...genres.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .forEach(([gen, n]) => tabs.push({ id: 'g:' + gen, label: gen, n }));
  S.tabs = tabs;
  if (!tabs.some((t) => t.id === S.tab)) S.tab = 'all';
}
function computeItems() {
  let list = S.lib.games;
  if (S.tab === 'fav') list = list.filter((x) => x.favorite);
  else if (S.tab === 'recent') list = [...list].filter((x) => x.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  else if (S.tab.startsWith('g:')) list = list.filter((x) => (x.genres || []).includes(S.tab.slice(2)));
  S.items = S.tab === 'recent' ? list : sorted(list);
}

function refresh({ keepSel = true } = {}) {
  computeTabs();
  computeItems();
  if (keepSel && S.selId) {
    const i = S.items.findIndex((g) => g.id === S.selId);
    if (i >= 0) { const d = i - S.sel; S.sel = i; S.pos += d; }
  }
  S.sel = clamp(S.sel, 0, Math.max(0, S.items.length - 1));
  S.selId = S.items[S.sel]?.id || null;
  renderTabs();
  syncSlots();
  updateChrome(true);
  if (S.mode === 'details') renderDetails();
}

// ---------------------------------------------------------------- Rendu boîtes
function artHTML(g, lazy) {
  const src = (f) => (lazy ? `data-src="${mediaUrl(g, f)}"` : `src="${mediaUrl(g, f)}"`);
  if (g.media?.cover) return `<img class="cover" ${src(g.media.cover)} alt="" decoding="async" />`;
  const bg = g.media?.hero || g.media?.header;
  const style = bg ? `style="background-image:url('${mediaUrl(g, bg)}')"` : `style="background:linear-gradient(160deg, ${g.color || '#3a1d5c'}, #0b0b16)"`;
  const logo = g.media?.logo ? `<img ${src(g.media.logo)} alt="" />` : `<span>${esc(g.name)}</span>`;
  return `<div class="gen" ${style}>${logo}</div>`;
}
function backHTML(g) {
  const hero = g.media?.hero || g.media?.header;
  const shots = (g.screenshots || []).slice(0, 2).map((s) => `<div style="background-image:url('${mediaUrl(g, s)}')"></div>`).join('');
  return `
    <div class="b-hero" style="${hero ? `background-image:url('${mediaUrl(g, hero)}')` : ''}">${g.media?.logo ? `<img src="${mediaUrl(g, g.media.logo)}" alt="" />` : ''}</div>
    <div class="b-text">${esc(g.description || 'Aucune description disponible.')}</div>
    ${shots ? `<div class="b-shots">${shots}</div>` : ''}
    <div class="b-foot"><span>${esc(g.developer || 'PC')}</span><span>${esc(yearOf(g))}</span></div>`;
}
function slotHTML(g) {
  const name = esc(g.name);
  const loading = g.metaStatus === 'loading'
    ? `<div class="loading-veil"><div class="spinner"></div><div class="lv-msg">${esc(S.progress[g.id] || 'Recherche…')}</div></div>` : '';
  const fav = g.favorite ? `<div class="fav-badge"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg></div>` : '';
  const running = S.lib.running.includes(g.id) ? `<div class="running-badge">EN COURS</div>` : '';
  const reflectImg = g.media?.cover ? `<img data-src="${mediaUrl(g, g.media.cover)}" alt="" />` : '';
  return `
    <div class="halo"></div>
    <div class="box" style="--case:${caseColor(g)}">
      <div class="face front">
        <div class="band"><span class="band-mark"><span class="band-rr">RR</span><span class="band-pc"><span>PC</span><span>GAMES</span></span></span></div>
        <div class="art">${artHTML(g, true)}<div class="gloss"></div>${loading}</div>
        ${fav}${running}
      </div>
      <div class="face back">${backHTML(g)}</div>
      <div class="face spine left"><span class="s-rr">RR</span><span class="s-name">${name}</span></div>
      <div class="face spine right"><span class="s-rr">RR</span><span class="s-name">${name}</span></div>
      <div class="face cap top"></div>
      <div class="face cap bottom"></div>
      <div class="face reflect">${reflectImg}</div>
    </div>
    <div class="shadow"></div>`;
}
const sig = (g) => JSON.stringify([g.name, g.media, g.mediaVersion, g.metaStatus, g.favorite, g.color, S.lib.settings.caseStyle, S.lib.running.includes(g.id), g.description, g.screenshots]);

function syncSlots() {
  const car = $('#carousel');
  const ids = new Set(S.items.map((g) => g.id));
  for (const [id, el] of slots) if (!ids.has(id)) { el.remove(); slots.delete(id); }
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
    if (el._sig !== s) { el.innerHTML = slotHTML(g); el._sig = s; el._hydrated = false; }
    el._index = i;
  });
  $('#empty').hidden = S.lib.games.length > 0;
  $('#caption').hidden = S.items.length === 0;
  if (S.lib.games.length && !S.items.length) { $('#title').textContent = 'Aucun jeu dans cette catégorie'; $('#caption').hidden = false; $('#subtitle').textContent = ''; }
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
  if (S.items[S.sel]?.id === id) $('#subtitle').textContent = S.progress[id] || '';
}

// ---------------------------------------------------------------- Dimensions
function measure() {
  const H = clamp(Math.min(innerHeight * 0.5, innerWidth * 0.42), 240, 640);
  const W = H * 0.64, D = H * 0.085;
  S.dims = { W, H, D };
  const r = document.documentElement.style;
  r.setProperty('--box-h', H + 'px');
  r.setProperty('--box-w', W + 'px');
  r.setProperty('--box-d', D + 'px');
}
addEventListener('resize', measure);

// ---------------------------------------------------------------- Boucle d'animation
let last = performance.now();
let visible = new Set();
function frame(t) {
  const dt = Math.min(3, (t - last) / 16.667);
  last = t;
  pollPad(t);

  // Ressort de position
  const k = reduceMotion ? 0.5 : 0.085, damp = reduceMotion ? 0.3 : 0.74;
  S.vel += (S.sel - S.pos) * k * dt;
  S.vel *= Math.pow(damp, dt);
  S.pos += S.vel * dt;
  if (Math.abs(S.sel - S.pos) < 0.0008 && Math.abs(S.vel) < 0.0008) { S.pos = S.sel; S.vel = 0; }
  S.flipCur += (S.flip - S.flipCur) * Math.min(1, 0.13 * dt);

  const { W, H } = S.dims;
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
    const sc = 1 - Math.min(a, 1) * 0.08 - Math.max(a - 1, 0) * 0.04;
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${sc})`;
    el.style.opacity = a > 4.2 ? clamp(1 - (a - 4.2) / 1.3, 0, 1) : 1;
    el.style.setProperty('--dim', clamp(a * 0.32, 0, 0.6).toFixed(3));
    el.classList.toggle('is-selected', i === S.sel);
  }
  for (const el of visible) if (!now.has(el)) el.style.display = 'none';
  visible = now;

  drawMotes(t, dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- Fond
let bgFlip = false, bgCurrent = '', bgTimer;
function setBackground(url) {
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

// Lucioles
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
  if (reduceMotion || !motesCtx || t - motesLast < 33) return;
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

// ---------------------------------------------------------------- Chrome (titre, compteur, etc.)
function updateChrome(force = false) {
  const g = S.items[S.sel];
  $('#counter').textContent = S.items.length ? `${S.sel + 1} / ${S.items.length}` : '';
  const n = S.lib.games.length;
  const tabLabel = S.tabs.find((t) => t.id === S.tab)?.label || 'Tous';
  $('#brandSub').textContent = `PC · ${n} jeu${n > 1 ? 'x' : ''} · ${tabLabel}`;
  $('#brandSort').textContent = { recent: 'Tri : récents', name: 'Tri : A → Z', added: 'Tri : ajout', playtime: 'Tri : temps de jeu' }[S.lib.settings.sort || 'recent'];
  if (!g) { setBackground(''); return; }
  if (force || $('#title').dataset.id !== g.id) {
    const cap = $('#caption');
    cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
    $('#title').textContent = g.name;
    $('#title').dataset.id = g.id;
  }
  const bits = [g.developer?.split(',')[0], yearOf(g), g.playtime ? fmtTime(g.playtime) + ' de jeu' : ''].filter(Boolean);
  $('#subtitle').textContent = g.metaStatus === 'loading' ? (S.progress[g.id] || 'Recherche des infos…') : bits.join(' · ') || 'PC';
  const bg = g.media?.hero || g.media?.header || g.media?.cover;
  setBackground(bg ? mediaUrl(g, bg) : '');
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = S.tabs.map((t) =>
    `<button class="tab" role="tab" aria-selected="${t.id === S.tab}" data-tab="${esc(t.id)}">${esc(t.label)}<span class="count">${t.n}</span></button>`).join('');
  nav.hidden = S.lib.games.length === 0;
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
  beep('tab');
}
function cycleTab(d) {
  if (S.tabs.length < 2) return;
  const i = S.tabs.findIndex((t) => t.id === S.tab);
  setTab(S.tabs[(i + d + S.tabs.length) % S.tabs.length].id);
}

// ---------------------------------------------------------------- Navigation principale
function select(i, { spin = true } = {}) {
  if (!S.items.length) return;
  i = clamp(i, 0, S.items.length - 1);
  if (i === S.sel) return;
  if (spin && !reduceMotion) S.spin.set(i, 360);
  S.sel = i;
  S.selId = S.items[i].id;
  S.flip = 0;
  updateChrome();
  beep('move');
}
const move = (d) => select(S.sel + d, { spin: Math.abs(d) === 1 });
function onSlotClick(id) {
  if (S.mode !== 'main') return;
  const i = S.items.findIndex((g) => g.id === id);
  if (i === S.sel) openDetails(); else select(i);
}
function flip() { if (S.items.length) { S.flip = S.flip ? 0 : 1; beep('tab'); } }

async function play(id = S.items[S.sel]?.id) {
  const g = S.lib.games.find((x) => x.id === id);
  if (!g) return;
  if (g.metaStatus === 'loading') { /* lançable quand même */ }
  beep('ok');
  toast(`Lancement de ${g.name}…`);
  const r = await rr.launch(id);
  if (!r.ok) toast(r.error || 'Impossible de lancer le jeu.', true);
}
async function toggleFav(id = S.items[S.sel]?.id) {
  const g = S.lib.games.find((x) => x.id === id);
  if (!g) return;
  await rr.updateGame(id, { favorite: !g.favorite });
  toast(!g.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
}

// ---------------------------------------------------------------- Overlays & focus spatial
const OVERLAYS = { details: '#details', add: '#addDialog', menu: '#menu', settings: '#settings', prompt: '#prompt' };
function openOverlay(mode) {
  if (S.mode !== 'main') S.stack.push(S.mode);
  S.mode = mode;
  for (const [m, sel] of Object.entries(OVERLAYS)) $(sel).hidden = !(m === mode || S.stack.includes(m));
  setTimeout(() => focusFirst(), 30);
  renderHints();
}
function closeOverlay() {
  if (S.mode === 'main') return;
  $(OVERLAYS[S.mode]).hidden = true;
  S.mode = S.stack.pop() || 'main';
  if (S.mode !== 'main') setTimeout(() => focusFirst(), 30);
  else document.activeElement?.blur();
  renderHints();
  beep('back');
}
function closeAll() { while (S.mode !== 'main') closeOverlay(); }
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
  if (best) { setFocus(best); beep('move'); }
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
  const hero = g.media?.hero || g.media?.header || g.media?.cover;
  $('#dBg').style.backgroundImage = hero ? `url("${mediaUrl(g, hero)}")` : 'none';
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
  $('[data-act="play"]').lastChild.textContent = running ? 'En cours…' : 'Jouer';
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
    sub.innerHTML = ['cover:Jaquette', 'hero:Image de fond', 'logo:Logo'].map((x) => {
      const [k, l] = x.split(':');
      return `<button class="btn small" data-img="${k}" data-nav>${l}…</button>`;
    }).join('');
    if (!sub.hidden) setFocus($('[data-img]', sub));
  }
});
$('#dSub').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-img]');
  if (!b) return;
  const g = S.items[S.sel];
  const r = await rr.setImage(g.id, b.dataset.img);
  if (r) toast('Image mise à jour');
});

// ---------------------------------------------------------------- Invite (confirmation / édition)
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
  openOverlay('prompt');
}
function confirmRemove(g) {
  openPrompt({
    title: `Supprimer « ${g.name} » ?`,
    body: `<p class="dim">Le jeu est seulement retiré du launcher. Ses fichiers restent sur ton disque.</p>`,
    actions: [
      { label: 'Annuler', onClick: closeOverlay },
      { label: 'Supprimer', danger: true, primary: true, onClick: async () => { await rr.removeGame(g.id); closeAll(); toast('Jeu retiré'); } },
    ],
  });
}
function openEdit(g) {
  openPrompt({
    title: 'Modifier',
    body: `
      <div class="field"><label for="eName">Nom affiché</label><input id="eName" type="text" value="${esc(g.name)}" data-nav /></div>
      <div class="field"><label for="eArgs">Arguments de lancement <span class="dim">(optionnel)</span></label><input id="eArgs" type="text" value="${esc(g.args || '')}" placeholder="-fullscreen -novid" data-nav /></div>
      <div class="field"><label>Exécutable</label><div class="path-row"><code id="eExe">${esc(g.exePath)}</code><button class="btn small" id="eRepick" data-nav>Changer</button></div></div>`,
    actions: [
      { label: 'Annuler', onClick: closeOverlay },
      { label: 'Enregistrer', primary: true, onClick: async () => {
        const patch = { name: $('#eName').value.trim() || g.name, args: $('#eArgs').value.trim() };
        if ($('#eExe').dataset.changed) patch.exePath = $('#eExe').textContent;
        await rr.updateGame(g.id, patch);
        closeOverlay();
        toast('Modifications enregistrées');
      } },
    ],
  });
  $('#eRepick').addEventListener('click', async () => {
    const r = await rr.pickExe();
    if (r) { $('#eExe').textContent = r.exePath; $('#eExe').dataset.changed = '1'; }
  });
}

// ---------------------------------------------------------------- Ajout de jeu
const add = { exePath: '', results: [], chosen: 0, rematch: null, timer: null, token: 0 };
async function openAdd({ path, rematch } = {}) {
  add.rematch = rematch || null;
  add.exePath = rematch ? rematch.exePath : '';
  $('#addTitle').textContent = rematch ? `Corriger « ${rematch.name} »` : 'Ajouter un jeu';
  $('#addConfirm').textContent = rematch ? 'Mettre à jour' : 'Ajouter';
  $('#addRepick').hidden = !!rematch;
  $('#addStep1').hidden = !!rematch || !!path;
  $('#addStep2').hidden = !rematch && !path;
  if (S.mode !== 'add') openOverlay('add');
  if (rematch) toStep2(rematch.exePath, rematch.name);
  else if (path) toStep2(path, (await rr.inspectExe(path)).name);
}
function toStep2(exePath, name) {
  add.exePath = exePath;
  $('#addStep1').hidden = true;
  $('#addStep2').hidden = false;
  $('#addPath').textContent = exePath;
  $('#addName').value = name || '';
  runSearch();
  setTimeout(() => setFocus($('#addConfirm')), 30);
}
async function pickExe() {
  const r = await rr.pickExe();
  if (r) {
    if (S.mode !== 'add') await openAdd();
    toStep2(r.exePath, r.name);
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
    const r = await rr.search(term);
    if (tok !== add.token) return;
    add.results = [...r.results, { source: 'none', name: term }];
    add.chosen = 0;
    $('#addStatus').textContent = r.ok ? (r.results.length ? `· ${r.results.length} résultat${r.results.length > 1 ? 's' : ''}` : '· aucun résultat en ligne') : '· hors ligne ?';
    renderResults();
  }, 350);
}
function renderResults() {
  $('#addResults').innerHTML = add.results.map((x, i) => {
    const thumb = x.thumb ? `style="background-image:url('${esc(x.thumb)}')"` : `style="background:rgba(255,255,255,.06)"`;
    const src = x.source === 'steam' ? 'STEAM' : x.source === 'sgdb' ? 'STEAMGRIDDB' : 'SANS INFOS';
    const name = x.source === 'none' ? `Ajouter « ${esc(x.name)} » sans infos en ligne` : esc(x.name) + (x.year ? ` <span class="dim">(${x.year})</span>` : '');
    return `<button class="result" role="option" aria-selected="${i === add.chosen}" data-i="${i}" data-nav><span class="thumb" ${thumb}></span><span class="r-name">${name}</span><span class="r-src">${src}</span></button>`;
  }).join('');
}
$('#addResults').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  add.chosen = +b.dataset.i;
  $$('.result').forEach((r) => r.setAttribute('aria-selected', r === b));
  beep('tab');
});
$('#addName').addEventListener('input', runSearch);
$('#addName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); } });
$('#addConfirm').addEventListener('click', confirmAdd);
async function confirmAdd() {
  const match = add.results[add.chosen] || null;
  const name = $('#addName').value.trim();
  if (add.rematch) {
    const id = add.rematch.id;
    closeAll();
    toast('Mise à jour des infos…');
    rr.refetch(id, match && match.source !== 'none' ? match : { source: 'none', name });
    return;
  }
  if (!add.exePath) return;
  const r = await rr.addGame({ exePath: add.exePath, name: match && match.source !== 'none' ? match.name : name, match: match && match.source !== 'none' ? match : { source: 'none', name } });
  if (!r.ok) { toast(r.error, true); return; }
  closeAll();
  S.tab = 'all';
  S.selId = r.id;
  toast('Jeu ajouté — récupération des visuels…');
  beep('ok');
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
  const p = rr.pathForFile(f);
  if (!/\.(exe|lnk|url|bat|cmd)$/i.test(p)) return toast('Dépose un fichier .exe, .lnk, .url ou .bat', true);
  closeAll();
  openAdd({ path: p });
});

// ---------------------------------------------------------------- Réglages
function renderSettings() {
  const s = S.lib.settings;
  $$('#settings .seg').forEach((seg) => $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', s[seg.dataset.setting] === b.dataset.value)));
  $$('#settings [data-toggle]').forEach((b) => b.setAttribute('aria-checked', !!s[b.dataset.toggle]));
  if (document.activeElement !== $('#sgdbKey')) $('#sgdbKey').value = s.sgdbKey || '';
}
$('#settings').addEventListener('click', async (e) => {
  const seg = e.target.closest('.seg button');
  const tg = e.target.closest('[data-toggle]');
  const link = e.target.closest('[data-link]');
  if (seg) await rr.setSettings({ [seg.parentElement.dataset.setting]: seg.dataset.value });
  if (tg) await rr.setSettings({ [tg.dataset.toggle]: !S.lib.settings[tg.dataset.toggle] });
  if (link) { e.preventDefault(); rr.openExternal(link.dataset.link); }
  if (seg || tg) beep('tab');
});
$('#sgdbKey').addEventListener('change', () => rr.setSettings({ sgdbKey: $('#sgdbKey').value.trim() }));

// ---------------------------------------------------------------- Actions génériques
async function action(name) {
  switch (name) {
    case 'add': closeAll(); openAdd(); break;
    case 'pick': pickExe(); break;
    case 'menu': S.mode === 'menu' ? closeOverlay() : (closeAll(), openOverlay('menu')); break;
    case 'settings': closeAll(); renderSettings(); openOverlay('settings'); break;
    case 'fullscreen': await rr.toggleFullscreen(); break;
    case 'minimize': closeAll(); rr.minimize(); break;
    case 'quit': rr.quit(); break;
    case 'close': closeOverlay(); break;
    case 'checkUpdate': checkUpdate(); break;
    case 'installUpdate': if (S.update?.state === 'ready') { toast('Installation de la mise à jour…'); rr.installUpdate(); } break;
    case 'play': play(); break;
    case 'details': openDetails(); break;
    case 'flip': flip(); break;
    case 'tabNext': cycleTab(1); break;
    case 'tabPrev': cycleTab(-1); break;
    case 'prev': move(-1); break;
    case 'next': move(1); break;
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
    const map = {
      a: ps ? ['✕', 'g-a'] : ['A', 'g-a'], b: ps ? ['○', 'g-b'] : ['B', 'g-b'],
      x: ps ? ['□', 'g-x'] : ['X', 'g-x'], y: ps ? ['△', 'g-y'] : ['Y', 'g-y'],
    };
    if (map[btn]) return `<span class="glyph round ${ps ? 'ps ' : ''}${map[btn][1]}">${map[btn][0]}</span>`;
    const pill = { lb: ps ? 'L1' : 'LB', rb: ps ? 'R1' : 'RB', view: ps ? 'SHARE' : 'VIEW', menu: ps ? 'OPTIONS' : 'MENU', lr: ICON.lr }[btn];
    return `<span class="glyph pill">${pill}</span>`;
  }
  const keys = { a: 'Entrée', b: 'Échap', x: 'I', y: 'Espace', lb: 'Tab', rb: '', view: 'N', menu: 'Échap', lr: ICON.lr, add: 'N' };
  return keys[btn] ? `<span class="glyph">${keys[btn]}</span>` : '';
}
function renderHints() {
  const H = [];
  const h = (btns, label, act) => H.push({ btns, label, act });
  if (S.mode === 'main') {
    if (S.items.length) {
      h(['lr'], 'Naviguer', null);
      h(['a'], 'Jouer', 'play');
      h(['x'], 'Détails', 'details');
      h(['y'], 'Retourner', 'flip');
      if (S.tabs.length > 1) h(S.device === 'pad' ? ['lb', 'rb'] : ['lb'], 'Catégories', 'tabNext');
    }
    h(['view'], 'Ajouter', 'add');
    h(['menu'], 'Menu', 'menu');
  } else {
    h(['a'], 'Valider', null);
    h(['b'], 'Retour', 'close');
  }
  $('#hints').innerHTML = H.map((x, i) => `<button class="hint" data-hint="${i}" ${x.act ? '' : 'tabindex="-1"'}>${x.btns.map(glyph).join('')}${esc(x.label)}</button>`).join('');
  $$('#hints .hint').forEach((b) => b.addEventListener('click', () => { const a = H[+b.dataset.hint].act; if (a) action(a); }));
  $$('[data-glyph]').forEach((el) => { el.innerHTML = S.device === 'pad' ? glyph({ menu: 'menu', add: 'view', a: 'a' }[el.dataset.glyph]).replace(/<\/?span[^>]*>/g, '') : ''; });
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
  const inInput = !!e.target.matches?.('input');
  if (e.key === 'F11') { e.preventDefault(); action('fullscreen'); return; }
  if (S.mode !== 'main') {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[e.key] && !(inInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) { e.preventDefault(); spatial(dirs[e.key]); }
    return;
  }
  if (inInput) return;
  const k = e.key;
  const map = {
    ArrowRight: () => move(1), ArrowLeft: () => move(-1), Home: () => select(0, { spin: false }), End: () => select(S.items.length - 1, { spin: false }),
    PageDown: () => move(5), PageUp: () => move(-5), Enter: () => (S.items.length ? play() : action('add')),
    ArrowUp: openDetails, i: openDetails, I: openDetails, ' ': flip, f: () => toggleFav(), F: () => toggleFav(),
    n: () => action('add'), N: () => action('add'), Insert: () => action('add'), s: () => action('settings'), S: () => action('settings'),
    Escape: () => (S.flip ? flip() : action('menu')), Delete: () => S.items[S.sel] && confirmRemove(S.items[S.sel]),
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
$('#stage').addEventListener('wheel', (e) => {
  if (S.mode !== 'main') return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelT > 250) wheelAcc = 0;
  wheelT = now;
  wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  while (Math.abs(wheelAcc) >= 60) { move(Math.sign(wheelAcc)); wheelAcc -= Math.sign(wheelAcc) * 60; }
}, { passive: false });
$$('.overlay').forEach((o) => o.addEventListener('mousedown', (e) => { if (e.target === o && S.mode !== 'details') closeOverlay(); }));
$('#details').addEventListener('mousedown', (e) => { if (e.target.closest('.details') === null || e.target.classList.contains('details')) closeOverlay(); });

// ---------------------------------------------------------------- Manette (Gamepad API, mapping standard)
const pad = { prev: [], held: {}, axisDir: null };
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

  // Directions avec répétition
  if (dir) {
    if (pad.axisDir !== dir) { pad.axisDir = dir; pad.next = t + REPEAT_DELAY; onPadDir(dir, false); }
    else if (t >= pad.next) { pad.next = t + REPEAT_RATE; onPadDir(dir, true); }
  } else pad.axisDir = null;

  if (pressed(0)) onPadBtn('a');
  if (pressed(1)) onPadBtn('b');
  if (pressed(2)) onPadBtn('x');
  if (pressed(3)) onPadBtn('y');
  if (pressed(4)) onPadBtn('lb');
  if (pressed(5)) onPadBtn('rb');
  if (pressed(6)) onPadBtn('lt');
  if (pressed(7)) onPadBtn('rt');
  if (pressed(8)) onPadBtn('view');
  if (pressed(9)) onPadBtn('menu');
  pad.prev = b;
}
function onPadDir(dir, repeat) {
  if (S.mode === 'main') {
    if (dir === 'left') move(-1);
    else if (dir === 'right') move(1);
    else if (dir === 'up' && !repeat) openDetails();
    else if (!S.lib.games.length && !repeat) setFocus($('#empty [data-nav]'));
  } else spatial(dir);
}
function onPadBtn(btn) {
  if (S.mode === 'main') {
    const m = {
      a: () => (S.items.length ? play() : action('add')), b: () => S.flip && flip(), x: openDetails, y: flip,
      lb: () => cycleTab(-1), rb: () => cycleTab(1), lt: () => move(-5), rt: () => move(5), view: () => action('add'), menu: () => action('menu'),
    }[btn];
    return m && m();
  }
  if (btn === 'a') { const el = document.activeElement; if (el && el !== document.body) { el.click(); beep('ok'); } }
  else if (btn === 'b') closeOverlay();
  else if (btn === 'menu') action('menu');
  else if (btn === 'y' && S.mode === 'details') play();
}
addEventListener('gamepadconnected', (e) => { setDevice('pad'); toast(`Manette connectée`); });

// ---------------------------------------------------------------- Horloge
function tick() {
  const d = new Date();
  $('#date').textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#time').textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- Événements du processus principal
function applyLib(state) {
  S.lib = state;
  refresh();
  if (S.mode === 'settings') renderSettings();
}
rr.onLibrary(applyLib);
rr.onProgress(({ id, msg, done }) => {
  if (done) delete S.progress[id];
  else { S.progress[id] = msg; updateProgressText(id); }
});
rr.onRunning(({ id, running }) => {
  if (!running) toast('Session terminée');
});

// ---------------------------------------------------------------- Mises à jour
function renderUpdate(u) {
  S.update = u;
  const chip = $('#btnUpdate');
  $('#menuVersion').textContent = 'v' + (u.current || '');
  $('#menuInstall').hidden = u.state !== 'ready';
  if (u.state === 'ready') {
    chip.hidden = false; chip.classList.remove('busy');
    chip.textContent = `Mise à jour ${u.version} · Redémarrer`;
  } else if (u.state === 'downloading') {
    chip.hidden = false; chip.classList.add('busy');
    chip.textContent = `Téléchargement v${u.version || ''} · ${u.progress || 0} %`;
  } else chip.hidden = true;
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
  if (u.state === 'ready' && prev !== 'ready') toast(`Version ${u.version} prête : clique sur « Redémarrer » en haut à droite`);
  if (manualCheck && u.state === 'uptodate') { toast(`Tu as la dernière version (v${u.current})`); manualCheck = false; }
  if (manualCheck && u.state === 'error') { toast('Impossible de vérifier les mises à jour', true); manualCheck = false; }
  if (u.state === 'downloading' && prev !== 'downloading') toast(`Nouvelle version ${u.version} : téléchargement en cours…`);
});

// ---------------------------------------------------------------- Démarrage
(async function init() {
  measure();
  initMotes();
  tick(); setInterval(tick, 10000);
  S.lib = await rr.getLibrary();
  computeTabs(); computeItems();
  S.selId = S.items[0]?.id || null;
  refresh({ keepSel: false });
  renderHints();
  renderUpdate(await rr.getUpdate());
  requestAnimationFrame(frame);
})();

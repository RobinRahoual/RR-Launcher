/* Module stats — page Statistiques façon « Récap » (overlay #stats), activité sur la page du jeu, réglages.
   Agrégats calculés dans le processus principal (src/features/stats.js) : x:stats:get / x:stats:game.
   Accroches : RR.actions.stats, OVERLAYS.stats, RR.on('selection'|'library'), rr.onX('x:stats:changed').
   Deux surcharges locales assumées : spatial() (navigation par sections en mode « stats ») et renderHints() (aide LB/RB). */
(() => {
  'use strict';
  const PERIODS = [['week', 'Cette semaine'], ['month', 'Ce mois'], ['year', 'Cette année'], ['all', 'Tout']];
  const ST = { period: 'all', offset: 0, data: null, built: false, req: 0 };
  const SV = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON_BARS = '<path d="M5 20V11M12 20V4M19 20v-6"/>';

  // ------------------------------------------------------------ Formats (fr-FR, jours « civils » lus en UTC : les clés sont déjà en heure de Paris)
  const dk = (key) => new Date(`${key}T12:00:00Z`);
  const fmtK = (key, o) => dk(key).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
  const dur = (s = 0) => {
    s = Math.round(s);
    if (s < 60) return s ? `${s} s` : '0 min';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  };
  const durBig = (s = 0) => {
    const m = Math.round(s / 60);
    if (m < 60) return `${m}<small>min</small>`;
    const h = Math.floor(m / 60), r = m % 60;
    return `${h}<small>h</small>${r ? ` ${String(r).padStart(2, '0')}<small>min</small>` : ''}`;
  };
  const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
  function rangeLabel(d) {
    const { from, to } = d.range;
    if (d.period === 'week') {
      const a = dk(from), b = dk(to), sameM = a.getUTCMonth() === b.getUTCMonth();
      return `${fmtK(from, { day: 'numeric', ...(sameM ? {} : { month: 'short' }) })} – ${fmtK(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    if (d.period === 'month') { const t = fmtK(from, { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
    if (d.period === 'year') return from.slice(0, 4);
    return d.hasData && d.totals.sessions ? `Depuis le ${fmtK(from, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Tout l’historique';
  }
  const gameOf = (id) => S.lib.games.find((g) => g.id === id);

  // ------------------------------------------------------------ Structure
  function build() {
    if (ST.built) return;
    ST.built = true;
    const el = document.createElement('div');
    el.id = 'stats'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Statistiques');
    el.innerHTML = `
      <div class="st-head" data-stblock="row">
        <h2>Statistiques</h2>
        <div class="st-period" role="tablist" aria-label="Période">
          <span class="key-mini" data-glyph="lb" aria-hidden="true"></span>
          ${PERIODS.map(([id, l]) => `<button class="st-tab" role="tab" data-stitem data-period="${id}" aria-selected="false">${l}</button>`).join('')}
          <span class="key-mini" data-glyph="rb" aria-hidden="true"></span>
        </div>
        <div class="st-range">
          <button class="st-icon-btn" data-stitem data-step="-1" aria-label="Période précédente">${SV('<path d="m15 18-6-6 6-6"/>')}</button>
          <span class="st-range-label" id="stRange" aria-live="polite"></span>
          <button class="st-icon-btn" data-stitem data-step="1" aria-label="Période suivante">${SV('<path d="m9 18 6-6-6-6"/>')}</button>
          <button class="st-icon-btn st-close" data-stitem data-action="close" aria-label="Fermer" data-tip="Fermer">${SV('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
        </div>
      </div>
      <div class="st-scroll"><div class="st-body" id="stBody"></div></div>
      <div class="st-tip" id="stTip" role="presentation"></div>`;
    document.body.append(el);
    OVERLAYS.stats = '#stats';
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-period]');
      if (t) { ST.period = t.dataset.period; ST.offset = 0; refresh(); sfx('move'); return; }
      const st = e.target.closest('[data-step]');
      if (st) { step(+st.dataset.step); }
    });
    el.addEventListener('focusin', (e) => { const it = e.target.closest?.('[data-stitem]'); if (it) { rove(it); tipShow(it); } });
    el.addEventListener('focusout', tipHide);
    el.addEventListener('mouseover', (e) => { const it = e.target.closest?.('[data-tip]'); if (it) tipShow(it); });
    el.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) tipHide(); });
    $('.st-scroll', el).addEventListener('scroll', tipHide, { passive: true });

  }

  // ------------------------------------------------------------ Données
  async function refresh() {
    const my = ++ST.req;
    let d;
    try { d = await rr.x('x:stats:get', { period: ST.period, offset: ST.offset }); } catch (e) { console.error('stats', e); return; }
    if (my !== ST.req) return;
    ST.data = d;
    render();
  }
  function step(dir) {
    if (ST.period === 'all') return;
    if (dir > 0 && ST.offset >= 0) return;
    ST.offset += dir; refresh(); sfx('move');
  }
  function cyclePeriod(d) {
    const i = PERIODS.findIndex((p) => p[0] === ST.period);
    ST.period = PERIODS[(i + d + PERIODS.length) % PERIODS.length][0]; ST.offset = 0;
    refresh(); sfx('move');
  }

  // ------------------------------------------------------------ Rendu
  function render() {
    const d = ST.data, root = $('#stats');
    if (!d || !root) return;
    const keep = focusSnapshot();
    $$('.st-tab', root).forEach((t) => t.setAttribute('aria-selected', String(t.dataset.period === ST.period)));
    $('#stRange').textContent = rangeLabel(d);
    $('[data-step="-1"]', root).disabled = d.period === 'all';
    $('[data-step="1"]', root).disabled = d.period === 'all' || ST.offset >= 0;
    const body = $('#stBody');
    if (!d.hasData) {
      body.innerHTML = `<div class="st-card st-empty"><div><p style="font-size:1.3em;margin:0 0 6px;color:var(--fg)">Pas encore de statistiques</p>Lance un jeu : chaque session de plus de 30 secondes sera comptée ici.</div></div>`;
      body.firstElementChild.setAttribute('data-stblock', 'row');
      return;
    }
    const t = d.totals, sk = d.streak, top = d.topGame, plt = d.topPlatform;
    body.innerHTML = `
      <section class="st-kpis" data-stblock="row" aria-label="Chiffres clés">
        ${kpi('Temps de jeu', durBig(t.seconds), d.period === 'all' && t.legacySeconds ? `dont ${dur(t.legacySeconds)} avant le suivi` : rangeLabel(d), `Temps de jeu : ${dur(t.seconds)}`)}
        ${kpi('Sessions', String(t.sessions), t.sessions ? `${dur(t.seconds / Math.max(1, t.sessions))} en moyenne` : 'Aucune session', `${plural(t.sessions, 'session', 'sessions')}`)}
        ${kpi('Jours joués', String(t.days), d.period === 'week' ? 'sur 7 jours' : d.period === 'month' ? `sur ${daysIn(d.range)} jours` : d.period === 'year' ? 'sur l’année' : 'depuis le début', `${plural(t.days, 'jour joué', 'jours joués')}`)}
        ${kpi('Série en cours', `${sk.current}<small>${sk.current > 1 ? 'jours' : 'jour'}</small>`, `Record : ${plural(sk.best, 'jour', 'jours')}${sk.bestEnd ? ` · fin le ${fmtK(sk.bestEnd, { day: 'numeric', month: 'short' })}` : ''}`, `Série en cours : ${plural(sk.current, 'jour', 'jours')}, record ${plural(sk.best, 'jour', 'jours')}`)}
      </section>
      <div class="st-row2" data-stblock="row" aria-label="Jeu et console les plus joués">
        ${heroCard(top)}${consoleCard(plt)}
      </div>
      <section class="st-card st-chart"><h3>${chartTitle(d)}</h3>${chartHtml(d)}</section>
      <div class="st-row2">
        <section class="st-card"><h3>Top 10 des jeux</h3>${topList(d)}</section>
        <section class="st-card"><h3>Par console</h3>${platList(d)}</section>
      </div>
      <section class="st-card"><h3>Carte ${d.heat.year}</h3>${heatHtml(d.heat)}</section>`;
    // blocs de navigation
    $$('.st-kpi, .st-hero, .st-console', body).forEach((x) => x.setAttribute('data-stitem', ''));
    $('.st-chart', body).setAttribute('data-stblock', 'row');
    const lists = $$('.st-list', body); lists.forEach((l) => l.setAttribute('data-stblock', 'list'));
    $('.st-heat', body)?.setAttribute('data-stblock', 'grid');
    $$('[data-stblock]', body).forEach(initBlock);
    initBlock($('.st-head', root));
    restoreFocus(keep);
  }
  const daysIn = (r) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1;
  const kpi = (label, value, sub, aria) => `<div class="st-card st-kpi" tabindex="-1" role="group" aria-label="${esc(aria)}"><span class="st-label">${label}</span><b>${value}</b><span class="st-sub">${esc(sub)}</span></div>`;
  function heroCard(g) {
    if (!g || !g.seconds) return `<div class="st-card st-hero"><div class="st-hero-text"><span class="st-label">Jeu le plus joué</span><strong>—</strong><span class="st-sub">Rien de joué sur cette période</span></div></div>`;
    const lib = gameOf(g.id);
    const banner = lib ? heroOf(lib) : '';
    const cover = lib?.media?.cover ? `<img class="st-cover" src="${mediaUrl(lib, lib.media.cover)}" alt="" />` : '';
    const label = `Jeu le plus joué : ${g.name || 'jeu supprimé'}, ${dur(g.seconds)}`;
    return `<div class="st-card st-hero" tabindex="-1" role="group" aria-label="${esc(label)}" style="${banner ? `--banner:url('${banner}')` : ''}">${cover}
      <div class="st-hero-text"><span class="st-label">Jeu le plus joué</span>
      <strong>${esc(g.name || 'Jeu supprimé')}</strong><span class="st-hero-time">${dur(g.seconds)}</span>
      <span class="st-sub">${plural(g.sessions, 'session', 'sessions')}${lib ? ` · ${esc(plat(lib.platform).name)}` : ''}</span></div></div>`;
  }
  function consoleCard(p) {
    if (!p) return `<div class="st-card st-console"><span class="st-label">Console la plus jouée</span><strong>—</strong></div>`;
    const pl = plat(p.id);
    return `<div class="st-card st-console" tabindex="-1" role="group" aria-label="Console la plus jouée : ${esc(pl.name)}, ${dur(p.seconds)}"><span class="st-label">Console la plus jouée</span>
      <div class="st-plat"><i class="st-dot" style="background:${pl.color}"></i><strong>${esc(pl.name)}</strong></div>
      <span class="st-hero-time">${dur(p.seconds)}</span><span class="st-sub">${Math.round(p.share * 100)} % du temps de jeu</span></div>`;
  }
  const chartTitle = (d) => ({ day: 'Temps de jeu par jour', week: 'Temps de jeu par semaine', month: 'Temps de jeu par mois', year: 'Temps de jeu par année' }[d.buckets.unit]);
  function chartHtml(d) {
    const { unit, items } = d.buckets;
    const W = 960, H = 290, L = 46, R = 6, T = 26, B = 34, pw = W - L - R, ph = H - T - B;
    const maxS = Math.max(...items.map((i) => i.sec), 0);
    if (!maxS) return `<div class="st-empty">Aucun temps de jeu sur cette période</div>`;
    const maxM = maxS / 60, steps = [5, 10, 15, 30, 60, 120, 180, 240, 300, 600, 1200, 1800, 3000, 6000];
    const stp = steps.find((s) => maxM / s <= 4) || 6000, n = Math.ceil(maxM / stp), top = stp * n;
    const y = (m) => T + ph - (m / top) * ph;
    const lab = (m) => (m === 0 ? '0' : stp >= 60 ? `${m / 60} h` : `${m} min`);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${chartTitle(d)}">`;
    for (let i = 0; i <= n; i++) { const m = i * stp; s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text class="axis" x="${L - 8}" y="${y(m) + 4}" text-anchor="end">${lab(m)}</text>`; }
    const slot = pw / items.length, bw = Math.min(slot * 0.62, 64), skip = items.length > 14 ? 2 : 1;
    const peak = items.reduce((b, it, i) => (it.sec > items[b].sec ? i : b), 0);
    items.forEach((it, i) => {
      const cx = L + slot * (i + 0.5), x = cx - bw / 2, h = Math.max(0, (it.sec / 60 / top) * ph), yy = T + ph - h;
      const label = barLabel(unit, it), tip = `${label} · ${dur(it.sec)}`;
      s += `<g data-stitem data-tip="${esc(tip)}" tabindex="-1" role="img" aria-label="${esc(tip)}"><rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ph + B}"/>`;
      s += it.sec > 0 ? `<rect class="fill" x="${x}" y="${yy}" width="${bw}" height="${h}" rx="4"/>` : `<rect class="stub" x="${x}" y="${T + ph - 2}" width="${bw}" height="2" rx="1"/>`;
      s += `<rect class="halo" x="${cx - slot / 2 + 2}" y="${T - 4}" width="${slot - 4}" height="${ph + 6}" rx="6"/></g>`;
      if (i === peak && it.sec > 0) s += `<text class="peak" x="${cx}" y="${Math.max(12, yy - 7)}">${dur(it.sec)}</text>`;
      if (i % skip === 0) s += `<text class="axis" x="${cx}" y="${H - 10}" text-anchor="middle">${axisLabel(unit, it)}</text>`;
    });
    return s + '</svg>';
  }
  function barLabel(unit, it) {
    if (unit === 'day') return fmtK(it.key, { weekday: 'long', day: 'numeric', month: 'long' });
    if (unit === 'week') return it.from === it.to ? fmtK(it.from, { day: 'numeric', month: 'long' }) : `Du ${fmtK(it.from, { day: 'numeric', month: 'short' })} au ${fmtK(it.to, { day: 'numeric', month: 'short' })}`;
    if (unit === 'month') return fmtK(it.from, { month: 'long', year: 'numeric' });
    return it.key;
  }
  function axisLabel(unit, it) {
    if (unit === 'day') return fmtK(it.key, { weekday: 'short', day: 'numeric' }).replace('.', '');
    if (unit === 'week') return fmtK(it.from, { day: 'numeric', month: 'short' }).replace('.', '');
    if (unit === 'month') return fmtK(it.from, { month: 'short' }).replace('.', '');
    return it.key;
  }
  function topList(d) {
    const rows = d.topGames.filter((g) => g.name).slice(0, 10);
    if (!rows.length) return `<div class="st-empty">Rien à classer</div>`;
    const max = rows[0].seconds;
    return `<div class="st-list">${rows.map((g, i) => {
      const lib = gameOf(g.id), tip = `${g.name} · ${dur(g.seconds)} · ${plural(g.sessions, 'session', 'sessions')}`;
      return `<button class="st-item" data-stitem tabindex="-1" data-tip="${esc(tip)}" aria-label="${esc(`${i + 1}. ${tip}`)}"><span class="rk">${i + 1}</span>${lib?.media?.cover ? `<img src="${mediaUrl(lib, lib.media.cover)}" alt="" loading="lazy" />` : '<span class="noimg"></span>'}<span class="nm"><span>${esc(g.name)}</span><span class="st-track"><i style="--w:${Math.max(2, (g.seconds / max) * 100).toFixed(1)}%"></i></span></span><span class="tm">${dur(g.seconds)}</span></button>`;
    }).join('')}</div>`;
  }
  function platList(d) {
    if (!d.platforms.length) return `<div class="st-empty">Rien à répartir</div>`;
    return `<div class="st-list">${d.platforms.map((p) => {
      const pl = plat(p.id), pc = Math.round(p.share * 100), tip = `${pl.name} · ${dur(p.seconds)} · ${pc} %`;
      return `<button class="st-item plat" data-stitem tabindex="-1" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span class="nm"><span><i class="st-dot" style="background:${pl.color};display:inline-block;margin-right:8px"></i>${esc(pl.name)}</span><span class="st-track"><i style="--w:${Math.max(2, p.share * 100).toFixed(1)}%"></i></span></span><span class="tm">${pc} % · ${dur(p.seconds)}</span></button>`;
    }).join('')}</div>`;
  }
  function heatHtml(h) {
    const cols = h.weeks.length;
    let s = `<div class="st-heat" style="--cols:${cols}" role="group" aria-label="Carte des jours joués ${h.year}">`;
    let lastM = -1;
    h.weeks.forEach((w, c) => {
      const first = w.find(Boolean);
      const m = first ? +first.key.slice(5, 7) : lastM;
      if (m !== lastM && first) { s += `<span class="mo" style="grid-column:${c + 2} / span 3;grid-row:1">${fmtK(first.key, { month: 'short' }).replace('.', '')}</span>`; lastM = m; }
    });
    ['Lun', '', 'Mer', '', 'Ven', '', ''].forEach((l, r) => { if (l) s += `<span class="wd" style="grid-column:1;grid-row:${r + 2}">${l}</span>`; });
    h.weeks.forEach((w, c) => w.forEach((cell, r) => {
      if (!cell) return;
      const pos = `grid-column:${c + 2};grid-row:${r + 2}`;
      if (cell.future) { s += `<div class="st-cell future" style="${pos}" aria-hidden="true"></div>`; return; }
      const tip = `${fmtK(cell.key, { weekday: 'long', day: 'numeric', month: 'long' })} · ${cell.sec ? dur(cell.sec) : 'pas joué'}`;
      s += `<button class="st-cell" data-stitem tabindex="-1" data-c="${c}" data-r="${r}" data-l="${cell.level}" data-key="${cell.key}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" style="${pos}"></button>`;
    }));
    s += '</div><div class="st-legend" aria-hidden="true">Moins ';
    for (let l = 0; l <= 4; l++) s += `<i class="st-cell" data-l="${l}"></i>`;
    return s + ' Plus</div>';
  }

  // ------------------------------------------------------------ Focus : un seul arrêt (data-nav) par section, déplacé avec le focus
  function initBlock(blk) {
    const items = $$('[data-stitem]', blk);
    items.forEach((x) => { x.removeAttribute('data-nav'); if (!x.hasAttribute('tabindex')) x.tabIndex = -1; });
    let first = items.find((x) => x.getAttribute('aria-selected') === 'true')
      || (blk.dataset.stblock === 'grid' ? [...items].reverse().find((x) => x.dataset.key <= ST.data.today) : null) || items.find((x) => !x.disabled);
    first?.setAttribute('data-nav', '');
  }
  function rove(el) {
    const blk = el.closest('[data-stblock]');
    if (!blk) return;
    $$('[data-nav]', blk).forEach((x) => x.removeAttribute('data-nav'));
    el.setAttribute('data-nav', '');
  }
  function focusSnapshot() {
    const a = document.activeElement, root = $('#stats');
    if (!a || !root?.contains(a) || !a.closest('#stBody')) return null;
    const blk = a.closest('[data-stblock]');
    return { b: $$('[data-stblock]', $('#stBody')).indexOf(blk), i: $$('[data-stitem]', blk).indexOf(a) };
  }
  function restoreFocus(s) {
    if (!s || s.b < 0) return;
    const blk = $$('[data-stblock]', $('#stBody'))[s.b];
    const it = blk && $$('[data-stitem]', blk)[s.i];
    if (it) { rove(it); it.focus({ preventScroll: true }); }
  }
  function focusItem(el) { rove(el); setFocus(el); sfx('move'); }
  function enter(blk, dir, cur) {
    const items = $$('[data-stitem]', blk).filter((x) => !x.disabled);
    const r0 = cur?.getBoundingClientRect();
    const cx = r0 ? r0.left + r0.width / 2 : 0, cy = r0 ? r0.top + r0.height / 2 : 0;
    const near = (list, f) => list.reduce((b, x) => (f(x) < f(b) ? x : b), list[0]);
    const mid = (x) => { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const kind = blk.dataset.stblock;
    if (kind === 'list') return dir === 'down' ? items[0] : dir === 'up' ? items[items.length - 1] : near(items, (x) => Math.abs(mid(x)[1] - cy));
    if (kind === 'grid') {
      const rs = items.map((x) => +x.dataset.r), want = dir === 'up' ? Math.max(...rs) : dir === 'down' ? Math.min(...rs) : null;
      const pool = want === null ? items : items.filter((x) => +x.dataset.r === want);
      return near(pool, (x) => Math.abs(mid(x)[0] - cx) + (want === null ? Math.abs(mid(x)[1] - cy) * 3 : 0));
    }
    return dir === 'left' || dir === 'right' ? near(items, (x) => Math.abs(mid(x)[1] - cy) * 3 + Math.abs(mid(x)[0] - cx)) : near(items, (x) => Math.abs(mid(x)[0] - cx));
  }
  // Navigation entre sections sans retour à la ligne : (comme spatial(), sans le « wrap »)
  function geo(dir) {
    const list = navables(), cur = list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) return list[0] && setFocus(list[0]);
    const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bd = Infinity;
    for (const el of list) {
      if (el === cur || el.closest('[data-stblock]') === cur.closest('[data-stblock]')) continue;
      const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const ok = { left: dx < -4 && Math.abs(dy) < r0.height * 1.2 + 20, right: dx > 4 && Math.abs(dy) < r0.height * 1.2 + 20, up: dy < -4, down: dy > 4 }[dir];
      if (!ok) continue;
      const d = dir === 'left' || dir === 'right' ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
      if (d < bd) { bd = d; best = el; }
    }
    if (best) focusItem(enter(best.closest('[data-stblock]') || best.parentElement, dir, cur) || best);
  }
  function statsNav(dir) {
    const cur = document.activeElement, blk = cur?.closest?.('[data-stblock]');
    if (blk && $('#stats').contains(cur)) {
      const kind = blk.dataset.stblock, items = $$('[data-stitem]', blk).filter((x) => !x.disabled), i = items.indexOf(cur);
      if (kind === 'row' && (dir === 'left' || dir === 'right')) { const n = items[i + (dir === 'left' ? -1 : 1)]; if (n) focusItem(n); return; }
      if (kind === 'list' && (dir === 'up' || dir === 'down')) { const n = items[i + (dir === 'up' ? -1 : 1)]; if (n) { focusItem(n); return; } }
      if (kind === 'grid') {
        const c = +cur.dataset.c, r = +cur.dataset.r, dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        let t = null;
        if (dc) for (let k = c + dc; k >= 0 && k < 60 && !t; k += dc) t = blk.querySelector(`[data-c="${k}"][data-r="${r}"]`);
        else for (let k = r + dr; k >= 0 && k < 7 && !t; k += dr) t = blk.querySelector(`[data-c="${c}"][data-r="${k}"]`);
        if (t) { focusItem(t); return; }
        if (dc) return;
      }
    }
    geo(dir);
  }
  const _spatial = spatial;
  spatial = function (dir) { if (S.mode === 'stats') return statsNav(dir); return _spatial(dir); }; // STATS : navigation par sections
  const _renderHints = renderHints;
  renderHints = function () { // STATS : aide « Période » (LB RB) dans la barre du bas
    _renderHints();
    if (S.mode !== 'stats') return;
    const keys = S.device === 'pad' ? ['lb', 'rb'].map(glyph).join('') : '<span class="glyph kb pill">Q</span><span class="glyph kb pill">E</span>';
    const b = document.createElement('button');
    b.className = 'hint'; b.tabIndex = -1; b.innerHTML = `${keys}<span class="hint-label">Période</span>`;
    b.addEventListener('click', () => cyclePeriod(1));
    const list = $('#hintList');
    list.children[0] ? list.children[0].after(b) : list.append(b);
  };

  // ------------------------------------------------------------ Infobulle
  function tipShow(el) {
    const txt = el.getAttribute('data-tip'), tip = $('#stTip');
    if (!txt || !tip) return;
    tip.textContent = txt; tip.classList.add('on');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 4) y = r.bottom + 8;
    tip.style.left = `${Math.max(6, Math.min(innerWidth - tw - 6, x))}px`;
    tip.style.top = `${y}px`;
  }
  function tipHide() { $('#stTip')?.classList.remove('on'); }

  // ------------------------------------------------------------ Ouverture / entrées
  RR.actions.stats = async () => {
    if (S.mode === 'stats') return;
    build();
    closeAll();
    ST.period = 'all'; ST.offset = 0;
    await refresh();
    openOverlay('stats');
  };
  RR.on('input', (src, k) => {
    if (S.mode !== 'stats') return;
    if (src === 'pad' && (k === 'lb' || k === 'rb')) cyclePeriod(k === 'lb' ? -1 : 1);
  });
  addEventListener('keydown', (e) => {
    if (S.mode !== 'stats' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'q' || e.key === 'Q' || e.key === 'PageUp') { e.preventDefault(); cyclePeriod(-1); }
    else if (e.key === 'e' || e.key === 'E' || e.key === 'PageDown') { e.preventDefault(); cyclePeriod(1); }
  });
  rr.onX('x:stats:changed', () => { if (S.mode === 'stats') refresh(); refreshGame(); });

  // Entrées : menu + barre du haut
  function mountEntries() {
    const panel = $('#menu .panel'), before = panel?.querySelector('[data-action="settings"]');
    if (panel && !panel.querySelector('[data-action="stats"]')) {
      const b = document.createElement('button');
      b.className = 'menu-item'; b.dataset.action = 'stats'; b.dataset.nav = '';
      b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON_BARS}</svg><span class="mi-label">Statistiques</span>`;
      before ? before.before(b) : panel.append(b);
    }
    const bar = $('#sysbar'), menuBtn = bar?.querySelector('[data-action="menu"]');
    if (bar && !bar.querySelector('[data-action="stats"]')) {
      const b = document.createElement('button');
      b.className = 'sys-btn'; b.dataset.action = 'stats'; b.dataset.tip = 'Statistiques'; b.setAttribute('aria-label', 'Statistiques');
      b.innerHTML = SV(ICON_BARS);
      menuBtn ? menuBtn.before(b) : bar.append(b);
    }
  }

  // ------------------------------------------------------------ Page du jeu : « Ton activité »
  let actReq = 0;
  function currentGame() { return S.items?.[S.sel] || S.lib.games.find((x) => x.id === S.selId) || null; }
  async function refreshGame() {
    const host = $('#details');
    if (!host || host.hidden) return;
    const anchor = $('#dStats');
    if (!anchor) return;
    let box = $('#stAct');
    if (!box) { box = document.createElement('div'); box.id = 'stAct'; box.className = 'st-act'; box.hidden = true; anchor.after(box); }
    const g = currentGame(), my = ++actReq;
    if (!g) { box.hidden = true; return; }
    let a;
    try { a = await rr.x('x:stats:game', g.id); } catch { return; }
    if (my !== actReq) return;
    if (!a || (!a.sessions && !a.legacySeconds)) { box.hidden = true; return; }
    const max = Math.max(...a.weeks.map((w) => w.sec), 1), W = 150, H = 44, bw = 14, gap = (W - bw * 8) / 7;
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc('Temps de jeu par semaine, 8 dernières semaines : ' + a.weeks.map((w) => dur(w.sec)).join(', '))}">${a.weeks.map((w, i) => {
      const h = w.sec ? Math.max(3, (w.sec / max) * (H - 2)) : 2;
      return `<rect class="${w.sec ? '' : 'z'}" x="${i * (bw + gap)}" y="${H - h}" width="${bw}" height="${h}" rx="2"><title>${esc(`Semaine du ${fmtK(w.from, { day: 'numeric', month: 'short' })} : ${dur(w.sec)}`)}</title></rect>`;
    }).join('')}</svg>`;
    const when = (ts) => new Date(ts).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });
    box.innerHTML = `<div><div class="st-act-title">Ton activité · 8 semaines</div>${svg}</div>
      <div class="st-act-txt">${a.first ? `<div><b>${when(a.first)}</b>Première session</div><div><b>${when(a.last)}</b>Dernière session</div>` : '<div><b>Avant le suivi</b>Pas de date précise</div>'}</div>`;
    box.hidden = false;
  }
  function watchDetails() {
    const host = $('#details');
    if (!host) return;
    new MutationObserver(() => refreshGame()).observe(host, { attributes: true, attributeFilter: ['hidden'] });
    const ds = $('#dStats');
    if (ds) new MutationObserver(() => refreshGame()).observe(ds, { childList: true }); // renderDetails() reconstruit #dStats à chaque affichage
  }
  RR.on('selection', () => refreshGame());

  // ------------------------------------------------------------ Réglages (#set-stats)
  function mountSettings() {
    const host = $('#set-stats');
    if (!host) return;
    host.innerHTML = `<h3 class="set-group">Statistiques</h3>
      <div class="setting"><div><strong>Exporter (CSV)</strong><span class="dim">Toutes les sessions avec dates et heures (Paris), lisible dans Excel.</span></div><button class="btn small" id="stExport" data-nav>Exporter…</button></div>
      <div class="setting"><div><strong>Effacer l’historique</strong><span class="dim">Supprime le journal des sessions. Le temps total affiché sur les fiches des jeux reste.</span></div><button class="btn small danger" id="stClear" data-nav>Effacer…</button></div>`;
    $('#stExport').addEventListener('click', async () => {
      try {
        const r = await rr.x('x:stats:export');
        if (r?.ok) toast(`Export terminé (${plural(r.rows, 'ligne', 'lignes')})`, 'success');
        else if (!r?.canceled) toast('Export impossible', 'error');
      } catch { toast('Export impossible', 'error'); }
    });
    $('#stClear').addEventListener('click', () => openPrompt({
      title: 'Effacer l’historique ?', icon: 'danger', tone: 'danger',
      body: '<p class="dim">Toutes les statistiques (sessions, séries, cartes) seront supprimées. Cette action est définitive.</p>',
      actions: [
        { label: 'Annuler', focus: true, onClick: () => closeOverlay() },
        { label: 'Effacer', danger: true, primary: true, onClick: async () => { await rr.x('x:stats:clear'); closeOverlay(); toast('Historique effacé', 'success'); } },
      ],
    }));
  }

  mountEntries();
  mountSettings();
  watchDetails();
})();

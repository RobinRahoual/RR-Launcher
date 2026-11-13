// Module FIXES (renderer) — bannières de l'accueil (ES-DE) nettes pour toutes les consoles.
// Avant : bannière = image d'un jeu tirée au hasard ; pour les ROMs ce sont souvent des captures 240×160 ou des
// jaquettes → floutées en plein écran. Maintenant (fixesHomeArt, appelée par homeArt() dans app.js) :
//   fond   : image de jeu ≥ 1000 px de large → sinon PHOTO de la console (nette, à sa taille, sur sa couleur)
//            → sinon mosaïque inclinée des jaquettes de la console ;
//   tuile  : image de jeu ≥ 600 px → photo de console (opaque ≥ 600 px) → jaquette → photo détourée.
// Le panneau en biais reçoit la même composition (désaturée par .h-pbg). Dimensions : x:fixes:sizes (en-têtes).
(() => {
  const BG_MIN = 1000, TILE_MIN = 600;
  const F = { sizes: null, plats: {}, asked: new Set(), loading: false };
  const urlOf = (g, f) => mediaUrl(g, f);
  const w = (g, f) => F.sizes?.[g.id]?.[f]?.w || 0;

  function gamesOf(id) { return id === 'all' ? S.lib.games : S.lib.games.filter((g) => g.platform === id); }
  function platPhoto(id) {
    const p = F.plats[id];
    return p ? { url: platUrl(p.file), w: p.w, h: p.h, alpha: !!p.alpha } : null;
  }
  // Pour le fond : grandes images (hero, header, captures) ; jamais la jaquette (portrait)
  function bigImages(games, min) {
    const out = [];
    for (const g of games) {
      const m = g.media || {};
      for (const f of [m.hero, m.header, ...(g.screenshots || [])]) if (f && w(g, f) >= min) out.push([g.id, urlOf(g, f)]);
    }
    return out;
  }
  const coversOf = (games) => games.filter((g) => g.media?.cover).map((g) => urlOf(g, g.media.cover));

  window.fixesHomeArt = function fixesHomeArt(id) {
    if (!F.sizes) return { bg: '', gid: null, tile: '', tid: null, key: '#wait', decorate: (el) => el.classList.add('is-brand') };
    S.home.art ||= {};
    const games = gamesOf(id);
    const bigs = bigImages(games, BG_MIN);
    const photo = id === 'all' ? null : platPhoto(id);
    const covers = coversOf(games);
    const sig = [bigs.length, photo?.url || '', covers.length, games.length].join('|');
    const old = S.home.art[id];
    if (old && old.sig === sig) return old;
    const a = { sig, bg: '', gid: null, tile: '', tid: null, tileCls: '', key: '', decorate: null, kind: '' };
    const color = id === 'all' ? '' : (plat(id).color || '');
    if (bigs.length) {
      const [gid, u] = pick(bigs);
      Object.assign(a, { kind: 'game', bg: u, gid, key: u });
    } else if (photo && !photo.alpha && photo.w >= BG_MIN) {
      Object.assign(a, { kind: 'game', bg: photo.url, key: photo.url }); // photo opaque grande : bannière classique
    } else if (photo) {
      Object.assign(a, { kind: 'plat', bg: photo.url, key: 'plat:' + photo.url, decorate: (el) => decoratePlat(el, photo, color) });
    } else if (covers.length) {
      const list = covers.slice(0, 12);
      Object.assign(a, { kind: 'mosaic', key: 'mosaic:' + id + ':' + list.length, decorate: (el) => decorateMosaic(el, list, color) });
    }
    // Tuile : différente du fond si possible
    const tiles = bigImages(games, TILE_MIN).filter(([, u]) => u !== a.bg);
    if (tiles.length) { const [tid, u] = pick(tiles); Object.assign(a, { tile: u, tid }); }
    else if (a.kind === 'game' && a.bg) Object.assign(a, { tile: a.bg, tid: a.gid });
    else if (photo && !photo.alpha && photo.w >= TILE_MIN) a.tile = photo.url;
    else if (covers.length) { const c = pick(games.filter((g) => g.media?.cover)); Object.assign(a, { tile: urlOf(c, c.media.cover), tid: c.id, tileCls: 'fx-cover' }); }
    else if (photo) Object.assign(a, { tile: photo.url, tileCls: 'fx-contain' });
    S.home.art[id] = a;
    return a;
  };

  // Photo de console : à sa taille (au plus ×1,5 pour rester nette), à droite du panneau, sur la couleur de la console
  function decoratePlat(el, photo, color) {
    el.classList.add('fx-plat', photo.alpha ? 'fx-cut' : 'fx-photo');
    el.style.backgroundImage = '';
    if (color) el.style.setProperty('--fx-pc', color);
    const img = document.createElement('img');
    img.className = 'fx-plat-img';
    img.alt = ''; img.decoding = 'async'; img.src = photo.url;
    img.style.setProperty('--fx-w', `${Math.round(photo.w * 1.5)}px`);
    img.style.setProperty('--fx-h', `${Math.round(photo.h * 1.5)}px`);
    el.append(img);
  }
  // Mosaïque inclinée des jaquettes (comme la tuile « Tous les jeux », en grand)
  function decorateMosaic(el, covers, color) {
    el.classList.add('fx-mosaic');
    el.style.backgroundImage = '';
    if (color) el.style.setProperty('--fx-pc', color);
    const grid = document.createElement('div');
    grid.className = 'fx-mos-grid';
    const n = 36;
    let html = '';
    for (let i = 0; i < n; i++) html += `<img src="${covers[(i * 7 + Math.floor(i / 9)) % covers.length]}" alt="" decoding="async" />`;
    grid.innerHTML = html;
    el.append(grid);
  }

  // ---- Chargement des dimensions + photos de consoles (téléchargées par le main si absentes)
  async function loadSizes() {
    if (F.loading) return;
    F.loading = true;
    try {
      const r = await rr.x('x:fixes:sizes').catch(() => null);
      if (!r) return;
      const before = JSON.stringify([F.sizes, F.plats]);
      F.sizes = r.games || {}; F.plats = r.plats || {};
      if (JSON.stringify([F.sizes, F.plats]) !== before) refresh();
      // Photos manquantes : platform:image les télécharge (Wikipédia) puis on relit les dimensions
      const missing = [...new Set(S.lib.games.map((g) => g.platform))].filter((p) => p !== 'pc' && !F.plats[p] && !F.asked.has(p));
      if (missing.length) {
        missing.forEach((p) => F.asked.add(p));
        const got = await Promise.all(missing.map((p) => rr.platformImage(p).catch(() => null)));
        if (got.some(Boolean)) { F.loading = false; return loadSizes(); }
      }
    } finally { F.loading = false; }
  }
  function refresh() {
    try {
      homeArtCur = null; // force setHomeArt à reconstruire le fond
      if (typeof syncCards === 'function') syncCards();
      if (S.view === 'home' && typeof updateHomeChrome === 'function') updateHomeChrome();
    } catch (e) { console.warn('fixes : accueil', e); }
  }
  let t = 0;
  RR.on('library', () => { clearTimeout(t); t = setTimeout(loadSizes, 300); });
  if (S.lib?.games?.length) loadSizes();
  window.fixesState = () => ({ sizes: !!F.sizes, plats: Object.keys(F.plats), art: Object.fromEntries(Object.entries(S.home.art || {}).map(([k, v]) => [k, { kind: v.kind, bg: v.bg, tile: v.tile, tileCls: v.tileCls }])) });
})();

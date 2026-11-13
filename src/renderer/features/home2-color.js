// HOME2 — calculs de couleur purs (accent qui suit le jeu). Chargé avant home2.js ; testé dans test/home2.test.js.
// accentFor(couleur, thème) : renvoie une couleur #rrggbb dont la luminosité est ajustée pour garder ≥ 3:1
// avec le fond du thème ET avec le texte blanc des boutons ; sinon (couleur absente, grise, impossible) → bleu de la charte.
(function (root) {
  'use strict';
  const BLUE = '#3C91E6';
  const BG = { dark: [16, 16, 16], light: [255, 255, 255] };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function parse(c) {
    if (Array.isArray(c)) return c.slice(0, 3);
    const m = String(c || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl([h, s, l]) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // plage de luminance admise : blanc sur accent ≥ 3:1 (L ≤ 0,30) et accent sur fond ≥ 3:1 (sombre : L ≥ 0,115 ; clair : pas trop noir)
  const RANGE = { dark: [0.14, 0.27], light: [0.07, 0.27] };
  function ok(rgb, theme) {
    return contrast(rgb, [255, 255, 255]) >= 3 && contrast(rgb, BG[theme]) >= 3;
  }
  function accentFor(color, theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    const rgb = parse(color);
    if (!rgb) return BLUE;
    const [h, s, l] = toHsl(rgb);
    if (s < 0.2) return BLUE; // jaquette presque grise : le bleu de la charte vaut mieux qu'un accent terne
    const [lo, hi] = RANGE[theme];
    const L0 = lum(rgb);
    if (L0 >= lo && L0 <= hi && ok(rgb, theme)) return hex(rgb);
    const target = Math.min(hi, Math.max(lo, L0));
    let a = 0, b = 1, best = rgb;
    const sat = Math.max(s, 0.45);
    for (let i = 0; i < 24; i++) {
      const mid = (a + b) / 2;
      const cand = fromHsl([h, sat, mid]);
      best = cand;
      if (lum(cand) < target) a = mid; else b = mid;
    }
    const out = best.map(Math.round);
    return ok(out, theme) ? hex(out) : BLUE;
  }
  const api = { accentFor, contrast, parse, lum, BLUE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.H2C = api;
})(typeof window !== 'undefined' ? window : globalThis);

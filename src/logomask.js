// RR Launcher — logos de consoles affichés en monochrome via un masque CSS (seule l'opacité compte).
// Un logo posé sur une « plaque » de couleur pleine (Switch : carré rouge avec l'icône et le texte en blanc)
// donnerait un simple rectangle blanc : on retire la plaque pour ne garder que ce qui contraste avec elle.
// Logique pure sur un bitmap BGRA (testable sans Electron).
'use strict';

const dist = (b, i, c) => Math.hypot(b[i] - c[0], b[i + 1] - c[1], b[i + 2] - c[2]);

/*
 * keyPlate(bmp, width, height) → true si une plaque a été retirée (bmp modifié en place).
 * Plaque = les pixels opaques remplissent presque toute leur boîte englobante (≥ 80 %, un texte seul en
 * remplit bien moins) ET une même couleur domine le pourtour de cette boîte ET il reste un motif contrasté
 * (au moins 2 % de la surface) une fois cette couleur retirée.
 */
function keyPlate(bmp, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1, opaque = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (bmp[(y * width + x) * 4 + 3] < 128) continue;
    opaque++;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return false;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (opaque / (bw * bh) < 0.8) return false;
  // Couleur du pourtour (anneau à ~4 % du bord de la boîte, pour éviter l'anticrénelage des coins arrondis)
  const inset = Math.max(1, Math.round(Math.min(bw, bh) * 0.04));
  const buckets = new Map();
  let ring = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    if (bmp[i + 3] < 200) return;
    ring++;
    const k = `${bmp[i] >> 4}-${bmp[i + 1] >> 4}-${bmp[i + 2] >> 4}`;
    const e = buckets.get(k) || { n: 0, c: [0, 0, 0] };
    e.n++; e.c[0] += bmp[i]; e.c[1] += bmp[i + 1]; e.c[2] += bmp[i + 2];
    buckets.set(k, e);
  };
  for (let x = x0 + inset; x <= x1 - inset; x++) { sample(x, y0 + inset); sample(x, y1 - inset); }
  for (let y = y0 + inset; y <= y1 - inset; y++) { sample(x0 + inset, y); sample(x1 - inset, y); }
  let top = null;
  for (const e of buckets.values()) if (!top || e.n > top.n) top = e;
  if (!top || top.n < ring * 0.6) return false;
  const plate = top.c.map((v) => v / top.n);
  // Motif restant (contraste net avec la plaque)
  let keep = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (bmp[i + 3] >= 128 && dist(bmp, i, plate) > 90) keep++;
  }
  if (keep < opaque * 0.02 || keep > opaque * 0.9) return false;
  // Retrait doux : transparent près de la couleur de la plaque, opaque au-delà
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (!bmp[i + 3]) continue;
    const a = Math.max(0, Math.min(1, (dist(bmp, i, plate) - 45) / 70));
    bmp[i + 3] = Math.round(bmp[i + 3] * a);
  }
  return true;
}

module.exports = { keyPlate };

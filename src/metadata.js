// Récupération automatique des métadonnées et visuels d'un jeu.
// Sources (dans l'ordre) : Steam (sans clé) → SteamGridDB (clé optionnelle) → Wikipédia (description).
const fs = require('fs');
const path = require('path');
const { net, nativeImage, app } = require('electron');
const names = require('./names');
const { keyPlate } = require('./logomask');

let logFile = null;
function setLogFile(f) { logFile = f; }
function log(msg) {
  try { if (logFile) fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RRLauncher/1.0';
const STEAM_ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const STEAM_LEGACY_BASES = [
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/',
  'https://steamcdn-a.akamaihd.net/steam/apps/',
];

// ---------- HTTP ----------
async function getJson(url, headers = {}, timeout = 12000) {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

const EXT_BY_TYPE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// Télécharge la première URL valide de la liste. Retourne le nom de fichier ou null.
async function downloadFirst(urls, dir, baseName) {
  for (const url of urls.filter(Boolean)) {
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { log(`image ${res.status} ${url}`); continue; }
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!type.startsWith('image/')) { log(`image type ${type} ${url}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1500) continue; // images vides / placeholders
      const ext = EXT_BY_TYPE[type] || path.extname(new URL(url).pathname) || '.jpg';
      const file = baseName + ext;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), buf);
      return file;
    } catch (e) { log(`image erreur ${e.message} ${url}`); }
  }
  return null;
}

// Image de fond : on veut de la HD. Essaie les sources dans l'ordre et garde la première assez large
// (≥ minWidth px), sinon la plus large trouvée — une capture rétro 240×160 n'est qu'un dernier recours.
async function downloadBest(urls, dir, baseName, { minWidth = 1600, maxTries = 8 } = {}) {
  let best = null;
  let tries = 0;
  for (const url of [...new Set(urls.filter(Boolean))]) {
    if (tries++ >= maxTries) break;
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { log(`image ${res.status} ${url}`); continue; }
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1500) continue;
      const img = nativeImage.createFromBuffer(buf);
      const width = img.isEmpty() ? 0 : img.getSize().width;
      if (!best || width > best.width) best = { buf, type, url, width };
      if (width >= minWidth) break;
    } catch (e) { log(`image erreur ${e.message} ${url}`); }
  }
  if (!best) return null;
  const ext = EXT_BY_TYPE[best.type] || path.extname(new URL(best.url).pathname) || '.jpg';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, baseName + ext), best.buf);
  log(`${baseName} : ${best.width}px ← ${best.url}`);
  return baseName + ext;
}

// ---------- Utilitaires texte ----------
function decodeEntities(s = '') {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function htmlToText(html = '') {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();
}
function normalize(s = '') {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// ---------- Steam ----------
async function steamSearch(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`;
  const json = await getJson(url);
  return (json.items || [])
    .filter((i) => !i.type || i.type === 'app')
    .map((i) => ({ source: 'steam', appid: i.id, name: i.name, thumb: i.tiny_image }));
}

// HOME2 : catégories Steam (ids 24 / 37 / 39 = écran partagé, coop / JcJ en écran partagé) → g.categories, g.localMulti, g.players
function coopInfo(steam) {
  const cats = steam.categories || [];
  const local = cats.some((c) => [24, 37, 39].includes(c.id) || /shared\/split|split.?screen|local (co-?op|multi)|écran (partagé|divisé)/i.test(c.description || ''));
  return { categories: cats.map((c) => c.description).filter(Boolean).slice(0, 12), localMulti: local, players: local ? 2 : 1 };
}

async function steamDetails(appid) {
  // Certaines fiches échouent avec un pays/langue donné : on réessaie sans.
  const variants = [`l=french&cc=FR`, `l=french`, `l=english&cc=US`];
  for (const q of variants) {
    try {
      const json = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&${q}`);
      const entry = json[appid] || json[String(appid)];
      if (entry && entry.success && entry.data) return entry.data;
      log(`appdetails ${appid} (${q}) : success=false`);
    } catch (e) { log(`appdetails ${appid} (${q}) : ${e.message}`); }
  }
  return null;
}

// Assets officiels (noms de fichiers hachés récents) via IStoreBrowseService.
async function steamAssets(appid) {
  const input = {
    ids: [{ appid: Number(appid) }],
    context: { language: 'french', country_code: 'FR' },
    data_request: { include_assets: true },
  };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  try {
    const json = await getJson(url);
    const item = json?.response?.store_items?.[0];
    const a = item?.assets;
    if (!a) return {};
    const fmt = a.asset_url_format || `steam/apps/${appid}/\${FILENAME}`;
    const u = (f) => (f ? STEAM_ASSET_BASE + fmt.replace('${FILENAME}', f).replace('{FILENAME}', f) : null);
    return {
      cover: [u(a.library_capsule_2x), u(a.library_capsule)],
      hero: [u(a.library_hero_2x), u(a.library_hero), u(a.page_background)],
      logo: [u(a.library_logo_2x), u(a.library_logo)],
      header: [u(a.header_2x), u(a.header), u(a.main_capsule)],
    };
  } catch (e) {
    log(`assets ${appid} : ${e.message}`);
    return {};
  }
}

function steamLegacy(appid, files) {
  return STEAM_LEGACY_BASES.flatMap((b) => files.map((f) => `${b}${appid}/${f}`));
}

// ---------- SteamGridDB ----------
const SGDB = 'https://www.steamgriddb.com/api/v2';
async function sgdb(pathname, key) {
  const json = await getJson(SGDB + pathname, { Authorization: `Bearer ${key}` });
  if (!json.success) throw new Error('SGDB error');
  return json.data;
}
async function sgdbSearch(term, key) {
  const data = await sgdb(`/search/autocomplete/${encodeURIComponent(term)}`, key);
  return (data || []).map((g) => ({
    source: 'sgdb',
    sgdbId: g.id,
    name: g.name,
    year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null,
  }));
}
async function sgdbImages(gameId, key) {
  const pick = async (p) => {
    try { return ((await sgdb(p, key)) || []).slice(0, 3).map((x) => x.url); } catch { return []; }
  };
  const [cover, hero, logo] = await Promise.all([
    pick(`/grids/game/${gameId}?dimensions=600x900,342x482,660x930&types=static&nsfw=false`),
    pick(`/heroes/game/${gameId}?types=static&nsfw=false`),
    pick(`/logos/game/${gameId}?types=static&nsfw=false`),
  ]);
  return { cover, hero, logo };
}

// ---------- TheGamesDB (scans de jaquettes avant / arrière, clé gratuite) ----------
// Recherche par nom avec plusieurs écritures (nom affiché, titre anglais, nom du fichier), d'abord sur la console
// puis sans filtre ; on garde le jeu dont le titre est le plus proche (jamais un résultat sans rapport).
// Les jaquettes viennent de « include=boxart » (même requête) et de Games/Images (fanart, captures, dos manquants).
const TGDB = 'https://api.thegamesdb.net';
const tgdbIdCache = new Map(); // `${plateforme}|${nom}` → { id, title }
async function tgdbFind(cands, platformId, key) {
  const k = `${platformId || ''}|${cands.join('|')}`;
  if (tgdbIdCache.has(k)) return tgdbIdCache.get(k);
  let found = null;
  for (const pf of platformId ? [platformId, null] : [null]) {
    for (const name of cands) {
      const q = `${TGDB}/v1.1/Games/ByGameName?apikey=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}&include=boxart${pf ? `&filter%5Bplatform%5D=${pf}` : ''}`;
      let res;
      try { res = await getJson(q); } catch (e) { log(`tgdb « ${name} » : ${e.message}`); if (/HTTP 40[13]/.test(e.message)) throw new Error('clé TheGamesDB refusée ou quota mensuel atteint'); continue; }
      if (res?.remaining_monthly_allowance === 0) log('tgdb : quota mensuel atteint');
      const games = res?.data?.games || [];
      const b = names.best(games, cands, (g) => g.game_title);
      log(`tgdb « ${name} »${pf ? ` (plateforme ${pf})` : ''} : ${games.length} résultat(s)${b ? `, meilleur ${b.item.game_title} (${b.score.toFixed(2)})` : ''}`);
      if (b && b.score >= 0.6 && (!found || b.score > found.score)) {
        const inc = res?.include?.boxart;
        found = { id: b.item.id, title: b.item.game_title, score: b.score, boxBase: inc?.base_url?.original, box: inc?.data?.[b.item.id] || inc?.data?.[String(b.item.id)] || [] };
      }
      if (found && found.score >= 0.95) break;
    }
    if (found) break;
  }
  tgdbIdCache.set(k, found);
  return found;
}
async function tgdbBoxart(name, platformId, key, alt = []) {
  const cands = [...new Set([name, ...alt].filter(Boolean))];
  const game = await tgdbFind(cands, platformId, key);
  if (!game) { log(`tgdb « ${name} » : aucun jeu correspondant`); return {}; }
  let list = [], base = game.boxBase || 'https://cdn.thegamesdb.net/images/original/';
  for (const filter of ['&filter%5Btype%5D=boxart,fanart,screenshot', '']) {
    try {
      const img = await getJson(`${TGDB}/v1/Games/Images?apikey=${encodeURIComponent(key)}&games_id=${game.id}${filter}`);
      base = img?.data?.base_url?.original || base;
      const imgs = img?.data?.images;
      list = (imgs && (imgs[game.id] || imgs[String(game.id)])) || (Array.isArray(imgs) ? imgs : []);
      if (list.length) break;
    } catch (e) { log(`tgdb images #${game.id} : ${e.message}`); }
  }
  // Images de « include=boxart » en plus (certaines réponses Images sont vides alors que la recherche les donne)
  const all = [...list, ...game.box.map((b) => ({ ...b, type: b.type || 'boxart' }))];
  const seen = new Set();
  const uniq = all.filter((i) => i?.filename && !seen.has(i.filename) && seen.add(i.filename));
  const url = (side) => uniq.filter((i) => i.type === 'boxart' && (i.side === side || (!i.side && side === 'front' && /front/.test(i.filename)) || (!i.side && side === 'back' && /\/back\//.test(i.filename)))).map((i) => base + i.filename);
  const typ = (t) => uniq.filter((i) => i.type === t).map((i) => base + i.filename);
  log(`tgdb « ${name} » → ${game.title} (#${game.id}) front=${url('front').length} back=${url('back').length}`);
  return { id: game.id, title: game.title, front: url('front'), back: url('back'), fanart: typ('fanart'), screenshots: typ('screenshot') };
}

// ---------- Titre anglais d'un jeu nommé en français (Wikipédia FR → lien interlangue EN) ----------
// « Pokémon Émeraude » → « Pokémon Emerald » : les bases (TheGamesDB, libretro, Wikipédia EN) sont en anglais.
const enCache = new Map();
async function englishTitle(name) {
  if (!name) return null;
  if (enCache.has(name)) return enCache.get(name);
  let out = null;
  try {
    const s = await getJson(`https://fr.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(name)}`);
    const hits = (s?.query?.search || []).map((r) => r.title);
    const b = names.best(hits, [name], (t) => t.replace(/\s*\([^)]*\)$/, ''));
    if (b && b.score >= 0.75) {
      const ll = await getJson(`https://fr.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=en&format=json&redirects=1&titles=${encodeURIComponent(b.item)}`);
      const page = Object.values(ll?.query?.pages || {})[0];
      const en = page?.langlinks?.[0]?.['*'];
      if (en) out = en.replace(/\s*\((video game|jeu vidéo)\)$/i, '');
    }
  } catch (e) { log(`titre anglais « ${name} » : ${e.message}`); }
  if (out && names.compact(out) === names.compact(name)) out = null; // déjà en anglais
  if (out) log(`titre anglais « ${name} » → « ${out} »`);
  enCache.set(name, out);
  return out;
}

// ---------- libretro-thumbnails : index des jaquettes d'une console (noms No-Intro / Redump) ----------
// Les fichiers s'appellent « Pokemon - Emerald Version (USA, Europe).png » : on télécharge la liste une fois
// (API GitHub, mise en cache 14 jours) et on cherche le nom le plus proche au lieu de deviner l'orthographe exacte.
const lrMem = new Map();
async function libretroIndex(repo) {
  if (lrMem.has(repo)) return lrMem.get(repo);
  let file = null;
  try { file = path.join(app.getPath('userData'), 'cache', `libretro-${repo}.json`); } catch {}
  try {
    if (file && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 14 * 864e5) {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      lrMem.set(repo, v); return v;
    }
  } catch {}
  let list = [];
  try {
    const t = await getJson(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`, { Accept: 'application/vnd.github+json' }, 30000);
    list = (t?.tree || []).map((x) => x.path).filter((p) => /^Named_Boxarts\/.+\.png$/i.test(p)).map((p) => p.slice(14, -4));
    if (file && list.length) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); }
  } catch (e) { log(`libretro index ${repo} : ${e.message}`); }
  lrMem.set(repo, list);
  return list;
}
const REGION_RANK = (n) => (/\(France\)/i.test(n) ? 0 : /\(Europe\)|\(USA, Europe\)|\(Europe, /i.test(n) ? 1 : /\(World\)/i.test(n) ? 2 : /\(USA\)/i.test(n) ? 3 : 4);
async function libretroMatch(repo, cands) {
  const list = await libretroIndex(repo);
  if (!list.length) return null;
  let best = null;
  for (const n of list) {
    if (/\((Beta|Proto|Demo|Sample|Kiosk)/i.test(n)) continue;
    const label = n.replace(/ - /g, ' ');
    for (const c of cands) {
      const s = names.similarity(label, c);
      if (!best || s > best.score || (s === best.score && REGION_RANK(n) < REGION_RANK(best.name))) best = { name: n, score: s };
    }
  }
  if (best) log(`libretro ${repo} : ${cands.join(' / ')} → ${best.name} (${best.score.toFixed(2)})`);
  return best && best.score >= 0.75 ? best.name : null;
}

// ---------- Wikipédia (description de secours) ----------
async function wikiSummary(name) {
  for (const lang of ['fr', 'en']) {
    try {
      const s = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(name + ' jeu vidéo')}`
      );
      const title = s?.query?.search?.[0]?.title;
      if (!title) continue;
      const sum = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (sum?.extract) return sum.extract;
    } catch { /* langue suivante */ }
  }
  return '';
}

// ---------- Couleur dominante ----------
function dominantColor(file) {
  try {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 24, height: 36, quality: 'good' });
    const bmp = small.toBitmap(); // BGRA
    let best = null;
    let bestScore = -1;
    const buckets = new Map();
    for (let i = 0; i < bmp.length; i += 4) {
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      const lum = max / 255;
      if (lum < 0.18 || (lum > 0.92 && sat < 0.2)) continue;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, sat: 0 };
      e.r += r; e.g += g; e.b += b; e.n++; e.sat += sat;
      buckets.set(key, e);
    }
    for (const e of buckets.values()) {
      const score = e.n * (0.35 + e.sat / e.n);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return null;
    const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}

// ---------- Image de console (Wikipédia / Wikimedia Commons) ----------
function removeWhiteBackground(file, outFile) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return false;
  let { width, height } = img.getSize();
  let im = img;
  if (width > 1200) { im = img.resize({ width: 1200, quality: 'best' }); ({ width, height } = im.getSize()); }
  const bmp = Buffer.from(im.toBitmap()); // BGRA
  const idx = (x, y) => (y * width + x) * 4;
  const isBg = (i) => bmp[i] > 232 && bmp[i + 1] > 232 && bmp[i + 2] > 232;
  // Fond blanc ? (coins)
  const corners = [idx(2, 2), idx(width - 3, 2), idx(2, height - 3), idx(width - 3, height - 3)];
  const alreadyAlpha = corners.every((i) => bmp[i + 3] < 20);
  if (!alreadyAlpha && corners.filter(isBg).length >= 3) {
    const seen = new Uint8Array(width * height);
    const stack = [];
    for (let x = 0; x < width; x++) stack.push(x, 0, x, height - 1);
    for (let y = 0; y < height; y++) stack.push(0, y, width - 1, y);
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const p = y * width + x;
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!isBg(i)) continue;
      bmp[i + 3] = 0;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    // Adoucit le contour
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y);
      if (bmp[i + 3] === 0) continue;
      const n = [idx(x + 1, y), idx(x - 1, y), idx(x, y + 1), idx(x, y - 1)].filter((j) => bmp[j + 3] === 0).length;
      if (n) bmp[i + 3] = Math.round(255 * (1 - n * 0.2));
    }
  }
  // Logo sur une plaque de couleur (Switch : carré rouge, texte et icône blancs) : on retire la plaque,
  // sinon le masque CSS n'affiche qu'un rectangle plein
  if (keyPlate(bmp, width, height)) log(`logo : plaque de couleur retirée (${path.basename(outFile)})`);
  const outImg = nativeImage.createFromBitmap(bmp, { width, height });
  fs.writeFileSync(outFile, outImg.toPNG());
  return true;
}

async function platformImage(wikiTitle, dir, id, opts = { minWidth: 1280, image: null }) {
  // 1) image imposée (fichier Commons), 2) image de l'infobox de l'article (la console elle-même), 3) liste des médias
  const first = [];
  if (opts.image) first.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(opts.image)}?width=${opts.minWidth || 1280}`);
  const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`).catch(() => null);
  const inf = sum?.originalimage?.source || sum?.thumbnail?.source;
  if (inf && !/\.svg/i.test(inf)) first.push(inf);
  for (const url of first) {
    const raw = await downloadFirst([url], dir, `${id}-raw`).catch(() => null);
    if (!raw) continue;
    const out = `${id}.png`;
    try {
      if (removeWhiteBackground(path.join(dir, raw), path.join(dir, out))) { fs.rmSync(path.join(dir, raw), { force: true }); return out; }
    } catch (e) { log(`platformImage ${id}: ${e.message}`); }
    return raw;
  }
  const media = await getJson(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(wikiTitle)}`);
  const items = (media?.items || []).filter((it) => it.type === 'image' && it.srcset?.length && !/\.svg/i.test(it.title || '')
    && !/logo|wordmark|icon|map|chart|sales|controller|manette|comparison|motherboard|screenshot|diagram|box art/i.test(it.title || ''));
  for (const it of items.slice(0, 4)) {
    const best = [...it.srcset].sort((a, b) => parseFloat(b.scale) - parseFloat(a.scale))[0];
    const url = best.src.startsWith('//') ? 'https:' + best.src : best.src;
    // FIXES : miniature Wikimedia plus grande d'abord (…/640px-X.jpg → …/1280px-X.jpg), sinon celle proposée
    const big = opts.minWidth && /\/(\d+)px-[^/]+$/.test(url) && Number(url.match(/\/(\d+)px-[^/]+$/)[1]) < opts.minWidth
      ? url.replace(/\/(\d+)px-([^/]+)$/, `/${opts.minWidth}px-$2`) : null;
    const raw = await downloadFirst(big ? [big, url] : [url], dir, `${id}-raw`);
    if (!raw) continue;
    const out = `${id}.png`;
    try {
      if (removeWhiteBackground(path.join(dir, raw), path.join(dir, out))) { fs.rmSync(path.join(dir, raw), { force: true }); return out; }
    } catch (e) { log(`platformImage ${id}: ${e.message}`); }
    return raw;
  }
  return null;
}

// ---------- Logo officiel de la console ----------
// Les logos ne sont jamais dans le dépôt : ils sont téléchargés depuis Wikimedia Commons sur le PC
// de l'utilisateur (rendu PNG du SVG par Wikimedia), puis mis en cache dans media/_platforms.
const LOGOS_VERSION = 3; // à incrémenter quand la liste platforms[].logos ou l'algorithme change
const LOGO_WIDTH = 900;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const LOGO_UA = 'RRLauncher/1.0 (https://github.com/RobinRahoual/RR-Launcher; logos de consoles) Electron';

function commonsName(name) {
  return String(name || '').replace(/^(File|Fichier|Image):/i, '').trim().replace(/ /g, '_');
}

// URL de l'API imageinfo de Commons (thumburl = rendu PNG à LOGO_WIDTH px).
function commonsInfoUrl(name) {
  const title = 'File:' + commonsName(name);
  return `${COMMONS_API}?action=query&format=json&formatversion=2&redirects=1&prop=imageinfo&iiprop=url%7Cmime%7Csize`
    + `&iiurlwidth=${LOGO_WIDTH}&titles=${encodeURIComponent(title)}`;
}
function commonsFilePathUrl(name) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commonsName(name))}?width=${LOGO_WIDTH}`;
}

// Interroge Commons : renvoie l'URL d'une image matricielle (PNG de préférence) ou null si le fichier n'existe pas.
async function commonsImageUrl(name) {
  const url = commonsInfoUrl(name);
  log(`logo imageinfo ${url}`);
  const json = await getJson(url, { 'User-Agent': LOGO_UA });
  const page = (json?.query?.pages || [])[0];
  if (!page || page.missing || page.invalid) { log(`logo absent de Commons : ${name}`); return null; }
  const ii = (page.imageinfo || [])[0];
  if (!ii) { log(`logo sans imageinfo : ${name}`); return null; }
  // SVG → toujours le rendu PNG (thumburl). Image matricielle plus petite que LOGO_WIDTH → original.
  return ii.thumburl || ii.url || null;
}

// Télécharge une image de logo ; le SVG brut est refusé (l'app affiche des PNG).
async function downloadLogo(url, dir, baseName) {
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': LOGO_UA, Accept: 'image/png,image/*;q=0.8' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { log(`logo HTTP ${res.status} ${url}`); return null; }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/') || type === 'image/svg+xml') { log(`logo type refusé ${type || '?'} ${url}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 300) { log(`logo trop petit (${buf.length} o) ${url}`); return null; }
    fs.mkdirSync(dir, { recursive: true });
    const raw = `${baseName}-raw${EXT_BY_TYPE[type] || '.png'}`;
    fs.writeFileSync(path.join(dir, raw), buf);
    // Rend transparent un éventuel fond blanc plein (sans effet sur un PNG déjà transparent).
    const out = `${baseName}.png`;
    try {
      if (removeWhiteBackground(path.join(dir, raw), path.join(dir, out))) {
        fs.rmSync(path.join(dir, raw), { force: true });
        return out;
      }
    } catch (e) { log(`logo détourage ${baseName}: ${e.message}`); }
    // Image illisible par nativeImage (ex. webp/gif) : on garde le fichier tel quel.
    const keep = `${baseName}${EXT_BY_TYPE[type] || '.png'}`;
    fs.renameSync(path.join(dir, raw), path.join(dir, keep));
    return keep;
  } catch (e) {
    log(`logo erreur ${e.message} ${url}`);
    return null;
  }
}

// Supprime les anciens logos téléchargés de la console (jamais les logos personnalisés).
function cleanOldLogos(dir, id, keep) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f !== keep && f.startsWith(`${id}-logo`) && !f.includes('-custom-')) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {}
}

/**
 * Logo officiel de la console.
 * 1) fichiers Commons listés dans platform.logos (API imageinfo → thumburl PNG),
 * 2) repli Special:FilePath pour chacun,
 * 3) en dernier recours, ancienne heuristique sur la media-list de l'article Wikipédia.
 * @param {object} platform  { id, wiki, logos[] }
 * @returns nom du fichier dans dir, ou null
 */
async function platformLogo(platform, dir) {
  const id = platform.id;
  const base = `${id}-logo-v${LOGOS_VERSION}`;
  const names = (platform.logos || []).map(commonsName).filter(Boolean);
  log(`logo ${id} : ${names.length} candidat(s) Commons ${names.join(', ')}`);
  let networkOk = false;

  for (const name of names) {
    try {
      const url = await commonsImageUrl(name);
      networkOk = true;
      if (!url) continue;
      log(`logo ${id} : téléchargement ${url}`);
      const file = await downloadLogo(url, dir, base);
      if (file) { log(`logo ${id} : OK ${name} → ${file}`); cleanOldLogos(dir, id, file); return file; }
    } catch (e) { log(`logo ${id} : imageinfo échec ${name} : ${e.message}`); }
  }

  for (const name of names) {
    const url = commonsFilePathUrl(name);
    log(`logo ${id} : repli FilePath ${url}`);
    const file = await downloadLogo(url, dir, base);
    if (file) { log(`logo ${id} : OK (FilePath) ${name} → ${file}`); cleanOldLogos(dir, id, file); return file; }
  }

  if (platform.wiki) {
    try {
      const media = await getJson(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(platform.wiki)}`, { 'User-Agent': LOGO_UA });
      networkOk = true;
      const items = (media?.items || []).filter((it) => it.type === 'image' && /logo|wordmark/i.test(it.title || '')
        && !/controller|icon|button|symbol|company|corporation|sony_logo|nintendo_logo|microsoft_logo|sega_logo/i.test(it.title || ''));
      items.sort((a, b) => (/\.svg/i.test(b.title) ? 1 : 0) - (/\.svg/i.test(a.title) ? 1 : 0));
      for (const it of items.slice(0, 3)) {
        const name = commonsName(it.title);
        log(`logo ${id} : heuristique media-list ${name}`);
        let url = null;
        try { url = await commonsImageUrl(name); } catch {}
        const file = await downloadLogo(url || commonsFilePathUrl(name), dir, base);
        if (file) { log(`logo ${id} : OK (heuristique) ${name} → ${file}`); cleanOldLogos(dir, id, file); return file; }
      }
    } catch (e) { log(`logo ${id} : media-list échec ${e.message}`); }
  }

  log(`logo ${id} : aucun logo trouvé${networkOk ? '' : ' (réseau inaccessible ?)'}`);
  return null;
}

// ---------- API publique ----------
async function wikiSearch(term, platformName) {
  const q = `${term} ${platformName || ''} video game`.trim();
  const json = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(q)}`);
  return (json?.query?.search || []).map((r) => ({ source: 'wiki', title: r.title, name: r.title.replace(/\s*\((video game|jeu vidéo)\)$/i, '') }));
}

async function search(term, settings, platform) {
  if (platform && platform.id !== 'pc') {
    const tasks = [wikiSearch(term, platform.name).catch(() => [])];
    if (sgdbKeyOf(settings)) tasks.push(sgdbSearch(term, sgdbKeyOf(settings)).catch(() => []));
    const [wiki, sg = []] = await Promise.all(tasks);
    return [...sg.slice(0, 5), ...wiki.slice(0, 6)];
  }
  const tasks = [steamSearch(term).catch(() => [])];
  if (sgdbKeyOf(settings)) tasks.push(sgdbSearch(term, sgdbKeyOf(settings)).catch(() => []));
  const [steam, sg = []] = await Promise.all(tasks);
  const n = normalize(term);
  const rank = (x) => (normalize(x.name) === n ? 0 : normalize(x.name).startsWith(n) ? 1 : 2);
  steam.sort((a, b) => rank(a) - rank(b));
  // Évite les doublons SGDB déjà présents chez Steam
  const seen = new Set(steam.map((s) => normalize(s.name)));
  return [...steam.slice(0, 8), ...sg.filter((g) => !seen.has(normalize(g.name))).slice(0, 6)];
}

/**
 * Récupère toutes les infos et images d'un jeu.
 * @param {object} match  { source, appid?, sgdbId?, name }
 * @param {string} dir    dossier média du jeu
 */
async function fetchAll(match, dir, settings, progress = () => {}, ctx = {}) {
  const out = { name: match.name, media: {}, screenshots: [] };
  let steam = null;
  let urls = { cover: [], hero: [], logo: [], header: [] };

  if (match.source === 'steam' && match.appid) {
    out.appid = match.appid;
    progress('Infos Steam…');
    steam = await steamDetails(match.appid).catch(() => null);
    const assets = await steamAssets(match.appid);
    urls.cover.push(...(assets.cover || []), ...steamLegacy(match.appid, ['library_600x900_2x.jpg', 'library_600x900.jpg']));
    urls.hero.push(...(assets.hero || []), ...steamLegacy(match.appid, ['library_hero.jpg']));
    urls.logo.push(...(assets.logo || []), ...steamLegacy(match.appid, ['logo.png']));
    urls.header.push(...(assets.header || []), steam?.header_image, ...steamLegacy(match.appid, ['header.jpg']));
    if (steam?.background_raw) urls.hero.push(steam.background_raw);
  }

  // ---- Jeux console (ROM, dump, portage recompilé) ----
  const plat = ctx.platform;
  let wikiCover = null;
  const lowHero = []; // captures rétro (basse définition) : en dernier
  let enName = null; // titre anglais (jeux nommés en français)
  if (plat && plat.id !== 'pc') {
    enName = match.source === 'wiki' ? null : await englishTitle(match.name);
    const stem = ctx.romPath ? path.basename(ctx.romPath).replace(/\.[^.]+$/, '') : '';
    const cands = [...new Set([enName, match.name, stem && stem.replace(/\s*[([][^)\]]*[)\]]/g, '').trim()].filter(Boolean))];
    ctx.cands = cands;
    if (plat.libretro && ctx.romPath) {
      progress('Jaquette (libretro)…');
      const base = `https://raw.githubusercontent.com/libretro-thumbnails/${plat.libretro}/master`;
      const hit = await libretroMatch(plat.libretro, cands).catch(() => null);
      const variants = [...new Set([hit, stem, ...cands.flatMap((c) => [c, `${c} (France)`, `${c} (Europe)`, `${c} (USA)`, `${c} (World)`])].filter(Boolean))]
        .map((v) => v.replace(/[&*\/:`<>?\\|"]/g, '_'));
      for (const v of variants) {
        urls.cover.push(`${base}/Named_Boxarts/${encodeURIComponent(v)}.png`);
        lowHero.push(`${base}/Named_Snaps/${encodeURIComponent(v)}.png`, `${base}/Named_Titles/${encodeURIComponent(v)}.png`);
      }
    }
    try {
      progress('Wikipédia…');
      let title = match.source === 'wiki' ? match.title : null;
      if (!title) {
        // Titre anglais exact si on l'a, sinon le résultat de recherche le plus proche (jamais un autre jeu de la série)
        const res = await wikiSearch(enName || match.name, plat.name).catch(() => []);
        const b = names.best(res, cands);
        title = b && b.score >= 0.6 ? b.item.title : enName;
      }
      if (title) {
        const en = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        const enTitle = (en?.title || '').replace(/\s*\((video game|jeu vidéo)\)$/i, '');
        const same = match.source === 'wiki' || names.best([enTitle], cands, (x) => x)?.score >= 0.6;
        if (same) {
          if (en?.originalimage?.source) wikiCover = en.originalimage.source;
          if (match.source === 'wiki') out.name = enTitle || match.name;
          const year = (en?.description || '').match(/(19|20)\d{2}/);
          if (year) out.releaseDate = year[0];
          out.description = en?.extract || '';
        } else log(`wiki « ${match.name} » : ${enTitle} écarté (autre jeu)`);
      }
      const fr = await wikiSummary(match.source === 'wiki' ? out.name : match.name);
      if (fr) out.description = fr;
    } catch { /* hors ligne */ }
  }

  if (steam) {
    out.name = steam.name || out.name;
    out.description = decodeEntities(steam.short_description || '');
    out.about = htmlToText(steam.about_the_game || '').slice(0, 2500);
    out.developer = (steam.developers || []).join(', ');
    out.publisher = (steam.publishers || []).join(', ');
    out.releaseDate = steam.release_date?.date || '';
    out.genres = (steam.genres || []).map((g) => g.description).slice(0, 4);
    out.metacritic = steam.metacritic?.score || null;
    out.screenshotUrls = (steam.screenshots || []).slice(0, 4).map((s) => s.path_full);
    Object.assign(out, coopInfo(steam)); // HOME2 : catégories Steam → multijoueur local
  }

  // SteamGridDB en complément (ou en source principale pour les jeux hors Steam)
  if (sgdbKeyOf(settings)) {
    try {
      progress('Visuels SteamGridDB…');
      let id = match.sgdbId;
      if (!id && match.appid) id = (await sgdb(`/games/steam/${match.appid}`, sgdbKeyOf(settings)))?.id;
      if (!id && !match.appid) {
        const cands = ctx.cands || [match.name];
        const res = await sgdbSearch(cands[0], sgdbKeyOf(settings)).catch(() => []);
        const b = names.best(res, cands);
        id = b && b.score >= 0.6 ? b.item.sgdbId : null;
      }
      if (id) {
        out.sgdbId = id;
        const g = await sgdbImages(id, sgdbKeyOf(settings));
        urls.cover.push(...g.cover);
        urls.hero.push(...g.hero);
        urls.logo.push(...g.logo);
      }
    } catch { /* ignore */ }
  }

  urls.back = [];
  if (settings.tgdbKey) {
    try {
      progress('Jaquettes TheGamesDB…');
      const t = await tgdbBoxart(out.name || match.name, plat ? plat.tgdb || null : 1, settings.tgdbKey, [enName, ...(ctx.cands || []), match.name, names.prettify(match.name)]);
      if (t.id) out.tgdbId = t.id;
      if (plat && plat.id !== 'pc') urls.cover.push(...(t.front || []));
      urls.back.push(...(t.back || []));
      urls.hero.push(...(t.fanart || []));
      lowHero.push(...(t.screenshots || []));
    } catch (e) { log(`tgdb : ${e.message}`); }
  }
  if (wikiCover) urls.cover.push(wikiCover);
  progress('Téléchargement des visuels…');
  const [cover, hero, logo, header, back] = await Promise.all([
    downloadFirst(urls.cover, dir, 'cover'),
    downloadBest([...urls.hero, ...lowHero], dir, 'hero'),
    downloadFirst(urls.logo, dir, 'logo'),
    downloadFirst(urls.header, dir, 'header'),
    downloadFirst(urls.back, dir, 'back'),
  ]);
  Object.assign(out.media, { cover, hero, logo, header, back });

  if (out.screenshotUrls?.length) {
    const shots = await Promise.all(out.screenshotUrls.map((u, i) => downloadFirst([u], dir, `shot${i}`)));
    out.screenshots = shots.filter(Boolean);
  }
  delete out.screenshotUrls;

  if (!out.description && (!plat || plat.id === 'pc')) {
    progress('Description…');
    out.description = await wikiSummary(out.name);
  }

  log(`fetchAll ${match.source}:${match.appid || match.sgdbId || ''} « ${out.name} » → cover=${cover} back=${back} hero=${hero} logo=${logo} header=${header} desc=${(out.description || '').length}c`);
  const colorSrc = cover || header || hero;
  out.color = colorSrc ? dominantColor(path.join(dir, colorSrc)) : null;
  return out;
}

// Amélioration d'un fond existant en basse définition (clé SteamGridDB et/ou TheGamesDB nécessaire).
async function upgradeHero(game, dir, settings, platformTgdb) {
  const urls = [];
  if (sgdbKeyOf(settings)) {
    try {
      let id = game.sgdbId;
      if (!id && game.appid) id = (await sgdb(`/games/steam/${game.appid}`, sgdbKeyOf(settings)))?.id;
      if (!id) id = (await sgdbSearch(game.name, sgdbKeyOf(settings)))[0]?.sgdbId;
      if (id) urls.push(...(await sgdbImages(id, sgdbKeyOf(settings))).hero);
    } catch (e) { log(`hero sgdb ${game.name} : ${e.message}`); }
  }
  if (settings.tgdbKey) {
    try { urls.push(...((await tgdbBoxart(game.name, platformTgdb, settings.tgdbKey, [names.prettify(game.name)])).fanart || [])); } catch (e) { log(`hero tgdb ${game.name} : ${e.message}`); }
  }
  if (!urls.length) return null;
  return downloadBest(urls, dir, `hero-hd-${Date.now().toString(36)}`, { minWidth: 1280 });
}

// Clé SteamGridDB partagée (lue dans la base Firebase des amis, jamais écrite sur disque) : sert quand l'utilisateur n'a pas la sienne
let SHARED = {};
const setShared = (o) => { SHARED = { ...SHARED, ...(o || {}) }; };
const getShared = () => SHARED;
const sgdbKeyOf = (s) => (s && s.sgdbKey) || SHARED.sgdb || '';
module.exports = { getShared, setShared, sgdbKeyOf, libretroMatch, englishTitle, tgdbBoxart, steamDetails, coopInfo, search, fetchAll, upgradeHero, downloadBest, dominantColor, normalize, setLogFile, log, platformImage, platformLogo, downloadFirst, LOGOS_VERSION, commonsInfoUrl, commonsFilePathUrl };

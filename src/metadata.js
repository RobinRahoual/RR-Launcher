// Récupération automatique des métadonnées et visuels d'un jeu.
// Sources (dans l'ordre) : Steam (sans clé) → SteamGridDB (clé optionnelle) → Wikipédia (description).
const fs = require('fs');
const path = require('path');
const { net, nativeImage } = require('electron');

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
  const outImg = nativeImage.createFromBitmap(bmp, { width, height });
  fs.writeFileSync(outFile, outImg.toPNG());
  return true;
}

async function platformImage(wikiTitle, dir, id) {
  const media = await getJson(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(wikiTitle)}`);
  const items = (media?.items || []).filter((it) => it.type === 'image' && it.srcset?.length && !/\.svg/i.test(it.title || '')
    && !/logo|wordmark|icon|map|chart|sales|controller|manette|comparison|motherboard|screenshot|diagram|box art/i.test(it.title || ''));
  for (const it of items.slice(0, 4)) {
    const best = [...it.srcset].sort((a, b) => parseFloat(b.scale) - parseFloat(a.scale))[0];
    const url = best.src.startsWith('//') ? 'https:' + best.src : best.src;
    const raw = await downloadFirst([url], dir, `${id}-raw`);
    if (!raw) continue;
    const out = `${id}.png`;
    try {
      if (removeWhiteBackground(path.join(dir, raw), path.join(dir, out))) { fs.rmSync(path.join(dir, raw), { force: true }); return out; }
    } catch (e) { log(`platformImage ${id}: ${e.message}`); }
    return raw;
  }
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
    if (settings.sgdbKey) tasks.push(sgdbSearch(term, settings.sgdbKey).catch(() => []));
    const [wiki, sg = []] = await Promise.all(tasks);
    return [...sg.slice(0, 5), ...wiki.slice(0, 6)];
  }
  const tasks = [steamSearch(term).catch(() => [])];
  if (settings.sgdbKey) tasks.push(sgdbSearch(term, settings.sgdbKey).catch(() => []));
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
  if (plat && plat.id !== 'pc') {
    if (plat.libretro && ctx.romPath) {
      progress('Jaquette (libretro)…');
      const stem = path.basename(ctx.romPath).replace(/\.[^.]+$/, '');
      const variants = [...new Set([stem, match.name, `${match.name} (USA)`, `${match.name} (Europe)`, `${match.name} (World)`, `${match.name} (France)`])]
        .map((v) => v.replace(/[&*\/:`<>?\\|"]/g, '_'));
      const base = `https://raw.githubusercontent.com/libretro-thumbnails/${plat.libretro}/master`;
      for (const v of variants) {
        urls.cover.push(`${base}/Named_Boxarts/${encodeURIComponent(v)}.png`);
        urls.hero.push(`${base}/Named_Snaps/${encodeURIComponent(v)}.png`, `${base}/Named_Titles/${encodeURIComponent(v)}.png`);
      }
    }
    try {
      progress('Wikipédia…');
      const title = match.source === 'wiki' ? match.title : (await wikiSearch(match.name, plat.name))[0]?.title;
      if (title) {
        const en = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        if (en?.originalimage?.source) wikiCover = en.originalimage.source;
        if (match.source === 'wiki') out.name = (en?.title || match.name).replace(/\s*\((video game|jeu vidéo)\)$/i, '');
        const year = (en?.description || '').match(/(19|20)\d{2}/);
        if (year) out.releaseDate = year[0];
        out.description = en?.extract || '';
      }
      const fr = await wikiSummary(out.name);
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
  }

  // SteamGridDB en complément (ou en source principale pour les jeux hors Steam)
  if (settings.sgdbKey) {
    try {
      progress('Visuels SteamGridDB…');
      let id = match.sgdbId;
      if (!id && match.appid) id = (await sgdb(`/games/steam/${match.appid}`, settings.sgdbKey))?.id;
      if (!id && !match.appid) id = (await sgdbSearch(match.name, settings.sgdbKey))[0]?.sgdbId;
      if (id) {
        out.sgdbId = id;
        const g = await sgdbImages(id, settings.sgdbKey);
        urls.cover.push(...g.cover);
        urls.hero.push(...g.hero);
        urls.logo.push(...g.logo);
      }
    } catch { /* ignore */ }
  }

  if (wikiCover) urls.cover.push(wikiCover);
  progress('Téléchargement des visuels…');
  const [cover, hero, logo, header] = await Promise.all([
    downloadFirst(urls.cover, dir, 'cover'),
    downloadFirst(urls.hero, dir, 'hero'),
    downloadFirst(urls.logo, dir, 'logo'),
    downloadFirst(urls.header, dir, 'header'),
  ]);
  Object.assign(out.media, { cover, hero, logo, header });

  if (out.screenshotUrls?.length) {
    const shots = await Promise.all(out.screenshotUrls.map((u, i) => downloadFirst([u], dir, `shot${i}`)));
    out.screenshots = shots.filter(Boolean);
  }
  delete out.screenshotUrls;

  if (!out.description && (!plat || plat.id === 'pc')) {
    progress('Description…');
    out.description = await wikiSummary(out.name);
  }

  log(`fetchAll ${match.source}:${match.appid || match.sgdbId || ''} « ${out.name} » → cover=${cover} hero=${hero} logo=${logo} header=${header} desc=${(out.description || '').length}c`);
  const colorSrc = cover || header || hero;
  out.color = colorSrc ? dominantColor(path.join(dir, colorSrc)) : null;
  return out;
}

module.exports = { search, fetchAll, dominantColor, normalize, setLogFile, log, platformImage, downloadFirst };

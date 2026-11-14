// UNINSTALLED — jeux possédés mais pas installés (Steam, Epic, GOG). Pur : testé dans test/uninstalled.test.js.
'use strict';

const steamArt = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(id)}/library_600x900.jpg`;

/** Réponse GetOwnedGames → éléments. */
function steamOwned(json) {
  const list = json?.response?.games;
  if (!Array.isArray(list)) return [];
  return list.filter((g) => g && g.appid && g.name).map((g) => ({ store: 'steam', id: String(g.appid), name: String(g.name), art: steamArt(g.appid), alt: `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(g.appid)}/header.jpg`, sec: Math.round(Number(g.playtime_forever || 0) * 60) }));
}

/** Entrée de catalogue Epic → vrai jeu (ni DLC, ni add-on, ni application). */
function epicIsGame(cat) {
  if (!cat || !cat.title) return false;
  if (cat.mainGameItem) return false; // DLC / add-on d'un autre jeu
  const paths = (cat.categories || []).map((c) => String(c.path || '').toLowerCase());
  // Un jeu Epic porte « games » ET « applications » : « applications » seul ne suffit pas à l'écarter
  if (paths.some((p) => p === 'addons' || p.startsWith('addons') || p === 'digitalextras' || p === 'editors' || p === 'assets' || p.startsWith('plugins') || p === 'engine')) return false;
  if (!paths.length) return true;
  return paths.some((p) => p === 'games' || p.startsWith('games/'));
}
function epicArt(cat) {
  const imgs = cat?.keyImages || [];
  const pick = (t) => imgs.find((i) => i.type === t)?.url || '';
  return { art: pick('DieselGameBoxTall') || pick('OfferImageTall') || '', alt: pick('DieselGameBox') || pick('OfferImageWide') || pick('Thumbnail') || '' };
}
/** record de bibliothèque Epic + catalogue → élément */
function epicItem(rec, cat) {
  if (!rec || !rec.appName || !epicIsGame(cat)) return null;
  const a = epicArt(cat);
  return { store: 'epic', id: String(rec.appName), name: String(cat.title), art: a.art, alt: a.alt, ns: rec.namespace || '', item: rec.catalogItemId || '' };
}

/** Galaxy : OwnedGames + GamePieces (originalTitle, originalImages) → éléments */
function gogOwned(db) {
  let owned = [], pieces = [], types = [];
  try { owned = db.rows('OwnedGames'); pieces = db.rows('GamePieces'); types = db.rows('GamePieceTypes'); } catch { return []; }
  const typeId = (name) => types.find((t) => t.type === name)?.id;
  const tTitle = typeId('originalTitle') ?? typeId('title'), tImg = typeId('originalImages');
  const val = (key, t) => { const r = pieces.find((p) => p.releaseKey === key && p.gamePieceTypeId === t); if (!r) return null; try { return JSON.parse(r.value); } catch { return null; } };
  const out = [];
  for (const o of owned) {
    const key = String(o.releaseKey || '');
    const m = key.match(/^gog_(\d+)$/);
    if (!m) continue;
    const title = tTitle != null ? val(key, tTitle)?.title : '';
    if (!title) continue;
    const im = tImg != null ? val(key, tImg) : null;
    out.push({ store: 'gog', id: m[1], name: String(title), art: String(im?.verticalCover || '').replace(/^\/\//, 'https://'), alt: String(im?.background || im?.squareIcon || '').replace(/^\/\//, 'https://') });
  }
  return out;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Retire ce qui est déjà dans la bibliothèque du launcher (installé). */
function notInstalled(items, games = []) {
  const steam = new Set(), epic = new Set(), gog = new Set(), names = new Set();
  for (const g of games) {
    if (g.appid) steam.add(String(g.appid));
    if (g.epicApp) epic.add(String(g.epicApp));
    if (g.galaxyId) gog.add(String(g.galaxyId));
    if (g.installDir || g.exePath || g.kind === 'steam' || g.kind === 'epic') names.add(norm(g.name));
  }
  return items.filter((it) => !(it.store === 'steam' ? steam.has(it.id) : it.store === 'epic' ? epic.has(it.id) : gog.has(it.id)) && !names.has(norm(it.name)));
}

/** URI d'installation. */
function installPlan(it) {
  if (!it) return null;
  if (it.store === 'steam') return { uri: `steam://install/${Number(it.id)}`, label: 'Steam' };
  if (it.store === 'epic') return { uri: it.ns && it.item ? `com.epicgames.launcher://apps/${encodeURIComponent(it.ns)}%3A${encodeURIComponent(it.item)}%3A${encodeURIComponent(it.id)}?action=install` : 'com.epicgames.launcher://store/library', label: 'Epic Games' };
  if (it.store === 'gog') return { uri: `goggalaxy://openGameView/${Number(it.id)}`, label: 'GOG Galaxy' };
  return null;
}

/** GetSharedLibraryApps (famille Steam) → éléments marqués family */
function steamFamily(json, ownedIds = new Set()) {
  const apps = json?.response?.apps;
  if (!Array.isArray(apps)) return [];
  return apps.filter((a) => a && a.appid && a.name && !a.exclude_reason && !ownedIds.has(String(a.appid)))
    .map((a) => ({ store: 'steam', family: true, id: String(a.appid), name: String(a.name), art: steamArt(a.appid), alt: `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(a.appid)}/header.jpg`, sec: 0 }));
}

module.exports = { steamFamily, steamOwned, epicIsGame, epicItem, gogOwned, notInstalled, installPlan, norm };

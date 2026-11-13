'use strict';
// IMPORTER — détection des jeux des autres launchers (lecture locale uniquement, aucune connexion de compte).
// Chaque scanner renvoie { ok, source, items, error? } ; items : { kind, source, platform:'pc', name, installDir, exePath?, launchUri? }.
// Fiabilité (voir README « Importer ») :
//  Xbox        haute   Get-AppxPackage + MicrosoftGame.config (illisible si le dossier est sous WindowsApps verrouillé)
//  Ubisoft     haute   registre HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs + clés Uninstall « Uplay Install <id> »
//  Amazon      haute   GameInstallInfo.sqlite (table DbSet), lue en JS pur (+ journal WAL)
//  itch.io     haute   butler.db (caves / games / install_locations), jeux Windows uniquement (verdict.candidates)
//  Battle.net  moyenne product.db = protobuf non documenté : décodage heuristique, produits connus seulement
//  EA app      moyenne __Installer\installerdata.xml dans les dossiers de jeux usuels + clés « EA Games » ; la base IS d'EA est chiffrée (non lue)
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const pb = require('./protobuf');
const sqlite = require('./sqlite');

const isWin = process.platform === 'win32';
const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
const winPath = (p) => (/^[A-Za-z]:[\\/]/.test(p || '') ? p.replace(/\//g, '\\').replace(/\\+$/, '') : p || '');
const unxml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? unxml(m[1]) : ''; };
const attr = (s, name) => { const m = String(s).match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')); return m ? unxml(m[1]) : ''; };

function run(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    if (!isWin) return resolve('');
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, out) => resolve(err ? '' : out));
  });
}
const regQuery = (key, value) => run('reg', value ? ['query', key, '/v', value] : ['query', key, '/s'], 8000);

// Sortie de `reg query … /s` → [{ key, values: { nom: valeur } }]
function parseReg(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { cur = { key: line.trim(), values: {} }; out.push(cur); continue; }
    const m = cur && line.match(/^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ|DWORD|QWORD)\s+(.*)$/);
    if (m) cur.values[m[1]] = m[2].trim();
  }
  return out;
}
const item = (o) => ({ platform: 'pc', ...o });
const none = (source, error) => ({ ok: false, source, items: [], error });

// ---------------------------------------------------------------- Xbox / Microsoft Store
function parseMicrosoftGameConfig(xml) {
  const shell = (xml.match(/<ShellVisuals\b[^>]*>/i) || [''])[0];
  const exes = [...xml.matchAll(/<Executable\b[^>]*>/gi)].map((m) => ({ name: attr(m[0], 'Name'), id: attr(m[0], 'Id'), family: attr(m[0], 'TargetDeviceFamily') }));
  const pc = exes.find((e) => !e.family || /pc|desktop/i.test(e.family)) || exes[0] || {};
  return { name: attr(shell, 'DefaultDisplayName'), exeName: pc.name || '', exeId: pc.id || '', titleId: tag(xml, 'TitleId') };
}
const PS_XBOX = `$ErrorActionPreference='SilentlyContinue'
$names=@{}; Get-StartApps | ForEach-Object { $names[$_.AppID]=$_.Name }
$r=@(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.IsResourcePackage -and $_.InstallLocation -and (Test-Path (Join-Path $_.InstallLocation 'MicrosoftGame.config')) } | ForEach-Object {
  $ids=@(); try { $ids=@((Get-AppxPackageManifest $_).Package.Applications.Application | ForEach-Object { $_.Id }) } catch {}
  $n=$null; foreach($i in $ids){ $k=$_.PackageFamilyName+'!'+$i; if($names.ContainsKey($k)){ $n=$names[$k]; break } }
  [pscustomobject]@{ Name=$_.Name; Family=$_.PackageFamilyName; Dir=$_.InstallLocation; Apps=$ids; Display=$n } })
ConvertTo-Json -InputObject $r -Compress -Depth 4`;
const XBOX_SKIP = /^Microsoft\.(Xbox|GamingServices|GamingApp|XboxIdentityProvider|XboxGameCallableUI|XboxSpeechToTextOverlay)/i;
function buildXbox(pkgs, read = (f) => fs.readFileSync(f, 'utf8'), has = exists) {
  const out = [];
  for (const p of pkgs || []) {
    if (!p || !p.Dir || !p.Family || XBOX_SKIP.test(p.Name || '')) continue;
    let cfg = {};
    try { cfg = parseMicrosoftGameConfig(read(path.join(p.Dir, 'MicrosoftGame.config'))); } catch { /* illisible */ }
    const apps = [].concat(p.Apps || []).filter(Boolean);
    const appId = apps.includes(cfg.exeId) ? cfg.exeId : apps[0] || cfg.exeId || 'Game';
    const folder = path.basename(path.dirname(p.Dir)) && /^content$/i.test(path.basename(p.Dir)) ? path.basename(path.dirname(p.Dir)) : '';
    const good = (n) => n && !/^ms-resource:/i.test(n);
    const name = [p.Display, cfg.name, folder, String(p.Name || '').replace(/^[^.]+\./, '').replace(/([a-z])([A-Z])/g, '$1 $2')].find(good) || p.Name;
    const exe = cfg.exeName ? path.join(p.Dir, cfg.exeName) : '';
    out.push(item({
      kind: 'uri', source: 'xbox', name, installDir: p.Dir, ...(exe && has(exe) ? { exePath: exe } : {}),
      launchUri: `shell:AppsFolder\\${p.Family}!${appId}`,
    }));
  }
  return out;
}
async function scanXbox(o = {}) {
  const txt = o.json ?? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_XBOX], 45000);
  if (!txt.trim()) return none('xbox', 'Applications Xbox / Microsoft Store introuvables.');
  let pkgs; try { pkgs = JSON.parse(txt); } catch { return none('xbox', 'Lecture des applications Xbox impossible.'); }
  return { ok: true, source: 'xbox', items: buildXbox(Array.isArray(pkgs) ? pkgs : [pkgs]) };
}

// ---------------------------------------------------------------- EA app
function parseInstallerData(xml) {
  const titles = [...xml.matchAll(/<gameTitle\b([^>]*)>([\s\S]*?)<\/gameTitle>/gi)].map((m) => ({ loc: attr(m[1], 'locale'), t: unxml(m[2]) }));
  let name = (titles.find((t) => /^en/i.test(t.loc)) || titles[0] || {}).t || '';
  if (!name) name = tag(tag(xml, 'localeInfo'), 'title');
  const ids = [...xml.matchAll(/<contentID>([^<]+)<\/contentID>/gi)].map((m) => unxml(m[1]));
  const launchers = [...xml.matchAll(/<launcher\b[^>]*>([\s\S]*?)<\/launcher>/gi)].map((m) => ({
    file: tag(m[1], 'filePath').replace(/^\[[^\]]*\]/, '').replace(/^[\\/]+/, ''),
    x64: /<requires64BitOS>\s*true/i.test(m[1]),
  })).filter((l) => /\.exe$/i.test(l.file) && !/anticheat|eac_|crash|setup|touchup|redist|uninst/i.test(l.file));
  launchers.sort((a, b) => Number(b.x64) - Number(a.x64));
  const offerId = ids.find((i) => /^Origin\.(OFR|SFT)\./i.test(i)) || '';
  return { name, ids, offerId, exe: launchers[0]?.file || '' };
}
async function scanEA(o = {}) {
  const roots = o.roots || [];
  if (!o.roots) {
    for (const d of 'CDEFGH') for (const r of ['Program Files\\EA Games', 'Program Files (x86)\\EA Games', 'Program Files\\Electronic Arts', 'Program Files (x86)\\Origin Games', 'Program Files\\Origin Games', 'EA Games', 'Origin Games', 'Games\\EA Games', 'Jeux\\EA Games']) roots.push(`${d}:\\${r}`);
  }
  const dirs = new Set();
  for (const r of roots) { try { for (const e of fs.readdirSync(r, { withFileTypes: true })) if (e.isDirectory()) dirs.add(path.join(r, e.name)); } catch { /* absent */ } }
  const reg = o.reg ?? [await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\EA Games'), await regQuery('HKLM\\SOFTWARE\\EA Games')].join('\n');
  for (const k of parseReg(reg)) { const d = k.values['Install Dir']; if (d) dirs.add(winPath(d)); }
  const items = [];
  for (const dir of dirs) {
    const f = path.join(dir, '__Installer', 'installerdata.xml');
    let xml; try { xml = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const d = parseInstallerData(xml);
    const name = d.name || path.basename(dir);
    const exePath = d.exe ? path.join(dir, d.exe) : '';
    const hasExe = exePath && exists(exePath);
    const launchUri = d.offerId ? `origin2://game/launch?offerIds=${encodeURIComponent(d.offerId)}` : '';
    if (!hasExe && !launchUri) continue;
    items.push(item({ kind: hasExe ? 'exe' : 'uri', source: 'ea', name, installDir: dir, ...(hasExe ? { exePath } : {}), ...(launchUri ? { launchUri } : {}) }));
  }
  if (!items.length && !fs.existsSync(o.programData || 'C:\\ProgramData\\EA Desktop') && !roots.some(exists)) return none('ea', 'EA app introuvable.');
  return { ok: true, source: 'ea', items };
}

// ---------------------------------------------------------------- Ubisoft Connect
function buildUbisoft(installs, names = {}) {
  return (installs || []).filter((i) => i.id && i.dir).map((i) => {
    const dir = winPath(i.dir);
    return item({ kind: 'uri', source: 'ubisoft', name: names[i.id] || path.basename(dir.replace(/\\/g, '/')), installDir: dir, launchUri: `uplay://launch/${i.id}/0` });
  });
}
async function scanUbisoft(o = {}) {
  const txt = o.reg ?? await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs');
  const installs = parseReg(txt).map((k) => ({ id: (k.key.match(/Installs\\(\d+)$/i) || [])[1], dir: k.values.InstallDir })).filter((i) => i.id);
  if (!installs.length) return none('ubisoft', 'Aucun jeu Ubisoft Connect trouvé.');
  const names = {};
  for (const i of installs) {
    const t = o.names ? o.names[i.id] : (parseReg(await regQuery(`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install ${i.id}`, 'DisplayName'))[0] || { values: {} }).values.DisplayName;
    if (t) names[i.id] = t;
  }
  const check = o.check ?? exists;
  return { ok: true, source: 'ubisoft', items: buildUbisoft(installs.filter((i) => check(winPath(i.dir))), names) };
}

// ---------------------------------------------------------------- Battle.net
// uid (product.db) → nom + code de lancement battlenet://<code>. `sure:false` = code déduit, non confirmé.
const BNET = {
  s1: ['StarCraft', 'S1'], s2: ['StarCraft II', 'S2'], wow: ['World of Warcraft', 'WoW'], wow_classic: ['World of Warcraft Classic', 'WoW_wow_classic'],
  prometheus: ['Overwatch 2', 'Pro'], w3: ['Warcraft III: Reforged', 'W3'], hs_beta: ['Hearthstone', 'WTCG'], heroes: ['Heroes of the Storm', 'Hero'],
  diablo3: ['Diablo III', 'D3'], d3cn: ['Diablo III', 'D3CN'], viper: ['Call of Duty: Black Ops 4', 'VIPR'], odin: ['Call of Duty: Modern Warfare', 'ODIN'],
  lazarus: ['Call of Duty: MW2 Campaign Remastered', 'LAZR'], zeus: ['Call of Duty: Black Ops Cold War', 'ZEUS'], rtro: ['Blizzard Arcade Collection', 'RTRO'],
  cb4: ['Crash Bandicoot 4: It’s About Time', 'CB4'],
  fenris: ['Diablo IV', 'Fen', false], osi: ['Diablo II: Resurrected', 'OSI', false], gryphon: ['Warcraft Rumble', 'GRY', false], fore: ['Call of Duty: Vanguard', 'FORE', false],
};
// Cherche dans l'arbre protobuf des messages « produit » : champ 1 = uid (texte), champ 2 = productCode (texte),
// champ 3 = sous-message dont le champ 1 est le chemin d'installation. Indépendant du numéro de champ du message racine.
function parseProductDb(buf) {
  const found = [];
  const visit = (b, depth) => {
    const fields = pb.decode(b);
    if (!fields || depth > 4) return;
    const f1 = fields.find((f) => f.field === 1 && f.wire === 2 && pb.isText(f.value));
    const f2 = fields.find((f) => f.field === 2 && f.wire === 2 && pb.isText(f.value));
    const f3 = fields.find((f) => f.field === 3 && f.wire === 2);
    const sub = f3 && pb.decode(f3.value);
    const p = sub && sub.find((f) => f.field === 1 && f.wire === 2 && pb.isText(f.value) && /^([A-Za-z]:[\\/]|\\\\|\/)/.test(f.value.toString('utf8')));
    if (f1 && f2 && p) { found.push({ uid: f1.value.toString('utf8'), productCode: f2.value.toString('utf8'), installPath: p.value.toString('utf8') }); return; }
    for (const f of fields) if (f.wire === 2 && f.value.length > 4) visit(f.value, depth + 1);
  };
  visit(buf, 0);
  return found;
}
const BNET_DIRS = [['World of Warcraft', 'wow'], ['Overwatch', 'prometheus'], ['Diablo III', 'diablo3'], ['Diablo IV', 'fenris'], ['Diablo II Resurrected', 'osi'], ['Hearthstone', 'hs_beta'], ['StarCraft II', 's2'], ['Heroes of the Storm', 'heroes'], ['Warcraft III', 'w3']];
async function scanBattlenet(o = {}) {
  const db = o.db || path.join(process.env.ProgramData || 'C:\\ProgramData', 'Battle.net', 'Agent', 'product.db');
  let products = [];
  try { products = parseProductDb(fs.readFileSync(db)); } catch { /* repli sur les dossiers connus */ }
  if (!products.length) {
    for (const base of o.dirs || ['C:\\Program Files (x86)', 'C:\\Program Files', 'D:\\Battle.net', 'D:\\Games']) for (const [d, uid] of BNET_DIRS) {
      const p = path.join(base, d);
      if (exists(p) && !products.some((x) => x.uid === uid)) products.push({ uid, productCode: uid, installPath: p });
    }
    if (!products.length) return none('battlenet', exists(path.dirname(path.dirname(db))) ? 'Aucun jeu Battle.net trouvé.' : 'Battle.net introuvable.');
  }
  const items = [];
  for (const p of products) {
    const k = BNET[p.uid] || BNET[p.productCode];
    if (!k || !p.installPath || !exists(p.installPath) || items.some((i) => i.installDir === winPath(p.installPath))) continue;
    items.push(item({ kind: 'uri', source: 'battlenet', name: k[0], installDir: winPath(p.installPath), launchUri: `battlenet://${k[1]}`, ...(k[2] === false ? { uncertain: true } : {}) }));
  }
  return { ok: true, source: 'battlenet', items };
}

// ---------------------------------------------------------------- Amazon Games
function buildAmazon(rows) {
  return (rows || []).filter((r) => r.Id && r.InstallDirectory && (r.Installed === 1 || r.Installed === true || r.Installed === '1' || r.Installed === 'True'))
    .map((r) => item({ kind: 'uri', source: 'amazon', name: r.ProductTitle || path.basename(String(r.InstallDirectory)), installDir: winPath(r.InstallDirectory), launchUri: `amazon-games://play/${r.Id}` }));
}
async function scanAmazon(o = {}) {
  const f = o.db || path.join(process.env.LOCALAPPDATA || '', 'Amazon Games', 'Data', 'Games', 'Sql', 'GameInstallInfo.sqlite');
  if (!exists(f)) return none('amazon', 'Amazon Games introuvable.');
  try { return { ok: true, source: 'amazon', items: buildAmazon(sqlite.openFile(fs, f).rows('DbSet')).filter((i) => (o.check ?? exists)(i.installDir)) }; }
  catch (e) { return none('amazon', 'Base Amazon Games illisible : ' + e.message); }
}

// ---------------------------------------------------------------- itch.io
function buildItch(db, has = exists) {
  const locs = Object.fromEntries(db.rows('install_locations').map((l) => [l.id, l.path]));
  const games = Object.fromEntries(db.rows('games').map((g) => [g.id, g.title]));
  const out = [];
  for (const c of db.rows('caves')) {
    let v = {}; try { v = JSON.parse(c.verdict || '{}'); } catch { /* verdict absent */ }
    const dir = c.custom_install_folder || (locs[c.install_location_id] && c.install_folder_name ? path.join(locs[c.install_location_id], c.install_folder_name) : '');
    if (!dir) continue;
    const base = v.basePath ? (path.isAbsolute(v.basePath) || /^[A-Za-z]:/.test(v.basePath) ? v.basePath : path.join(dir, v.basePath)) : dir;
    const cands = (v.candidates || []).filter((x) => /windows/i.test(x.flavor || '') || /\.exe$/i.test(x.path || '')).sort((a, b) => (b.size || 0) - (a.size || 0));
    if (!cands.length) continue;
    const exePath = path.join(base, cands[0].path);
    if (!has(exePath)) continue;
    out.push(item({ kind: 'exe', source: 'itch', name: games[c.game_id] || c.install_folder_name || path.basename(dir), installDir: dir, exePath }));
  }
  return out;
}
async function scanItch(o = {}) {
  const f = o.db || path.join(process.env.APPDATA || '', 'itch', 'db', 'butler.db');
  if (!exists(f)) return none('itch', 'itch.io introuvable.');
  try { return { ok: true, source: 'itch', items: buildItch(sqlite.openFile(fs, f), o.has) }; }
  catch (e) { return none('itch', 'Base itch.io illisible : ' + e.message); }
}

// ---------------------------------------------------------------- Ensemble
const SCANNERS = [scanXbox, scanEA, scanUbisoft, scanBattlenet, scanAmazon, scanItch];
function scanAll() {
  return SCANNERS.map((f) => f().catch((e) => ({ ok: false, source: f.name, items: [], error: String(e.message || e) })));
}

// Ouverture d'un lien de lancement (sécurisé : schémas connus uniquement)
const OK_URI = /^(battlenet|uplay|amazon-games|origin2?|eadesktop|com\.epicgames\.launcher|steam|itch|shell:appsfolder)[:\\]/i;
function openLaunchUri(uri, shell) {
  if (!OK_URI.test(String(uri || ''))) return Promise.reject(new Error('Lien de lancement refusé'));
  if (/^shell:appsfolder/i.test(uri)) {
    return new Promise((resolve, reject) => {
      const c = execFile('explorer.exe', [uri], { windowsHide: true }, () => {});
      c.once('error', reject); c.once('spawn', () => setTimeout(resolve, 300)); // explorer renvoie toujours le code 1
    });
  }
  return shell.openExternal(uri);
}

module.exports = {
  parseReg, parseMicrosoftGameConfig, buildXbox, parseInstallerData, buildUbisoft, parseProductDb, buildAmazon, buildItch, BNET,
  scanXbox, scanEA, scanUbisoft, scanBattlenet, scanAmazon, scanItch, scanAll, openLaunchUri,
};

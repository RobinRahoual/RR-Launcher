// STREAM-PROFILE — profil de streaming « réaliste et fluide » pour Apollo/Sunshine + Moonlight/Artemis. Module PUR (pas
// d'electron, pas de fs) : à partir d'une cible (4k60 | 1440p120 | 1080p120 | 1080p60), d'un receveur, de la liaison
// (ethernet | wifi), du débit LAN mesuré (Mbps, facultatif) et du GPU hôte, choisit le meilleur profil tenable, le dégrade
// d'un cran tant que le receveur ou le réseau ne suit pas (4k60 → 1440p60 → 1080p60 ; 1080p120 → 1080p60) et explique
// pourquoi. Produit aussi les clés sunshine.conf (hostConf) et les réglages à saisir côté client (clientSettings).
// Bitrates : fourchettes heuristiques (défauts Moonlight pour H.264) ; débit réseau requis ≈ bitrate × 1,4 → on n'utilise
// que ~70 % du débit mesuré.
'use strict';

const NET_FACTOR = 1.4;      // débit réseau requis ≈ bitrate × 1,4
const MEASURED_SHARE = 0.7;  // part du débit mesuré utilisable (marge)
const CODECS = ['h264', 'hevc', 'av1'];
const LINKS = ['ethernet', 'wifi'];
const GPUS = ['nvidia', 'amd', 'intel', 'unknown'];

// Profils connus (cibles + crans intermédiaires de dégradation)
const PROFILES = {
  '4k60': { w: 3840, h: 2160, fps: 60, label: '4K 60 i/s', res: '4k' },
  '1440p120': { w: 2560, h: 1440, fps: 120, label: '1440p 120 i/s', res: '1440p' },
  '1440p60': { w: 2560, h: 1440, fps: 60, label: '1440p 60 i/s', res: '1440p' },
  '1080p120': { w: 1920, h: 1080, fps: 120, label: '1080p 120 i/s', res: '1080p' },
  '1080p60': { w: 1920, h: 1080, fps: 60, label: '1080p 60 i/s', res: '1080p' },
};
// Cibles proposées à l'utilisateur et leur échelle de dégradation (du meilleur au plus sûr)
const LADDERS = {
  '4k60': ['4k60', '1440p60', '1080p60'],
  '1440p120': ['1440p120', '1080p120', '1440p60', '1080p60'],
  '1080p120': ['1080p120', '1080p60'],
  '1080p60': ['1080p60'],
};
const TARGETS = Object.keys(LADDERS).map((id) => ({ id, ...PROFILES[id], ladder: LADDERS[id].slice() }));

// Fourchettes de bitrate (Mbps) [bas, haut] par codec ; 1440p60 interpolé
const RANGES = {
  h264: { '1080p60': [20, 30], '1080p120': [30, 45], '1440p60': [30, 40], '1440p120': [60, 80], '4k60': [80, 100] },
  hevc: { '1080p60': [15, 20], '1080p120': [20, 30], '1440p60': [20, 30], '1440p120': [40, 55], '4k60': [50, 70] },
  av1: { '1080p60': [12, 18], '1080p120': [18, 25], '1440p60': [18, 25], '1440p120': [35, 50], '4k60': [45, 60] },
};

// Receveurs : modes = { profil: 'ok' | 'warn' } (absent = non tenu) ; ethCapMbps = plafond de bitrate en Ethernet
const RECEIVERS = [
  { id: 'windows', name: 'PC Windows', client: 'Moonlight PC (Qt)', av1: false, ethCapMbps: null,
    modes: { '4k60': 'ok', '1440p120': 'ok', '1440p60': 'ok', '1080p120': 'ok', '1080p60': 'ok' },
    install: 'Installer Moonlight PC depuis moonlight-stream.org (ou winget install MoonlightGameStreamingProject.Moonlight). Statistiques en jeu : Ctrl+Alt+Maj+S.' },
  { id: 'mac', name: 'Mac', client: 'Moonlight PC (Qt)', av1: false, ethCapMbps: null,
    modes: { '4k60': 'ok', '1440p120': 'warn', '1440p60': 'ok', '1080p120': 'warn', '1080p60': 'ok' },
    install: 'Installer Moonlight pour macOS depuis moonlight-stream.org ; décodage matériel VideoToolbox (Renderer : Automatique).' },
  { id: 'androidtv', name: 'Android TV / Google TV', client: 'Artemis ou Moonlight Android', av1: false, ethCapMbps: null,
    modes: { '4k60': 'ok', '1440p60': 'ok', '1080p120': 'warn', '1080p60': 'ok' },
    install: 'Installer Artemis (fork Moonlight compatible Apollo) ou Moonlight depuis le Play Store. Google TV Streamer : Wi-Fi 5, Ethernet gigabit conseillé.' },
  { id: 'firetv4k', name: 'Fire TV Stick 4K / 4K Max', client: 'Moonlight Android (Amazon Appstore)', av1: false, ethCapMbps: 60,
    modes: { '4k60': 'ok', '1440p60': 'ok', '1080p60': 'ok' },
    install: 'Installer Moonlight depuis l’Amazon Appstore. Wi-Fi 6 (4K Max) ; l’adaptateur Ethernet Amazon est limité à 100 Mbps.' },
  { id: 'firetvlite', name: 'Fire TV Stick (3e gén.) / Lite', client: 'Moonlight Android (Amazon Appstore)', av1: false, ethCapMbps: null,
    modes: { '1080p60': 'ok' },
    install: 'Installer Moonlight depuis l’Amazon Appstore. Wi-Fi 5, pas d’AV1 : 1080p 60 i/s HEVC maximum.' },
  { id: 'iphone', name: 'iPhone / iPad', client: 'Moonlight iOS (App Store)', av1: false, ethCapMbps: null,
    modes: { '4k60': 'ok', '1440p60': 'ok', '1080p120': 'ok', '1080p60': 'ok' },
    install: 'Installer Moonlight depuis l’App Store (Artemis n’existe pas sur iOS). Résolution native de l’écran conseillée ; 120 i/s sur écran ProMotion.' },
  { id: 'appletv', name: 'Apple TV 4K', client: 'Moonlight tvOS (App Store)', av1: false, ethCapMbps: null,
    modes: { '4k60': 'ok', '1440p60': 'ok', '1080p60': 'ok' },
    install: 'Installer Moonlight depuis l’App Store de l’Apple TV. Ethernet gigabit conseillé ; sortie limitée à 4K 60 i/s.' },
  { id: 'androidphone', name: 'Téléphone / tablette Android', client: 'Artemis', av1: true, ethCapMbps: null,
    modes: { '4k60': 'warn', '1440p60': 'ok', '1080p120': 'ok', '1080p60': 'ok' },
    install: 'Installer Artemis (toutes les fonctions Apollo : écran virtuel adapté, permissions…) depuis GitHub ou le Play Store.' },
];
const RECV = Object.fromEntries(RECEIVERS.map((r) => [r.id, r]));
const WARN_MODE = {
  mac: (p) => `${p} : seulement si l’écran du Mac affiche 120 Hz`,
  androidtv: (p) => `${p} sur Android TV : à tester (activer « Unlock all possible frame rates » dans le client)`,
  androidphone: (p) => `${p} sur téléphone : selon la définition de l’écran, la résolution native est souvent plus pertinente`,
};

// ---- Pures
const profileKey = (res, fps) => `${res}${fps}`;
function normRes(res) {
  if (typeof res === 'number') return res >= 2160 ? '4k' : res >= 1440 ? '1440p' : res >= 1080 ? '1080p' : null;
  const s = String(res ?? '').toLowerCase().trim();
  return s === '4k' || s === '2160p' ? '4k' : s === '1440p' ? '1440p' : s === '1080p' ? '1080p' : null;
}
// Fourchette [bas, haut] (Mbps) d'un profil pour un codec
function bitrateRange(res, fps, codec = 'hevc') {
  const r = normRes(res); const c = String(codec).toLowerCase();
  if (!r) throw new Error(`Résolution inconnue : ${res} (attendu : 1080p, 1440p, 4k)`);
  if (!CODECS.includes(c)) throw new Error(`Codec inconnu : ${codec} (attendu : ${CODECS.join(', ')})`);
  const range = RANGES[c][profileKey(r, Number(fps))];
  if (!range) throw new Error(`Profil non géré : ${r} ${fps} i/s`);
  return range.slice();
}
// Bitrate de départ conseillé (milieu de fourchette), en Mbps
function bitrateFor(res, fps, codec = 'hevc') { const [lo, hi] = bitrateRange(res, fps, codec); return Math.round((lo + hi) / 2); }
// Débit réseau (Mbps) nécessaire pour un bitrate
const networkNeed = (bitrateMbps) => Math.ceil(bitrateMbps * NET_FACTOR);
const validMbps = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
// Plafond de bitrate (Mbps) imposé par le réseau / l'hôte / le receveur, ou null si aucun
function bitrateCeiling({ measuredMbps = null, maxBitrateKbps = 0, capMbps = null } = {}) {
  const c = [];
  const m = validMbps(measuredMbps); if (m) c.push(m * MEASURED_SHARE);
  const k = validMbps(Number(maxBitrateKbps)); if (k) c.push(k / 1000);
  const r = validMbps(capMbps); if (r) c.push(r);
  return c.length ? Math.min(...c) : null;
}
// Bitrate retenu : nominal plafonné à ~70 % du débit mesuré et à max_bitrate (Kbps, 0 = pas de plafond) ; ≥ 1 Mbps
function pickBitrate(nominalMbps, { measuredMbps = null, maxBitrateKbps = 0, capMbps = null } = {}) {
  const n = validMbps(Number(nominalMbps));
  if (!n) throw new Error(`Bitrate nominal invalide : ${nominalMbps}`);
  const ceil = bitrateCeiling({ measuredMbps, maxBitrateKbps, capMbps });
  return Math.max(1, Math.floor(ceil == null ? n : Math.min(n, ceil)));
}

// sunshine.conf : objet → lignes « clé = valeur »
const KEY_RE = /^[A-Za-z0-9_]+$/;
function checkEntry(k, v) {
  if (!KEY_RE.test(k)) throw new Error(`Clé sunshine.conf invalide : ${k}`);
  if (v != null && /[\r\n]/.test(String(v))) throw new Error(`Valeur multiligne interdite pour ${k}`);
}
function formatConf(obj = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('formatConf attend un objet');
  const lines = [];
  for (const [k, v] of Object.entries(obj)) { checkEntry(k, v); if (v != null) lines.push(`${k} = ${v}`); }
  return lines.length ? lines.join('\n') + '\n' : '';
}
// Remplace / ajoute les clés de obj dans un sunshine.conf existant, en gardant les autres lignes et les commentaires.
// Valeur null/undefined → la clé est retirée. Doublons d'une clé remplacée → seule la première ligne est gardée.
function mergeConf(text = '', obj = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('mergeConf attend un objet');
  for (const [k, v] of Object.entries(obj)) checkEntry(k, v);
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.length ? src.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const seen = new Set(); const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (!m || !Object.prototype.hasOwnProperty.call(obj, m[1])) { out.push(line); continue; }
    const k = m[1];
    if (seen.has(k)) continue;
    seen.add(k);
    if (obj[k] != null) out.push(`${k} = ${obj[k]}`);
  }
  for (const [k, v] of Object.entries(obj)) if (!seen.has(k) && v != null) out.push(`${k} = ${v}`);
  return out.length ? out.join(eol) + eol : '';
}

// Codec conseillé : HEVC partout ; AV1 seulement GPU NVIDIA avec AV1 + receveur qui le décode (Fire TV 4K, Android)
function pickCodec(receiver, gpu, av1Host) {
  if (av1Host === true && gpu === 'nvidia' && receiver.av1) return { codec: 'av1', why: `AV1 : encodeur AV1 sur l’hôte et décodage AV1 sur ${receiver.name}` };
  if (av1Host === true && gpu !== 'nvidia') return { codec: 'hevc', why: 'HEVC : AV1 non proposé par défaut sur GPU AMD/Intel (prudence), HEVC est le meilleur compromis' };
  if (av1Host === true) return { codec: 'hevc', why: `HEVC : ${receiver.name} ne décode pas l’AV1 de façon fiable` };
  return { codec: 'hevc', why: 'HEVC : meilleure qualité qu’H.264 à bitrate égal, décodé par tous les receveurs proposés' };
}

// Clés sunshine.conf (valeurs en chaînes) adaptées au GPU, à la liaison et au profil
function hostConfFor({ gpu, link, profileId, tight, ceilingMbps }) {
  const p = PROFILES[profileId]; const wifi = link === 'wifi';
  const conf = {
    limit_framerate: 'true',
    fec_percentage: wifi ? '25' : '20',
    dd_resolution_option: 'auto', dd_refresh_rate_option: 'auto',
  };
  if (gpu === 'nvidia') Object.assign(conf, {
    encoder: 'nvenc', nvenc_preset: '1', nvenc_twopass: 'quarter_res',
    nvenc_spatial_aq: tight || wifi || p.res === '4k' ? 'enabled' : 'disabled',
    nvenc_vbv_increase: '0', nvenc_realtime_hags: 'enabled', nvenc_latency_over_power: 'enabled',
  });
  else if (gpu === 'amd') Object.assign(conf, {
    encoder: 'amdvce', amd_usage: p.fps > 60 ? 'ultralowlatency' : 'lowlatency_high_quality', amd_rc: 'vbr_latency',
    amd_quality: 'balanced', amd_preanalysis: profileId === '1080p60' ? 'enabled' : 'disabled', amd_vbaq: 'enabled',
  });
  else if (gpu === 'intel') Object.assign(conf, { encoder: 'quicksync', qsv_preset: 'medium' });
  return conf;
}

// Réglages à saisir dans Moonlight / Artemis (libellés FR)
function clientSettingsFor(receiver, prof, codec, bitrateMbps) {
  const id = receiver.id; const android = ['androidtv', 'firetv4k', 'firetvlite', 'androidphone'].includes(id);
  const s = [
    { label: 'Résolution', value: `${prof.w}×${prof.h}` + (id === 'iphone' || id === 'androidphone' ? ' (ou la résolution native de l’écran)' : '') },
    { label: 'Images par seconde', value: `${prof.fps} i/s` },
    { label: 'Débit vidéo', value: `${bitrateMbps} Mbps` },
    { label: 'Codec vidéo', value: codec === 'av1' ? 'AV1' : codec === 'h264' ? 'H.264' : id === 'windows' ? 'Automatique ou HEVC (H.265)' : 'HEVC (H.265)' },
    { label: 'HDR', value: 'Désactivé' },
  ];
  if (id === 'windows') s.push({ label: 'Décodeur vidéo', value: 'Automatique' },
    { label: 'V-Sync / Frame pacing', value: 'V-Sync désactivé ; activer V-Sync + Frame pacing seulement en cas de saccades' });
  else if (id === 'mac') s.push({ label: 'Renderer', value: 'Automatique (VideoToolbox)' },
    { label: 'V-Sync / Frame pacing', value: 'V-Sync désactivé ; activer V-Sync + Frame pacing seulement en cas de saccades' });
  else if (android) s.push({ label: 'Décodeur vidéo', value: 'Automatique (matériel)' }, { label: 'Frame pacing', value: 'Équilibré (Balanced)' });
  else s.push({ label: 'Décodeur vidéo', value: 'Automatique (matériel)' }, { label: 'Frame pacing', value: 'Par défaut' });
  if (id === 'androidtv' && prof.fps > 60) s.push({ label: 'Unlock all possible frame rates', value: 'Activé' });
  if (id === 'windows' || id === 'mac') s.push({ label: 'Statistiques en jeu', value: 'Ctrl+Alt+Maj+S' });
  s.push({ label: 'Audio', value: 'Stéréo (5.1 seulement si l’ampli/la barre de son le gère)' });
  s.push({ label: 'Appairage', value: 'Ajouter le PC dans le client, puis saisir le code PIN dans l’interface web Apollo (https://IP-du-PC:47990, onglet PIN). Le premier client appairé a tous les droits ; donner « Launch Apps » aux suivants.' });
  return s;
}

// ---- Recommandation
function recommend({ target, receiver, link, measuredMbps = null, gpu = 'unknown', av1Host = false, maxBitrateKbps = 0, tv5994 = false } = {}) {
  const t = String(target ?? '').toLowerCase().trim();
  if (!LADDERS[t]) throw new Error(`Cible inconnue : ${target} (attendu : ${Object.keys(LADDERS).join(', ')})`);
  const recv = RECV[String(receiver ?? '').toLowerCase().trim()];
  if (!recv) throw new Error(`Receveur inconnu : ${receiver} (attendu : ${RECEIVERS.map((r) => r.id).join(', ')})`);
  const warnings = []; const reasons = [];
  let lk = String(link ?? '').toLowerCase().trim();
  if (!LINKS.includes(lk)) { warnings.push(`Liaison « ${link ?? ''} » inconnue : supposée Wi-Fi (hypothèse prudente)`); lk = 'wifi'; }
  let g = String(gpu ?? 'unknown').toLowerCase().trim();
  if (!GPUS.includes(g)) g = 'unknown';
  const meas = validMbps(measuredMbps);
  if (measuredMbps != null && !meas) warnings.push(`Débit mesuré invalide (${measuredMbps}) : ignoré`);

  const { codec, why } = pickCodec(recv, g, av1Host);
  const capMbps = lk === 'ethernet' && recv.ethCapMbps ? recv.ethCapMbps : null;
  const ceiling = bitrateCeiling({ measuredMbps: meas, maxBitrateKbps, capMbps });

  // 1) capacités du receveur
  const ladder = LADDERS[t];
  const supported = ladder.filter((id) => recv.modes[id]);
  for (const id of ladder) {
    if (recv.modes[id]) break;
    reasons.push(`${PROFILES[id].label} non tenu (ou non confirmé) sur ${recv.name} : cran suivant`);
  }
  // 2) débit : on descend tant que le plafond est sous le bas de fourchette
  let chosen = null;
  for (const id of supported) {
    const p = PROFILES[id]; const [lo] = bitrateRange(p.res, p.fps, codec);
    if (ceiling == null || ceiling >= lo) { chosen = id; break; }
    const src = capMbps && ceiling === capMbps ? `l’Ethernet de ${recv.name} (plafond ~${capMbps} Mbps)`
      : meas ? `le réseau (${meas} Mbps mesurés → ~${Math.floor(meas * MEASURED_SHARE)} Mbps utilisables, besoin ≈ ${networkNeed(lo)} Mbps)`
        : `max_bitrate de l’hôte (${Math.floor(ceiling)} Mbps)`;
    reasons.push(`${p.label} demande au moins ${lo} Mbps en ${codec.toUpperCase()} : ${src} ne suit pas`);
  }
  if (!chosen) {
    chosen = supported[supported.length - 1] || '1080p60';
    warnings.push(`Même ${PROFILES[chosen].label} dépasse le débit disponible : attends-toi à des artefacts, passe en Ethernet ou rapproche le receveur du routeur`);
  }
  const prof = PROFILES[chosen];
  if (recv.modes[chosen] === 'warn' && WARN_MODE[recv.id]) warnings.push(WARN_MODE[recv.id](prof.label));
  if (t === '1080p120' && chosen === '1080p60' && (recv.id === 'firetv4k' || recv.id === 'appletv'))
    warnings.push(`1080p 120 i/s non confirmé sur ${recv.name} : tu peux l’essayer, mais 1080p 60 i/s est la valeur sûre`);

  const nominal = bitrateFor(prof.res, prof.fps, codec);
  const bitrateMbps = pickBitrate(nominal, { measuredMbps: meas, maxBitrateKbps, capMbps });
  const tight = bitrateMbps < nominal;
  reasons.unshift(chosen === t ? `${prof.label} tenu par ${recv.name} et la liaison ${lk === 'wifi' ? 'Wi-Fi' : 'Ethernet'}` : `Dégradé de ${PROFILES[t].label} à ${prof.label}`);
  reasons.push(why);
  reasons.push(tight ? `Bitrate ${bitrateMbps} Mbps (plafonné sous les ${nominal} Mbps conseillés par la marge réseau)` : `Bitrate ${bitrateMbps} Mbps (milieu de fourchette ${codec.toUpperCase()} pour ${prof.label}, réseau requis ≈ ${networkNeed(bitrateMbps)} Mbps)`);
  if (lk === 'wifi') reasons.push('Wi-Fi : correction d’erreurs (FEC) portée à 25 %, débit limité à ~70 % du mesuré');

  if (lk === 'wifi' && !meas) warnings.push('Wi-Fi sans mesure : mesure ton débit LAN (iperf3 / test du launcher) pour ajuster le bitrate ; hôte en Ethernet, receveur en 5 GHz (Wi-Fi 5/6 minimum)');
  if (lk === 'wifi' && prof.res === '4k') warnings.push('4K 60 en Wi-Fi : risqué à haut bitrate, surveille les pertes dans les statistiques');
  if (g === 'unknown') warnings.push('GPU hôte inconnu : clé encoder non fixée (détection automatique par Apollo)');
  if (g === 'nvidia') warnings.push('double_refreshrate (Apollo) : à activer seulement si l’hôte combine CPU AMD et GPU NVIDIA et que l’image saccade');
  warnings.push('HDR désactivé : généralement déconseillé (Windows 11 23H2+ requis, rendu variable)');

  let displayOverride = null;
  if (recv.id === 'appletv') {
    if (tv5994) displayOverride = `${prof.w}x${prof.h}x59.94`;
    else warnings.push(`Si la TV tourne en 59,94 Hz, régler l’override d’affichage du client sur ${prof.w}x${prof.h}x59.94`);
  }

  return {
    requested: t,
    resolved: { w: prof.w, h: prof.h, fps: prof.fps, label: prof.label },
    degraded: chosen !== t,
    reasons, codec, bitrateMbps,
    hostConf: hostConfFor({ gpu: g, link: lk, profileId: chosen, tight, ceilingMbps: ceiling }),
    clientSettings: clientSettingsFor(recv, prof, codec, bitrateMbps),
    displayOverride, warnings,
  };
}

module.exports = { recommend, RECEIVERS, TARGETS, PROFILES, formatConf, mergeConf, bitrateFor, bitrateRange, pickBitrate, networkNeed };

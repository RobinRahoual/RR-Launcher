'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/features/stream-profile');

const lbl = (r) => `${r.resolved.w}x${r.resolved.h}@${r.resolved.fps}`;
const setting = (r, label) => (r.clientSettings.find((s) => s.label === label) || {}).value;

test('bitrateFor : milieu de fourchette, HEVC 1440p60 ≈ 25', () => {
  assert.strictEqual(P.bitrateFor('1080p', 60, 'h264'), 25);
  assert.strictEqual(P.bitrateFor('4k', 60, 'hevc'), 60);
  assert.strictEqual(P.bitrateFor('1440p', 60, 'hevc'), 25);
  assert.strictEqual(P.bitrateFor(2160, 60, 'av1'), 53);
});
test('bitrateFor : entrées invalides', () => {
  assert.throws(() => P.bitrateFor('720p', 60, 'hevc'), /Résolution inconnue/);
  assert.throws(() => P.bitrateFor('1080p', 60, 'vp9'), /Codec inconnu/);
  assert.throws(() => P.bitrateFor('4k', 120, 'hevc'), /non géré/);
});
test('pickBitrate : plafonné à 70 % du mesuré et à max_bitrate', () => {
  assert.strictEqual(P.pickBitrate(60), 60);
  assert.strictEqual(P.pickBitrate(60, { measuredMbps: 50 }), 35);
  assert.strictEqual(P.pickBitrate(60, { maxBitrateKbps: 40000 }), 40);
  assert.strictEqual(P.pickBitrate(60, { measuredMbps: 200, maxBitrateKbps: 0 }), 60);
  assert.strictEqual(P.pickBitrate(60, { measuredMbps: 'abc' }), 60);
  assert.throws(() => P.pickBitrate(-3), /invalide/);
});
test('Windows Ethernet 4k60 NVIDIA : pas de dégradation, HEVC, fec 20', () => {
  const r = P.recommend({ target: '4k60', receiver: 'windows', link: 'ethernet', measuredMbps: 900, gpu: 'nvidia' });
  assert.strictEqual(r.degraded, false);
  assert.strictEqual(lbl(r), '3840x2160@60');
  assert.strictEqual(r.codec, 'hevc');
  assert.strictEqual(r.bitrateMbps, 60);
  assert.strictEqual(r.hostConf.encoder, 'nvenc');
  assert.strictEqual(r.hostConf.fec_percentage, '20');
  assert.strictEqual(r.hostConf.nvenc_spatial_aq, 'enabled');
  assert.strictEqual(r.hostConf.nvenc_vbv_increase, '0');
  assert.strictEqual(r.displayOverride, null);
});
test('4k60 en Wi-Fi à 50 Mbps → 1440p60 avec explication', () => {
  const r = P.recommend({ target: '4k60', receiver: 'windows', link: 'wifi', measuredMbps: 50, gpu: 'nvidia' });
  assert.strictEqual(r.degraded, true);
  assert.strictEqual(lbl(r), '2560x1440@60');
  assert.ok(r.bitrateMbps <= 35);
  assert.ok(r.reasons.some((s) => /4K 60 i\/s demande au moins 50 Mbps/.test(s)));
  assert.strictEqual(r.hostConf.fec_percentage, '25');
});
test('4k60 en Wi-Fi à 25 Mbps → 1080p60', () => {
  const r = P.recommend({ target: '4k60', receiver: 'appletv', link: 'wifi', measuredMbps: 25, gpu: 'amd' });
  assert.strictEqual(lbl(r), '1920x1080@60');
  assert.strictEqual(r.bitrateMbps, 17);
  assert.strictEqual(r.hostConf.amd_preanalysis, 'enabled');
});
test('réseau trop faible même pour 1080p60 → dernier cran + avertissement', () => {
  const r = P.recommend({ target: '1080p120', receiver: 'windows', link: 'wifi', measuredMbps: 10, gpu: 'intel' });
  assert.strictEqual(lbl(r), '1920x1080@60');
  assert.strictEqual(r.bitrateMbps, 7);
  assert.ok(r.warnings.some((w) => /dépasse le débit disponible/.test(w)));
  assert.strictEqual(r.hostConf.encoder, 'quicksync');
  assert.strictEqual(r.hostConf.qsv_preset, 'medium');
});
test('1080p120 sur Apple TV → 1080p60 (non confirmé)', () => {
  const r = P.recommend({ target: '1080p120', receiver: 'appletv', link: 'ethernet', gpu: 'nvidia' });
  assert.strictEqual(r.degraded, true);
  assert.strictEqual(lbl(r), '1920x1080@60');
  assert.ok(r.reasons.some((s) => /non confirmé/.test(s)));
  assert.ok(r.warnings.some((w) => /1920x1080x59\.94/.test(w)));
});
test('Apple TV + TV 59,94 Hz → displayOverride', () => {
  const r = P.recommend({ target: '4k60', receiver: 'appletv', link: 'ethernet', gpu: 'nvidia', tv5994: true });
  assert.strictEqual(r.displayOverride, '3840x2160x59.94');
});
test('Fire TV Lite : 4k60 → 1080p60 HEVC', () => {
  const r = P.recommend({ target: '4k60', receiver: 'firetvlite', link: 'wifi', measuredMbps: 300, gpu: 'nvidia', av1Host: true });
  assert.strictEqual(lbl(r), '1920x1080@60');
  assert.strictEqual(r.codec, 'hevc');
  assert.strictEqual(r.reasons.filter((s) => /non tenu/.test(s)).length, 2);
});
test('Fire TV 4K en Ethernet : plafond 100 Mbps → bitrate ≤ 60, HEVC (AV1 non garanti sur la 1re génération)', () => {
  const r = P.recommend({ target: '4k60', receiver: 'firetv4k', link: 'ethernet', gpu: 'nvidia', av1Host: true });
  assert.strictEqual(r.codec, 'hevc');
  assert.strictEqual(lbl(r), '3840x2160@60');
  assert.ok(r.bitrateMbps <= 60);
  const h = P.recommend({ target: '4k60', receiver: 'firetv4k', link: 'ethernet', gpu: 'nvidia' });
  assert.strictEqual(h.codec, 'hevc');
  assert.strictEqual(h.bitrateMbps, 60);
});
test('AV1 jamais sur AMD/Intel ni sur receveur sans AV1', () => {
  assert.strictEqual(P.recommend({ target: '1080p60', receiver: 'androidphone', link: 'wifi', gpu: 'amd', av1Host: true }).codec, 'hevc');
  assert.strictEqual(P.recommend({ target: '1080p60', receiver: 'androidtv', link: 'ethernet', gpu: 'nvidia', av1Host: true }).codec, 'hevc');
  assert.strictEqual(P.recommend({ target: '1080p60', receiver: 'androidphone', link: 'wifi', gpu: 'nvidia', av1Host: true }).codec, 'av1');
});
test('Android TV 1080p120 : gardé avec avertissement + Unlock all frame rates', () => {
  const r = P.recommend({ target: '1080p120', receiver: 'androidtv', link: 'ethernet', gpu: 'nvidia' });
  assert.strictEqual(r.degraded, false);
  assert.ok(r.warnings.some((w) => /à tester/.test(w)));
  assert.strictEqual(setting(r, 'Unlock all possible frame rates'), 'Activé');
  assert.strictEqual(setting(r, 'Frame pacing'), 'Équilibré (Balanced)');
});
test('1440p120 sur iPhone → 1080p120', () => {
  const r = P.recommend({ target: '1440p120', receiver: 'iphone', link: 'wifi', measuredMbps: 400, gpu: 'amd' });
  assert.strictEqual(lbl(r), '1920x1080@120');
  assert.strictEqual(r.hostConf.amd_usage, 'ultralowlatency');
  assert.strictEqual(r.hostConf.amd_preanalysis, 'disabled');
});
test('Wi-Fi sans mesure → avertissement, GPU inconnu → pas de clé encoder', () => {
  const r = P.recommend({ target: '1080p60', receiver: 'mac', link: 'wifi', gpu: 'quantum' });
  assert.ok(r.warnings.some((w) => /mesure ton débit/.test(w)));
  assert.ok(!('encoder' in r.hostConf));
  assert.ok(!('max_bitrate' in r.hostConf) && !('lan_encryption_mode' in r.hostConf) && !('hevc_mode' in r.hostConf)); // ne pas écraser les choix de l'utilisateur
});
test('clientSettings : champs obligatoires, HDR désactivé, appairage PIN', () => {
  const r = P.recommend({ target: '4k60', receiver: 'windows', link: 'ethernet', gpu: 'nvidia' });
  for (const l of ['Résolution', 'Images par seconde', 'Débit vidéo', 'Codec vidéo', 'HDR', 'Décodeur vidéo', 'V-Sync / Frame pacing', 'Audio', 'Appairage']) assert.ok(setting(r, l), l);
  assert.strictEqual(setting(r, 'HDR'), 'Désactivé');
  assert.match(setting(r, 'Appairage'), /47990.*PIN.*Launch Apps/s);
  assert.strictEqual(setting(r, 'Débit vidéo'), '60 Mbps');
});
test('hostConf : chaînes uniquement, clés autorisées seulement', () => {
  const allowed = new Set(['encoder', 'hevc_mode', 'av1_mode', 'max_bitrate', 'minimum_fps_target', 'limit_framerate', 'fec_percentage', 'lan_encryption_mode', 'nvenc_preset', 'nvenc_twopass', 'nvenc_spatial_aq', 'nvenc_vbv_increase', 'nvenc_realtime_hags', 'nvenc_latency_over_power', 'amd_usage', 'amd_rc', 'amd_quality', 'amd_preanalysis', 'amd_vbaq', 'qsv_preset', 'double_refreshrate', 'dd_resolution_option', 'dd_refresh_rate_option']);
  for (const gpu of ['nvidia', 'amd', 'intel', 'unknown']) {
    const r = P.recommend({ target: '1440p120', receiver: 'windows', link: 'ethernet', gpu });
    for (const [k, v] of Object.entries(r.hostConf)) { assert.ok(allowed.has(k), k); assert.strictEqual(typeof v, 'string'); }
    assert.ok(!('min_fps_factor' in r.hostConf) && !('nvenc_split_encode' in r.hostConf));
  }
});
test('recommend : entrées invalides', () => {
  assert.throws(() => P.recommend({ target: '8k', receiver: 'windows' }), /Cible inconnue/);
  assert.throws(() => P.recommend({ target: '4k60', receiver: 'ps5' }), /Receveur inconnu/);
  assert.throws(() => P.recommend(), /Cible inconnue/);
  const r = P.recommend({ target: '4K60', receiver: 'Windows', link: 'cpl', measuredMbps: -5 });
  assert.ok(r.warnings.some((w) => /supposée Wi-Fi/.test(w)));
  assert.ok(r.warnings.some((w) => /Débit mesuré invalide/.test(w)));
  assert.strictEqual(r.hostConf.fec_percentage, '25');
});
test('formatConf', () => {
  assert.strictEqual(P.formatConf({ encoder: 'nvenc', fec_percentage: '20', x: null }), 'encoder = nvenc\nfec_percentage = 20\n');
  assert.strictEqual(P.formatConf({}), '');
  assert.throws(() => P.formatConf({ 'bad key': 'x' }), /invalide/);
  assert.throws(() => P.formatConf({ a: 'x\ny' }), /multiligne/);
});
test('mergeConf : remplace, ajoute, conserve commentaires et autres clés', () => {
  const src = '# Ma conf\nsunshine_name = PC-Salon\nencoder = software\n\n# FEC\n  fec_percentage=10\nencoder = quicksync\n';
  const out = P.mergeConf(src, { encoder: 'nvenc', fec_percentage: '25', max_bitrate: '60000' });
  assert.strictEqual(out, '# Ma conf\nsunshine_name = PC-Salon\nencoder = nvenc\n\n# FEC\nfec_percentage = 25\nmax_bitrate = 60000\n');
});
test('mergeConf : CRLF, commentaire de clé non touché, null retire, texte vide', () => {
  const out = P.mergeConf('# encoder = old\r\nencoder = amdvce\r\nhevc_mode = 2\r\n', { hevc_mode: '0', encoder: null });
  assert.strictEqual(out, '# encoder = old\r\nhevc_mode = 0\r\n');
  assert.strictEqual(P.mergeConf('', { av1_mode: '0' }), 'av1_mode = 0\n');
  assert.strictEqual(P.mergeConf(null, {}), '');
  assert.throws(() => P.mergeConf('', { 'a=b': '1' }), /invalide/);
});
test('RECEIVERS / TARGETS', () => {
  assert.deepStrictEqual(P.TARGETS.map((t) => t.id), ['4k60', '1440p120', '1080p120', '1080p60']);
  assert.deepStrictEqual(P.TARGETS[0].ladder, ['4k60', '1440p60', '1080p60']);
  for (const r of P.RECEIVERS) { assert.ok(r.id && r.name && r.client && r.install); assert.ok(r.modes['1080p60']); }
  assert.strictEqual(P.RECEIVERS.length, 8);
});

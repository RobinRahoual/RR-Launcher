// FIXES — bandes-annonces Steam au format actuel (2025-2026), en Node pur, sans ffmpeg.
//
// Depuis fin 2025, store.steampowered.com/api/appdetails ne donne plus de `mp4` / `webm` dans `movies` :
//   { id, name, thumbnail, highlight,
//     dash_av1:  "https://video.akamai.steamstatic.com/store_trailers/<appid>/<n>/<hash>/<ts>/dash_av1.mpd?t=…",
//     dash_h264: "…/dash_h264.mpd?t=…",
//     hls_h264:  "…/hls_264_master.m3u8?t=…" }
// (sources : fixture de jpechaves/steam_api, issue #9 « Steam removed webm/mp4 from movies » ; extension Playnite
//  SteamTrailerStreamer : vidéo et audio en flux segmentés séparés, `microtrailer.mp4` simple à côté du manifeste,
//  anciennes vidéos encore servies aux URL historiques steam/apps/<movieId>/movie_max.mp4).
//
// Ordre des sources essayées (premier succès gagne) :
//   1. champs progressifs mp4 / webm s'ils existent encore (anciennes réponses) ;
//   2. URL historiques construites avec l'id du film (movie480_vp9.webm, movie480.mp4, movie_max.mp4) ;
//   3. DASH H.264 : init + segments d'une représentation vidéo ≤ 720p (+ audio fusionné si possible), ≤ 60 s ;
//   4. HLS H.264 en fMP4 (EXT-X-MAP) : même principe (segments TS non gérés) ;
//   5. DASH AV1 (Chromium le décode) ;
//   6. microtrailer.mp4 à côté du manifeste (quelques secondes, muet).
// Le résultat DASH / HLS est un MP4 fragmenté (ftyp+moov puis moof/mdat) lisible tel quel par Chromium.

const MAX_HEIGHT = 720;
const MAX_SECONDS = 60;
const MAX_BYTES = 45 * 1024 * 1024;
const LEGACY_BASE = 'https://cdn.akamai.steamstatic.com/steam/apps/';

// ------------------------------------------------------------------ Sources
function trailerSources(movies) {
  if (!Array.isArray(movies)) return [];
  const list = movies.filter((m) => m && typeof m === 'object');
  list.sort((a, b) => (b.highlight ? 1 : 0) - (a.highlight ? 1 : 0)); // tri stable : ordre Steam conservé
  const ok = (u) => typeof u === 'string' && /^https:\/\//.test(u);
  const out = [];
  for (const m of list.slice(0, 2)) { // la mise en avant, puis une seconde vidéo en secours
    for (const [fmt, q] of [['mp4', '480'], ['webm', '480'], ['mp4', 'max'], ['webm', 'max']]) {
      const u = m[fmt]?.[q];
      if (ok(u)) out.push({ kind: 'progressive', url: u, ext: fmt === 'webm' ? '.webm' : '.mp4', label: `${fmt} ${q}` });
    }
    if (Number.isInteger(Number(m.id)) && Number(m.id) > 0) {
      for (const f of ['movie480_vp9.webm', 'movie480.mp4', 'movie_max.mp4']) {
        out.push({ kind: 'progressive', url: `${LEGACY_BASE}${Number(m.id)}/${f}`, ext: f.endsWith('.webm') ? '.webm' : '.mp4', label: `ancienne URL ${f}`, legacy: true });
      }
    }
    if (ok(m.dash_h264)) out.push({ kind: 'dash', url: m.dash_h264, ext: '.mp4', label: 'DASH H.264' });
    if (ok(m.hls_h264)) out.push({ kind: 'hls', url: m.hls_h264, ext: '.mp4', label: 'HLS H.264' });
    if (ok(m.dash_av1)) out.push({ kind: 'dash', url: m.dash_av1, ext: '.mp4', label: 'DASH AV1' });
    const man = [m.hls_h264, m.dash_h264, m.dash_av1].find(ok);
    if (man) {
      const u = new URL(man); u.search = '';
      u.pathname = u.pathname.replace(/[^/]*$/, 'microtrailer.mp4');
      out.push({ kind: 'progressive', url: u.toString(), ext: '.mp4', label: 'microtrailer' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ Mini analyseur XML (suffisant pour un MPD)
function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const el = { name: m[3].replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = decodeEnt(a[2] ?? a[3]);
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += decodeEnt(m[6]);
  }
  return root;
}
const decodeEnt = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
const kids = (el, name) => (el?.children || []).filter((c) => c.name === name);
const kid = (el, name) => kids(el, name)[0];

function isoDur(s) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s || '').trim());
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
function fillTemplate(t, vars) {
  return t.replace(/\$(RepresentationID|Number|Bandwidth|Time)(?:%0(\d+)d)?\$|\$\$/g, (all, k, w) => {
    if (all === '$$') return '$';
    const v = String(vars[k] ?? '');
    return w ? v.padStart(Number(w), '0') : v;
  });
}

/**
 * Plan de téléchargement d'un MPD : { video: { init, segs:[{url,t,d,range?}], height, codecs }, audio?: {…} }
 * Segments limités à maxSeconds.
 */
function planDash(xml, mpdUrl, { maxHeight = MAX_HEIGHT, maxSeconds = MAX_SECONDS } = {}) {
  const doc = parseXml(xml);
  const mpd = kid(doc, 'MPD');
  if (!mpd) throw new Error('MPD illisible');
  if (mpd.attrs.type === 'dynamic') throw new Error('MPD dynamique');
  const period = kid(mpd, 'Period');
  if (!period) throw new Error('MPD sans Period');
  const total = isoDur(period.attrs.duration) || isoDur(mpd.attrs.mediaPresentationDuration);
  const base = (el, b) => { const u = kid(el, 'BaseURL'); return u ? new URL(u.text.trim(), b).toString() : b; };
  const pBase = base(period, base(mpd, mpdUrl));
  const isVideo = (as, r) => /video/.test(as.attrs.contentType || as.attrs.mimeType || r?.attrs.mimeType || '') || !!(r?.attrs.height || as.attrs.maxHeight);
  const isAudio = (as, r) => /audio/.test(as.attrs.contentType || as.attrs.mimeType || r?.attrs.mimeType || '');

  const pick = (want) => {
    const cands = [];
    for (const as of kids(period, 'AdaptationSet')) {
      for (const r of kids(as, 'Representation')) if (want(as, r)) cands.push({ as, r });
    }
    return cands;
  };
  const vids = pick(isVideo);
  if (!vids.length) throw new Error('aucune piste vidéo');
  const h = (c) => Number(c.r.attrs.height || c.as.attrs.height || 0);
  const under = vids.filter((c) => h(c) && h(c) <= maxHeight).sort((a, b) => h(b) - h(a) || Number(b.r.attrs.bandwidth || 0) - Number(a.r.attrs.bandwidth || 0));
  const v = under[0] || [...vids].sort((a, b) => h(a) - h(b))[0];
  const auds = pick(isAudio).sort((a, b) => Number(b.r.attrs.bandwidth || 0) - Number(a.r.attrs.bandwidth || 0));
  const a = auds.find((c) => Number(c.r.attrs.bandwidth || 0) <= 192000) || auds[auds.length - 1];

  const track = ({ as, r }) => {
    const b = base(r, base(as, pBase));
    const tpl = kid(r, 'SegmentTemplate') || kid(as, 'SegmentTemplate') || kid(period, 'SegmentTemplate');
    const list = kid(r, 'SegmentList') || kid(as, 'SegmentList');
    const vars = { RepresentationID: r.attrs.id, Bandwidth: r.attrs.bandwidth };
    const segs = [];
    let init = null;
    if (tpl) {
      // attributs hérités : AdaptationSet → Representation
      const at = { ...(kid(as, 'SegmentTemplate')?.attrs || {}), ...tpl.attrs };
      const ts = Number(at.timescale || 1);
      let num = Number(at.startNumber ?? 1);
      if (at.initialization) init = { url: new URL(fillTemplate(at.initialization, vars), b).toString() };
      const tl = kid(tpl, 'SegmentTimeline') || kid(kid(as, 'SegmentTemplate'), 'SegmentTimeline');
      if (tl) {
        let t = 0;
        for (const s of kids(tl, 'S')) {
          if (s.attrs.t !== undefined) t = Number(s.attrs.t);
          const d = Number(s.attrs.d);
          let r = Number(s.attrs.r || 0);
          if (!(d > 0)) continue;
          if (r < 0) r = Math.max(0, Math.ceil(((total || maxSeconds) * ts - t) / d) - 1);
          for (let k = 0; k <= r; k++) {
            if (segs.length && segs[segs.length - 1].t >= maxSeconds) break;
            segs.push({ url: new URL(fillTemplate(at.media, { ...vars, Number: num, Time: t }), b).toString(), t: t / ts, d: d / ts });
            num++; t += d;
          }
        }
      } else if (at.duration) {
        const d = Number(at.duration) / ts;
        const n = Math.ceil((total || maxSeconds) / d);
        for (let k = 0; k < n && k * d < maxSeconds; k++) {
          segs.push({ url: new URL(fillTemplate(at.media, { ...vars, Number: num + k, Time: Math.round(k * d * ts) }), b).toString(), t: k * d, d });
        }
      }
    } else if (list) {
      const ts = Number(list.attrs.timescale || 1), d = Number(list.attrs.duration || 0) / ts;
      const ini = kid(list, 'Initialization');
      if (ini) init = { url: new URL(ini.attrs.sourceURL || '', b).toString(), range: ini.attrs.range };
      kids(list, 'SegmentURL').forEach((s, k) => {
        if (k * d < maxSeconds || !d) segs.push({ url: new URL(s.attrs.media || '', b).toString(), range: s.attrs.mediaRange, t: k * d, d });
      });
    } else {
      // SegmentBase / fichier unique : on télécharge le début du fichier (MP4 fragmenté ou non)
      segs.push({ url: b, t: 0, d: total || 0, whole: true });
    }
    // On s'arrête au premier segment qui dépasse la limite de durée
    const cut = segs.filter((s) => s.t < maxSeconds);
    return { init, segs: cut, height: h({ as, r }), codecs: r.attrs.codecs || as.attrs.codecs || '' };
  };
  return { video: track(v), audio: a ? track(a) : null };
}

// ------------------------------------------------------------------ HLS (fMP4)
function attrList(s) {
  const o = {};
  for (const m of s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) o[m[1]] = m[2].replace(/^"|"$/g, '');
  return o;
}
function parseMediaPlaylist(text, url, maxSeconds = MAX_SECONDS) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let init = null, dur = 0, t = 0, range = null, nextOff = 0;
  const segs = [];
  const br = (v) => { const [len, off] = v.split('@'); const o = off !== undefined ? Number(off) : nextOff; nextOff = o + Number(len); return `${o}-${o + Number(len) - 1}`; };
  for (const l of lines) {
    if (l.startsWith('#EXT-X-MAP:')) {
      const a = attrList(l.slice(11));
      init = { url: new URL(a.URI, url).toString() };
      if (a.BYTERANGE) { nextOff = 0; init.range = br(a.BYTERANGE); }
    } else if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith('#EXT-X-BYTERANGE:')) range = br(l.slice(17));
    else if (l.startsWith('#EXT-X-KEY:') && !/METHOD=NONE/.test(l)) throw new Error('HLS chiffré');
    else if (!l.startsWith('#')) {
      if (t >= maxSeconds) break;
      segs.push({ url: new URL(l, url).toString(), t, d: dur, range: range || undefined });
      t += dur; dur = 0; range = null;
    }
  }
  if (!init) throw new Error('HLS en segments TS (non géré sans ffmpeg)');
  return { init, segs };
}
/** Master HLS → { videoUrl, audioUrl, height } (variante vidéo la plus haute ≤ maxHeight). */
function planHlsMaster(text, url, { maxHeight = MAX_HEIGHT } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => l.startsWith('#EXTINF'))) return { videoUrl: url, audioUrl: null, height: 0 }; // déjà une playlist média
  const vars = [];
  let audioUrl = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-MEDIA:')) { const a = attrList(l.slice(13)); if (a.TYPE === 'AUDIO' && a.URI && !audioUrl) audioUrl = new URL(a.URI, url).toString(); }
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attrList(l.slice(18));
      let j = i + 1; while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      const res = /^(\d+)x(\d+)$/.exec(a.RESOLUTION || '');
      const video = !!res || /avc|hvc|hev|av01|vp0?9/i.test(a.CODECS || '');
      if (video && lines[j]) vars.push({ url: new URL(lines[j], url).toString(), height: res ? Number(res[2]) : 0, bw: Number(a.BANDWIDTH || 0) });
    }
  }
  if (!vars.length) throw new Error('aucune variante vidéo HLS');
  const under = vars.filter((v) => v.height && v.height <= maxHeight).sort((a, b) => b.height - a.height || b.bw - a.bw);
  const v = under[0] || [...vars].sort((a, b) => a.height - b.height)[0];
  return { videoUrl: v.url, audioUrl, height: v.height };
}

// ------------------------------------------------------------------ Boîtes MP4
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);
function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) { if (p + 16 > end) break; size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break; // boîte tronquée : on s'arrête
    out.push({ type, start: p, end: p + size, hdr });
    p += size;
  }
  return out;
}
const sub = (buf, b) => boxes(buf, b.start + b.hdr, b.end);
const find = (buf, b, type) => sub(buf, b).find((x) => x.type === type);
function boxBuf(type, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8); h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
function trackIdOf(buf, trak) {
  const tkhd = find(buf, trak, 'tkhd');
  const v = buf[tkhd.start + 8];
  return buf.readUInt32BE(tkhd.start + (v === 1 ? 28 : 20));
}
function timescaleOf(buf, trak) {
  const mdhd = find(buf, find(buf, trak, 'mdia'), 'mdhd');
  const v = buf[mdhd.start + 8];
  return buf.readUInt32BE(mdhd.start + (v === 1 ? 28 : 20));
}
/** Vérifie un segment d'initialisation : ftyp? + moov avec mvex (fMP4). Retourne { moov, traks }. */
function readInit(buf) {
  const top = boxes(buf);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('init sans moov');
  const traks = sub(buf, moov).filter((b) => b.type === 'trak');
  if (!traks.length || !find(buf, moov, 'mvex')) throw new Error('init non fragmenté');
  return { top, moov, traks };
}
/** Fragments (moof+mdat) d'un segment, sans styp/sidx ; null si le format n'est pas sûr à recopier. */
function fragmentsOf(buf) {
  const top = boxes(buf);
  const out = [];
  for (let i = 0; i < top.length; i++) {
    const b = top[i];
    if (b.type !== 'moof') continue;
    const traf = find(buf, b, 'traf');
    const tfhd = traf && find(buf, traf, 'tfhd');
    if (!tfhd) return null;
    if (buf.readUInt32BE(tfhd.start + 8) & 0x000001) return null; // base-data-offset absolu : décalages faux une fois recopié
    const mdat = top[i + 1];
    if (!mdat || mdat.type !== 'mdat') return null;
    out.push(Buffer.from(buf.subarray(b.start, mdat.end)));
    i++;
  }
  return out;
}
function setTrackId(frag, id) {
  const moof = boxes(frag)[0];
  for (const traf of sub(frag, moof).filter((x) => x.type === 'traf')) frag.writeUInt32BE(id, find(frag, traf, 'tfhd').start + 12);
}
function setSeq(frag, n) {
  const mfhd = find(frag, boxes(frag)[0], 'mfhd');
  if (mfhd) frag.writeUInt32BE(n >>> 0, mfhd.start + 12);
}
function patchDurations(buf, moovBox, seconds) {
  const mvhd = find(buf, moovBox, 'mvhd');
  if (mvhd) {
    const v = buf[mvhd.start + 8];
    const ts = buf.readUInt32BE(mvhd.start + (v === 1 ? 28 : 20));
    const d = Math.round(seconds * ts);
    if (v === 1) buf.writeBigUInt64BE(BigInt(d), mvhd.start + 32); else buf.writeUInt32BE(d >>> 0, mvhd.start + 24);
    const mvex = find(buf, moovBox, 'mvex');
    const mehd = mvex && find(buf, mvex, 'mehd');
    if (mehd) { if (buf[mehd.start + 8] === 1) buf.writeBigUInt64BE(BigInt(d), mehd.start + 12); else buf.writeUInt32BE(d >>> 0, mehd.start + 12); }
  }
}

/**
 * Assemble un MP4 fragmenté : init vidéo (+ piste audio fusionnée si fournie) puis fragments entrelacés par temps.
 * video = { init: Buffer, segs: [{ buf, t }] }, audio idem ou null. seconds = durée réellement téléchargée.
 */
function assemble(video, audio, seconds) {
  const vb = video.init;
  const vi = readInit(vb);
  let moovOut, audioId = 0;
  if (audio) {
    try {
      const ab = audio.init;
      const ai = readInit(ab);
      if (vi.traks.length !== 1 || ai.traks.length !== 1) throw new Error('pistes multiples');
      const vid = trackIdOf(vb, vi.traks[0]);
      audioId = vid + 1;
      const atrak = Buffer.from(ab.subarray(ai.traks[0].start, ai.traks[0].end));
      const ab2 = atrak; const t = boxes(ab2)[0];
      const tk = find(ab2, t, 'tkhd'); ab2.writeUInt32BE(audioId, tk.start + (ab2[tk.start + 8] === 1 ? 28 : 20));
      const amvex = find(ab, ai.moov, 'mvex');
      const atrex = sub(ab, amvex).find((x) => x.type === 'trex');
      if (!atrex) throw new Error('trex audio absent');
      const trex = Buffer.from(ab.subarray(atrex.start, atrex.end)); trex.writeUInt32BE(audioId, 12);
      const parts = [];
      for (const b of sub(vb, vi.moov)) {
        const raw = vb.subarray(b.start, b.end);
        if (b.type === 'mvhd') { const m = Buffer.from(raw); m.writeUInt32BE(audioId + 1, m.length - 4); parts.push(m); }
        else if (b.type === 'mvex') parts.push(boxBuf('mvex', ...sub(vb, b).map((x) => vb.subarray(x.start, x.end)), trex));
        else { parts.push(raw); if (b.type === 'trak') parts.push(atrak); }
      }
      moovOut = boxBuf('moov', ...parts);
    } catch { audio = null; audioId = 0; } // fusion impossible : vidéo seule (muette par défaut de toute façon)
  }
  if (!moovOut) moovOut = Buffer.from(vb.subarray(vi.moov.start, vi.moov.end));
  patchDurations(moovOut, boxes(moovOut)[0], seconds);
  const ftyp = vi.top.find((b) => b.type === 'ftyp');
  const head = [ftyp ? vb.subarray(ftyp.start, ftyp.end) : boxBuf('ftyp', Buffer.from('isom\0\0\x02\0isomiso6mp41', 'latin1')), moovOut];
  const frags = [];
  for (const s of video.segs) { const f = fragmentsOf(s.buf); if (!f) throw new Error('segment vidéo non géré'); f.forEach((x, k) => frags.push({ t: s.t + k * 1e-6, buf: x })); }
  if (audio) {
    for (const s of audio.segs) {
      if (s.t >= seconds) break;
      const f = fragmentsOf(s.buf);
      if (!f) continue;
      f.forEach((x, k) => { setTrackId(x, audioId); frags.push({ t: s.t + k * 1e-6 + 1e-7, buf: x }); });
    }
  }
  frags.sort((a, b) => a.t - b.t);
  frags.forEach((f, i) => setSeq(f.buf, i + 1));
  return { buf: Buffer.concat([...head, ...frags.map((f) => f.buf)]), audio: !!audio };
}

// ------------------------------------------------------------------ Téléchargement
/**
 * fetchBuf(url, { range, maxBytes }) → Buffer (injecté : net.fetch dans l'app, faux réseau dans les tests).
 * Retourne { buf, seconds, height, audio, segments }.
 */
async function downloadSegmented(src, fetchText, fetchBuf, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_BYTES, maxSeconds = opts.maxSeconds || MAX_SECONDS;
  let plan;
  if (src.kind === 'dash') plan = planDash(await fetchText(src.url), src.url, opts);
  else {
    const m = planHlsMaster(await fetchText(src.url), src.url, opts);
    const video = parseMediaPlaylist(await fetchText(m.videoUrl), m.videoUrl, maxSeconds);
    let audio = null;
    if (m.audioUrl) { try { audio = parseMediaPlaylist(await fetchText(m.audioUrl), m.audioUrl, maxSeconds); } catch { audio = null; } }
    plan = { video: { ...video, height: m.height }, audio };
  }
  const v = plan.video;
  if (!v.segs.length) throw new Error('aucun segment');
  if (v.segs[0].whole) { // fichier unique (SegmentBase)
    const buf = await fetchBuf(v.segs[0].url, { maxBytes, partial: true });
    return { buf, seconds: Math.min(v.segs[0].d || maxSeconds, maxSeconds), height: v.height, audio: false, segments: 1 };
  }
  if (!v.init) throw new Error('segment d\'initialisation absent');
  let bytes = 0;
  const get = async (s) => { const b = await fetchBuf(s.url, { range: s.range, maxBytes: maxBytes - bytes }); bytes += b.length; return b; };
  const vInit = await get(v.init);
  const vSegs = [];
  let seconds = 0;
  for (const s of v.segs) {
    if (bytes > maxBytes * 0.8) break; // garde de la place pour l'audio
    vSegs.push({ t: s.t, buf: await get(s) });
    seconds = s.t + s.d;
  }
  let audio = null;
  if (plan.audio?.init && !opts.noAudio) {
    try {
      const aInit = await get(plan.audio.init);
      const aSegs = [];
      for (const s of plan.audio.segs) { if (s.t >= seconds || bytes > maxBytes) break; aSegs.push({ t: s.t, buf: await get(s) }); }
      audio = { init: aInit, segs: aSegs };
    } catch { audio = null; }
  }
  const r = assemble({ init: vInit, segs: vSegs }, audio, seconds);
  return { buf: r.buf, seconds, height: v.height, audio: r.audio, segments: vSegs.length };
}

module.exports = { trailerSources, planDash, planHlsMaster, parseMediaPlaylist, downloadSegmented, assemble, boxes, parseXml, isoDur, MAX_SECONDS, MAX_BYTES };

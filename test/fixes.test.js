// FIXES — bandes-annonces Steam (DASH / HLS en Node pur), Range rr://, dimensions d'images.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const T = require('../src/features/fixes/trailer.js');
const { serveFile, imageSize } = require('../src/features/fixes.js');

const FX = path.join(__dirname, 'fixtures');
// Entrée `movies` réelle (appdetails 440, 2026 — fixture de jpechaves/steam_api) : plus de mp4 / webm
const STEAM_MOVIE = {
  id: 256698790, name: 'Jungle Inferno', highlight: true,
  thumbnail: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256698790/movie.293x165.jpg?t=1682961253',
  dash_av1: 'https://video.akamai.steamstatic.com/store_trailers/440/129304/a9d97ffaf28cac468369400c12abe442a7b688b2/1749861261/dash_av1.mpd?t=1682961253',
  dash_h264: 'https://video.akamai.steamstatic.com/store_trailers/440/129304/a9d97ffaf28cac468369400c12abe442a7b688b2/1749861261/dash_h264.mpd?t=1682961253',
  hls_h264: 'https://video.akamai.steamstatic.com/store_trailers/440/129304/a9d97ffaf28cac468369400c12abe442a7b688b2/1749861261/hls_264_master.m3u8?t=1682961253',
};

// Faux réseau : le chemin de l'URL désigne un fichier des fixtures (…/dash/… ou …/hls/…)
const local = (u) => { const p = new URL(u).pathname; return path.join(FX, p.includes('/hls/') ? 'steam-hls' : 'steam-dash', path.basename(p)); };
const fetchText = async (u) => fs.readFileSync(local(u), 'utf8');
const fetchBuf = async (u, o = {}) => {
  let b = fs.readFileSync(local(u));
  if (o.range) { const [a, z] = o.range.split('-').map(Number); b = b.subarray(a, z + 1); }
  if (o.maxBytes && b.length > o.maxBytes) throw new Error('trop lourd');
  return b;
};
const types = (buf) => T.boxes(buf).map((b) => b.type);

test('trailerSources : format actuel → anciennes URL, DASH H.264, HLS, DASH AV1, microtrailer', () => {
  const s = T.trailerSources([{ id: 1, dash_h264: 'https://v/x/dash_h264.mpd' }, STEAM_MOVIE]);
  assert.deepStrictEqual(s.slice(0, 3).map((x) => x.url), [
    'https://cdn.akamai.steamstatic.com/steam/apps/256698790/movie480_vp9.webm',
    'https://cdn.akamai.steamstatic.com/steam/apps/256698790/movie480.mp4',
    'https://cdn.akamai.steamstatic.com/steam/apps/256698790/movie_max.mp4',
  ]);
  assert.deepStrictEqual(s.slice(3, 7).map((x) => x.label), ['DASH H.264', 'HLS H.264', 'DASH AV1', 'microtrailer']);
  assert.strictEqual(s[6].url, 'https://video.akamai.steamstatic.com/store_trailers/440/129304/a9d97ffaf28cac468369400c12abe442a7b688b2/1749861261/microtrailer.mp4');
  assert.deepStrictEqual(T.trailerSources(null), []);
  // ancien format : mp4 480 en premier
  assert.strictEqual(T.trailerSources([{ id: 2, mp4: { 480: 'https://a/2.mp4' } }])[0].url, 'https://a/2.mp4');
});

test('planDash : SegmentTemplate + SegmentTimeline (fixture ffmpeg), vidéo ≤ 720p la plus haute, audio', () => {
  const url = 'https://v/dash/dash_h264.mpd?t=1';
  const p = T.planDash(fs.readFileSync(path.join(FX, 'steam-dash/dash_h264.mpd'), 'utf8'), url);
  assert.strictEqual(p.video.height, 90);
  assert.strictEqual(p.video.init.url, 'https://v/dash/init-0.m4s');
  assert.deepStrictEqual(p.video.segs.map((s) => path.basename(s.url)), ['chunk-0-00001.m4s', 'chunk-0-00002.m4s', 'chunk-0-00003.m4s']);
  assert.ok(p.audio && p.audio.segs.length >= 3);
});

test('planDash : style Steam (BaseURL, $Number$ + duration, 1080p ignoré, limite 60 s)', () => {
  const mpd = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2M5.3S">
  <Period><BaseURL>media/</BaseURL>
   <AdaptationSet mimeType="video/mp4" segmentAlignment="true">
    <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg_$Number%03d$.m4s"/>
    <Representation id="v1080" bandwidth="6000000" width="1920" height="1080" codecs="avc1.640028"/>
    <Representation id="v720" bandwidth="3000000" width="1280" height="720" codecs="avc1.64001f"/>
    <Representation id="v480" bandwidth="1200000" width="854" height="480" codecs="avc1.64001e"/>
   </AdaptationSet>
   <AdaptationSet mimeType="audio/mp4"><SegmentTemplate timescale="48000" duration="192000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg_$Number%03d$.m4s"/>
    <Representation id="a" bandwidth="128000" codecs="mp4a.40.2"/></AdaptationSet>
  </Period></MPD>`;
  const p = T.planDash(mpd, 'https://video.akamai.steamstatic.com/store_trailers/1/2/h/3/dash_h264.mpd?t=9');
  assert.strictEqual(p.video.height, 720);
  assert.strictEqual(p.video.init.url, 'https://video.akamai.steamstatic.com/store_trailers/1/2/h/3/media/v720/init.mp4');
  assert.strictEqual(p.video.segs.length, 15); // 15 × 4 s = 60 s
  assert.strictEqual(path.basename(p.video.segs[14].url), 'seg_015.m4s');
  assert.strictEqual(p.audio.init.url.endsWith('/media/a/init.mp4'), true);
});

test('HLS : variante vidéo ≤ 720p (variante audio seule ignorée), TS refusé', () => {
  const m = T.planHlsMaster(fs.readFileSync(path.join(FX, 'steam-hls/hls_264_master.m3u8'), 'utf8'), 'https://v/hls/hls_264_master.m3u8');
  assert.strictEqual(m.videoUrl, 'https://v/hls/stream_0.m3u8');
  assert.strictEqual(m.audioUrl, 'https://v/hls/stream_audio.m3u8');
  assert.throws(() => T.parseMediaPlaylist('#EXTM3U\n#EXTINF:4,\na.ts\n', 'https://v/x.m3u8'), /TS/);
});

for (const [kind, url] of [['dash', 'https://v/dash/dash_h264.mpd?t=1'], ['hls', 'https://v/hls/hls_264_master.m3u8?t=1']]) {
  test(`downloadSegmented ${kind} : MP4 fragmenté init + segments, audio fusionné`, async () => {
    const r = await T.downloadSegmented({ kind, url }, fetchText, fetchBuf, {});
    const t = types(r.buf);
    assert.deepStrictEqual(t.slice(0, 2), ['ftyp', 'moov']);
    assert.ok(t.filter((x) => x === 'moof').length >= 6, 'fragments vidéo + audio');
    assert.ok(!t.includes('styp') && !t.includes('sidx'));
    assert.strictEqual(r.audio, true);
    assert.ok(r.seconds >= 5.9 && r.seconds <= 6.1);
    const moov = T.boxes(r.buf)[1];
    const traks = T.boxes(r.buf, moov.start + 8, moov.end).filter((b) => b.type === 'trak');
    assert.strictEqual(traks.length, 2);
  });
}

test('downloadSegmented : limite de durée et sans audio', async () => {
  const r = await T.downloadSegmented({ kind: 'dash', url: 'https://v/dash/dash_h264.mpd' }, fetchText, fetchBuf, { maxSeconds: 3, noAudio: true });
  assert.strictEqual(r.segments, 2);
  assert.strictEqual(r.audio, false);
});

test('serveFile : Range → 206 et Content-Range ; sans Range → 200', async () => {
  const f = path.join(os.tmpdir(), `rr-fixes-${process.pid}.mp4`);
  fs.writeFileSync(f, Buffer.alloc(1000, 7));
  const req = (range) => ({ headers: new Headers(range ? { range } : {}) });
  const a = serveFile(req('bytes=100-199'), f);
  assert.strictEqual(a.status, 206);
  assert.strictEqual(a.headers.get('content-range'), 'bytes 100-199/1000');
  assert.strictEqual((await a.arrayBuffer()).byteLength, 100);
  const b = serveFile(req('bytes=900-'), f);
  assert.strictEqual((await b.arrayBuffer()).byteLength, 100);
  const c = serveFile(req(), f);
  assert.strictEqual(c.status, 200);
  assert.strictEqual(c.headers.get('accept-ranges'), 'bytes');
  assert.strictEqual(serveFile(req('bytes=5000-'), f).status, 416);
  fs.rmSync(f);
});

test('imageSize : PNG (alpha) et JPEG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-img-'));
  const png = Buffer.alloc(33); png.writeUInt32BE(0x89504e47, 0); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(640, 16); png.writeUInt32BE(360, 20); png[25] = 6;
  fs.writeFileSync(path.join(dir, 'a.png'), png);
  assert.deepStrictEqual(imageSize(path.join(dir, 'a.png')), { w: 640, h: 360, alpha: true });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xa0, 0x00, 0xf0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(dir, 'b.jpg'), jpg);
  assert.deepStrictEqual(imageSize(path.join(dir, 'b.jpg')), { w: 240, h: 160, alpha: false });
  fs.rmSync(dir, { recursive: true });
});

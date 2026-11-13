const test = require('node:test');
const assert = require('node:assert');
// electron n'est requis que dans init() : le module se charge sans lui
const { pickMovieUrls } = require('../src/features/media.js');

test('pickMovieUrls : mp4 480 de la bande-annonce mise en avant en premier', () => {
  const movies = [
    { id: 1, mp4: { 480: 'https://a/1-480.mp4', max: 'https://a/1-max.mp4' } },
    { id: 2, highlight: true, webm: { 480: 'https://a/2-480.webm' }, mp4: { 480: 'https://a/2-480.mp4', max: 'https://a/2-max.mp4' } },
  ];
  const r = pickMovieUrls(movies);
  assert.deepStrictEqual(r.map((x) => x.url), ['https://a/2-480.mp4', 'https://a/2-480.webm', 'https://a/2-max.mp4']);
  assert.strictEqual(r[1].ext, '.webm');
});
test('pickMovieUrls : HLS / DASH seuls → aucune URL ; entrées invalides ignorées', () => {
  assert.deepStrictEqual(pickMovieUrls([{ hls_h264: 'https://x/m.m3u8', dash_av1: 'https://x/m.mpd' }]), []);
  assert.deepStrictEqual(pickMovieUrls(null), []);
  assert.deepStrictEqual(pickMovieUrls([{ mp4: { 480: 'http://insecure/x.mp4' } }]), []);
});
test('pickMovieUrls : passe à la vidéo suivante si la première n’a rien de progressif', () => {
  const r = pickMovieUrls([{ hls_h264: 'x' }, { webm: { max: 'https://b/max.webm' } }]);
  assert.deepStrictEqual(r, [{ url: 'https://b/max.webm', ext: '.webm' }]);
});

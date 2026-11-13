// RR Launcher — CAPTURE : enregistrement d'écran dans une fenêtre cachée.
// getUserMedia (chromeMediaSource 'desktop') → MediaRecorder WebM, morceaux d'1 s envoyés au processus principal.
'use strict';
let recorder = null, stream = null, stopped = false;

function pickMime(audio) {
  const v = ['vp9', 'vp8'];
  for (const c of v) {
    const m = `video/webm;codecs=${c}${audio ? ',opus' : ''}`;
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

async function getStream(o) {
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxFrameRate: o.fps, maxWidth: o.width, maxHeight: o.height } };
  let audioError = null;
  if (o.audio) {
    // Windows : son du système (boucle de sortie) ; ailleurs ou en cas de refus : vidéo seule
    try { return { s: await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video }), audioError }; }
    catch (e) { audioError = e.message || String(e); }
  }
  return { s: await navigator.mediaDevices.getUserMedia({ audio: false, video }), audioError };
}

window.rec.onStart(async (o) => {
  try {
    const { s, audioError } = await getStream(o);
    stream = s;
    const audio = s.getAudioTracks().length > 0;
    const mimeType = pickMime(audio);
    recorder = new MediaRecorder(s, { mimeType, videoBitsPerSecond: o.bitrate, audioBitsPerSecond: audio ? 160000 : undefined });
    recorder.ondataavailable = async (ev) => {
      if (ev.data && ev.data.size) window.rec.chunk(new Uint8Array(await ev.data.arrayBuffer()));
    };
    recorder.onstop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      // laisse passer le dernier ondataavailable (arrayBuffer asynchrone)
      setTimeout(() => window.rec.done({}), 300);
    };
    recorder.onerror = (e) => window.rec.done({ error: e.error?.message || 'erreur MediaRecorder' });
    // la piste vidéo s'arrête (écran débranché…) : fin propre
    s.getVideoTracks()[0]?.addEventListener('ended', () => { if (recorder?.state === 'recording') recorder.stop(); });
    recorder.start(1000);
    window.rec.info({ mime: mimeType, audio, audioError });
    if (stopped) recorder.stop();
  } catch (e) {
    window.rec.done({ error: e.message || String(e) });
  }
});
window.rec.onStop(() => {
  stopped = true;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  // pas encore démarré : onStart s'arrêtera dès le début (le processus principal a aussi un délai de garde)
});

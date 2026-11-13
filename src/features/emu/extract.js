// EMU — extraction annulable (thread). extract(archive, outDir, { signal }) → Promise
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const { run } = require('./extract-core');

function workerFile() {
  return path.join(__dirname, 'extract-worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
function extract(archive, outDir, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(workerFile(), { workerData: { archive, outDir } }); } catch { return run({ archive, outDir }).then(resolve, reject); }
    const abort = () => { w.terminate(); reject(Object.assign(new Error('Annulé'), { name: 'AbortError' })); };
    if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true }); }
    w.once('message', (r) => { signal?.removeEventListener('abort', abort); w.terminate(); r.ok ? resolve(r) : reject(new Error(r.error)); });
    w.once('error', (e) => { signal?.removeEventListener('abort', abort); reject(e); });
  });
}
module.exports = { extract };

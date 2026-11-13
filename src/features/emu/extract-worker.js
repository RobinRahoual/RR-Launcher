// EMU — extraction 7z / zip dans un thread (7-Zip officiel compilé en WASM, paquet npm « 7z-wasm ») :
// pas de binaire à télécharger, même code sous Windows et dans les tests.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { run } = require('./extract-core');
run(workerData).then((r) => parentPort.postMessage(r), (e) => parentPort.postMessage({ ok: false, error: String(e?.message || e) }));

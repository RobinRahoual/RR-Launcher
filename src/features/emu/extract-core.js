// EMU — cœur d'extraction (utilisé dans le thread, ou directement en repli)
'use strict';
const path = require('path');
const fs = require('fs');

async function run({ archive, outDir, test = true }) {
  const SevenZip = require('7z-wasm');
  const log = [];
  const sz = await SevenZip({ print: (l) => log.push(l), printErr: (l) => log.push(l) });
  fs.mkdirSync(outDir, { recursive: true });
  sz.FS.mkdir('/a'); sz.FS.mount(sz.NODEFS, { root: path.dirname(archive) }, '/a');
  sz.FS.mkdir('/o'); sz.FS.mount(sz.NODEFS, { root: outDir }, '/o');
  const arc = '/a/' + path.basename(archive);
  if (test) {
    const t = sz.callMain(['t', arc, '-y']);
    if (t !== 0) return { ok: false, error: 'Archive illisible ou corrompue', log: log.slice(-6) };
  }
  const x = sz.callMain(['x', arc, '-o/o', '-y', '-aoa']);
  if (x !== 0) return { ok: false, error: `Extraction impossible (code ${x})`, log: log.slice(-6) };
  return { ok: true };
}
module.exports = { run };

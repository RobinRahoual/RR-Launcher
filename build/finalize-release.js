// Après signature SignPath : l'installateur a changé, donc son sha512 et sa taille aussi.
// electron-updater refuse la mise à jour si latest.yml ne correspond plus → on le recalcule.
// Usage : node build/finalize-release.js <dossier contenant latest.yml + l'exe signé>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function patchLatest(yml, exeName, sha512, size) {
  let out = yml;
  // bloc « files » : l'entrée de l'exe
  out = out.replace(/(- url: [^\n]*\.exe\n\s+sha512: )[^\n]+(\n\s+size: )\d+(\n\s+blockMapSize: \d+)?/g, (_m, a, b) => `${a}${sha512}${b}${size}`);
  // clés de premier niveau (anciens clients)
  out = out.replace(/^sha512: .*$/m, `sha512: ${sha512}`);
  return out;
}
function sha512Base64(file) { return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'); }

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || 'dist');
  const exe = fs.readdirSync(dir).find((f) => /\.exe$/i.test(f) && !/uninstall/i.test(f));
  if (!exe) { console.error('Aucun .exe dans ' + dir); process.exit(1); }
  const file = path.join(dir, exe), size = fs.statSync(file).size, sha = sha512Base64(file);
  const yml = path.join(dir, 'latest.yml');
  fs.writeFileSync(yml, patchLatest(fs.readFileSync(yml, 'utf8'), exe, sha, size));
  for (const f of fs.readdirSync(dir)) if (/\.blockmap$/i.test(f)) fs.rmSync(path.join(dir, f)); // obsolète après signature
  console.log(`latest.yml mis à jour : ${exe} (${size} octets)`);
}
module.exports = { patchLatest, sha512Base64 };

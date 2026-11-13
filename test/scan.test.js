// Scan : seules les vraies ROMs (signature) et les vrais jeux (indices de moteur) sont proposés.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { scanFolders } = require('../src/scanner');
const { checkRom } = require('../src/romcheck');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrscan-'));
const w = (p, b) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), b); };
const md = Buffer.alloc(256 * 1024); md.write('SEGA', 0x100);
w('Docs/README.md', Buffer.from('# Bonjour\n'.repeat(5000)));
w('ROMs/Mega Drive/Sonic.md', md);
w('ROMs/Doom/doom.wad', Buffer.concat([Buffer.from('IWAD'), Buffer.alloc(100000)]));
w('ROMs/NES/Mario.nes', Buffer.concat([Buffer.from('NES\x1a', 'latin1'), Buffer.alloc(40000)]));
w('ROMs/NES/faux.nes', Buffer.alloc(40000));
w('Jeux/Hades/Hades.exe', Buffer.alloc(400 * 1024)); w('Jeux/Hades/steam_api64.dll', 'x');
w('Jeux/Outil/Outil.exe', Buffer.alloc(400 * 1024));
w('Logiciels/Blender Foundation/Blender/blender.exe', Buffer.alloc(400 * 1024));
w('Logiciels/App/App.exe', Buffer.alloc(400 * 1024)); w('Logiciels/App/libcef.dll', 'x');

test('scan : ROMs vérifiées par signature, jeux par indices', async () => {
  const r = await scanFolders([root]);
  const names = r.items.map((i) => `${i.platform}:${i.name}${i.uncertain ? '?' : ''}`).sort();
  assert.deepStrictEqual(names, ['md:Sonic', 'nes:Mario', 'pc:Hades', 'pc:Outil?']);
});

test('checkRom : extensions trompeuses', async () => {
  assert.strictEqual(await checkRom(path.join(root, 'Docs/README.md'), 'md'), null);
  assert.strictEqual(await checkRom(path.join(root, 'ROMs/Doom/doom.wad'), 'wad'), null);
  assert.strictEqual(await checkRom(path.join(root, 'ROMs/Mega Drive/Sonic.md'), 'md'), 'md');
});

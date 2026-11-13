const d = require('../src/features/discord.js');
const assert = require('assert');
require('node:test')('discord : trames, raccourci, activité', () => {
assert.deepStrictEqual(d.parseCombo('Ctrl+Shift+F9'), [0x11, 0x10, 0x78]);
assert.strictEqual(d.parseCombo('Ctrl+Bidule'), null);
let got = [];
const dec = d.decoder((op, data) => got.push([op, data]));
const f = d.encode(1, { a: 1 }); dec(f.subarray(0, 5)); dec(f.subarray(5));
assert.deepStrictEqual(got, [[1, { a: 1 }]]);
const a = d.activityFor({ name: 'Zelda', appid: 0 }, { name: 'Game Boy Advance' }, 1700000000000, {});
assert.strictEqual(a.details, 'Zelda'); assert.strictEqual(a.state, 'sur Game Boy Advance'); assert.strictEqual(a.timestamps.start, 1700000000);
});

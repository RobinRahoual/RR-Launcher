'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/features/profiles');

const lib = () => ({
  games: [
    { id: 'a', name: 'A', favorite: true, playtime: 3600, lastPlayed: 100, playCount: 3, status: 'done', rating: 4, collections: ['RPG'] },
    { id: 'b', name: 'B', favorite: false, playtime: 0, lastPlayed: 0, playCount: 0 },
  ],
  settings: { theme: 'dark', collections: ['RPG'], steamId64: '111', raUser: 'robin', sounds: true },
  extras: { ach: { a: { unlocked: 5 } }, ra: {} },
});

test('migration : un utilisateur existant = profil principal, données intactes', () => {
  const d = lib();
  const before = JSON.stringify(d.games);
  const st = P.ensure(d);
  assert.equal(st.list.length, 1);
  assert.equal(st.list[0].id, 'main');
  assert.equal(st.current, 'main');
  assert.equal(JSON.stringify(d.games), before);
  P.ensure(d); // idempotent
  assert.equal(d.profiles.list.length, 1);
});

test('nouveau profil : données vierges, principal rangé puis restauré à l’identique', () => {
  const d = lib();
  const ref = JSON.parse(JSON.stringify(d));
  const r = P.saveProfile(d, { name: '  Léa ' });
  assert.ok(r.ok);
  assert.equal(P.saveProfile(d, { name: 'léa' }).ok, false); // nom déjà pris
  assert.ok(P.switchTo(d, r.id));
  const a = d.games[0];
  assert.deepEqual([a.favorite, a.playtime, a.lastPlayed, a.playCount, a.status, a.rating, a.collections], [false, 0, 0, 0, undefined, undefined, undefined]);
  assert.equal(a.pp.main.playtime, 3600);
  assert.deepEqual(d.settings.collections, []); // collections propres au profil
  assert.equal(d.settings.theme, 'dark'); // hérité du principal
  assert.equal(d.settings.steamId64, '111');
  assert.equal(P.totalPlaytime(a), 3600);
  // le profil joue et met en favori
  a.favorite = true; d.games[1].favorite = true; a.playtime += 60; d.settings.theme = 'light';
  assert.ok(P.switchTo(d, 'main'));
  assert.deepEqual(d.games, ref.games.map((g, i) => (i === 0 ? { ...g, pp: { [r.id]: { favorite: true, playtime: 60 } } } : { ...g, pp: { [r.id]: { favorite: true } } })));
  assert.equal(d.settings.theme, 'dark');
  assert.equal(P.totalPlaytime(d.games[0]), 3660);
  // retour sur le profil : ses réglages propres reviennent
  P.switchTo(d, r.id);
  assert.equal(d.settings.theme, 'light');
  assert.equal(d.games[1].favorite, true);
  assert.equal(d.games[0].playtime, 60);
});

test('identifiants propres : succès rangés par compte', () => {
  const d = lib();
  const { id } = P.saveProfile(d, { name: 'Sam' });
  P.switchTo(d, id);
  assert.deepEqual(d.extras.ach, { a: { unlocked: 5 } }); // même compte (hérité) : succès partagés
  d.settings.steamId64 = '222'; d.extras.ach = { a: { unlocked: 1 } };
  P.switchTo(d, 'main');
  assert.equal(d.settings.steamId64, '111');
  assert.deepEqual(d.extras.ach, {}); // cache partagé réécrit par l'autre compte : il sera re-téléchargé
  d.extras.ach = { a: { unlocked: 5 } };
  P.switchTo(d, id);
  assert.equal(d.settings.steamId64, '222');
  assert.deepEqual(d.extras.ach, { a: { unlocked: 1 } });
  P.switchTo(d, 'main');
  assert.deepEqual(d.extras.ach, { a: { unlocked: 5 } });
});

test('finishSession par profil : le temps ajouté va au profil actif', () => {
  const d = lib();
  const { id } = P.saveProfile(d, { name: 'Max' });
  P.switchTo(d, id);
  const g = d.games[0];
  // ce que font launchGame / finishSession dans main.js
  g.lastPlayed = 999; g.playCount = (g.playCount || 0) + 1; g.playtime = (g.playtime || 0) + 120;
  P.switchTo(d, 'main');
  assert.equal(g.playtime, 3600);
  assert.equal(g.lastPlayed, 100);
  assert.deepEqual(g.pp[id], { playtime: 120, lastPlayed: 999, playCount: 1 });
  assert.equal(P.totalPlaytime(g), 3720);
});

test('suppression : principal protégé, données du profil effacées', () => {
  const d = lib();
  const { id } = P.saveProfile(d, { name: 'Zoé' });
  P.switchTo(d, id); d.games[0].favorite = true;
  assert.equal(P.removeProfile(d, 'main'), false);
  assert.ok(P.removeProfile(d, id));
  assert.equal(d.profiles.current, 'main');
  assert.equal(d.games[0].pp, undefined);
  assert.equal(d.games[0].playtime, 3600);
  assert.equal(d.profiles.list.length, 1);
});

test('sessions : filtre par profil (sans champ = principal)', () => {
  const s = [{ id: 'a', seconds: 60 }, { id: 'a', seconds: 30, profile: 'x' }, { id: 'b', seconds: 10, profile: 'main' }];
  assert.equal(P.filterSessions(s, 'main').length, 2);
  assert.equal(P.filterSessions(s, 'x').length, 1);
  assert.equal(P.filterSessions(s, null).length, 3);
});

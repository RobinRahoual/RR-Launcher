// Module SMART (renderer) — collections intelligentes : onglets dynamiques sur l'écran des jeux + éditeur dans les réglages.
// Règles : features/smart-rules.js (RRSmart). Côté main : src/features/smart.js (canaux x:smart:*).
(() => {
  'use strict';
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { return fn(orig, ...a); }; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const R = window.RRSmart;
  let ST = { presets: R.PRESETS, on: R.DEFAULT_ON, custom: [] };
  const colls = () => [...R.PRESETS.filter((p) => ST.on.includes(p.id)), ...ST.custom.filter((c) => c.tab !== false)];
  const byTab = (id) => colls().find((c) => 'sc:' + c.id === id);
  const STATUS_LABEL = { none: 'Sans statut', todo: 'À jouer', playing: 'En cours', done: 'Terminé', complete: '100 %', dropped: 'Abandonné' };
  const enumLabel = (f, v) => (f === 'status' ? STATUS_LABEL[v] || v : f === 'platform' ? (S.P?.[v]?.name || v) : v);

  // ---------------------------------------------------------------- Onglets
  wrap('computeTabs', (orig) => {
    const want = S.tab;
    orig();
    const g = inPlat(S.lib.games);
    const extra = [];
    for (const c of colls()) { const n = R.filter(g, c).length; if (n) extra.push({ id: 'sc:' + c.id, label: c.name, n }); }
    if (extra.length) {
      let at = S.tabs.findIndex((t) => t.id === 'recent');
      if (at < 0) at = S.tabs.findIndex((t) => t.id === 'fav');
      if (at < 0) at = 0;
      // après les onglets de la bibliothèque (Backlog, statuts, collections manuelles)
      while (S.tabs[at + 1] && /^(lb|ls:|lc:)/.test(S.tabs[at + 1].id)) at++;
      S.tabs.splice(at + 1, 0, ...extra);
    }
    if (S.tab === 'all' && want !== 'all' && S.tabs.some((t) => t.id === want)) S.tab = want;
  });
  wrap('computeItems', (orig) => {
    orig();
    const c = byTab(S.tab);
    if (c) S.items = sorted(R.filter(inPlat(S.lib.games), c));
  });
  const refreshTabs = () => { if (typeof refresh === 'function' && S.lib) refresh(); }; // recalcule onglets et liste en gardant la sélection

  // ---------------------------------------------------------------- Réglages
  const box = document.createElement('div');
  box.id = 'set-smart';
  $('#set-v119').append(box);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  let draft = null; // collection en cours d'édition

  function ruleRow(r, i) {
    const def = R.FIELDS[r.f] || R.FIELDS.playtimeH;
    const ops = def.ops.map((o) => opt(o, R.OPS[o], r.op)).join('');
    let val;
    if (def.type === 'bool') val = `<select data-sm="v" data-i="${i}">${opt('true', 'oui', String(r.v))}${opt('false', 'non', String(r.v))}</select>`;
    else if (r.f === 'status') val = `<select data-sm="v" data-i="${i}">${R.STATUSES.map((s) => opt(s, STATUS_LABEL[s], r.v)).join('')}</select>`;
    else if (r.f === 'platform') val = `<select data-sm="v" data-i="${i}">${Object.keys(S.P || {}).map((p) => opt(p, S.P[p].name, r.v)).join('')}</select>`;
    else val = `<input data-sm="v" data-i="${i}" value="${esc(r.v)}" ${def.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(def.unit || '')}" spellcheck="false" data-nav />`;
    return `<div class="sm-rule"><select data-sm="f" data-i="${i}" data-nav>${Object.entries(R.FIELDS).map(([k, d]) => opt(k, d.label, r.f)).join('')}</select><select data-sm="op" data-i="${i}" data-nav>${ops}</select>${val}<button class="btn small" data-sm="del" data-i="${i}" data-nav aria-label="Retirer la règle">✕</button></div>`;
  }
  function render() {
    const list = [
      ...R.PRESETS.map((p) => `<div class="setting"><div><strong>${esc(p.name)}</strong><span class="dim">${esc(p.rules.map((r) => R.describe(r, enumLabel)).join(p.match === 'any' ? ' ou ' : ' et '))}</span></div><button class="toggle" data-sm="preset" data-id="${p.id}" role="switch" aria-checked="${ST.on.includes(p.id)}" aria-label="Onglet ${esc(p.name)}" data-nav></button></div>`),
      ...ST.custom.map((c) => `<div class="setting"><div><strong>${esc(c.name)}</strong><span class="dim">${esc(c.rules.map((r) => R.describe(r, enumLabel)).join(c.match === 'any' ? ' ou ' : ' et '))}</span></div><div class="v119-row"><button class="btn small" data-sm="edit" data-id="${c.id}" data-nav>Modifier</button><button class="btn small" data-sm="remove" data-id="${c.id}" data-nav>Supprimer</button></div></div>`),
    ].join('');
    const editor = draft ? `
      <div class="setting col"><div><label for="smName"><strong>${draft.id ? 'Modifier' : 'Nouvelle'} collection intelligente</strong></label><span class="dim">Les jeux y entrent et en sortent tout seuls selon ces règles.</span></div>
        <input id="smName" value="${esc(draft.name)}" placeholder="Nom (ex. RPG à finir)" maxlength="40" spellcheck="false" data-nav />
        <div class="v119-row"><span class="dim">Un jeu doit respecter</span><select data-sm="match" data-nav>${opt('all', 'toutes les règles', draft.match)}${opt('any', 'au moins une règle', draft.match)}</select></div>
        ${draft.rules.map(ruleRow).join('')}
        <div class="v119-row"><button class="btn small" data-sm="addrule" data-nav>+ Règle</button><label class="dim"><input type="checkbox" data-sm="tab" ${draft.tab !== false ? 'checked' : ''} data-nav /> Afficher en onglet</label><button class="btn accent" data-sm="save" data-nav>Enregistrer</button><button class="btn" data-sm="cancel" data-nav>Annuler</button></div>
      </div>` : `<div class="setting"><div><strong>Ta propre collection</strong><span class="dim">Combine temps de jeu, statut, genre, console, note, année…</span></div><button class="btn" data-sm="new" data-nav>Créer…</button></div>`;
    box.innerHTML = `<h3 class="set-group">Collections intelligentes</h3>${list}${editor}`;
  }
  const apply = (st) => { if (st) { ST = { presets: R.PRESETS, on: st.on, custom: st.custom }; refreshTabs(); } };
  const readDraft = () => {
    if (!draft) return;
    const n = $('#smName', box); if (n) draft.name = n.value;
  };
  box.addEventListener('change', (e) => {
    const t = e.target.closest('[data-sm]');
    if (!t || !draft) return;
    const k = t.dataset.sm, i = Number(t.dataset.i);
    readDraft();
    if (k === 'match') draft.match = t.value;
    else if (k === 'tab') draft.tab = t.checked;
    else if (k === 'f') { const def = R.FIELDS[t.value]; draft.rules[i] = { f: t.value, op: def.ops[0], v: def.type === 'bool' ? true : def.type === 'enum' ? (t.value === 'status' ? 'todo' : Object.keys(S.P || {})[0] || 'pc') : '' }; render(); }
    else if (k === 'op') draft.rules[i].op = t.value;
    else if (k === 'v') draft.rules[i].v = R.FIELDS[draft.rules[i].f].type === 'bool' ? t.value === 'true' : t.value;
  });
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sm]');
    if (!t) return;
    const k = t.dataset.sm;
    readDraft();
    if (k === 'preset') { apply(await rr.x('x:smart:preset', t.dataset.id, t.getAttribute('aria-checked') !== 'true')); render(); sfx('toggle'); }
    else if (k === 'new') { draft = { name: '', match: 'all', tab: true, rules: [{ f: 'playtimeH', op: 'lt', v: 2 }] }; render(); }
    else if (k === 'edit') { draft = JSON.parse(JSON.stringify(ST.custom.find((c) => c.id === t.dataset.id))); render(); }
    else if (k === 'remove') { apply(await rr.x('x:smart:delete', t.dataset.id)); render(); toast('Collection supprimée', 'success'); }
    else if (k === 'addrule') { draft.rules.push({ f: 'genre', op: 'has', v: '' }); render(); }
    else if (k === 'del') { draft.rules.splice(Number(t.dataset.i), 1); render(); }
    else if (k === 'cancel') { draft = null; render(); }
    else if (k === 'save') {
      const r = await rr.x('x:smart:save', draft);
      if (!r.ok) return toast(r.error, true);
      draft = null; apply(r); render(); toast('Collection enregistrée', 'success');
    }
  });
  rr.x('x:smart:get').then((st) => { apply(st); render(); });
})();

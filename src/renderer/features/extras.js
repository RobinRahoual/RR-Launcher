/* Module EXTRAS — succès / trophées (Steam, RetroAchievements) et état des mises à jour Steam / Epic.
   Points d'accroche : RR ('mode', 'library', 'selection', 'view'), MutationObserver sur #dTitle (page du jeu)
   et #capBadges (bloc d'infos), attribut data-update sur les .slot (badge de boîte en CSS), OVERLAYS.xach.
   Côté main : src/features/extras.js (canaux x:extras:*). */
(() => {
  const X = { sum: {}, upd: {}, cur: null, curId: null };
  const IC = {
    trophy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    down: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    pause: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
    lock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    link: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    gear: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const pct = (n) => (n == null ? '' : (n < 10 && n % 1 ? n.toFixed(1).replace('.', ',') : Math.round(n)) + ' %');
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const curGame = () => S.items[S.sel] || S.lib.games.find((x) => x.id === S.selId) || null;
  const updIcon = (u) => (u.state === 'paused' ? IC.pause : IC.down);
  const srcName = (k) => (k === 'steam' ? 'Steam' : 'RetroAchievements');

  // ================================================================ Page du jeu : jauge
  const gauge = document.createElement('div');
  gauge.className = 'x-ach';
  gauge.id = 'xAch';
  gauge.hidden = true;
  $('#dStats').after(gauge);

  function renderGauge() {
    const g = curGame();
    if (!g || S.mode === 'main') return;
    const r = X.curId === g.id ? X.cur : null;
    const u = X.upd[g.id];
    const parts = [];
    if (u) parts.push(`<span class="x-upd-pill" data-state="${esc(u.state)}">${updIcon(u)}${esc(u.label)}</span>`);
    if (r && r.kind) {
      const d = r.data;
      if (!r.configured) {
        parts.push(`<span class="x-ach-msg">${IC.trophy}<span>Succès ${esc(srcName(r.kind))} : ajoute ton compte dans les réglages</span></span>
          <button class="btn small" data-xach="settings" data-nav>${IC.gear}Configurer</button>`);
      } else if (d && d.total) {
        parts.push(`<div class="x-ach-main">
            <span class="x-ach-ico">${IC.trophy}</span>
            <div class="x-ach-txt"><b>Succès ${d.unlocked}/${d.total} <span class="x-ach-pct">(${d.pct} %)</span></b>
              <span class="x-ach-bar" role="progressbar" aria-label="Succès débloqués" aria-valuemin="0" aria-valuemax="${d.total}" aria-valuenow="${d.unlocked}"><i style="width:${d.pct}%"></i></span>
              ${d.error ? `<span class="x-ach-err">${esc(d.error)}</span>` : ''}</div>
          </div>
          <button class="btn small" data-xach="list" data-nav>Voir les succès</button>`);
      } else if (r.loading || (!d && r.kind !== 'ra-manual')) {
        parts.push(`<span class="x-ach-msg">${IC.trophy}<span>Succès : synchronisation…</span></span>`);
      } else if (d && d.error) {
        parts.push(`<span class="x-ach-msg is-err">${IC.trophy}<span>${esc(d.error)}</span></span>`);
      } else if (r.kind !== 'steam' && (!d || d.none)) {
        parts.push(`<span class="x-ach-msg">${IC.trophy}<span>${r.raId ? 'Aucun succès RetroAchievements pour ce jeu' : 'Jeu non reconnu par RetroAchievements'}</span></span>
          <button class="btn small" data-xach="link" data-nav>${IC.link}Associer un ID</button>`);
      } else if (d && d.none) {
        parts.push(`<span class="x-ach-msg">${IC.trophy}<span>Pas de succès Steam pour ce jeu</span></span>`);
      }
    }
    gauge.innerHTML = parts.join('');
    gauge.hidden = !parts.length;
  }
  async function loadDetails() {
    const g = curGame();
    if (!g) return;
    if (X.curId !== g.id) { X.curId = g.id; X.cur = null; }
    renderGauge();
    const r = await rr.x('x:extras:get', g.id).catch(() => null);
    if (r && X.curId === g.id) { X.cur = r; renderGauge(); }
  }
  gauge.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xach]');
    if (!b) return;
    const a = b.dataset.xach;
    if (a === 'list') openList();
    if (a === 'settings') { openOverlay('settings'); setSettingsPage('more'); setTimeout(() => $('#set-extras')?.scrollIntoView({ block: 'start' }), 60); }
    if (a === 'link') askRaId();
  });
  // renderDetails réécrit le titre à chaque rendu → on suit
  new MutationObserver(() => { if (S.mode === 'details' || S.stack.includes('details')) { const g = curGame(); if (g && g.id !== X.curId) loadDetails(); else renderGauge(); } })
    .observe($('#dTitle'), { childList: true, characterData: true, subtree: true });
  RR.on('mode', (m) => {
    if (m === 'details') loadDetails();
    if (m === 'settings') fillSettings();
  });

  function askRaId() {
    const g = curGame();
    if (!g) return;
    openPrompt({
      title: 'Associer à RetroAchievements',
      icon: null,
      body: `<p class="dim">Pour les jeux sur disque (PS1, PS2, PSP, Dreamcast…) ou une ROM non reconnue : ouvre la page du jeu sur retroachievements.org et recopie le nombre à la fin de l’adresse (…/game/<b>1446</b>). Laisse vide pour revenir à la détection automatique.</p>
        <input id="xRaId" class="x-input" type="text" inputmode="numeric" placeholder="ID du jeu RetroAchievements" value="${X.cur?.manual ? esc(String(X.cur.raId)) : ''}" data-nav spellcheck="false" />`,
      actions: [
        { label: 'Annuler', onClick: () => closeOverlay() },
        { label: 'Associer', primary: true, onClick: async () => {
          const v = ($('#xRaId')?.value || '').trim();
          if (v && !/^\d+$/.test(v)) { toast('L’ID doit être un nombre', 'error'); return; }
          closeOverlay();
          toast('Synchronisation des succès…', 'progress');
          const r = await rr.x('x:extras:setRaGame', g.id, v ? Number(v) : 0).catch(() => null);
          if (r && X.curId === g.id) { X.cur = r; renderGauge(); }
        } },
      ],
    });
  }

  // ================================================================ Overlay : liste des succès
  const ov = document.createElement('div');
  ov.className = 'overlay center';
  ov.id = 'xAchList';
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', 'xAchTitle');
  ov.innerHTML = '<div class="panel wide x-ach-panel"></div>';
  document.body.append(ov);
  OVERLAYS.xach = '#xAchList';
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });

  function renderList() {
    const g = curGame();
    const r = X.cur;
    const d = r?.data;
    if (!g || !d) return;
    const panel = $('.x-ach-panel', ov);
    const keep = document.activeElement?.dataset?.xid;
    const rows = d.list.map((a, i) => {
      const date = a.unlocked ? (a.unlockedAt ? `Débloqué le ${fmtDate(a.unlockedAt)}` : 'Débloqué') : 'Verrouillé';
      const rare = a.rarity != null ? `<span class="x-rare${a.rarity < 10 ? ' is-rare' : ''}">${esc(pct(a.rarity))} des joueurs</span>` : '';
      const pts = a.points ? `<span class="x-pts">${a.points} pts</span>` : '';
      const icon = a.masked || !a.src ? `<span class="x-icon x-icon-none">${a.masked ? IC.lock : IC.trophy}</span>` : `<img class="x-icon" src="${esc(a.src)}" alt="" loading="lazy" />`;
      return `<div class="x-row${a.unlocked ? ' is-on' : ''}${a.masked ? ' is-masked' : ''}" data-nav tabindex="-1" data-xid="${esc(a.id)}" ${i === 0 ? 'data-default' : ''}>
        ${icon}
        <div class="x-row-txt"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>
        <div class="x-row-meta"><span class="x-date">${a.unlocked ? '' : IC.lock}${esc(date)}</span>${rare}${pts}</div>
      </div>`;
    }).join('');
    const pts = d.source === 'ra' && d.points ? ` · ${d.pointsEarned}/${d.points} points` : '';
    panel.innerHTML = `
      <div class="x-head">
        <span class="x-head-ico">${IC.trophy}</span>
        <div class="x-head-txt">
          <h2 id="xAchTitle">Succès</h2>
          <p class="dim">${esc(g.name)} · ${esc(srcName(d.source))}${pts}</p>
        </div>
        <div class="x-head-sum"><b>${d.unlocked}/${d.total}</b><span>${d.pct} %</span></div>
      </div>
      <span class="x-ach-bar big" aria-hidden="true"><i style="width:${d.pct}%"></i></span>
      ${d.error ? `<p class="x-ach-err">${esc(d.error)} — données de la dernière synchronisation.</p>` : ''}
      <div class="x-list" role="list">${rows}</div>
      ${d.source === 'ra' ? `<div class="x-foot"><button class="btn small" data-xach-ov="link" data-nav>${IC.link}Changer l’ID RetroAchievements</button></div>` : ''}`;
    if (keep && S.mode === 'xach') { const el = $(`[data-xid="${CSS.escape(keep)}"]`, panel); if (el) setFocus(el); }
  }
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-xach-ov="link"]')) { closeOverlay(true); askRaId(); } });
  function openList() {
    if (!X.cur?.data?.total) return;
    renderList();
    openOverlay('xach');
  }

  // ================================================================ Écran jeux : badges du bloc d'infos
  function capBadges() {
    const box = $('#capBadges');
    if (!box || S.view !== 'games') return;
    const g = S.items[S.sel];
    const want = [];
    const u = g && X.upd[g.id];
    if (u) want.push(`<span class="badge x-upd" data-state="${esc(u.state)}">${updIcon(u)}${esc(u.label)}</span>`);
    const s = g && X.sum[g.id];
    if (s) want.push(`<span class="badge x-trophy" title="Succès ${s.unlocked}/${s.total}">${IC.trophy}${s.pct} %</span>`);
    const sig = (g?.id || '') + want.join('');
    const have = $$('.x-trophy, .x-upd', box);
    if (box._xsig === sig && have.length === want.length) return;
    have.forEach((el) => el.remove());
    box._xsig = sig;
    if (want.length) box.insertAdjacentHTML('beforeend', want.join(''));
  }
  new MutationObserver(() => capBadges()).observe($('#capBadges'), { childList: true });
  RR.on('selection', () => capBadges());

  // ================================================================ Boîtes : attribut data-update sur les .slot
  // Libellé court sur la boîte (le libellé complet est dans le bloc d'infos)
  const boxLabel = (u) => (u.state === 'downloading' ? (u.pct != null ? `Téléch. ${u.pct}\u202f%` : 'Mise à jour…')
    : u.state === 'paused' ? 'En pause' : u.state === 'validate' ? 'Vérification' : 'Mise à jour');
  function applySlots() {
    for (const [id, el] of slots) {
      const u = X.upd[id];
      if (u) {
        if (el.dataset.update !== u.state) el.dataset.update = u.state;
        const lbl = JSON.stringify(boxLabel(u));
        if (el.style.getPropertyValue('--x-upd') !== lbl) el.style.setProperty('--x-upd', lbl);
      } else if (el.dataset.update) { delete el.dataset.update; el.style.removeProperty('--x-upd'); }
    }
  }
  RR.on('library', () => { applySlots(); capBadges(); });
  RR.on('view', () => { applySlots(); capBadges(); });

  // ================================================================ Sondage des mises à jour (disque, toutes les 2 min si visible)
  let visible = true;
  async function pollUpd() {
    if (!visible || document.hidden) return;
    const u = (S.lib.settings.extrasUpdates === false) ? {} : await rr.x('x:extras:updates').catch(() => null);
    if (!u) return;
    X.upd = u;
    applySlots(); capBadges();
    if (S.mode === 'details') renderGauge();
  }
  setInterval(pollUpd, 120000);
  rr.onVisible((v) => { visible = !!v; if (v) pollUpd(); });
  let lastUpdSetting = S.lib.settings?.extrasUpdates;
  RR.on('library', (st) => { const v = st?.settings?.extrasUpdates; if (v !== lastUpdSetting) { lastUpdSetting = v; pollUpd(); } });
  setInterval(applySlots, 3000); // nouvelles boîtes créées (changement d'onglet…)

  // ================================================================ Évènements du main
  rr.onX('x:extras:summary', (s) => { X.sum = s || {}; capBadges(); });
  rr.onX('x:extras:ach', (r) => {
    if (!r || r.id !== X.curId) return;
    X.cur = r;
    renderGauge();
    if (S.mode === 'xach') renderList();
  });
  rr.onX('x:extras:unlocked', (p) => onUnlocked(p));
  function onUnlocked({ name, items } = {}) {
    if (!items?.length) return;
    items.slice(0, 3).forEach((a, i) => setTimeout(() => toast(`Succès débloqué : ${a.name}${a.rarity != null && a.rarity < 10 ? ` (rare, ${pct(a.rarity)})` : ''}`, 'success'), i * 500));
    if (items.length > 3) setTimeout(() => toast(`${name} : ${items.length - 3} autre${items.length > 4 ? 's' : ''} succès débloqué${items.length > 4 ? 's' : ''}`, 'success'), 1600);
    sfx('confirm');
  }

  // ================================================================ Réglages (#set-extras)
  const set = $('#set-extras');
  if (set) {
    set.innerHTML = `
      <h3 class="set-group">Succès Steam</h3>
      <div class="setting col">
        <div><label for="xSteamKey"><strong>Clé API Steam Web</strong></label>
          <span class="dim">Gratuite, liée à ton compte Steam (nom de domaine : mets « localhost »).
            <a href="#" data-link="https://steamcommunity.com/dev/apikey">Obtenir une clé</a></span></div>
        <input id="xSteamKey" type="password" placeholder="Colle ta clé ici" autocomplete="off" spellcheck="false" data-nav />
      </div>
      <div class="setting col">
        <div><label for="xSteamId"><strong>Ton profil Steam</strong></label>
          <span class="dim">SteamID64 (7656119…) ou adresse de ton profil. Ton profil et « Détails des jeux » doivent être <b>publics</b> :
            Steam → Profil → Modifier le profil → Paramètres de confidentialité.</span></div>
        <div class="x-set-row">
          <input id="xSteamId" type="text" placeholder="7656119… ou https://steamcommunity.com/id/…" autocomplete="off" spellcheck="false" data-nav />
          <button class="btn small" id="xSteamDetect" data-nav>Détecter</button>
          <button class="btn small" id="xSteamTest" data-nav>Tester</button>
        </div>
        <span class="x-set-status" id="xSteamStatus" role="status"></span>
      </div>
      <h3 class="set-group">RetroAchievements (ROMs)</h3>
      <div class="setting col">
        <div><strong>Compte RetroAchievements</strong>
          <span class="dim">Nom d’utilisateur et clé API web (retroachievements.org → Paramètres → Clé API web).
            <a href="#" data-link="https://retroachievements.org/settings">Ouvrir mes paramètres</a>
            Jeux reconnus automatiquement : NES, SNES, N64, Game Boy / Color / Advance, Mega Drive. Autres consoles : « Associer un ID » sur la page du jeu.</span></div>
        <div class="x-set-row">
          <input id="xRaUser" type="text" placeholder="Nom d’utilisateur" aria-label="Nom d’utilisateur RetroAchievements" autocomplete="off" spellcheck="false" data-nav />
          <input id="xRaKey" type="password" placeholder="Clé API web" aria-label="Clé API web RetroAchievements" autocomplete="off" spellcheck="false" data-nav />
          <button class="btn small" id="xRaTest" data-nav>Tester</button>
        </div>
        <span class="x-set-status" id="xRaStatus" role="status"></span>
      </div>
      <h3 class="set-group">Mises à jour</h3>
      <div class="setting">
        <div><strong id="lbXUpd">Afficher l’état des mises à jour</strong><span class="dim">Steam et Epic Games : « Mise à jour disponible », progression du téléchargement, pause. Lu sur le disque, sans connexion.</span></div>
        <button class="toggle" data-toggle="extrasUpdates" role="switch" aria-labelledby="lbXUpd" data-nav></button>
      </div>`;
    const status = (id, msg, tone = '') => { const el = $(id); el.textContent = msg; el.dataset.tone = tone; };
    const save = async (patch, msg) => { await rr.setSettings(patch); if (msg) toast(msg, 'success'); };
    $('#xSteamKey').addEventListener('change', (e) => save({ steamApiKey: e.target.value.trim() }, e.target.value.trim() ? 'Clé Steam enregistrée' : 'Clé Steam retirée'));
    $('#xRaUser').addEventListener('change', (e) => save({ raUser: e.target.value.trim() }));
    $('#xRaKey').addEventListener('change', (e) => save({ raKey: e.target.value.trim() }, e.target.value.trim() ? 'Clé RetroAchievements enregistrée' : 'Clé RetroAchievements retirée'));
    const setSteamId = async (v) => {
      const r = await rr.x('x:extras:setSteamId', v).catch((e) => ({ ok: false, error: e.message }));
      if (r.ok) status('#xSteamStatus', r.steamId64 ? `SteamID64 : ${r.steamId64}` : '', 'ok');
      else status('#xSteamStatus', r.error, 'err');
      return r;
    };
    $('#xSteamId').addEventListener('change', (e) => setSteamId(e.target.value));
    $('#xSteamDetect').addEventListener('click', async () => {
      const r = await rr.x('x:extras:detectSteam').catch(() => null);
      if (!r?.ok) { status('#xSteamStatus', 'Aucun compte trouvé dans Steam (config/loginusers.vdf). Colle l’adresse de ton profil.', 'err'); return; }
      const u = r.users[0];
      $('#xSteamId').value = u.steamId;
      await setSteamId(u.steamId);
      status('#xSteamStatus', `Compte détecté : ${u.name || u.steamId}${r.users.length > 1 ? ` (dernier connecté sur ${r.users.length})` : ''}`, 'ok');
    });
    $('#xSteamTest').addEventListener('click', async () => {
      status('#xSteamStatus', 'Test en cours…');
      const v = $('#xSteamId').value.trim();
      if (v && v !== S.lib.settings.steamId) await setSteamId(v);
      const r = await rr.x('x:extras:testSteam').catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) status('#xSteamStatus', r.error || 'Échec', 'err');
      else status('#xSteamStatus', `Connecté : ${r.name}${r.public ? ' · profil public' : ' · profil PRIVÉ : les succès ne seront pas lisibles'}`, r.public ? 'ok' : 'err');
    });
    $('#xRaTest').addEventListener('click', async () => {
      status('#xRaStatus', 'Test en cours…');
      await rr.setSettings({ raUser: $('#xRaUser').value.trim(), raKey: $('#xRaKey').value.trim() });
      const r = await rr.x('x:extras:testRA').catch((e) => ({ ok: false, error: e.message }));
      status('#xRaStatus', r.ok ? `Connecté : ${r.name} · ${r.points} points` : r.error || 'Échec', r.ok ? 'ok' : 'err');
    });
  }
  function fillSettings() {
    const s = S.lib.settings || {};
    const fill = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v || ''; };
    fill('#xSteamKey', s.steamApiKey); fill('#xSteamId', s.steamId || s.steamId64); fill('#xRaUser', s.raUser); fill('#xRaKey', s.raKey);
    const st = $('#xSteamStatus');
    if (st && !st.textContent && s.steamId64) { st.textContent = `SteamID64 : ${s.steamId64}`; st.dataset.tone = 'ok'; }
  }

  // ================================================================ Démarrage
  rr.x('x:extras:summary').then((s) => { X.sum = s || {}; capBadges(); }).catch(() => {});
  setTimeout(pollUpd, 1500);
  // Banc de test / débogage : window.RRExtras.inject({ sum, upd, cur })
  window.RRExtras = { X, onUnlocked, inject(o = {}) { Object.assign(X, o); applySlots(); capBadges(); renderGauge(); if (S.mode === 'xach') renderList(); }, openList, renderGauge };
})();

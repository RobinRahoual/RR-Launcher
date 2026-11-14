/* Module FRIENDS — écran « Amis » façon console (PS5 Game Base / Xbox Amis) : qui joue à quoi sur Discord et Steam.
   Main : src/features/friends.js (x:friends:*). Accroches : OVERLAYS.friends, RR.actions.friends, icône .sys-btn
   (compteur « en jeu »), entrée du menu, touche A (clavier, écran principal), réglages #set-friends.
   Deux surcharges locales : renderHints() (aides X / Y dans l'écran Amis) et onPadBtn via RR.on('input'). */
(() => {
  'use strict';
  const SV = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
    discord: '<path d="M8.5 5.5 7.6 4a14 14 0 0 0-3.9 1.3C1.4 8.8.9 12.2 1.1 15.6a14 14 0 0 0 4.4 2.2l1-1.5M15.5 5.5l.9-1.5a14 14 0 0 1 3.9 1.3c2.3 3.5 2.8 6.9 2.6 10.3a14 14 0 0 1-4.4 2.2l-1-1.5M6.5 16.3c3.6 1.6 7.4 1.6 11 0"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/>',
    steam: '<circle cx="15.5" cy="8.5" r="3.5"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8" cy="16" r="2.5"/><path d="m10.3 15 2.6-3.8M2.5 12.5l3.6 1.6"/><path d="M2.6 13.5A9.5 9.5 0 1 0 3 8.5"/>',
    live: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="11" r="2"/>',
    lib: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5V8H16"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    rr: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 7h14M9 17h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
  };
  const FR = { data: null, built: false, offlineOpen: false, lastCount: -1 };
  const STATUS = { online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', offline: 'Hors ligne' };
  const KIND = { playing: 'Joue à', streaming: 'Stream', competing: 'En compétition', watching: 'Regarde', listening: 'Écoute' };
  const gameById = (id) => S.lib.games.find((g) => g.id === id);
  const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;

  function ago(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'à l’instant';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return r && h < 10 ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? '1 jour' : `${d} jours`;
  }
  const initials = (n) => esc(String(n || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase());
  function avatar(f, big) {
    const glyph = !f.avatar && f.av && window.rrProfiles?.avatarSVG ? window.rrProfiles.avatarSVG(f.av.g, f.av.c) : '';
    return `<span class="fr-av${big ? ' big' : ''}${glyph ? ' has-glyph' : ''}" data-status="${f.status}"><span class="fr-av-in">${glyph || initials(f.name)}${f.avatar ? `<img src="${esc(f.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><i class="fr-dot" aria-hidden="true"></i></span>`;
  }
  const SRC = { steam: [I.steam, 'Steam'], discord: [I.discord, 'Discord'], rr: [I.rr, 'RR Launcher'] };
  const srcOf = (f) => SRC[f.source] || SRC.discord;
  const srcBadge = (f) => `<span class="fr-badge fr-src">${SV(srcOf(f)[0])}${srcOf(f)[1]}</span>`;

  // ------------------------------------------------------------ Structure
  function build() {
    if (FR.built) return;
    FR.built = true;
    const el = document.createElement('div');
    el.id = 'friends'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Amis');
    el.innerHTML = `
      <div class="fr-head">
        <h2>${SV(I.friends, 'fr-h-ico')}Amis</h2>
        <div class="fr-sum" id="frSum" aria-live="polite"></div>
        <div class="fr-tools">
          <span class="fr-conn" id="frConn"></span>
          <button class="fr-icon-btn" data-nav data-fr="refresh" aria-label="Actualiser" title="Actualiser">${SV(I.refresh)}</button>
          <button class="fr-icon-btn" data-nav data-fr="settings" aria-label="Réglages des amis" title="Réglages">${SV(I.gear)}</button>
          <button class="fr-icon-btn" data-nav data-action="close" aria-label="Fermer" title="Fermer">${SV(I.close)}</button>
        </div>
      </div>
      <div class="fr-scroll"><div class="fr-body" id="frBody"></div></div>`;
    document.body.append(el);
    OVERLAYS.friends = '#friends';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fr]');
      if (!b) return;
      const k = b.dataset.fr;
      if (k === 'refresh') refresh(true);
      else if (k === 'settings') openSettings();
      else if (k === 'offline') { FR.offlineOpen = !FR.offlineOpen; sfx('move'); render(); }
      else if (k === 'card') activate(b);
      else if (k === 'rr-copy') { navigator.clipboard.writeText(FR.data?.rr?.code || '').then(() => toast('Code ami copié', 'success'), () => toast('Copie impossible', true)); }
      else if (k === 'rr-accept' || k === 'rr-decline') rrAction(k === 'rr-accept' ? 'x:friends:rrAccept' : 'x:friends:rrDecline', b.dataset.uid, k === 'rr-accept' ? 'Ami ajouté' : 'Demande refusée');
    });
    el.addEventListener('submit', async (e) => {
      if (!e.target.matches('[data-fr-form="add"]')) return;
      e.preventDefault();
      const inp = $('#frRRCode');
      const code = inp.value.trim();
      if (!code) return;
      const r = await rr.x('x:friends:rrAdd', code).catch((er) => ({ ok: false, error: er.message }));
      if (!r?.ok) return toast(r?.error || 'Ajout impossible', true);
      inp.value = '';
      toast(r.pending ? `Demande envoyée à ${r.name} : il apparaîtra quand il t’aura accepté` : `${r.name} ajouté`, 'success');
      refresh();
    });
  }

  // ------------------------------------------------------------ Rendu
  function card(f) {
    const a = f.activity, own = f.gameId && gameById(f.gameId);
    const sub = [a.details, a.state].filter(Boolean).join(' · ');
    const label = `${f.name}, ${f.streaming ? 'en stream sur' : 'joue à'} ${a.name}${own ? ', tu l’as' : ''}`;
    return `<button class="fr-card${own ? ' owned' : ''}" data-nav data-fr="card" data-key="${esc(f.key)}" aria-label="${esc(label)}">
      ${avatar(f, true)}
      <span class="fr-card-txt">
        <span class="fr-name">${esc(f.name)}${f.mobile ? SV(I.phone, 'fr-mob') : ''}</span>
        <span class="fr-kind">${a.kind === 'streaming' ? 'En stream' : KIND[a.kind] || 'Joue à'}</span>
        <strong class="fr-game">${esc(a.name)}</strong>
        ${sub ? `<span class="fr-sub">${esc(sub)}</span>` : ''}
        <span class="fr-badges">
          ${srcBadge(f)}
          ${f.streaming ? `<span class="fr-badge fr-live">${SV(I.live)}En direct</span>` : ''}
          ${own ? `<span class="fr-badge fr-own">${SV(I.lib)}Tu l’as</span>` : ''}
          ${a.since ? `<span class="fr-since">depuis ${ago(a.since)}</span>` : ''}
        </span>
      </span>
    </button>`;
  }
  function row(f) {
    const a = f.activity;
    const line = a ? `${KIND[a.kind] || ''} ${a.name}${a.details ? ` · ${a.details}` : ''}`.trim()
      : f.status === 'offline' ? (f.lastSeen ? `Vu il y a ${ago(f.lastSeen)}` : 'Hors ligne') : f.custom || STATUS[f.status];
    return `<button class="fr-row" data-nav data-fr="card" data-key="${esc(f.key)}" aria-label="${esc(`${f.name}, ${STATUS[f.status]}${a ? `, ${line}` : ''}`)}">
      ${avatar(f)}
      <span class="fr-row-txt"><span class="fr-name">${esc(f.name)}${f.mobile ? SV(I.phone, 'fr-mob') : ''}</span><span class="fr-sub">${esc(line)}</span></span>
      <span class="fr-src-ico" title="${srcOf(f)[1]}">${SV(srcOf(f)[0])}</span>
    </button>`;
  }
  function setupCard(d) {
    const dc = d?.discord || {}, st = d?.steam || {};
    const lines = [];
    if (!d?.rr?.configured) lines.push(`<li>${SV(I.rr)}<span><b>RR Launcher</b> — amis directement dans le launcher, avec un code ami : renseigne le projet Firebase dans les réglages.</span></li>`);
    if (!dc.hasToken) lines.push(`<li>${SV(I.discord)}<span><b>Discord</b> — crée un bot (gratuit) et colle son jeton : le guide pas à pas est dans les réglages.</span></li>`);
    if (!st.configured) lines.push(`<li>${SV(I.steam)}<span><b>Steam</b> — ajoute ta clé API et ton SteamID (Réglages → Fonctions → Succès).</span></li>`);
    return `<div class="fr-empty"><p class="fr-empty-t">Retrouve tes amis ici</p><ul>${lines.join('')}</ul>
      <button class="btn primary" data-nav data-fr="settings">${SV(I.gear)}Configurer</button></div>`;
  }
  function connLabel(d) {
    const out = [];
    const dc = d.discord, st = d.steam;
    if (dc.enabled && dc.hasToken) {
      const t = dc.state === 'ready' ? `Discord · ${plural(dc.guilds.length, 'serveur', 'serveurs')}` : dc.state === 'error' ? 'Discord : erreur' : 'Discord : connexion…';
      out.push(`<span class="fr-pill" data-tone="${dc.state === 'ready' ? 'ok' : dc.state === 'error' ? 'err' : ''}" title="${esc(dc.error || '')}">${SV(I.discord)}${esc(t)}</span>`);
    }
    if (st.enabled && st.configured) {
      const t = st.state === 'ok' ? 'Steam' : st.state === 'error' ? 'Steam : erreur' : 'Steam…';
      out.push(`<span class="fr-pill" data-tone="${st.state === 'ok' ? 'ok' : st.state === 'error' ? 'err' : ''}" title="${esc(st.error || '')}">${SV(I.steam)}${esc(t)}</span>`);
    }
    return out.join('');
  }
  // Amis RR Launcher : ton code ami, ajout par code, demandes reçues
  function rrPanel(d) {
    const r = d.rr;
    if (!r?.enabled || !r.configured) return '';
    if (r.state === 'connecting' || (!r.code && r.state !== 'error')) return `<section class="fr-rr"><p class="dim"><span class="spinner tiny"></span> Connexion aux amis RR Launcher…</p></section>`;
    if (!r.code) return '';
    const reqs = (r.requests || []).map((q) => `<div class="fr-req"><span class="fr-av"><span class="fr-av-in">${initials(q.name)}</span></span><span class="fr-row-txt"><span class="fr-name">${esc(q.name)}</span><span class="fr-sub">veut t’ajouter en ami</span></span>
      <button class="btn small primary" data-nav data-fr="rr-accept" data-uid="${esc(q.uid)}">Accepter</button><button class="btn small" data-nav data-fr="rr-decline" data-uid="${esc(q.uid)}">Refuser</button></div>`).join('');
    return `<section class="fr-rr" aria-label="Amis RR Launcher">
      <div class="fr-rr-me"><span class="fr-rr-lbl">${SV(I.rr)}Ton code ami</span><b class="fr-code">${esc(r.code.slice(0, 4))}-${esc(r.code.slice(4))}</b>
        <button class="fr-icon-btn" data-nav data-fr="rr-copy" aria-label="Copier mon code ami" title="Copier">${SV(I.copy)}</button>
        <span class="dim">· ${esc(r.name || '')}</span></div>
      <form class="fr-rr-add" data-fr-form="add"><input id="frRRCode" placeholder="Code d’un ami (ex. K7QM-2XPA)" maxlength="9" autocomplete="off" spellcheck="false" aria-label="Code ami à ajouter" data-nav />
        <button class="btn small" type="submit" data-nav>${SV(I.add)}Ajouter</button></form>
      ${reqs ? `<div class="fr-reqs"><h3>Demandes d’ami <span>${r.requests.length}</span></h3>${reqs}</div>` : ''}
    </section>`;
  }
  function render() {
    const d = FR.data, root = $('#friends');
    if (!d || !root || root.hidden) return;
    const keepKey = document.activeElement?.closest?.('#friends [data-key]')?.dataset.key;
    const keepFr = !keepKey && document.activeElement?.closest?.('#friends [data-fr]')?.dataset.fr;
    $('#frSum').innerHTML = d.counts.playing || d.counts.online
      ? `<b>${d.counts.playing}</b> en jeu · <b>${d.counts.online + d.counts.playing}</b> en ligne` : '';
    $('#frConn').innerHTML = connLabel(d);
    const errs = [];
    if (d.discord.enabled && d.discord.state === 'error') errs.push(`Discord : ${d.discord.error}`);
    if (d.steam.enabled && d.steam.state === 'error') errs.push(`Steam : ${d.steam.error}`);
    const none = !d.playing.length && !d.online.length && !d.offline.length;
    const rrOn = d.rr?.enabled && d.rr?.configured;
    const unconfigured = !rrOn && !(d.discord.enabled && d.discord.hasToken) && !(d.steam.enabled && d.steam.configured);
    if (d.rr?.enabled && d.rr.state === 'error') errs.push(`RR Launcher : ${d.rr.error}`);
    let html = errs.map((e) => `<p class="fr-err" role="status">${esc(e)}</p>`).join('') + rrPanel(d);
    if (unconfigured) html += setupCard(d);
    else if (none) html += `<div class="fr-empty"><p class="fr-empty-t">Personne pour l’instant</p><p class="dim">${d.discord.state === 'ready' && !d.discord.guilds.length ? 'Le bot n’est dans aucun serveur : invite-le depuis les réglages.' : 'Les présences arrivent dans quelques secondes.'}</p></div>`;
    else {
      html += `<section class="fr-sec" aria-label="En jeu"><h3>En jeu <span>${d.playing.length}</span></h3>${d.playing.length ? `<div class="fr-grid">${d.playing.map(card).join('')}</div>` : '<p class="fr-none">Aucun ami en jeu pour le moment.</p>'}</section>`;
      if (d.online.length) html += `<section class="fr-sec" aria-label="En ligne"><h3>En ligne <span>${d.online.length}</span></h3><div class="fr-list">${d.online.map(row).join('')}</div></section>`;
      if (d.offline.length) {
        html += `<section class="fr-sec fr-off"><button class="fr-fold" data-nav data-fr="offline" aria-expanded="${FR.offlineOpen}">
          <h3>Absents et hors ligne <span>${d.counts.offline}</span></h3>${SV(I.chev, 'fr-chev')}</button>
          ${FR.offlineOpen ? `<div class="fr-list">${d.offline.map(row).join('')}</div>${d.counts.offline > d.offline.length ? `<p class="fr-none">… et ${d.counts.offline - d.offline.length} autres</p>` : ''}` : ''}</section>`;
      }
    }
    $('#frBody').innerHTML = html;
    ($('#frBody [data-key]') || $('#frBody [data-nav]'))?.setAttribute('data-default', ''); // focus initial : 1re carte
    if (S.mode === 'friends') {
      const back = (keepKey && $(`#friends [data-key="${CSS.escape(keepKey)}"]`)) || (keepFr && $(`#friends [data-fr="${keepFr}"]`));
      if (back) setFocus(back);
      else if (!root.contains(document.activeElement) || !document.activeElement.isConnected) focusFirst();
      renderHints();
    }
  }
  function friendOf(key) {
    const d = FR.data;
    return d && [...d.playing, ...d.online, ...d.offline].find((f) => f.key === key);
  }

  // ------------------------------------------------------------ Actions
  function openInLauncher(g) {
    closeAll();
    if (typeof enterPlatform !== 'function') return;
    S.tab = 'all';
    if (S.view === 'games') goHome();
    enterPlatform(g.platform);
    if (S.view !== 'games') return;
    let i = S.items.findIndex((x) => x.id === g.id);
    if (i < 0 && typeof setTab === 'function') { setTab('all'); i = S.items.findIndex((x) => x.id === g.id); }
    if (i < 0) return;
    S.sel = i; S.selId = g.id; S.pos = reduceMotion ? i : i - 1.4; S.vel = 0;
    syncSlots(); updateChrome(true);
    setTimeout(() => openGame(), reduceMotion ? 0 : 450); // ouvre la page du jeu (boîte)
  }
  async function rrAction(ch, uid, ok) {
    const r = await rr.x(ch, uid).catch((e) => ({ ok: false, error: e.message }));
    if (!r?.ok) return toast(r?.error || 'Échec', true);
    toast(ok, 'success');
    refresh();
  }
  // Fiche d'un ami RR : ce qu'il fait, son temps de jeu, ses jeux les plus joués et ses derniers jeux
  async function openRRFriend(f) {
    sfx('confirm');
    const r = f.pending ? null : await rr.x('x:friends:rrStats', f.uid).catch(() => null);
    const st = r?.stats;
    const line = (x, right) => {
      const own = S.lib.games.find((g) => (g.name || '').toLowerCase() === (x.name || '').toLowerCase());
      return `<li><span><b>${esc(x.name)}</b><small>${esc(x.pname || '')}${x.recomp ? ' · Recomp PC' : ''}${own ? ' · tu l’as' : ''}</small></span><span class="dim">${right}</span></li>`;
    };
    const body = f.pending
      ? `<p class="dim">Demande envoyée : ${esc(f.name)} doit t’ajouter à son tour (code <b>${esc(f.code)}</b>) pour que vous voyiez vos activités et statistiques.</p>`
      : `${f.activity ? `<p class="fr-st-now">${SV(I.live)}Joue à <b>${esc(f.activity.name)}</b>${f.activity.details ? ` · ${esc(f.activity.details)}` : ''}${f.activity.since ? ` · depuis ${ago(f.activity.since)}` : ''}</p>` : `<p class="dim">${f.status === 'online' ? 'En ligne sur le launcher' : f.lastSeen ? `Vu il y a ${ago(f.lastSeen)}` : 'Hors ligne'}</p>`}
        ${st ? `<div class="fr-st-nums"><div><b>${esc(fmtTime(st.total || 0))}</b><span>de jeu</span></div><div><b>${st.played || 0}</b><span>jeux lancés</span></div><div><b>${st.count || 0}</b><span>dans sa bibliothèque</span></div></div>
          ${st.top?.length ? `<h4>Ses jeux les plus joués</h4><ol class="fr-st-list">${st.top.map((x) => line(x, esc(fmtTime(x.sec)))).join('')}</ol>` : ''}
          ${st.recent?.length ? `<h4>Derniers jeux</h4><ul class="fr-st-list">${st.recent.map((x) => line(x, esc(ago(x.at)))).join('')}</ul>` : ''}`
        : '<p class="dim">Statistiques non partagées.</p>'}`;
    openPrompt({
      title: f.name, icon: 'emu', wide: true,
      body: `<div class="fr-st">${body}</div>`,
      actions: [
        { label: 'Retirer de mes amis', danger: true, onClick: async () => { closeOverlay(true); await rrAction('x:friends:rrRemove', f.uid, `${f.name} retiré de tes amis`); } },
        ...(f.gameId && gameById(f.gameId) ? [{ label: 'Voir le jeu', onClick: () => { closeOverlay(true); openInLauncher(gameById(f.gameId)); } }] : []),
        { label: 'Fermer', primary: true, focus: true, onClick: () => closeOverlay() },
      ],
    });
  }
  function activate(el) {
    const f = friendOf(el?.dataset.key);
    if (!f) return;
    if (f.source === 'rr') return openRRFriend(f);
    const g = f.gameId && gameById(f.gameId);
    if (g) { sfx('confirm'); return openInLauncher(g); }
    if (f.streaming && f.activity?.url && /^https:\/\//.test(f.activity.url)) { rr.openExternal(f.activity.url); return toast('Stream ouvert dans le navigateur', 'success'); }
    sfx('move');
  }
  async function hideFocused() {
    const f = friendOf(document.activeElement?.closest?.('[data-key]')?.dataset.key);
    if (!f) return;
    await rr.x('x:friends:hide', f.key, true);
    toast(`${f.name} masqué — Réglages pour réafficher`, 'success');
  }
  function openSettings() {
    action('settings');
    setTimeout(() => {
      if (typeof setSettingsPage === 'function') setSettingsPage('more');
      const h = $('#set-friends h3');
      if (h) { h.scrollIntoView({ block: 'start' }); const t = $('#set-friends [data-nav]'); if (t) setFocus(t); }
    }, 60);
  }
  async function refresh(manual) {
    if (manual) toast('Actualisation des amis…', 'progress');
    const d = await rr.x(manual ? 'x:friends:refresh' : 'x:friends:get').catch(() => null);
    if (d) apply(d);
  }
  function apply(d) {
    FR.data = d;
    updateBadge();
    render();
  }

  // ------------------------------------------------------------ Icône + compteur, menu
  function updateBadge() {
    const n = FR.data?.counts?.playing || 0;
    const b = $('#sysbar [data-action="friends"]');
    if (!b) return;
    const badge = $('.fr-count', b);
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.hidden = !n;
    const lbl = n ? `Amis — ${plural(n, 'ami en jeu', 'amis en jeu')}` : 'Amis';
    b.dataset.tip = lbl; b.setAttribute('aria-label', lbl);
    const meta = $('#frMenuMeta');
    if (meta) meta.textContent = n ? plural(n, 'en jeu', 'en jeu') : '';
    if (n > FR.lastCount && FR.lastCount >= 0 && !reduceMotion) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
    FR.lastCount = n;
  }
  function mountEntries() {
    const panel = $('#menu .panel'), before = panel?.querySelector('[data-action="settings"]');
    if (panel && !panel.querySelector('[data-action="friends"]')) {
      const b = document.createElement('button');
      b.className = 'menu-item'; b.dataset.action = 'friends'; b.dataset.nav = '';
      b.innerHTML = `${SV(I.friends, 'ico')}<span class="mi-label">Amis</span><span class="mi-meta" id="frMenuMeta"></span><kbd class="mi-key">A</kbd>`;
      before ? before.before(b) : panel.append(b);
    }
    const bar = $('#sysbar'), menuBtn = bar?.querySelector('[data-action="menu"]');
    if (bar && !bar.querySelector('[data-action="friends"]')) {
      const b = document.createElement('button');
      b.className = 'sys-btn fr-sys'; b.dataset.action = 'friends'; b.dataset.tip = 'Amis'; b.setAttribute('aria-label', 'Amis');
      b.innerHTML = `${SV(I.friends)}<span class="fr-count" hidden aria-hidden="true"></span>`;
      const first = bar.querySelector('[data-action="addHub"]');
      first ? first.before(b) : menuBtn ? menuBtn.before(b) : bar.append(b);
    }
  }

  // ------------------------------------------------------------ Ouverture / entrées
  RR.actions.friends = async () => {
    if (S.mode === 'friends') return overlayBack();
    build();
    closeAll();
    rr.x('x:friends:visible', true);
    const d = await rr.x('x:friends:get').catch(() => null);
    if (d) FR.data = d;
    openOverlay('friends');
    render();
    clearInterval(FR.tick);
    FR.tick = setInterval(() => { if (S.mode === 'friends') $$('#friends .fr-since').length && render(); }, 30000); // « depuis » à jour
  };
  RR.on('mode', (m) => { if (m !== 'friends' && FR.tick && !S.stack.includes('friends')) { clearInterval(FR.tick); FR.tick = null; rr.x('x:friends:visible', false); } });
  const _renderHints = renderHints;
  renderHints = function () { // FRIENDS : aides propres à l'écran Amis
    _renderHints();
    if (S.mode !== 'friends') return;
    const list = $('#hintList');
    const add = (btn, kb, label, fn) => {
      const b = document.createElement('button');
      b.className = 'hint'; b.tabIndex = -1;
      b.innerHTML = `${S.device === 'pad' ? glyph(btn) : `<span class="glyph kb round g-ico">${kb}</span>`}<span class="hint-label">${label}</span>`;
      b.addEventListener('click', fn);
      list.children[0] ? list.children[0].after(b) : list.append(b);
    };
    const f = friendOf(document.activeElement?.closest?.('[data-key]')?.dataset.key);
    add('y', 'R', 'Actualiser', () => refresh(true));
    if (f) add('x', 'X', 'Masquer', hideFocused);
    const a = $$('#hintList .hint-label').pop();
    if (a && f) a.textContent = f.gameId ? 'Voir le jeu' : f.streaming && f.activity?.url ? 'Voir le stream' : 'Valider';
  };
  // Les aides dépendent de l'élément focalisé
  document.addEventListener('focusin', (e) => { if (S.mode === 'friends' && e.target.closest?.('#friends')) renderHints(); });
  RR.on('input', (src, k) => {
    if (src !== 'pad' || S.mode !== 'friends') return;
    if (k === 'x') hideFocused();
    else if (k === 'y') refresh(true);
  });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.target.matches?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (S.mode === 'friends') {
      if (k === 'x') { e.preventDefault(); hideFocused(); }
      else if (k === 'r') { e.preventDefault(); refresh(true); }
      else if (k === 'a') { e.preventDefault(); overlayBack(); }
      return;
    }
    // Touche A : ouvre « Amis » depuis l'écran principal (accueil ou jeux)
    if (k === 'a' && S.mode === 'main' && S.topFocus < 0 && !document.body.classList.contains('bo-on')) { e.preventDefault(); RR.actions.friends(); }
  });

  // ------------------------------------------------------------ Notifications « X lance Y »
  rr.onX('x:friends:started', (p) => {
    if (S.lib.settings?.friendsNotify === false || document.visibilityState !== 'visible' || S.mode === 'ingame') return;
    for (const it of p.items.slice(0, 3)) toast(`${it.name} ${it.streaming ? 'streame' : 'lance'} ${it.game}`, 'info');
    if (p.items.length > 3 || p.more) toast(`… et ${p.items.length - 3 + (p.more || 0)} autres amis en jeu`, 'info');
  });
  rr.onX('x:friends:update', apply);

  // ------------------------------------------------------------ Réglages
  function settingsHtml() {
    return `
    <h3 class="set-group">Amis</h3>
    <div class="setting">
      <div><strong id="lbFrRR">Amis RR Launcher</strong><span class="dim">Ta liste d’amis directement dans le launcher : un code ami à échanger, ce à quoi jouent tes amis et leurs statistiques, sans Steam ni Discord.</span></div>
      <button class="toggle" data-toggle="friendsRR" role="switch" aria-labelledby="lbFrRR" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbFrRRSt">Partager mes statistiques</strong><span class="dim">Temps de jeu, jeux les plus joués et derniers jeux, visibles uniquement par tes amis.</span></div>
      <button class="toggle" data-toggle="friendsRRStats" role="switch" aria-labelledby="lbFrRRSt" data-nav></button>
    </div>
    <div class="setting col">
      <div><label for="frRRName"><strong>Pseudo</strong></label><span class="dim">Vide : le nom de ton profil joueur.</span></div>
      <input id="frRRName" maxlength="40" spellcheck="false" data-nav />
    </div>
    <div class="setting col fr-guide" id="frRRFb">
      <div><strong>Projet Firebase</strong><span class="dim" id="frRRFbState"></span></div>
      <div class="fr-tok-row">
        <input id="frRRKey" placeholder="apiKey" autocomplete="off" spellcheck="false" aria-label="Clé API Firebase (apiKey)" data-nav />
        <input id="frRRDb" placeholder="https://…firebasedatabase.app" autocomplete="off" spellcheck="false" aria-label="Adresse de la base (databaseURL)" data-nav />
        <button class="btn" id="frRRSave" data-nav>Se connecter</button>
      </div>
      <span class="dim">Déjà renseigné dans le launcher pour tes amis : ce champ ne sert qu’à changer de projet.</span>
    </div>
    <div class="setting">
      <div><strong id="lbFrNotify">Prévenir quand un ami lance un jeu</strong><span class="dim">Petite notification en bas de l’écran (jamais pendant une partie).</span></div>
      <button class="toggle" data-toggle="friendsNotify" role="switch" aria-labelledby="lbFrNotify" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbFrSteam">Amis Steam</strong><span class="dim">Utilise la clé API et le SteamID de la section « Succès ». Ta liste d’amis Steam doit être publique. Actualisé toutes les 60 s quand l’écran Amis est ouvert.</span></div>
      <button class="toggle" data-toggle="friendsSteam" role="switch" aria-labelledby="lbFrSteam" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbFrDc">Amis Discord (bot)</strong><span class="dim">Discord ne laisse aucune application lire ta liste d’amis. À la place, ton propre bot, invité dans tes serveurs, voit qui est en ligne et à quoi jouent les membres.</span></div>
      <button class="toggle" data-toggle="friendsDiscord" role="switch" aria-labelledby="lbFrDc" data-nav></button>
    </div>
    <div class="setting col fr-guide">
      <div><strong>Créer ton bot Discord (5 min, une seule fois)</strong></div>
      <ol class="fr-steps">
        <li>Ouvre <a href="#" data-link="https://discord.com/developers/applications">discord.com/developers/applications</a> et choisis ton application « RR Launcher » (la même que pour la Rich Presence) ou crée-en une.</li>
        <li>Onglet <b>Bot</b> : active <b>Presence Intent</b> et <b>Server Members Intent</b> (Privileged Gateway Intents), puis <b>Save Changes</b>. Décoche « Public Bot » si tu veux être seul à pouvoir l’inviter.</li>
        <li>Toujours dans <b>Bot</b> : <b>Reset Token</b>, puis copie le jeton (il ne s’affiche qu’une fois).</li>
        <li>Invite le bot dans le serveur où sont tes amis (il te faut le droit « Gérer le serveur ») : <a href="#" id="frInvite" data-link="">ouvrir l’invitation</a> <span class="dim" id="frInviteHint"></span> — scope <code>bot</code>, aucune permission.</li>
        <li>Colle le jeton ci-dessous, puis <b>Tester</b>.</li>
      </ol>
      <div class="fr-tok-row">
        <input id="frToken" type="password" placeholder="Jeton du bot" autocomplete="off" spellcheck="false" aria-label="Jeton du bot Discord" data-nav />
        <button class="btn" id="frTest" data-nav>Tester</button>
        <button class="btn" id="frClear" data-nav hidden>Retirer</button>
      </div>
      <span class="dim" id="frStatus" role="status"></span>
      <span class="dim">Le jeton reste sur ce PC (chiffré par Windows) et n’est jamais affiché. Seuls les membres qui partagent leur activité apparaissent « en jeu ».</span>
    </div>
    <div class="setting" id="frHiddenRow" hidden>
      <div><strong>Membres masqués</strong><span class="dim" id="frHiddenN"></span></div>
      <button class="btn" id="frUnhide" data-nav>Tout réafficher</button>
    </div>`;
  }
  function mountSettings() {
    const box = $('#set-friends');
    if (!box) return;
    box.innerHTML = settingsHtml();
    $('#frToken').addEventListener('change', async (e) => {
      const v = e.target.value.trim();
      if (!v) return;
      const r = await rr.x('x:friends:setToken', v);
      e.target.value = '';
      if (!r?.ok) return toast(r?.error || 'Jeton refusé', true);
      toast('Jeton enregistré — connexion…', 'success');
      setTimeout(test, 300);
    });
    $('#frTest').addEventListener('click', async () => {
      const v = $('#frToken').value.trim();
      if (v) { $('#frToken').dispatchEvent(new Event('change')); return; }
      test();
    });
    $('#frClear').addEventListener('click', async () => { await rr.x('x:friends:clearToken'); toast('Jeton du bot retiré', 'success'); setStatus('', ''); refresh(); });
    $('#frRRSave').addEventListener('click', async () => {
      const k = $('#frRRKey').value.trim(), u = $('#frRRDb').value.trim().replace(/\/+$/, '');
      if ((k || u) && !(k && /^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)$/.test(u))) return toast('Il faut l’apiKey et l’adresse de la base (databaseURL)', true);
      await rr.setSettings({ rrFirebaseApiKey: k, rrFirebaseDb: u });
      const r = await rr.x('x:friends:rrRestart');
      toast(r?.state === 'ok' ? `Amis RR connectés · code ${r.code}` : r?.error || 'Connexion…', r?.state === 'ok' ? 'success' : r?.state === 'error');
      refresh();
    });
    $('#frRRName').addEventListener('change', async (e) => { await rr.setSettings({ friendsRRName: e.target.value.trim().slice(0, 40) }); rr.x('x:friends:rrRestart'); toast('Pseudo enregistré', 'success'); });
    $('#frUnhide').addEventListener('click', async () => { await rr.x('x:friends:unhideAll'); toast('Tous les membres sont réaffichés', 'success'); });
  }
  function setStatus(t, tone) { const s = $('#frStatus'); if (s) { s.textContent = t; s.dataset.tone = tone || ''; } }
  async function test() {
    setStatus('Connexion à Discord…', '');
    const r = await rr.x('x:friends:test').catch((e) => ({ ok: false, error: e.message }));
    if (!r?.ok) { setStatus(r?.error || 'Échec', 'err'); return toast(`Amis Discord : ${r?.error || 'échec'}`, true); }
    const msg = `Connecté : ${r.bot || 'bot'} · ${plural(r.guilds, 'serveur', 'serveurs')}${r.members != null ? ` · ${plural(r.members, 'membre', 'membres')}` : ''}`;
    setStatus(r.error ? `${msg} — ${r.error}` : msg, r.error ? 'warn' : 'ok');
    toast(r.error || 'Bot Discord connecté', r.error ? 'info' : 'success');
  }
  function settingsState(st) {
    const s = st.settings || {};
    const id = String(s.discordClientId || '').trim();
    const inv = $('#frInvite');
    if (inv) {
      inv.dataset.link = /^\d{15,22}$/.test(id) ? `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=0` : 'https://discord.com/developers/applications';
      $('#frInviteHint').textContent = /^\d{15,22}$/.test(id) ? '' : '(renseigne d’abord l’ID d’application dans la section Discord, ou génère l’URL dans OAuth2 → URL Generator)';
    }
    const d = FR.data;
    if ($('#frRRName') && document.activeElement !== $('#frRRName')) $('#frRRName').value = s.friendsRRName || '';
    if ($('#frRRKey') && !$('#frRRKey').value && s.rrFirebaseApiKey) { $('#frRRKey').value = s.rrFirebaseApiKey; $('#frRRDb').value = s.rrFirebaseDb || ''; }
    if (d && $('#frRRFbState')) {
      const r = d.rr || {};
      $('#frRRFbState').textContent = !r.configured ? 'Pas encore configuré.' : r.state === 'ok' ? `Connecté · ton code : ${r.code}` : r.state === 'error' ? r.error : r.state === 'off' ? 'Désactivé' : 'Connexion…';
    }
    if (d) {
      $('#frClear').hidden = !d.discord.hasToken;
      $('#frToken').placeholder = d.discord.hasToken ? 'Jeton enregistré — colle un nouveau jeton pour le remplacer' : 'Jeton du bot';
      $('#frHiddenRow').hidden = !d.counts.hidden;
      $('#frHiddenN').textContent = d.counts.hidden ? plural(d.counts.hidden, 'membre masqué dans l’écran Amis', 'membres masqués dans l’écran Amis') : '';
      if (!$('#frStatus').textContent && d.discord.enabled && d.discord.hasToken) {
        if (d.discord.state === 'ready') setStatus(`Connecté : ${d.discord.bot} · ${plural(d.discord.guilds.length, 'serveur', 'serveurs')}`, 'ok');
        else if (d.discord.state === 'error') setStatus(d.discord.error, 'err');
      }
    }
  }

  // Réglages modifiés (interrupteurs, clé Steam) → le processus principal se reconfigure
  let cfgSig = null;
  function onLibrary(st) {
    const s = st.settings || {};
    const defaults = {};
    for (const k of ['friendsNotify', 'friendsSteam', 'friendsDiscord', 'friendsRR', 'friendsRRStats']) if (s[k] === undefined) defaults[k] = true;
    if (Object.keys(defaults).length) rr.setSettings(defaults);
    const sig = [s.friendsDiscord, s.friendsSteam, s.steamApiKey, s.steamId64, s.friendsRR, s.friendsRRStats].join('|');
    if (cfgSig !== null && sig !== cfgSig) rr.x('x:friends:config').then(() => refresh());
    cfgSig = sig;
    settingsState(st);
  }

  mountEntries();
  mountSettings();
  RR.on('library', onLibrary);
  rr.getLibrary().then((st) => { onLibrary(st); refresh(); });
})();

// Module STREAM (renderer) — streaming vers un autre écran (Apollo + Moonlight / Artemis). Côté main : src/features/stream.js (x:stream:*).
// Assistant en 4 étapes : installer Apollo, choisir l'objectif, mesurer la connexion, appliquer.
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.createElement('div');
  box.id = 'set-stream';
  $('#set-v119').append(box);
  let needLogin = null, st = null, opts = { receivers: [], targets: [] }, rec = null, applied = false, pinned = false;
  const pick = { receiver: '', link: 'ethernet', target: '' };
  const meas = { on: false, url: '', urls: [], mbps: null, skipped: false, timer: null };

  async function refresh() { st = await rr.x('x:stream:status').catch(() => null); draw(); }
  async function loadOpts() {
    const r = await rr.x('x:stream:receivers').catch(() => null);
    if (r?.ok) { opts = r; if (!pick.receiver) pick.receiver = r.receivers[0]?.id || ''; if (!pick.target) pick.target = r.targets[0]?.id || ''; draw(); }
  }
  // ---- Menu principal : « Streamer (Apollo) »
  const ICO_SUN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="14" height="10" rx="2"/><path d="M6.5 18h6M9.5 14v4"/><path d="M18 9a4 4 0 0 1 0 6M20.5 7a7 7 0 0 1 0 10"/></svg>';
  function menuMount() {
    const panel = $('#menu .panel'), before = panel?.querySelector('[data-action="settings"]');
    if (!panel || panel.querySelector('[data-action="apolloStream"]')) return;
    const b = document.createElement('button');
    b.className = 'menu-item'; b.dataset.action = 'apolloStream'; b.dataset.nav = ''; b.hidden = false;
    b.innerHTML = `${ICO_SUN}<span class="mi-label">Streamer (Apollo)</span><span class="mi-meta" id="apolloMenuMeta"></span>`;
    if (before) before.before(b); else panel.append(b);
  }
  function menuUpdate() {
    const b = $('[data-action="apolloStream"]');
    if (!b) return;
    const ap = st?.apollo;
    b.hidden = false; // toujours visible : sans Apollo, l'entrée ouvre l'assistant d'installation
    $('#apolloMenuMeta').textContent = !ap?.installed ? 'Installer' : ap.running ? 'Actif' : 'Démarrer';
  }
  RR.actions.apolloStream = async () => {
    if (!st?.apollo?.installed) { // pas encore installé : Réglages → Streaming (assistant)
      closeAll(); renderSettings(); openOverlay('settings');
      setTimeout(() => box.scrollIntoView({ block: 'start' }), 50);
      return;
    }
    closeAll(true);
    toast('Démarrage d’Apollo…', 'progress');
    const r = await rr.x('x:stream:start');
    if (r?.ok === false) { toast(`Apollo : ${r.error || 'échec'}`, true); return; }
    openUi(); st = r; refresh();
  };
  RR.on('mode', (m) => { if (m === 'menu') refresh(); });
  menuMount();

  // NEEDS_LOGIN : Apollo avait déjà un identifiant inconnu du launcher -> champs affichés, puis l'action est relancée
  async function xc(ch, arg, retry) {
    const r = await rr.x(ch, arg).catch((e) => ({ ok: false, error: e.message }));
    if (r?.code === 'NEEDS_LOGIN') { needLogin = retry; toast(r.error || 'Apollo a déjà un identifiant : saisis-le', 'info'); draw(); return null; }
    return r;
  }
  const curReceiver = () => opts.receivers.find((r) => r.id === pick.receiver);
  const sel = (id, list, cur) => `<select id="${id}" data-nav>${list.map((o) => `<option value="${esc(o.id)}"${o.id === cur ? ' selected' : ''}>${esc(o.name || o.label)}</option>`).join('')}</select>`;
  const head = (n, label, done, locked) => `<strong${locked ? ' class="dim"' : ''}>${done ? '✓' : n + '.'} ${esc(label)}</strong>`;
  const oq = () => ({ target: pick.target, receiver: pick.receiver, link: pick.link });

  function recHtml() {
    if (!rec) return '';
    const r = rec.rec || rec;
    const res = r.resolved || {};
    return `<div class="set-note"><b>Profil retenu :</b> ${esc(res.label || `${res.w}×${res.h} ${res.fps} i/s`)}, ${esc(r.codec)}, ${esc(r.bitrateMbps)} Mbps${rec.measuredMbps ? ` (connexion mesurée : ${esc(rec.measuredMbps)} Mbps)` : ''}.
      ${r.degraded && r.reasons?.length ? `<br>Dégradé par rapport à ta cible : ${r.reasons.map(esc).join(' ; ')}.` : ''}
      ${r.warnings?.length ? `<br>${r.warnings.map((w) => `Attention : ${esc(w)}`).join('<br>')}` : ''}</div>`;
  }
  function clientHtml() {
    const r = rec?.rec || rec;
    if (!applied || !r) return '';
    const rc = curReceiver(), addr = (st.addresses || [])[0]?.address || '';
    return `<div class="setting col"><div><strong>Réglages à saisir dans Moonlight / Artemis</strong>
        <span class="dim">${(r.clientSettings || []).map((c) => `${esc(c.label)} : <b>${esc(c.value)}</b>`).join('<br>') || 'Aucun réglage particulier.'}</span>
        ${rc ? `<span class="dim">Client conseillé pour ${esc(rc.name)} : <b>${esc(rc.client)}</b>${rc.install ? ` — ${esc(rc.install)}` : ''}</span>` : ''}
        ${r.displayOverride ? `<span class="dim">Écran : ${esc(r.displayOverride)}</span>` : ''}</div>
      <div class="v119-row">${addr ? `<code>${esc(addr)}</code><button class="btn" data-st="copy" data-addr="${esc(addr)}" data-nav>Copier l’adresse</button>` : ''}</div>
      <div class="v119-row"><input id="stPin" class="v119-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Code PIN affiché par Moonlight" data-nav /><input id="stPinName" class="v119-input" type="text" autocomplete="off" placeholder="Nom (ex. Salon)" value="${esc(rc?.name || '')}" data-nav /><button class="btn" data-st="pin" data-nav>Appairer</button></div>
      ${pinned ? '<span class="dim">✓ Appareil appairé.</span>' : ''}</div>`;
  }
  function measHtml(locked) {
    if (meas.mbps) return `<div class="setting col"><div>${head(3, 'Mesurer ma connexion', true)}<span class="dim"><b>${esc(meas.mbps)} Mbps</b> mesurés.</span></div><span class="set-btns"><button class="btn" data-st="mstart" data-nav>Refaire</button></span></div>`;
    if (meas.skipped && !meas.on) return `<div class="setting"><div>${head(3, 'Mesurer ma connexion', true)}<span class="dim">Mesure ignorée : le profil sera prudent.</span></div><span class="set-btns"><button class="btn" data-st="mstart" data-nav>Mesurer</button></span></div>`;
    if (meas.on) return `<div class="setting col"><div>${head(3, 'Mesurer ma connexion', false)}
        <span class="dim">Ouvre cette adresse dans le navigateur du receveur :</span>
        <span style="font-size:1.6em;font-weight:700"><code>${esc(meas.url)}</code></span>
        ${meas.urls.length > 1 ? `<span class="dim">Autres adresses : ${meas.urls.map((u) => `<code>${esc(u)}</code>`).join(' · ')}</span>` : ''}
        <span class="dim" id="stMeas">En attente de la mesure…</span></div>
      <span class="set-btns"><button class="btn" data-st="mskip" data-nav>Passer</button></span></div>`;
    return `<div class="setting"><div>${head(3, 'Mesurer ma connexion', false, locked)}<span class="dim">Optionnel : un petit test depuis le navigateur du receveur pour choisir un débit réaliste.</span></div>
      <span class="set-btns"><button class="btn" data-st="mstart" data-nav${locked ? ' disabled' : ''}>Mesurer</button><button class="btn" data-st="mskip" data-nav${locked ? ' disabled' : ''}>Passer</button></span></div>`;
  }

  function draw() {
    menuUpdate();
    if (!st) { box.innerHTML = ''; return; }
    const ap = st.apollo || {}, moon = st.moonlight || {}, ok = !!ap.installed;
    const games = (S.lib?.games || []).filter((g) => !g.hidden).sort((a, b) => a.name.localeCompare(b.name));
    const rc = curReceiver();
    box.innerHTML = `
      <h3 class="set-group">Streaming vers un autre écran</h3>
      <p class="set-note">Diffuse ton PC vers une TV, un téléphone ou un autre PC avec <b>Apollo</b> (ici) et <b>Moonlight</b> ou <b>Artemis</b> (sur l'écran qui reçoit).</p>
      <div class="setting"><div>${head(1, `Installer Apollo${ok ? (ap.running ? ' — actif' : ' — installé') : ''}`, ok)}
          <span class="dim">${ok ? (ap.sudovda === false ? 'Pilote d’écran virtuel absent : réinstalle Apollo ou redémarre le PC.' : 'Serveur de streaming (fork de Sunshine).') : 'Installation automatique, une confirmation Windows (UAC) est demandée. Peut prendre environ 1 minute.'}</span></div>
        <span class="set-btns">${ok ? `<button class="btn" data-st="start" data-nav>${ap.running ? 'Interface' : 'Démarrer'}</button>` : '<button class="btn" data-st="install" data-nav>Installer Apollo</button>'}</span></div>
      <div class="setting col"><div>${head(2, 'Mon objectif', false, !ok)}<span class="dim">Le receveur, le type de liaison et la qualité visée.</span></div>
        <div class="v119-row">${sel('stRecv', opts.receivers, pick.receiver)}
          <select id="stLink" data-nav><option value="ethernet"${pick.link === 'ethernet' ? ' selected' : ''}>Ethernet</option><option value="wifi"${pick.link === 'wifi' ? ' selected' : ''}>Wi-Fi</option></select>
          ${sel('stTarget', opts.targets, pick.target)}</div>
        ${rc?.install ? `<span class="dim">${esc(rc.install)}</span>` : ''}</div>
      ${measHtml(!ok)}
      <div class="setting col"><div>${head(4, 'Appliquer', applied, !ok)}<span class="dim">Calcule le profil, puis configure Apollo à ta place.</span></div>
        ${recHtml()}
        <span class="set-btns"><button class="btn" data-st="rec" data-nav${ok ? '' : ' disabled'}>Voir le profil</button><button class="btn" data-st="apply" data-nav${ok ? '' : ' disabled'}>Configurer Apollo automatiquement</button></span></div>
      ${clientHtml()}
      ${needLogin ? `<div class="setting col"><div><strong>Identifiants Apollo</strong><span class="dim">Apollo avait déjà un identifiant que le launcher ne connaît pas : saisis-le une fois.</span></div>
        <div class="v119-row"><input id="stUser" class="v119-input" type="text" autocomplete="off" spellcheck="false" placeholder="Identifiant" data-nav /><input id="stPass" class="v119-input" type="password" autocomplete="off" placeholder="Mot de passe" data-nav /><button class="btn" data-st="login" data-nav>Enregistrer</button></div></div>` : ''}
      ${ok ? `<div class="setting"><div><strong>Interface Apollo</strong><span class="dim">Identifiants créés automatiquement.</span></div>
        <span class="set-btns"><button class="btn" data-st="ui" data-nav>Ouvrir l’interface Apollo</button></span></div>` : ''}
      ${st.addresses?.length ? `<div class="setting"><div><strong>Adresse à saisir dans Moonlight</strong><span class="dim">${st.addresses.map((a) => `<code>${esc(a.address)}</code> (${esc(a.name)})`).join(' · ')}</span></div></div>` : ''}
      ${ok ? `<div class="setting"><div><strong>Applications Apollo</strong><span class="dim">${st.registered?.length ? esc(st.registered.join(', ')) : 'Aucune. Ajoute « RR Launcher » : tu choisis ensuite le jeu depuis Moonlight.'}</span></div>
        <span class="set-btns"><button class="btn" data-st="reg" data-nav>Ajouter RR Launcher</button></span></div>
      <div class="setting"><div><strong>Ajouter un jeu précis</strong><span class="dim">Il apparaît comme une application dans Moonlight et se lance tout seul.</span></div>
        <span class="set-btns"><select id="stGame" data-nav>${games.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select><button class="btn" data-st="regGame" data-nav>Ajouter</button></span></div>` : ''}
      <div class="setting"><div><strong>Moonlight ${moon.installed ? '— installé' : '— non installé'}</strong><span class="dim">Pour recevoir le flux d’un autre PC sur celui-ci.</span></div>
        <span class="set-btns"><button class="btn" data-st="moon" data-nav>${moon.installed ? 'Ouvrir' : 'Télécharger'}</button></span></div>
      <div id="stManual" class="set-note" hidden></div>`;
  }
  async function reg(id) {
    const r = await xc('x:stream:register', id, () => reg(id));
    if (!r) return;
    if (r.ok) { toast(`« ${r.name} » ${r.added ? 'ajouté' : 'mis à jour'}${r.restarted ? ' — Apollo redémarré' : ''}`, 'success'); refresh(); return; }
    toast(r.error, true);
    if (r.manual) { const m = $('#stManual'); m.hidden = false; m.innerHTML = `Dans Apollo (Applications → Ajouter) : nom <code>${esc(r.manual.name)}</code>, commande <code>${esc(r.manual.cmd)}</code>, dossier <code>${esc(r.manual.dir)}</code>.`; }
  }
  // ---- Mesure : sonde toutes les secondes jusqu'à un débit non nul
  function stopPoll() { clearInterval(meas.timer); meas.timer = null; }
  async function measureStart() {
    stopPoll(); meas.mbps = null; meas.skipped = false;
    const r = await rr.x('x:stream:measure:start').catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(r.error || 'Mesure impossible', true); return; }
    meas.on = true; meas.url = r.url; meas.urls = r.urls || [r.url]; draw();
    meas.timer = setInterval(async () => {
      const g = await rr.x('x:stream:measure:get').catch(() => null);
      if (!g?.ok) return;
      if (g.mbps) { stopPoll(); meas.mbps = g.mbps; meas.on = false; rr.x('x:stream:measure:stop'); draw(); }
      else if (g.running === false) { stopPoll(); meas.on = false; draw(); }
      else { const el = $('#stMeas'); if (el) el.textContent = g.minMbps ? `Mesure en cours… (au moins ${g.minMbps} Mbps)` : 'En attente de la mesure…'; }
    }, 1000);
  }
  async function measureSkip() { stopPoll(); rr.x('x:stream:measure:stop', { reset: true }); meas.on = false; meas.mbps = null; meas.skipped = true; draw(); }
  async function recommend() {
    const r = await rr.x('x:stream:recommend', oq()).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(r.error || 'Calcul impossible', true); return null; }
    rec = r; draw(); return r;
  }

  box.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'stRecv') pick.receiver = e.target.value;
    else if (id === 'stLink') pick.link = e.target.value;
    else if (id === 'stTarget') pick.target = e.target.value;
    else return;
    rec = null; applied = false; pinned = false; if (id !== 'stTarget') { meas.mbps = null; meas.skipped = false; rr.x('x:stream:measure:stop', { reset: true }); } draw();
  });
  async function openUi() { const r = await xc('x:stream:openUi', undefined, openUi); if (r && r.ok === false) toast(r.error, true); }
  async function doApply(b) {
    if (b) b.disabled = true; toast('Configuration d’Apollo…', 'progress');
    const r = await xc('x:stream:apply', oq(), () => doApply());
    if (b) b.disabled = false;
    if (!r) return;
    if (!r.ok) { toast(r.error || 'Configuration impossible', true); return; }
    rec = { ...(rec || {}), rec: r.rec, measuredMbps: rec?.measuredMbps ?? meas.mbps }; applied = true; pinned = false;
    toast(`Apollo configuré${r.restarted ? ' et redémarré' : ''}`, 'success'); refresh();
  }
  async function doPin(pin, name) {
    const r = await xc('x:stream:pin', { pin, name }, () => doPin(pin, name));
    if (!r) return;
    if (r.ok) { pinned = true; toast('Appareil appairé', 'success'); draw(); } else toast(r.error || 'Appairage échoué', true);
  }
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.dataset.st;
    if (k === 'install') {
      b.disabled = true; toast('Installation d’Apollo… (environ 1 minute)', 'progress');
      const r = await rr.x('x:stream:install').catch((er) => ({ ok: false, error: er.message }));
      b.disabled = false;
      if (r.ok) toast(r.rebootAdvised ? 'Apollo installé — redémarre le PC pour activer l’écran virtuel' : 'Apollo installé', 'success'); else toast(r.error || 'Installation échouée', true);
      refresh();
    }
    else if (k === 'start') { b.disabled = true; toast('Démarrage d’Apollo…', 'progress'); const r = await rr.x('x:stream:start'); b.disabled = false; if (r.ok === false) toast(r.error, true); else { openUi(); st = r; draw(); } }
    else if (k === 'ui') openUi();
    else if (k === 'mstart') measureStart();
    else if (k === 'mskip') measureSkip();
    else if (k === 'rec') await recommend();
    else if (k === 'apply') doApply(b);
    else if (k === 'login') {
      const r = await rr.x('x:stream:login', { user: $('#stUser').value.trim(), pass: $('#stPass').value }).catch((er) => ({ ok: false, error: er.message }));
      if (!r.ok || !r.saved) { toast(r.error || 'Renseigne l’identifiant et le mot de passe', 'info'); return; }
      toast('Identifiants enregistrés', 'success'); const f = needLogin; needLogin = null; draw(); if (f) f();
    }
    else if (k === 'copy') { try { await navigator.clipboard.writeText(b.dataset.addr); toast('Adresse copiée', 'success'); } catch { toast('Copie impossible', true); } }
    else if (k === 'pin') {
      const pin = $('#stPin').value.trim(); if (!pin) { toast('Saisis le code PIN affiché par Moonlight', 'info'); return; }
      doPin(pin, $('#stPinName').value.trim());
    }
    else if (k === 'reg') reg(null);
    else if (k === 'regGame') reg($('#stGame').value);
    else if (k === 'moon') { const r = await rr.x('x:stream:moonlight', {}); if (r.ok === false) toast(r.error, 'error'); }
  });
  refresh(); loadOpts();
  document.addEventListener('settings:open', () => { refresh(); loadOpts(); });
})();

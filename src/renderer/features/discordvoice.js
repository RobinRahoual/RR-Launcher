// Module DISCORDVOICE (renderer) — vocal Discord à la manette : réglages + entrées du menu en jeu.
// Côté main : src/features/discordvoice.js (canaux x:discordvoice:*). Guide + X = rejoindre / quitter, Guide + A = micro.
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICO_VOC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/></svg>';
  const ICO_MIC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  const ICO_MIC_OFF = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/><path d="M4 4l16 16" stroke-width="2.6"/></svg>';
  // Rouge = action qui coupe / quitte ; micro barré quand il est coupé
  function tone(btn, red, ico) {
    if (!btn) return;
    btn.classList.toggle('danger', !!red);
    if (ico && btn.dataset.ico !== ico) { btn.dataset.ico = ico; const old = btn.querySelector('svg.ico'); if (old) old.outerHTML = ico === 'off' ? ICO_MIC_OFF : ico === 'on' ? ICO_MIC : ICO_VOC; }
  }

  // ---- Menu en jeu
  function igInsert() {
    const main = $('#igMain');
    if (!main || $('[data-ig="dc-voice"]', main)) return;
    const quit = $('[data-ig="quit"]', main);
    quit.insertAdjacentHTML('beforebegin',
      `<button class="ig-item dc-ig" data-ig="dc-voice" role="menuitem" data-nav>${ICO_VOC}<span class="ig-label">Rejoindre le vocal</span><span class="ig-meta" id="dvMeta"></span></button>`
      + `<button class="ig-item dc-ig" data-ig="dc-mute" role="menuitem" data-nav>${ICO_MIC}<span class="ig-label">Couper le micro</span><span class="ig-meta" id="dvMuteMeta"></span></button>`);
  }
  let vs = { inVoice: null, muted: null }; // état réel lu dans Discord à l'ouverture du menu
  function igUpdate() {
    const s = S.lib?.settings || {};
    const ready = !!((s.discordClientId && s.discordClientSecret) || RRShared.discord);
    const pad = S.device === 'pad' && s.discordVoicePad !== false, ps = S.padType === 'ps';
    for (const k of ['dc-voice', 'dc-mute']) { const b = $(`[data-ig="${k}"]`); if (b) b.hidden = !ready; }
    const lv = $('[data-ig="dc-voice"] .ig-label'), lm = $('[data-ig="dc-mute"] .ig-label');
    if (lv) lv.textContent = vs.inVoice ? 'Quitter le vocal' : 'Rejoindre le vocal';
    tone($('[data-ig="dc-voice"]'), vs.inVoice); tone($('[data-ig="dc-mute"]'), vs.muted, vs.muted ? 'off' : 'on');
    if (lm) lm.textContent = vs.muted ? 'Réactiver le micro' : 'Couper le micro';
    const m = $('#dvMeta'), m2 = $('#dvMuteMeta');
    const chan = vs.inVoice ? vs.name : (s.discordVoiceChannel?.name || '');
    if (m) m.textContent = pad ? `${ps ? 'PS' : 'Guide'} + ${ps ? '□' : 'X'}` : chan;
    if (m2) m2.textContent = pad ? `${ps ? 'PS' : 'Guide'} + ${ps ? '✕' : 'A'}` : '';
  }
  // ---- Menu principal : « Rejoindre / Quitter le vocal » (+ micro une fois dedans)
  function menuMount() {
    const panel = $('#menu .panel'), before = panel?.querySelector('[data-action="dcStream"]') || panel?.querySelector('[data-action="settings"]');
    if (!panel || panel.querySelector('[data-action="dcVoice"]')) return;
    const mk = (action, ico, label, meta) => { const b = document.createElement('button'); b.className = 'menu-item dc-menu'; b.dataset.action = action; b.dataset.nav = ''; b.innerHTML = `${ico}<span class="mi-label">${label}</span><span class="mi-meta" id="${meta}"></span>`; return b; };
    const a = mk('dcVoice', ICO_VOC, 'Rejoindre le vocal', 'dvMenuMeta'), m = mk('dcMute', ICO_MIC, 'Couper le micro', 'dvMenuMute');
    if (before) { before.before(a); before.before(m); } else panel.append(a, m);
  }
  function menuUpdate() {
    const s = S.lib?.settings || {};
    const ready = !!((s.discordClientId && s.discordClientSecret) || RRShared.discord);
    const a = $('[data-action="dcVoice"]'), m = $('[data-action="dcMute"]');
    if (!a) return;
    a.hidden = !ready; m.hidden = !ready || !vs.inVoice; // le micro n'a de sens qu'une fois dans un salon
    $('.mi-label', a).textContent = vs.inVoice ? 'Quitter le vocal' : 'Rejoindre le vocal';
    $('.mi-label', m).textContent = vs.muted ? 'Réactiver le micro' : 'Couper le micro';
    tone(a, vs.inVoice); tone(m, vs.muted, vs.muted ? 'off' : 'on');
    $('#dvMenuMeta').textContent = vs.inVoice ? vs.name : (s.discordVoiceChannel?.name || '');
  }
  async function menuRun(mute) {
    closeAll(true);
    toast(mute ? 'Micro Discord…' : (vs.inVoice ? 'Sortie du vocal…' : 'Connexion au vocal…'), 'progress');
    const r = await rr.x(mute ? 'x:discordvoice:mute' : 'x:discordvoice:toggle', mute ? undefined : { notify: false });
    if (r && r.ok === false) return toast(`Vocal Discord : ${r.error}`, true);
    if (mute) { vs.muted = r.muted; toast(r.muted ? 'Micro coupé' : 'Micro activé', 'success'); }
    else { vs.inVoice = r.joined; vs.name = r.name || ''; vs.muted = false; toast(r.joined ? `Vocal rejoint : ${r.name}` : 'Vocal quitté', 'success'); }
    igUpdate(); menuUpdate();
  }
  RR.actions.dcVoice = () => menuRun(false);
  RR.actions.dcMute = () => menuRun(true);

  async function igRefresh() {
    const r = await rr.x('x:discordvoice:state').catch(() => null);
    if (r && r.ok !== false) { vs = { inVoice: !!r.inVoice, name: r.name || '', muted: !!r.muted }; igUpdate(); menuUpdate(); }
  }
  $('#ingame').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ig="dc-voice"], [data-ig="dc-mute"]');
    if (!b) return;
    e.stopImmediatePropagation();
    const id = IG.id, mute = b.dataset.ig === 'dc-mute';
    closeAll(true);
    rr.resumeGame(id); // on rend la main au jeu ; la notification Windows confirme
    const r = await rr.x(mute ? 'x:discordvoice:mute' : 'x:discordvoice:toggle', mute ? undefined : { delay: 300 });
    if (r && r.ok === false) toast(`Vocal Discord : ${r.error}`, true);
    else if (r) { if (mute) vs.muted = r.muted; else { vs.inVoice = r.joined; vs.name = r.name || ''; } igUpdate(); }
  }, true);
  rr.onX('x:discordvoice:done', (r) => {
    if (r && r.ok) { if ('muted' in r) vs.muted = r.muted; else if ('joined' in r) { vs.inVoice = r.joined; vs.name = r.name || ''; } igUpdate(); } if (document.visibilityState === 'visible' && r && r.ok === false) toast(`Vocal Discord : ${r.error}`, true); });

  // ---- Réglages (dans le bloc Discord existant)
  const host = $('#set-discord');
  const box = document.createElement('div');
  box.id = 'set-dvoice';
  host.append(box);
  box.innerHTML = `
    <h3 class="set-group">Discord — vocal à la manette</h3>
    <p class="set-note">Rejoins ou quitte un salon vocal, ou coupe ton micro, sans quitter le jeu : <b>Guide + X</b> (PS + □) rejoint / quitte, <b>Guide + A</b> (PS + ✕) coupe le micro. Une seule configuration, avec <b>ta propre application Discord</b> (celle de la Rich Presence) :
      <br/>1. Sur <a href="#" data-link="https://discord.com/developers/applications">discord.com/developers/applications</a> → ton application → <b>OAuth2</b> : ajoute l'adresse de redirection <code>http://127.0.0.1</code> et copie le <b>Client Secret</b>.
      <br/>2. Colle-le ci-dessous, clique sur <b>Connecter le vocal</b>, puis <b>Autoriser</b> dans la fenêtre Discord. Choisis ensuite ton salon.</p>
    <div class="setting col">
      <div><label for="dvSecret"><strong>Client Secret de l'application</strong></label><span class="dim">Gardé sur ce PC uniquement, jamais envoyé ailleurs qu'à Discord.</span></div>
      <input id="dvSecret" type="password" autocomplete="off" spellcheck="false" placeholder="Client Secret" data-nav />
    </div>
    <div class="setting">
      <div><strong id="dvState">Vocal non connecté</strong><span class="dim" id="dvSub">Discord de bureau ouvert requis.</span></div>
      <div class="v119-row"><button class="btn accent" id="dvConnect" data-nav>Connecter le vocal</button><button class="btn" id="dvLogout" data-nav>Déconnecter</button></div>
    </div>
    <div class="setting col">
      <div><strong>Salon à rejoindre</strong><span class="dim" id="dvChan">Aucun salon choisi.</span></div>
      <div class="v119-row"><select id="dvSelect" class="v119-input" data-nav><option value="">— charger mes salons —</option></select><button class="btn" id="dvLoad" data-nav>Charger mes salons</button><button class="btn" id="dvTest" data-nav>Tester</button></div>
    </div>
    <div class="setting">
      <div><strong id="lbDvPad">Raccourcis manette Guide + X / Guide + A</strong><span class="dim">Pendant un jeu, sans ouvrir le menu.</span></div>
      <button class="toggle" data-toggle="discordVoicePad" role="switch" aria-labelledby="lbDvPad" data-nav></button>
    </div>`;
  let channels = [];
  async function status() {
    const st = await rr.x('x:discordvoice:status');
    $('#dvState').textContent = st.authorized ? 'Vocal connecté' : st.configured ? 'Vocal non autorisé' : 'Vocal non configuré';
    $('#dvSub').textContent = st.authorized ? 'Autorisation enregistrée.' : st.configured ? 'Clique sur « Connecter le vocal » et autorise dans Discord.' : "Renseigne l'ID d'application (ci-dessus) et le Client Secret.";
    $('#dvChan').textContent = st.channel ? `${st.channel.name}${st.channel.guild ? ' — ' + st.channel.guild : ''}` : 'Aucun salon choisi.';
  }
  $('#dvSecret').addEventListener('change', async () => {
    await rr.setSettings({ discordClientSecret: $('#dvSecret').value.trim() });
    toast('Client Secret enregistré', 'success'); status(); igUpdate();
  });
  $('#dvConnect').addEventListener('click', async () => {
    toast('Autorise l’application dans la fenêtre Discord…', 'progress');
    const r = await rr.x('x:discordvoice:connect');
    toast(r.ok ? 'Vocal Discord connecté' : `Vocal Discord : ${r.error}`, r.ok ? 'success' : true);
    status();
  });
  $('#dvLogout').addEventListener('click', async () => { await rr.x('x:discordvoice:logout'); toast('Vocal déconnecté', 'success'); status(); });
  $('#dvLoad').addEventListener('click', async () => {
    const r = await rr.x('x:discordvoice:channels');
    if (!r.ok) return toast(`Vocal Discord : ${r.error}`, true);
    channels = r.channels;
    $('#dvSelect').innerHTML = `<option value="">— choisir un salon —</option>` + channels.map((c, i) => `<option value="${i}">${esc(c.guild)} · ${esc(c.name)}</option>`).join('');
    toast(`${channels.length} salon${channels.length > 1 ? 's' : ''} vocal${channels.length > 1 ? 'aux' : ''}`, 'success');
  });
  $('#dvSelect').addEventListener('change', async () => {
    const c = channels[Number($('#dvSelect').value)];
    if (!c) return;
    await rr.x('x:discordvoice:setChannel', c);
    toast(`Salon : ${c.name}`, 'success'); status(); igUpdate();
  });
  $('#dvTest').addEventListener('click', async () => {
    const r = await rr.x('x:discordvoice:toggle', { notify: false });
    toast(r.ok ? (r.joined ? `Salon rejoint : ${r.name}` : 'Salon quitté') : `Vocal Discord : ${r.error}`, r.ok ? 'success' : true);
  });

  function applyState(st) {
    const s = st.settings || {};
    if (s.discordVoicePad === undefined) rr.setSettings({ discordVoicePad: true });
    if (document.activeElement !== $('#dvSecret')) $('#dvSecret').value = s.discordClientSecret || '';
    igUpdate(); menuUpdate();
  }
  igInsert(); menuMount();
  RR.on('library', applyState);
  RR.on('mode', (m) => { if (m === 'menu') { menuUpdate(); igRefresh(); } if (m === 'ingame') { igUpdate(); igRefresh(); } if (m === 'settings') status(); });
  rr.getLibrary().then((st) => { applyState(st); status(); });
})();

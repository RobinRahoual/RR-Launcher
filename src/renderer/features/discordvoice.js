// Module DISCORDVOICE (renderer) — vocal Discord à la manette : réglages + entrées du menu en jeu.
// Côté main : src/features/discordvoice.js (canaux x:discordvoice:*). Guide + X = rejoindre / quitter, Guide + A = micro.
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICO_VOC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/></svg>';
  const ICO_MIC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  // ---- Menu en jeu
  function igInsert() {
    const main = $('#igMain');
    if (!main || $('[data-ig="dc-voice"]', main)) return;
    const quit = $('[data-ig="quit"]', main);
    quit.insertAdjacentHTML('beforebegin',
      `<button class="ig-item dc-ig" data-ig="dc-voice" role="menuitem" data-nav>${ICO_VOC}<span class="ig-label">Vocal Discord</span><span class="ig-meta" id="dvMeta">Rejoindre / quitter</span></button>`
      + `<button class="ig-item dc-ig" data-ig="dc-mute" role="menuitem" data-nav>${ICO_MIC}<span class="ig-label">Micro Discord</span><span class="ig-meta" id="dvMuteMeta">Couper / réactiver</span></button>`);
  }
  function igUpdate() {
    const s = S.lib?.settings || {};
    const ready = !!s.discordClientId && !!s.discordClientSecret;
    const pad = S.device === 'pad' && s.discordVoicePad !== false, ps = S.padType === 'ps';
    for (const k of ['dc-voice', 'dc-mute']) { const b = $(`[data-ig="${k}"]`); if (b) b.hidden = !ready; }
    const m = $('#dvMeta'), m2 = $('#dvMuteMeta');
    if (m) m.textContent = pad ? `${ps ? 'PS' : 'Guide'} + ${ps ? '□' : 'X'}` : (s.discordVoiceChannel?.name || 'Rejoindre / quitter');
    if (m2) m2.textContent = pad ? `${ps ? 'PS' : 'Guide'} + ${ps ? '✕' : 'A'}` : 'Couper / réactiver';
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
  }, true);
  rr.onX('x:discordvoice:done', (r) => { if (document.visibilityState === 'visible' && r && r.ok === false) toast(`Vocal Discord : ${r.error}`, true); });

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
    igUpdate();
  }
  igInsert();
  RR.on('library', applyState);
  RR.on('mode', (m) => { if (m === 'ingame') igUpdate(); if (m === 'settings') status(); });
  rr.getLibrary().then((st) => { applyState(st); status(); });
})();

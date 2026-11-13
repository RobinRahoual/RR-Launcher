// Module DISCORD — Rich Presence + stream Discord (Go Live) depuis le menu en jeu / Guide + Y.
// Côté main : src/features/discord.js (canaux x:discord:*).
(() => {
  const ICO_LIVE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="11" r="2.2"/><path d="M8.2 7.8a5 5 0 0 0 0 6.4M15.8 7.8a5 5 0 0 1 0 6.4"/></svg>';

  // ---- Menu en jeu : « Streamer sur Discord »
  function igInsert() {
    const main = $('#igMain');
    if (!main || $('[data-ig="dc-stream"]', main)) return;
    const quit = $('[data-ig="quit"]', main);
    quit.insertAdjacentHTML('beforebegin', `<button class="ig-item dc-ig" data-ig="dc-stream" role="menuitem" data-nav>${ICO_LIVE}<span class="ig-label">Streamer sur Discord</span><span class="ig-meta" id="dcMeta">Go Live</span></button>`);
  }
  function igUpdate() {
    const b = $('[data-ig="dc-stream"]');
    if (!b) return;
    const s = S.lib?.settings || {};
    b.hidden = s.discordStream === false;
    const pad = S.device === 'pad', ps = S.padType === 'ps';
    $('#dcMeta').textContent = pad && s.discordStreamPad !== false ? `${ps ? 'PS' : 'Guide'} + ${ps ? '△' : 'Y'}` : (s.discordStreamKeys || '');
  }
  $('#ingame').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ig="dc-stream"]');
    if (!b) return;
    e.stopImmediatePropagation();
    // On rend la main au jeu d'abord : Discord partage la fenêtre au premier plan
    const id = IG.id;
    closeAll(true);
    rr.resumeGame(id);
    const r = await rr.x('x:discord:stream', { delay: 700 });
    if (!r?.ok) toast(`Stream Discord : ${r?.error || 'échec'}`, true);
  }, true);
  rr.onX('x:discord:streamed', (r) => {
    if (document.visibilityState === 'visible' && r && !r.ok) toast(`Stream Discord : ${r.error}`, true);
  });

  // ---- Réglages
  $('#set-discord').innerHTML = `
    <h3 class="set-group">Discord</h3>
    <div class="setting">
      <div><strong id="lbDcRpc">Afficher le jeu sur Discord (Rich Presence)</strong><span class="dim">« Joue à … » sur ton profil, avec la console et la durée. L'application Discord de bureau doit être ouverte.</span></div>
      <button class="toggle" data-toggle="discordRpc" role="switch" aria-labelledby="lbDcRpc" data-nav></button>
    </div>
    <div class="setting col">
      <div><label for="dcClient"><strong>ID d'application Discord</strong></label>
        <span class="dim">Gratuit : <a href="#" data-link="https://discord.com/developers/applications">discord.com/developers/applications</a> → New Application (nomme-la « RR Launcher », c'est le nom affiché) → copie l'<b>Application ID</b>. Optionnel : dans <i>Rich Presence → Art Assets</i>, ajoute une image nommée <code>logo</code>.</span></div>
      <div class="dc-row"><input id="dcClient" inputmode="numeric" placeholder="Ex. 1234567890123456789" autocomplete="off" spellcheck="false" data-nav /><button class="btn" id="dcTest" data-nav>Tester</button></div>
    </div>
    <div class="setting">
      <div><strong id="lbDcStream">Stream Discord depuis le menu en jeu</strong><span class="dim">Lance ou arrête ton partage d'écran (Go Live) quand tu es déjà en vocal, sans quitter le jeu.</span></div>
      <button class="toggle" data-toggle="discordStream" role="switch" aria-labelledby="lbDcStream" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbDcPad">Raccourci manette Guide + Y (PS + △)</strong><span class="dim">Pendant un jeu, lance / arrête le stream directement.</span></div>
      <button class="toggle" data-toggle="discordStreamPad" role="switch" aria-labelledby="lbDcPad" data-nav></button>
    </div>
    <div class="setting col">
      <div><label for="dcKeys"><strong>Raccourci Discord du stream</strong></label>
        <span class="dim">À créer une fois dans Discord → Paramètres → <b>Raccourcis clavier</b> → Ajouter un raccourci → action « Démarrer / arrêter le stream » (ou « Go Live ») → enregistre <b>exactement</b> la même combinaison. Le launcher l'appuie à ta place.</span></div>
      <input id="dcKeys" placeholder="Ctrl+Shift+F9" autocomplete="off" spellcheck="false" data-nav />
    </div>`;
  $('#dcClient').addEventListener('change', () => {
    const v = $('#dcClient').value.replace(/\D/g, '');
    $('#dcClient').value = v;
    rr.setSettings({ discordClientId: v });
    toast(v ? 'ID Discord enregistré' : 'ID Discord retiré', 'success');
  });
  $('#dcKeys').addEventListener('change', () => {
    const v = $('#dcKeys').value.trim().replace(/\s*\+\s*/g, '+');
    $('#dcKeys').value = v;
    rr.setSettings({ discordStreamKeys: v || 'Ctrl+Shift+F9' });
    toast('Raccourci enregistré — mets le même dans Discord', 'success');
  });
  $('#dcTest').addEventListener('click', async () => {
    toast('Connexion à Discord…', 'progress');
    const r = await rr.x('x:discord:test');
    toast(r?.ok ? 'Discord connecté : regarde ton profil' : `Discord : ${r?.error || 'échec'}`, r?.ok ? 'success' : true);
  });

  function applyState(st) {
    const s = st.settings || {};
    const defaults = {};
    for (const k of ['discordRpc', 'discordStream', 'discordStreamPad']) if (s[k] === undefined) defaults[k] = true;
    if (Object.keys(defaults).length) rr.setSettings(defaults);
    if (document.activeElement !== $('#dcClient')) $('#dcClient').value = s.discordClientId || '';
    if (document.activeElement !== $('#dcKeys')) $('#dcKeys').value = s.discordStreamKeys || 'Ctrl+Shift+F9';
    igUpdate();
  }
  igInsert();
  RR.on('library', applyState);
  RR.on('mode', (m) => { if (m === 'ingame') igUpdate(); });
  rr.getLibrary().then(applyState);
})();

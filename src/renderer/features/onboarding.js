// Module ONBOARDING (renderer) — assistant de premier lancement : Epic, visuels (SteamGridDB / TheGamesDB), Discord,
// streaming, import des jeux. Chaque étape est facultative. Se rouvre via Menu → « Assistant de démarrage ».
// Réglages touchés : sgdbKey, tgdbKey, discordClientId, discordClientSecret, discordVoiceChannel, onboardingDone.
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (url, label) => `<a href="#" data-link="${esc(url)}">${esc(label)}</a>`;
  const ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.3 5.8L12 16l-5 3 1.3-5.8L4 9.3l5.6-.7z"/></svg>';

  const ov = document.createElement('div');
  ov.className = 'overlay center'; ov.id = 'onboarding'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'obTitle');
  ov.innerHTML = '<div class="panel wide ob-panel"></div>';
  ($('#prompt') ? $('#prompt').before(ov) : document.body.append(ov));
  OVERLAYS.onboarding = '#onboarding';
  const panel = $('.panel', ov);

  const set = (o) => rr.setSettings(o);
  const val = (k) => S.lib?.settings?.[k] || '';
  let step = 0, channels = [], list = null, recap = null;

  const STEPS = [
    { id: 'hello', title: 'Bienvenue dans RR Launcher',
      html: () => `<p>Quelques minutes pour tout connecter : <b>Epic Games</b>, les <b>visuels</b> (SteamGridDB, TheGamesDB), <b>Discord</b> et le <b>streaming</b> vers un autre écran.</p>
        <p class="dim">Chaque étape est facultative : passe celles qui ne t'intéressent pas. Tu pourras tout refaire plus tard dans Réglages, ou relancer cet assistant depuis le menu.</p>
        ${recap ? `<ul class="ob-list">${recap.map((r) => `<li>${r.ok ? '✓' : '○'} ${esc(r.label)}</li>`).join('')}</ul>${recap.some((r) => !r.ok) ? '<div class="ob-row"><button class="btn primary" id="obMissing" data-nav>Configurer seulement ce qui manque</button></div>' : ''}` : ''}
        <p class="dim">Pour coller une clé ou un identifiant à la manette, utilise le clavier de Windows (Win + Ctrl + O) ou le copier-coller depuis ton navigateur.</p>` },
    { id: 'stores', title: 'Steam, Epic Games, GOG',
      html: () => `<ul class="ob-list">
        <li><b>Steam</b> : rien à faire. Tes heures de jeu sont lues directement sur ce PC (Steam doit y être installé).</li>
        <li><b>GOG Galaxy et itch.io</b> : pareil, lus automatiquement.</li>
        <li><b>Epic Games</b> : Epic ne garde pas tes heures sur le PC, il faut connecter ton compte. Une fenêtre officielle d'Epic s'ouvre ; ton mot de passe n'est jamais enregistré.</li></ul>
        <div class="ob-row"><button class="btn primary" id="obEpic" data-nav>Connecter mon compte Epic</button><span class="dim" id="obEpicState"></span></div>` },
    { id: 'art', title: 'Visuels : jaquettes, fonds, logos',
      html: () => `<p class="dim">Facultatif et gratuit. Sans clé, Steam, libretro et Wikipédia suffisent pour la plupart des jeux ; les clés ajoutent des jaquettes et surtout le dos des boîtes.</p>
        <div class="ob-block"><h4>SteamGridDB <i>(fonds, logos, jaquettes)</i></h4>
          <ol class="ob-ol"><li>Crée un compte (gratuit) sur ${link('https://www.steamgriddb.com', 'steamgriddb.com')}.</li><li>Ouvre ${link('https://www.steamgriddb.com/profile/preferences/api', 'Profil → Préférences → API')} et copie ta clé.</li><li>Colle-la ici :</li></ol>
          <input id="obSgdb" type="password" placeholder="Clé API SteamGridDB" value="${esc(val('sgdbKey'))}" autocomplete="off" spellcheck="false" data-nav /></div>
        <div class="ob-block"><h4>TheGamesDB <i>(dos des boîtes)</i></h4>
          <ol class="ob-ol"><li>Demande une clé sur ${link('https://forums.thegamesdb.net/viewforum.php?f=10', 'le forum de TheGamesDB')} (la réponse peut prendre quelques jours : tu peux revenir plus tard).</li><li>Colle-la ici :</li></ol>
          <input id="obTgdb" type="password" placeholder="Clé API TheGamesDB" value="${esc(val('tgdbKey'))}" autocomplete="off" spellcheck="false" data-nav /></div>` },
    { id: 'discord', title: 'Discord : présence, vocal à la manette',
      html: () => window.RRShared?.discord ? `<p>L'application Discord de RR Launcher est déjà fournie : rien à créer. Garde Discord ouvert, clique ci-dessous puis <b>Autoriser</b>.</p>
        <p class="dim">Si Discord refuse l'autorisation, demande à Robin de t'ajouter comme testeur de l'application.</p>
        <div class="ob-row"><button class="btn primary" id="obDcConnect" data-nav>Connecter le vocal</button><span class="dim" id="obDcState"></span></div>
        <div class="ob-row"><select id="obDcSel" data-nav><option value="">— charge tes salons —</option></select><button class="btn" id="obDcLoad" data-nav>Charger mes salons</button></div>` : `<p class="dim">Facultatif. Affiche ton jeu sur ton profil et permet de rejoindre un salon vocal, couper le micro ou lancer un stream sans quitter le jeu. Il faut ta propre application Discord (gratuite, 2 minutes). Garde l'application Discord de bureau ouverte.</p>
        <ol class="ob-ol">
          <li>Ouvre ${link('https://discord.com/developers/applications', 'discord.com/developers/applications')} → <b>New Application</b> → nomme-la « RR Launcher ».</li>
          <li>Sur la page <b>General Information</b>, copie l'<b>Application ID</b> et colle-le ici :
            <input id="obDcId" inputmode="numeric" placeholder="Ex. 1234567890123456789" value="${esc(val('discordClientId'))}" autocomplete="off" spellcheck="false" data-nav /></li>
          <li>Onglet <b>OAuth2</b> → <b>Redirects</b> → <b>Add Redirect</b> : <code>http://127.0.0.1</code> → <b>Save Changes</b>.</li>
          <li>Toujours dans OAuth2, <b>Reset Secret</b> puis copie le <b>Client Secret</b> :
            <input id="obDcSecret" type="password" placeholder="Client Secret" value="${esc(val('discordClientSecret'))}" autocomplete="off" spellcheck="false" data-nav /></li>
          <li>Clique ci-dessous, puis <b>Autoriser</b> dans la fenêtre Discord :
            <div class="ob-row"><button class="btn primary" id="obDcConnect" data-nav>Connecter le vocal</button><span class="dim" id="obDcState"></span></div></li>
          <li>Choisis le salon que la manette rejoint :
            <div class="ob-row"><select id="obDcSel" data-nav><option value="">— charge tes salons —</option></select><button class="btn" id="obDcLoad" data-nav>Charger mes salons</button></div></li>
        </ol>` },
    { id: 'stream', title: 'Streaming vers une TV, un téléphone…',
      html: () => `<p class="dim">Facultatif. <b>Apollo</b> diffuse ton PC, <b>Moonlight</b> (ou Artemis) reçoit le flux sur l'autre écran.</p>
        <ol class="ob-ol">
          <li>Installe Apollo sur ce PC (une confirmation Windows est demandée, environ 1 minute) : <div class="ob-row"><button class="btn" id="obApollo" data-nav>Installer Apollo</button><span class="dim" id="obApolloState"></span></div></li>
          <li>Installe Moonlight sur l'écran qui reçoit : <div class="ob-row"><button class="btn" id="obMoon" data-nav>Télécharger Moonlight</button></div></li>
        </ol>
        <p class="dim">La suite (objectif, mesure de la connexion, configuration automatique, appairage, ajout de tes jeux) se fait dans Réglages → Fonctions → Streaming.</p>` },
    { id: 'import', title: 'Importer tes jeux',
      html: () => `<p>Dernière étape : récupère les jeux déjà installés sur ce PC (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, itch…), puis ajoute des ROMs ou des dossiers si tu veux.</p>
        <div class="ob-row"><button class="btn primary" id="obImport" data-nav>Importer mes jeux maintenant</button></div>
        <p class="dim">Tu peux aussi le faire plus tard : Menu → Ajouter des jeux.</p>` },
  ];

  function render() {
    const s = list[step], last = step === list.length - 1, first = step === 0;
    panel.innerHTML = `
      <div class="ob-head"><span class="ob-ico">${ICO}</span><div><h2 id="obTitle">${esc(s.title)}</h2><span class="dim">Étape ${step + 1} sur ${list.length}</span></div></div>
      <div class="ob-dots" aria-hidden="true">${list.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div>
      <div class="ob-body">${s.html()}</div>
      <div class="ew-foot ob-foot">
        ${first ? '<button class="btn" id="obSkipAll" data-nav>Tout passer</button>' : '<button class="btn" id="obBack" data-nav>Précédent</button>'}
        <span class="ob-spacer"></span>
        ${first || last ? '' : '<button class="btn" id="obSkip" data-nav>Passer cette étape</button>'}
        <button class="btn primary" id="obNext" data-nav data-default>${first ? 'Commencer' : last ? 'Terminer' : 'Suivant'}</button>
      </div>`;
    bind(s.id);
    setTimeout(() => { const d = $('#obNext', panel); if (d) setFocus(d); }, 20);
  }
  const go = (n) => { step = Math.max(0, Math.min(list.length - 1, n)); render(); const b = $('.ob-body', panel); if (b) b.scrollTop = 0; };
  const finish = (importNow) => { set({ onboardingDone: true }); closeOverlay(true); if (importNow) setTimeout(() => action('scanLaunchers'), 150); };

  async function bind(id) {
    const on = (sel, ev, fn) => { const el = $(sel, panel); if (el) el.addEventListener(ev, fn); };
    if (id === 'stores') {
      const st = await rr.x('x:playtime:status').catch(() => null);
      const t = $('#obEpicState', panel);
      if (t && st?.epic?.connected) { t.textContent = `Connecté${st.epic.name ? ` : ${st.epic.name}` : ''}`; $('#obEpic', panel).textContent = 'Reconnecter'; }
      on('#obEpic', 'click', async (e) => {
        e.target.disabled = true; toast('Connecte-toi dans la fenêtre Epic Games qui s’ouvre');
        const r = await rr.x('x:playtime:epicLogin').catch((er) => ({ ok: false, error: er.message }));
        e.target.disabled = false;
        if (r?.ok) { $('#obEpicState', panel).textContent = `Connecté${r.name ? ` : ${r.name}` : ''}`; toast('Compte Epic connecté', 'success'); }
        else if (!r?.cancelled) toast(r?.error || 'Connexion Epic impossible', true);
      });
    } else if (id === 'art') {
      on('#obSgdb', 'change', () => { const v = $('#obSgdb', panel).value.trim(); set({ sgdbKey: v }); toast(v ? 'Clé SteamGridDB enregistrée' : 'Clé retirée', 'success'); });
      on('#obTgdb', 'change', () => { const v = $('#obTgdb', panel).value.trim(); set({ tgdbKey: v }); toast(v ? 'Clé TheGamesDB enregistrée' : 'Clé retirée', 'success'); });
    } else if (id === 'discord') {
      on('#obDcId', 'change', () => set({ discordClientId: $('#obDcId', panel).value.trim() }));
      on('#obDcSecret', 'change', () => set({ discordClientSecret: $('#obDcSecret', panel).value.trim() }));
      const flush = async () => { if ($('#obDcId', panel)) await set({ discordClientId: $('#obDcId', panel).value.trim(), discordClientSecret: $('#obDcSecret', panel).value.trim() }); };
      const info = (m, ok) => { const t = $('#obDcState', panel); if (t) { t.textContent = m; t.classList.toggle('ob-ok', !!ok); } };
      on('#obDcConnect', 'click', async (e) => {
        await flush(); e.target.disabled = true; info('Autorise l’application dans la fenêtre Discord…');
        const r = await rr.x('x:discordvoice:connect').catch((er) => ({ ok: false, error: er.message }));
        e.target.disabled = false; info(r.ok ? 'Vocal connecté' : r.error, r.ok);
      });
      on('#obDcLoad', 'click', async () => {
        await flush();
        const r = await rr.x('x:discordvoice:channels').catch((er) => ({ ok: false, error: er.message }));
        if (!r.ok) return info(r.error);
        channels = r.channels;
        const sel = $('#obDcSel', panel);
        sel.innerHTML = '<option value="">— choisir un salon —</option>' + channels.map((c, i) => `<option value="${i}">${esc(c.guild)} · ${esc(c.name)}</option>`).join('');
        const cur = val('discordVoiceChannel')?.id; const k = channels.findIndex((c) => c.id === cur); if (k >= 0) sel.value = String(k);
      });
      on('#obDcSel', 'change', async () => { const c = channels[Number($('#obDcSel', panel).value)]; if (c) { await rr.x('x:discordvoice:setChannel', c); info(`Salon : ${c.name}`, true); } });
      const cur = S.lib?.settings?.discordVoiceChannel; if (cur?.name) info(`Salon actuel : ${cur.name}`, true);
    } else if (id === 'stream') {
      const st = await rr.x('x:stream:status').catch(() => null);
      const t = $('#obApolloState', panel);
      if (t && st) t.textContent = st.apollo?.installed ? 'Apollo est déjà installé' : '';
      on('#obApollo', 'click', async (e) => {
        e.target.disabled = true; toast('Installation d’Apollo… (environ 1 minute)', 'progress');
        const r = await rr.x('x:stream:install').catch((er) => ({ ok: false, error: er.message }));
        e.target.disabled = false;
        if (r.ok) { if (t) t.textContent = 'Apollo est installé'; toast(r.rebootAdvised ? 'Apollo installé — redémarre le PC pour activer l’écran virtuel' : 'Apollo installé', 'success'); }
        else toast(r.error || 'Installation échouée', true);
      });
      on('#obMoon', 'click', () => rr.x('x:stream:installMoonlight'));
    } else if (id === 'import') {
      on('#obImport', 'click', () => finish(true));
    }
    on('#obMissing', 'click', () => { list = [STEPS[0], ...STEPS.filter((x) => recap?.find((r) => r.id === x.id && !r.ok))]; go(1); });
    on('#obNext', 'click', () => (step === list.length - 1 ? finish(false) : go(step + 1)));
    on('#obSkip', 'click', () => go(step + 1));
    on('#obBack', 'click', () => go(step - 1));
    on('#obSkipAll', 'click', () => { finish(false); toast('Assistant ignoré : tu le retrouves dans le menu (Assistant de démarrage)', 'info'); });
  }

  async function status() {
    const st = S.lib?.settings || {};
    const [pt, sm] = await Promise.all([rr.x('x:playtime:status').catch(() => null), rr.x('x:stream:status').catch(() => null)]);
    return [
      { id: 'stores', label: 'Compte Epic Games', ok: !!pt?.epic?.connected },
      { id: 'art', label: 'Clés de visuels (SteamGridDB / TheGamesDB)', ok: !!(st.sgdbKey || st.tgdbKey) },
      { id: 'discord', label: 'Discord (application + salon vocal)', ok: !!(st.discordClientId && st.discordClientSecret && st.discordVoiceChannel?.id) },
      { id: 'stream', label: 'Streaming (Apollo)', ok: !!sm?.apollo?.installed },
      { id: 'import', label: 'Jeux importés', ok: (S.lib?.games || []).length > 0 },
    ];
  }
  function open(withRecap) { step = 0; list = STEPS; render(); openOverlay('onboarding'); if (withRecap) status().then((r) => { recap = r; if (step === 0) render(); }); else recap = null; }
  RR.actions.onboarding = () => { closeAll(); recap = null; open(true); };

  // Entrée du menu principal
  const settingsItem = $('#menu .panel [data-action="settings"]');
  if (settingsItem && !$('#menu [data-action="onboarding"]')) settingsItem.insertAdjacentHTML('beforebegin', `<button class="menu-item" data-action="onboarding" data-nav>${ICO}<span class="mi-label">Assistant de démarrage</span></button>`);

  // Premier lancement uniquement : après la personnalisation du profil, quand plus rien ne s'affiche
  let decided = false;
  function decide(st) {
    if (decided) return;
    const s = st?.settings || {};
    if (s.onboardingDone !== undefined) { decided = true; return; }
    // Installation existante (profil déjà configuré ou jeux déjà présents) : l'assistant ne s'impose pas
    if (s.profileSetupDone || (st.games || []).length) { decided = true; set({ onboardingDone: true }); return; }
    decided = true;
    const t0 = performance.now();
    const tryOpen = () => {
      if (S.lib?.settings?.onboardingDone) return;
      const profileDone = !!S.lib?.settings?.profileSetupDone;
      if (!profileDone && performance.now() - t0 < 20000) return setTimeout(tryOpen, 400);
      if (shellSplashActive() || LD.active || BO.busy || S.mode !== 'main' || (S.lib.running || []).length) return setTimeout(tryOpen, 500);
      set({ onboardingDone: true }); // ne s'impose qu'une fois, même fermé avec Échap
      open();
    };
    setTimeout(tryOpen, 1200);
  }
  rr.getLibrary().then(decide).catch(() => {});
})();

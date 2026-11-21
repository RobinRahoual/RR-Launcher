// Module STORES (renderer) — Epic / GOG : lancement direct. Côté main : src/features/importer/stores.js (+ main.js/launchGame).
(() => {
  'use strict';
  const box = document.createElement('div');
  box.id = 'set-stores';
  $('#set-v119').append(box);
  box.innerHTML = `
    <h3 class="set-group">Epic Games &amp; GOG</h3>
    <div class="setting">
      <div><strong id="lbEpicDirect">Epic : lancer directement (sans ouvrir le client)</strong><span class="dim">Lance l'exécutable du jeu. Ne convient qu'aux jeux sans protection Epic ; sinon laisse désactivé (réglable jeu par jeu dans les options de lancement).</span></div>
      <button class="toggle" data-toggle="epicDirect" role="switch" aria-labelledby="lbEpicDirect" data-nav></button>
    </div>
    <div class="setting">
      <div><strong id="lbGogGalaxy">GOG : lancer via Galaxy</strong><span class="dim">Succès, sauvegardes cloud et overlay. Par défaut le jeu est lancé directement, sans Galaxy.</span></div>
      <button class="toggle" data-toggle="gogGalaxy" role="switch" aria-labelledby="lbGogGalaxy" data-nav></button>
    </div>
    <p class="set-note">Importer : <b>Menu → Ajouter des jeux → Launchers installés</b> (ou « Épic » / « GOG » seuls) ; relancer l'import complète les jeux déjà présents.</p>`;
})();

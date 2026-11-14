# RR Launcher

Launcher façon console pour jeux PC et émulation : accueil avec choix de la console, carrousel horizontal de boîtes 3D au format de chaque support, fond assombri tiré du jeu, sons d'interface, navigation manette / clavier / souris.

## Installation

Télécharge `RR-Launcher-Setup-x.y.z.exe` depuis la [dernière release](https://github.com/RobinRahoual/RR-Launcher/releases/latest) et lance-le. L'installateur n'est pas signé : si Windows SmartScreen s'affiche, clique sur **Informations complémentaires → Exécuter quand même**.

## Consoles & émulation

L'accueil est une roue à gauche qui tourne verticalement (↑ ↓, molette, stick) : la console sélectionnée est au bord de la roue et ses jeux s'affichent à droite. En ouvrant une console, la roue glisse à gauche et laisse la place à la rangée de jeux ; ← sur le premier jeu, B/Échap ou un clic sur la roue y reviennent. La photo et le logo officiel de chaque console sont téléchargés depuis Wikipédia/Wikimedia sur le PC au premier affichage (ils ne font pas partie du dépôt) ; tu peux les remplacer dans **Réglages → Consoles & émulateurs → Image / Logo**. Le logo s'affiche sur le bandeau et la tranche des boîtes, sur l'accueil et en en-tête. Les boîtes reprennent le format de chaque support : DVD (PC, PS2, Xbox, Wii…), Blu-ray (PS3), petits boîtiers (Switch, PSP, DS, GameCube), boîtier CD (PlayStation, Dreamcast) ou carton (NES, SNES, N64, Game Boy).

Consoles gérées : Switch, Switch 2, Wii U, Wii, GameCube, N64, SNES, NES, Game Boy / Color, GBA, DS, 3DS, PlayStation 1/2/3, PSP, PS Vita, Xbox, Xbox 360, Dreamcast, Mega Drive.

Pour chaque console, choisis l'exécutable de l'émulateur (Réglages → Consoles & émulateurs, ou au premier lancement d'un jeu). Les arguments sont préremplis pour RPCS3, PCSX2, DuckStation, Dolphin, Cemu, Ryujinx, Eden/Citron, PPSSPP, xemu, Xenia, Azahar/Citra, melonDS, mGBA, Mesen, Snes9x, Project64, simple64, ares, Flycast, BlastEm, Vita3K et RetroArch ; `{rom}` est remplacé par le chemin du jeu.

**Configuration automatique** : **Réglages → Fonctions → Émulateurs → Configurer…** (ou « Installer automatiquement » quand tu lances un jeu sans émulateur, ou le bouton « Configurer » de l'écran jeux) installe l'émulateur conseillé dans `%LOCALAPPDATA%\RR Launcher\emulators\` : RetroArch stable + le cœur adapté (NES, SNES, Game Boy, GBA, N64, Mega Drive, PlayStation, Dreamcast), PCSX2, DuckStation, RPCS3, Azahar, melonDS, Cemu, xemu, Xenia Canary, Vita3K (dernière release GitHub). Dolphin, PPSSPP, Eden, Citron et Ryujinx : lien vers le site officiel. Progression en Mo, annulation, reprise du téléchargement, contrôle de taille / SHA-256 / archive, « Mettre à jour ». Les **BIOS** ne sont jamais téléchargés : l'assistant indique ceux qui manquent et le dossier où les mettre.

**Sauvegardes d'état** : dans le menu en jeu, « Sauvegarde rapide », « Charger la sauvegarde » et l'emplacement (− / +). RetroArch passe par ses commandes réseau (UDP 55355, activées dans `retroarch.cfg`), les autres émulateurs par leurs raccourcis clavier par défaut (modifiables : Réglages → Fonctions → Raccourcis de sauvegarde). Options : sauvegarde automatique avant « Quitter le jeu », **Guide + ↑ / ↓** à la manette (désactivé par défaut).

**Options de lancement** (page du jeu) : émulateur propre au jeu (ex. un autre cœur RetroArch), arguments supplémentaires, variables d'environnement, plein écran (émulateurs qui ont une option en ligne de commande), résolution interne (Dolphin), lancement en administrateur (UAC ; pas de variables d'environnement ni de raccourcis de sauvegarde dans ce cas).

Les portages recompilés (.exe) peuvent être rangés sous leur console d'origine : ajoute l'exe et choisis la console.

**Switch 2** : les dumps ont le même format que la Switch (`.nsp`, `.xci`…). Range-les dans un dossier dont le nom contient *Switch 2*, *Switch2* ou *NS2* (ex. `ROMs\Switch 2\`) pour qu'ils soient classés sous Switch 2 au scan, ou choisis la console à l'ajout. Les archives `.nup` (un seul fichier jeu + mise à jour + DLC, créées par Fritchii / Lichii) vont directement sous Switch 2. Émulateurs : **Fritchii** (conseillé, réglé pour Ocarina of Time) et **Lichii**, installés automatiquement depuis leurs releases GitHub (exécutable `lichii.exe`, lancé avec `-f -g "{rom}"`) ; Eden reste au choix. Les clés et le firmware de ta console s'installent depuis l'émulateur (Outils → Installer les clés / le firmware). Fritchii peut se mettre à jour au démarrage et se relancer : le launcher suit son dossier pour ne pas couper la session.

## Recomps (catalogue de recomp & émulateurs)

**Menu → Recomps** (touche `R`, ou la carte « Recomps » dans Ajouter des jeux) : **tout le catalogue de [RecompLauncher](https://recomplauncher.com)** (plus de 600 recomp, décompilations et portages PC : Zelda 64: Recompiled, Ship of Harkinian, Unleashed Recompiled, Skate 3 Recomp, OpenGOAL…), lu depuis son fichier public `pc-catalog.json`, gardé dans `%APPDATA%\RR Launcher\recomp-catalog.json` et relu toutes les 6 h (ou « Actualiser le catalogue »). Hors ligne : la dernière copie.

**Étagères** : une étagère par console (plaque au nom de la console, raccourcis en haut), jaquettes de face ; recherche, filtres Tout / Installables / Installés ; les projets à venir ou sans version Windows / release GitHub sont atténués (leur fiche renvoie à la page du projet). Choisir une boîte joue la même ouverture que la liste des jeux : la boîte s'ouvre, le disque ou la cartouche de la console d'origine sort en tournant, puis la fiche s'affiche (A saute l'animation, B l'annule). « Remettre sur le rayon » (B / Échap) y repose la jaquette.

**Émulateurs** (onglet) : les consoles en 3D sur leur socle (photo de la console, inclinaison qui suit la souris) ; un clic pose la console en grand et propose d'installer l'émulateur conseillé (choix de l'émulateur, progression, BIOS à fournir), de choisir un exe existant ou de mettre à jour. « Vue en liste » ouvre l'assistant habituel.

1. **Ta copie du jeu** : tu choisis ta ROM, ton image disque ou ton dossier, selon ce que demande la recomp (manifeste `recomplauncher.json` du projet). Les ROM N64 (`.z64`, `.v64`, `.n64`) et les disques GameCube sont vérifiés par leur en-tête (bon jeu, bonne région). Aucun jeu n'est jamais téléchargé.
2. **Installer** : dernière release GitHub des auteurs (archive Windows choisie automatiquement, SHA-256 contrôlé quand GitHub le publie), extraite dans `%LOCALAPPDATA%\RR Launcher\recomps\<recomp>`. Le programme, les arguments (`{game}` = ta copie) et les variables d'environnement viennent du manifeste ; pour les portages qui lisent la ROM dans leur dossier (HarbourMasters, Perfect Dark), elle y est copiée au bon nom. Le jeu apparaît sous sa console d'origine.
3. **Jouer** : depuis la fiche ou la bibliothèque ; pour les recomp qui demandent la ROM au premier lancement (« Select ROM »), le chemin de ta copie est mis dans le presse-papiers.

Mises à jour (« Rechercher une mise à jour », les fichiers ajoutés dans le dossier sont conservés), désinstallation (dossier + entrée de la bibliothèque, ta copie d'origine n'est pas touchée). `src/features/recomp/recomps.json` complète le catalogue (vérification des ROM N64 / GameCube, descriptions en français) et sert de secours sans connexion.


## Ajouter un jeu

`N` (clavier), bouton **View/Share** (manette) ou **Menu → Ajouter des jeux** :

- **Un jeu ou une ROM** : `.exe`, `.lnk`, ROM, ISO/CHD/CUE, `EBOOT.BIN` (PS3)… ou glisser-déposer sur la fenêtre. La console est devinée d'après l'extension et le dossier (`PS2`, `GameCube`…).
- **Launchers installés** : Steam, Epic, GOG, Xbox / Game Pass, EA app, Ubisoft Connect, Battle.net, Amazon Games et itch.io, en lecture locale (aucun compte). Fiabilité : haute pour Xbox, Ubisoft, Amazon, itch.io (SQLite lu en JS pur) ; moyenne pour Battle.net (`product.db` protobuf décodé par heuristique, produits connus seulement) et EA app (`__Installer\installerdata.xml` dans les dossiers usuels, la base chiffrée d'EA n'est pas lue).
- **Nettoyer la bibliothèque** (menu ou Réglages → Fonctions) : doublons à fusionner, jeux désinstallés, visuels manquants, métadonnées en échec ; confirmation avant retrait.
- **Scanner des dossiers** / **tout le PC** : trouve les jeux PC (un exe par dossier de jeu), les ROMs, les dumps PS3 (titre lu dans `PARAM.SFO`) et les émulateurs, qui sont configurés automatiquement. Tu coches ce que tu veux ajouter.

Le scan vérifie chaque fichier par son **contenu** (en-tête de la ROM) et pas seulement son extension : un `README.md`, un `.wad` de Doom ou un `.iso` d'installation Windows ne sont pas proposés. Pour les **.exe**, seuls les dossiers qui contiennent des indices de jeu (moteur Unity / Unreal / Godot / Ren'Py / RPG Maker, `steam_api`, GOG Galaxy, Epic Online Services, Bink, FMOD…) sont retenus ; les logiciels (Electron, Qt, Python, Adobe, Microsoft, Blender…) sont ignorés. Un exe sans indice rangé dans un dossier *Jeux* / *Games* est proposé **non coché** (« À VÉRIFIER »). Les images `.chd` / `.cue` sans console reconnaissable sont classées d'après le nom du dossier (`PS1`, `PS2`, `Dreamcast`…).

Les noms collés (`RedDeadRedemption2`) sont redécoupés (« Red Dead Redemption 2 ») et le résultat retenu est celui dont le titre est le plus proche — jamais un autre jeu de la série. Pour un jeu nommé en français (« Pokémon Émeraude »), le titre anglais est retrouvé via Wikipédia (« Pokémon Emerald ») pour interroger TheGamesDB, libretro-thumbnails (recherche dans la liste complète des jaquettes No-Intro / Redump) et Wikipédia EN.

Le launcher télécharge alors tout seul : jaquette, image de fond, logo, description, développeur, date, genres et captures d'écran.

**Sources** : Steam (jeux PC, en français) ; TheGamesDB (clé gratuite optionnelle : vrais scans du **dos des boîtes** et jaquettes console) ; libretro-thumbnails (ROMs nommées No-Intro/Redump) ; SteamGridDB (clé gratuite optionnelle, utile pour les consoles et les jeux hors Steam) ; Wikipédia (descriptions et jaquettes console). Sans jaquette, une jaquette est générée à partir du fond et du logo.

Mauvais jeu trouvé ? **Détails → Corriger le jeu**. Image à changer (jaquette, dos, fond, logo) ? **Détails → Images**. Après avoir ajouté une clé API : **Réglages → Métadonnées → Re-télécharger tous les visuels** (les images choisies à la main sont conservées).

## Commandes

| Action | Manette | Clavier | Souris |
|---|---|---|---|
| Changer de console (accueil) | Stick / croix ▲▼ | ↑ ↓ | Molette, clic |
| Naviguer dans les jeux | Stick / croix ◀▶ | ← → | Molette, clic |
| Jouer | A / ✕ | Entrée | Double-clic |
| Détails | X / □ ou ▲ | I ou ↑ | Clic sur la boîte sélectionnée |
| Retourner la boîte | Y / △ | Espace | |
| Catégories | LB / RB | Tab, Q / E | Clic sur l'onglet |
| Sauter de 5 jeux | LT / RT | Page ↑ / ↓ | |
| Retour aux consoles | B / ○ | Échap | Flèche en haut à gauche |
| Ajouter des jeux | View / Share | N | Menu |
| Recomps | | R | Menu |
| Favori | | F | Détails |
| Menu | Menu / Options | M (Échap sur l'accueil) | Bouton Menu |
| Réduire en arrière-plan | Menu → Réduire | | Bouton — en haut à droite |
| Quitter | Menu → Quitter | Ctrl+Q | Bouton ⏻ en haut à droite |
| Revenir au launcher | | Ctrl+Alt+L (partout) | Icône près de l'horloge |
| Plein écran | | F11 | Menu |

## Ouvrir un jeu, menu en jeu

- **Ouvrir un jeu** (A, Entrée, clic) : la boîte s'ouvre, le disque (ou la cartouche) sort en tournant, puis la page du jeu s'affiche ; A y lance le jeu, B referme la boîte. Le bouton « Jouer » sous la rangée et le double-clic lancent directement.
- **Bouton Xbox / PS / Home** de la manette pendant une partie : le launcher repasse devant avec le menu en jeu — **Reprendre** (A, B ou rappui), **Changer de jeu**, **Quitter le jeu**, **Alimentation** (veille, redémarrer, éteindre). Revalider le jeu en cours dans la bibliothèque le reprend. Ctrl+Alt+L fait la même chose au clavier.
- Windows réserve le bouton Xbox à la Game Bar : désactive *Paramètres → Jeux → Xbox Game Bar → « Ouvrir Xbox Game Bar avec ce bouton »* (et l'équivalent dans Steam si besoin). Option dans **Réglages → Général**.
- Manettes Xbox/XInput via `koffi`, DualShock 4 / DualSense / Switch Pro via `node-hid` (lecture seule). Cette lecture native sert aussi à **naviguer dans le launcher** (croix, stick gauche, boutons, gâchettes), en plus de l'API Gamepad de Chromium : les manettes que Chromium ne voit pas, ou une fenêtre sans le focus clavier, ne bloquent plus la navigation. Toutes les manettes branchées sont lues (plus seulement la première).

## Lancement, retour, réveil par la manette

- **Écran de lancement** façon PS5 : bannière du jeu en plein écran, logo au centre, « Lancement… » en bas à droite (B / Échap pour annuler pendant ~0,7 s). Il reste affiché jusqu'à l'apparition de la fenêtre du jeu, qui est alors **mise au premier plan** (Windows laisse souvent un jeu démarrer derrière la fenêtre active) ; sans fenêtre au bout de 12 s (Steam, Epic…) ou 25 s, le launcher se masque quand même.
- **Fin de partie** : quand tu quittes le dernier jeu, le launcher revient au premier plan sur la rangée du jeu (2e tentative si Windows refuse). Un jeu qui n'a plus de fenêtre depuis ~8 s est considéré comme fermé même si des processus d'arrière-plan traînent (rapport de plantage, anti-triche, overlay).
- **Réveil par la manette** : si le launcher est réduit ou dans la zone de notification et qu'aucun jeu ne tourne, allumer ou brancher une manette (Xbox, DualShock 4, DualSense, Switch Pro) l'ouvre. Option dans **Réglages → Général** ; active aussi « Lancer au démarrage de Windows » pour qu'il soit toujours prêt.

## Fonctions (Réglages → Fonctions)

- **Recherche** : `/` ou Ctrl+F, RS à la manette, loupe en haut — clavier virtuel AZERTY. **Filtres** (G) et **collections** perso ; **statut** (à jouer, en cours, terminé…) et **note** sur la page du jeu, onglet **Backlog**.
- **Bandes-annonces** : la vidéo du jeu remplace le fond après ~1,5 s (Steam, ou une vidéo locale via Images → Vidéo).
- **Économiseur d'écran** (5 min par défaut) : diaporama ou vidéos de tes jeux. **Musique d'ambiance** (désactivée par défaut) : dossier de musiques, musique par jeu ou ambiance générée.
- **Captures et clips** : menu en jeu, Ctrl+Alt+S / Ctrl+Alt+R, ou à la manette Guide + RB (capture), Guide + LB (clip), Guide + B (quitter), Guide maintenu (alimentation). Rangés dans `Images\RR Launcher\<jeu>`, galerie sur la page du jeu.
- **Statistiques** : temps de jeu par semaine / mois / année, séries, top 10, carte annuelle ; activité sur la page du jeu.
- **Succès** Steam (clé Web API + profil public) et RetroAchievements (utilisateur + clé) ; état des **mises à jour** Steam / Epic sur les boîtes.
- **Confort** : vibrations, notifications, taille de l'interface (TV).

## Temps de jeu complet (1.17)

- **Jeux lancés hors du launcher** : tant que RR Launcher tourne (même réduit près de l’horloge), un jeu de ta bibliothèque ouvert depuis Steam, Epic, un raccourci… est détecté (processus de son dossier avec une fenêtre) et compté comme une partie normale : statistiques, « dernier lancé », amis. Le launcher ne se montre pas et ne se masque pas pour autant. Activer « Lancer au démarrage de Windows » pour ne rien manquer. Les ROM lancées directement dans un émulateur ne sont pas reconnues.
- **Heures des autres launchers** : Steam (`userdata/*/config/localconfig.vdf`, sans clé ni connexion), GOG Galaxy (`galaxy-2.0.db`) et itch.io (`butler.db`). Le temps affiché devient le plus grand des deux, jamais l’addition ; l’écart apparaît dans les statistiques comme une entrée « historique ». Au démarrage, toutes les 30 min, après chaque partie et via Réglages → Temps de jeu → Synchroniser. Epic Games ne garde pas le temps de jeu sur le PC : Réglages → Temps de jeu → Compte Epic Games → Connecter ouvre la page de connexion officielle d’Epic, puis les heures du launcher Epic sont reprises (jeton chiffré par Windows, jamais de mot de passe stocké).

## Amis RR Launcher (1.15)

Une vraie liste d’amis dans le launcher, sans Steam ni Discord, portée par un projet Firebase (offre gratuite) :

- **Code ami** : chaque launcher reçoit un code de 8 caractères (ex. `K7QM-2XPA`) à donner à ses amis. Écran Amis → « Ajouter » avec le code d’un ami ; il reçoit une demande à accepter.
- **À quoi ils jouent** : en ligne, en jeu (jeu, console, depuis quand), vu il y a… La présence est publiée au lancement et à la fermeture d’un jeu, puis toutes les 4 minutes.
- **Statistiques** : clic sur un ami → temps de jeu total, jeux lancés, ses 10 jeux les plus joués et ses derniers jeux (avec « tu l’as » si tu possèdes le jeu). Partage désactivable dans les réglages.
- **Confidentialité** : connexion anonyme, aucune adresse ni mot de passe ; seuls les amis que tu as ajoutés voient ta présence et tes statistiques (règles dans `firebase/database.rules.json`).

**Mise en place (une fois)** : créer un projet sur console.firebase.google.com, ajouter une *Realtime Database*, activer *Authentication → Anonyme*, coller `firebase/database.rules.json` dans l’onglet Règles de la base, puis renseigner `apiKey` et `databaseURL` dans `src/features/friends/firebase.json` (ou dans Réglages → Amis → Projet Firebase).

## Accueil, profils, amis (1.9)

- **Continuer** : le dernier jeu joué en grande tuile au démarrage — A pour le relancer (ou le reprendre s'il tourne).
- **Profils joueurs** : avatar en haut à gauche, écran « Qui joue ? » ; favoris, temps de jeu, statut, note, collections et statistiques propres à chaque profil.
- **Amis** (icône Amis, menu, touche A) : amis Steam (clé + SteamID de la section Succès) et membres de ton serveur Discord via ton bot (Réglages → Fonctions → Amis : guide pas à pas). Discord ne permet à aucune application de lire ta liste d'amis : seuls les membres des serveurs où le bot est invité sont visibles.
- **Multijoueur local** : onglet automatique (catégories Steam) + marquage manuel pour les ROMs ; nombre de manettes connectées en haut.
- **Couleur d'accent** qui suit la jaquette du jeu sélectionné (ou bleu fixe), thème **Horaire** (clair le jour, sombre le soir), batterie de la manette dans la barre du haut.
- **Émulateurs** : Réglages → Fonctions → *Configurer…* installe RetroArch + le bon cœur et les émulateurs dédiés (PCSX2, DuckStation, RPCS3, Azahar, melonDS, Cemu, xemu, Xenia, Vita3K), vérifie les BIOS (jamais téléchargés). Menu en jeu : **sauvegarde rapide / charger / emplacement**. Page du jeu : **Options de lancement** (émulateur ou cœur propre au jeu, arguments, variables, plein écran, administrateur).
- **Import** de Xbox / Game Pass, EA app, Ubisoft Connect, Battle.net, Amazon Games et itch.io (« Launchers installés »). **Nettoyer la bibliothèque** : doublons, jeux désinstallés, images manquantes, jeux sans infos.

## Discord

- **Rich Presence** : ton profil Discord affiche le jeu en cours, la console et la durée. Crée une application gratuite sur [discord.com/developers/applications](https://discord.com/developers/applications) (son nom est affiché : appelle-la « RR Launcher »), copie l'**Application ID** dans **Réglages → Fonctions → Discord**, puis « Tester ». Optionnel : image `logo` dans *Rich Presence → Art Assets*. Les jeux Steam affichent leur jaquette.
- **Stream (Go Live) sans quitter le jeu** : menu en jeu → **Streamer sur Discord**, ou **Guide + Y** (PS + △). Il faut être déjà en vocal. Discord ne laisse pas les applications démarrer un partage d'écran : le launcher appuie à ta place sur le raccourci Discord du stream — crée-le une fois dans Discord → Paramètres → Raccourcis clavier (action stream / Go Live) avec la même combinaison que dans le launcher (par défaut **Ctrl+Shift+F9**).

## Nouveautés 1.25

- **Jeux à installer** (Menu) : tes jeux possédés mais pas installés sur Steam (clé API des Réglages), Epic (compte connecté) et GOG (Galaxy), avec recherche et filtre par store. « Installer » ouvre le client du store sur le jeu.

## Nouveautés 1.21

- **Mettre à jour** et **Désinstaller** sur la page d’un jeu (Steam : direct ; Epic/GOG : ouvre leur client ; autres : désinstalleur du dossier du jeu).
- Onglet **À mettre à jour** dans la liste des jeux.

## Nouveautés 1.19
- **Mode Kiosque / TV** : s'active tout seul quand une manette est branchée (Réglages → Kiosque : auto / toujours / jamais) — plein écran, curseur masqué, interface agrandie.
- **Epic & GOG** : import des jeux installés et lancement direct (Epic sans client si le jeu n'a pas de protection ; GOG direct ou via Galaxy). Réglable jeu par jeu.
- **BIOS** : vérification des empreintes MD5 (« non conforme » signalé, sans bloquer).
- **Reprise** : relance un émulateur sur le dernier état sauvegardé (option globale ou par jeu).
- **Collections intelligentes** : règles (jamais lancé, court, coop, récent, oublié, adoré…) affichées comme onglets ; éditeur dans les réglages.
- **Journal de lancement** : commande exacte, code de sortie, erreurs — consultable et exportable.
- **Mods & patchs** : activer / ordonner des mods de fichiers (réversible, sauvegardes) et appliquer des patchs IPS / BPS / UPS sur une copie de la ROM (« <ROM> (patché) »).
- **Vocal Discord à la manette** : Guide + X rejoint / quitte le salon, Guide + A coupe le micro (+ entrées du menu en jeu). Réglages → Discord : renseigner le *Client Secret* de ton application Discord, choisir le salon, « Se connecter ». Le redirect `http://127.0.0.1` doit être ajouté dans l'application Discord (OAuth2).
- **Streaming vers un autre écran** : Réglages → Streaming. Détecte / démarre Sunshine, affiche l'adresse à saisir dans Moonlight, ajoute « RR Launcher » ou un jeu précis comme application Sunshine (`RR Launcher.exe --launch=<id>` lance le jeu directement).

### Signature de l'installateur (SignPath)
Le workflow `release.yml` signe l'installateur si le secret `SIGNPATH_API_TOKEN` existe (sinon publication non signée, comme avant). Prérequis : candidature **SignPath Foundation** (gratuit pour l'open source, validation manuelle), puis dans GitHub → Settings : secret `SIGNPATH_API_TOKEN` et variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`. Après signature, `build/finalize-release.js` recalcule `latest.yml` (sha512 / taille) pour que la mise à jour automatique reste valide.

## Thème

**Réglages → Apparence → Thème** : Clair (défaut), Sombre ou Auto (suit Windows).

## Mises à jour

Le launcher vérifie les [Releases GitHub](https://github.com/RobinRahoual/RR-Launcher/releases) au démarrage puis toutes les 4 h, télécharge la nouvelle version en arrière-plan et affiche **« Mise à jour X · Redémarrer »** en haut à droite. Sinon elle s'installe à la fermeture. Vérification manuelle : **Menu → Rechercher les mises à jour**.

**Publier une version** : augmenter `version` dans `package.json` et pousser sur `main`. Le workflow `.github/workflows/release.yml` compile l'installateur sur Windows et crée la release `vX.Y.Z` (avec `latest.yml`, indispensable aux mises à jour).

## Arrière-plan

Le launcher reste ouvert dans la zone de notification (près de l'horloge Windows). Quand tu lances un jeu, il se masque ; quand tu quittes le jeu, il revient au premier plan pour enchaîner sur un autre. Pour les jeux Steam/Epic et ceux qui passent par un petit launcher, la fin de partie est détectée en surveillant les processus du dossier du jeu. Option « Lancer au démarrage de Windows » dans les Réglages.

## Données

Bibliothèque et images : `%APPDATA%\RR Launcher\` (`library.json` + dossier `media`).
Le temps de jeu est suivi pour les `.exe` lancés directement (pas pour les raccourcis `.lnk` / `.url`, ni pour les jeux qui passent par un autre launcher qui se ferme aussitôt).

## Développement

```bash
npm install
npm start          # lancer en dev
npm run dist       # construire l'installateur Windows (dist/)
```

Stack : Electron, HTML/CSS 3D (sans framework), Gamepad API + lecture native des manettes. Icône : `build/icon.html` rendue en PNG 512 px (Chrome sans interface), copiée dans `src/renderer/assets/icon.png`. Direction visuelle issue du skill UI/UX Pro Max (Russo One + Chakra Petch). Palette : accent #3C91E6, navy #0C335A, thème clair (fond #FFFFFF, texte #101010) ou sombre (fond #101010, texte #FFFFFF) — Réglages → Thème.

## Clé SteamGridDB partagée (optionnel)

Ajoute dans la base Firebase des amis un nœud `config/sgdbKey` (chaîne) et colle les règles de `firebase/database.rules.json` : les launchers sans clé personnelle l'utilisent automatiquement (lecture seule, jamais écrite sur disque ni dans le dépôt). La clé perso des Réglages reste prioritaire.

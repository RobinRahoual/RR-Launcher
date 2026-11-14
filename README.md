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

**Menu → Recomps** (touche `R`, ou la carte « Recomps » dans Ajouter des jeux) : des jeux console recompilés ou portés pour tourner nativement sur PC, comme sur [RecompLauncher](https://recomplauncher.com) — Zelda 64: Recompiled, Ship of Harkinian, 2 Ship 2 Harkinian, SpaghettiKart, Starship, Ghostship, Star Fox 64 / Banjo / Donkey Kong 64 Recompiled, Snap 64, Perfect Dark, Unleashed Recompiled, Dusklight…

Présenté comme une ludothèque : une étagère par console (plaque au nom de la console), les jaquettes de face sur les rayons. Choisir un jeu le **sort du rayon** — la boîte avance puis glisse jusqu'à sa fiche — et « Remettre sur le rayon » (B / Échap) l'y repose. Jaquettes : libretro-thumbnails (nom No-Intro / Redump le plus proche), sinon l'image Wikipédia du jeu, gardées dans `%APPDATA%\RR Launcher\recomp-covers`.

1. **Ta copie du jeu** : tu choisis ta ROM (ou ton dump). Le launcher lit son en-tête (N64 : `.z64`, `.v64` ou `.n64` ; GameCube : identifiant du disque) et vérifie que c'est le bon jeu et la bonne région (avertissement si la région diffère). Aucun jeu n'est jamais téléchargé.
2. **Installer** : dernière release GitHub des auteurs (archive Windows choisie automatiquement, SHA-256 contrôlé quand GitHub le publie), extraite dans `%LOCALAPPDATA%\RR Launcher\recomps\<recomp>`. Pour les portages qui lisent la ROM dans leur dossier (HarbourMasters, Perfect Dark), elle y est copiée au bon nom. Le jeu apparaît sous sa console d'origine avec la fiche du jeu original.
3. **Jouer** : pour les recomp qui demandent la ROM au premier lancement (« Select ROM »), le chemin de ta copie est mis dans le presse-papiers.

Mises à jour (« Rechercher une mise à jour », les fichiers ajoutés dans le dossier sont conservés), désinstallation (dossier + entrée de la bibliothèque, ta ROM d'origine n'est pas touchée). Le catalogue est `src/features/recomp/recomps.json` (champ `cover` facultatif pour imposer une jaquette) : le launcher relit la copie de la branche `main` (toutes les 6 h ou « Actualiser le catalogue »), donc ajouter une recomp ne demande pas de nouvelle version.

L'onglet **Émulateurs** ouvre l'assistant d'installation, avec **toutes les consoles** (plus besoin d'avoir déjà des ROMs).

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

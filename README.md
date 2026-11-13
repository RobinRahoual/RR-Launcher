# RR Launcher

Launcher façon console pour jeux PC et émulation : accueil avec choix de la console, carrousel horizontal de boîtes 3D au format de chaque support, fond assombri tiré du jeu, sons d'interface, navigation manette / clavier / souris.

## Installation

Télécharge `RR-Launcher-Setup-x.y.z.exe` depuis la [dernière release](https://github.com/RobinRahoual/RR-Launcher/releases/latest) et lance-le. L'installateur n'est pas signé : si Windows SmartScreen s'affiche, clique sur **Informations complémentaires → Exécuter quand même**.

## Consoles & émulation

L'accueil est une roue à gauche qui tourne verticalement (↑ ↓, molette, stick) : la console sélectionnée est au bord de la roue et ses jeux s'affichent à droite. En ouvrant une console, la roue glisse à gauche et laisse la place à la rangée de jeux ; ← sur le premier jeu, B/Échap ou un clic sur la roue y reviennent. La photo et le logo officiel de chaque console sont téléchargés depuis Wikipédia/Wikimedia sur le PC au premier affichage (ils ne font pas partie du dépôt) ; tu peux les remplacer dans **Réglages → Consoles & émulateurs → Image / Logo**. Le logo s'affiche sur le bandeau et la tranche des boîtes, sur l'accueil et en en-tête. Les boîtes reprennent le format de chaque support : DVD (PC, PS2, Xbox, Wii…), Blu-ray (PS3), petits boîtiers (Switch, PSP, DS, GameCube), boîtier CD (PlayStation, Dreamcast) ou carton (NES, SNES, N64, Game Boy).

Consoles gérées : Switch, Wii U, Wii, GameCube, N64, SNES, NES, Game Boy / Color, GBA, DS, 3DS, PlayStation 1/2/3, PSP, PS Vita, Xbox, Xbox 360, Dreamcast, Mega Drive.

Pour chaque console, choisis l'exécutable de l'émulateur (Réglages → Consoles & émulateurs, ou au premier lancement d'un jeu). Les arguments sont préremplis pour RPCS3, PCSX2, DuckStation, Dolphin, Cemu, Ryujinx, Eden/Citron, PPSSPP, xemu, Xenia, Azahar/Citra, melonDS, mGBA, Mesen, Snes9x, Project64, simple64, ares, Flycast, BlastEm, Vita3K et RetroArch ; `{rom}` est remplacé par le chemin du jeu.

Les portages recompilés (.exe) peuvent être rangés sous leur console d'origine : ajoute l'exe et choisis la console.

## Ajouter un jeu

`N` (clavier), bouton **View/Share** (manette) ou **Menu → Ajouter des jeux** :

- **Un jeu ou une ROM** : `.exe`, `.lnk`, ROM, ISO/CHD/CUE, `EBOOT.BIN` (PS3)… ou glisser-déposer sur la fenêtre. La console est devinée d'après l'extension et le dossier (`PS2`, `GameCube`…).
- **Steam, Epic & GOG** : importe tous les jeux installés (lancés via leur launcher).
- **Scanner des dossiers** / **tout le PC** : trouve les jeux PC (un exe par dossier de jeu), les ROMs, les dumps PS3 (titre lu dans `PARAM.SFO`) et les émulateurs, qui sont configurés automatiquement. Tu coches ce que tu veux ajouter.

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
- Manettes Xbox/XInput via `koffi`, DualShock 4 / DualSense / Switch Pro via `node-hid` (lecture seule).

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

Stack : Electron, HTML/CSS 3D (sans framework), Gamepad API. Direction visuelle issue du skill UI/UX Pro Max (Russo One + Chakra Petch). Palette : accent #3C91E6, navy #0C335A, thème clair (fond #FFFFFF, texte #101010) ou sombre (fond #101010, texte #FFFFFF) — Réglages → Thème.

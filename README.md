# RR Launcher

Launcher pour jeux PC, façon console : carrousel horizontal de boîtes 3D, fond assombri tiré du jeu, navigation manette / clavier / souris.

## Installation

Télécharge `RR-Launcher-Setup-x.y.z.exe` depuis la [dernière release](https://github.com/RobinRahoual/RR-Launcher/releases/latest) et lance-le. L'installateur n'est pas signé : si Windows SmartScreen s'affiche, clique sur **Informations complémentaires → Exécuter quand même**.

## Ajouter un jeu

1. `N` (clavier), bouton **View/Share** (manette) ou **Menu → Ajouter un jeu**. Tu peux aussi glisser-déposer le `.exe` sur la fenêtre.
2. Choisis l'exécutable (`.exe`, `.lnk`, `.url`, `.bat`). Le nom du jeu est deviné depuis le fichier.
3. Vérifie la correspondance proposée (Steam / SteamGridDB) puis **Ajouter**.

Le launcher télécharge alors tout seul : jaquette, image de fond, logo, description, développeur, date, genres et captures d'écran.

**Sources** : Steam (sans clé, en français) → SteamGridDB (clé gratuite optionnelle dans Réglages, utile pour les jeux hors Steam) → Wikipédia pour la description en dernier recours. Sans jaquette, une jaquette est générée à partir du fond et du logo.

Mauvais jeu trouvé ? **Détails → Corriger le jeu**. Image à changer ? **Détails → Images**.

## Commandes

| Action | Manette | Clavier | Souris |
|---|---|---|---|
| Naviguer | Stick / croix ◀▶ | ← → | Molette, clic |
| Jouer | A / ✕ | Entrée | Double-clic |
| Détails | X / □ ou ▲ | I ou ↑ | Clic sur la boîte sélectionnée |
| Retourner la boîte | Y / △ | Espace | |
| Catégories | LB / RB | Tab, Q / E | Clic sur l'onglet |
| Sauter de 5 jeux | LT / RT | Page ↑ / ↓ | |
| Ajouter un jeu | View / Share | N | Menu |
| Favori | | F | Détails |
| Menu | Menu / Options | Échap | Bouton Menu |
| Plein écran | | F11 | Menu |

## Mises à jour

Le launcher vérifie les [Releases GitHub](https://github.com/RobinRahoual/RR-Launcher/releases) au démarrage puis toutes les 4 h, télécharge la nouvelle version en arrière-plan et affiche **« Mise à jour X · Redémarrer »** en haut à droite. Sinon elle s'installe à la fermeture. Vérification manuelle : **Menu → Rechercher les mises à jour**.

**Publier une version** : augmenter `version` dans `package.json` et pousser sur `main`. Le workflow `.github/workflows/release.yml` compile l'installateur sur Windows et crée la release `vX.Y.Z` (avec `latest.yml`, indispensable aux mises à jour).

## Données

Bibliothèque et images : `%APPDATA%\RR Launcher\` (`library.json` + dossier `media`).
Le temps de jeu est suivi pour les `.exe` lancés directement (pas pour les raccourcis `.lnk` / `.url`, ni pour les jeux qui passent par un autre launcher qui se ferme aussitôt).

## Développement

```bash
npm install
npm start          # lancer en dev
npm run dist       # construire l'installateur Windows (dist/)
```

Stack : Electron, HTML/CSS 3D (sans framework), Gamepad API. Direction visuelle issue du skill UI/UX Pro Max (style « 3D & Hyperrealism », Russo One + Chakra Petch, accent rose #F43F5E).

# Contexte du projet pour Claude

Board 3D (dépôt `remote-setter`) : visualiseur 3D de boards d'escalade (Kilter, Tension, MoonBoard) dans une salle d'escalade virtuelle. Site statique (Vite + Three.js 0.147, sans framework) publié sur GitHub Pages ; données régénérées chaque nuit par GitHub Actions. Langue du projet et de l'interface : français.

## Commandes

```bash
npm install
npm run data:geo     # géométrie seule (rapide)
npm run data         # géométrie + blocs (télécharge les snapshots Boardsesh, mis en cache dans .cache/)
npm run dev          # http://localhost:5173
npm run build        # dist/
```

## Architecture

- `src/main.js` : scène, construction de la board (panneau, kicker, châssis, vérins), sélection board/bloc, vues, mesure au clic, import.
- `src/data.js` : manifeste `data/index.json`, chargement à la demande de `boards/<id>.json` et `climbs/<id>.json`, import d'un fichier perso (une board connue garde sa géométrie si le fichier a moins de contours), blocs d'exemple si pas de blocs.
- `src/holds/geometry.js` : modelage des prises. Anneaux du contour vers le **boulon** (origine du contour) ; flancs droits, dessus bombé ; réglette/bac : face inférieure creusée → pointe à arête vive (sommets doublés) → nez arrondi, lèvre qui déborde (`lip`) ; plat : flancs arrondis ; trou (pocket) : cuvette (`surfZ`) ; vrai trou de vis creusé (fraisure + puits, groupe de matériau 1). Repli en dalle si contour trop concave.
- `src/config.js` : rôles (départ/main/top/pied), `TYPES` (hauteurs `H`, `kind`, `fw` largeur des flancs, `lip` débord), orientations.
- `src/scene/room.js` : salle (béton, murs, plafond, LED, murs de bloc voisins, tapis, accessoires). `MAT = 0.30` : toutes les hauteurs affichées partent du tapis ; le kicker part du sol, son réglage = hauteur visible au-dessus du tapis. `EYE = 1.62` pour la vue Grimpeur.
- `scripts/build_board_data.py` : génération des données (Python 3.9+, sans dépendance). Dictionnaire `BOARDS` = config de chaque board (taille Boardsesh, sets, dimensions physiques, plage du kicker).

## Données et sources

- Géométrie et contours : dépôt Boardsesh (Apache-2.0), `hole-placements/<board>.cjs` et `board-art-geometry/<board>/<layout>-<size>.cjs`. Rayon de contour = 4 unités Aurora (pouces) ; MoonBoard = 0,525 × pas de grille (0,20 m).
- Blocs : snapshots publics Boardsesh (`snapshots.boardsesh.com/board-snapshots/v1-gzip/manifest.json`). Conditions : héberger soi-même, ne pas appeler leurs serveurs depuis le site, créditer les ouvreurs.
- Types de prises : CruxCoach (CC BY 4.0), fichiers `androidApp/src/main/assets/hold_types/*.json`, présents seulement dans leur PR n° 95 → `TYPES_REF` figé sur le commit `a9fc009`. Le script échoue si une board n'a aucun type (sauf `--allow-missing-types`).
- Approximations : kicker Tension estimé ; positions MoonBoard reconstruites sur grille ; relief des prises = forme type par catégorie.

## Décisions déjà prises (ne pas revenir dessus sans demander)

- Pas de grimpeur/mannequin dans la scène (supprimé à la demande).
- Prises Kilter blanc cassé ; panneau noir par défaut (finitions bois / blanc en option).
- La partie qui crochète d'une réglette ou d'un bac est le **bord extérieur** (lèvre qui déborde), jamais un creux dans la prise.

## Pistes suivantes

1. Figer aussi la version Boardsesh ; regrouper les maillages des prises (perf mobile).
2. Blocs : filtres (cotation, angle, répétitions, qualité, ouvreur), tri, fichiers découpés, liens partageables `#board/bloc/angle`, favoris.
3. Allumer la board en Bluetooth (comme Boardsesh), éditeur de blocs, analyse des distances entre prises, réalité augmentée.
4. Avant diffusion publique : contacter Boardsesh et CruxCoach, vérifier les droits sur les contours et les marques.

## Tester sans npm

Le rendu peut se vérifier dans Chrome headless (SwiftShader) en servant `index.html` avec une import map vers `three.module.js` et `OrbitControls.js` de Three r147, et `data/` → `public/data/`.

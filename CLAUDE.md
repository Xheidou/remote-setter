# Contexte du projet pour Claude

Board 3D (dépôt `remote-setter`) : visualiseur 3D de boards d'escalade (Kilter, Tension, MoonBoard) dans une salle d'escalade virtuelle. Site statique (Vite + Three.js 0.147, sans framework) publié sur GitHub Pages ; données régénérées chaque nuit par GitHub Actions. Langue du projet et de l'interface : français.

## Commandes

```bash
npm install
npm run data:geo     # géométrie seule (rapide)
npm run data         # géométrie + blocs (télécharge les snapshots Boardsesh, mis en cache dans .cache/)
npm run dev          # http://localhost:5173
npm run build        # dist/
npm test             # tests Node (tests/*.test.js) + Python (tests/test_*.py)
```

## Architecture

- `src/main.js` : scène, construction de la board (panneau, kicker, châssis, vérins), sélection board/bloc, vues, mesure au clic, import.
- `src/ui/filters.js` : logique de recherche sans DOM — statistiques d'un bloc à un angle (`view`), profil des prises de main et type dominant (`holdProfile`), filtres, tris (`rec` = répétitions × note/5). Testable dans Node.
- `src/data.js` : manifeste `data/index.json` (lu sans cache), géométrie `boards/<id>.json`, blocs découpés chargés à la demande (`openClimbs`, `climbsAt(board, angle, all)`, `loadClimb`), import d'un fichier perso (une board connue garde sa géométrie si le fichier a moins de contours), blocs d'exemple si pas de blocs. Un bloc = un seul objet par id, complété au fil des chargements (stats de chaque angle, puis prises).
- **Blocs découpés** (`climbs/<board>/`, format décrit dans `split_climbs` du script, à garder en phase avec `data.js`) : `a<angle>.json` (liste sans prises, en colonnes), `all.json` (tous les blocs, seulement pour « jamais faits à cet angle »), `d/<n>.json` (prises + stats de tous les angles), `meta.json` recopié dans `index.json`. Ids raccourcis au plus petit préfixe unique ≥ 8 caractères (`idLen`) : liens et favoris utilisent l'id court, `climbKey()` ramène les anciens ids complets. Paquet = FNV-1a(id court) % `chunks` (puissance de deux). `?v=` sur chaque requête. Tests de bout en bout dans `tests/split.test.js` (le script Python écrit, `data.js` relit).
- `src/holds/geometry.js` : modelage des prises. Anneaux du contour vers le **boulon** (origine du contour) ; flancs droits, dessus bombé ; réglette/bac : face inférieure creusée → pointe à arête vive (sommets doublés) → nez arrondi, lèvre qui déborde (`lip`) ; plat : flancs arrondis ; trou (pocket) : cuvette (`surfZ`) ; vrai trou de vis creusé (fraisure + puits, groupe de matériau 1). Repli en dalle si contour trop concave.
- `src/config.js` : rôles (départ/main/top/pied), `TYPES` (hauteurs `H`, `kind`, `fw` largeur des flancs, `lip` débord), orientations.
- `src/scene/room.js` : salle (béton, murs, plafond, LED, murs de bloc voisins, tapis, accessoires). `MAT = 0.30` : toutes les hauteurs affichées partent du tapis ; le kicker part du sol, son réglage = hauteur visible au-dessus du tapis. `EYE = 1.62` pour la vue Grimpeur.
- `scripts/build_board_data.py` : génération des données (Python 3.9+, sans dépendance). Dictionnaire `BOARDS` = config de chaque board (taille Boardsesh, sets, dimensions physiques, plage du kicker).

## Données et sources

- Géométrie et contours : dépôt Boardsesh (Apache-2.0), `hole-placements/<board>.cjs` et `board-art-geometry/<board>/<layout>-<size>.cjs`. Rayon de contour = 4 unités Aurora (pouces) ; MoonBoard = 0,525 × pas de grille (0,20 m).
- Blocs : snapshots publics Boardsesh (`snapshots.boardsesh.com/board-snapshots/v1-gzip/manifest.json`). Conditions : héberger soi-même, ne pas appeler leurs serveurs depuis le site, créditer les ouvreurs.
- Types de prises : CruxCoach (CC BY 4.0), fichiers `androidApp/src/main/assets/hold_types/*.json`, présents seulement dans leur PR n° 95 → `TYPES_REF` figé sur le commit `a9fc009`. Le script échoue si une board n'a aucun type (sauf `--allow-missing-types`).
- Versions figées dans le script : `BOARDSESH_REF` (commit `b3a0285`, géométrie et contours) et `TYPES_REF` (CruxCoach `a9fc009`). Seuls les blocs (snapshots) changent chaque nuit. Tous les blocs sont gardés (`--limit 0`, minimum 3 répétitions à un angle ou benchmark) : ~293 000 blocs, ~970 fichiers, ~120 Mo pour les 9 boards. Three.js figé à 0.147.0 ; `package-lock.json` à committer après le premier `npm install`.
- Approximations : kicker Tension estimé ; positions MoonBoard reconstruites sur grille ; relief des prises = forme type par catégorie.

## Interface (architecture d'information)

1. **Ma board** (contexte, mémorisé dans `localStorage` `board3d:prefs`) : résumé + « Modifier » (modèle, kicker, finition) ; l'**angle** reste visible et pilote cotations, répétitions et filtres.
2. **Trouver un bloc** : recherche nom/ouvreur, cotation (Font), « Vérifiés » (Kilter) / « Benchmarks », type de prise dominant (filtre + badges dans la liste), « Plus de filtres » (répétitions, note, favoris, blocs jamais faits à cet angle), tri « Recommandés » par défaut, pagination par 60.
3. **Fiche du bloc** sur la scène (sous la scène sur téléphone) : cotation à l'angle, cotations par angle cliquables, profil des prises, copier le lien, favori.
4. **Affichage** dans la barre d'outils de la scène : vues, atténuer, couleur par type.
- Liens partageables : `#<board>/<id du bloc>/<angle>`.

## Décisions déjà prises (ne pas revenir dessus sans demander)

- Pas de grimpeur/mannequin dans la scène (supprimé à la demande).
- L'angle est un réglage de la board, pas un filtre ; les filtres s'appliquent aux statistiques à cet angle.
- Tri naturel : répétitions pondérées par la note ; benchmarks/vérifiés et cotation en filtres principaux.
- Analyse des mouvements : en dernier dans la feuille de route.
- Prises Kilter blanc cassé ; panneau noir par défaut (finitions bois / blanc en option).
- La partie qui crochète d'une réglette ou d'un bac est le **bord extérieur** (lèvre qui déborde), jamais un creux dans la prise.

## Pistes suivantes

1. Regrouper les maillages des prises (perf mobile) ; contrôles de génération.
2. Blocs : recherche par prises ; variante d'un bloc existant (éditeur pré-rempli depuis la fiche).
3. Allumer la board en Bluetooth (comme Boardsesh), éditeur de blocs, analyse des distances entre prises, réalité augmentée.
4. Avant diffusion publique : contacter Boardsesh et CruxCoach, vérifier les droits sur les contours et les marques.

## Tester sans npm

Le rendu peut se vérifier dans Chrome headless (SwiftShader) en servant `index.html` avec une import map vers `three.module.js` et `OrbitControls.js` de Three r147, et `data/` → `public/data/`.

# Board 3D

Visualiseur 3D de boards d'escalade (Kilter, Tension, MoonBoard), dans une salle d'escalade virtuelle. On choisit une board, son angle et la hauteur de son kicker, puis un bloc : ses prises s'allument, à leur vraie forme et à leur vraie place, pour juger des dimensions et de l'inclinaison à l'échelle humaine.

- 9 boards : Kilter Original 12×12 et Homewall 10×12, Tension 1, Tension 2 Mirror et Spray, MoonBoard 2016, 2024, Masters 2017 et 2019
- Prises modelées d'après leur contour réel, leur type (réglette, bac, plat, pince, trou…) et leur orientation, avec le trou de vis
- Angle et hauteur du kicker réglables, cotation et répétitions selon l'angle
- Cadrages « Board » (face au panneau) et « Bloc » ; navigation comme une carte (glisser, zoom vers le pointeur, double-clic sur une prise) ; mesure de hauteur et de distance entre prises au clic

## Démarrer

Prérequis : Node.js 20+ et Python 3.9+ (aucune dépendance Python).

```bash
npm install
npm run data:geo      # géométrie des 9 boards seulement (rapide, quelques Mo)
npm run dev           # http://localhost:5173
npm test              # tests (Node et Python)
```

Pour avoir aussi les blocs réels :

```bash
npm run data          # télécharge les snapshots Boardsesh (plusieurs centaines de Mo la première fois, puis mis en cache)
```

Sans données générées, le site affiche une board approximative et des blocs d'exemple.

## Données

Tout est produit par `scripts/build_board_data.py`, dans `public/data/` (non versionné) :

| Fichier | Contenu |
|---|---|
| `index.json` | Manifeste : boards, nombre de prises et de blocs, versions des sources, date |
| `boards/<id>.json` | Géométrie : dimensions, plages d'angle et de kicker, prises (position, teinte, type, orientation), contours |
| `climbs/<id>/a<angle>.json` | Blocs grimpés à cet angle, sans les prises : nom, ouvreur, cotation, répétitions, note, profil des prises (liste et filtres) |
| `climbs/<id>/all.json` | Tous les blocs, sans statistiques (filtre « jamais faits à cet angle », chargé seulement s'il est coché) |
| `climbs/<id>/d/<n>.json` | Détail par paquets d'environ 300 blocs : prises et rôles, statistiques à tous les angles (chargé à l'ouverture d'un bloc) |

Les sources de géométrie sont figées sur des commits précis (`BOARDSESH_REF`, `TYPES_REF` dans le script) : seuls les blocs changent chaque nuit. Pour passer à une version plus récente, la tester en local avec `--ref` / `--types-ref` puis mettre à jour la constante.

Le site ne charge que la board affichée, la liste de l'angle choisi (moins de 1 Mo compressé pour la Kilter Original à 40°, 42 800 blocs) et le paquet du bloc ouvert. Les téléchargements sont mis en cache dans `.cache/board-data/` et ne sont refaits que si la source a changé.

Options utiles du script (`npm run data -- --help` pour la liste complète) :

```bash
npm run data -- --boards kilter-original,moonboard-2016   # mettre à jour certaines boards seulement
npm run data -- --limit 5000                              # blocs gardés par board (0 = tous, par défaut)
npm run data -- --out boards.json                         # fichier unique, importable dans la page
```

Ajouter une board : une entrée dans le dictionnaire `BOARDS` du script (taille Boardsesh, sets de prises, dimensions physiques, plage du kicker).

## Déploiement

Le workflow `.github/workflows/deploy.yml` régénère les données puis publie le site sur GitHub Pages à chaque push sur `main`, chaque nuit (4 h 17 UTC) et à la demande (onglet *Actions*, avec un nombre de blocs par board réglable).

À faire une fois : *Settings → Pages → Source : GitHub Actions*.

## Structure

```
index.html              page et panneau de réglages
src/main.js             scène, board, sélection, vues, mesures
src/data.js             manifeste, chargement à la demande, import d'un fichier personnalisé
src/config.js           rôles, types de prises, orientations
src/holds/geometry.js   modelage 3D des prises à partir de leur contour, de leur type et de leur orientation
src/scene/room.js       salle d'escalade : textures, murs voisins, tapis, éclairage, accessoires
scripts/                génération des données
```

## Sources et crédits

Voir [CREDITS.md](CREDITS.md). En bref : géométrie et contours des prises de [Boardsesh](https://github.com/boardsesh/boardsesh) (Apache-2.0), blocs issus des snapshots publics Boardsesh (créés par les ouvreurs, crédités dans l'interface), types de prises de [CruxCoach](https://github.com/CruxCoach/CruxCoach) (CC BY 4.0).

Projet indépendant, sans lien avec Kilter, Tension Climbing ou Moon Climbing.

# Contexte du projet pour Claude

Board 3D (dépôt `remote-setter`) : visualiseur 3D de boards d'escalade (Kilter, Tension, MoonBoard, Decoy, Grasshopper) dans une salle d'escalade virtuelle. Site statique (Vite + Three.js 0.147, sans framework) publié sur GitHub Pages ; données régénérées chaque nuit par GitHub Actions. Langue du projet et de l'interface : français.

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

- `src/main.js` : scène, construction de la board (panneau, kicker, châssis, vérins), sélection board/bloc, cadrages, navigation, mesure au clic, import. **Rendu à la demande** : toute modification de la scène hors interaction caméra doit appeler `invalidate()`. Qualité réduite sur téléphone (`LOW`) et ajustée si l'image saccade (`adaptQuality`). En dev, `window.__board3d` expose renderer, scène, caméra et état.
- `src/holds/merge.js` : prises d'un plan (panneau / kicker) fusionnées en un maillage ; couleur et émission par sommet (`paintHold`, matériau `holdMaterial`), clic par sphères englobantes puis triangles (`pickHold`).
- `src/ble/protocol.js` : protocoles Bluetooth sans DOM, d'après les specs de Boardsesh (`docs/boards/AURORA_BLUETOOTH_PROTOCOL_SPEC.md`, `MOONBOARD_…`) : trames Aurora (SOH LEN CHK STX … ETX, API v2 2 octets/LED avec budget 18 W, v3 3 octets/LED, début/suite/fin), texte MoonBoard `l#S…,P…,E…#` (`l##` éteint), paquets de 20 octets ; `climbLeds(board, holds)` via `board.leds` et `board.ble.colors`. Tests sur les exemples de la spec (`tests/ble.test.js`).
- `src/ble/connection.js` : Web Bluetooth (sélecteur du navigateur, service Aurora `4488b571…` ou nom « MoonBoard », écriture sur Nordic UART RX, repli avec accusé ; boîtier Kilter sans `#série@API` = avec accusé + 100 ms entre paquets) ; file d'envoi où seul le dernier état part. Dans `main.js`, `bleSync()` est appelé à chaque `paintClimb()`.
- `src/editor/creations.js` : blocs créés, sans DOM — code du lien (`encodeHolds` / `decodeHolds`, clé `b:<code>[.<cotation>]`), rôles au toucher (`cycleRole`, `setRole`), règles (`checkClimb` : 1–2 départs, 1–2 tops), brouillons (`upsertDraft`, `sanitizeDrafts`). L'éditeur lui-même est dans `main.js` (« Créer un bloc ») : état `ed`, sauvegarde automatique dans `localStorage` `board3d:creations`. Un bloc créé est un objet bloc avec `created: true` (pas de stats).
- `src/ui/filters.js` : logique de recherche sans DOM — statistiques d'un bloc à un angle (`view`), profil des prises de main et type dominant (`holdProfile`), filtres, tris (`rec` = répétitions × note/5). Testable dans Node.
- `src/data.js` : manifeste `data/index.json` (lu sans cache), géométrie `boards/<id>.json`, blocs découpés chargés à la demande (`openClimbs`, `climbsAt(board, angle, all)`, `loadClimb`), import d'un fichier perso (une board connue garde sa géométrie si le fichier a moins de contours), blocs d'exemple si pas de blocs. Un bloc = un seul objet par id, complété au fil des chargements (stats de chaque angle, puis prises).
- **Blocs découpés** (`climbs/<board>/`, format décrit dans `split_climbs` du script, à garder en phase avec `data.js`) : `a<angle>.json` (liste sans prises, en colonnes), `all.json` (tous les blocs, seulement pour « jamais faits à cet angle »), `d/<n>.json` (prises + stats de tous les angles), `meta.json` recopié dans `index.json`. Ids raccourcis au plus petit préfixe unique ≥ 8 caractères (`idLen`) : liens et favoris utilisent l'id court, `climbKey()` ramène les anciens ids complets. Paquet = FNV-1a(id court) % `chunks` (puissance de deux). `?v=` sur chaque requête. Tests de bout en bout dans `tests/split.test.js` (le script Python écrit, `data.js` relit).
- `src/holds/geometry.js` : modelage des prises. Anneaux du contour vers le **boulon** (origine du contour) ; flancs droits, dessus bombé ; réglette/bac : face inférieure creusée → pointe à arête vive (sommets doublés) → nez arrondi, lèvre qui déborde (`lip`) ; plat : flancs arrondis ; trou (pocket) : cuvette (`surfZ`) ; vrai trou de vis creusé (fraisure + puits, groupe de matériau 1). Repli en dalle si contour trop concave.
- `src/config.js` : rôles (départ/main/top/pied), `TYPES` (hauteurs `H`, `kind`, `fw` largeur des flancs, `lip` débord), orientations.
- `src/scene/room.js` : salle (béton, murs, plafond, LED, murs de bloc voisins, tapis, accessoires). `MAT = 0.30` : toutes les hauteurs affichées partent du tapis ; le kicker part du sol, son réglage = hauteur visible au-dessus du tapis. `mergeStatic` fusionne les maillages statiques par matériau, `faceBox` = panneau à 2 appels de dessin.
- `scripts/build_board_data.py` : génération des données (Python 3.9+, sans dépendance). Dictionnaire `BOARDS` = config de chaque board (taille Boardsesh, sets, dimensions physiques, plage du kicker).

## Données et sources

- Géométrie et contours : dépôt Boardsesh (Apache-2.0), `hole-placements/<board>.cjs` et `board-art-geometry/<board>/<layout>-<size>.cjs`. Rayon de contour = 4 unités Aurora (pouces) ; MoonBoard = 0,525 × pas de grille (0,20 m).
- Blocs : snapshots publics Boardsesh (`snapshots.boardsesh.com/board-snapshots/v1-gzip/manifest.json`). Conditions : héberger soi-même, ne pas appeler leurs serveurs depuis le site, créditer les ouvreurs.
- Types de prises : CruxCoach (CC BY 4.0), fichiers `androidApp/src/main/assets/hold_types/*.json`, fusionnés (PR n° 95) sur leur branche `feat/0.2.5-release`, pas encore sur main → `TYPES_REF` figé sur le commit de fusion `386094b` (mêmes étiquettes que la PR, `a9fc009`). Decoy et Grasshopper sont gérées ; So iLL a la géométrie et les blocs Boardsesh mais des étiquettes CruxCoach vides (« type not visible »), Touchstone n'a pas d'étiquettes, ShinyWall n'est pas chez Boardsesh. Le script échoue si une board n'a aucun type (sauf `--allow-missing-types`).
- Contrôles avant publication (`--check-against`, branché dans la CI sur le `data/index.json` du site en ligne) : échec si une board disparaît, perd des prises, des contours, des types ou plus de la moitié de ses blocs ; rien n'est alors déployé. Forcer : `--no-check` (CI : Run workflow, case « force »). Une tâche `keepalive` réactive chaque nuit la génération planifiée (pause GitHub après 60 jours sans activité).
- Versions figées dans le script : `BOARDSESH_REF` (commit `b3a0285`, géométrie et contours) et `TYPES_REF` (CruxCoach `386094b`). Seuls les blocs (snapshots) changent chaque nuit. Tous les blocs sont gardés (`--limit 0`, minimum 3 répétitions à un angle ou benchmark) : ~303 000 blocs pour les 11 boards. Three.js figé à 0.147.0 ; `package-lock.json` versionné (la CI fait `npm ci`).
- LED et Bluetooth (dans `boards/<id>.json`) : `leds` = {prise: position de LED} tiré de `led-placements-data.ts` de Boardsesh (`LED_PLACEMENTS[board]['layout-taille']`), MoonBoard calculé en serpentin (`moon_led`) ; `ble` = protocole, nom annoncé, LED par prise (Kilter 2), couleurs des rôles (Kilter 00FF00/00FFFF/FF00FF/FFAA00 ; Tension, Decoy, Grasshopper 00FF00/0000FF/FF0000/FF00FF). Le nombre de LED est contrôlé avant publication.
- Approximations : kicker Tension, Decoy et Grasshopper estimé (12×12 = 144″ × 144″ d'après le nom commercial) ; positions MoonBoard reconstruites sur grille ; relief des prises = forme type par catégorie.

## Interface (architecture d'information)

Le panneau de gauche ne contient que les blocs ; tout ce qui concerne la board est sur la scène.

**Téléphone (≤ 760 px)** : la board est la page principale, en plein écran. Barre du haut : bouton « <board> 40° » → feuille « Ma board » (bas de l'écran) ; bouton « Blocs » → recherche en plein écran (panneau de gauche). Choisir un bloc ferme la feuille. Chaque feuille ajoute une entrée d'historique : le bouton retour la ferme (`openSheet` / `closeSheet`, l'adresse garde le bloc courant). Fiche réduite en bas (nom, cotation, style, ‹ › bloc précédent / suivant de la liste, « Détails »). Champ de vision élargi en portrait pour voir toute la board sans reculer au-delà du mur.

1. **Ma board**, carte en haut à gauche de la scène (au-dessus de la scène sur téléphone), mémorisée dans `localStorage` `board3d:prefs` : modèle + « Réglages » (modèle, kicker, finition), **angle** toujours visible (pilote cotations, répétitions et filtres), cotes. Le centre de l'image est celui de la zone libre (`applyViewOffset`) : à droite de la carte sur grand écran, entre la barre du haut et la fiche sur téléphone.
2. **Blocs** (panneau) : recherche nom/ouvreur, bouton « Filtres (n) » + bouton rapide « Vérifiés » (Kilter) / « Benchmarks » + tri ; filtres actifs en pastilles retirables ; liste par 20 avec « Afficher plus » ; chaque ligne montre le **style principal** (type de prise de main dominant, sans compte).
3. **Feuille des filtres** (`<dialog>`, à gauche sur ordinateur, en bas sur téléphone) : cotation (curseur à deux poignées), vérifiés/benchmarks, style principal, répétitions et note (boutons segmentés), favoris, jamais faits à cet angle ; « Voir N blocs ».
4. **Fiche du bloc** sur la scène (sous la scène sur téléphone) : cotation à l'angle, style principal, angles **où le bloc a des répétitions** seulement : 30°, 40°, 50° (et l'angle courant) en accès direct, les autres dans « Tous les angles » (tableau cotation, répétitions, note) ; copier le lien, favori.
5. **Cadrage et affichage** (barre d'outils de la scène) : « Board » (toute la board, face au panneau, relevée si la caméra passerait sous ~0,6 m) et « Bloc » (prises du bloc) ; le cadrage suit l'angle et le kicker tant que l'utilisateur n'a pas bougé la vue ; atténuer, couleur par type.
6. **Navigation comme une carte** : glisser = se déplacer, molette / pincement = zoom vers le pointeur, clic droit / Maj + glisser / deux doigts = tourner (devant la board seulement), double-clic / double-tap sur une prise = zoom dessus. La cible de la caméra glisse sur la surface de la board (panneau + kicker) et reste dans ses bords (`clampTarget`).
7. **Créer un bloc** : bouton « Créer un bloc » (panneau) ou « Créer une variante » (fiche) → carte de création à la place de la fiche. Toucher une prise : départ → main → top → pied → retirée (ou rôle imposé par la palette) ; pas de mesure ni de zoom au double-tap pendant la création ; toutes les prises restent visibles. Sauvegarde automatique dans « Mes blocs » (sous le bouton, board courante). Fiche d'un bloc créé : Modifier, Copier le lien, Créer une variante, Supprimer (deuxième clic pour confirmer) ou « Enregistrer dans mes blocs » s'il vient d'un lien.
8. **Allumer la board** (carte « Ma board », feuille « Ma board » sur téléphone) : « Allumer la board » ouvre le sélecteur Bluetooth ; une fois connectée, le bloc affiché s'allume à chaque changement (y compris en création) ; « Éteindre » ; « Déconnecter ». Point vert sur le bouton de la board (téléphone). Avertissement si le boîtier annonce un autre fabricant. Web Bluetooth : https ou localhost seulement (pas l'adresse IP du réseau local en http).
- Liens partageables : `#<board>/<id du bloc>/<angle>` ; bloc créé : `#<board>/b:<code>[.<cotation>]/<angle>/<nom>` (prises dans le lien, aucun serveur).

## Décisions déjà prises (ne pas revenir dessus sans demander)

- Pas de grimpeur/mannequin dans la scène (supprimé à la demande). Pas de vues Grimpeur ni Profil (supprimées à la demande) : cadrages Board et Bloc seulement.
- Les prises « pocket » s'appellent « pocket » (pas « trou »).
- L'angle est un réglage de la board, pas un filtre ; les filtres s'appliquent aux statistiques à cet angle.
- Tri naturel : répétitions pondérées par la note ; cotation et benchmarks/vérifiés en tête de la feuille des filtres, vérifiés/benchmarks aussi en bouton rapide.
- Analyse des mouvements : en dernier dans la feuille de route.
- Prises Kilter blanc cassé ; panneau noir par défaut (finitions bois / blanc en option).
- La partie qui crochète d'une réglette ou d'un bac est le **bord extérieur** (lèvre qui déborde), jamais un creux dans la prise.

## Pistes suivantes

1. Contrôles de génération (maillages regroupés et qualité adaptative : faits).
2. Blocs : recherche par prises ; signaler un bloc créé identique à un bloc du catalogue.
3. Essayer l'allumage sur de vraies boards (Kilter v2/v3, Tension, MoonBoard) ; analyse des distances entre prises, réalité augmentée.
4. Avant diffusion publique : contacter Boardsesh et CruxCoach, vérifier les droits sur les contours et les marques.

## Tester sans npm

Le rendu peut se vérifier dans Chrome headless (SwiftShader) en servant `index.html` avec une import map vers `three.module.js` et `OrbitControls.js` de Three r147, et `data/` → `public/data/`.

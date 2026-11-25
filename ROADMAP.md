# Feuille de route — Board 3D

État au 25 novembre 2026 : site en ligne (GitHub Pages), 11 boards réelles, prises modelées selon leur contour, leur type et leur orientation (formes validées), salle d'escalade en 3D, données régénérées et contrôlées chaque nuit, interface pensée aussi pour le téléphone.

Effort : **S** = quelques heures · **M** = quelques jours · **L** = une à plusieurs semaines.
Valeur : ★ utile · ★★ important · ★★★ ce qui distingue le projet.

---

## Vue d'ensemble par phase

| Phase | Objectif | Contenu principal |
|---|---|---|
| **1. Fiabiliser** (maintenant) | Un site stable, qui ne casse pas pendant la nuit | Sources figées, contrôles de la génération, performance mobile |
| **2. Rendre les blocs utiles** (court terme) | Trouver, filtrer et partager un bloc parmi des dizaines de milliers | Filtres, tri, fichiers découpés, liens partageables, favoris |
| **3. Se distinguer** (moyen terme) | Ce que les apps officielles ne font pas | Comparaison d'angles, éditeur 3D, variante d'un bloc existant |
| **4. Relier au réel** (long terme) | Passer de l'écran à la board | Allumage Bluetooth, réalité augmentée, mode entraînement |
| **5. Analyser** (en dernier) | Comprendre un bloc pour un grimpeur donné | Analyse des mouvements selon la taille et l'allonge |
| **En continu** | Cadre juridique, qualité, communauté | Partenariats, droits, tests, retours utilisateurs |

---

## 1. Données et fiabilité

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| ~~Figer les versions~~ ✅ | Boardsesh (`b3a0285`) et CruxCoach (`386094b`, commit de fusion des types) figés dans le script ; `package-lock.json` versionné (`npm ci` dans la CI) | S | ★★ | 1 |
| ~~Contrôles de génération~~ ✅ | Comparaison au manifeste du site en ligne : échec (rien n'est publié) si une board disparaît, perd des prises, des contours, des types ou plus de la moitié de ses blocs ; tableau dans le résumé de l'exécution ; publication forcée possible à la main | S | ★★ | 1 |
| Alerte d'échec | E-mail GitHub en cas d'échec et résumé des contrôles en place ; reste en option : Discord/Slack | S | ★ | 1 |
| ~~Garde-fou des 60 jours~~ ✅ | Chaque nuit, la tâche planifiée se réactive par l'API GitHub (sans commit) ; à vérifier au bout de 60 jours sans push | S | ★ | 1 |
| Suivre CruxCoach | Types fusionnés sur `feat/0.2.5-release` (commit figé `386094b`, vérifié le 25/11 : rien de plus récent) ; repasser sur main quand ils y arriveront ; étiquettes déjà disponibles pour Decoy, Grasshopper, ShinyWall, So iLL | S | ★★ | continu |
| Nouvelles boards | ✅ Decoy Dungeon Trainer et Grasshopper GrandMaster (12×12, kicker estimé). Reste : So iLL (étiquettes CruxCoach vides), Touchstone (pas d'étiquettes), Kilter Original autres tailles (7×10, 8×12, 12×14…) ; vérifier les dimensions physiques et kickers réels | M | ★★ | 2–3 |
| Positions MoonBoard exactes | Remplacer la grille reconstruite par des mesures réelles | M | ★ | 3 |
| Kicker Tension | Trouver ou mesurer la hauteur réelle | S | ★ | continu |

## 2. Performance et technique

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| ~~Regrouper les maillages~~ ✅ | Prises fusionnées en un maillage par plan (panneau, kicker), couleur et surbrillance par sommet ; salle regroupée par matériau, tapis instanciés ; rendu à la demande (rien n'est recalculé quand la scène ne bouge pas). Kilter Original : ~100 appels de dessin par image au lieu de ~2 000 | M | ★★ | 1 |
| ~~Blocs découpés~~ ✅ | Une liste par angle (sans les prises), le détail par paquets, `all.json` pour « jamais faits à cet angle » ; tous les blocs gardés (Kilter Original : 83 900, 0,9 Mo compressé à 40° au lieu de 7 Mo) | M | ★★ | 2 |
| Mise à jour de Three.js | Passer de r147 à une version récente (gestion des couleurs, ombres) | M | ★ | 2 |
| ~~Qualité graphique adaptative~~ ✅ | Téléphone : résolution ×1,5 max, ombres 1024 non adoucies, sans anticrénelage, murs voisins moins chargés et sans ombres ; partout : résolution puis ombres réduites si l'image saccade | S | ★★ | 1–2 |
| Tests | Tests du script de données (faux snapshots) et du modelage des prises ; vérification visuelle automatique dans la CI | M | ★★ | 2 |
| Version installable (PWA) | Fonctionne hors ligne une fois la board chargée | M | ★ | 3 |

## 3. Expérience « blocs »

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| ~~Refonte du panneau et filtres~~ ✅ | Panneau réservé aux blocs, Ma board sur la scène ; feuille des filtres (cotation à deux poignées, vérifiés-benchmarks, style principal, répétitions, note, favoris) ; liste par 20 ; fiche avec style principal et angles grimpés | M | ★★★ | 2 |
| ~~Parcours téléphone~~ ✅ | Board en plein écran ; réglages et recherche en feuilles (bouton retour) ; fiche réduite avec bloc précédent / suivant | M | ★★★ | 2 |
| ~~Tri~~ ✅ | Recommandés (répétitions × note), répétitions, note, cotation ; reste : nouveauté | S | ★★ | 2 |
| ~~Liens partageables~~ ✅ | `#board/bloc/angle` : ouvrir directement un bloc à un angle donné | S | ★★★ | 2 |
| Favoris et historique | ✅ favoris (navigateur) ; reste : historique, listes personnelles (« projets ») | M | ★★ | 2 |
| Recherche par prises | Cliquer des prises sur la board pour trouver les blocs qui les utilisent | M | ★★ | 3 |
| Cotation selon l'angle | Déjà en place ; ajouter une courbe cotation / angle par bloc | S | ★ | 2 |

## 4. Visualisation 3D

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| Lecture du bloc | Numéroter les prises dans l'ordre probable, relier départ → top | M | ★★ | 3 |
| ~~Cadrages et navigation~~ ✅ | Cadrages Board (face au panneau) et Bloc ; navigation comme une carte (glisser, zoom vers le pointeur, double-clic sur une prise), vue bornée à la board | M | ★★★ | 2 |
| Comparaison d'angles | Afficher la board à deux angles côte à côte ou en superposition | M | ★★ | 3 |
| Prises plus fidèles | Profils par modèle de prise (et non plus par catégorie) quand des données existent ; couleurs réelles des sets | L | ★★ | 4 |
| Ambiance de la salle | Variantes de salle, éclairage réglable, mode sombre de la scène | S | ★ | 3 |
| Captures et vidéos | Image ou courte animation d'un bloc à partager | M | ★ | 3 |

## 5. Fonctions pour le grimpeur

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| Analyse des mouvements | Distances entre prises successives comparées à la taille et à l'allonge ; repérer jetés et mouvements « pour grands » | M | ★★★ | 5 (en dernier) |
| Profil du bloc | Proportion de réglettes, bacs, plats, pinces (déjà résumé) ; style « physique » ou « technique » | S | ★★ | 2 |
| Recommandations | Blocs proches d'un bloc donné (mêmes types de prises, même cotation) | M | ★★ | 3 |
| Mode entraînement | Séances, circuits, minuteur | L | ★ | 4 |

## 6. Création et lien avec la board réelle

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| ~~Éditeur de blocs 3D~~ ✅ | Toucher les prises (départ → main → top → pied → retirée, ou rôle imposé), annuler, nom, cotation proposée, style principal et règles (1–2 départs, 1–2 tops) en direct ; gardé tout seul dans « Mes blocs » (navigateur) ; lien partageable qui contient les prises. Reste : export vers les applis officielles (impossible sans leurs API), recherche d'un bloc identique dans le catalogue | L | ★★★ | 3 |
| ~~Variante d'un bloc existant~~ ✅ | « Créer une variante » depuis la fiche : éditeur pré-rempli (prises, rôles, nom « (variante) »), lien « variante de … » gardé | M | ★★★ | 3 |
| ~~Allumer la board~~ ✅ (à tester sur une vraie board) | Web Bluetooth (Chrome, Edge, Android ; pas Safari ni Firefox, iPhone via Bluefy) : protocole Aurora v2/v3 (Kilter, Tension, Decoy, Grasshopper) et MoonBoard d'après les specs de Boardsesh ; le bloc affiché s'allume, y compris pendant la création ; « Éteindre ». Reste : essai sur boîtiers réels, MoonBoard Pro (protocole binaire non documenté), option « prise au-dessus » MoonBoard | L | ★★★ | 4 |
| Réalité augmentée | Board à l'échelle 1 dans sa pièce (WebXR, téléphone) | L | ★★ | 4 |
| Publier un bloc | Dépend des API officielles : à discuter avec Kilter / Boardsesh, pas de contournement | L | ★ | 4 |

## 7. Cadre juridique, partenaires et communauté (en continu, avant toute communication)

| Chantier | Détail | Effort | Valeur |
|---|---|---|---|
| Contacter Boardsesh | Présenter le projet, confirmer l'usage des snapshots et de la géométrie, proposer des liens croisés | S | ★★★ |
| Contacter CruxCoach | Remonter les prises mal classées, suivre la validation de leurs étiquettes | S | ★★ |
| Droits sur les contours | Les contours viennent des images des fabricants : obtenir un accord ou prévoir une alternative | M | ★★★ |
| Marques | Usage des noms Kilter, Tension, MoonBoard, Decoy, Grasshopper ; nom et identité propres au projet | S | ★★ |
| Licence du projet | Choisir une licence pour le code (MIT, Apache-2.0…) | S | ★ |
| Retours utilisateurs | Page de contact ou formulaire, signalement d'erreur sur une prise ou un bloc | S | ★★ |

---

## Prochaines étapes proposées

1. ~~Regrouper les maillages et adapter la qualité graphique au téléphone (performance).~~ ✅
2. ~~Ajouter les contrôles de génération.~~ ✅
3. ~~Refonte du panneau (board / recherche de blocs / fiche bloc), filtres, tri, liens partageables et fichiers de blocs découpés.~~ ✅
4. Écrire à Boardsesh et à CruxCoach.
5. ~~Éditeur de blocs et variantes d'un bloc existant~~ ✅ ; l'analyse des mouvements en dernier.

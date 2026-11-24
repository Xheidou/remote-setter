# Feuille de route — Board 3D

État au 24 novembre 2026 : site en ligne (GitHub Pages), 9 boards réelles, prises modelées selon leur contour, leur type et leur orientation (formes validées), salle d'escalade en 3D, données régénérées chaque nuit.

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
| ~~Figer les versions~~ ✅ | Boardsesh (`b3a0285`) et CruxCoach (`a9fc009`) figés dans le script ; reste : committer `package-lock.json` | S | ★★ | 1 |
| Contrôles de génération | Échouer si une board perd des prises, des contours ou la plupart de ses blocs par rapport à la veille | S | ★★ | 1 |
| Alerte d'échec | Notification (e-mail GitHub déjà en place ; option Discord/Slack) | S | ★ | 1 |
| Garde-fou des 60 jours | Commit automatique mensuel ou rappel, pour que GitHub ne suspende pas la tâche planifiée | S | ★ | 1 |
| Suivre CruxCoach | Repasser sur leur branche principale quand les types de prises seront fusionnés et validés | S | ★★ | continu |
| Nouvelles boards | Kilter Original autres tailles (7×10, 8×12, 12×14…), Decoy, Grasshopper, So iLL, Touchstone : une entrée de configuration chacune + dimensions physiques | M | ★★ | 2–3 |
| Positions MoonBoard exactes | Remplacer la grille reconstruite par des mesures réelles | M | ★ | 3 |
| Kicker Tension | Trouver ou mesurer la hauteur réelle | S | ★ | continu |

## 2. Performance et technique

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| Regrouper les maillages | Toutes les prises d'une board en un ou deux objets 3D au lieu de ~500 ; idem pour la salle | M | ★★ | 1 |
| Blocs découpés | Fichiers de blocs par board et par tranche (angle ou cotation), chargés à la demande | M | ★★ | 2 |
| Mise à jour de Three.js | Passer de r147 à une version récente (gestion des couleurs, ombres) | M | ★ | 2 |
| Qualité graphique adaptative | Ombres et détail de la salle réduits automatiquement sur téléphone | S | ★★ | 1–2 |
| Tests | Tests du script de données (faux snapshots) et du modelage des prises ; vérification visuelle automatique dans la CI | M | ★★ | 2 |
| Version installable (PWA) | Fonctionne hors ligne une fois la board chargée | M | ★ | 3 |

## 3. Expérience « blocs »

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| Filtres | Plage de cotation, angle, nombre de répétitions, qualité, ouvreur, bloc « vérifié » / benchmark | M | ★★★ | 2 |
| Tri | Popularité, qualité, cotation, nouveauté | S | ★★ | 2 |
| Liens partageables | `#board/bloc/angle` : ouvrir directement un bloc à un angle donné | S | ★★★ | 2 |
| Favoris et historique | Gardés dans le navigateur ; listes personnelles (« projets ») | M | ★★ | 2 |
| Recherche par prises | Cliquer des prises sur la board pour trouver les blocs qui les utilisent | M | ★★ | 3 |
| Cotation selon l'angle | Déjà en place ; ajouter une courbe cotation / angle par bloc | S | ★ | 2 |

## 4. Visualisation 3D

| Chantier | Détail | Effort | Valeur | Phase |
|---|---|---|---|---|
| Lecture du bloc | Numéroter les prises dans l'ordre probable, relier départ → top | M | ★★ | 3 |
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
| Éditeur de blocs 3D | Composer un bloc en cliquant les prises, le voir à tous les angles, l'exporter | L | ★★★ | 3 |
| Variante d'un bloc existant | Depuis la fiche d'un bloc : « Créer une variante » ouvre l'éditeur pré-rempli (prises et rôles) ; brouillons gardés dans le navigateur, partage par lien | M | ★★★ | 3 |
| Allumer la board | Commande des LEDs Kilter/Tension en Bluetooth depuis le navigateur (Web Bluetooth : Chrome et Android, pas Safari iOS) ; étudier d'abord comment Boardsesh le fait | L | ★★★ | 4 |
| Réalité augmentée | Board à l'échelle 1 dans sa pièce (WebXR, téléphone) | L | ★★ | 4 |
| Publier un bloc | Dépend des API officielles : à discuter avec Kilter / Boardsesh, pas de contournement | L | ★ | 4 |

## 7. Cadre juridique, partenaires et communauté (en continu, avant toute communication)

| Chantier | Détail | Effort | Valeur |
|---|---|---|---|
| Contacter Boardsesh | Présenter le projet, confirmer l'usage des snapshots et de la géométrie, proposer des liens croisés | S | ★★★ |
| Contacter CruxCoach | Remonter les prises mal classées, suivre la validation de leurs étiquettes | S | ★★ |
| Droits sur les contours | Les contours viennent des images des fabricants : obtenir un accord ou prévoir une alternative | M | ★★★ |
| Marques | Usage des noms Kilter, Tension, MoonBoard ; nom et identité propres au projet | S | ★★ |
| Licence du projet | Choisir une licence pour le code (MIT, Apache-2.0…) | S | ★ |
| Retours utilisateurs | Page de contact ou formulaire, signalement d'erreur sur une prise ou un bloc | S | ★★ |

---

## Prochaines étapes proposées

1. Regrouper les maillages et adapter la qualité graphique au téléphone (performance).
2. Ajouter les contrôles de génération.
3. Refonte du panneau (board / recherche de blocs / fiche bloc), filtres, tri, liens partageables et fichiers de blocs découpés.
4. Écrire à Boardsesh et à CruxCoach.
5. Éditeur de blocs et variantes d'un bloc existant ; l'analyse des mouvements en dernier.

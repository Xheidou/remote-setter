# Sources et crédits

## Données utilisées

| Donnée | Source | Licence / conditions |
|---|---|---|
| Position des trous, tailles de board, contours détourés des prises | [Boardsesh](https://github.com/boardsesh/boardsesh) — `packages/board-constants`, `packages/shared/board-art-geometry` | Code sous Apache-2.0 |
| Blocs et statistiques (cotation, répétitions, qualité par angle) | Snapshots publics nocturnes de Boardsesh | Voir `LEGAL.md` de Boardsesh : télécharger les snapshots et héberger le résultat soi-même ; ne pas utiliser leurs serveurs comme backend d'une app publique |
| Types de prises et orientations | [CruxCoach](https://github.com/CruxCoach/CruxCoach), dossier `androidApp/src/main/assets/hold_types` | CC BY 4.0 — « Hold types by CruxCoach (https://github.com/CruxCoach/CruxCoach), CC BY 4.0 » |
| Dimensions physiques des boards et plages du kicker | Fabricants (Kilter, Tension Climbing, Moon Climbing) | Valeurs reportées dans `scripts/build_board_data.py` |

Les blocs sont créés par leurs ouvreurs ; leur nom est affiché avec chaque bloc.

## Points à vérifier avant une diffusion publique

- Les contours des prises sont détourés par Boardsesh à partir des images des boards publiées par les fabricants : vérifier les droits sur ces images.
- Les étiquettes de types de prises de CruxCoach ne sont pas encore validées à l'aveugle par leur projet (confiance annoncée autour de 0,4).
- Les noms Kilter, Tension et MoonBoard sont des marques de leurs propriétaires.
- Écrire aux mainteneurs de Boardsesh et de CruxCoach pour présenter le projet.

## Approximations connues

- Hauteur du kicker des Tension Boards : non publiée, estimée.
- Positions des prises MoonBoard : reconstruites depuis la grille officielle au pas de 20 cm.
- Relief des prises : forme type par catégorie appliquée au contour réel, pas un scan des modèles.

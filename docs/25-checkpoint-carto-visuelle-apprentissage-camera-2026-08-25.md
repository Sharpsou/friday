# Checkpoint — Carto visuelle et apprentissage caméra

Date : 25 août 2026

Statut : **verticale logicielle implantée ; comportement physique à observer**

État global actuel :
[27-etat-canonique-app-robot-2026-08-25.md](27-etat-canonique-app-robot-2026-08-25.md).
La relocalisation ajoutée ensuite est détaillée dans le checkpoint 26.

Ce checkpoint complète le checkpoint 24. Il ne transforme toujours pas
l’odométrie sans encodeur en SLAM métrique et ne prétend pas reconstruire les
murs de l’appartement.

## Politique caméra enrichie

La politique Dyna-Q ne choisit plus seulement cinq presets. Elle dispose de
treize cibles issues de la plage manuelle : centre, gauche/droite moyens et
larges, haut/bas moyens et larges, et quatre diagonales. L’enveloppe autonome
reste bornée à `pan ±0,85` et `tilt -0,25..+0,65`, donc à l’intérieur des
commandes normalisées déjà accessibles manuellement.

Le système ne prescrit aucun balayage. Après une cible caméra, le hub attend une
nouvelle frame analysée avant d’évaluer la transition. La récompense distingue
désormais :

- un nouveau secteur angulaire observé dans la cellule cartographique ;
- la confiance des objets visibles sur la nouvelle frame ;
- un objet nouvellement confirmé ;
- une vue répétée plus de quatre fois, légèrement pénalisée.

La version de politique passe à 2 afin de ne pas mélanger les anciennes valeurs
Q à l’espace d’actions enrichi. Dyna-Q choisit les amplitudes et les
enchaînements ; les bornes matérielles restent un masque, pas un scénario.

## Ce que la carte stocke réellement

La migration SQLite 23 ajoute deux niveaux de mémoire :

- `robot_map_viewpoints` : position estimée du robot, cap, pan, tilt, nombre
  d’observations et dernière frame ;
- `robot_memory_keyframes` et sa relation aux entités : JPEG déjà présent dans
  le flux, position estimée, orientation et motif de conservation.

Les objets restent des entités symboliques confirmées avec libellé, confiance,
nombre d’observations, points de vue et position 2D approximative. Leur
association utilise désormais l’estimation cartographique, et plus seulement
la case occupée dans l’image : un objet revu après rotation de tête peut donc
converger vers la même entité.

Une image n’est conservée que pendant Carto, lors de la confirmation d’un objet
ou d’un nouveau point de vue utile. Une frame contenant une détection de
personne n’est jamais persistée. Les limites sont 48 images, 3 par objet,
256 Kio par JPEG, 10 secondes entre images et 16 Mio au total. Une détection de
personne manquée par le modèle reste une limite connue : cette mémoire visuelle
est privée au foyer et ne vaut pas un dispositif d’anonymisation parfait.

## Représentation

La vue du dessus distingue maintenant :

- la trajectoire estimée ;
- la pose et son cercle d’incertitude ;
- les directions réellement regardées, affichables ou masquables ;
- les objets confirmés avec sélection tactile ;
- pour l’objet sélectionné, confiance, observations, diversité des points de
  vue et image-clé éventuelle.

Une direction regardée n’est pas un mur ni une mesure de profondeur. La carte
reste une carte de parcours et de mémoire visuelle, pas encore un plan
géométrique fermé de l’appartement.

## Réflexion Friday sur le PC

Le conseiller Friday reçoit maintenant les nombres de points de vue et
d’images-clés avec les métriques de carte. Ces valeurs sont traitées comme des
données non fiables et sa sortie reste validée dans l’énumération fermée des
objectifs. Il ne reçoit pas de droit servo ou moteur et ne commande pas les
actionneurs. Les JPEG ne sont pas injectés automatiquement dans un prompt : la
reconnaissance YOLO du PC en extrait d’abord les faits structurés, plus légers
et auditables. Une analyse multimodale ponctuelle pourra être ajoutée plus tard
sur les seules images-clés, sans ouvrir une voie directe du modèle vers le
robot.

## Validation et déploiement

`pnpm verify` réussit sur le candidat exact : formatage, lint, types, 21 tests
Python, 268 tests TypeScript (22 contrats, 15 domaine, 141 hub et 90 PWA),
builds et 25 scénarios Chrome mobile. Le scénario Robot vérifie aussi le
toucher d’un objet sur la carte. La migration 23 est appliquée sur la base
active après un snapshot cohérent conservé sous
`D:\FridayData\backups\friday-pre-carto-visuelle-20260825-1648.sqlite`.

La recette physique doit maintenant observer les choix de tête réels. Les
tests logiciels prouvent l’enveloppe, la persistance et les récompenses, pas la
qualité mécanique du servo ni la pertinence déjà acquise de la politique.

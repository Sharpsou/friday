# Checkpoint — autonomie Carto AlphaBot2

Date : 25 août 2026

Statut : **verticale logicielle implantée et testée ; recette physique autonome
encore à effectuer**

Ce document remplace, pour l’état de l’autonomie, les verrous historiques des
checkpoints 22 et 23. Il ne transforme pas une validation logicielle en preuve
de comportement réel dans l’appartement.

## Comportement livré

- `Autonome` démarre une exploration continue à la demande du propriétaire ;
  `Manuel` ou `ARRÊT` la termine. Carto démarre automatiquement avec elle.
- La boucle vit dans le hub : elle continue si la PWA passe en arrière-plan ou
  se ferme. Un redémarrage complet du hub clôt le run et ne le reprend jamais
  sans nouvelle action explicite.
- Les vitesses apprises sont limitées à 10, 12, 15, 18 et 20 %. Les impulsions
  restent bornées à 140 ms et le watchdog du Pi demeure l’autorité finale.
- Les deux IR, la présence proche d’une personne, l’état des actionneurs, la
  caméra et le mode courant alimentent un masque d’actions déterministe. Un IR
  bloqué ne laisse que le virage opposé ; deux IR bloqués autorisent une brève
  marche arrière ; une personne latérale ne laisse que son contournement.
- Couper les roues ne stoppe pas le run. Les actions moteur disparaissent du
  même masque tandis que les presets caméra restent candidats : la tête peut
  donc continuer naturellement à observer et cartographier. Il n’existe pas de
  branche spéciale « roues OFF => balayage ».
- La caméra autonome n’utilise que les positions issues du réglage manuel :
  centre `(0 ; 0,20)`, gauche/droite `±0,5`, haut `0,15`, bas `0,25`. Aucun
  angle exotique ni balayage continu n’est généré.

## Apprentissage techniquement retenu

Le noyau est un **Dyna-Q tabulaire en ligne** avec Dyna-Q+ pour conserver de
l’exploration : Q-learning sur chaque transition réelle, modèle appris des
transitions, puis dix rejeux de planification. Les paramètres initiaux sont
`alpha=0,20`, `gamma=0,85`, epsilon décroissant de `0,30` vers `0,08` et bonus
de récence `kappa=0,001`. La puissance et le trim manuels initialisent seulement
les préférences ; ils ne figent pas la politique.

La récompense n’accorde rien au simple fait d’avoir commandé les roues. Elle
combine nouveauté cartographique, nouvelle entité confirmée, sortie effective
d’un blocage, progrès géométrique vers une destination et shaping de potentiel
`gamma*Phi(s')-Phi(s)`. Les erreurs de liaison et sous-tensions interrompent la
transition au lieu d’apprendre qu’une action est mauvaise. Q, modèle, visites,
erreur TD et compteur sont persistés dans SQLite toutes les dix expériences.

Cette politique apprend à choisir parmi des actions déjà masquées ; elle ne
peut pas apprendre à dépasser 20 %, allonger une impulsion, ignorer un IR ou
inventer une position de servo.

## Friday conseiller, jamais pilote direct

Une analyse plus lente est demandée après des événements de progression ou de
stagnation. Friday reçoit uniquement un résumé borné de la carte et choisit un
objectif abstrait dans une énumération stricte. Sa sortie JSON est validée ; une
demande de cible non résolue est rejetée et journalisée. L’objectif module la
récompense locale, mais Friday ne fournit jamais direction, puissance, durée ou
angle. Le Chat est prioritaire : il passe devant les analyses Robot en attente
et interrompt une analyse Robot active.

Le journal visible dans l’onglet Robot conserve démarrage, apprentissage,
récupération, demande d’analyse et objectif accepté ou rejeté.

## Carte et « Va là »

La pose reste une odométrie approximative intégrant direction, puissance et
temps de roulage. La vue du dessus affiche le robot, l’incertitude, les trajets
et les noms d’objets avec placement limitant les superpositions ; déplacement,
pincement et molette restent disponibles.

`Va là` reste refusé tant que le trajet n’est pas terminé et ne contient pas au
moins vingt points. Une destination admissible démarre ou réoriente le mode
autonome. Le cap vers la cible filtre les virages possibles ; Dyna-Q choisit la
vitesse parmi les actions sûres et reçoit une récompense de progrès en distance.
À 15 cm estimés, le robot reprend l’exploration normale. Cette précision est
approximative sans encodeur, IMU ou LiDAR.

## Stockage

La migration 22 ajoute runs autonomes, cellules cartographiques et journal
cognitif. Carto ne persiste aucune vidéo, image, miniature ou JPEG : seulement
géométrie compacte, identifiant de frame, objets confirmés et métriques
d’apprentissage. Les limites de 2 000 points par session et 10 000 par foyer
restent actives.

## Validation et exploitation

`pnpm verify` réussit le 25 août 2026 : formatage, lint, types, 21 tests
Python, 261 tests TypeScript (22 contrats, 15 domaine, 135 hub et 89 PWA),
builds PWA/hub et 25 scénarios Chrome mobile. Les tests couvrent Dyna-Q,
shaping, persistance, masques IR/personne,
cartographie tête seule roues coupées, non-reprise après redémarrage, API,
priorité Chat, seuil `Va là` et runtime Python.

Le déploiement logiciel n’envoie aucune commande et ne reprend aucun run. La
première recette réelle doit commencer roues levées à 10 %, arrêt accessible,
lecture de sous-tension et observation du servo pan. L’utilisateur peut ensuite
démarrer explicitement l’exploration depuis la PWA.

Déploiement du 25 août : le hub/PWA répond sur l’origine A17 et le runtime Pi
expose `map_observer` et `autonomous_exploration`, avec roues et servos OFF,
`armed=false`, `moving=false`. Le redémarrage systemd nécessitait une
authentification interactive non disponible par la clé dédiée ; le binaire
actualisé tourne donc provisoirement sous le compte `pi` (PID consigné dans
`/tmp/friday-robot-manual.pid`) tandis que l’unité reste activée pour le prochain
redémarrage. Il faut exécuter `sudo systemctl restart friday-robot` lors du
prochain accès interactif afin de rétablir la supervision immédiate.

La télémétrie de clôture indique `0x50005`, donc une sous-tension active. La
boucle autonome entre dans `recovering` avant toute action moteur et réessaie
automatiquement ; elle ne doit pas être physiquement recettée tant que le bit
actif n’a pas disparu.

Correction de déploiement : le premier essai du bouton renvoyait `Mode
invalide`, car `controller.py` et `hardware.py` avaient été actualisés tandis
que `models.py` restait ancien dans `venv/site-packages`. Les sources et le
paquet installé ont été resynchronisés. Un appel direct réel à `/mode` a accepté
`autonomous`, puis `manual`, avec roues et servos OFF pendant toute la recette.

## Autorités techniques

- boucle : `apps/hub/src/robot/robot-autonomy.ts` ;
- Dyna-Q et masque : `apps/hub/src/robot/robot-dyna.ts` ;
- carte : `apps/hub/src/robot/robot-mapping.ts` ;
- conseil Friday : `apps/hub/src/assistant/assistant-engine.ts` ;
- API/UI : `apps/hub/src/app.ts`, `apps/web/src/RobotView.tsx` et
  `apps/web/src/RobotMapView.tsx` ;
- runtime Pi : `robot/friday_robot/controller.py` et `hardware.py`.

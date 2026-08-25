# Checkpoint Robot Friday — AlphaBot2-Pi actualisé au 25 août 2026

Statut : **checkpoint matériel/téléopération historique ; état global courant
dans le [document 27](27-etat-canonique-app-robot-2026-08-25.md)**

Les mentions ci-dessous disant que `Autonome` ou `Va là` sont verrouillés
décrivent l’état antérieur aux migrations 22–24. Elles sont conservées comme
preuve de progression et ne doivent pas piloter le candidat actuel.

Ce document décrit le dernier état consolidé. Le
[journal d’implémentation](21-journal-implementation-alphabot2-2026-08-24.md)
conserve la chronologie, le [runbook](runbooks/robot-alphabot2.md) porte les
opérations sûres et le
[plan](20-plan-implementation-robot-friday-alphabot2.md) décrit les phases
restantes. En cas d’écart sur l’état présent du prototype, ce checkpoint puis le
runbook prévalent sur les passages historiques du journal.

## 1. Verdict

Le prototype zéro est utilisable en téléopération réelle. Depuis le checkpoint
24, une autonomie Carto logicielle à faible vitesse est aussi implantée, mais
sa recette physique reste à effectuer. Le Raspberry Pi, la caméra CSI, les
capteurs passifs, les roues
et les deux servos sont intégrés à Friday. Une détection générique
objets/personnes par YOLO26s tourne sur le PC et produit des surimpressions sans
commander les actionneurs. Une cartographie 2D approximative, strictement
observatrice en manuel, peut maintenant accompagner la téléopération. Le LiDAR,
la pince, l’identité consentie, le SLAM métrique et l’évitement fiable ne sont
pas implémentés ; la navigation actuelle reste approximative et monoculaire.

Le matériel présente encore deux limites physiques : le servo panoramique
tremble par intermittence et des sous-tensions ont été enregistrées. Le code
`0x50000` observé en fin de séance signifie qu’une sous-tension est survenue
depuis le démarrage, sans sous-tension active au moment de la lecture. Il ne
prouve ni la réparation de l’alimentation ni la fiabilité des actionneurs.

## 2. Architecture réellement livrée

| Élément          | Langage / technologie    | Hébergement                                        | Responsabilité                                                    |
| ---------------- | ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------- |
| onglet `Robot`   | React, TypeScript, CSS   | PWA servie par le PC, utilisée notamment sur l’A17 | vidéo, switchs, joystick, caméra, puissance, trim, surimpressions |
| contrats         | TypeScript, Zod          | paquet partagé du monorepo                         | validation stricte des états et commandes                         |
| passerelle Robot | TypeScript, Fastify      | hub Friday sur le PC `192.168.1.14`                | session, origine, débit, réhorodatage, proxy caméra               |
| runtime matériel | Python 3                 | Raspberry Pi `192.168.1.22:8765`                   | watchdog, GPIO, PCA9685, capteurs, arrêt local                    |
| flux CSI         | Python et `rpicam-vid`   | Pi, service `friday-camera.service`                | MJPEG 640×480, 15 images/s                                        |
| vision active    | TypeScript, ONNX Runtime | Worker Node séparé sur le PC du hub                | YOLO26s, objets/personnes, aucune voie vers les actionneurs       |
| modèle actif     | ONNX, COCO-2017          | `D:\FridayData\robot\models\yolo26s.onnx`          | poids hors Git, manifeste, licence et SHA-256 vérifiés            |
| Carto 2D         | TypeScript, SQLite, SVG  | hub et PWA Friday                                  | odométrie estimée, objets confirmés, carte tactile sans images    |

La PWA ne parle jamais directement au Pi. Les commandes physiques ne passent
ni par l’outbox offline, ni par le service worker, ni par le Chat, et ne sont
jamais rejouées.

## 3. Matériel et services

- Raspberry Pi 3 Model B Rev 1.2 sous Raspberry Pi OS Trixie 32 bits ;
- AlphaBot2-Pi à roues différentielles, sans encodeurs, LiDAR ni pince ;
- caméra CSI Camera (B), objectif physiquement étroit ;
- PCA9685 à l’adresse I²C `0x40`, 50 Hz : pan canal 0, tilt canal 1 ;
- deux IR avant et cinq voies de suivi de ligne TLC1543, actuellement passifs ;
- services Pi `friday-camera.service` et `friday-robot.service` ;
- production en mode `alphabot2` uniquement ; aucune option de simulation dans
  le lanceur, la PWA ou le service Pi ;
- doublures simulées conservées uniquement par injection dans les tests.

Accès opérateur : `infra/windows/Open-FridayRobotSsh.cmd`, utilisateur `pi`, clé
privée sous `D:\FridayData\robot\ssh\alphabot2_runtime_v3_ed25519`. Le secret
Bearer et la configuration du hub restent hors Git dans
`D:\FridayData\robot\hub.json`. Aucun mot de passe ni jeton ne doit être ajouté
à la documentation.

## 4. Commandes et sécurité livrées

Les roues et les servos démarrent désactivés après un redémarrage du runtime Pi.
Dans la PWA, les switchs `Roues` et `Caméra` les activent séparément. Passer
`Roues` à ON active les sorties puis arme une autorisation interne de 60 s,
renouvelée toutes les 45 s tant que la page est visible et le switch actif.
L’armement seul ne déplace jamais le robot.

Chaque impulsion de locomotion expire localement après 100 à 500 ms, 350 ms par
défaut. Le hub donne 1 800 ms au transport réseau sans allonger cette durée
moteur. Le relâchement du joystick appelle `/halt`, qui arrête sans désarmer ;
`ARRÊT`, la fermeture de page, le switch Roues OFF, une expiration ou un
redémarrage arrêtent et désarment.

L’interface actuelle comporte :

- deux boutons explicites `Manuel` et `Autonome` ; `Autonome` reste désactivé
  et refusé côté hub tant que la porte physique n’est pas validée ;
- en mode manuel, `Carto` démarre, met en pause, reprend ou termine une session
  d’exploration ; `Carte` ouvre la vue du dessus tactile ;
- un joystick tactile elliptique de 164×112 px sous la vidéo ;
- les diagonales par mélange différentiel `gauche = linéaire + direction` et
  `droite = linéaire - direction`, puis normalisation ;
- une zone neutre horizontale de 35 % en marche et une courbe exponentielle
  `1,5` ;
- une direction maximale interpolée de `1,0` à 10 % de puissance à `0,55` à
  35 %, mais une rotation sur place complète dans la bande verticale de 22 % ;
- une puissance persistée de 10 à 35 %, valeur initiale 20 % ;
- un trim persistant `G 10` à `D 10`, appliqué seulement en marche avant ; la
  marche arrière et les rotations sur place restent sans correction ;
- la transmission forcée de tout retour d’une direction non nulle à zéro ;
- cinq petits boutons caméra ; le centre vise `pan=0`, `tilt=+0,20` et les pas
  haut/bas valent `0,05` ;
- le pan par grands pas normalisés de `0,5`, avec une rampe de 10 µs toutes les
  20 ms, sans balayage automatique ;
- aucun mouvement de caméra pendant la locomotion ; depuis le checkpoint 24,
  une commande caméra ne met plus Carto en pause. La locomotion attend toujours
  le retour au preset sûr `pan=0`, `tilt=+0,20`.

## 4.1 Cartographie observatrice livrée

La migration SQLite 21 ajoute des sessions, des points de trajectoire, une pose
courante et des aperçus de mission. La position est une estimation : le hub
intègre direction, puissance, trim et temps écoulé entre les impulsions moteur
acceptées. Sans encodeurs ni IMU, elle dérive et son incertitude augmente avec
la distance, les rotations et les sous-tensions.

Seuls les objets déjà confirmés par la mémoire visuelle sont ancrés sur la
carte. Les personnes restent anonymes et ne sont pas cartographiées comme des
objets stables. La vue SVG affiche les trajets, la pose et son cercle
d’incertitude, ainsi qu’un nombre borné d’étiquettes placées sans superposition
grossière. Elle accepte glissement et pincement tactiles. Un point de trajet
peut être sélectionné avec `Va là`, mais cette action ne produit qu’un aperçu
refusé : elle n’a aucune voie vers les moteurs.

Carto n’enregistre ni vidéo, ni JPEG, ni miniature. Un point ne contient que
géométrie, commande bornée, identifiant de frame et horodatage, estimés à 96
octets. Une session est bornée à 2 000 points, le foyer à 10 000 points et le
budget déclaré à 250 Mio ; les brouillons anciens peuvent être purgés. Une
session interrompue par le redémarrage du hub revient en pause, jamais en
enregistrement silencieux.

## 5. Vidéo et capacités cognitives

Le flux est affiché en 4:3 avec `object-fit: contain`, donc sans recadrage 16:9.
La chaîne utilise 640×480, 15 images/s, deux buffers, `rpicam-vid --flush`, des
lectures maximales de 16 Kio avec `read1()` et des en-têtes de proxy sans cache.
Une mesure de quatre secondes a observé 43 images en incluant le démarrage, puis
une cadence proche de 14–15 images/s et environ 269 Kio/s. Cette mesure ne vaut
pas encore benchmark de latence tactile de bout en bout.

Les contrats et les contrôles de surimpression existent. Le détecteur actif sur
le PC est YOLO26s ONNX, 36,5 Mo, COCO, licence AGPL-3.0 et SHA-256 vérifié avant
chargement par ONNX Runtime CPU dans un Worker Node séparé. Cette isolation
empêche l'inférence de retarder la boucle des commandes moteur. Il analyse par
défaut une image sur deux du flux 15 images/s ; si une inférence est encore en
cours, les nouvelles images sont jetées plutôt que mises en attente. La dernière
surimpression reste visible jusqu'au résultat suivant avec une expiration de
deux secondes.

Le poids officiel provient de
`https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s.onnx`.
Sa taille est de 38 291 130 octets et son SHA-256 attendu est
`d26b65c432111eb95798cd2320603d4d75627605dbec6c6b7f98c499a80e7321`.
Le manifeste versionné est `robot/models/yolo26s.manifest.json`; sa copie
d'exploitation et le poids résident sous `D:\FridayData\robot\models`. Le script
`infra/windows/Install-FridayRobotVisionModel.ps1` télécharge dans un fichier
temporaire, vérifie l'empreinte puis installe l'artefact. Le poids n'entre jamais
dans Git ni dans la PWA.

L'interface ne présente plus les cinq filtres techniques de surimpression. Une
seule case `Reco` affiche ou masque ensemble toutes les détections disponibles.

Le flux CSI est ouvert une seule fois par le hub puis distribué à la fois au
détecteur et aux clients vidéo. Cette mutualisation corrige la perte d'image
observée lorsqu'une seconde instance `rpicam-vid` était lancée pour la PWA ; un
test de régression vérifie qu'une ouverture UI ne crée aucune seconde capture.

Sur trois images réelles sombres du robot, le moteur TypeScript YOLO26s a pris
112 à 145 ms par inférence chaude. Au seuil 0,30, il a retrouvé table, bouteille
et chaises sans le faux positif `Personne` produit par YOLO26n. Le premier appel,
chargement du modèle inclus, a pris environ 780 ms. Une personne reste toujours
libellée `Personne` ; aucune identité ni attribut sensible n’est recherché,
aucune photo n’est persistée et aucune détection ne peut commander un
actionneur. Le débit franchit la gate technique R5 des cinq détections/s ;
précision/rappel et scènes réelles variées restent à mesurer.

L'isolation a été décidée après un test A/B : avec l'inférence dans le processus
principal, `/api/health` atteignait 387 ms et pouvait dépasser l'impulsion moteur
de 350 ms ; vision coupée, la médiane tombait à 9 ms. Après passage au Worker et
sur une connexion persistante avec la vision active, les mesures donnent une
médiane de 2,1 ms, p95 3,4 ms, p99 4,3 ms et maximum 71,4 ms ; aucune réponse
n'a dépassé 170 ms. Le Worker protège donc la boucle Node mesurée ; il ne
remplace ni le watchdog du Pi ni une recette physique d'endurance.

L’ordre retenu reste :

1. détection générique d’objets et de personnes sur le PC ;
2. suivi anonyme et expiration des observations ;
3. AprilTags et déplacements très courts en enceinte fermée ;
4. identité uniquement après consentement, chiffrement et suppression testée ;
5. benchmark optionnel d’un modèle léger sur le Pi, sans déplacer le watchdog.

La détection monoculaire et les IR ne constituent pas un évitement fiable.
Aucune locomotion autonome n’est autorisée sans capteur de distance et recette
spécifique.

## 6. État observé sans mouvement à la clôture de l’audit

Lecture effectuée le 24 août 2026 vers 19 h 17–19 h 18, sans commande de roue ni
de servo :

- API Pi joignable en mode `alphabot2` ;
- `friday-camera.service` et `friday-robot.service` actifs ;
- `moving=false` ;
- switchs persistés dans le runtime : roues ON, servos ON ;
- armement interne encore actif au moment de la lecture ;
- `vcgencmd get_throttled` : `0x50000` ;
- température : 49,4 à 50,5 °C.

Cet instantané n’est pas une garantie pour le prochain allumage. Le prochain
chat doit toujours relire l’état. Avant un essai physique, placer les switchs
sur OFF puis suivre le runbook ; ne jamais supposer que l’état précédent a été
conservé ou remis à zéro.

## 7. Preuves et limites de validation

Le contrôle complet relancé le 25 août après l’ajout de Carto réussit : 21 tests
Python, 252 tests TypeScript unitaires/intégration (22 contrats, 15 domaine, 126
hub et 89 PWA), builds
PWA/hub et 25 scénarios Chrome mobile. La commande
d’autorité reste `pnpm verify`. Les tests couvrent les contrats, la passerelle,
le runtime Python, le joystick, le trim, les délais, les switchs, la capture
unique, le moteur YOLO, le Worker et un scénario Chrome mobile à 360 px sans
commande autonome.

Sont réellement observés : flux CSI, téléopération, rotations et diagonales,
activation des actionneurs, servo tilt, tremblement intermittent du pan, faible
couple à 20 %, dérive en ligne droite et effets de sous-tension. Ne sont pas
validés : valeur finale du trim, ligne droite mesurée, endurance, navigation,
évitement, qualité de la reconnaissance sur scènes réelles, identité, modèle
sur Pi et remplacement du servo.

## 8. Fichiers d’autorité

- UI : `apps/web/src/RobotView.tsx`, `apps/web/src/robot-drive-controls.ts`,
  `apps/web/src/robot-camera-controls.ts`, `apps/web/src/styles.css` ;
- client et hub : `apps/web/src/sync/robot-client.ts`, `apps/hub/src/app.ts`,
  `apps/hub/src/robot/robot-controller.ts`,
  `apps/hub/src/robot/robot-vision.ts`,
  `apps/hub/src/robot/robot-vision-worker-client.ts` et
  `apps/hub/src/robot/robot-vision-worker.ts` ;
- modèle : `robot/models/yolo26s.manifest.json` dans Git ; poids et manifeste
  d'exploitation sous `D:\FridayData\robot\models` ;
- contrats : `packages/contracts/src/index.ts` ;
- Pi : `robot/friday_robot/`, `robot/deploy/` et `robot/README.md` ;
- exploitation : `docs/runbooks/robot-alphabot2.md` ;
- chronologie : `docs/21-journal-implementation-alphabot2-2026-08-24.md` ;
- cartographie : `apps/hub/src/robot/robot-mapping.ts`,
  `apps/web/src/RobotMapView.tsx` et `apps/web/src/robot-map-layout.ts` ;
- suite : `docs/20-plan-implementation-robot-friday-alphabot2.md`.

## 9. Utilisation de ce checkpoint

Ne pas démarrer une reprise depuis ce document seul. Lire `AGENTS.md`, le
[handoff 00](00-reprise-nouveau-chat.md), le
[document 27](27-etat-canonique-app-robot-2026-08-25.md) et le
[runbook Robot](runbooks/robot-alphabot2.md).

Ce checkpoint reste utile pour les faits matériels, la téléopération, les
mesures YOLO/latence et l’état observé le 24 août. Il ne décrit pas les
capacités ajoutées ensuite : autonomie Dyna-Q, mémoire visuelle, politique
caméra enrichie, fermeture de boucle et relocalisation après déplacement à la
main.

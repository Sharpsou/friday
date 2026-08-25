# Journal d’implémentation — AlphaBot2-Pi du 24 août 2026

Statut : **journal chronologique clos ; consulter le checkpoint 22 pour l’état
présent, le robot ayant depuis été rallumé, déployé et téléopéré**.

> Source d’état actuelle :
> [22-checkpoint-robot-alphabot2-2026-08-24.md](22-checkpoint-robot-alphabot2-2026-08-24.md).
> Les mentions `simulated`, `0x50005`, « robot éteint » ou « roues
> neutralisées » ci-dessous décrivent un instant historique de la séance, pas le
> dernier état du prototype.

Ce document est le journal factuel de la séance. Il complète le
[document fondateur](19-document-fondateur-agent-physique-friday.md), le
[plan directeur](20-plan-implementation-robot-friday-alphabot2.md) et le
[runbook](runbooks/robot-alphabot2.md). Il ne transforme aucun essai supervisé
en validation d’autonomie.

## 1. État livré dans Friday

- un service Python 3 séparé dans `robot/`, avec contrats bornés, Bearer token,
  watchdog et arrêt au désarmement/expiration/exception ; la production
  n’accepte plus que le mode `alphabot2` ;
- une passerelle Fastify authentifiée entre la PWA et le Pi, sans outbox,
  rejeu offline ni accès direct du Chat aux sorties physiques ;
- un onglet `Robot` dans la PWA : flux caméra, état, télémétrie, switchs,
  arrêt, joystick différentiel, commandes de tête, puissance, trim et options de
  surimpression ;
- un flux CSI réel relayé par le Pi puis par le hub, aujourd’hui en `640×480` à
  15 images/s ;
- des lectures réelles, mais passives, des deux IR avant et des cinq voies du
  TLC1543 ;
- un pilote PCA9685 à 50 Hz pour les deux servos, utilisable alors que le reste
  du matériel demeure simulé ;
- les services systemd `friday-camera.service` et `friday-robot.service`, plus
  le raccourci Windows d’accès SSH par clé.

La reconnaissance d’objets, de personnes ou de visages n’est pas encore une
inférence réelle : l’interface et les contrats d’overlay sont prêts, mais les
poids, le benchmark PC/Pi et les jeux de validation restent les phases R5 à R7.
L’évitement autonome n’est pas implanté et ne peut pas reposer sur la seule
caméra ou les seuls IR.

## 2. Reconditionnement et accès au Pi

Le Raspberry Pi 3 Model B Rev 1.2 a été réinstallé avec Raspberry Pi OS Trixie
32 bits. Il répond sur le LAN privé à `192.168.1.22`, SSH standard port 22, avec
une clé dédiée conservée hors Git dans `D:\FridayData\robot\ssh`. Aucun mot de
passe, token robot, PSK Wi-Fi ou clé privée n’est enregistré dans le dépôt.

Avant la réinstallation, la carte a été sauvegardée hors dépôt :

- image : `D:\FridayData\robot\backups\alphabot2-before-reimage-20260824.qcow2` ;
- hash SHA-256 : fichier voisin conservé avec l’image ;
- extraction de contrôle en lecture seule :
  `D:\FridayData\robot\backups\alphabot2-before-reimage-extract\1.img`.

L’ancien pilote `/home/pi/mjpg-AlphaBot/PCA9685.py` a été extrait de cette
image et comparé au pilote Waveshare courant. La copie historique installée à
des fins de diagnostic sous `/home/pi/legacy-alphabot2/` donne le même
comportement électrique : le tremblement horizontal et la sous-tension ne
proviennent donc pas d’une différence d’adresse I²C ou d’un pilote réinventé.

## 3. Caméra et capteurs

La caméra CSI fonctionne avec `rpicam-vid`. Une règle CSS rendait par erreur le
flux réel transparent dans l’ancien mode de transition ; elle a été supprimée.
Les actionneurs peuvent rester neutralisés tout en affichant l’image réelle.

`i2cdetect -y 1` ne montre que le PCA9685 à l’adresse `0x40`. Les deux axes
partagent cette adresse mais utilisent des canaux distincts : canal 0 pour le
panoramique, canal 1 pour l’inclinaison. Les IR et le TLC1543 ont fourni des
valeurs cohérentes en lecture passive. Aucun de ces résultats ne constitue une
qualification anticollision ou antichute.

## 4. Diagnostic et réglage des servos

Le pilote initial conservait le bit `SLEEP` du registre `MODE1` lors du réglage
de fréquence. Les registres de canaux changeaient alors sans produire de PWM.
L’initialisation réveille désormais explicitement le PCA9685 ; après correction,
`MODE1=0x01` a été observé.

La correspondance et les réglages actuels sont :

| Axe           | Canal |    Centre | Plage logicielle | Commande PWA                                         |
| ------------- | ----: | --------: | ---------------: | ---------------------------------------------------- |
| gauche/droite |     0 | `1500 µs` |    `700–2300 µs` | pas normalisé de `0,5`, sens corrigé pour le montage |
| haut/bas      |     1 | `1500 µs` |    `900–2100 µs` | pas normalisé de `0,05`                              |

La plage panoramique est symétrique autour de 1500 µs : chaque grand clic
horizontal représente 400 µs. Le dernier algorithme rejoint la cible par pas de
10 µs toutes les 20 ms, conserve le signal pendant tout le trajet, attend 40 ms
à destination puis libère une seule fois le canal. Un déplacement horizontal à
mi-course prend environ 0,8 s ; un retour d’une extrémité au centre environ
1,6 s. L’inclinaison seule conserve une commande directe courte de 60 ms.

Essais physiques supervisés réalisés, roues désactivées et robot tenu :

- centrage des deux axes à 1500 µs ;
- balayages horizontaux continus vers les limites puis retour ;
- cinq cycles entre 700 et 2000 µs, puis trois cycles avec des pas de 25 µs ;
- essai lent avec des pas de 5 µs espacés de 40 ms ;
- comparaison avec le pilote historique exact ;
- correction du sens des boutons et de l’amplitude asymétrique.

Un premier balayage de diagnostic, 25 µs toutes les 8 ms, était trop rapide :
il évoluait plus vite que la période PWM de 20 ms et n’était pas réaliste pour
la mécanique. Il ne doit pas être reproduit. Les séquences suivantes ont
respecté au minimum la période de commande et n’ont libéré le PWM qu’à la fin.

Observation utilisateur persistante : le servo horizontal tremble de façon
intermittente et son comportement n’est pas reproductible à chaque mouvement,
alors que l’axe vertical est nettement plus propre. Le diagnostic le plus
probable est un défaut ou une usure du servo panoramique, aggravé par une
alimentation marginale. Ce n’est pas une preuve définitive tant que servo et
alimentation n’ont pas été testés séparément.

Le réglage final de rampe lente a été déployé et couvert automatiquement, mais
le robot a été éteint avant sa validation visuelle finale par l’utilisateur.
Il reste donc **à confirmer physiquement**, sans relancer de balayage répétitif.

## 5. Alimentation et sécurité

`vcgencmd get_throttled` a affiché à plusieurs reprises `0x50005` pendant les
mouvements : sous-tension et bridage actifs, avec événements historiques. Après
relâchement des sorties, `0x50000` a parfois subsisté ; une sous-tension active a
aussi persisté lors de certains essais. Une baisse de tension peut s’expliquer
par la charge, mais elle n’est pas considérée comme normale ni acceptable pour
une recette de production.

État de sûreté en fin de séance :

- robot éteint par l’utilisateur ;
- runtime Pi de la séance initialement configuré en `simulated`, puis cible de
  déploiement corrigée en `FRIDAY_ROBOT_MODE=alphabot2` après extinction ;
- roues et GPIO moteurs jamais activés dans cette configuration ;
- capteurs réels et servos caméra seulement activables par drapeaux explicites ;
- aucune locomotion réelle revalidée après la réinstallation ;
- aucune autonomie, suivi de personne ou évitement actif autorisé.

## 6. Reprise au prochain allumage

1. Poser le robot de façon stable, roues hors contact ou sorties moteur toujours
   neutralisées, tête libre et interrupteur accessible.
2. Attendre le démarrage complet puis ouvrir le raccourci SSH Friday Robot.
3. Vérifier `systemctl --no-pager --full status friday-camera friday-robot`,
   `i2cdetect -y 1` et `vcgencmd get_throttled` avant tout mouvement.
4. Ouvrir l’onglet `Robot` et confirmer d’abord le flux vidéo et la télémétrie.
5. Tester un seul grand clic horizontal depuis le centre, puis recentrer ; ne
   pas effectuer de balayage automatique. Relever tremblement et code
   `get_throttled`.
6. Si le tremblement revient, couper les PWM, ne pas insister et tester plus
   tard le servo pan et une alimentation 5 V stable séparément.
7. Ne commencer les roues qu’après une nouvelle porte explicite : robot sur
   cales, sens de chaque moteur à faible PWM, stop local et watchdog mesurés.

## 7. Vérification logicielle de fin de séance

Après le retrait du mode simulation, `pnpm verify` réussit le 24 août avec 18
tests Python Robot, 22 tests contrats, 15 domaine, 109 hub, 80 web et 25
scénarios E2E Chrome mobile, ainsi que les builds PWA et hub. Cette preuve est
logicielle : elle ne sollicite pas le robot éteint et ne valide pas physiquement
le dernier lissage du servo pan.

Références matérielles :

- [wiki officiel Waveshare AlphaBot2-Pi](https://www.waveshare.com/wiki/AlphaBot2-Pi) ;
- [page produit officielle AlphaBot2-Pi](https://www.waveshare.com/product/robotics/mobile-robots/alphabot2-pi-acce-pack.htm).

## 8. Évolution de l’interface après extinction

L’onglet Robot a été compacté pendant que le robot restait éteint :

- suppression des deux titres `Corps physique` et `Robot` ;
- barre haute avec état, mode et deux interrupteurs `Roues` / `Caméra` ;
- les deux familles d’actionneurs démarrent désactivées après chaque redémarrage
  du runtime embarqué ;
- couper les roues arrête le mouvement et désarme immédiatement ;
- couper la caméra libère les deux canaux PWM et refuse les nouvelles consignes
  pan/tilt ;
- remplacement de la croix de locomotion par un joystick circulaire tactile,
  placé sous l’image après retour utilisateur ;
- petits boutons caméra gauche/haut/centre/bas/droite sous le flux ;
- le retour du joystick au centre arrête les roues sans retirer l’armement ; le
  bouton `ARRÊT`, la perte de visibilité et la désactivation des roues restent
  désarmants.

Le flux réel reste visible lorsque les actionneurs sont coupés. Un scénario
Chrome mobile à 360 px couvre les interrupteurs, l’absence du double titre, l’activation
des commandes caméra, l’armement et une commande `forward` par glissement du
joystick suivie d’un arrêt au relâchement.

Le Raspberry Pi était éteint pendant cette évolution. À son rallumage, un `404`
sur `/actuators` a confirmé qu’il exécutait encore l’ancien service. Le runtime a
alors été copié, ses 18 tests ont réussi sur le Pi, le paquet a été réinstallé et
`friday-robot.service` a redémarré en mode `alphabot2`. Une requête sûre gardant
les deux switchs à `false` a répondu `accepted: true`, avec `armed=false` et
`moving=false`.

À la demande de l’utilisateur, le mode simulation a ensuite été retiré du
service embarqué, du lanceur Windows et de l’interface. La cible de production
est uniquement `alphabot2`. Les moteurs sont initialisés à zéro et les deux
familles d’actionneurs restent désactivées dans le contrôleur après chaque
démarrage. Le simulateur TypeScript/Python subsiste seulement comme doublure
injectée directement par les tests automatisés ; aucun paramètre de production
ne peut le sélectionner.

Après déploiement, `friday-camera.service` et `friday-robot.service` sont actifs,
la caméra est disponible et l’API expose bien les deux actionneurs désactivés. La
télémétrie retournait cependant `throttledCode=0x50005`, soit une sous-tension
active et déjà survenue. Aucun mouvement n’a été envoyé pendant la recette ; les
actionneurs ne doivent pas être déplacés avant correction ou stabilisation de
l’alimentation.

## 9. Rejet générique des commandes après déploiement

Après la correction du `404`, l’activation du switch caméra atteignait bien le
Pi, mais les commandes suivantes pouvaient être refusées sous le libellé trop
générique `Commande Robot indisponible`. Deux défauts ont été corrigés :

- la consigne caméra expirait après 800 ms alors que le flux vidéo, le réseau et
  le lissage du pan peuvent légitimement dépasser cette marge ; sa validité est
  portée à 1 800 ms et le hub accepte spécifiquement une durée caméra maximale
  de 2 000 ms ;
- le hub attend désormais jusqu’à 3 500 ms le résultat d’un mouvement caméra et
  propage le motif précis renvoyé par le Pi. La PWA traduit également les refus
  d’origine, de rôle, de débit et de commande expirée au lieu de les masquer.

Le serveur Python journalise maintenant la trace d’une exception matérielle
avant son arrêt de sûreté. Les 18 tests Python, 109 tests hub, 80 tests PWA et 25
scénarios Chrome mobile réussissent. Le paquet a été redéployé sur le Pi, les
services Pi et Friday ont été redémarrés et leurs contrôles de santé réussissent.
Après redémarrage, `armed=false`, `moving=false` et les deux familles
d’actionneurs sont désactivées. La télémétrie signale toujours `0x50005` ; aucun
mouvement physique n’a donc été utilisé pour cette vérification finale.

Lors de la recette utilisateur suivante, le message précis
`Commande caméra expirée` a confirmé un décalage entre l’horloge du navigateur
et l’autorité temporelle du robot. Le hub ne compare donc plus l’échéance caméra
à l’horloge du téléphone : après authentification, contrôle d’origine, validation
du schéma et limitation de débit, il remplace `issuedAt` et `expiresAt` par une
fenêtre fraîche de 1 800 ms issue de sa propre horloge avant l’envoi au Pi. Les
commandes de roues conservent leur validation temporelle stricte, car elles
pilotent un mouvement continu et non une simple position cible.

La recette suivante a montré le même faux rejet sur les roues. Le hub est donc
également devenu l’autorité temporelle de chaque impulsion de locomotion après
authentification, contrôle d’origine, validation stricte du schéma et limitation
de débit. Contrairement à la caméra, il ne crée pas une fenêtre longue : il
conserve `maxDurationMs`. Une première échéance de transport égale à cette
impulsion a encore provoqué `Commande expirée ou trop longue` sur le Pi : elle
confondait temps réseau et temps moteur. L’échéance de transport est donc de
1 800 ms, tandis que le contrôleur embarqué borne toujours le mouvement avec
`min(expiresAt, now + maxDurationMs)` : 350 ms par défaut et 500 ms au maximum.
L’arrêt au relâchement, l’armement, la désactivation des roues et le watchdog Pi
restent inchangés.

Lors des premiers essais de locomotion, la rotation sur place manquait de couple
avec la consigne générique de 20 %. La télémétrie au repos indiquait alors
`0x50000` : aucune sous-tension active, mais un événement historique toujours
mémorisé. Plutôt que d’imposer une puissance par direction, la PWA expose sous
le joystick un curseur `Puissance` de 10 à 35 %, mémorisé localement et appliqué
aux quatre directions. La valeur initiale reste 20 %. La borne haute est celle
déjà imposée par les contrats et le contrôleur embarqué ; les impulsions restent
limitées à 350 ms et le watchdog est inchangé.

À la demande de l’utilisateur, le flux caméra abandonne ensuite le cadrage 16:9
et passe de 640×360 à 640×480. Le conteneur PWA est désormais en 4:3 et utilise
`object-fit: contain` : aucun zoom CSS, étirement ou recadrage supplémentaire
n’est appliqué. Ce changement récupère la hauteur disponible du capteur ; il ne
peut pas élargir horizontalement l’objectif physique étroit de la Camera (B).

Le joystick transmet désormais une direction différentielle continue. Une
diagonale conserve la composante avant ou arrière et ajoute un angle signé de
`-1` à `+1` selon l’inclinaison horizontale. Le Pi mélange cette consigne en
vitesses gauche/droite distinctes : une courbe légère ralentit peu la roue
intérieure, une courbe forte la ralentit davantage, et une position presque
strictement horizontale conserve la rotation sur place. Après normalisation,
aucune roue ne dépasse la puissance choisie (10–35 %). L’arrêt au relâchement,
les capteurs IR avant, l’armement et le watchdog 100–500 ms sont inchangés.

Après recette tactile, la zone du joystick passe de 108×108 à 164×112 px. Son
calcul utilise des rayons horizontal et vertical distincts : le déplacement du
doigt est moins sensible horizontalement tout en conservant toute la plage de
direction. Le bouton `Armer 60 s` est retiré. Activer le switch `Roues` arme la
session interne et la PWA la renouvelle toutes les 45 s tant que ce switch reste
actif ; cette autorisation n’entraîne aucun mouvement. `ARRÊT` coupe désormais
le switch des roues, arrête et désarme. Le watchdog court de chaque impulsion
reste l’autorité d’arrêt moteur.

La chaîne vidéo est ensuite réglée pour réduire sa latence sans changer le
cadrage 640×480 : passage de 10 à 15 images/s, seulement deux buffers caméra et
activation de `rpicam-vid --flush`. Le relais Python utilise désormais
`read1()` par blocs maximaux de 16 Kio et vide immédiatement sa sortie, au lieu
de pouvoir attendre 64 Kio avant de transmettre. Le hub annonce aussi
`Cache-Control: no-store, no-transform` et `X-Accel-Buffering: no`. Ces réglages
visent le retard de bout en bout ; ils ne modifient aucun actionneur.

Le réglage suivant adoucit la direction en marche : la composante horizontale
reste neutre jusqu’à 35 % de course, puis suit une courbe exponentielle de 1,5.
L’angle maximal dépend aussi de la puissance choisie : `steering=1` reste
accessible à 10 %, puis décroît progressivement jusqu’à `0,55` à 35 %. Le robot
peut donc serrer davantage son virage à faible vitesse sans accepter la même
brutalité à forte puissance. La bande presque horizontale (22 % verticalement)
continue de commander une rotation sur place gauche/droite, sans cette limite.

Un défaut du filtre de commandes pouvait conserver un petit angle : lorsqu’une
première consigne inférieure à `0,05` était acceptée avec le passage initial en
marche avant/arrière, son retour exact à zéro était ensuite filtré. Le passage
de toute valeur non nulle à `steering=0` est maintenant toujours transmis et
devient immédiatement la valeur répétée par la boucle de maintien.

La demande « zéro vertical à 20 » concernait en réalité le recentrage de la
caméra, et non le joystick. La bande de rotation sur place est donc remise à
22 %. Le bouton central de la caméra vise maintenant `pan=0`, `tilt=+0,20`, soit
20 points plus bas que l’ancien neutre vertical à zéro.

Un curseur `Trim direction` est ajouté sous la puissance pour compenser une
dérive mécanique en ligne droite. Il est borné de `G 10` à `D 10`, vaut zéro
par défaut et reste mémorisé localement. Le trim s’ajoute uniquement aux
commandes avant/arrière ; les rotations sur place gauche/droite restent
symétriques. Le retour du joystick sur son axe force immédiatement la consigne
de trim, même si sa variation est inférieure au filtre normal de `0,05`.

## 10. Clôture et autorité de reprise

Ce journal conserve volontairement les états successifs, y compris ceux qui ont
été remplacés dans la même journée. L’audit final a vérifié le Pi sans mouvement :
API joignable en mode `alphabot2`, deux services actifs, `moving=false`,
température voisine de 50 °C et `throttled=0x50000`. Les switchs roues et caméra
étaient sur ON et l’armement encore actif lors de cette lecture ; ce n’est pas un
état à présumer au prochain démarrage.

Pour reprendre, utiliser le
[checkpoint 22](22-checkpoint-robot-alphabot2-2026-08-24.md) puis le
[runbook](runbooks/robot-alphabot2.md), et ne relire ce document que pour
comprendre la chronologie d’un défaut ou d’une décision.

La vérification fraîche de clôture réussit avec 21 tests Python, 233 tests
TypeScript unitaires/intégration, les builds PWA/hub et 25 scénarios Chrome
mobile.

Après essai utilisateur, la dérive corrigée n’a pas été retrouvée en marche
arrière. Le trim est donc limité à la marche avant ; la marche arrière et les
rotations sur place utilisent désormais la direction brute du joystick.

## 11. Addendum du 25 août — vision réelle et interface simplifiée

Cet addendum remplace les affirmations historiques de la section 1 selon
lesquelles la détection n'était pas encore réelle. Le premier candidat
SSD-MobileNet a été testé puis remplacé par YOLO26s ONNX, plus pertinent sur les
images sombres fournies par la caméra du robot. Le poids officiel AGPL-3.0 de
38 291 130 octets est installé hors Git sous
`D:\FridayData\robot\models\yolo26s.onnx`; son SHA-256 est
`d26b65c432111eb95798cd2320603d4d75627605dbec6c6b7f98c499a80e7321` et son
manifeste versionné est `robot/models/yolo26s.manifest.json`.

Le hub ouvre maintenant une seule capture MJPEG du Pi et la distribue à la PWA
et au détecteur. Cette mutualisation corrige la disparition de l'image causée
par deux ouvertures concurrentes de `rpicam-vid`. YOLO analyse par défaut une
image sur deux ; une image arrivant pendant une inférence est abandonnée, sans
file d'attente, et la dernière surimpression reste affichée jusqu'au résultat
suivant avec une expiration à deux secondes. Les cinq anciennes cases
techniques sont remplacées par une seule case `Reco`.

Une première intégration dans le processus principal a montré une médiane
`/api/health` de 141 ms et une pointe à 387 ms pendant l'inférence, suffisante
pour expliquer des coupures périodiques par le watchdog de 350 ms. Le moteur a
donc été déplacé dans un Worker Node construit séparément. Après isolation, la
mesure persistante donne 2,1 ms de médiane, 3,4 ms p95, 4,3 ms p99 et 71,4 ms
maximum, sans réponse au-dessus de 170 ou 350 ms. Le watchdog Pi reste
l'autorité d'arrêt.

Sur trois images réelles sombres, les inférences chaudes prennent 112 à 145 ms
et retrouvent table, bouteille et chaises au seuil 0,30. Le chargement initial
prend environ 780 ms. Ce test ne remplace pas un corpus consenti ni des mesures
de précision/rappel.

Enfin, le menu technique sélectionné sur `Manuel` a été retiré. Le manuel est
implicite et l'activation des roues force le mode `manual` avant l'armement.
`Cartographie` et `Autonome` sont visibles comme fonctions `À venir`, mais
restent désactivées et sans commande. Aucun mouvement physique n'a été requis
pour cette modification.

La vérification complète du candidat final réussit avec 21 tests Python, 238
tests TypeScript unitaires/intégration (22 contrats, 15 domaine, 114 hub et 87
PWA), les builds PWA/hub et 25 scénarios Chrome mobile. Le runtime a ensuite
été reconstruit et redémarré sans navigateur sur
`https://192.168.1.14:8443`.

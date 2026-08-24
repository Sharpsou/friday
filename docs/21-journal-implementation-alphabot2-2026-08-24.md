# Journal d’implémentation — AlphaBot2-Pi du 24 août 2026

Statut : **robot arrêté pour la nuit ; socle de téléopération et caméra livré,
roues neutralisées, dernier réglage de panoramique à confirmer physiquement au
prochain allumage**.

Ce document est le checkpoint factuel de la séance. Il complète le
[document fondateur](19-document-fondateur-agent-physique-friday.md), le
[plan directeur](20-plan-implementation-robot-friday-alphabot2.md) et le
[runbook](runbooks/robot-alphabot2.md). Il ne transforme aucun essai supervisé
en validation d’autonomie.

## 1. État livré dans Friday

- un service Python 3 séparé dans `robot/`, avec contrats bornés, Bearer token,
  watchdog, arrêt au désarmement/expiration/exception et modes `simulated` ou
  `alphabot2` ;
- une passerelle Fastify authentifiée entre la PWA et le Pi, sans outbox,
  rejeu offline ni accès direct du Chat aux sorties physiques ;
- un onglet `Robot` dans la PWA : flux caméra, état, télémétrie, armement,
  arrêt, flèches de locomotion à maintien, flèches de tête, recentrage et
  options de surimpression ;
- un flux CSI réel relayé par le Pi puis par le hub, en `640×360` à 10 images/s ;
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
flux réel transparent lorsque les moteurs restaient en mode simulé ; elle a été
supprimée et un scénario E2E protège désormais ce cas. Le moteur peut donc
rester neutralisé tout en affichant l’image réelle.

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
- runtime Pi configuré en `FRIDAY_ROBOT_MODE=simulated` ;
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

Après consolidation documentaire, `pnpm verify` réussit le 24 août avec 16
tests Python Robot, 21 tests contrats, 15 domaine, 108 hub, 77 web et 25
scénarios E2E Chrome mobile, ainsi que les builds PWA et hub. Cette preuve est
logicielle : elle ne sollicite pas le robot éteint et ne valide pas physiquement
le dernier lissage du servo pan.

Références matérielles :

- [wiki officiel Waveshare AlphaBot2-Pi](https://www.waveshare.com/wiki/AlphaBot2-Pi) ;
- [page produit officielle AlphaBot2-Pi](https://www.waveshare.com/product/robotics/mobile-robots/alphabot2-pi-acce-pack.htm).

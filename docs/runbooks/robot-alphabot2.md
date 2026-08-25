# Runbook — Robot Friday AlphaBot2-Pi

Lire d’abord le
[checkpoint canonique](../22-checkpoint-robot-alphabot2-2026-08-24.md). Le
[journal du 24 août](../21-journal-implementation-alphabot2-2026-08-24.md)
conserve des états historiques qui ne doivent pas être pris pour la
configuration actuelle.

## État livré

Le hub sait fonctionner en mode `disabled` ou `alphabot2`. La production ne
propose plus de mode simulation. Le service Python embarqué possède son propre
watchdog et remet les PWM à zéro à
l'expiration de chaque impulsion, au désarmement, au changement de mode, à une
erreur ou à l'arrêt du processus.

Le Pi courant est un Raspberry Pi 3B sous Raspberry Pi OS Trixie 32 bits,
joignable à `192.168.1.22` en SSH port 22 par la clé dédiée conservée hors Git
sous `D:\FridayData\robot\ssh`. Le raccourci
`infra/windows/Open-FridayRobotSsh.cmd` ouvre cette session. Les services
embarqués sont `friday-camera.service` et `friday-robot.service`.

Le déploiement cible utilise `FRIDAY_ROBOT_MODE=alphabot2` et
`FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES`. Les sorties moteur sont initialisées à
zéro ; le contrôleur garde roues et servos désactivés jusqu’aux switchs de la
PWA. Le flux CSI est relayé depuis
`http://127.0.0.1:8080/stream` en 640×480 à 15 images/s. La capture utilise deux
buffers et `rpicam-vid --flush`; le relais lit au plus 16 Kio avec `read1()` et
vide immédiatement sa sortie. La PWA affiche ce flux en 4:3 avec
`object-fit: contain`, sans recadrage logiciel.

La reconnaissance tourne par défaut sur le PC du hub. Les poids ne sont ni dans
Git ni sur le téléphone : utiliser `D:\FridayData\robot\models`, avec un
`manifest.json` contenant source, licence et SHA-256. Le Pi 3 ne reçoit qu'un
modèle après mesure démontrant une cadence, une température et une alimentation
acceptables. La reconnaissance d'identité reste désactivée tant qu'un protocole
de consentement et de suppression n'a pas été validé.

Le candidat actuel utilise `yolo26s.onnx`, un modèle COCO de 36,5 Mo sous
AGPL-3.0. Le hub vérifie son manifeste et son SHA-256 avant de le charger avec
ONNX Runtime CPU dans un Worker Node séparé. Cette isolation est obligatoire :
une inférence dans le processus principal peut retarder de plus de 350 ms le
renouvellement des impulsions et déclencher le watchdog moteur. Le
prétraitement conserve le ratio dans une entrée RGB 640×640 et remet les boîtes
aux coordonnées de l'image 640×480. En mode
`alphabot2`, le hub lit le flux MJPEG en continu, le redistribue aux clients
vidéo depuis cette capture unique et analyse une image sur deux par défaut. Il
ne faut jamais ouvrir un second `rpicam-vid` pour la vision : la caméra CSI ne
fournit alors plus d'image à la PWA. Le hub jette les images lorsque le détecteur
travaille déjà, sans créer de retard. Les observations restent en mémoire et
persistent jusqu'au résultat suivant, avec expiration après deux secondes. Les
sorties objets et personnes sont validées par schéma et n'ont aucune voie vers
les commandes physiques.

Référence exacte du modèle actif :

- source officielle :
  `https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s.onnx` ;
- taille : 38 291 130 octets ;
- SHA-256 :
  `d26b65c432111eb95798cd2320603d4d75627605dbec6c6b7f98c499a80e7321` ;
- manifeste versionné : `robot/models/yolo26s.manifest.json` ;
- installation active : `D:\FridayData\robot\models\yolo26s.onnx` et
  `D:\FridayData\robot\models\manifest.json`.

Le modèle et `manifest.json` résident dans `D:\FridayData\robot\models`. Ce
mode se désactive avec `FRIDAY_ROBOT_VISION_ENABLED=false`. Les réglages hub
`FRIDAY_ROBOT_VISION_FRAME_STRIDE` (1 à 30, défaut 2),
`FRIDAY_ROBOT_VISION_CONFIDENCE` (0,1 à 0,95, défaut 0,30) et
`FRIDAY_ROBOT_VISION_MANIFEST_PATH` permettent une recette contrôlée sans
modifier le flux caméra du Pi.

Pour vérifier que la vision ne perturbe pas la téléopération, mesurer au moins
50 réponses locales `/api/health` pendant l'inférence. Aucune pointe ne doit
approcher les 350 ms d'une impulsion moteur. Le test A/B du 25 août donnait une
médiane de 141 ms et une pointe de 387 ms avec YOLO dans le processus principal,
contre 9 ms et 150 ms sans vision ; cela a motivé le Worker dédié.
Après isolation, une mesure sur connexion persistante avec la vision active a
donné 2,1 ms de médiane, 3,4 ms p95, 4,3 ms p99 et 71,4 ms maximum, avec zéro
réponse au-dessus de 170 ou 350 ms. Conserver ce benchmark comme gate de
régression : une pointe approchant 350 ms impose de couper la vision et de
chercher une régression avant tout nouvel essai de roues.

Sur un nouveau PC, installer ou revérifier le modèle avec :

```powershell
infra/windows/Install-FridayRobotVisionModel.ps1
```

Le script conserve le modèle déjà présent si son empreinte est correcte ;
sinon il retélécharge l'artefact officiel dans un fichier temporaire, vérifie
l'empreinte attendue puis installe le modèle et le manifeste.

## Recette logicielle sans mouvement

1. Générer un secret aléatoire d'au moins 32 caractères.
2. Pour une recette sans robot, injecter la doublure simulée uniquement dans les
   tests automatisés ; elle n’est pas un mode de lancement.
3. Configurer le hub avec `FRIDAY_ROBOT_MODE=alphabot2`,
   `FRIDAY_ROBOT_URL=http://IP_PRIVEE_DU_SERVICE:8765` et le même
   `FRIDAY_ROBOT_TOKEN`.
4. Vérifier dans les tests injectés l'activation des roues par switch, les
   impulsions, le stop, les mouvements de caméra simulés et les surimpressions.
5. Couper le service pendant une impulsion : le hub doit afficher le robot
   indisponible ; au redémarrage il doit être désarmé.

Les tests d’interface utilisent `SimulatedRobotController` par injection de
dépendance, jamais par `FRIDAY_ROBOT_MODE`.

Le lanceur Windows charge automatiquement, s'il existe,
`D:\FridayData\robot\hub.json`. Ce fichier reste hors Git et contient :

```json
{
  "mode": "alphabot2",
  "url": "http://192.168.1.22:8765",
  "token": "secret-identique-au-service-embarque"
}
```

Un jeton de 32 caractères minimum est obligatoire. Le lanceur refuse un mode
inconnu ou une configuration AlphaBot2 incomplète.

## Porte physique à répéter avant chaque nouvelle classe d’essai

La production est déjà déployée avec
`FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES`. Ce drapeau signifie seulement que le
pilote réel peut démarrer ; il n’autorise pas un essai. Avant toute nouvelle
classe de mouvement :

- photographie et contrôle du câblage, alimentation dédiée stable et masse
  commune vérifiée ;
- arrêt physique accessible, roues levées, personne devant les roues ;
- vérification séparée du sens de chaque moteur à 10 %, puis du stop sur perte
  réseau, fermeture de page et arrêt du processus ;
- mesure de `vcgencmd get_throttled` et température en charge ;
- bornes logicielles pan 700–2300 µs et tilt 900–2100 µs ; la plage pan
  symétrique et sa rampe lente restent à confirmer physiquement.

Ne pas présenter la détection d'objets monoculaire comme un dispositif
anticollision. Les capteurs IR n'offrent qu'un arrêt réflexe à courte portée.
L'autonomie de déplacement demeure interdite sans capteur de distance et essais
documentés.

## Reprise sûre à chaque allumage

1. Garder les roues hors contact, la tête libre et l’interrupteur accessible.
   Dans la PWA, placer d’abord les switchs `Roues` et `Caméra` sur OFF.
2. Attendre le démarrage puis ouvrir le raccourci SSH et exécuter :

   ```bash
   systemctl --no-pager --full status friday-camera friday-robot
   i2cdetect -y 1
   vcgencmd get_throttled
   ```

3. Dans la PWA, confirmer le flux et les capteurs avant toute commande servo.
4. Depuis le centre, reproduire une commande humaine : avancer horizontalement
   par petits écarts de 10 à 15 %, attendre deux à trois secondes entre les
   consignes, rester plusieurs secondes sur la scène observée, puis revenir au
   centre par les mêmes petits écarts. Le pan matériel avance par pas de 10 µs
   toutes les 20 ms et ne libère le PWM qu’une fois chaque cible atteinte. Ne
   tester qu'un côté par séance et ne pas lancer de balayage répétitif.
5. Relever immédiatement `vcgencmd get_throttled`. `0x50005`, un tremblement ou
   un mouvement incohérent impose la coupure des servos et l’arrêt de l’essai.
6. Ne pas envoyer de commande de roue tant que la recette sur cales de la
   séance n’est pas explicitement ouverte. Ne pas modifier le mode ou le drapeau
   matériel pour contourner une erreur.

Après un redémarrage frais du service Pi, vérifier que l’état expose
`actuators.wheelsEnabled=false` et `actuators.cameraServosEnabled=false` au
démarrage. Les interrupteurs de la PWA appellent `/api/robot/actuators`. La
coupure des roues doit stopper et désarmer ; la coupure caméra doit libérer les
deux PWM. Le retour du joystick au centre appelle `/halt`, qui arrête le
mouvement sans désarmer. Le bouton `ARRÊT` coupe les roues et désarme ; `/stop`
reste aussi disponible comme arrêt désarmant à la fermeture de la page.

Le déploiement de cette version a été réalisé après qu’un `404` sur
`/actuators` a révélé l’ancien service. Les 18 tests Python ont réussi sur le Pi,
les deux services sont actifs et une requête maintenant les actionneurs à
`false` a été acceptée. `vcgencmd get_throttled` et l’API indiquaient toutefois
`0x50005` immédiatement après déploiement. Une lecture ultérieure a donné
`0x50000`, soit un événement historique sans sous-tension active à cet instant.
Toute réapparition du bit actif, tout tremblement soutenu ou tout mouvement
incohérent impose l’arrêt de l’essai.

Le canal 0 est le panoramique et le canal 1 l’inclinaison ; tous deux partagent
le PCA9685 à l’adresse I²C `0x40`, 50 Hz. L’axe horizontal présente un défaut
intermittent probable, tandis que le vertical est nettement plus stable. Les
codes de sous-tension observés sont consignés dans
`docs/21-journal-implementation-alphabot2-2026-08-24.md`.

Les commandes caméra ont une validité réseau de 1 800 ms et un délai de réponse
hub de 3 500 ms afin de laisser la rampe matérielle se terminer sans accélérer le
servo. Un refus doit désormais afficher son motif précis dans la PWA. Si le
message générique réapparaît, consulter immédiatement
`journalctl -u friday-robot -n 50 --no-pager` : les exceptions matérielles y
sont journalisées avant l’arrêt de sûreté.

Le hub réhorodate lui-même chaque consigne pan/tilt et chaque impulsion de roues
après les contrôles de session, d’origine et de débit. L’horloge du téléphone
n’est pas une autorité de sécurité. Pour les roues, `expiresAt` laisse 1 800 ms à
la commande pour atteindre le Pi, mais cette fenêtre réseau n’est pas une durée
moteur : le Pi arrête à `now + maxDurationMs`, toujours borné à 100–500 ms. Les
commandes nécessitent toujours roues activées, armement valide, session
propriétaire et mode compatible.

L’armement n’a plus de bouton séparé dans la PWA. Le passage du switch `Roues`
à ON appelle d’abord `/actuators`, force si nécessaire le mode `manual`, puis
`/arm`; l’autorisation de 60 s est renouvelée toutes les 45 s tant que le switch
reste actif. Elle ne commande jamais les moteurs à elle seule. Les boutons
`Manuel` et `Autonome` sont maintenant explicites. `Autonome` reste désactivé
et le hub refuse aussi ce mode. En manuel, `Carto` enregistre une trajectoire
vectorielle approximative sans aucune image ; déplacer la caméra met la session
en pause et sa reprise impose le preset central. `Carte` ouvre la vue tactile,
et `Va là` ne crée qu’un aperçu refusé sans commande moteur. Le switch OFF,
`ARRÊT`, une fermeture de page, un changement de mode ou un redémarrage du Pi
arrêtent toujours le mouvement.

Après un redémarrage du hub, toute session Carto qui enregistrait passe en
pause. Ne jamais interpréter la pose affichée comme une mesure métrique : sans
encodeurs ni IMU, elle est déduite de la direction, de la puissance et du temps
entre impulsions, et dérive. Carto conserve au plus 2 000 points par session et
10 000 par foyer. Les tables ne contiennent aucun champ image, JPEG ou
miniature. Ne pas contourner ces bornes ni brancher le Chat, un LLM ou la
politique d’apprentissage shadow sur `/drive`.

La téléopération expose un curseur de puissance commun aux quatre directions,
borné de 10 à 35 %, initialisé à 20 % et mémorisé dans la PWA. Toute hausse
au-delà de 35 %, ajout d’un coup de couple ou calibration séparée des moteurs
exige une nouvelle recette sur cales avec contrôle immédiat de
`vcgencmd get_throttled`.

Le joystick accepte les diagonales : la PWA envoie `steering` entre `-1` et
`+1` avec `forward` ou `backward`, puis le Pi applique un mélange différentiel
aux deux roues. Tester d’abord à 10 % sur cales : en diagonale avant-droite, la
roue gauche doit tourner plus vite que la droite sans dépasser le plafond de
puissance ; avant-gauche doit produire l’inverse. Une position presque
horizontale commande encore une rotation sur place. Tout sens inversé impose
`ARRÊT`, sans tenter de le compenser dans l’interface.

Sa zone tactile mesure 164×112 px et son déplacement est normalisé sur une
ellipse. Une petite erreur horizontale du doigt produit donc une correction
moins forte que dans l’ancien joystick circulaire de 108 px.

En marche avant/arrière, les 35 premiers pourcents de course horizontale sont
une zone neutre. Au-delà, la direction suit une courbe exponentielle douce. Son
maximum est interpolé selon la puissance : `1,0` à 10 % et `0,55` à 35 %. À
faible puissance, un virage très serré reste donc accessible ; à puissance
élevée, le logiciel limite progressivement l’écart entre les roues. Une
consigne presque horizontale (moins de 22 % de composante verticale) reste une
rotation sur place complète et permet le demi-tour à l’arrêt.

Le filtre de variation de `0,05` ne s’applique jamais au retour à la ligne
droite : tout passage d’un angle non nul à `steering=0` doit être transmis
immédiatement. La recette tactile doit commencer par un petit virage en marche,
revenir sur l’axe vertical sans relâcher, puis confirmer que les deux roues
reprennent la même consigne.

Le bouton central de la caméra ne vise plus `tilt=0` : son neutre utilisateur
est `pan=0`, `tilt=+0,20`, donc 20 points vers le bas selon la convention de la
PWA. Les boutons haut/bas conservent leurs pas de `0,05` autour de ce neutre.

Le curseur `Trim direction`, mémorisé dans la PWA, couvre `G 10` à `D 10` par
pas de 1. Commencer à zéro et corriger par pas de 1 sur une ligne droite à
faible puissance : si le robot dérive à droite, essayer progressivement `G` ;
s’il dérive à gauche, essayer `D`. Le trim s’applique uniquement à la marche
avant : la marche arrière et les rotations sur place conservent la consigne
brute du joystick. Ne pas utiliser le trim pour masquer une roue grippée, un
pneu différent ou une sous-tension active.

## Tests de capacités cognitives

Une reconnaissance temps réel légère objets/personnes est maintenant active.
Sa qualité sur un corpus varié reste candidate et elle ne vaut ni identité, ni autonomie. Pour la
recetter sans mouvement : maintenir les roues et l'armement sur OFF, vérifier
qu'une scène produit des boîtes expirables, masquer puis représenter un objet,
et relever les faux positifs ainsi que le temps `Caméra / vision`. Ne pas
actionner les servos lorsque `underVoltageActive=true` ou que `get_throttled`
vaut `0x50005`.

Dans la PWA, seule la case `Reco` pilote l'affichage des boîtes. La décocher ne
coupe pas le moteur d'inférence ; elle masque seulement la dernière observation.
Avec le réglage par défaut `FRAME_STRIDE=2`, la vision traite une image sur deux
et conserve la dernière surimpression jusqu'au résultat suivant, au plus deux
secondes. `Carto` peut mémoriser la géométrie et les objets confirmés pendant
une téléopération ; aucune frame n’est persistée. `Autonome` et l’exécution de
mission restent désactivés.

- Objets/personnes : jeux d'images consentis, précision/rappel par classe,
  faux positifs, latence p50/p95, faible lumière et mouvement.
- Repères : AprilTags imprimés, distance/angle, perte et réacquisition.
- Identité : uniquement opt-in, seuil calibré avec une classe `inconnu`, aucune
  authentification, suppression immédiate testée.
- Suivi : vitesse bornée, zone morte, perte de cible => stop.
- Évitement : maquette au sol d'abord ; obstacle perdu ou télémétrie périmée =>
  stop. Aucun comportement autonome avec la seule détection d'objets.

Les étapes et critères complets sont dans
`docs/20-plan-implementation-robot-friday-alphabot2.md`.

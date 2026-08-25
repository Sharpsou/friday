# Runbook — Robot Friday AlphaBot2-Pi

Lire d’abord
[l’état canonique App + Robot](../27-etat-canonique-app-robot-2026-08-25.md),
puis, pour les détails de conception, le
[checkpoint autonomie](../24-checkpoint-autonomie-alphabot2-2026-08-25.md) et le
[checkpoint matériel](../22-checkpoint-robot-alphabot2-2026-08-24.md). Le
[journal du 24 août](../21-journal-implementation-alphabot2-2026-08-24.md)
conserve des états historiques qui ne doivent pas être pris pour la
configuration actuelle.

> Les mesures historiques restent utiles au diagnostic. En cas de contradiction
> sur une capacité ou un blocage, le document 27 et le code testé prévalent.

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

Lors d’un déploiement Python, synchroniser le paquet `friday_robot` complet,
pas seulement les fichiers modifiés visibles dans le diff. Vérifier notamment
le module réellement importé dans `.venv/lib/python*/site-packages` : une copie
source correcte sous `/home/pi/friday-robot` ne garantit pas que le venv la
charge. Après redémarrage, confirmer que `MODES` contient `autonomous` et que
les capacités exposent `map_observer` et `autonomous_exploration`.

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
anticollision. Les capteurs IR n'offrent qu'une réaction à courte portée.
L'autonomie logicielle peut être lancée explicitement à faible vitesse, mais
elle n'est pas certifiée comme navigation domestique fiable tant que les essais
physiques documentés ne sont pas passés.

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
5. Relever `vcgencmd get_throttled`. Une sous-tension active pendant un appel de
   courant moteur/servo est une alerte informative, pas un blocage automatique.
   Un tremblement soutenu ou un mouvement incohérent justifie en revanche la
   coupure opérateur et le diagnostic mécanique/alimentation.
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
Le bit actif est désormais consultatif et géré par l’utilisateur ; un
tremblement soutenu ou un mouvement incohérent reste un motif concret d’arrêt.

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
`Manuel` et `Autonome` sont maintenant explicites. Depuis le checkpoint 24,
`Autonome` démarre l’exploration continue et Carto automatiquement. En manuel,
`Carto` enregistre une trajectoire vectorielle approximative et quelques
images-clés bornées ; déplacer la caméra conserve l’enregistrement, mais les roues attendent le
retour au preset central. `Carte` ouvre la vue tactile et une destination
`Va là` admissible démarre ou réoriente l’autonomie. Le switch OFF et `ARRÊT`
arrêtent toujours le mouvement ; la boucle autonome continue en arrière-plan
si la PWA se ferme, mais pas après un redémarrage du hub.

`Manuel` sans Carto n’est pas un mode d’enregistrement. La reconnaissance et
les boîtes restent visibles, mais le hub n’ajoute alors ni objet, présence,
cellule, point de vue, trajectoire ou image-clé. La ligne `Mémoire en pause`
confirme cet état. Le dernier état technique de pose peut être remplacé pour le
joystick et une éventuelle séquence `Récup`, sans créer d’historique de carte.
Quand Carto enregistre, les impulsions utiles à la géométrie restent prises en
compte ; un objet ou point de vue identique n’est persisté qu’au plus toutes les
cinq secondes. Un changement de preset ou de cellule peut être retenu
immédiatement, et la relocalisation continue d’analyser les images en mémoire
sans transformer chaque frame en donnée durable.

La section `Objets mémorisés` affiche d’abord les objets confirmés, regroupés
par pièce. Les indices candidats sont masqués jusqu’au bouton `Voir les
indices`. Utiliser le filtre pour chercher par nom, classe ou pièce et
`Modifier` pour corriger un libellé ; le renommage n’altère ni la classe YOLO
ni les observations sources.

Pendant une exploration, `Récup` signifie explicitement « la politique est
coincée ». Le hub arrête la boucle, passe en manuel et commence une
démonstration. Dégager le robot avec le joystick, puis appuyer sur `Rendre la
main`. La séquence n’est apprise qu’après vérification du résultat : mouvement
mesurable, localisation non dégradée, aucun nouvel obstacle et commande
compatible avec le masque capteurs. Un passage direct par `Manuel` observe
aussi la manœuvre, mais comme signal faible : il exige en plus qu’un obstacle
soit dégagé ou que Carto mesure un progrès. Cela évite d’apprendre comme
« meilleure solution » un passage manuel motivé par autre chose qu’un blocage.

La collecte expire après cinq minutes ou cent commandes et compresse au plus
douze étapes successives. Un retour immédiat sans mouvement, une localisation
dégradée ou un recul que les capteurs avant ne rendent pas admissible est
journalisé mais non injecté dans Dyna-Q. `ARRÊT` et le switch `Roues` restent
des commandes de sécurité, jamais des démonstrations. Le verdict apparaît dans
le journal Friday ; le détail persistant se trouve dans
`robot_human_recovery_demonstrations` (migration 25).

Après un redémarrage du hub, toute session Carto qui enregistrait passe en
pause. Ne jamais interpréter la pose affichée comme une mesure métrique : sans
encodeurs ni IMU, elle est déduite de la direction, de la puissance et du temps
entre impulsions, et dérive. Carto conserve au plus 2 000 points par session et
10 000 par foyer. La migration 23 autorise uniquement des images-clés JPEG
pertinentes : au plus 48, 3 par objet, 256 Kio chacune et 16 Mio au total ; une
frame où une personne est détectée est exclue. Ne pas contourner ces bornes ni
brancher le Chat, un LLM ou la politique d’apprentissage sur une commande
d’actionneur.

La migration 24 ajoute des signatures ORB sans JPEG, bornées à 600 entrées et
12 Mio. Elles sont calculées sur le PC par un worker OpenCV isolé. Après une
première installation ou une recréation de l’environnement, lancer :

```powershell
infra\windows\Setup-FridayRobotLocalization.ps1
```

Le lanceur de recette sélectionne ensuite automatiquement l’interpréteur sous
`D:\FridayData\robot\localization-venv`. Deux changements visuels cohérents
sans nouvelle commande de roues déclenchent une recherche de position. Pendant
les cinq premières secondes, les roues attendent mais les actions caméra sûres
restent disponibles ; ensuite l’autonomie peut reprendre à 10 % si la pose
reste perdue. Le bouton `Je l’ai déplacé` permet de déclencher immédiatement la
même recherche. Une relocalisation manuelle doit apparaître sur la carte comme
une rupture de segment, jamais comme une diagonale parcourue.

Pour une recette physique, poser d’abord le robot face à un lieu déjà observé,
attendre deux frames stables, le soulever sans commande de roues, puis le
reposer face à un autre lieu connu. Contrôler `Recherche de position`, la
nouvelle pose, la rupture de segment et l’absence de nouvelles images-clés
pendant le transport. Le test n’autorise aucune rotation hors des presets
caméra existants.

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
Sa qualité sur un corpus varié reste candidate et elle ne vaut ni identité, ni
preuve d’évitement fiable. Pour la
recetter sans mouvement : maintenir les roues et l'armement sur OFF, vérifier
qu'une scène produit des boîtes expirables, masquer puis représenter un objet,
et relever les faux positifs ainsi que le temps `Caméra / vision`. Une
sous-tension active est affichée comme diagnostic ; elle ne désactive pas les
servos. L’utilisateur peut interrompre l’essai si l’alimentation faiblit ou si
le comportement mécanique devient anormal.

Dans la PWA, seule la case `Reco` pilote l'affichage des boîtes. La décocher ne
coupe pas le moteur d'inférence ; elle masque seulement la dernière observation.
Avec le réglage par défaut `FRAME_STRIDE=2`, la vision traite une image sur deux
et conserve la dernière surimpression jusqu'au résultat suivant, au plus deux
secondes. `Carto` peut mémoriser la géométrie et les objets confirmés pendant
une téléopération. Seules les images-clés répondant aux critères de la migration
23 sont persistées. `Autonome` et l’exécution de mission suivent le checkpoint 24.

- Objets/personnes : jeux d'images consentis, précision/rappel par classe,
  faux positifs, latence p50/p95, faible lumière et mouvement.
- Repères : AprilTags imprimés, distance/angle, perte et réacquisition.
- Identité : uniquement opt-in, seuil calibré avec une classe `inconnu`, aucune
  authentification, suppression immédiate testée.
- Suivi : vitesse bornée, zone morte, perte de cible => stop.
- Évitement : maquette au sol d'abord ; obstacle perdu ou télémétrie périmée =>
  stop. La seule détection d'objets ne constitue pas une certification
  anticollision de l'autonomie existante.

Les étapes et critères complets sont dans
`docs/20-plan-implementation-robot-friday-alphabot2.md`.

# Friday Robot — AlphaBot2-Pi

Service Python minimal exécuté sur le Raspberry Pi. Il est volontairement séparé
du hub Friday : aucune donnée Maison, aucun secret utilisateur et aucun modèle de
langage ne sont copiés sur le robot.

## Démarrage sûr

```bash
export FRIDAY_ROBOT_TOKEN='au-moins-32-caracteres-aleatoires'
export FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES
python3 -m friday_robot --mode alphabot2
```

Le service de production n’accepte que le mode `alphabot2`, qui exige
`FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES`. Cette barrière ne remplace pas la reprise
sûre et les essais roues levées décrits dans
`docs/runbooks/robot-alphabot2.md`.

Les roues et les servos caméra démarrent toujours désactivés. L’API
`POST /actuators` reçoit explicitement les deux booléens `wheelsEnabled` et
`cameraServosEnabled`. Le switch Roues est l’autorisation persistante de
locomotion : le couper stoppe immédiatement les moteurs. Le switch Caméra
autorise les mouvements servo. `POST /halt` et `POST /stop` arrêtent l’impulsion
courante sans modifier les switches. L’ancien `POST /arm` reste un no-op de
compatibilité ; chaque commande moteur conserve son expiration et le watchdog
local coupe les PWM sans renouvellement.

Variables principales :

- `FRIDAY_ROBOT_BIND` (défaut `127.0.0.1`) et `FRIDAY_ROBOT_PORT` (défaut `8765`) ;
- `FRIDAY_ROBOT_TOKEN`, secret Bearer de 32 caractères minimum ;
- `FRIDAY_ROBOT_CAMERA_URL`, flux HTTP MJPEG local optionnel ;
- `FRIDAY_CAMERA_FPS` (15 sur le prototype), cadence déclarée par la télémétrie ;
- `FRIDAY_ROBOT_READ_ONLY_SENSORS=YES`, lecture IR/TLC1543 réelle même en mode
  de test isolé ;
- `FRIDAY_ROBOT_REAL_CAMERA_SERVOS=YES`, compatibilité de configuration du
  prototype antérieur ; le mode AlphaBot2 utilise toujours le PCA9685 réel ;
- `FRIDAY_ROBOT_LEFT_INVERTED` et `FRIDAY_ROBOT_RIGHT_INVERTED` (`0` ou `1`) ;
- `FRIDAY_ROBOT_MODEL_DIR`, registre local de modèles, jamais téléchargé au runtime.

Sur le matériel actuel, le canal PCA9685 0 commande le pan et le canal 1 le
tilt, à l’adresse I²C `0x40` et 50 Hz. Le pan utilise la plage symétrique
`700–1500–2300 µs` et rejoint sa cible par pas de 10 µs toutes les 20 ms avant
une unique libération du PWM. Le tilt utilise `900–1500–2100 µs`. Le servo pan
présente un tremblement intermittent : ne pas lancer de balayage automatique et
suivre `docs/runbooks/robot-alphabot2.md`.

La classe simulée subsiste uniquement comme doublure injectée par les tests ;
elle n’est plus sélectionnable par le service ni par le lanceur Friday.

Le service CSI utilise MJPEG 640×480, 15 images/s, deux buffers caméra et
`rpicam-vid --flush`. Le relais HTTP privilégie `read1()` par blocs de 16 Kio
afin de transmettre les octets disponibles sans attendre le remplissage d’un
tampon de 64 Kio.

Le Pi accepte les modes `manual` et `autonomous`, mais la reconnaissance des
lieux, le graphe visuel et le Q-learning restent sur le hub PC. Le Pi ne reçoit
que des commandes bornées et garde l’autorité du watchdog. L’état global est documenté dans
`docs/27-etat-canonique-app-robot-2026-08-25.md`.

Tests sans GPIO : `python -m unittest discover -s robot/tests -p "test_*.py"`.

## Veille réseau

Le point d’entrée `friday-wake-agent` (port 8764 par défaut) reste actif pendant
que `friday-awake.target` arrête la caméra et le contrôleur GPIO. Son jeton
`FRIDAY_WAKE_TOKEN` doit être distinct du jeton robot et comporter au moins 32
caractères. Voir `deploy/install-network-standby.sh` et le runbook AlphaBot2.

Le déploiement du 27 août 2026 a laissé `friday-wake`, `friday-camera`,
`friday-robot` et `friday-awake.target` actifs avec l’état désiré `awake`. La
première recette physique veille/réveil reste à consigner dans le runbook ; ne
pas l’inférer des tests unitaires.

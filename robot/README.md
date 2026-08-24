# Friday Robot — AlphaBot2-Pi

Service Python minimal exécuté sur le Raspberry Pi. Il est volontairement séparé
du hub Friday : aucune donnée Maison, aucun secret utilisateur et aucun modèle de
langage ne sont copiés sur le robot.

## Démarrage sûr

```bash
export FRIDAY_ROBOT_TOKEN='au-moins-32-caracteres-aleatoires'
python3 -m friday_robot --mode simulated
```

Le mode `alphabot2` exige en plus `FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES`. Cette
barrière ne remplace pas les essais roues levées décrits dans
`docs/20-plan-implementation-robot-friday-alphabot2.md`.

Variables principales :

- `FRIDAY_ROBOT_BIND` (défaut `127.0.0.1`) et `FRIDAY_ROBOT_PORT` (défaut `8765`) ;
- `FRIDAY_ROBOT_TOKEN`, secret Bearer de 32 caractères minimum ;
- `FRIDAY_ROBOT_CAMERA_URL`, flux HTTP MJPEG local optionnel ;
- `FRIDAY_ROBOT_READ_ONLY_SENSORS=YES`, lecture IR/TLC1543 réelle même en mode
  simulé, sans configurer les moteurs ;
- `FRIDAY_ROBOT_REAL_CAMERA_SERVOS=YES`, tête PCA9685 réelle même en mode
  simulé ;
- `FRIDAY_ROBOT_LEFT_INVERTED` et `FRIDAY_ROBOT_RIGHT_INVERTED` (`0` ou `1`) ;
- `FRIDAY_ROBOT_MODEL_DIR`, registre local de modèles, jamais téléchargé au runtime.

Sur le matériel actuel, le canal PCA9685 0 commande le pan et le canal 1 le
tilt, à l’adresse I²C `0x40` et 50 Hz. Le pan utilise la plage symétrique
`700–1500–2300 µs` et rejoint sa cible par pas de 10 µs toutes les 20 ms avant
une unique libération du PWM. Le tilt utilise `900–1500–2100 µs`. Le servo pan
présente un tremblement intermittent : ne pas lancer de balayage automatique et
suivre `docs/runbooks/robot-alphabot2.md`.

Tests sans GPIO : `python -m unittest discover -s robot/tests -p "test_*.py"`.

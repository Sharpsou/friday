# Runbook — Robot Friday AlphaBot2-Pi

## État livré

Le hub et la PWA savent fonctionner en mode `disabled`, `simulated` ou
`alphabot2`. Le mode simulé est la recette logicielle de référence. Le service
Python embarqué possède son propre watchdog et remet les PWM à zéro à
l'expiration de chaque impulsion, au désarmement, au changement de mode, à une
erreur ou à l'arrêt du processus.

Le Pi courant est un Raspberry Pi 3B sous Raspberry Pi OS Trixie 32 bits,
joignable à `192.168.1.22` en SSH port 22 par la clé dédiée conservée hors Git
sous `D:\FridayData\robot\ssh`. Le raccourci
`infra/windows/Open-FridayRobotSsh.cmd` ouvre cette session. Les services
embarqués sont `friday-camera.service` et `friday-robot.service`.

Le déploiement de fin de séance garde `FRIDAY_ROBOT_MODE=simulated` : aucune
broche moteur n’est configurée en sortie. Les drapeaux
`FRIDAY_ROBOT_READ_ONLY_SENSORS=YES` et
`FRIDAY_ROBOT_REAL_CAMERA_SERVOS=YES` autorisent séparément les capteurs passifs
et la tête réelle. Le flux CSI est relayé depuis
`http://127.0.0.1:8080/stream` en 640×360 à 10 images/s.

La reconnaissance tourne par défaut sur le PC du hub. Les poids ne sont ni dans
Git ni sur le téléphone : utiliser `D:\FridayData\robot\models`, avec un
`manifest.json` contenant source, licence et SHA-256. Le Pi 3 ne reçoit qu'un
modèle après mesure démontrant une cadence, une température et une alimentation
acceptables. La reconnaissance d'identité reste désactivée tant qu'un protocole
de consentement et de suppression n'a pas été validé.

## Recette logicielle sans mouvement

1. Générer un secret aléatoire d'au moins 32 caractères.
2. Lancer le service Python en `--mode simulated`.
3. Configurer le hub avec `FRIDAY_ROBOT_MODE=alphabot2`,
   `FRIDAY_ROBOT_URL=http://IP_PRIVEE_DU_SERVICE:8765` et le même
   `FRIDAY_ROBOT_TOKEN`.
4. Vérifier l'onglet Robot, l'armement, les impulsions, le stop, les mouvements
   de caméra simulés et les surimpressions.
5. Couper le service pendant une impulsion : le hub doit afficher le robot
   indisponible ; au redémarrage il doit être désarmé.

Le mode hub `FRIDAY_ROBOT_MODE=simulated` ne requiert aucun service Python et
sert aux tests d'interface rapides.

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

## Porte physique obligatoire

Avant de remplacer `FRIDAY_ROBOT_HARDWARE_CONFIRMED=NO` par `YES` :

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

## Reprise après extinction du 24 août

1. Garder les roues hors contact ou le mode moteur simulé, la tête libre et
   l’interrupteur accessible.
2. Attendre le démarrage puis ouvrir le raccourci SSH et exécuter :

   ```bash
   systemctl --no-pager --full status friday-camera friday-robot
   i2cdetect -y 1
   vcgencmd get_throttled
   ```

3. Dans la PWA, confirmer le flux et les capteurs avant toute commande servo.
4. Depuis le centre, faire un seul grand pas horizontal puis recentrer. Le pan
   doit avancer par pas de 10 µs toutes les 20 ms et ne libérer le PWM qu’une
   fois arrivé. Ne pas lancer de balayage répétitif.
5. Relever immédiatement `vcgencmd get_throttled`. `0x50005`, un tremblement ou
   un mouvement incohérent impose la coupure des servos et l’arrêt de l’essai.
6. Ne pas activer `--mode alphabot2` ni
   `FRIDAY_ROBOT_HARDWARE_CONFIRMED=YES` avant une recette roues sur cales
   distincte.

Le canal 0 est le panoramique et le canal 1 l’inclinaison ; tous deux partagent
le PCA9685 à l’adresse I²C `0x40`, 50 Hz. L’axe horizontal présente un défaut
intermittent probable, tandis que le vertical est nettement plus stable. Les
codes de sous-tension observés sont consignés dans
`docs/21-journal-implementation-alphabot2-2026-08-24.md`.

## Tests de capacités cognitives

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

# Runbook — Robot Friday AlphaBot2-Pi

Lire d’abord [l’état canonique](../27-etat-canonique-app-robot-2026-08-25.md)
et [la décision d’autonomie visuelle](../30-decision-autonomie-topologique-visuelle.md).
Les checkpoints 22–29 décrivent l’ancien prototype et ne pilotent plus le
runtime.

## État et sécurité

Le Pi réel utilise `friday-camera.service` et `friday-robot.service`. Il démarre
avec les deux switches OFF. Le switch Roues est l’autorisation persistante de
locomotion. Son watchdog arrête les PWM à l’expiration d’une commande, au
passage Roues OFF, au changement de mode, à une erreur ou à l’arrêt du processus.

Avant tout essai physique :

1. utilisateur présent, zone dégagée et arrêt accessible ;
2. roues levées pour une nouvelle classe de commande ;
3. alimentation et masse vérifiées ;
4. flux, IR et télémétrie observés roues OFF ;
5. sens moteur vérifié à 10 % ;
6. arrêt sur perte réseau/processus vérifié.

La caméra monoculaire et les deux IR ne constituent pas un système
anticollision certifié. Une recette logicielle n’autorise jamais un mouvement.

## Configuration

La configuration hors Git est `D:\FridayData\robot\hub.json` :

```json
{
  "mode": "alphabot2",
  "url": "http://192.168.1.22:8765",
  "token": "secret-identique-au-service-embarque"
}
```

Le modèle YOLO et son manifeste résident dans
`D:\FridayData\robot\models`. Installer/revérifier avec :

```powershell
infra/windows/Install-FridayRobotVisionModel.ps1
infra/windows/Setup-FridayRobotLocalization.ps1
```

Le second script conserve pour l’instant son nom historique mais fournit le
runtime OpenCV de **reconnaissance de lieux**. Le lanceur configure
`FRIDAY_ROBOT_PLACE_RECOGNITION_PYTHON` et
`FRIDAY_ROBOT_PLACE_RECOGNITION_WORKER_PATH`.

Après un déploiement Pi, vérifier que les capacités exposent
`visual_topology` et `topological_autonomy`, puis que roues et servos valent
`false`.

Le service charge le paquet installé dans `.venv`, pas directement le fichier
source copié. Après synchronisation de `/home/pi/friday-robot`, réinstaller avec
`python -m pip install --no-deps --no-build-isolation --force-reinstall .`,
exécuter les tests Python, puis redémarrer `friday-robot`. Une simple copie
de `hardware.py` laisse sinon l’ancien contrat actif.

## Trafic caméra et purge

Dans `Réglages > Robot`, le propriétaire choisit le trafic caméra :

- `Normal` : 640 × 480, 15 images/s, qualité JPEG 70 ;
- `Réduit` : même résolution, 7 images/s, qualité JPEG 55, soit environ 60 %
  de trafic en moins selon la scène.

Le profil agit sur `rpicam-vid`, donc sur le lien Wi-Fi Pi → PC, pas seulement
sur l’affichage du téléphone. Un changement arrête le mouvement courant sans
modifier les switches, puis le Hub reconnecte automatiquement son flux. Le
profil revient à `Normal` au redémarrage du Hub.

La purge de mémoire est réservée au propriétaire et exige une confirmation.
`Dernière heure` supprime les lieux **créés** depuis moins d’une heure, ainsi
que leurs vues, objets, transitions et apprentissages liés ; un lieu ancien
simplement revu récemment reste conservé. `Tout effacer` vide le graphe et
tous les scores/récupérations autonomes. Les deux opérations arrêtent d’abord
le robot. Ne jamais déclencher une purge réelle pour une simple recette.

## Observation sans mouvement

1. Ouvrir la PWA avec roues OFF.
2. Vérifier vidéo, bouton `Reco affichée/masquée`, boîtes expirables et
   télémétrie.
3. Présenter puis masquer un objet : aucune commande moteur ne doit partir.
4. Ouvrir `Repères` : seules les scènes stables sont présentes ; une frame avec
   personne n’a pas de miniature.
5. Vérifier `/api/health` et l’intégrité SQLite.

YOLO est isolé du processus principal. Une régression de latence approchant
300 ms interdit un essai moteur tant qu’elle n’est pas comprise.

## Manuel

Le switch Roues appelle `/actuators` et suffit à autoriser la locomotion. Il n’y
a plus de bail d’armement ni de renouvellement périodique. Le joystick et
l’autonomie renouvellent seulement des commandes expirables ; leur interruption
arrête les PWM via le watchdog. Le retour au centre appelle `/halt`. Le switch
Roues est la coupure persistante visible dans l’interface ; le gros bouton rouge
redondant n’est plus affiché. L’ancien `/arm` reste un no-op transitoire pour les
PWA encore en cache.

Une manette exposée par la Gamepad API avec le mapping navigateur `standard`
peut piloter le mode Manuel. Le stick gauche réutilise exactement la puissance,
le trim, la zone morte et la courbe du joystick tactile. Le stick droit produit
un seul pas caméra par geste : pan `±0,5`, tilt `±0,08`, puis exige un retour
près du centre avant le geste suivant. Les cibles restent bornées à `[-1,1]`.
La caméra ne bouge pas pendant le roulage et une commande servo reste seule en
vol jusqu’à sa réponse.

La manette doit passer au neutre après connexion, retour sur la page, sortie du
mode Autonome ou réactivation des roues. Le tactile prend la priorité et exige
ensuite un nouveau passage de la manette au neutre. Déconnexion ou page masquée
arrête la locomotion. Les sticks sont sans effet en Autonome : ils ne changent
pas de mode et ne déclenchent pas `Récup`. Une manette non standard est seulement
signalée comme incompatible ; cette première version n’a pas de remappage.

`Reco affichée/masquée` est un réglage d’affichage partagé et persistant par
foyer. Le propriétaire peut le modifier ; toutes les PWA le relisent avec leur
polling Robot et convergent normalement en moins d’une seconde. Le masquer ne
coupe jamais YOLO, la reconnaissance de lieux, les objets mémorisés ou la
cartographie : seules les boîtes superposées au flux disparaissent.

La puissance reste 10–35 % et locale au contrôleur. Le tactile et la manette
l'utilisent immédiatement. Au démarrage d'Autonome, la PWA transmet la valeur
entière au Hub ; si la glissière change pendant un run `exploring` ou
`navigating`, elle transmet la dernière valeur après 200 ms et le renouvellement
moteur suivant l'applique sans redémarrer l'autonomie. Cette puissance pilote
aussi les pivots de panorama, les recherches sans localisation et les trajets
de validation ; les commandes `Récup` conservent leur forme apprise mais sont
plafonnées par la valeur courante. Le trim est une
calibration globale persistée par le Hub : toute PWA le relit, puis le tactile,
la manette et l’autonomie appliquent la même valeur. Il n’agit qu’en marche
avant. La glissière est optimiste et sérialise sa sauvegarde après 250 ms pour
ne pas saturer le Hub. À la première ouverture après migration 29, un ancien
trim local valide initialise le Hub seulement si aucune calibration globale
n’existe encore ; il est ensuite supprimé localement. Toute hausse de plafond
ou nouvelle calibration exige une recette sur cales.

Sous le trim, `Impulsion 360°` règle de 120 à 1 000 ms, par pas de 20 ms, la
durée de chaque pivot du panorama corporel. La valeur globale initiale est
220 ms. Elle est partagée par le Hub et appliquée dès l'impulsion suivante.
La puissance du pivot suit séparément la glissière `Puissance`, y compris
pendant une impulsion longue renouvelée ; les 700 ms de stabilisation ne
changent pas. Une
API dédiée la sépare du trim : une ancienne PWA conserve donc la valeur
panorama courante et continue de relire son ancien contrat trim strict. Au-delà
de 500 ms, le Hub renouvelle la commande après 200 ms, donc avant l’expiration
du watchdog matériel de 500 ms : le garde-fou du Pi n’est pas élargi.

Chaque image stable en Manuel enrichit le même graphe que l’autonomie. Il n’y
a plus de bouton Carto, de trajectoire `x/y` ou de relocalisation séparée.

Dans `Repères`, le propriétaire peut renommer un lieu visuel. Le libellé sert à
l’affichage et à `Va là` sans modifier l’UUID, les vues, objets, transitions ou
apprentissages. Un repère étant une scène plutôt qu’une pièce métrique, préférer
`Salon — canapé` et `Salon — bibliothèque` si plusieurs scènes distinctes
appartiennent à la même pièce. Les doublons de libellé sont autorisés mais à
éviter pour rester lisible.

Si deux repères montrent réellement la même scène, `Même lieu que…` conserve le
repère affiché après confirmation. Les vues et objets sont regroupés, mais les
passages du repère absorbé sont oubliés : leurs secteurs panoramiques ne sont
pas redirigés sans preuve et devront être reparcourus. Les habitudes globales,
indépendantes des UUID, restent en place.

`Supprimer` sur un repère oublie ses vues, objets, passages et apprentissages
après arrêt du robot et confirmation. Supprimer seulement un objet n'arrête pas
le robot : l'entrée disparaît immédiatement, mais pourra être recréée lors
d'une future reconnaissance. Ne jamais fusionner ou supprimer des données
réelles pour une simple recette technique.

Le compteur d’observation d’un objet compte des **rencontres**, pas des frames :
la première détection vaut 1, une visibilité continue ne l’incrémente plus, et
une nouvelle rencontre exige soit un retour dans le lieu, soit une absence de
détection d’au moins 30 s. La présence continue ne rafraîchit SQLite qu’une fois
toutes les 30 s. Les anciens compteurs déjà acquis sont conservés.

## Autonome

`Autonome` exige caméra, roues activées et propriétaire authentifié. Le choix
de direction est revu à 4 Hz, mais chaque intention de locomotion devient une
impulsion bornée plutôt qu'un roulage continu. À 20 %, une avance normale dure
320 ms et les autres manœuvres 220 ms. La durée est réduite quand la puissance
augmente et allongée quand elle baisse, dans les bornes 180–500 ms pour
`advance_normal` et 140–400 ms pour les autres intentions. La commande utilise
toujours la puissance utilisateur courante (10–35 %) et reste renouvelée à
10 Hz sous watchdog 300 ms pendant cette seule impulsion.

À la fin de chaque impulsion, le Hub envoie un arrêt, attend 700 ms de repos
mécanique, puis exige trois observations consécutives exploitables, classées
stables et immobiles. Une image inutilisable, une rotation résiduelle ou une
nouvelle translation remet ce compteur à zéro. La politique SARSA ne choisit
donc jamais l'intention suivante sur une image encore floue. Le renouvellement
cesse aussi immédiatement sur trame périmée, IR bloqué, pause d’observation ou
arrêt utilisateur.

La caméra autonome reste centrée à `pan=0`, `tilt=0,2` pendant un panorama. Le
châssis pivote par impulsions réglables de 120 à 1 000 ms à la puissance
utilisateur courante. Après chaque
impulsion : arrêt, 700 ms de repos et trois frames classées immobiles. La
fermeture du 360° exige au moins six secteurs et soit une forte reconnaissance
ORB/RANSAC, soit un pHash très proche de la vue initiale. Une correspondance
ORB ou pHash plus souple doit être corroborée par au moins trois occurrences
d’un objet détecté au début du tour. Les objets seuls ne ferment jamais la
boucle. Il n’existe plus de limite arbitraire de
trente secondes ou seize impulsions : une image instable met l’acquisition en
attente pendant 2 s au maximum. Si elle reste inexploitable, le robot effectue
l’impulsion suivante sans mémoriser cette vue ; cela lui permet de franchir un
mur uniforme et de chercher le retour vers la vue initiale. Seules douze
signatures distinctes sont gardées. Roues désactivées, deux IR bloqués ou arrêt
utilisateur interrompent toujours le panorama et le laissent `incomplet`.

Le Worker OpenCV calcule aussi un flot optique parcimonieux. Un lieu nouveau
exige six images exploitables sur 1,5 s et une preuve de translation, sauf la
première ancre. Rotation caméra/châssis et déplacement physique à la main ne
créent aucun passage.

Si `currentPlaceId` est nul alors que le graphe contient déjà des repères,
l’autonomie attend 1,2 s, effectue jusqu’à huit pivots avec la durée
`Impulsion 360°`, 700 ms de repos et trois images stables, puis tente 300 ms en
avant à la puissance utilisateur
si les deux IR sont libres. Elle attend ensuite 2,5 s pour relocaliser ou créer
une ancre sur preuve de flot. Cette recherche ne crée aucune transition depuis
un lieu inconnu. Si les deux IR sont bloqués, elle s’arrête au lieu de traduire.

La politique `topological-habits-v1` utilise SARSA(λ) sur IR, mouvement,
confiance, gain d'information, ports et résultat précédent, jamais sur l'UUID
du lieu. Elle apprend avancer, pivoter, inspecter, changer de port, revenir ou
appliquer `Récup`. Les switches, IR, watchdog, stabilité, confirmation des
lieux/passages et impulsions panoramiques restent déterministes.

La marche arrière n’entre dans les choix que si le lieu courant possède une
arrivée visuelle confirmée ; elle ne remplace pas la surveillance humaine,
l’AlphaBot2 n’ayant pas de capteur arrière.

`Va là` n’est proposé que sur un repère confirmé relié par des transitions
confirmées. `Tester ce trajet` exige A→P1→B ou A→P1→P2→B avec panoramas complets
et passages candidats ; il roule à la puissance utilisateur, s'arrête à chaque ancre et confirme
chaque passage séparément. Le retour présumé doit aussi être parcouru. Le hub ne
reprend jamais une mission après redémarrage.

`Récup` :

1. le robot s’arrête et passe en Manuel ;
2. effectuer une manœuvre courte ;
3. appuyer sur `Rendre la main` ;
4. vérifier le message de verdict ;
5. lors d’une situation similaire, contrôler que la recette est revalidée
   commande par commande, reste plafonnée à la fois par la puissance courante
   et par 20 %, et conserve la limite de 140 ms.

Un retour sans commande, sans dégagement des deux IR et sans changement de lieu
n’est pas appris.

## Recette physique encore ouverte

À réaliser avec l’utilisateur :

- fluidité à 15 %, puis 20 %, et arrêt sur trame artificiellement périmée ;
- alternance impulsion/arrêt : 700 ms de repos puis trois images immobiles avant
  la décision suivante, notamment à 35 % ;
- fermeture panoramique stable, d'abord roues levées puis au sol ;
- création/confirmation de repères dans deux pièces ;
- cohérence de séquence et refus d’une scène ambiguë ;
- objet visible puis hors champ, toujours présent dans `Repères` ;
- faible lumière : arrêt avant 15 s puis demande de main ;
- `Tester ce trajet` sur A→P1→B, puis `Va là` confirmé et retour ;
- apprentissage puis réapplication de `Récup` ;
- tremblement pan, température et `vcgencmd get_throttled` ;
- manette Xbox USB puis Bluetooth sur PC Chrome/Edge : détection, zone morte,
  puissance, trim, braquage, arrêt au centre et déconnexion pendant le roulage ;
- stick droit dans les quatre directions et aux limites, avec confirmation
  qu’un geste tenu ne donne qu’un pas et qu’aucun mouvement ne part en roulant ;
- essai Gamepad mobile/iPhone séparé, sans déclarer sa compatibilité avant une
  observation physique avec la manette réellement appairée.

Consigner séparément code livré, tests, déploiement, observation A17 et preuve
matérielle.

## Veille réseau réactivable (bouton uniquement)

La veille réseau est une capacité optionnelle, distincte de l’arrêt électrique.
Le Raspberry Pi reste connecté au réseau avec le seul service
`friday-wake.service`; `friday-camera.service`, `friday-robot.service`, la
reconnaissance PC, les moteurs et les servos sont arrêtés. Il n’existe aucun
délai de veille automatique.

Le Hub n’affiche les boutons **Mettre en veille** et **Réveiller** que lorsque
`wakeUrl` et `wakeToken` sont tous les deux présents dans
`D:\FridayData\robot\hub.json` :

```json
{
  "mode": "alphabot2",
  "url": "http://192.168.1.22:8765",
  "token": "jeton-runtime-existant",
  "wakeUrl": "http://192.168.1.22:8764",
  "wakeToken": "jeton-de-reveil-distinct-de-32-caracteres-minimum"
}
```

Le même `wakeToken` doit être ajouté à
`/home/pi/.config/friday-robot/runtime.env` sous `FRIDAY_WAKE_TOKEN`. Ne jamais
réutiliser le jeton du runtime principal. L’agent refuse par défaut toute
adresse source autre que le PC Friday `192.168.1.14` ; sur un autre réseau,
définir explicitement `FRIDAY_WAKE_ALLOWED_IP`. Conserver aussi le filtrage du
port TCP 8764 dans le pare-feu du Pi/routeur quand il est disponible.

Déploiement sûr, sans déclencher la veille :

1. copier le dossier `robot` à jour sur `/home/pi/friday-robot` et réinstaller
   le paquet dans son venv ;
2. ajouter `FRIDAY_WAKE_TOKEN` au fichier d’environnement ;
3. exécuter
   `sudo sh /home/pi/friday-robot/deploy/install-network-standby.sh` ;
4. vérifier que `friday-wake`, `friday-camera` et `friday-robot` sont tous
   `active`, puis tester `GET /state` du wake agent avec son jeton ;
5. seulement après cette preuve, ajouter `wakeUrl`/`wakeToken` au `hub.json` et
   redémarrer la recette Windows.

Le script installe d’abord l’agent permanent, ses deux helpers root exacts et
la règle sudoers minimale, puis rattache caméra et robot à
`friday-awake.target`. Une nouvelle installation part toujours éveillée. Le
fichier `/var/lib/friday-wake/desired-state` conserve ensuite le choix lors des
redémarrages.

Au clic veille, le Hub annule le run autonome, arrête le mouvement, repasse en
Manuel, désactive roues et servos, suspend le flux et l’inférence, puis demande
l’arrêt des deux services Pi. Au réveil, caméra puis robot sont attendus au
maximum 20 secondes ; le robot revient en Manuel, roues et servos désactivés.
Aucun run autonome ne reprend. Les commandes répétées sont idempotentes.

Recette physique obligatoire : zone sûre, arrêt accessible, robot immobile ;
tester une veille, confirmer les services inactifs et l’agent actif, réveiller,
confirmer le retour du flux, puis activer séparément les switches. Tester enfin
un redémarrage en état éveillé puis en état veille. Ne pas déclarer la fonction
validée sur le robot avant cette recette.

### Déploiement du 27 août 2026

Le runtime utilisateur, l’agent et les unités systemd sont installés sur le Pi.
Les 27 tests Python y ont réussi. Après installation,
`friday-wake.service`, `friday-camera.service`, `friday-robot.service` et
`friday-awake.target` étaient tous actifs, l’état désiré valait `awake`, les
roues et servos étaient désactivés et `moving=false`. Le Hub A17 a ensuite été
configuré et redémarré avec health/SQLite `ok`.

Sauvegardes de retour arrière :

- runtime Pi : `/home/pi/friday-robot-backup-20260827-014257` ;
- configuration Hub :
  `D:\FridayData\robot\hub-before-network-standby-20260827-014855.json`.

Le helper Windows
`infra/windows/Invoke-FridayPiStandbyInstall.ps1` ouvre une session dédiée pour
la seule saisie interactive du mot de passe `sudo`; aucun mot de passe n’est
stocké. La recette physique veille/réveil ci-dessus reste à effectuer.

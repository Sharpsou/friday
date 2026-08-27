# État canonique Friday — application et robot

Date de mise à jour : 27 août 2026
Statut : **source de vérité d’implémentation**

## Application

Friday est un monorepo pnpm TypeScript : PWA React/Vite/Workbox offline-first,
hub Fastify sur Windows, SQLite canonique sous `D:\FridayData`, Dexie chiffré
et outbox sur les appareils, contrats Zod partagés et runtime Python séparé sur
le Raspberry Pi.

La navigation comporte Aujourd’hui, Agenda, Courses, Budget, Chat, Veille et
Robot. Auth fermée et partage à deux sont implantés. Agenda, Courses, Budget,
Chat et Veille restent conformes aux décisions 09/10. Google Calendar n’est pas
implanté ; Tailscale et les données Budget réelles restent derrière leurs
portes documentées. Le Chat n’a aucune mutation métier ni commande Robot.

SQLite est en migration **32** et Dexie en version **7** :

- 1–19 : Maison, auth, sync, Budget, Chat, recherche et Veille ;
- 20–25 : ancien prototype Robot, conservé uniquement dans l’historique de
  migration ;
- 26 : suppression volontaire des 21 tables de ce prototype ;
- 27 : six tables d’autonomie topologique visuelle.
- 28 : préférence d’affichage Reco partagée et persistante par foyer.
- 29 : trim de direction partagé et persistant par foyer.
- 30 : reset du graphe non validé, panoramas corporels, ports, passages
  qualifiés et habitudes SARSA globales.
- 31 : durée globale et bornée des impulsions du panorama corporel.
- 32 : extension de cette durée globale jusqu'à 1 000 ms.

Les migrations 20–25 n’ont pas été réécrites. Les anciennes données Robot ne
sont pas importées dans le nouveau modèle. Le retour arrière passe par la
sauvegarde SQLite cohérente pré-migration 26, jamais par une copie WAL brute.
La sauvegarde vérifiée avant le reset topologique est
`D:\FridayData\backups\friday-pre-topological-habits-20260826-213945.sqlite` ;
elle conserve une base en migration 29 intègre. La sauvegarde historique
pré-trim reste `friday-pre-global-trim-20260826-132529.sqlite`.

## Robot AlphaBot2

Le matériel réel est un AlphaBot2-Pi sans encodeur, IMU, LiDAR ni pince : caméra
CSI, deux IR avant, cinq capteurs de ligne et pan/tilt PCA9685. Le servo pan
tremble encore par intermittence. Les IR ne certifient pas un évitement
domestique.

| Couche | Responsabilité                                                 |
| ------ | -------------------------------------------------------------- |
| PWA    | vidéo, Reco, joystick, actionneurs, modes, repères et `Va là`  |
| PC     | YOLO, ORB/RANSAC/flot, graphe, SARSA et sécurité de navigation |
| Pi     | GPIO, moteurs, servos, capteurs, watchdog et arrêt local       |

La PWA accepte aussi une manette Gamepad au mapping `standard`, prioritairement
Xbox sur PC. En Manuel, le stick gauche réutilise la locomotion tactile et le
stick droit applique un unique pas caméra borné par geste. Le tactile reste
prioritaire, toute reprise exige un passage au neutre, la caméra reste immobile
pendant le roulage et les sticks n’ont aucun effet en Autonome. La lecture
Gamepad reste entièrement dans la PWA et ne modifie pas le Pi ; sa recette
physique PC, Bluetooth et mobile reste ouverte. Le trim est toutefois une
calibration globale du robot, relue depuis le Hub par toutes les PWA. La
puissance reste locale au contrôleur ; tactile et manette l'utilisent
directement. Le démarrage de l'autonomie transmet toute la plage 10–35 % au
Hub et une modification pendant le run est appliquée à chaud sans redémarrage.
Tactile, manette et autonomie consomment la même valeur de trim.

Le bouton `Reco affichée/masquée` remplace la case locale. Son état est
persisté par le Hub et relu par toutes les PWA : une modification sur mobile
apparaît donc aussi sur le Web. Ce réglage masque uniquement les boîtes et leurs
libellés ; YOLO, le graphe visuel et la cartographie continuent de fonctionner.

Le Pi redémarre toujours avec les deux switches OFF. Une commande physique n’emprunte jamais
l’outbox et n’est jamais rejouée après redémarrage.

Le switch Roues est l’unique autorisation persistante de locomotion ; il
n’existe plus de bail d’armement à renouveler. Roues OFF coupe immédiatement les
moteurs. `/halt`, `/stop`, les changements de mode et l’absence de commande
fraîche arrêtent le mouvement sans réactiver ni désactiver implicitement les
switches. Le champ `armed` et `/arm` restent temporairement compatibles avec les
anciens clients, sans expiration propre. Dans la PWA, le switch Roues est la
coupure persistante ; le bouton rouge `ARRÊT`, devenu redondant, n’est plus
affiché.

## Nouveau mode autonome

La carte métrique, la pose `x/y`, l’odométrie simulée, le graphe SE(2), Dyna-Q,
le journal cognitif et le conseil Qwen Robot ont été retirés. Le modèle actif
est décrit dans
[30 — autonomie topologique visuelle](30-decision-autonomie-topologique-visuelle.md).

Le robot reconnaît des scènes comme lieux, conserve au plus trois JPEG et douze
secteurs légers par lieu, rattache les objets au lieu et apprend les passages
orientés entre lieux. Manuel
et Autonome nourrissent la même représentation ; il n’existe plus de bouton
Carto. Un objet reste donc représenté quand il sort du champ.

Le propriétaire peut renommer chaque repère depuis la carte. Ce nom humain ne
change que le libellé : identité, signatures, objets, transitions, politique
et destination `Va là` restent attachés au même UUID. Plusieurs repères peuvent
décrire la même pièce ; un suffixe de scène (`Salon — canapé`) est alors plus
précis qu’un nom de pièce dupliqué.

Deux apparences d'une même scène peuvent être fusionnées depuis `Repères`. Le
repère affiché reste l'identité canonique ; au plus trois vues complémentaires
sont conservées et les objets de même classe sont agrégés. Les passages du
repère absorbé sont oubliés, car leurs secteurs panoramiques ne peuvent pas être
redirigés sans preuve ; ils devront être reparcourus. Les habitudes globales
restent intactes. La fusion arrête le robot et exige une confirmation
propriétaire.

Le propriétaire peut aussi supprimer un repère avec ses vues, objets,
transitions et apprentissages, ou supprimer un objet seul. Un objet supprimé
n'est pas interdit : il peut réapparaître si la perception le reconnaît de
nouveau. Aucune nouvelle table SQLite n'est requise par ces opérations.

L’autonomie choisit des intentions qualitatives. Une décision visuelle à 4 Hz
pilote une impulsion à la puissance utilisateur courante (10–35 %), renouvelée
à 10 Hz et expirant après 300 ms. Sa durée compense la puissance : 180–500 ms
pour l'avance normale, 140–400 ms pour les autres intentions. Le robot s'arrête
ensuite, laisse 700 ms au châssis puis exige trois observations consécutives
exploitables, stables et immobiles avant une autre décision. Une trame de plus
de 700 ms, une image inutilisable, un IR bloqué, une rotation résiduelle, une
pause d’observation ou l’arrêt utilisateur interrompt ou retarde le cycle.
Après 15 s sans vision exploitable, le robot reste arrêté et demande la main.

Le Worker OpenCV classe le flot visuel en immobilité, rotation caméra, rotation
du châssis, translation ou incertitude. Un repère exige six images sur 1,5 s et
une translation, sauf pour la toute première ancre. La localisation attend
trois correspondances cohérentes : un mouvement de tête ou un UUID provisoire
ne constitue plus un progrès.

Après un redémarrage, le graphe peut contenir des lieux alors que la pose
topologique courante est inconnue. L’autonomie ne reste plus dans cette boucle
d’attente : après 1,2 s stable, elle tente huit pivots de relocalisation avec la
durée 360° globale, 700 ms de repos et trois images stables. Sans correspondance, deux IR libres
autorisent un déplacement avant de 300 ms à la puissance utilisateur, suivi de
2,5 s immobiles. Le
flot de cette translation peut alors justifier une nouvelle ancre ; aucune
transition n’est inventée depuis un lieu inconnu. Deux IR bloqués arrêtent la
recherche.

Un nouveau repère reçoit un panorama corporel : caméra centrée, impulsions de
pivot à la puissance utilisateur, arrêt, 700 ms de repos puis trois frames
immobiles. Leur durée
globale est réglable sous le trim entre 120 et 1 000 ms, par pas de 20 ms ; la
valeur initiale de 220 ms règle séparément la longueur du geste. Un changement
de durée est partagé entre PWA et s'applique dès l'impulsion suivante ; un
changement de puissance sur la PWA qui contrôle le run s'applique aussi à chaud,
y compris au renouvellement d'une impulsion longue. Le
tour est fermé après au moins six secteurs par une forte reconnaissance
géométrique ORB/RANSAC ou un pHash très proche de la vue initiale. Une
correspondance ORB ou pHash plus souple exige au moins trois occurrences d’un
objet vu au début de l’acquisition ; un objet seul ne suffit jamais.
Il n’abandonne plus après 30 s : il attend jusqu’à 2 s une image stable ; si la
vue reste pauvre ou inexploitable, il la traverse par l’impulsion suivante sans
enregistrer de faux secteur. Les impulsions continuent jusqu’à la fermeture, un
arrêt utilisateur, les roues désactivées ou les deux IR bloqués. Seules 12
signatures distinctes sont conservées.

La politique `topological-habits-v1` utilise SARSA(λ) sur un contexte sensoriel
sans UUID. Elle apprend des habitudes locales mais ne contrôle ni les preuves
topologiques ni les sécurités.

`Va là` ne cible qu’un lieu confirmé et ne suit que des transitions confirmées.
`Tester ce trajet` valide à la puissance utilisateur deux ou trois passages reliant A à B par un ou
deux repères intermédiaires. Les retours présumés restent inutilisables avant
leur vraie traversée.
`Récup` passe en manuel, observe une courte manœuvre et ne l’apprend que si un
dégagement des deux IR ou un changement de lieu prouve le progrès. La
réapplication reste limitée par le plus petit plafond entre la puissance
utilisateur et 20 %, à 140 ms par commande, et revalidée par les
capteurs. Une marche arrière autonome n’est proposée qu’après une arrivée
visuelle confirmée.

La mémoire est bornée à 128 lieux, 3 vues par lieu, 512 objets, 32 Mio de JPEG
et 8 Mio de descripteurs. Une frame contenant une personne ne conserve aucun
JPEG, la personne est masquée dans la signature et aucune présence durable
n’est créée.

Le nombre d’observations d’un objet représente des rencontres et non des
frames : la visibilité continue n’ajoute rien ; le compteur augmente après un
retour dans le lieu ou une absence de détection d’au moins 30 s. Un heartbeat
de 30 s maintient `last_seen_at` sans incrémenter le compteur ni écrire à chaque
image. Les valeurs historiques ne sont pas recalculées automatiquement.

Les réglages propriétaire proposent un flux caméra `Normal` (640 × 480,
15 images/s, JPEG 70) ou `Réduit` (640 × 480, 7 images/s, JPEG 55, réduction
estimée à 60 %). La réduction se fait à la source sur le Pi ; changer de profil
arrête la navigation et reconnecte le flux. Le même écran permet, après
confirmation, de purger les lieux créés pendant la dernière heure ou toute la
mémoire visuelle. Les vues, objets, transitions et apprentissages qui dépendent
des lieux supprimés sont nettoyés ensemble.

## IA du PC et communications

YOLO26s ONNX tourne dans un Worker Node isolé. OpenCV calcule ressemblance et
mouvement visuel. SARSA(λ) note les habitudes globales avec progrès,
information, non-avancement et blocage. Aucun LLM n’intervient dans la
navigation.

Le Chat Friday peut seulement lire les objets et lieux non ambigus avec des
références `[F…]`. Il ne peut ni armer, ni déplacer, ni choisir une destination.

Sa recherche Web est source-first : Tavily et Exa découvrent des documents,
puis Friday normalise leurs URL, retire les paramètres de suivi, fusionne les
doublons techniques et sélectionne dans le texte disponible les passages les
plus directs relativement à la question. Le même classement généraliste sert à
tous les sujets : pertinence pour la demande et les requêtes, diversité des
domaines, puis fraîcheur seulement si elle est demandée. Il n'existe plus de
profil métier ni de hiérarchie de domaines codée en dur. Une source ancienne
informe le contexte mais ne prouve pas seule une nouveauté. Le routeur temporel
local ne fournit la date civile au
planificateur que pour une demande récente ou actuelle ; il préserve les années
historiques demandées et corrige avant envoi les millésimes obsolètes inventés
par le modèle. En approfondi, au plus deux pages originales peuvent être
lues via le lecteur HTTPS/SSRF borné, puis une seule recherche corrective cible
une lacune générale de pertinence, diversité ou fraîcheur ; au-delà, la réponse
reste explicitement partielle. Auteur et auditeur reçoivent titre, URL, date,
format et passages, sans étiquette d'autorité inventée. L'auditeur Qwen doit
rendre un verdict sur chaque segment ; il corrige localement, retire une
répétition ou un fait sans preuve, et un audit incomplet rétrograde le résultat
persistant à `partial` sans boucle de régénération. Les citations groupées du
modèle sont normalisées déterministement. Le banc
local Qwen/Gemma/GPT-OSS relit SQLite sans l'écrire et conserve ses résultats
privés hors Git dans `.analysis/`.

## Niveau de preuve

Le code, la migration et les tests logiciels sont distincts du déploiement et
de la recette physique. La recette matérielle du nouveau graphe, de la conduite
fluide, du noir, de `Va là` et de `Récup` reste ouverte. Aucun test automatisé
ne prouve le comportement A17/iPhone/AlphaBot2 réel.

Preuve logicielle et déploiement migration 32 du 26 août 2026 : `pnpm verify`
vert (24 Robot Python, 25 contrats, 15 domaine, 159 Hub, 102 PWA et 25
Playwright), build et health check A17 verts. La base active est en migration
32 avec `integrity_check = ok` ; 4 repères, 18 secteurs, 4 transitions, le trim
global à -5 et la durée panorama à 500 ms ont été conservés. La sauvegarde
pré-migration 32 vérifiée est
`D:\FridayData\backups\friday-pre-panorama-loop-20260826-232816.sqlite`. Cette
preuve ne rétrovalide pas le comportement physique.

Preuve logicielle et redéploiement passif du 27 août 2026 pour la puissance
autonome à chaud : `pnpm verify` vert (24 Robot Python, 25 contrats, 15 domaine,
160 Hub, 103 PWA et 25 Playwright), builds production et health check A17 verts
avec `database = ok`. L'observation directe du Pi après redémarrage du Hub le
montre connecté, immobile et en mode Manuel ; aucun essai moteur n'a été lancé.
La recette physique d'un changement 10–35 % pendant un déplacement ou un
panorama reste à faire en zone sûre.

La correction de cadence du 27 août 2026 remplace le roulage autonome continu
par des impulsions compensées selon la puissance, suivies de 700 ms de repos et
de trois images stables. `pnpm verify` est vert avec 162 tests Hub, 103 PWA et
25 Playwright. Le déploiement reste une preuve logicielle ; l'alternance réelle
impulsion/stabilisation doit encore être observée sur l'AlphaBot2.

Le paquet Pi a ensuite été réinstallé dans son virtualenv et ses 21 tests ont
réussi. La réponse réelle expose `visual_topology` et
`topological_autonomy` ; le parseur du Hub l’accepte. Un essai contrôlé a
renouvelé huit commandes avant à 15 % toutes les 100 ms, puis confirmé
`armed=false`, `moving=false`, roues désactivées et retour en Manuel.

Le paquet Pi intégrant les profils caméra a été réinstallé et ses 24 tests ont
réussi ; `friday-camera` et `friday-robot` ont redémarré actifs, roues et servos
OFF. Une mesure directe de six secondes dans la même scène a donné 1 795 295
octets en `Normal` contre 524 543 en `Réduit`, soit 70,8 % de trafic en moins.
Le candidat A17 a ensuite été reconstruit, redémarré et son health check a
répondu correctement. Aucune purge réelle n’a été exécutée.

Après déploiement du comptage par rencontres, une observation réelle de 15 s,
robot désarmé et immobile, a conservé exactement les compteurs Chaise 138,
Bouteille 6, Livre 16 et Table 75. Les valeurs historiques restent inchangées ;
seuls les futurs incréments suivent la nouvelle sémantique.

Après une évolution runtime :

```powershell
pnpm verify
infra/windows/Start-FridayRecipe.ps1 `
  -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Avant tout mouvement : utilisateur présent, zone sûre, arrêt accessible et
recette explicite. Lire le [runbook Robot](runbooks/robot-alphabot2.md).

## Addendum 2026-08-27 — veille réseau AlphaBot2

- La PWA et le Hub savent gérer une capacité optionnelle `network_standby` :
  bouton manuel veille/réveil, écran de veille avec Repères toujours
  consultables, états explicites `awake`, `sleeping`, `transitioning`,
  `degraded`, `unavailable`.
- L’agent Pi minimal, son target systemd, les helpers root bornés et le script
  d’installation sont livrés dans `robot/deploy`. La caméra, le runtime GPIO et
  la vision PC sont suspendus en veille ; le réseau et l’agent restent actifs.
- Le réveil ne réactive ni les roues, ni les servos, ni l’autonomie. Il revient
  en Manuel. Il n’existe pas de veille automatique.
- `wakeUrl` et un `wakeToken` distinct sont maintenant configurés hors Git. Le
  runtime utilisateur et ses 27 tests ont été déployés sur le Pi, puis les
  unités systemd ont été installées le 27 août 2026. `friday-wake`,
  `friday-camera`, `friday-robot` et `friday-awake.target` ont été vérifiés
  actifs avec l’état désiré `awake`; roues et servos restaient désactivés et
  `moving=false`. La sauvegarde préalable est
  `/home/pi/friday-robot-backup-20260827-014257` et celle de la configuration
  Hub est `D:\FridayData\robot\hub-before-network-standby-20260827-014855.json`.
- Le bouton est désormais exposable par le Hub. Le cycle physique complet
  veille puis réveil n’a pas encore été déclenché et reste la seule recette
  ouverte de ce lot.
- Gate logiciel du lot : `pnpm verify` vert avec 27 tests Robot Python, 26
  contrats, 15 domaine, 165 Hub, 104 PWA, 25 Playwright et les builds de
  production.

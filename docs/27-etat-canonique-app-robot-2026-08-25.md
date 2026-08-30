# État canonique Friday — application et robot

Date de mise à jour : 30 août 2026
Statut : **source de vérité d’implémentation**

## Application

Friday est un monorepo pnpm TypeScript : PWA React/Vite/Workbox offline-first,
hub Fastify sur Windows, SQLite canonique sous `D:\FridayData`, Dexie chiffré
et outbox sur les appareils, contrats Zod partagés et runtime Python séparé sur
le Raspberry Pi.

Le moteur Chat est retiré en vue d'une reconstruction. Les modes Local, Friday,
Web léger et Web approfondi, le choix de modèle, la création, l'envoi, les
runs, la recherche et l'orchestration LLM ne sont plus exposés. L'onglet Chat
est une archive privée : lecture des conversations et sources historiques,
archivage, restauration et suppression. Une ancienne PWA qui tente
d'envoyer reçoit HTTP 410 et ne déclenche aucun modèle.

Les migrations Assistant jusqu'à 40 et les données existantes restent en place
pour préserver l'historique et la compatibilité SQLite ; elles sont désormais
historiques et ne définissent pas le futur harnais. La Veille utilise des
adaptateurs Qwen et Tavily propres à son domaine. La reconstruction est régie
par [32 — fondation du nouveau Chat](32-fondation-reconstruction-chat.md), qui
remplace les addenda Chat plus bas comme instruction active.

Le retrait est déployé sur l'origine A17. `pnpm verify` passe avec 27 tests
Robot, 25 contrats, 15 domaine, 107 Hub, 100 PWA et 25 Playwright. Le health
check répond `status=ok`, `database=ok`, `ollama=not-required`. La SQLite active
reste en migration 40, intègre et sans violation de clé étrangère ; les quatre
conversations et huit messages présents lors du contrôle ont été préservés.

La navigation comporte Aujourd’hui, Agenda, Courses, Budget, Chat, Veille et
Robot. Auth fermée et partage à deux sont implantés. Agenda, Courses, Budget,
Chat et Veille restent privés par profil. Google Calendar n’est pas
implanté ; Tailscale et les données Budget réelles restent derrière leurs
portes documentées. Le Chat n’a aucune mutation métier ni commande Robot.

SQLite est en migration **40** et Dexie en version **7** :

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
- 33 : relations généralistes entre sources Web d'un même run Assistant,
  sans modifier le contrat historique des messages.
- 34 : exigences de recherche privées et bornées persistées avec chaque run
  Assistant.
- 35 : matrice privée de preuves et compteurs bornés des passes d'évaluation
  et d'audit.
- 36 : rapport privé et borné de validation `grounded-claims-v2`.
- 37 : tentatives privées de traitement par run, bornées à deux par étape et
  exposées avec des messages sûrs dans le Chat.
- 38 : étape de rédaction Web fermée dans les diagnostics de traitement.
- 39 : contrat de forme de réponse et audit privé borné de chaque claim, sans
  texte de claim ni citation brute.
- 40 : rapport `grounded-answer-v3`, journal privé des audits de réponse et
  étapes bornées rédaction/audit/révision du mode Web approfondi.

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
tous les sujets : pertinence pour la demande et les requêtes, adéquation entre
chaque exigence et son type de preuve attendu, diversité des domaines, puis
fraîcheur seulement si elle est demandée. Le plan contient au plus six exigences
persistées ; une exigence critique du mauvais type reste ouverte et alimente
l'unique correction bornée. Il n'existe plus de
profil métier ni de hiérarchie de domaines codée en dur. Une source ancienne
informe le contexte mais ne prouve pas seule une nouveauté. Le routeur temporel
local ne fournit la date civile au
planificateur que pour une demande récente ou actuelle ; il préserve les années
historiques demandées et corrige avant envoi les millésimes obsolètes inventés
par le modèle. Le léger conserve Tavily seul, cinq sources, deux lectures et
deux crédits ; l'approfondi conserve Tavily + Exa, huit sources, quatre lectures
et quatre crédits. Les deux modes évaluent les preuves avant rédaction et
peuvent effectuer une seule recherche corrective, avec un déclenchement plus
strict en léger. Auteur et auditeur reçoivent titre, URL, date, format et
passages, sans étiquette d'autorité inventée. L'auditeur Qwen rend un verdict
positionnel compact sur chaque segment ; une seconde passe unique récupère une
sortie incomplète ou invalide. Friday valide les corrections et recalcule les
citations localement. Une sortie totalement inexploitable ne diffuse plus le
brouillon et rétrograde le résultat à `insufficient`, sans troisième audit ni
boucle de régénération. Les citations
groupées ou parenthésées du modèle sont normalisées déterministement. Le banc
local Qwen/Gemma/GPT-OSS relit SQLite sans l'écrire et conserve ses résultats
privés hors Git dans `.analysis/`.

Avant la limite finale de huit sources, une couche déterministe rapproche les
pages qui partagent une URL d'origine profonde et des marqueurs factuels
distinctifs. Ce groupe compte comme une seule information indépendante et
conserve au plus deux pages. Une ressemblance sans origine commune est seulement
signalée comme probable, sans fusion ni chaînage. Le calcul est transversal aux
sujets, sans taxonomie métier, embedding, appel LLM ou recherche supplémentaire.
Auteur et auditeur voient les mêmes relations ; la PWA les affiche sous les
sources via une route privée optionnelle compatible avec les anciens clients.
Les relations probables exigent maintenant une signature factuelle compatible :
des identifiants distinctifs divergents bloquent le rapprochement. La couverture
requiert aussi deux unités comportant une preuve directe, et l'audit Web borné
contrôle soutien, adéquation à la relation demandée et temporalité. Ces garde-fous
restent généralistes et sans taxonomie métier. Les colonnes de migration 35
sont historiques et ne sont plus alimentées par le pipeline actif.

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

## Addendum 2026-08-27 — regroupement généraliste des sources Web

- La migration SQLite 33 ajoute aux sources Assistant un groupe, un niveau
  `certain|probable|single`, une représentante et une clé d'origine interne
  bornée. Les anciennes lignes restent `single` et le contrat historique des
  messages n'est pas modifié.
- Une origine commune certaine compte une fois dans la couverture et conserve
  au plus deux pages. Une relation probable est affichée mais n'est jamais
  fusionnée. Aucun nouveau modèle, embedding, appel réseau ou règle métier par
  sujet n'a été ajouté.
- La sauvegarde cohérente pré-migration est
  `D:\FridayData\backups\friday-pre-evidence-groups-20260827-101108.sqlite` :
  migration 32 et `integrity_check = ok`.
- Gate logiciel : `pnpm verify` vert avec 27 tests Robot, 26 contrats,
  15 domaine, 175 Hub, 104 PWA et 25 Playwright. Le candidat a été reconstruit
  et redémarré ; health check `ok`, base active en migration 33 et
  `integrity_check = ok`.
- Cette preuve ne remplace pas une recette UX réelle d'une nouvelle recherche
  Web sur l'A17.

## Addendum 2026-08-27 — contrôle généraliste de pertinence Web

- Une signature factuelle fondée sur les identifiants, nombres et termes rares
  évite de rapprocher deux résultats seulement parce qu'ils partagent un sujet.
- La sélection exige deux unités de preuve directe et privilégie ces pages pour
  la lecture bornée. L'unique audit Qwen vérifie soutien, attribution et
  temporalité ; aucune boucle, taxonomie métier ou génération supplémentaire.
- `pnpm verify` vert : 27 tests Robot, 26 contrats, 15 domaine, 178 Hub,
  104 PWA et 25 Playwright. Le candidat a été reconstruit et redémarré ; health
  check `ok`. Une nouvelle réponse réelle reste une validation distincte.

## Addendum 2026-08-27 — audit Web récupérable

- Le contrat d'audit ne répète plus les citations ni une couverture globale ;
  sa sortie passe à 4096 tokens et les appels JSON Qwen ont un
  `presence_penalty` nul.
- Chaque verdict est validé isolément. Friday conserve les corrections sûres,
  refuse une suppression globale excessive et distingue audit complet,
  partiel, tronqué, invalide ou indisponible sans persister la sortie brute.
- Une qualification de passage non contractuelle telle que `[S1, P2]` est
  ramenée à `[S1]` avant l'audit ; les identifiants `P` ne sont jamais exposés
  comme des sources et ne peuvent plus rendre tous les segments invérifiables.
- Un banc local dédié compare Qwen, Ministral Review et GPT-OSS sur le même
  harnais. La première mesure conserve Qwen : Ministral dépasse la borne sur le
  dossier réel et GPT-OSS n'a produit aucun audit structuré exploitable.
- La recette réelle d'une nouvelle réponse Web reste distincte de cette preuve
  automatisée et doit confirmer un nombre de segments vérifiés supérieur à zéro.

## Addendum 2026-08-27 — exigences de preuve et audit fermé

- Le plan Web extrait au plus six exigences généralistes et leur type de preuve
  attendu. Elles sont privées au run, persistées par la migration 34 et
  reconstruites déterministement si le plan structuré est invalide.
- La sélection privilégie les documents qui couvrent encore une exigence
  critique. Une mention pertinente provenant du mauvais type de source reste
  `partial` et alimente l'unique recherche corrective existante.
- Le schéma d'audit contient exactement les identifiants des segments envoyés ;
  seules des variantes non ambiguës sont normalisées. Un audit partiel est
  signalé dans la réponse et un audit à zéro segment échoue fermé sans diffuser
  le brouillon.
- Aucun modèle, appel Web, retry, second audit ou boucle d'orchestration n'a été
  ajouté.
- Sauvegarde cohérente pré-migration :
  `D:\FridayData\backups\friday-pre-research-requirements-20260827T190018Z.sqlite`,
  migration 33 et `integrity_check = ok`.
- `pnpm verify` vert : 27 tests Robot, 26 contrats, 15 domaine, 190 Hub,
  104 PWA et 25 Playwright. Le candidat a été reconstruit et redémarré ;
  `/api/health` répond `ok`, base active en migration 34 et
  `integrity_check = ok`.
- La qualité d'une nouvelle réponse Web réelle reste une recette UX distincte.

## Addendum 2026-08-27 — recherche adaptative et correction bornée

- Web léger et approfondi partagent désormais sélection, relations de sources,
  lecture originale, matrice exigences/preuves et audit fermé. Le léger reste
  Tavily-only avec des plafonds plus bas et ne corrige qu'une lacune critique
  ou une preuve directe insuffisante.
- Le modèle du run évalue les preuves avant rédaction. Une unique recherche
  corrective peut être suivie d'une unique réévaluation ; les sources restent
  des données hostiles et le classement déterministe peut rétrograder un soutien
  du mauvais type.
- L'audit devient positionnel et accepte une seule seconde passe. Aucun segment
  factuel non contrôlé n'est diffusé quand les suppressions rendent le résultat
  inexploitable ; il n'existe ni troisième audit ni réécriture complète.
- La migration 35 ajoute seulement la matrice privée et deux compteurs bornés.
  La sauvegarde pré-migration
  `D:\FridayData\backups\friday-pre-corrective-research-20260827T230810.sqlite`
  est intègre en migration 34. `pnpm verify` est vert avec 27 tests Robot,
  26 contrats, 15 domaine, 193 Hub, 104 PWA et 25 Playwright. Le candidat a été
  reconstruit et redémarré ; `/api/health`, la migration 35 active et
  `integrity_check` sont verts. Une nouvelle conversation A17 reste une recette
  UX distincte.

## Addendum 2026-08-28 — benchmark généraliste du Chat

- Un corpus v1 public et synthétique couvre 60 cas : 48 Web équilibrés entre
  huit catégories, 16 variantes réseau et 12 demandes locales/conversationnelles.
- Un corpus difficile v2 séparé ajoute 32 dossiers synthétiques sur les angles
  morts du premier banc : négation étayée, preuves réparties, contradiction,
  origine commune, date du fait, entité/version, page longue ou tronquée et
  source hostile. Il compare aussi plusieurs structures du pipe, permute
  l'ordre des sources et rend les échecs critiques non compensables.
- Le runner compare séparément planificateur, évaluateur de preuves, rédacteur,
  auditeur et pipeline figé. Les appels Ollama sont sérialisés, reproductibles
  par graine, checkpointés après chaque cas et suspendus si un Chat réel est en
  cours.
- Les suites end-to-end figées emploient deux auditeurs locaux distincts du
  candidat. Moins de deux verdicts valides, une divergence supérieure à 0,35
  ou un désaccord sur une erreur critique rend la note subjective non
  concluante ; le score déterministe reste alors seul utilisé.
- Les rapports sont hors Git sous `D:\FridayData\evaluations`. La suite réseau
  exige `--allow-network`; elle reste hors de `pnpm verify` et peut consommer les
  quotas Tavily/Exa.
- L'inventaire ne reconnaît que des tags maintenus dans une liste de confiance.
  Les téléchargements optionnels sont bornés à trois challengers, sérialisés et
  refusés sous 20 Go libres. Aucun modèle ni contenu Web ne peut injecter un tag.
- Une campagne fumée Qwen sur huit tâches a produit un rapport reprenable sans
  erreur : planificateur 0,839, évaluateur 0,750, rédacteur 0,810 et auditeur
  1,000. Ce résultat valide le harnais, pas la supériorité d'un modèle.
- La reprise du même smoke a ajouté deux pipelines figés complets à 0,883 en
  environ 145 secondes chacun. Ministral Review a produit un jugement valide,
  mais GPT-OSS non : avec un seul juge exploitable, la note subjective est
  correctement restée `inconclusive` et n'a pas modifié le score déterministe.
- Les trois challengers qualifiés ont été téléchargés séquentiellement le
  28 août : `lfm2.5:8b` (5,2 Go), `granite4.1:3b` (2,1 Go) et
  `ministral-3:3b` (3,0 Go). Ils sont disponibles pour le banc mais ne sont pas
  sélectionnés dans le Chat.
- Le smoke multi-modèles de 24 tâches est sans erreur de contrat. Sur seulement
  deux cas, LFM2.5 et Granite 4.1 obtiennent 1,000 comme évaluateurs, Ministral
  3B 0,879 comme rédacteur et Granite 4.1 0,864 comme planificateur. Tous les
  verdicts restent `inconclusive` : cet échantillon qualifie les chemins
  d'exécution mais ne justifie aucune bascule avant la grande campagne.
- Le benchmark ne modifie jamais la configuration du Chat. Une bascule de
  modèle exige encore une campagne comparative concluante et un checkpoint
  utilisateur.
- Gate logicielle du lot : `pnpm verify` vert avec 27 tests Robot Python,
  26 contrats, 15 domaine, 202 Hub, 104 PWA, 25 Playwright et les builds de
  production. La suite réseau et la grande campagne modèles restent des
  mesures volontaires, hors de cette gate déterministe.
- Le candidat a été reconstruit et redémarré via le runbook ; le health check
  local répond sur `https://127.0.0.1:8443`. Aucune recette qualitative mobile
  ni grande campagne comparative n'est déduite de ce redémarrage.

## Addendum 2026-08-29 — Grounded Claims v2

- Les deux campagnes complètes ont conduit à retenir Gemma 4 E4B QAT comme
  modèle unique des nouveaux messages Chat. Le choix envoyé par une ancienne
  PWA reste accepté pour compatibilité mais le hub le remplace par Gemma ; les
  métadonnées historiques Qwen restent lisibles.
- Le chemin Web est ramené à une structure unique : planification temporelle et
  exigences déterministes, Tavily/Exa, sélection et lecture, au plus une
  recherche corrective, extraction de claims Gemma, validation déterministe,
  puis un seul lot Gemma optionnel pour les relations ambiguës.
- Il n'existe plus de planificateur LLM, rédacteur Web libre, évaluateur
  sémantique de preuves, audit global par segments ou boucle de réécriture. Les
  anciens scripts de benchmark associés à ces rôles ont été retirés ; leurs
  rapports restent conservés sous `D:\FridayData\evaluations`.
- Chaque claim doit référencer une source connue et une citation exacte. Le hub
  refuse les nombres, dates ou identifiants non ancrés, les indépendances
  fictives, la date du document utilisée comme date du fait, les vidéos seules
  insuffisantes, les instructions de source et les sorties de contrat
  invalides. L'échec est fermé et devient une limite visible.
- La migration 36 ajoute au run un rapport `grounded-claims-v2` privé et borné :
  couverture, claims acceptés/vérifiés/refusés, vérificateur utilisé, motifs
  agrégés et versions des prompts. Les colonnes de migration 35 sont conservées
  uniquement pour l'historique.
- `pnpm verify` est vert : 27 tests Robot, 26 contrats, 15 domaine, 172 Hub,
  104 PWA, 25 Playwright et les builds. La sauvegarde pré-migration
  `friday-pre-grounded-claims-v2-20260829T202212Z.sqlite` est intègre en
  migration 35. Le candidat a été reconstruit et redémarré ; la base active est
  en migration 36, `integrity_check = ok`, et `/api/health` répond `ok`.
- Une nouvelle recherche réelle légère et approfondie reste une recette
  qualitative A17 séparée de ces preuves automatisées.

## Addendum 2026-08-29 — harnais borné commun aux quatre modes

- Les sorties structurées Web et Friday distinguent désormais transport JSON,
  normalisation des identifiants et validation sémantique. Seuls une sortie
  vide, un JSON invalide ou un contrat invalide autorisent une réparation ; il
  n'existe qu'une tentative supplémentaire et elle ne relance aucune source.
- Une information actuelle n'exige plus automatiquement deux origines. Deux
  groupes indépendants restent obligatoires pour une exigence déclarée
  indépendante ou critique ; la date du fait reste obligatoire pour le
  caractère actuel.
- Local conserve l'historique conversationnel et autorise une seule
  continuation après `done_reason=length`. Friday passe par des claims `F*` et
  dispose d'un rendu déterministe des faits autorisés en dernier repli.
- La migration 37 ajoute les tentatives privées de traitement par run : étape,
  tentative bornée à deux, modèle, état, durée, tokens et code sûr. La PWA les
  affiche séparément des diagnostics de recherche et du rapport d'ancrage.
- `pnpm verify` est vert : 27 tests Robot, 26 contrats, 15 domaine, 178 Hub,
  104 PWA, 25 Playwright et les builds. Le snapshot cohérent
  `friday-pre-chat-harness-v3-20260829T211502Z.sqlite` est intègre en migration 36. Le candidat a été reconstruit et redémarré ; la base active est en
  migration 37, `integrity_check = ok`, sans violation de clé étrangère, et
  `/api/health` répond `status=ok`, `database=ok`.
- Aucune qualité de réponse mobile réelle n'est déduite de ces preuves ; une
  recette des quatre modes reste distincte.

## Addendum 2026-08-30 — correction post-audit du Chat Web

- Les modes Web partagent désormais une boucle unique et bornée : première
  recherche, sélection, extraction des claims, puis au plus une correction sur
  l'exigence réellement absente. La correction conserve le premier dossier si
  le réseau ou la seconde extraction échoue et ne lance aucune boucle ouverte.
- Les demandes multi-critères gardent un sujet générique commun dans leurs
  requêtes. Une relance réutilise au plus quatre sources publiques récentes de
  la même conversation et du même profil ; aucune requête ni association
  privée n'est mutualisée.
- Le prompt d'extraction v3 distingue observation, comparaison et conclusion.
  Deux origines indépendantes sont exigées pour conclure sur une exigence
  critique, pas pour restituer une observation directe. Les variantes
  typographiques des citations sont réalignées sur le texte original ; nombres,
  dates et identifiants restent contrôlés uniquement contre les citations.
- Le registre de claims accepté est désormais transmis à un unique rédacteur
  Gemma fermé, sans passages bruts ni accès aux moteurs. Il choisit une forme
  narrative, comparative, procédurale, sélective ou brève ; chaque fragment
  référence ses claims et le hub fabrique les citations. Une invention, une
  exigence perdue ou un contrat invalide provoque le repli déterministe sur les
  claims vérifiés, sans nouvelle recherche ni boucle de réécriture.
- Il n'existe toujours ni rédacteur libre, ni LangGraph, ni nouveau modèle, ni
  règle liée à un produit ou un domaine particulier. Les préambules génériques
  sont retirés des requêtes sans forcer d'année lorsqu'elle n'est pas utile.
- La migration 38 ajoute uniquement l'étape privée `web_editorial` aux
  diagnostics de traitement ; aucun texte brut n'est persisté. `pnpm verify`
  est vert avec 27 tests Robot, 26 contrats, 15 domaine, 193 Hub, 105 PWA,
  25 Playwright et les builds de production. Le snapshot cohérent
  `friday-pre-grounded-editor-20260830T015457.sqlite` est intègre en migration 37. Le candidat a été reconstruit et redémarré ; la base active est en
  migration 38 et `/api/health` répond `status=ok`, `database=ok`, avec
  `integrity_check = ok` et aucune violation de clé étrangère.
- Aucune recherche réelle ni génération Ollama n'a été lancée pendant le
  déploiement. La qualité d'une conversation réelle reste une recette UX
  séparée.

## Addendum 2026-08-30 — harnais Web atomique et banc isolé

- Le contrat actif passe aux prompts extracteur/vérificateur v4 et rédacteur
  v2. Les sources sont découpées en atomes identifiés ; l'auditeur conserve
  seulement les indexes qu'il soutient et le hub réapplique ensuite tous les
  contrôles déterministes sur ce sous-ensemble.
- La provenance des pages n'est plus écrasée par la sélection de passages. Les
  lectures sont dédupliquées par URL canonique et une redirection ou une source
  secondaire ne peut pas devenir implicitement une page primaire.
- La couverture est calculée sur les seuls claims finaux. Une exigence de
  source primaire/autoritative sans source de ce niveau est signalée partielle,
  et les questions temporelles affichent la publication la plus récente comme
  simple repère documentaire.
- SQLite 39 ajoute `assistant_grounding_claim_audits` et trois champs bornés de
  contrat de réponse. Les audits restent privés par profil et ne persistent ni
  texte de claim ni citation brute.
- Le banc actif passe par le véritable `AssistantService`, dans une SQLite
  jetable, et ne modifie pas le Chat de production. Le cinquième cycle réel a
  produit 3 claims vérifiés sur le cas récent et 4 sur le comparatif ; les deux
  contrats structurés sont allés jusqu'au rédacteur. Les rapports complets
  restent hors Git sous `D:\FridayData\evaluations\assistant-refinement`.
- Les dernières lacunes observées ont été traitées sans nouveau rôle :
  normalisation bornée du JSON, contrôle de niveau de source, repère temporel
  documentaire, termes budgétaires génériques et correction du barème qui
  confondait un tableau Markdown avec une liste plate.
- La gate finale est verte : 27 tests Robot, 26 contrats, 15 domaine, 200 Hub,
  105 PWA, 25 Playwright et les builds de production. Le snapshot cohérent
  `friday-pre-grounded-audit-v4-20260830T100443Z.sqlite` est intègre en
  migration 38. Le candidat a été reconstruit et redémarré ; `/api/health`
  répond `status=ok`, `database=ok`, et la base active est en migration 39 avec
  `integrity_check = ok`, zéro violation de clé étrangère et la table d'audit
  présente.
- Cette preuve ne remplace pas une nouvelle recette qualitative réelle sur
  l'A17 après déploiement.

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

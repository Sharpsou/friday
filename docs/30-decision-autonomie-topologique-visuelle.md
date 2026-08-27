# ADR produit — autonomie topologique visuelle et habitudes procédurales

Date : 26 août 2026.
Statut : **implanté et déployé ; recette physique ouverte**

## Décision

Friday construit un graphe de repères visuels clairsemés, sans coordonnées
`x/y`. Chaque repère possède un panorama corporel ordonné ; les passages sont
orientés et rattachés à leurs secteurs de sortie et d'arrivée.

L'autonomie comporte trois couches :

1. réflexes déterministes : switches, IR, watchdog, stabilité et servos ;
2. habitudes SARSA(λ) généralisées par contexte sensoriel ;
3. planification par frontières et itinéraires topologiques.

Un UUID de lieu n'entre jamais dans la mémoire procédurale. L'apprentissage
peut donc transférer ralentissement, pivot, inspection ou récupération vers un
repère encore inconnu.

## Preuves de mouvement et de lieu

Le Worker OpenCV calcule pHash, ORB/RANSAC et un flot optique parcimonieux en
320 × 240. Le Hub classe chaque paire d'images en immobilité, rotation caméra,
rotation châssis, translation ou mouvement incertain.

Un nouveau repère exige une translation accumulée, six images exploitables sur
au moins 1,5 s et trois images finales stables. Le premier repère n'exige pas de
translation préalable. Une rotation, un mouvement de tête ou un déplacement
physique sans commande ne crée jamais de passage.

La localisation accepte un changement après trois correspondances temporelles
cohérentes. Une scène ambiguë reste ambiguë au lieu de créer un nouvel UUID.

## Panorama corporel

La caméra reste centrée à `pan=0`, `tilt=0,2`. Le panorama alterne une impulsion
de pivot à 10 % pendant une durée globale réglable de 120 à 1 000 ms, un arrêt,
700 ms de repos et trois frames immobiles. La valeur initiale est 220 ms et son
ajustement s'applique dès l'impulsion suivante. Il se termine lorsque le secteur
initial est reconnu après au moins six secteurs distincts. Une reconnaissance
ORB/RANSAC forte ou un pHash très proche suffit ; une correspondance ORB ou
pHash plus souple exige au moins trois occurrences d’un objet vu au début du
tour. Un objet seul ne ferme pas la boucle.

Un panorama conserve au plus 12 signatures mais n'abandonne plus après 30 s ou
16 impulsions. Une image instable suspend la rotation pendant 2 s au maximum ;
si elle reste inexploitable, l'impulsion suivante traverse cette vue sans la
mémoriser. L'acquisition continue jusqu'à la fermeture, l'arrêt utilisateur,
la désactivation des roues ou deux IR bloqués. Au-delà de 500 ms, l'impulsion
est renouvelée après 200 ms sans élargir le watchdog matériel de 500 ms. Trois
JPEG représentatifs au maximum sont conservés ; aucun JPEG contenant une
personne n'est écrit.

## Ports, passages et navigation

Un secteur porte un port `unknown`, `candidate`, `exploring`, passage candidat
ou confirmé, blocage temporaire ou impasse. Une apparence ouverte ne suffit pas
à confirmer un passage.

Une traversée A→B exige translation, séquence visuelle et arrivée stable. La
première réussite crée un passage candidat ; la deuxième le confirme. B→A est
d'abord une hypothèse inverse et doit être parcouru.

Le `Va là` normal ne suit que des passages confirmés. `Tester ce trajet` accepte
un parcours A→P1→B ou A→P1→P2→B à 12 %. Chaque passage est validé séparément ;
le test s'arrête au premier écart, IR ou dépassement de
`2 × durée observée + 5 s`.

## Habitudes instinctives

La politique `topological-habits-v1` utilise SARSA avec traces d'éligibilité :
`alpha=0,15`, `gamma=0,9`, `lambda=0,7`, epsilon de 0,15 vers 0,03 et valeurs
bornées à `[-10,10]`.

Le contexte combine IR, mouvement, confiance, gain d'information, ports,
arrivée, panorama, progression et résultat précédent. Les gestes appris sont
avancer lentement/normalement, pivoter, inspecter, changer de port, revenir ou
appliquer une récupération.

Les récompenses sont fondées sur des preuves : `+4` repère, `+3` passage, `+2`
frontière, `+1` information, `0` doublon/provisoire, `-1` absence de gain, `-2`
oscillation et `-4` blocage physique. La curiosité s'épuise avec l'information
déjà acquise.

## Mémoire SQLite

La migration 30 remet volontairement à zéro le graphe non validé de la
migration 27 et remplace les Q-values historiques. Elle conserve les
préférences Reco et trim.

- `robot_visual_places`, `robot_visual_place_views`, `robot_visual_objects` ;
- `robot_visual_anchor_sectors`, `robot_visual_ports` ;
- `robot_visual_transitions` enrichi ;
- `robot_habit_values`, `robot_recovery_skills`, `robot_route_trials`.

Les limites restent 128 lieux, trois JPEG par lieu, 512 objets, 32 Mio d'images
et 8 Mio de descripteurs. Les essais ne conservent que des résumés bornés.

## Rupture propre

La règle « trois images inconnues », `pendingDirection`, les actions autonomes
`look_*`, `wait` appris, le progrès par changement d'UUID et
`stable-camera-v2` sont retirés. Aucun moteur historique ne reste derrière un
flag. Les poses caméra manuelles restent inchangées.

Friday peut expliquer les agrégats en lecture seule mais ne participe jamais à
la commande physique.

## Niveau de preuve

Les tests logiciels couvrent migration, stabilité, panorama, passages,
navigation candidate et généralisation SARSA. Ils ne prouvent pas encore le
dosage réel des roues, la fermeture 360° dans l'appartement ni le trajet
multi-repères. La recette exige l'utilisateur, une zone dégagée et un arrêt
accessible.

Le déploiement migration 32 du 26 août 2026 a un `pnpm verify` vert (24 tests
Robot Python, 25 contrats, 15 domaine, 159 Hub, 102 PWA et 25 Playwright), un
health check A17 vert et une base active intègre. La sauvegarde vérifiée
pré-migration est
`D:\FridayData\backups\friday-pre-panorama-loop-20260826-232816.sqlite`.

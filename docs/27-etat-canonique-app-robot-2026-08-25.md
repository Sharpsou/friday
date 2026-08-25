# État canonique Friday — application et robot

Date : 25 août 2026

Statut : **source de vérité d’implémentation pour la reprise**

Référence auditée : commit applicatif `08cafa1`, base réelle SQLite 24, Dexie 7.
Ce document consolide l’état présent ; les checkpoints antérieurs conservent
les raisons, incidents et mesures de leur étape.

## 1. Vue d’ensemble

Friday est un monorepo pnpm TypeScript :

- PWA React/Vite/Workbox, offline-first, utilisée notamment sur le Galaxy A17
  à `https://192.168.1.14:8443` ;
- hub Fastify sur le PC Windows ;
- SQLite canonique sous `D:\FridayData` ;
- Dexie/IndexedDB chiffré et outbox sur chaque appareil ;
- contrats Zod partagés et règles métier pures ;
- runtime Python séparé sur le Raspberry Pi pour le matériel AlphaBot2 ;
- calculs lourds Robot sur le PC, hors de la boucle matérielle du Pi.

La commande d’autorité est `pnpm verify`. Le dernier candidat vérifié passe :
21 tests Python, 22 contrats, 15 domaine, 145 hub, 91 PWA et 25 parcours
Playwright mobiles, puis les builds de production.

## 2. Application réellement présente

La navigation comporte sept destinations : `Aujourd’hui`, `Agenda`,
`Courses`, `Budget`, `Chat`, `Veille` et `Robot`.

| Domaine   | État implanté                                                                                   | Limite ou preuve restante                                                  |
| --------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Auth      | foyer fermé, propriétaire, second adulte par code, appareils et révocation                      | recettes A17 complètes distinctes ; iPhone auth/offline/convergence validé |
| Agenda    | tâches, date/heure/durée, responsable, note, récurrence, vues Liste/Semaine/Mois                | plusieurs recettes A17 de détail restent ouvertes                          |
| Courses   | partage offline, édition, rayon, classement, import photo et mode En course                     | recettes A17 de bout en bout encore à confirmer                            |
| Budget    | réalisé/prévisionnel, récurrences, enveloppes, provisions et réserve                            | aucune donnée financière réelle avant la porte sécurité/sauvegarde         |
| Chat      | modes `Local`, `Friday`, `Web léger`, `Web approfondi`, Qwen/Gemma, Tavily/Exa, file et reprise | aucune mutation métier directe ; Ollama reste sur le PC                    |
| Veille    | dossiers privés, RSS/Web, concepts, sujets, synthèses et cadence persistante                    | recette d’usage prolongée ouverte                                          |
| PWA       | cache chiffré, outbox, sync idempotente, mise à jour confirmée                                  | les affirmations appareil restent limitées aux recettes réelles            |
| Calendar  | non implanté                                                                                    | futur lot possible, à décider avec l’utilisateur                           |
| Tailscale | ADR acceptée                                                                                    | mise en œuvre explicitement en pause                                       |

Les écritures Agenda, Courses et Budget empruntent la même voie locale en
ligne et hors ligne. Le Chat, la Veille et le Robot ont leurs propres services
et permissions ; aucun modèle de langage ne possède une route générique de
mutation métier ou d’actionneur.

## 3. Données et migrations

- SQLite 1–19 : socle Maison, auth, sync, Budget, Chat, recherche et Veille ;
- migration 20 : mémoire structurée Robot et mode Chat `Friday` ;
- migration 21 : sessions Carto, trajectoire, pose et missions ;
- migration 22 : autonomie, Dyna-Q, cellules et journal cognitif ;
- migration 23 : points de vue, images-clés sélectives et liens objets ;
- migration 24 : signatures de lieux, contraintes de poses, segments,
  événements de relocalisation et calibration d’odométrie ;
- Dexie 7 : schéma navigateur actuel.

Les migrations appliquées ne sont jamais réécrites. La base active a été
migrée en 24 avec intégrité `ok`. Le snapshot cohérent pré-migration 24 est
`D:\FridayData\backups\friday-pre-relocalisation-visuelle-20260825-2035.sqlite`.

## 4. AlphaBot2 réellement présent

Le prototype est un AlphaBot2-Pi à roues différentielles, sans encodeurs, IMU,
LiDAR ni pince. Il utilise un Raspberry Pi 3 sous Trixie 32 bits, une caméra
CSI, deux IR avant, cinq capteurs de ligne et deux servos pan/tilt via PCA9685.

Les responsabilités sont séparées :

| Couche | Responsabilité                                                           |
| ------ | ------------------------------------------------------------------------ |
| PWA    | vidéo, joystick, presets caméra, switches, modes, Carto et carte tactile |
| hub PC | auth, bornage, mémoire, YOLO, localisation visuelle, autonomie et Dyna-Q |
| Pi     | GPIO, moteurs, servos, capteurs, watchdog et arrêt local                 |

Les commandes physiques ne passent jamais par l’outbox ou le service worker et
ne sont jamais rejouées. Un redémarrage laisse les actionneurs désarmés et ne
reprend ni mission ni exploration autonome.

## 5. Modes et autonomie

- `Manuel` : joystick et presets existants ; `Carto` peut observer pendant la
  conduite et reste active quand la caméra bouge.
- `Autonome` : exploration Dyna-Q démarrée explicitement par le propriétaire ;
  Carto démarre automatiquement ; vitesses candidates 10–20 %, impulsions
  bornées et masque capteurs/actionneurs.
- roues coupées : les actions moteur disparaissent, mais la politique peut
  choisir naturellement des observations caméra parmi les presets autorisés.
- `Va là` : cible sur un trajet suffisamment documenté ; suspendue lorsque la
  pose est perdue ou en relocalisation.
- Friday peut conseiller un objectif abstrait borné ; il ne choisit jamais une
  puissance, une durée, une direction ou un angle servo.

Le Dyna-Q apprend en ligne dans un espace d’actions fermé. Il ne peut pas
dépasser les limites matérielles. La récompense utilise nouveauté de carte,
qualité des points de vue, objets confirmés, sortie de blocage et progrès vers
une cible. La localisation et le graphe de poses restent l’autorité ; le signal
de confiance n’est qu’une composante de récompense.

## 6. Carte, mémoire et déplacement physique à la main

La pose de base intègre direction, puissance, trim et durée de roulage. Cette
odométrie dérive. La localisation visuelle ajoute des signatures ORB 320×240,
sans nouvelle image, et des contraintes SE(2) pour fermer les boucles.
Les poses brutes sont conservées ; les coordonnées corrigées portent une
révision et une source. Les dix premières fermetures restent en observation,
puis la calibration de distance/rotation évolue d’au plus 2 % par correction
et reste bornée à ±15 % des coefficients initiaux.

La mémoire est bornée :

- trajectoires : 2 000 points par session et 10 000 par foyer ;
- images-clés : 48 JPEG, 16 Mio, au plus 3 par objet et aucune frame où une
  personne est détectée ;
- signatures : 600, 12 Mio, descripteurs/empreinte/pose/objets mais aucune
  copie d’image supplémentaire.

Quand le robot est soulevé ou déplacé physiquement :

1. un changement de scène répété sans nouvelle commande de roues place la pose
   en `relocalizing` ;
2. les vues de transport ne sont pas mémorisées ;
3. une correspondance confirmée avec un lieu connu replace la pose ;
4. un nouveau segment est créé, sans faux trait entre les deux emplacements ;
5. le bouton `Je l’ai déplacé` permet de provoquer explicitement la même
   recherche ;
6. après échec, la pose passe à `lost`, l’exploration peut continuer avec des
   actions réduites et les capteurs, mais `Va là` reste suspendu.

La carte tactile affiche trajectoires par segment, pose, incertitude,
corrections, directions regardées, objets nommés et événements de
relocalisation. Elle accepte déplacement et zoom. Ce n’est pas encore un plan
métrique des murs ni une reconstruction volumétrique de l’appartement.

Une fermeture automatique exige deux frames cohérentes et des correspondances
géométriques RANSAC suffisamment réparties dans l’image ; le simple fait de
revoir un objet générique ne suffit jamais à déplacer la carte. Les seuils
exacts et la preuve OpenCV sont conservés dans le
[checkpoint 26](26-checkpoint-relocalisation-visuelle-2026-08-25.md).

## 7. Perception et questions au Chat

YOLO26s ONNX tourne dans un Worker Node isolé sur le PC. Les objets confirmés
sont consolidés avec position approximative, confiance, observations, points
de vue et éventuelle image-clé. Les personnes restent anonymes et temporaires.

Le mode Chat `Friday` peut restituer en lecture seule des faits du foyer et de
la mémoire Robot avec références `[F…]`, par exemple un dernier emplacement
d’objet connu. Une affirmation comme « la lumière est allumée » exige encore
un détecteur spécialisé et calibré ; la reconnaissance faciale n’est pas
implantée.

## 8. Limites physiques et niveau de preuve

- le servo pan tremble par intermittence ;
- des sous-tensions historiques sont visibles, mais elles sont informatives et
  ne bloquent plus artificiellement caméra, locomotion ou apprentissage ;
- la caméra monoculaire ne donne pas une profondeur absolue fiable ;
- les IR ne constituent pas un évitement domestique complet ;
- autonomie, fermeture de boucle et déplacement manuel/relocalisation sont
  testés logiciellement mais pas encore validés physiquement dans
  l’appartement ;
- aucun succès A17, iPhone ou matériel ne doit être inféré d’un test automatisé.

## 9. Reprise opérationnelle

1. lire `AGENTS.md`, `docs/00-reprise-nouveau-chat.md` et ce document ;
2. inspecter `git status -sb` et `git log -5 --oneline` ;
3. pour l’App, lire le runbook du domaine ;
4. pour le Robot, lire [runbooks/robot-alphabot2.md](runbooks/robot-alphabot2.md)
   et observer d’abord l’état sans mouvement ;
5. après une évolution runtime : `pnpm verify`, puis
   `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning` ;
6. ne lancer un mouvement physique qu’avec l’utilisateur, une zone dégagée,
   un arrêt accessible et une recette explicite.

Prochains checkpoints utiles : recette physique de relocalisation après
déplacement à la main, observation de la politique caméra/autonome, recettes
A17 encore ouvertes et choix utilisateur du prochain lot applicatif.

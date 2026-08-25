# Checkpoint — mémoire Friday et apprentissage prudent

Date : 25 août 2026

Statut : **verticale logicielle livrée ; cartographie volumétrique et autonomie
physique toujours verrouillées**

## Ce qui est implanté

- migration SQLite 20 : extension compatible du mode Assistant `Friday`, pièces,
  objets mémorisés, observations brutes, présences anonymes, politiques de
  navigation et épisodes d’apprentissage ;
- consolidation locale des détections Robot : un objet n’est confirmé qu’après
  au moins trois vues, deux orientations de caméra et une confiance moyenne de
  80 % ; les observations brutes et présences anonymes sont purgées après
  24 heures ;
- mémoire partagée interrogable et strictement limitée au foyer authentifié :
  Agenda, Courses, Budget, profils du foyer et perception Robot ;
- quatrième mode de conversation `Friday`, à côté de `Local`, `Web léger` et
  `Web approfondi` ; il n’utilise ni Tavily ni Exa et n’est pas mis en file
  hors ligne pour éviter une réponse issue d’un état périmé ;
- réponses fondées sur des faits numérotés `[F…]`. Les données lues sont
  explicitement traitées comme non fiables et jamais comme des instructions.
  Une réponse sans citation valide est remplacée par une restitution factuelle
  déterministe ;
- écran Robot : nombre d’objets confirmés, présence anonyme, état de
  l’apprentissage et liste des objets renommables par le propriétaire ;
- algorithme d’apprentissage conservateur de type bandit contextuel
  (approximation diagonale de LinUCB), récompense de navigation bornée et
  propositions limitées à de faibles corrections de direction, puissance et
  durée.

## Challenge de l’apprentissage par renforcement

L’AlphaBot2 n’a ni encodeurs, ni IMU, ni LiDAR. Avec la seule détection YOLO,
il ne peut pas mesurer de manière fiable la distance parcourue, l’erreur de cap
ou la dérive latérale. Une récompense auto-déclarée « j’ai bien avancé » serait
donc circulaire et pourrait récompenser un patinage, une oscillation ou un
rapprochement d’obstacle.

L’algorithme est par conséquent livré comme composant **shadow** : il sait
calculer une proposition et enregistrer une récompense objective, mais aucune
proposition n’est appliquée aux moteurs. Une sous-tension, une distance libre
insuffisante ou une localisation incertaine force une correction nulle. Le
passage à un candidat moteur exigera d’abord une mesure indépendante
(encodeurs ou odométrie visuelle évaluée), un corpus de parcours rejouables et
une validation humaine. Le LLM et le mode Chat Friday ne possèdent aucun droit
de commande Robot.

## Ce qui reste volontairement non livré

- SLAM monoculaire, reconstruction 3D et calcul de volumétrie en arrière-plan ;
- identification automatique fiable des pièces ;
- état réel d’une lumière, tant qu’un détecteur spécialisé et calibré ne le
  confirme pas ;
- reconnaissance faciale ou identité des personnes ;
- navigation vers une cible, évitement domestique et exploration autonome ;
- application en ligne d’une politique apprise.

Les boutons `Cartographie` et `Autonome` restent désactivés. Cette limitation
est un garde-fou produit, pas une lacune d’interface.

## Autorités techniques

- mémoire : `apps/hub/src/robot/robot-memory.ts` ;
- lecture Friday : `apps/hub/src/assistant/friday-memory.ts` ;
- apprentissage : `apps/hub/src/robot/robot-learning.ts` ;
- migration : `apps/hub/src/db/database.ts` ;
- routes : `apps/hub/src/app.ts` ;
- interface : `apps/web/src/AssistantView.tsx` et
  `apps/web/src/RobotView.tsx`.

## Validation

`pnpm verify` réussit le 25 août 2026 : formatage, lint, types, 21 tests Python,
246 tests TypeScript (22 contrats, 15 domaine, 122 hub et 87 PWA), builds PWA et
hub, puis 25 scénarios Chrome mobile. Aucune recette physique de mouvement ou
de qualité de reconnaissance n’est déduite de ces tests automatisés. Le mode
Friday et la mémoire restent à valider séparément sur l’A17 après redémarrage
du candidat.

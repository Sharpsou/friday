# Prochaines étapes après le classement des courses

Date : 9 août 2026

Statut : plan d'exécution actif après le candidat de classement par rayon

## Point de départ

Le candidat Lot 1A couvre maintenant les tâches planifiées et récurrentes, l'authentification fermée, les courses partagées offline-first et leur classement facultatif par rayon. En mode `Modifier`, toucher une tâche ouvre ses champs et toucher une course permet de corriger son libellé, sa quantité ou son rayon ; le bouton `Supprimer` reste visible directement. Ces modifications empruntent la voie locale chiffrée/outbox et la correction manuelle d'un rayon est prioritaire sur le classement automatique.

Le protocole Ollama relie chaque entrée et chaque réponse par un index vérifié. Le mode de raisonnement est désactivé, le délai est de 120 secondes, le job reste arrêtable et aucune proposition partielle n'est appliquée. Le benchmark reproductible obtient 99,3 % sur 150 cas hybrides et 88,9 % sur neuf cas difficiles.

Ces preuves sont automatisées. Elles ne remplacent pas la recette physique sur Galaxy A17 ni l'appairage réel du second appareil.

## Étape 1 — Recette courte du classement sur Galaxy A17

Cette recette peut être jouée indépendamment du report de l'étape 2 :

1. recharger la PWA afin de recevoir le dernier service worker ;
2. ignorer toute ancienne proposition Granite et lancer un nouveau classement ;
3. vérifier que Friday reste utilisable pendant le job et que `Arrêter` ne laisse aucun résultat partiel ;
4. relancer, corriger au moins un rayon puis appliquer ;
5. vérifier la présentation unique par rayon, sans sélecteur `Liste`/`Rayons` ;
6. fermer puis rouvrir la PWA et contrôler que le résultat partagé est retrouvé ;
7. couper le réseau et vérifier que la dernière présentation synchronisée reste lisible.

La procédure détaillée reste [la recette de classement Galaxy A17](recipes/galaxy-a17-lot-1a-grocery-classification.md). Ne déclarer ce checkpoint validé qu'après retour explicite de l'utilisateur.

## Étape 2 — Conflits explicites et tombstones : report assumé

L'[ADR-011](adr/011-conflits-et-cycle-de-vie-des-tombstones.md) est accepté comme filet de sécurité, mais son implémentation est reportée jusqu'à ce que l'usage réel à deux produise un conflit ou qu'un volume notable de tombstones justifie une purge. Les éditeurs locaux nécessaires sont construits et les suppressions restent conservées : aucune purge physique n'est activée en attendant.

### Conflits visibles

- détecter une mutation dont `baseRevision` ne correspond plus à la révision canonique ;
- conserver la version locale en conflit au lieu de l'écraser silencieusement ;
- afficher le conflit uniquement lorsqu'il existe, avec la version de l'appareil et celle du foyer ;
- permettre de garder la version du foyer ou de republier la version locale sur la révision canonique courante ;
- faire passer la résolution par la même voie locale/outbox et la rendre idempotente ;
- appliquer le même mécanisme aux tâches et aux courses, sans mélanger leurs interfaces métier.

### Cycle de vie des suppressions

Le défaut conservateur à formaliser dans l'ADR-011 est :

- un tombstone empêche toujours la résurrection d'un objet supprimé par un appareil en retard ;
- il n'est éligible à la purge qu'après 90 jours ;
- la purge exige aussi que chaque appareil actif et non révoqué ait dépassé le changement correspondant ;
- un appareil révoqué ou un compte oublié ne bloque plus la purge ;
- aucune purge n'est lancée si le suivi des curseurs par appareil n'est pas démontré ;
- la purge est transactionnelle, journalisée et testée sur une copie de base avant activation périodique.

### Preuves attendues

- deux profils modifient le même objet pendant une coupure : aucune version ne disparaît ;
- les deux choix de résolution convergent sans doublon après reconnexion ;
- une suppression concurrente ne ressuscite pas l'objet ;
- un appareil en retard reçoit encore le tombstone ;
- un tombstone récent ou non acquitté n'est jamais purgé ;
- migration SQLite N-1, tests unitaires/intégration et scénario Chrome mobile réussissent ;
- `pnpm verify` réussit avant redéploiement.

## Étape 3 — Checkpoint court sur appareils réels

Avant de choisir le prochain lot fonctionnel, rejouer ou terminer :

- [authentification et appairage](recipes/galaxy-a17-lot-1a-auth.md) ;
- [courses partagées](recipes/galaxy-a17-lot-1a-groceries.md) ;
- classement des courses ;
- checkpoints courts du tri, des responsables, des réglages et de la récurrence/note ;
- contrôle de confiance : redémarrage complet hors réseau, retour en ligne, attente à zéro et absence de doublon.

L'avertissement de certificat du RG405M et l'essai iPhone reporté ne constituent pas une preuve d'appairage. La résolution avancée des conflits est une dette consciente, documentée et déclenchée par l'usage. La validation familiale complète demande encore une recette réelle à deux appareils ; elle ne peut pas être déduite des tests Chrome automatisés.

## Étape 4 — Prochain lot à discuter

Ordre recommandé, à confirmer avec l'utilisateur avant toute implantation :

1. faire une recette courte de l'éditeur sur A17 et, lorsque possible, appairer l'iPhone ;
2. discuter puis cadrer le budget partagé : catégories, revenus, dépenses, objectif et versement réel d'épargne ;
3. si le budget est retenu, construire d'abord ses calculs et fixtures déterministes, puis une dépense offline ;
4. discuter ensuite Google Calendar Maison en lecture seule avec cache offline ;
5. ne commencer la veille ou l'assistant qu'après ces choix et leurs preuves.

Les alternatives à discuter sont donc : `budget d'abord` — recommandation actuelle conforme à la feuille de route —, `Calendar en lecture d'abord` si l'agenda externe est le besoin familial prioritaire, ou `courte période d'usage Maison` avant d'élargir le périmètre.

## Ordre exécutable résumé

1. recette A17 du nouveau classement, dès que possible ;
2. éditeurs locaux et ADR-011 conflits/tombstones — réalisés ;
3. observer les conflits et le volume des tombstones, sans purge automatique ;
4. recette courte A17/iPhone lorsque l'appareil est disponible ;
5. discuter le choix entre budget, Calendar en lecture ou période d'usage Maison ;
6. après décision, documenter la cutline du lot choisi avant de coder.

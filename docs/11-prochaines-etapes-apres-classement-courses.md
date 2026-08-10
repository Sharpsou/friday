# Prochaines étapes après le classement des courses

Date : 9 août 2026

Statut : plan de suivi actif pour reprendre sans nouvel audit général

## Point de départ vérifié

Le candidat Lot 1A couvre les tâches planifiées et récurrentes, l'authentification fermée, les courses partagées offline-first, leur classement facultatif par rayon et leur édition locale. Le bouton `En course` ajoute une vue magasin plein écran limitée aux rayons, aux produits restants, à la progression et aux grandes cibles cochables ; elle utilise le cache local et reste utilisable hors ligne.

Le protocole Ollama relie chaque entrée et chaque réponse par un index vérifié. Ministral 3 8B ne traite que les libellés inconnus après les corrections du foyer et les règles déterministes. Le job est persistant, visible, arrêtable et n'applique jamais un résultat partiel.

La mise à jour PWA n'utilise plus un événement ponctuel susceptible d'être perdu. Son état est conservé et la recherche est relancée au démarrage, au retour au premier plan, au retour réseau et au clic sur `Connecté` ou `Hors ligne`. Le rechargement reste soumis au bouton `Mettre à jour` afin de ne pas interrompre une saisie.

Le dernier `pnpm verify` réussit avec 85 tests unitaires/intégration, le build PWA/hub et 20 scénarios Chrome mobile. Le candidat a été reconstruit et redémarré sur `https://192.168.1.14:8443` ; le healthcheck HTTPS répond correctement.

## État Git à préserver

Le lot publié à préserver comprend :

- mode `En course`, styles, test Chrome mobile et documentation associée ;
- détection persistante des mises à jour PWA, contrôles explicites et tests unitaires ;
- recette iPhone de mise à jour.

Un nouveau chat doit commencer par `git status -sb` et `git log -5 --oneline`, conserver ces fonctions et ne pas réimplémenter le lot.

## Étape 1 — Checkpoint court Galaxy A17

Ce checkpoint ne bloque pas la discussion du lot suivant :

1. recevoir la nouvelle version et vérifier le libellé `Mettre à jour` ;
2. lancer un classement, vérifier que Friday reste utilisable puis tester `Arrêter` ;
3. appliquer un classement corrigé et vérifier la présentation unique par rayon ;
4. ouvrir `En course`, cocher plusieurs produits puis sortir du mode ;
5. recommencer hors réseau et vérifier que les coches restent en attente ;
6. rétablir le hub, toucher l'état de connexion et vérifier l'attente à zéro sans doublon.

Les détails sont dans [la recette courses](recipes/galaxy-a17-lot-1a-groceries.md) et [la recette de classement](recipes/galaxy-a17-lot-1a-grocery-classification.md). Ne déclarer aucun comportement A17 validé sans retour physique explicite.

## Étape 2 — iPhone différé sans bloquer la suite

L'utilisateur a confirmé le 9 août 2026 que l'iPhone avait bien reçu une mise à jour PWA, sans consigner le déclencheur exact. Il attend le retour de sa compagne pour reprendre l'appairage et les parcours offline. Aucune action physique n'est demandée avant cela et ce délai ne doit pas suspendre le travail automatisé.

Lorsque l'appareil est disponible :

1. vérifier la confiance complète du certificat et l'origine exacte ;
2. s'assurer que toute attente locale est à zéro avant une éventuelle réinstallation ;
3. suivre [la recette de mise à jour iPhone](recipes/iphone-pwa-update.md) ;
4. appairer le second adulte ;
5. rejouer création, modification, suppression et courses hors ligne ;
6. vérifier la convergence sur les deux profils sans doublon.

La réception d'une mise à jour est validée ponctuellement. Elle ne valide pas l'appairage, le cache après redémarrage hors réseau ni la convergence à deux appareils ; seul ce retour physique permettra de fermer le checkpoint iPhone complet.

## Étape 3 — Conflits et tombstones en observation

L'[ADR-011](adr/011-conflits-et-cycle-de-vie-des-tombstones.md) est rédigée et acceptée comme filet de sécurité. L'utilisateur a choisi de reporter la résolution avancée des conflits et la purge jusqu'à un signal d'usage réel.

En attendant :

- conserver les tombstones sans purge physique ;
- surveiller pertes, résurrections, doublons et conflits pendant l'usage à deux ;
- ne pas construire d'interface de résolution sans conflit constaté ;
- ne pas activer de purge sans preuve de curseurs acquittés par chaque appareil actif.

Un conflit réel ou un volume notable de suppressions déclenchera une réévaluation de l'ADR-011, pas une implantation préventive silencieuse.

## Étape 4 — Prochain lot fonctionnel à décider

Le prochain choix produit doit être confirmé avec l'utilisateur avant implantation :

1. **budget partagé — recommandation actuelle** : cadrer catégories, revenus, dépenses, objectif et versement réel d'épargne, puis construire les calculs et fixtures avant l'interface ;
2. **Google Calendar Maison en lecture** : à choisir d'abord si la visibilité de l'agenda externe devient prioritaire ;
3. **courte période d'usage Maison** : continuer tâches et courses sans élargir immédiatement le périmètre.

La veille et l'assistant ne commencent pas avant ce choix et les preuves du lot retenu. Le budget ne doit pas être codé depuis les anciens documents ou classeurs : sa cutline et ses formules doivent d'abord être confirmées.

La [sauvegarde portable chiffrée](adr/008-sauvegarde-portable-chiffree.md) est maintenant conçue mais reste au Lot 3. Son implantation commencera par les scripts de snapshot/restauration et une restauration sur hub vide, avant l'interface de partage/import. Elle ne devient prioritaire plus tôt que si des données familiales réelles rendent l'absence de backup inacceptable.

## Ordre exécutable résumé

1. effectuer la recette courte A17 dès que pratique ;
2. décider entre budget, Calendar ou observation Maison ;
3. documenter la cutline du choix avant de coder ;
4. reprendre l'iPhone au retour de la compagne, sans bloquer les étapes 1 à 3 ;
5. laisser conflits et tombstones en observation jusqu'à un signal réel ;
6. pour chaque évolution : tests ciblés, `pnpm verify`, redémarrage du runtime sans navigateur, puis documentation de la preuve.

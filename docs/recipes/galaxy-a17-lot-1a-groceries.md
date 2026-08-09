# Recette Lot 1A — courses partagées

- Statut : **candidat automatisé validé — recette physique à réaliser**
- Appareil principal : Samsung Galaxy A17
- Second appareil : navigateur ou téléphone appairé après validation de la recette auth
- Exigences : `FR-HOME-01`, `NFR-OFF-02`, `NFR-SYNC-01`
- Objectif : vérifier qu'une course reste disponible et modifiable hors ligne, puis converge sans doublon entre les deux adultes.

## Prérequis

1. Lancer le candidat avec `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.
2. Ouvrir Friday sur l'A17 avec la session propriétaire déjà initialisée.
3. Ne pas utiliser de données personnelles tant que l'appairage et la révocation d'un second appareil ne sont pas confirmés.

## Parcours court sur l'A17

1. Ouvrir directement l'onglet principal `Courses`.
2. Ajouter `Lait` avec la quantité facultative `2 bouteilles` : le produit doit apparaître immédiatement dans `À acheter`, puis passer à `Synchronisée avec le foyer`.
3. Revenir dans `Aujourd'hui` : le bloc `Courses` doit annoncer un produit à acheter et afficher `Lait`. Le bouton `Voir la liste` doit rouvrir directement l'onglet `Courses`.
4. Arrêter le hub ou couper le Wi-Fi, puis ajouter `Pain` sans quantité. Il doit rester visible avec l'état `À synchroniser`.
5. Toujours hors ligne, marquer `Lait` comme acheté : il doit passer dans `Déjà acheté` sans disparaître.
6. Fermer de force puis rouvrir Friday hors ligne : `Pain`, `Lait`, leur quantité et leurs sections doivent être conservés.
7. Rétablir le hub et le réseau : l'attente doit revenir à zéro, sans doublon.
8. Passer en mode `Modifier`, couper à nouveau le réseau et supprimer `Pain`. Après rechargement puis reconnexion, il doit rester absent.
9. Avec plusieurs produits restants, appuyer sur `En course` : l'en-tête, les réglages, la navigation et les formulaires doivent disparaître au profit de la seule liste regroupée par rayon.
10. Toujours hors ligne, toucher un produit dans ce mode : il doit disparaître immédiatement, la progression doit avancer et le dernier produit doit afficher `Courses terminées`.
11. Appuyer sur `Revenir à Friday` ou `Quitter` : la liste complète doit retrouver les produits cochés dans `Déjà acheté`, puis les synchroniser au retour du réseau.

## Partage sur le second appareil

Ce parcours se joue seulement après l'appairage réussi de `galaxy-a17-lot-1a-auth.md`.

1. Ouvrir l'onglet `Courses` sur le second appareil : `Lait` doit être visible dans `Déjà acheté` et `Pain` doit rester absent.
2. Remettre `Lait` dans `À acheter` depuis le second appareil.
3. Relancer la synchronisation sur l'A17 : une seule occurrence de `Lait` doit revenir dans `À acheter`.

## Preuves automatisées du candidat

- contrat Zod commun pour le produit et son opération de synchronisation ;
- migrations SQLite 5 et Dexie 2 testées ;
- repository local : création chiffrée, achat/réouverture ordonnés, suppression par tombstone, accusé serveur et pull distant ;
- hub : journal partagé, idempotence, révision et propagation d'une course authentifiée ;
- Chrome mobile : ajout avec quantité, résumé `Aujourd'hui`, achat hors ligne, rechargement et convergence ;
- Chrome mobile : mode magasin isolé, rayons conservés, grandes cases cochables, progression et sortie hors ligne ;
- commande de contrôle finale : `pnpm verify` avec 80 tests unitaires/intégration et 20 scénarios Chrome mobile.

## Résultat à consigner

- date et heure de la recette ;
- navigateur et version ;
- ajout et résumé `Aujourd'hui` : oui/non ;
- conservation après fermeture forcée hors ligne : oui/non ;
- convergence sans doublon : oui/non ;
- suppression offline persistante : oui/non ;
- partage et modification depuis le second appareil : oui/non/non testé ;
- anomalie visuelle ou fonctionnelle observée.

Ne pas déclarer le comportement A17, RG405M ou iPhone validé avant le retour physique correspondant.

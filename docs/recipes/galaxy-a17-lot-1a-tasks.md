# Recette Lot 1A — terminer et rouvrir une tâche

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-02`, `NFR-OFF-02`, `NFR-SYNC-01`, `NFR-SYNC-02`
- Objectif : vérifier que terminer et rouvrir utilisent la voie locale/outbox en ligne comme hors ligne, persistent après fermeture et convergent sans doublon.

## Préparation

Reconstruire et redémarrer le runtime sans ouvrir Chrome sur le PC :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Ouvrir ensuite Friday depuis l’icône installée sur l’A17 et attendre l’état `Connecté`.

## Parcours court

| Étape | Action                                                          | Résultat attendu                                                               | Résultat/date |
| ----: | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------- |
|     1 | créer une tâche de recette et attendre la synchronisation       | la tâche apparaît dans `Tâches en cours` avec `Synchronisée avec le foyer`     |               |
|     2 | arrêter uniquement le service Friday depuis le raccourci Bureau | Friday finit par afficher `Hors ligne`                                         |               |
|     3 | toucher `Terminer` sur la tâche                                 | la tâche passe immédiatement dans `Tâches terminées` avec `À synchroniser`     |               |
|     4 | fermer de force Friday puis la rouvrir                          | la tâche reste dans `Tâches terminées` et l’attente est conservée              |               |
|     5 | toucher `Rouvrir` sans relancer le hub                          | la tâche revient dans `Tâches en cours` et deux modifications sont en attente  |               |
|     6 | lancer Friday avec le raccourci `Friday - Lancer ou redemarrer` | l’attente revient à zéro, la tâche reste active et une seule occurrence existe |               |
|     7 | toucher `Terminer` avec l’état `Connecté`                       | la tâche rejoint `Tâches terminées` puis affiche `Synchronisée avec le foyer`  |               |

Noter toute action ambiguë, cible tactile difficile ou tâche visible dans les deux sections. Ne pas déclarer le comportement A17 validé avant d’avoir rempli cette matrice.

## Preuves automatisées du candidat

- repository local : terminer puis rouvrir écrit le payload chiffré et l’opération d’outbox dans la même transaction ;
- hub : les renvois des opérations terminer/rouvrir restent idempotents et ne créent que trois changements canoniques pour le cycle création → terminé → rouvert ;
- Chrome mobile : terminer/rouvrir en ligne, refaire les deux actions hors ligne, recharger entre les étapes puis reconnecter conserve une seule tâche ;
- commande de contrôle finale : `pnpm verify`.

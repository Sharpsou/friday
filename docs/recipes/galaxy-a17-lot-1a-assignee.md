# Recette Lot 1A — responsable et filtre

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-01`, `NFR-OFF-02`, `NFR-SYNC-01`, `NFR-SYNC-02`
- Objectif : vérifier qu'un responsable facultatif persiste hors ligne et que le filtre s'applique de façon cohérente aux vues liste, semaine et mois.

## Préparation

Le runtime doit avoir été reconstruit et redémarré sur le PC avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Ouvrir Friday depuis l'icône installée sur l'A17 et attendre l'état `Connecté`.

## Parcours court

| Étape | Action                                                                      | Résultat attendu                                                                    | Résultat/date |
| ----: | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
|     1 | créer une tâche datée avec le responsable `Moi`                             | la tâche affiche `Moi` et finit par afficher `Synchronisée avec le foyer`           |               |
|     2 | choisir `Moi` dans le filtre discret                                        | seules les tâches attribuées à `Moi` restent visibles                               |               |
|     3 | passer de `Liste` à `Semaine`, puis `Mois`                                  | le même filtre reste actif et la tâche apparaît au bon jour                         |               |
|     4 | arrêter uniquement le service Friday depuis le raccourci Bureau             | Friday finit par afficher `Hors ligne`                                              |               |
|     5 | créer une tâche datée avec `Autre adulte`                                   | la tâche apparaît immédiatement avec `Autre adulte` et `À synchroniser`             |               |
|     6 | fermer de force Friday, rouvrir l'application et filtrer sur `Autre adulte` | la tâche et son responsable sont conservés hors ligne                               |               |
|     7 | relancer Friday depuis le raccourci Bureau                                  | l'attente revient à zéro, le responsable reste inchangé et aucun doublon n'apparaît |               |

Les libellés `Moi` et `Autre adulte` sont les valeurs par défaut. Ils peuvent maintenant être renommés localement depuis la roue dentée, sans changer les identifiants pilotes, jusqu'à l'authentification et l'appairage des deux profils. Compléter ensuite la recette [`galaxy-a17-lot-1a-settings.md`](galaxy-a17-lot-1a-settings.md). Ne pas utiliser de données réelles avant ce lot.

## Preuves automatisées du candidat

- fonctions pures : identifiants pilotes stables, libellés et filtrage ;
- repository local : responsable chiffré dans la tâche et l'opération d'outbox ;
- Chrome mobile : création attribuée hors ligne, filtre liste/mois, rechargement puis convergence ;
- commande de contrôle finale : `pnpm verify`.

# Recette Lot 1A — date, heure et durée

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-01`, `NFR-OFF-02`, `NFR-SYNC-01`, `NFR-SYNC-02`
- Objectif : vérifier qu'une tâche peut rester sans date, avoir une date seule ou devenir un rendez-vous avec heure et durée, puis être consultée en liste, semaine ou mois, en ligne comme hors ligne.

## Préparation

Le runtime doit avoir été reconstruit et redémarré sur le PC avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Ouvrir Friday depuis l'icône installée sur l'A17 et attendre l'état `Connecté`.

## Parcours court

| Étape | Action                                                               | Résultat attendu                                                                                             | Résultat/date |
| ----: | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
|     1 | dans `Maison`, créer une tâche avec son titre seulement              | la tâche apparaît sans date et finit par afficher `Synchronisée avec le foyer`                               |               |
|     2 | ouvrir `Date et rendez-vous`, saisir un titre et une date sans heure | la tâche affiche la date en toutes lettres, sans heure ni durée                                              |               |
|     3 | toucher successivement `Semaine` puis `Mois`                         | la tâche datée apparaît au bon jour ; la semaine et le mois restent lisibles sans défilement horizontal      |               |
|     4 | sélectionner un jour libre puis toucher `+ Ajouter pour ce jour`     | Friday revient à `Liste`, ouvre les options et préremplit la date choisie                                    |               |
|     5 | arrêter uniquement le service Friday depuis le raccourci Bureau      | Friday finit par afficher `Hors ligne`                                                                       |               |
|     6 | créer un rendez-vous avec une date, `14:30` et `45 min`              | la tâche apparaît immédiatement avec `date à 14:30 · 45 min` et `À synchroniser`                             |               |
|     7 | fermer de force Friday puis la rouvrir                               | le rendez-vous et ses trois informations sont toujours visibles hors ligne                                   |               |
|     8 | lancer Friday avec le raccourci `Friday - Lancer ou redemarrer`      | l'attente revient à zéro, le rendez-vous affiche `Synchronisée avec le foyer` et une seule occurrence existe |               |

Noter toute cible tactile difficile, date décalée d'un jour, valeur perdue après fermeture ou doublon. Ne pas déclarer le comportement A17 validé avant d'avoir rempli cette matrice.

## Preuves automatisées du candidat

- contrats : rétrocompatibilité des anciennes tâches et validation des dépendances heure → date et durée → heure ;
- migration hub : ajout des colonnes heure/durée sans perte d'une tâche existante ;
- repository local : date seule et rendez-vous sont chiffrés puis ajoutés à l'outbox dans la transaction locale ;
- Chrome mobile : création d'une échéance en ligne, puis d'un rendez-vous hors ligne, rechargement et convergence sans doublon ;
- calendrier mobile : navigation liste/semaine/mois, tâche au bon jour et retour vers l'ajout avec date préremplie ;
- commande de contrôle finale : `pnpm verify`.

# Recette Lot 1A — réglages locaux

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-01`, `UX-03`, préférence UI locale définie en section 6.5 du document 10
- Objectif : vérifier que les noms des deux responsables et la palette choisie restent disponibles sur cet appareil, y compris sans hub.

## Préparation

Le runtime doit avoir été reconstruit et redémarré sur le PC avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Ouvrir Friday depuis l'icône installée sur l'A17.

## Parcours court

| Étape | Action                                                                         | Résultat attendu                                                                                           | Résultat/date |
| ----: | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------- |
|     1 | toucher la roue dentée en haut à droite                                        | le panneau `Réglages` s'ouvre sans masquer d'option                                                        |               |
|     2 | remplacer les deux noms par les prénoms souhaités et choisir une autre palette | les quatre palettes `Menthe`, `Océan`, `Lavande` et `Ambre` restent lisibles et sélectionnables            |               |
|     3 | toucher `Enregistrer`                                                          | la nouvelle palette est appliquée ; les nouveaux noms apparaissent dans la saisie et le filtre responsable |               |
|     4 | créer une tâche attribuée au premier responsable                               | la tâche affiche le nouveau nom, sans modifier son comportement de synchronisation                         |               |
|     5 | arrêter uniquement le service Friday, puis fermer de force et rouvrir la PWA   | la palette et les deux noms sont conservés alors que Friday affiche `Hors ligne`                           |               |
|     6 | rouvrir les réglages, toucher `Annuler`, puis les rouvrir                      | aucun changement non enregistré n'a remplacé les préférences existantes                                    |               |

Ces réglages sont locaux à l'appareil dans ce lot. Les deux emplacements correspondent aux deux futurs profils appairés : renommer un responsable change son libellé, jamais l'identifiant déjà porté par les tâches.

## Preuves automatisées du candidat

- fonctions et repository local : valeurs par défaut sûres, nettoyage et persistance IndexedDB ;
- React : options de saisie, filtre, liste et agenda utilisent les mêmes noms ;
- Chrome mobile : renommage, sélection de palette, création attribuée et persistance après rechargement ;
- inspection visuelle 412 × 915 : panneau entièrement visible et aucune erreur console ;
- commande de contrôle finale : `pnpm verify`.

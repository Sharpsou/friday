# Exploiter le classement des courses

Ce runbook couvre le classement facultatif par rayon. Il ne remplace pas la recette physique [Galaxy A17](../recipes/galaxy-a17-lot-1a-grocery-classification.md).

## Fonctionnement attendu

`Classer par rayon` lance un job persistant sur le hub pour les seuls produits qui n'ont pas encore de rayon. L'indicateur global permet de naviguer ailleurs et de demander l'arrêt. Quand le job termine, l'utilisateur corrige éventuellement l'aperçu puis l'applique, ou choisit `Conserver le classement actuel` pour l'ignorer. Tant qu'il n'a pas confirmé, aucune classification ne modifie la liste.

La PWA peut être fermée pendant le traitement. Le hub poursuit le job, et la PWA retrouve son état après réouverture. La liste n'a pas de sous-onglet d'affichage : elle regroupe directement les produits classés et place les autres dans `À classer`. Après synchronisation, cette présentation reste lisible hors ligne.

## Prérequis et configuration

Vérifier qu'Ollama répond localement et que le modèle souhaité est installé :

```powershell
ollama list
```

Valeurs par défaut :

```text
FRIDAY_OLLAMA_URL=http://127.0.0.1:11434
FRIDAY_GROCERY_CLASSIFICATION_MODEL=ministral-3:8b
FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS=120000
```

Ces variables sont facultatives. Le délai vaut 120 secondes par défaut ; l'arrêt demandé par l'utilisateur interrompt toujours l'appel en cours. Friday ne télécharge jamais de modèle. Ne pas exposer Ollama sur le LAN : seul le hub l'appelle.

Après une modification du runtime, reconstruire et redémarrer sans ouvrir le navigateur :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

## Parcours opérateur

1. Ajouter ou conserver des produits non achetés dans `Courses`.
2. Appuyer sur `Classer par rayon`.
3. Vérifier que l'indicateur `Classement en arrière-plan · x/y` reste visible en changeant d'onglet.
4. À la fin, ouvrir l'aperçu, qui ne contient que les nouveaux produits sans rayon.
5. Corriger les erreurs puis appliquer, ou choisir `Conserver le classement actuel` pour ne rien modifier.
6. Contrôler le regroupement direct par rayon et la section `À classer` s'il reste des produits sans classification.

Une correction est partagée entre les profils et réutilisée pour le même libellé normalisé lors des prochains classements.

## Arrêt et reprise

- `Arrêter` peut afficher brièvement `cancelling` pendant l'interruption de l'appel Ollama.
- Un job annulé ne produit aucune proposition partielle et peut être relancé.
- Après un arrêt brutal du hub, un job qui était en cours repart depuis sa file persistante au redémarrage.
- La fermeture de la PWA n'annule pas le travail du hub.
- Une proposition terminée doit être appliquée dans les 24 heures ; après expiration, relancer le classement.

## Diagnostic

Commencer par le healthcheck et les logs du hub. Vérifier ensuite Ollama :

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Pour mesurer le pipeline sur le corpus local de 150 libellés :

```powershell
pnpm --filter @friday/hub eval:grocery-classification
```

Cette commande appelle réellement Ollama pour les libellés non couverts par les règles. Elle est facultative et n'appartient pas à `pnpm verify` afin de garder les tests reproductibles sans modèle local.

Les données utiles se trouvent dans le fichier SQLite du répertoire `FRIDAY_DATA_DIR`, dans les tables suivantes :

| Table                               | Rôle                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `grocery_classification_jobs`       | état, progression, snapshot, proposition et réponse appliquée |
| `grocery_classifications`           | classification commune courante de chaque article             |
| `grocery_classification_rules`      | corrections exactes apprises par foyer et taxonomie           |
| `grocery_classification_change_log` | changements incrémentaux synchronisés vers les appareils      |

Ne pas éditer ces tables à la main sur une base réelle. Conserver une copie cohérente de la base avant toute investigation intrusive.

## Incidents courants

| Symptôme                                     | Cause probable                                                    | Action                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Le job finit en erreur                       | Ollama arrêté, modèle absent, délai dépassé ou réponse invalide   | Démarrer Ollama, vérifier `ollama list`, puis relancer le classement. Les courses restent utilisables. |
| Le compteur reste en attente après fermeture | la PWA n'a pas encore retrouvé le job ou le hub est hors ligne    | Revenir en ligne et rouvrir Friday ; ne pas recréer plusieurs fois le job.                             |
| Un article manque dans le résultat appliqué  | il a été acheté, supprimé, renommé ou modifié après le snapshot   | Relancer le classement sur l'état courant.                                                             |
| Une ancienne correction ne s'applique pas    | le libellé normalisé diffère ou la taxonomie a changé             | Corriger l'aperçu actuel ; une nouvelle règle exacte sera enregistrée.                                 |
| Aucun produit n'est proposé                  | tous les produits non achetés ont déjà un rayon                   | Aucun reclassement n'est nécessaire ; les rayons actuels sont conservés.                               |
| La vue hors ligne n'est pas à jour           | les classifications n'ont pas encore été tirées vers cet appareil | Reconnecter l'appareil et attendre la synchronisation avant de retester hors ligne.                    |
| `À classer` apparaît                         | aucune règle fiable ou confiance du modèle inférieure à `0,65`    | Choisir manuellement la famille et le rayon dans l'aperçu.                                             |

## Limites à ne pas surinterpréter

- L'ordre est générique et ne connaît pas le plan physique d'un magasin.
- La réussite automatisée ne constitue pas une validation sur Galaxy A17 ou iPhone.
- Le classement n'est pas une écriture offline : sa consultation mise en cache l'est, mais démarrage, arrêt et confirmation exigent le hub.
- Une panne d'Ollama ne doit jamais empêcher d'ajouter, cocher, rouvrir, supprimer ou synchroniser une course.

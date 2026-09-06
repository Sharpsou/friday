# Runbook — reprise initiale du budget

Statut documentaire : actif.

Ce runbook traite des données financières réelles. Ne jamais copier les classeurs ni le JSON normalisé dans le dépôt, Drive ou les logs.

## Porte de sécurité obligatoire

Exécuter les contrôles dans une console PowerShell administrateur :

1. confirmer que le volume de `D:\FridayData` est protégé et déverrouillé par BitLocker ;
2. créer `D:\FridayData` si nécessaire ;
3. désactiver l'héritage ACL et n'accorder l'accès qu'au compte Windows qui exécute Friday, à `SYSTEM` et au groupe local `Administrateurs` ;
4. relire les ACL effectives ; arrêter au moindre principal supplémentaire ;
5. disposer d'un snapshot SQLite cohérent et d'une restauration de contrôle prouvée, avec secret/configuration protégés. Ne pas copier un WAL actif. La sauvegarde portable produit n'est pas encore implantée : une simple référence à son runbook cible ne ferme pas cette porte.

La situation observée le 9 août 2026 ne passe pas cette porte : l'état BitLocker demande une élévation et `D:\FridayData` hérite notamment d'un droit de modification pour `Authenticated Users`. Aucun seed réel ne doit être lancé avant correction et nouvelle vérification.

## Normalisation ponctuelle

- Lire les quatre sections du classeur simple récent : revenus, frais fixes, prévisionnel, occasionnels.
- Lire seulement `Enveloppes!A1:Q13` du classeur familial ancien.
- Donner la priorité au classeur récent lors d'un chevauchement.
- Convertir les euros en centimes entiers positifs ; conserver le type séparément.
- Importer montant nul ou « à confirmer » en modèle inactif/brouillon.
- Normaliser les noms (`trim`, espaces uniques, minuscules françaises) et les rapprocher des deux profils Friday. Arrêter si zéro ou plusieurs profils correspondent.
- Produire `D:\FridayData\budget-seed-v1.json` conforme à `BudgetSeedSchema`. Les identifiants dérivent de la version, de la section et de la clé métier stable.
- Calculer le SHA-256 des deux sources et enregistrer leur digest combiné dans `sourceDigest`.

## Contrôle et application

Avant application, calculer uniquement : nombre de lignes et somme en centimes pour chaque section. Ne jamais journaliser les libellés.

Depuis la racine Friday, hub arrêté :

```powershell
pnpm --filter @friday/hub seed:budget D:\FridayData\budget-seed-v1.json D:\FridayData\friday.sqlite
```

Le résultat `applied: true` doit contenir les mêmes comptes et totaux que le rapprochement. Relancer exactement la même commande : elle doit retourner `applied: false` et ne créer aucun changement supplémentaire. En cas d'écart, restaurer la sauvegarde avant toute nouvelle tentative.

Après validation, redémarrer Friday, synchroniser un appareil de recette et vérifier les synthèses sans citer de donnée personnelle dans le compte rendu.

## Maintenance du 6 septembre 2026

Les formulaires sont séparés dans `web/src/budget/`, et `budget-view-model.ts`
compose les calculs de présentation auparavant inclus dans `BudgetView.tsx`.
Les montants restent en centimes ; règles de récurrence et de clôture inchangées.
Budget est chargé à la demande et précaché par la PWA pour l'usage offline.

Voir le [bilan de modularisation](../audits/2026-09-06-implementation-qualite-et-modularisation.md).

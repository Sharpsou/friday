# Modèle de données

> **Note de mise à jour — 8 août 2026 :** ce modèle initial est volontairement plus riche que le MVP retenu. La matrice `VisibilityRule`, les catégories de tâches et l'agenda interne ne doivent pas guider le lot 0. Le modèle de synchronisation PWA actif est décrit dans [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md).

## Principes

- UUID ou identifiant incluant l'origine appareil ;
- toutes les entités synchronisées portent `householdId`, `revision`, `createdAt`, `updatedAt`, `deletedAt`, `createdByProfileId` et `deviceId` ;
- suppression logique avant purge ;
- montant monétaire stocké en centimes entiers, jamais en flottant ;
- devise explicite, `EUR` par défaut ;
- date/heure stockée en UTC avec fuseau métier lorsque nécessaire ;
- résultats calculés reconstruisibles à partir des données sources ;
- sortie LLM conservée comme proposition ou résumé, jamais comme vérité comptable.

## Entités Home Mind reprises

| Entité | Usage Friday | Évolution |
|---|---|---|
| `Household` | foyer et paramètres communs | ajouter version de contrats et options hub |
| `Profile` | personne concernée ou utilisatrice | ajouter préférences briefing/veille |
| `Access` | droits de l'utilisateur | lier appareil et scopes |
| `VisibilityRule` | foyer, privé ou profils choisis | appliquer à tous les nouveaux domaines |
| `HouseholdAction` | tâche, événement, rappel, routine | conserver le noyau générique |
| `ActionPersonLink` | responsable, concerné, participant | rendre responsable explicite dans l'UI |
| `Schedule` | début, échéance, fin, flexibilité | base de l'agenda interne |
| `Reminder` | notification locale | conserver |
| `GroceryList` | liste de courses | une liste foyer par défaut |
| `GroceryItem` | produit et état | ajouter ordre local optionnel |
| `CaptureNote` | saisie brute et À préciser | ajouter état de traitement IA |
| `HouseholdResource` | équipement, logement, véhicule | utile après MVP pour entretien |

## Récurrence

`RecurrenceRule` entre dans le MVP car les tâches domestiques sont répétitives.

| Champ | Type | Règle |
|---|---|---|
| `id` | identifiant | stable |
| `actionId` | identifiant | action modèle |
| `frequency` | enum | daily, weekly, monthly |
| `interval` | entier | 1 par défaut |
| `weekdays` | liste | vide sauf hebdomadaire |
| `dayOfMonth` | entier nullable | mensuel |
| `startsAt` | date | obligatoire |
| `endsAt` | date nullable | optionnel |
| `nextOccurrenceAt` | date | calculée et persistée pour planification |
| `timezone` | texte | fuseau du foyer |

Une occurrence terminée ne modifie pas rétroactivement les autres. Le moteur crée des occurrences datées avec une clé idempotente.

## Budget

### `FinancialAccount`

Représente une vue logique, pas une connexion bancaire.

- `name` ;
- `ownerProfileId` nullable pour un compte foyer ;
- `kind` : current, savings, cash, debt, virtual ;
- `currency` ;
- `openingBalanceCents` optionnel ;
- `visibilityRuleId` ;
- `isActive`.

### `BudgetCategory`

- `name` ;
- `parentId` nullable ;
- `kind` : income, essential, adjustable, savings, transfer ;
- `color` optionnelle ;
- `isArchived`.

Une catégorie classe. Elle ne contient pas de formule.

### `RecurringEntry`

- `direction` : income ou expense ;
- `label` ;
- `amountCents` ;
- `categoryId` ;
- `accountId` ;
- `ownerProfileId` nullable ;
- `frequency` : monthly, quarterly, yearly ;
- `dayOfMonth` ou date d'échéance ;
- `startsAt`, `endsAt` ;
- `status` : active, paused, ended, toConfirm ;
- `essentiality` : essential, adjustable, savings ;
- `notes` ;
- `visibilityRuleId`.

### `Transaction`

- `occurredAt` ;
- `direction` : income, expense, transfer ;
- `amountCents` positif ;
- `currency` ;
- `accountId` ;
- `destinationAccountId` pour transfert ;
- `categoryId` ;
- `label` ;
- `ownerProfileId` nullable ;
- `envelopeId` nullable ;
- `plannedExpenseId` nullable ;
- `status` : pending, posted, cancelled ;
- `source` : manual, csvImport, generatedRecurring ;
- `visibilityRuleId`.

Les transactions sont append-only dans le journal de synchro. Une correction crée une version de remplacement ou une contre-écriture explicite.

### `Envelope`

- `name` ;
- `categoryIds` ;
- `monthlyLimitCents` ;
- `rolloverPolicy` : reset, carryPositive, carryAll ;
- `ownerProfileId` nullable ;
- `visibilityRuleId` ;
- `isActive`.

Le consommé est calculé depuis les transactions du mois.

### `PlannedExpense`

- `label` ;
- `amountCents` nullable tant qu'il est à chiffrer ;
- `expectedAt` nullable ;
- `categoryId` ;
- `priority` ;
- `status` : toEstimate, planned, confirmed, paid, cancelled ;
- `ownerProfileId` nullable ;
- `linkedActionId` nullable ;
- `linkedTransactionId` nullable ;
- `notes` ;
- `visibilityRuleId`.

### `SavingsGoal`

- `name` ;
- `targetCents` ;
- `currentCents` ou compte de référence ;
- `targetAt` nullable ;
- `kind` : emergencyFund, project, debt, other ;
- `ownerProfileId` nullable ;
- `visibilityRuleId`.

### Calculs non persistés

- revenus actifs du mois ;
- charges fixes actives ;
- reste après fixes ;
- dépenses variables ;
- reste à vivre ;
- consommé et disponible par enveloppe ;
- réserve et écart à la cible ;
- dépenses prévues à 30, 60 et 90 jours ;
- postes à chiffrer ;
- évolution réel contre prévisionnel.

Chaque calcul dispose d'une fonction pure testée et d'une définition visible dans l'interface.

## Veille

### `WatchSubscription`

- `profileId` ;
- `name` ;
- `topics` et mots-clés ;
- `excludedTerms` ;
- `language` ;
- `schedule` ;
- `sourceIds` ;
- `isActive` ;
- `lastFetchedAt` ;
- `visibilityRuleId`, généralement privé.

### `WatchSource`

- `name` ;
- `url` ;
- `kind` : rss, atom ;
- `defaultLanguage` ;
- `etag`, `lastModified` ;
- `lastSuccessAt`, `lastErrorAt` ;
- `errorCount` ;
- `isActive`.

Une source peut servir plusieurs abonnements.

### `Article`

- `canonicalUrl` ;
- `sourceId` ;
- `title` ;
- `author` nullable ;
- `publishedAt` nullable ;
- `fetchedAt` ;
- `excerpt` ;
- `contentHash` ;
- `language` ;
- `rawContentPath` nullable avec rétention limitée ;
- provenance obligatoire.

### `ArticleAnalysis`

- `articleId` ;
- `modelId` ;
- `promptVersion` ;
- `summary` ;
- `topics` ;
- `relevanceReasons` ;
- `createdAt` ;
- `status` : pending, ready, failed ;
- `errorCode` nullable.

L'analyse est reconstructible. Elle ne remplace jamais l'article source.

### `ProfileArticleState`

- `profileId` ;
- `articleId` ;
- `subscriptionId` ;
- `state` : unread, read, saved, ignored ;
- `feedback` : useful, neutral, notUseful ;
- `personalNote` nullable ;
- `updatedAt`.

### `Digest`

- `profileId` ;
- `periodStart`, `periodEnd` ;
- `articleIds` ;
- `headline` ;
- `summary` ;
- `modelId` ;
- `promptVersion` ;
- `generatedAt` ;
- `status`.

## Assistant

### `AssistantProposal`

- `profileId` ;
- `inputText` ;
- `intent` ;
- `argumentsJson` validés ;
- `riskLevel` ;
- `targetVisibility` ;
- `modelId` ;
- `promptVersion` ;
- `status` : proposed, confirmed, rejected, expired, executed ;
- `createdAt`, `expiresAt` ;
- `executedEntityIds`.

Les propositions expirent et ne sont jamais réexécutées automatiquement.

### `AssistantMemoryFact`

Hors MVP par défaut. Si activé plus tard :

- consentement explicite ;
- profil propriétaire ;
- valeur structurée ;
- provenance ;
- date de validité ;
- possibilité de voir, corriger et supprimer.

Les conversations ne deviennent pas automatiquement de la mémoire.

## Synchronisation

### `Device`

- `id` ;
- `householdId` ;
- `boundProfileId` ;
- `displayName` ;
- `publicKey` ou empreinte ;
- `scopes` ;
- `lastSeenAt` ;
- `revokedAt` nullable.

### `ChangeEvent`

- enveloppe décrite dans l'architecture ;
- payload versionné ;
- appliqué une seule fois ;
- conservé jusqu'à inclusion dans un snapshot et expiration de la fenêtre de récupération.

### `SyncCursor`

- curseur serveur par appareil ;
- dernière synchro réussie ;
- dernier accusé ;
- erreur et compteur de retry ;
- nombre de changements en attente.

### `Conflict`

- type et identifiant d'entité ;
- version locale et version distante ;
- profils et appareils auteurs ;
- statut : open, keepLocal, keepRemote, merged ;
- résolution et date.

## Visibilité

Trois choix doivent être compréhensibles dans l'UI :

- **Foyer** : visible des profils autorisés au foyer ;
- **Privé** : visible seulement du profil propriétaire ;
- **Choisi** : visible d'une liste de profils.

Le niveau `sensitive` peut renforcer le verrouillage et masquer le contenu dans les notifications, mais il ne remplace pas la règle de visibilité.

Les agrégats budgétaires respectent les règles : un total foyer ne doit pas révéler indirectement une transaction privée. Deux vues sont donc nécessaires : « mes données + partagé » et « partagé uniquement ».

## Règles de conflit par domaine

| Domaine | Stratégie MVP |
|---|---|
| Tâche | révision optimiste, conflit explicite si édition simultanée |
| Occurrence récurrente | clé idempotente, union par occurrence |
| Course ajoutée | union |
| Course cochée | dernier événement pour l'état, champs divergents en conflit |
| Transaction | append-only |
| Charge récurrente | révision optimiste |
| Enveloppe | conflit explicite |
| État d'article par profil | dernier événement du même profil |
| Abonnement de veille | révision optimiste, privé au profil |
| Préférence UI | locale à l'appareil sauf choix explicite |

## Migration depuis Home Mind

1. figer une version source ;
2. sauvegarder et tester une restauration ;
3. augmenter `schemaVersion` Drift ;
4. conserver les tables existantes et ajouter les nouvelles ;
5. ajouter l'outbox sans transformer rétroactivement chaque ligne en changement ;
6. créer un snapshot initial par appareil ;
7. tester une base vide, une base Home Mind réelle et une base interrompue pendant migration ;
8. ne supprimer aucune ancienne table avant deux versions stables.

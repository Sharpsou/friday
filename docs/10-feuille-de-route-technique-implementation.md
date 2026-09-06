# Friday — méthode de développement et gates

Statut documentaire : actif. Consolidation : 6 septembre 2026.

Cette référence porte la méthode actuelle. Les anciens lots, estimations, tables
cibles et critères remplacés sont conservés dans l'[archive technique](archives/etats-techniques/10-feuille-de-route-technique-implementation.md).
Les identifiants historiques FR/NFR/SEC restent consultables pour comprendre les tests.
Le produit relève de [09](09-decision-finale-pwa-mvp.md) et l'état livré de [27](27-etat-canonique-app-robot-2026-08-25.md).

## 1. Reprendre et borner un lot

Lire AGENTS, 00, 27, 09, ce document et le runbook concerné, puis la fondation 32
pour Chat. Inspecter Git, préserver les changements locaux et travailler dans le
dépôt existant. Une ancienne roadmap n'autorise pas une nouvelle intégration.
Définir problème, critère d'acceptation, risques et retour arrière avant évolution structurante.

## 2. Architecture et contrats

Monorepo pnpm, PWA React/Vite/Workbox, Fastify Windows et SQLite WAL, Dexie chiffré,
contrats Zod et calculs purs partagés. Les versions sont définies par les manifests
et le lockfile. La [carte des modules](guides/architecture-developpement.md) décrit
la composition après les deux lots du 6 septembre.

Pas d'import Web vers Hub, SQL dans les routes, calcul Budget dans React ou accès
Ollama depuis la PWA. Les socles de stockage et d'inférence ne dépendent pas des écrans.
Conserver façades et exports de compatibilité avant tout retrait prouvé par les consommateurs.
Les imports `.ts` internes aux contrats sont intentionnels pour leur export source natif.

## 3. Données et synchronisation

Montants en centimes, dates civiles distinctes des instants UTC, calculs déterministes.
UUID client et révision serveur ; ne pas arbitrer un conflit par l'horloge client.
Chiffrer avant la transaction IndexedDB ; écrire données et outbox atomiquement.
Le contexte appareil arbitre la clé et l'identité concurrentes. Le serveur applique
les commandes idempotentes ; Maison conserve l'atomicité de ses objets et courses.
Une commande incompatible reste en attente sans bloquer les domaines supportés.

Ne pas réécrire une migration appliquée ni changer AAD/format chiffré par simple
découpage. Toute migration de données exige sauvegarde cohérente, restauration de
contrôle et scénario de compatibilité. Ne jamais copier un WAL actif comme backup.

## 4. IA et frontières

L'ordonnanceur Hub commun sérialise générations et embeddings ; le budget Web est
partagé. Profils et autorisations sont filtrés par le code. Sources, prompts issus
de données et réponses antérieures ne donnent aucune instruction d'administration.
Chat n'écrit ni Maison ni Budget ni Robot. Le [document 32](32-fondation-reconstruction-chat.md)
définit le harnais courant. Ne pas relancer les campagnes longues arrêtées.

## 5. Vérification et preuve

`pnpm verify` exécute format, documentation, lint, typage, architecture, tests, builds
et E2E. La PWA de test est construite dans `.verification/web`, vidée après validation
du chemin réel ; le runtime familial n'est pas redémarré. Hub et packages sont
reconstruits : ce n'est pas une copie intégralement isolée de tous les artefacts.
Utiliser l'[environnement jetable](runbooks/development.md).

Tests adaptés : règles métier et dates ; transactions/migrations ; auth/profils ;
sync coupée, renvoi et réponse perdue ; cache chiffré ; compatibilité ; parcours PWA.
Les tests Robot n'autorisent pas les moteurs et les doubles IA ne qualifient pas la prose.
Une suite verte ne remplace ni recette téléphone ni restauration ni mesure qualitative.

## 6. Déploiement et retour arrière

Après une évolution runtime autorisée et `pnpm verify` réussi : suivre le runbook
Windows et `Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.
Vérifier santé, migration, intégrité et fichiers réellement servis. Conserver hors Git
les preuves et les artefacts cohérents de rollback. Ne pas écraser les données récentes.
Une évolution documentaire seule ne déclenche pas de déploiement.

## 7. Documentation et fin de lot

Actualiser le runbook du domaine, 27, puis 00/AGENTS seulement si la reprise change.
Documenter séparément code, tests, déploiement et recette réelle. Centraliser les
compteurs dans un rapport daté. Archiver les instructions remplacées en conservant
les preuves et les liens. Suivre la [maintenance documentaire](reference/maintenance-documentation.md).

## 17. Politique de skills et gates

Cette section conserve son numéro pour les instructions AGENTS et les références existantes.
Préférer un skill curated déjà disponible, puis officiel mainteneur ; aucun doublon
ou dépendance imposée par un skill. L'état d'installation daté est dans le
[registre](skills-register.md), pas dans une liste de recommandations supposée actuelle.

| Type de lot                    | Discipline attendue                               | Preuve                                                                           |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Socle ou frontière de sécurité | Modèle de menace et revue ciblée selon périmètre  | Risques, barrières et tests du chemin modifié                                    |
| Offline/PWA                    | Tests navigateur, stockage et performance React   | Coupure, migration, idempotence, recette appareil distincte                      |
| Auth/Maison                    | Contrats, transactions, profils et compatibilité  | Révocation, deux profils, rollback et outbox                                     |
| Budget                         | Calculs purs ; aucune décision financière par LLM | Fixtures de montants, récurrences et clôture                                     |
| Chat/Veille/IA                 | Skill llm-security pour changement de harnais     | Contenus hostiles, provenance, absence de mutation, budgets et qualité distincte |
| Exploitation                   | Sauvegarde/restauration, sécurité ciblée          | Restauration réelle en répertoire vide                                           |
| Toute livraison                | verification-before-completion                    | Commande fraîche avec code de sortie et limites                                  |

Une installation de skill exige un accord explicite et passe par `skill-installer`.
Avant installation : lire SKILL et scripts, vérifier provenance, licence, commit/tag,
permissions et besoin ; faire un essai non destructif et enregistrer la décision.
Les mentions d'audit d'un catalogue sont des signaux datés, jamais une garantie.
Ne pas installer de skill ou créer un skill local pour remplacer les règles du dépôt.

## 18. Conditions de fin

Un lot est terminé quand ses critères ont une preuve fraîche, les changements
étrangers sont préservés, les documents actifs sont cohérents et les limites ouvertes
sont visibles. L'absence de preuve réelle reste une validation à faire, jamais une
capacité acquise par déduction. Calendar, Tailscale, Budget réel et actions physiques
restent soumis à leurs portes documentées.

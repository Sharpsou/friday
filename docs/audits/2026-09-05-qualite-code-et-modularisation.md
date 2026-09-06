# Friday — audit actualisé de qualité et plan de modularisation

Rapport du **6 septembre 2026**, sur les évolutions livrées le 5 septembre. Le nom de fichier demandé est conservé. Cet audit produit des constats et des lots proposés ; il n'applique aucune correction runtime.

## 1. Résultat et décisions proposées

La référence actuelle passe **`pnpm verify` : 532 tests réussis**, formatage, lint, typage et builds compris. Les anciennes erreurs de typage/lint ne sont plus présentes. Trois sondes supplémentaires reproduisent néanmoins des défauts que cette suite ne protège pas : initialisation concurrente du coffre local, quota Menus dépendant de l'historique affiché et synchronisation après retour à un ancien Hub.

**Commencer par ces trois corrections isolées, puis extraire le socle de synchronisation.** Le couplage Tâches/Maison est plus urgent que le découpage cosmétique des écrans. Une dépendance circulaire d'exécution relie leurs deux dépôts. Les services IA partagés doivent ensuite sortir du répertoire Maison sans changer d'instance, de file ni de règles.

Le dépôt contient **34 fichiers de plus de 500 lignes, dont 16 dépassent 1 000 lignes**. Plusieurs concentrent des responsabilités distinctes ; les migrations et certaines suites longues justifient en revanche leur volume. Aucun seuil ne constitue à lui seul une raison de découper.

La reconstruction récente du Chat a déjà traité une grande partie du précédent audit : exécuteur partagé, budget Web persistant, envoi incertain chiffré, durée globale et mémoire documentaire privée existent. Il faut protéger ces mécanismes, pas les réimplémenter. Les tests synthétiques ne ferment pas la gate qualitative du Chat, ni les recettes A17/iPhone/Robot.

## 2. Référence reproductible et méthode

### 2.1 État figé

- Dépôt : `D:\prog\friday`, branche `main`, HEAD `362bf801cd8db665d552f6151efa547463be454d`.
- Capture : `2026-09-05T22:00:06.417926+00:00`, soit le 6 septembre à 00:00:06 à Paris.
- Le travail non commité est essentiel à cette référence. Les fichiers Maison, le nouveau moteur et plusieurs rapports ne sont notamment pas encore suivis par Git. **Le commit seul ne permet pas de reproduire cet audit.**
- Capture de 380 fichiers suivis ou non suivis, hors ignorés : chemin, taille et SHA-256 ; état Git et patch binaire conservés séparément.
- Dossier de preuves synthétiques : `D:\FridayData\audits\quality-code-20260905-01`. Il contient `manifest.json`, `source.zip`, `status-before.txt`, `diff-before.patch`, `verify.log`, `verify-exit.txt`, les analyseurs et les sondes. Aucun fichier de données personnelles n'a été nécessaire à ces reproductions.
- SHA-256 de `manifest.json` : `f4a870a1f0c835acb64cdd576c24dfb0a86721011378f0baf482110531a3af66`.

L'archive contient les sources de la capture, pas les dépendances installées. Pour une reprise sur une autre machine : extraire dans un répertoire séparé, conserver le lockfile, utiliser les versions Node/pnpm déclarées, installer les dépendances puis lancer les contrôles. Les sondes privées contiennent des chemins vers ce workspace : les adapter à cette copie, sans pointer vers les données réelles.

### 2.2 Sources et limites de la revue

Lecture des documents de reprise 00/27, décisions 09, feuille de route 10, runbooks développement, Maison, Chat et Robot ; confrontation aux sources, tests, configurations, commandes et rapports du 5 septembre. Les rapports historiques restent inchangés. Le présent document prime pour les propositions de nettoyage sur cette référence, pas pour une décision produit.

Inventaire de **251 fichiers de code et scripts, 77 931 lignes physiques**, extensions TS/TSX, Python, PowerShell, CSS, shell et MJS, hors dépendances, builds et fichiers ignorés. Le nombre de lignes est une mesure physique ; JSON/YAML/Markdown sont examinés comme configuration/documentation mais ne sont pas inclus dans ce décompte.

Analyse AST TypeScript des imports, réexports, imports de types et imports dynamiques littéraux ; graphe des références internes résolubles ; examen des points d'entrée, scripts npm, configurations et usages documentés. Les branches comptées dans les fonctions orientent la lecture : ce n'est pas une mesure normalisée de complexité cyclomatique. Les chargements Python, services et scripts sont confrontés manuellement à leurs lanceurs. Aucun analyseur statique ne démontre l'absence de consommateurs externes ou de références calculées arbitraires.

Les résultats détaillés sont dans `structure.json` et `references.json`, produits par `analyze.cjs`. Les recherches textuelles servent à confirmer des candidats ; elles ne suffisent pas à autoriser leur retrait. La revue approfondie cible les frontières et invariants ci-dessous ; elle n'est pas une certification exhaustive de chaque branche ni un audit de vulnérabilités des dépendances.

### 2.3 Points d'entrée réels

| Surface      | Entrées et composition examinées                                                                                                  | Conséquence pour le nettoyage                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PWA          | `apps/web/index.html`, `src/main.tsx`, `App.tsx`, `vite.config.ts`, service worker Workbox généré                                 | Les vues chargées par `lazy()` sont vivantes ; préserver le cycle d'installation/mise à jour offline. |
| Hub          | `apps/hub/src/main.ts`, `app.ts`, scripts `dev/start/build`                                                                       | `main` configure et démarre ; `buildHub` compose services, routes et fermetures.                      |
| Packages     | `package.json` de contrats, domaine, assistant-core et chat-eval ; barrels et exports                                             | Un réexport public n'est pas un appelant, mais impose une vérification de compatibilité.              |
| Banc et CLI  | `packages/chat-eval/src/cli.ts`, campagne, screening, corpus ; scripts Hub de seed Budget, migration Maison et évaluation Courses | Ce code est accessible hors interface ; ne pas raisonner seulement depuis `App.tsx`.                  |
| Robot        | `robot/friday_robot/server.py`, serveur de réveil, streamer caméra ; worker `tools/robot-localization/place-worker.py`            | Entrées Python et processus lancés par le Hub/systemd ; tests sur matériel simulé uniquement.         |
| Exploitation | `infra/windows`, `infra/systemd`, `robot/deploy`, fichiers env d'exemple                                                          | Deux modèles systemd de même nom ne sont pas nécessairement interchangeables.                         |
| Vérification | `scripts/verify.mjs`, configuration Playwright/Vitest, `tests/e2e`, fixtures                                                      | Les dépendances de tests et outils ne sont pas des dépendances runtime inutiles.                      |

### 2.4 Commandes et résultats frais

Dans un processus PowerShell dédié, les variables `FRIDAY_*` héritées ont été retirées **de ce processus seulement**, puis remplacées par cet environnement jetable :

```powershell
Get-ChildItem Env:FRIDAY_* | Remove-Item
$env:FRIDAY_ROBOT_MODE = 'disabled'
$env:FRIDAY_DATABASE_PATH = ':memory:'
$env:FRIDAY_DATA_DIR = 'D:/FridayData/audits/quality-code-20260905-01/test-data'
$env:FRIDAY_E2E_PORT = '18443'
$env:FRIDAY_CHAT_ENABLED = 'true'
$env:FRIDAY_CHAT_PIPELINE = 'unified'
pnpm verify
```

Code de sortie : **0**. Décompte frais, pas une reprise du compteur historique :

| Suite          | Tests réussis |
| -------------- | ------------: |
| Python Robot   |            27 |
| Contrats       |            25 |
| Assistant Core |            40 |
| Domaine        |            27 |
| Hub            |           191 |
| PWA            |           133 |
| Banc Chat      |            60 |
| Playwright     |            29 |
| **Total**      |       **532** |

Le wrapper force la construction PWA dans `.verification/web` et l'utilise pour le Hub de test. Les sorties de build du Hub et des packages sont aussi régénérées ; ce n'est pas un environnement de déploiement entièrement séparé. Aucun service domestique n'a été redémarré. Les 29 parcours Playwright utilisent Chrome avec viewport mobile ; plusieurs API, dont les réponses Chat et les états Robot, sont simulées. Ils ne prouvent ni Safari iPhone, ni la qualité des modèles, ni le comportement physique.

Avertissements non bloquants : chunk principal PWA de 571,66 kB minifié / 165,07 kB gzip ; dépréciation Workbox `inlineDynamicImports` ; avertissement Node `DEP0190` sur le lancement Windows avec `shell: true`. Les commandes du wrapper sont fixes : cet avertissement seul ne démontre pas une injection exploitable.

Sondes complémentaires, toutes sans modèle réel, réseau externe ni matériel :

```powershell
pnpm --filter @friday/hub exec tsx D:/FridayData/audits/quality-code-20260905-01/probes.mts
pnpm --filter @friday/hub exec tsx D:/FridayData/audits/quality-code-20260905-01/storage-probes.mts
```

Les scripts exposent leurs observations dans `probes.json` et `storage-probes.json`. Leur sortie 0 signifie exécution complète, **pas absence d'anomalie** : ils reproduisent volontairement les trois constats Q01–Q03. SQLite en mémoire, `fake-indexeddb`, WebCrypto réel et faux `fetch` suffisent. Les UUID des résultats sont synthétiques et varient au rejeu.

## 3. Couverture et état réellement protégé

| Domaine                  | Examen et preuves actuelles                                                                                                                                                                        | Limite / complément avant extraction                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maison                   | Contrats/domaines, commandes, dépôts, migrations, menus IA et éditeurs ; tests quantités/conversions, recettes, conflits, transaction composite ; parcours E2E préparation/courses/réserve/offline | Ajouter Q01–Q03 ; comparer les effets complets de réception, consommation, contributions et copie du planning, avec restes et quantité inconnue.                                        |
| Sync et stockage         | Outbox, acquittements, curseurs, pagination, suppressions, chiffrement et reprise ; tests Hub/PWA                                                                                                  | Couvrir l'initialisation concurrente et Hub récent → ancien → récent ; conserver l'atomicité des commandes composites et données/outbox.                                                |
| Chat et mémoire          | Envoi stable chiffré, reprise, cache, contexte causal, SQLite 47 et suppression ; tests `chat-send`, service et stabilisation                                                                      | Plusieurs tests sont des appels séquentiels simulés : ajouter les entrelacements de deux contextes/onglets, effacement et rechargement pendant l'envoi.                                 |
| Publication              | Moteur commun et tests de corrections/citations/contradictions/repli ; ancienne faille C1 couverte                                                                                                 | Comparaison avant/après texte accepté, statut, codes, sources, compteurs et ordre des appels ; aucune nouvelle campagne qualitative dans ce lot.                                        |
| IA et Web                | Ordonnanceur, adaptateurs génération/embeddings, budget SQLite, contrôles d'entrée Web ; tests et sondes dédiées                                                                                   | La sonde FIFO/annulation/erreur passe ; la sonde quota concurrent, réinstanciation et changement de mois passe. Ajouter contention des cinq usages au même niveau d'intégration et Q02. |
| Budget et comptes        | Calculs/récurrences dans le domaine, dépôt, routes, auth/enrôlement/révocation ; tests existants                                                                                                   | Ne pas requalifier les calculs comme absents : caractériser montants limites, calendrier, isolement et effacement avant déplacement. Aucun Budget personnel importé.                    |
| Robot                    | Contrôleur, topologie, autonomie, vision, transports et Python ; tests délais/arrêt/modes et redémarrage                                                                                           | Sérialisation et sécurité à conserver ; les tests simulés ne valident pas veille/réveil, servo, localisation ni arrêt physique.                                                         |
| UI/PWA                   | App, vues, dialogues, polling, lazy loading, styles et 29 E2E                                                                                                                                      | Rendu statique de certains tests React insuffisant pour focus/effets ; ajouter navigation aller-retour, offline, update avec outbox et démontage.                                       |
| Contrats/migrations      | Barrels Zod, schémas Maison, 47 migrations SQL, Dexie 9, tests DB                                                                                                                                  | Comparer acceptation/rejet des anciens payloads et bases de versions précédentes ; aucun changement SQL/AAD implicite.                                                                  |
| Outils/exploitation/docs | Manifestes, lockfile, CLI, scripts Windows/Python/systemd, rapports/runbooks                                                                                                                       | Pas d'installation, de restauration de production, de contrôle live A17 ni d'exécution des scripts physiques. Dette de restauration conservée séparément.                               |

La mémoire de recherche est une évolution réelle : `chat_research_memory` conserve un dossier privé par conversation/message, avec bornes de 8 sources, 12 passages et 24 000 caractères. L'absence de dossier sur une ancienne conversation est prévue. Le mode Local n'active pas de recherche. Les anciennes réponses apportent du contexte, pas une nouvelle preuve documentaire.

Le plafond global Chat est désormais de 300 secondes depuis la mise en file, avec 12 générations, 6 recherches et 16 lectures au maximum, et jusqu'à 3 corrections contrôlées. Ces bornes ne prouvent pas l'utilité sémantique de la réponse ni l'atteinte d'un p95 qualitatif.

## 4. Constats priorisés

P1 : correction préalable aux refactorisations sensibles. P2 : dette ou défaut à traiter dans les lots suivants. P3 : nettoyage opportuniste. « Élevée » décrit la confiance dans le constat, pas sa fréquence réelle. Les lignes désignent la capture auditée et évolueront après extraction.

### Q01 — P1 — Initialisation concurrente du coffre non atomique

**Confiance élevée ; reproduit.** [auth-client.ts](../../apps/web/src/auth/auth-client.ts), ligne 61, lit puis crée l'identifiant appareil ; [task-repository.ts](../../apps/web/src/db/task-repository.ts), ligne 114, lit puis génère et écrit la clé AES. Ces deux opérations ne possèdent pas d'arbitrage atomique entre initialisations.

Sur IndexedDB vide, lancer ensemble `createLocalTask` et `createLocalGroceryItem` : les deux créations réussissent avec deux `deviceId` distincts ; une lecture ultérieure de l'état chiffré/outbox échoue avec `OperationError`. Une initialisation concurrente peut donc remplacer la clé ou l'identité utilisées par l'autre écriture. Cela établit un risque de données locales illisibles ; aucune occurrence sur téléphone n'a été observée dans cet audit.

**Correction proposée :** préparer les éléments cryptographiques hors transaction, puis lire à nouveau et sélectionner/persister un seul contexte gagnant dans une transaction commune. Tous les appelants doivent recevoir ce contexte, y compris `getLocalDeviceId`. Un verrou mémoire dans un onglet ne suffit pas pour plusieurs onglets. Ne jamais remplacer une clé existante ni changer l'AAD.

**Tests :** deux premières écritures avec latence crypto, contextes indépendants, identité seule créée auparavant, clé existante et données déjà chiffrées ; toutes les entités et opérations doivent rester déchiffrables. Garder cette correction séparée du déplacement du dépôt.

### Q02 — P2 — Le quota Menus compte seulement les 40 derniers jobs

**Confiance élevée ; reproduit.** [menu-ai-service.ts](../../apps/hub/src/maison/menu-ai-service.ts), lignes 167–217 : `list()` limite l'historique à 40 ; `enqueue()` réutilise ce résultat pour compter les jobs en attente/exécution, puis ajoute le compte Chat.

Sonde sur service arrêté et file persistée : conserver 3 anciens jobs en attente, créer/annuler 41 jobs successifs puis ajouter 4 demandes. Résultat : **7 jobs en attente**, dont 4 seulement dans la fenêtre visible, pour une limite annoncée de 4 ; zéro appel de modèle. Une file ancienne peut être masquée par l'historique terminé/annulé.

**Correction proposée :** compter tous les statuts actifs en SQL, indépendamment de la pagination d'affichage. Mutualiser ensuite, si utile, la règle d'admission Chat/Menus ; ne pas modifier la politique produit ni la file FIFO. Les statuts Menus résident dans `payload_json` : la requête doit compter cette représentation existante sans migration implicite.

**Tests :** historique supérieur à 40, jobs annulés/terminés, reprise, demandes Chat et Menus alternées, profils distincts et idempotence d'un `requestId` déjà accepté.

### Q03 — P2 — Un ancien Hub peut bloquer aussi la sync des tâches

**Confiance élevée ; reproduit avec serveur simulé.** [maison-repository.ts](../../apps/web/src/db/maison-repository.ts), ligne 282, mémorise `maisonSnapshotV1` et retourne ensuite `true` sans contacter le Hub. [sync-client.ts](../../apps/web/src/sync/sync-client.ts), ligne 45, en déduit si les commandes Maison peuvent entrer dans le lot.

Après un snapshot Maison réussi, mettre une recette et une tâche dans l'outbox, puis simuler un ancien Hub refusant `maison_command`. Le client appelle seulement `/api/sync/push`, reçoit 400 et conserve les deux opérations en attente. Le test existant « premier contact avec ancien Hub » ne couvre pas ce retour arrière. Aucune perte n'est démontrée ; c'est un blocage de compatibilité et de synchronisation des domaines déjà supportés.

**Correction proposée :** distinguer « snapshot local déjà initialisé » et « capacité du Hub courant ». Revalider la capacité lors d'un changement de serveur/version ou d'une réponse d'incompatibilité reconnue, puis synchroniser les opérations supportées en conservant Maison en attente. Ne pas traiter tout 400 comme une absence de Maison : les erreurs de validation doivent rester visibles.

**Tests :** Hub récent → ancien → récent, outbox mixte, absence de duplication, IDs inchangés, curseur monotone et reprise des commandes Maison ; ne pas acquitter les commandes rejetées.

### Q04 — P1 — Le socle de persistance dépend du domaine Maison

**Confiance élevée ; dette structurelle confirmée.** Imports de [task-repository.ts](../../apps/web/src/db/task-repository.ts) et [maison-repository.ts](../../apps/web/src/db/maison-repository.ts) : composante fortement connexe à deux fichiers dans le graphe d'exécution. Le premier contient identité/chiffrement, outbox, acquittements et application de changements, en plus des tâches. Maison dépend de ces services, et le dépôt Tâches appelle Maison pour appliquer les changements.

**Impact :** responsabilité transversale cachée, initialisation et transactions difficiles à isoler ; une évolution d'un domaine affecte les autres. Ce cycle n'est pas présenté comme une panne d'import actuellement observée.

**Correction et tests :** extraire contexte appareil, stockage outbox et orchestration de pull/ack en modules neutres ; injecter/appeler les adaptateurs de domaine depuis cette orchestration. Conserver une seule transaction pour données, outbox et curseur d'une commande composite. Comparer snapshots déchiffrés, opérations, acquittements, erreurs et curseurs avant/après sur les mêmes fixtures, après correction Q01/Q03.

### Q05 — P2 — Les services IA communs sont rangés dans leurs anciens domaines

**Confiance élevée.** [inference-scheduler.ts](../../apps/hub/src/maison/inference-scheduler.ts) sert cinq usages ; [web-budget.ts](../../apps/hub/src/watch/web-budget.ts) est partagé via la composition de [app.ts](../../apps/hub/src/app.ts), notamment ligne 258. La mutualisation runtime existe déjà ; le problème est sa propriété et le risque de créer par erreur plusieurs instances pendant l'extraction.

**Correction :** `hub/src/inference/` pour ordonnanceur/interfaces, `hub/src/integrations/web/` pour budget et adaptateurs transversaux ; conserver les services métier dans leurs domaines. Une seule instance injectée au Hub. Ne pas copier la file dans Chat ou Menus.

**Preuve positive :** une sonde maintient Chat actif, annule Menus en attente, fait échouer Photo puis exécute Veille ; ordre observé `chat, photo, watch`, ressource libérée. La sonde budget bloque la réservation dépassant le plafond, conserve 950 après réinstanciation et repart au nouveau mois (2 après réservation). **Tests avant déplacement :** contention génération/embeddings, annulation en attente/en cours, fermeture, budget comprenant l'attente et réservations partagées.

### Q06 — P2 — Les racines UI et HTTP cumulent coordination et domaines

**Confiance élevée.** [App.tsx](../../apps/web/src/App.tsx), fonction ligne 199, couvre 2 214 lignes ; [app.ts](../../apps/hub/src/app.ts), `buildHub` ligne 212, couvre 1 922 lignes. Auth, sync, chargements, préférences et vues/routes sont fortement concentrés. Les compteurs de branches sont indicatifs ; la diversité des responsabilités motive le découpage.

**Correction :** shell/navigation, hooks de cycle de session/sync et écrans Aujourd'hui/Agenda/réglages ; plugins Hub par domaine et dépôt de préférences. Réutiliser les plugins Chat/Menus déjà présents. Éviter un contexte React géant qui redistribuerait tous les états à tous les consommateurs.

**Tests :** montage/démontage et annulation du polling, changement de profil, navigation conservant les états voulus, erreurs/offline ; routes avec mêmes codes/corps, auth, contrôle d'origine et fermeture de services. Préserver l'ordre des hooks Fastify.

### Q07 — P2 — Les orchestrateurs restent complexes malgré les extractions récentes

**Confiance élevée.** [runtime.ts](../../packages/assistant-core/src/runtime.ts), `answerUnified` ligne 598 (480 lignes) ; [watch-service.ts](../../apps/hub/src/watch/watch-service.ts), 2 262 lignes ; [robot-visual-topology.ts](../../apps/hub/src/robot/robot-visual-topology.ts), `processObservation` ligne 998 (256 lignes).

**Impact :** les effets, reprises et décisions sont difficiles à comparer lors d'une modification. Le moteur Chat possède désormais des modules documents/synthèse/recherche : les extractions doivent s'appuyer sur eux. Les trois pipelines restent atteignables ; harmoniser leurs décisions de publication serait un changement de comportement.

**Correction :** isoler politiques pures et accès aux données autour de petits orchestrateurs conservant l'ordre des opérations. Veille : planification, collecte, rapprochement, digest, dépôt SQL. Robot : dépôt du graphe, reconnaissance, suivi d'observation, transitions, avec orchestration sérialisée conservée. **Tests :** traces déterministes de transitions/appels, annulations, erreurs intermédiaires, reprise après arrêt ; aucun prompt, modèle, seuil de reconnaissance ni commande physique modifié.

### Q08 — P2 — Contrats et migrations concentrés, dépendance schéma/service

**Confiance élevée.** [contracts/index.ts](../../packages/contracts/src/index.ts), 2 124 lignes ; [database.ts](../../apps/hub/src/db/database.ts), 2 034 lignes, importe la migration Maison depuis [maison-sync.ts](../../apps/hub/src/maison/maison-sync.ts). Une modification de synchronisation est ainsi proche d'une définition de schéma historique.

**Correction :** schémas communs puis modules de domaines, unions sync au-dessus et barrel public compatible ; déplacer les constantes de migrations vers des modules numérotés importés statiquement. Conserver exactement SQL, ordre, numéros et réparations conditionnelles, notamment le traitement de migration 19. Des migrations proches ou répétées ne sont pas du code mort.

**Tests :** corpus de payloads valides/invalides conservant les mêmes erreurs utiles, imports publics, installations neuves et upgrades existants jusqu'à 47. Aucun passage Dexie au-delà de 9 pour ce déplacement ; comparer schéma, index, contraintes et données synthétiques.

### Q09 — P2 — Parité DOM Hub/banc à sécuriser

**Confiance élevée sur l'écart, moyenne sur son impact.** [package Hub](../../apps/hub/package.json) utilise `jsdom ^30.0.1` / types 30 ; [package banc](../../packages/chat-eval/package.json) utilise `jsdom ^26.1.0` / types 21. L'extraction documentaire est partagée, mais elle reçoit des `Document` construits par des versions différentes.

**Impact potentiel :** un même HTML peut donner une structure/normalisation différente. Aucune divergence concrète n'a été reproduite ici. **Correction :** ajouter un petit corpus HTML stable comparant les sorties Hub/banc avant toute convergence de versions, puis aligner seulement si la comparaison est maîtrisée. Le moteur partagé a déjà résolu l'ancienne duplication globale ; ce constat ne l'annule pas.

### Q10 — P2 — Découpage CSS et suites insuffisamment protégé par le rendu statique

**Confiance élevée.** [styles.css](../../apps/web/src/styles.css), 5 387 lignes ; [offline-task.spec.ts](../../tests/e2e/offline-task.spec.ts), 3 158 lignes. Le CSS conserve des sélecteurs de l'ancienne carte mêlés à des sélecteurs Robot actifs. La grande suite E2E concentre helpers, mocks et scénarios ; sa réussite seule ne prouve pas que chaque futur fichier sera indépendant.

**Correction :** fondations puis composants partagés puis styles par domaine, avec ordre d'import et cascade inchangés. Suites par domaine et fixtures explicites de comptes/stockage/API ; réutiliser `tests/fixtures/maison.ts`. **Tests :** chaque nouvelle suite exécutable seule, nettoyage explicite, ordre aléatoire si compatible, focus/modal/mobile, états offline et comparaison visuelle ciblée. Ne pas remplacer des assertions métier par des snapshots de JSX.

### Q11 — P2 — Documentation active et preuves historiques encore superposées

**Confiance élevée.** [AGENTS.md](../../AGENTS.md), [00](../00-reprise-nouveau-chat.md), [27](../27-etat-canonique-app-robot-2026-08-25.md), [32](../32-fondation-reconstruction-chat.md) et [runbook Chat](../runbooks/assistant-gemma.md) contiennent plusieurs états successifs. SQLite 45/46 et descriptions sans passages persistés subsistent à côté de SQLite 47 et du dossier de recherche. Des ajouts récents contiennent aussi le caractère de remplacement Unicode `U+FFFD`, confirmé à la lecture UTF-8.

**Correction :** un encadré courant court par point d'entrée, références vers le bilan le plus récent et identification explicite des passages historiques. Réparer l'encodage à partir du sens/source, pas par remplacement global aveugle. Documenter que `verify` impose `.verification/web`, y compris lorsqu'un runbook propose un autre `FRIDAY_WEB_OUT_DIR`.

**Tests :** liens locaux, encodage et cohérence SQLite 47/Dexie 9, déploiement/automatisation/recette réelle séparés. Ne pas réécrire les rapports historiques pour leur attribuer les résultats de ce jour.

### Q12 — P2 — Poids initial et maintenance des outils à suivre séparément

**Confiance élevée sur les mesures ; impact mobile non mesuré.** Le chunk principal atteint 571,66 kB ; `BudgetView` reste importé directement alors que Chat/Veille/Robot/Maison disposent de frontières lazy. CSS : 80,73 kB minifié. Markdown est déjà séparé : ne pas proposer cette extraction comme nouvelle.

**Correction :** instruire le chargement différé Budget après caractérisation de sa navigation/offline ; traiter les avertissements Workbox et du wrapper dans un lot outils séparé, sans mise à jour générale des dépendances. **Tests :** disponibilité offline après mise à jour, ouverture directe/retour vers Budget, erreurs de chargement et mesure de bundle comparable. Aucun gain de fluidité téléphone n'est promis sur la seule taille du bundle.

## 5. Réévaluation des constats précédents

Référence initiale : [audit documentation et Chat](2026-09-05-documentation-et-chat.md). Révisions confrontées au code : [implémentation Chat](2026-09-05-implementation-chat.md), [harnais v3](2026-09-05-harnais-chat-v3.md), [simplification](2026-09-05-simplification-harnais-chat.md), [continuité de recherche](2026-09-05-continuite-recherche-chat.md) et [livraison Maison](2026-09-05-livraison-maison.md).

| Ancien constat                               | Statut actualisé                           | Motif / dette résiduelle                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 Contradiction republiée                   | Résolu pour le défaut caractérisé          | Conservation de la meilleure réponse auditée, corrections contrôlées et tests de stabilisation. La fiabilité sémantique réelle reste une gate distincte.                                  |
| C2 Banc sans pipeline unifié                 | Résolu                                     | `SharedChatEngine` est utilisé par Hub et banc ; runner unifié effectif. Q09 concerne la parité des adaptateurs DOM.                                                                      |
| C3 Chiffrement dans transaction cache        | Résolu                                     | Chiffrement préparé avant transaction et test avec chiffrement lent. Q01 est un autre défaut, lors de l'initialisation du contexte.                                                       |
| C4 Questions futures dans le contexte        | Résolu pour le scénario causal             | Requêtes bornées par ordinal ; mémoire également bornée. Préserver ces filtres lors d'extractions SQL.                                                                                    |
| C5 Perte de la consigne actuelle             | Résolu pour les cas reproduits             | Demande courante conservée dans le contexte et tests dédiés. Une résolution heuristique n'est pas une garantie sémantique universelle.                                                    |
| C6 Cache supprimé / erreurs masquées         | Résolu pour les chemins caractérisés       | Réconciliation du snapshot et distinction des erreurs explicites/réseau. Compléter les entrelacements multi-onglets avant refactorisation.                                                |
| C7 Panne d'audit différente de JSON invalide | Résolu sur le pipeline actif               | Replis contrôlés/testés ; ne pas modifier implicitement les autres pipelines.                                                                                                             |
| C8 Budget Web seulement affiché              | Remplacé                                   | Réservation commune SQLite existante ; sonde de concurrence/réinstanciation/mois réussie. Ce n'est plus une fonctionnalité à créer.                                                       |
| C9 Relance sans budget de révision           | Remplacé                                   | Harnais actuel : 12 générations, jusqu'à 3 corrections, conservation du meilleur résultat ; ancien calcul sur 6 appels caduc.                                                             |
| C10 ID perdu après réponse incertaine        | Résolu pour le chemin de reprise           | ID et contenu incertain chiffrés dans Dexie, tests clients/rechargement. Pas une outbox autorisant un nouveau Chat offline.                                                               |
| Durée totale non bornée                      | Résolu dans le code actuel                 | Deadline depuis la file ; cible qualitative de latence toujours distincte.                                                                                                                |
| Métadonnées de versions sans consommateur    | Toujours présent                           | `CHAT_RUNTIME_VERSIONS` reste déclaré/réexporté ; ne constitue pas une trace effective des versions par run.                                                                              |
| Sélection documentaire ancienne / pertinence | Remplacé, résultat qualitatif non confirmé | Extraction structurée, synthèse et mémoire ont changé ; ne pas reporter les anciennes conclusions sur huit premières pages sans nouvelle campagne autorisée.                              |
| Gros fichiers, bundle et cascade CSS         | Toujours présent / partiellement résolu    | Nouvelles frontières Maison et moteur commun, mais inventaire ci-dessous et Q04–Q12.                                                                                                      |
| Sauvegarde/restauration complète             | Toujours présent, hors modularisation      | Les snapshots et contrôles SQLite ne prouvent pas une restauration chiffrée complète avec secrets/auth. Préserver le chantier du runbook de sauvegarde ; ne pas l'improviser dans ce lot. |

## 6. Candidats au retrait, preuves et exceptions

Priorité **P3**, sauf indication. Une suppression candidate exige toujours compilation/build, tests ciblés et contrôle des engagements publics. « Élevée » signifie absence de consommateur interne après graphe et points d'entrée, pas garantie concernant un outil externe non présent dans ce dépôt.

| ID  | Candidat et emplacement                                                     | Preuve / confiance                                                                                                                       | Décision proposée et garde-fou                                                                                                                           |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | `routeAndPlanQuestion`, `assistant-core/src/routing.ts:120`                 | Définition et export, aucun consommateur interne retrouvé ; élevée                                                                       | Retirer le helper/export après contrôle du barrel. La méthode runtime `routeAndPlan` est active et reste. Tests routing et build banc/Hub.               |
| M02 | `retrievalQueriesForPlan`, `assistant-core/src/axes.ts:131`                 | Graphe et références sans consommateur ; élevée                                                                                          | Retrait candidat ; préserver `searchQueriesForPlan`, appelé. Tests axes et imports publics.                                                              |
| M03 | `aspectCoverage`, `chat-eval/src/metrics.ts:85`                             | Export non appelé ; la gate utilise son propre calcul ; élevée                                                                           | Retirer seulement après comparaison des métriques/gates sur fixtures.                                                                                    |
| M04 | `suggestWatchSources`, `web/src/sync/watch-client.ts:127`                   | Aucun appel UI, ni import dynamique dédié ; élevée                                                                                       | Retrait du client candidat. L'endpoint Hub n'est pas prouvé mort. Tests clients Veille.                                                                  |
| M05 | `CHAT_RUNTIME_VERSIONS`, `assistant-core/src/runtime.ts:1818`, réexport Hub | Pas de lecture effective ; élevée                                                                                                        | Choisir retrait du symbole inutilisé ou futur usage de diagnostic explicite ; ne pas ajouter persistance/télémétrie dans le lot de suppression.          |
| M06 | `BUDGET_SEED_MAPPING`, `hub/src/budget/budget-seed-mapping.ts:6`            | Pas de consommateur exécutable ; documente un mapping d'import manuel ; moyenne                                                          | Support opérationnel à conserver ou déplacer en documentation avec ses références. Le CLI seed Budget reste actif.                                       |
| M07 | `stopRobotAutonomy` / `armRobot`, `web/src/sync/robot-client.ts:241/312`    | Pas d'appelant client trouvé ; élevée sur PWA                                                                                            | Retrait des wrappers seulement après caractérisation des commandes UI actuelles ; préserver les routes/commandes d'arrêt et les usages hors UI.          |
| M08 | `MobileNetSsdVisionEngine`, `hub/src/robot/robot-vision.ts:420`             | Classe alternative sans instanciation dans les entrées examinées ; moyenne                                                               | Décision différée : vérifier runbooks, sélection de backend, modèles/installateurs et besoins de rollback avant de retirer classe ou dépendances ONNX.   |
| M09 | Dépendance directe `@mozilla/readability`, `apps/hub/package.json:21`       | Déclaration sans import/require dans code, CLI ou config ; extraction passée au module commun ; élevée                                   | Retrait direct candidat, lockfile ciblé, installation reproductible, extraction HTML et builds. Une dépendance transitive peut rester légitimement.      |
| M10 | Famille CSS de l'ancienne carte métrique, `styles.css:3139` et suivantes    | Composant de carte supprimé dans l'évolution Robot ; sélecteurs canvas/grille/pose sans markup actuel ; moyenne à élevée selon sélecteur | Supprimer règle par règle après matrice de classes et captures ciblées. Les groupes de sélecteurs contiennent encore des classes vivantes.               |
| M11 | Rôle `preparation`, `assistant-core/src/model-profiles.ts:3/16`             | Préfixe `PREPARATION=` sans producteur actuel ; rôle encore validé par `chat-eval/src/campaign-profile.ts:14` ; moyenne                  | Option historique à déprécier avec lecture compatible des profils/manifestes, pas suppression aveugle de l'enum. Tests de chargement de profils anciens. |

Chemins des packages abrégés dans ce tableau : sous `packages/` ; chemins web/hub : sous `apps/`.

**Exceptions vérifiées :**

- `applyMaisonChanges` est appelé par le bootstrap : ce n'est pas du code mort.
- `axes` est le rollback documenté ; `legacy` reste sélectionnable. Ni l'un ni l'autre ne disparaît sans décision séparée. Les archives Assistant, leurs tables et les migrations sont encore nécessaires.
- Le retour `unified-runner` → `runner` du banc importe des **types** : le cycle détecté en incluant les types n'est pas une boucle d'exécution. Extraire les types dans un module neutre clarifiera la dépendance.
- `.robot-map-modal`, `.robot-map-status` et `.robot-map-object-placeholder` sont encore utilisés par les vues du graphe/Robot. Un nom contenant `map` n'est pas une preuve d'obsolescence.
- Les 46 classes sans littéral trouvé par le balayage CSS ne sont pas 46 suppressions prouvées : classes d'état interpolées, sélecteurs groupés et styles partagés produisent des faux positifs.
- `infra/systemd/friday-robot.service` et `robot/deploy/friday-robot.service` ont des utilisateurs, chemins et dépendances différents. Clarifier le statut du modèle générique ; conserver le montage veille/réveil utilisé par le runbook.
- Les répertoires de scaffold `config` / `test-support` ne justifient pas la création d'une nouvelle couche de fixtures. Les fixtures Maison partagées existent déjà.

## 7. Frontières de modules et dépendances cibles

Les noms ci-dessous sont des destinations proposées, pas des fichiers déjà créés. Une façade temporaire peut conserver les imports publics pendant une extraction, mais doit être orientée vers le nouveau module et ne pas recréer un cycle.

| Ensemble                          | Responsabilités cibles                                                                                         | Dépendances autorisées et invariants                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PWA shell                         | `app/AppShell`, navigation ; hooks session/sync ; `today`, `agenda`, `settings`                                | Écrans → services/dépôts → contrats/domaine. État rapproché de son écran ; les hooks partagés ne portent pas tout le métier.                                 |
| Budget / Chat / Veille / Robot UI | Sections de lecture, formulaires/dialogues, hooks de chargement propres au domaine                             | Présentation séparée des calculs déjà présents dans `domain` ; polling/annulation à un propriétaire explicite.                                               |
| Maison UI/actions                 | Recettes/planning, réception, préparation/consommation, contributions Courses ; éditeurs Réserve par opération | Une confirmation métier produit toujours la même commande composite atomique, mêmes IDs/révisions.                                                           |
| Persistance PWA                   | `db/device-context`, `sync/outbox-repository`, `sync/apply-changes` ; dépôts de domaine                        | Socle indépendant de Maison/Tâches. Orchestrateur au-dessus des adaptateurs ; transaction complète conservée.                                                |
| Hub                               | Plugins `auth`, `sync`, `groceries`, `watch`, `robot`, archive ; dépôt de préférences                          | Composition crée/injecte services ; routes valident/authentifient et délèguent. Services ne dépendent pas de Fastify.                                        |
| IA/Web Hub                        | `inference` et `integrations/web`                                                                              | Un ordonnanceur et un ledger communs ; adaptateurs séparés du métier ; contrôles des données/URL externes conservés.                                         |
| Chat Core                         | Contexte/continuité, session de recherche, budget du run, pipeline, publication                                | Réutiliser `documents`, `passages`, `synthesis`, `research-memory`. Pas de dépendance vers SQLite/React/Hub. Pipelines séparés là où leurs règles diffèrent. |
| Veille                            | Dépôt SQL, planificateur pur, collecteur, rapprochement, digest                                                | Orchestrateur conserve ordre, non-chevauchement et fermeture ; dépôt ne lance pas de modèle.                                                                 |
| Robot Hub                         | Dépôt du graphe, reconnaissance, suivi, règles de transition, orchestrateur                                    | Appels matériels derrière contrôleur existant ; un propriétaire de sérialisation/annulation ; aucun run repris au démarrage.                                 |
| Contrats                          | Commun, domaines, unions sync, barrel                                                                          | Domaines n'importent pas le barrel racine ; unions composent les schémas de domaine ; exports publics inchangés.                                             |
| Migrations                        | Modules numérotés + registre statique                                                                          | Schéma indépendant des services, même SQL et séquence, mêmes réparations conditionnelles. Aucun chargeur dynamique de fichiers SQL introduit.                |
| Banc                              | Types de résultat/cas indépendants, runners, campagne, adaptateurs                                             | Types communs sans import d'exécuteur ; moteur partagé conservé ; sorties de campagne et manifestes compatibles.                                             |
| CSS/tests                         | Fondations → composants → domaines ; suites et fixtures explicites                                             | Cascade conservée ; tests indépendants et assertions métier conservées ; aucune abstraction universelle sans responsabilité claire.                          |

### Inventaire complet des fichiers de plus de 500 lignes

Les tests peuvent être divisés par comportement sans changer leurs assertions. Les gros modules conservés doivent justifier leur cohésion plutôt que contourner un contrôle de taille.

| Fichier                                                                                                                    | Lignes | Frontière à examiner                                                |
| -------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------- |
| [apps/web/src/styles.css](../../apps/web/src/styles.css)                                                                   |   5387 | Fondations, composants, domaines ; cascade.                         |
| [tests/e2e/offline-task.spec.ts](../../tests/e2e/offline-task.spec.ts)                                                     |   3158 | Suites de domaine et fixtures.                                      |
| [apps/web/src/App.tsx](../../apps/web/src/App.tsx)                                                                         |   2937 | Shell, navigation, session/sync, écrans.                            |
| [apps/hub/src/watch/watch-service.ts](../../apps/hub/src/watch/watch-service.ts)                                           |   2262 | Planification, collecte, rapprochement, digest, dépôt.              |
| [apps/hub/src/app.ts](../../apps/hub/src/app.ts)                                                                           |   2133 | Composition, plugins HTTP, préférences.                             |
| [packages/contracts/src/index.ts](../../packages/contracts/src/index.ts)                                                   |   2124 | Schémas par domaine et unions sync.                                 |
| [apps/hub/src/db/database.ts](../../apps/hub/src/db/database.ts)                                                           |   2034 | Registre et migrations numérotées ; SQL inchangé.                   |
| [apps/hub/src/robot/robot-visual-topology.ts](../../apps/hub/src/robot/robot-visual-topology.ts)                           |   1969 | Graphe, reconnaissance, observation, transitions.                   |
| [apps/web/src/BudgetView.tsx](../../apps/web/src/BudgetView.tsx)                                                           |   1888 | Synthèse, projections, formulaires et dialogues.                    |
| [packages/assistant-core/src/runtime.ts](../../packages/assistant-core/src/runtime.ts)                                     |   1826 | Contexte, recherche, budgets, orchestration et publication.         |
| [apps/hub/src/app.test.ts](../../apps/hub/src/app.test.ts)                                                                 |   1636 | Suites par invariant et fixtures ; conserver toutes les assertions. |
| [apps/web/src/WatchView.tsx](../../apps/web/src/WatchView.tsx)                                                             |   1177 | Sections, dialogues et hooks de chargement par domaine.             |
| [apps/hub/src/robot/robot-autonomy.ts](../../apps/hub/src/robot/robot-autonomy.ts)                                         |   1174 | Machine de modes et décisions ; un seul propriétaire du run.        |
| [apps/hub/src/auth/auth-service.ts](../../apps/hub/src/auth/auth-service.ts)                                               |   1111 | Enrôlement, appareils, révocation et adaptateur auth.               |
| [apps/web/src/RobotView.tsx](../../apps/web/src/RobotView.tsx)                                                             |   1049 | Sections, dialogues et hooks de chargement par domaine.             |
| [apps/web/src/AssistantView.tsx](../../apps/web/src/AssistantView.tsx)                                                     |   1016 | Sections, dialogues et hooks de chargement par domaine.             |
| [apps/web/src/db/task-repository.ts](../../apps/web/src/db/task-repository.ts)                                             |    988 | Contexte, outbox/ack/pull, opérations Tâches.                       |
| [apps/hub/src/db/database.test.ts](../../apps/hub/src/db/database.test.ts)                                                 |    958 | Suites par invariant et fixtures ; conserver toutes les assertions. |
| [apps/hub/src/chat/verified-chat-engine.test.ts](../../apps/hub/src/chat/verified-chat-engine.test.ts)                     |    897 | Suites par invariant et fixtures ; conserver toutes les assertions. |
| [apps/hub/src/robot/robot-vision.ts](../../apps/hub/src/robot/robot-vision.ts)                                             |    869 | Backends et traitement de trames ; alternatives à revalider.        |
| [apps/web/src/db/budget-repository.ts](../../apps/web/src/db/budget-repository.ts)                                         |    800 | Cache/CRUD et écritures outbox, via socle commun.                   |
| [apps/hub/src/watch/watch-service.test.ts](../../apps/hub/src/watch/watch-service.test.ts)                                 |    734 | Suites par invariant et fixtures ; conserver toutes les assertions. |
| [apps/hub/src/chat/chat-service.ts](../../apps/hub/src/chat/chat-service.ts)                                               |    717 | Dépôt, admission des runs, mémoire et cycle de vie.                 |
| [apps/hub/src/groceries/grocery-classification-service.ts](../../apps/hub/src/groceries/grocery-classification-service.ts) |    673 | Jobs, propositions et application atomique.                         |
| [apps/web/src/MaisonView.tsx](../../apps/web/src/MaisonView.tsx)                                                           |    665 | Sections, dialogues et hooks de chargement par domaine.             |
| [apps/web/src/maison/ReserveEditors.tsx](../../apps/web/src/maison/ReserveEditors.tsx)                                     |    634 | Réception, stock, préparation et consommation.                      |
| [apps/hub/src/watch/feed-client.ts](../../apps/hub/src/watch/feed-client.ts)                                               |    609 | Collecte/parsing et extraction documentaire partagée.               |
| [apps/hub/src/robot/robot-controller.ts](../../apps/hub/src/robot/robot-controller.ts)                                     |    561 | Commandes et garde-fous ; conserver une façade de contrôle.         |
| [packages/chat-eval/src/runner.ts](../../packages/chat-eval/src/runner.ts)                                                 |    552 | Types partagés puis exécution et métriques.                         |
| [packages/assistant-core/src/passages.ts](../../packages/assistant-core/src/passages.ts)                                   |    549 | Sélection lexicale/hybride ; garder les règles cohésives.           |
| [apps/web/src/maison-actions.ts](../../apps/web/src/maison-actions.ts)                                                     |    532 | Recettes, planning, réception, consommation, contributions.         |
| [packages/chat-eval/src/campaign.ts](../../packages/chat-eval/src/campaign.ts)                                             |    523 | Planification de campagne, exécution, rapports.                     |
| [apps/hub/src/sync/sync-service.ts](../../apps/hub/src/sync/sync-service.ts)                                               |    509 | Validation, pagination, application transactionnelle.               |
| [apps/hub/src/robot/robot-visual-topology.test.ts](../../apps/hub/src/robot/robot-visual-topology.test.ts)                 |    501 | Suites par invariant et fixtures ; conserver toutes les assertions. |

## 8. Feuille de route exécutable

Effort relatif : **S** = changement local et quelques tests ; **M** = plusieurs fichiers d'un domaine ; **L** = plusieurs frontières et scénarios. Ce sont des tailles de lot, pas des engagements calendaires. Un lot L doit être livré en extractions indépendantes, jamais en réécriture globale.

| Lot                          | Prérequis                  | Livrable et critère de sortie                                                                      | Effort / risque                | Non-régression ciblée et retour arrière                                                                                                                                                              |
| ---------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0 — Référence de correction | Cet audit                  | Reprendre capture/manifest ; transformer Q01–Q03 en tests permanents échouant pour la bonne raison | S / faible                     | Base jetable, aucune donnée réelle. Conserver les journaux rouge puis vert, sans réécrire les résultats historiques.                                                                                 |
| L1a — Coffre local           | L0                         | Q01 corrigé, contexte unique pour toutes les premières écritures                                   | M / élevé                      | Concurrence, crypto lente, deux contextes, données anciennes lisibles. Pas de migration/rotation ; revert du code si comparaison divergente, ne jamais purger le coffre.                             |
| L1b — Admission Menus        | L0                         | Q02 corrigé indépendamment de la liste affichée                                                    | S / moyen                      | Plus de 40 entrées et admission commune Chat/Menus. Revert de la requête/règle, sans supprimer les jobs persistés.                                                                                   |
| L1c — Compatibilité sync     | L0                         | Q03 corrigé avec détection ciblée d'incompatibilité                                                | M / élevé                      | Nouveau → ancien → nouveau, lot mixte, doublons/curseurs. Revert du client ; les opérations non acquittées restent en attente.                                                                       |
| L2 — Retraits et docs        | L1 validés                 | M01–M05/M07/M09 seulement après preuve finale ; Q11 ciblé ; M06/M08/M10/M11 selon garde-fous       | S par retrait / faible à moyen | Un retrait indépendant par famille ; builds publics, fixtures, liens. Revert des fichiers et du lockfile correspondants ; aucun retrait de données/migration.                                        |
| L3a — Socle sync             | L1a/L1c                    | Q04 : cycle supprimé, dépôts limités à leur domaine, API façades compatibles                       | L / élevé                      | Comparaison des mutations complètes, outbox, pagination composite, tombstones, curseurs et chiffrement. Une extraction par patch, revert sans changement de schéma.                                  |
| L3b — Socle IA               | L1b                        | Q05 : services déplacés, instance unique et politique inchangées ; types banc séparés              | M / moyen                      | FIFO, génération/embeddings, annulations indépendantes, durée globale et ledger partagé. Revert des imports/composition ; conserver formats des jobs.                                                |
| L4a — Contrats/migrations    | L3a                        | Q08 : modules de domaine et registre de migrations, exports stables                                | M / élevé                      | Corpus Zod, anciens payloads, DB neuve et upgrades. SQL/numéros/AAD inchangés ; rollback du code, aucune migration inverse nécessaire.                                                               |
| L4b — Routes Hub             | L3a/L3b                    | Q06 : plugins par domaine, composition et préférences clarifiées                                   | L / moyen                      | Réponses HTTP, auth/origines, erreurs, fermeture ; déplacer un domaine à la fois avec façade transitoire.                                                                                            |
| L4c — Écrans et actions      | L3a                        | Q06/Q12 : shell puis Aujourd'hui/Agenda/réglages ; Budget, Maison, Chat, Veille et Robot par lots  | L / moyen                      | États/navigation, focus/dialogues, calculs, identité des commandes, offline et lazy. Revert d'un écran/module sans migration Dexie.                                                                  |
| L5a — Chat                   | L3b, corpus de traces      | Q07/Q09 : orchestration lisible et parité des adaptateurs mesurée                                  | L / élevé                      | Textes/statuts/sources/codes/appels identiques sur fixtures, pannes d'audit/corrections, mémoire privée/causale, Local et anciens dossiers absents. Revert d'extraction ; prompts/modèles inchangés. |
| L5b — Veille                 | L3b/L4b                    | Planification et dépôt extraits puis collecte/digest                                               | L / moyen                      | Horloge contrôlée, collecte partielle, dédoublonnage, annulation/fermeture et profil privé ; revert par responsabilité.                                                                              |
| L5c — Robot                  | Traces simulées préalables | Topologie puis autonomie/vision si leur cohésion le justifie                                       | L / élevé                      | Expiration, arrêt, changement de mode, observation sérialisée et aucun redémarrage de run ; revert par module. Aucune recette physique déclenchée par ce plan.                                       |
| L6 — CSS/tests/outils        | Domaines extraits          | Q10/Q12 : cascade organisée, suites autonomes, scripts et contrôles d'architecture                 | M / moyen                      | Comparaison visuelle ciblée, suite isolée puis ensemble ; build offline et wrapper Windows. Revert import CSS/config, sans effacer caches utilisateurs.                                              |

L1a/b/c sont des corrections fonctionnelles explicites ; L3–L6 visent un comportement constant. Ne pas mélanger une correction de prompt, un changement de quota ou une règle métier à une extraction. La sauvegarde/restauration complète et la qualification réelle Chat restent des chantiers distincts, soumis à leur reprise documentée.

### Portes de sortie de chaque lot

1. Décrire l'invariant et le périmètre ; ajouter seulement les tests nécessaires quand il manque une protection. Pour Q01–Q03, constater d'abord l'échec du scénario attendu.
2. Pour une extraction, exécuter les mêmes fixtures avant/après et comparer sorties, erreurs, mutations persistées et séquences d'appels. Les traces normalisent uniquement UUID/horloge contrôlés, pas les différences métier.
3. Tests ciblés puis **`pnpm verify` complet**, dans l'environnement isolé décrit plus haut. Inspecter résultats et avertissements, pas seulement le code de sortie d'un wrapper.
4. Contrôler imports publics/API HTTP, formats persistés, AAD et ordre de migration. Interdire tout nouveau cycle d'exécution ; documenter temporairement les exceptions restantes. Les cycles de types sont signalés séparément.
5. Revoir le diff et conserver une frontière de rollback par lot. Ne pas fusionner les changements locaux préexistants par inadvertance dans le lot.
6. Mettre à jour le runbook et l'état canonique lors d'une évolution structurante. **Le passage des tests n'autorise pas un déploiement dans le cadre de cet audit** : la séquence habituelle de recette/restart reste réservée à une future exécution runtime explicitement engagée.

**Critère de réussite :** responsabilités compréhensibles, dépendances orientées, suppressions étayées, formats compatibles et aucune régression détectée dans les comportements protégés. Les recettes réelles des deux téléphones et du Robot restent identifiées séparément. Aucun nettoyage, déploiement, achat, accès à un compte ou campagne longue de modèles n'a été exécuté pour produire ce rapport.

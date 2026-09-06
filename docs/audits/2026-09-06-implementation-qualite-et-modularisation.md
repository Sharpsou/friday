# Friday — corrections et modularisation du 6 septembre 2026

Statut documentaire : archive.

Ce bilan accompagne l'implémentation poursuivie après l'[audit actualisé](2026-09-05-qualite-code-et-modularisation.md). L'audit historique reste intact. Le périmètre est le code et ses protections automatisées : aucun déploiement, campagne de modèles ou mouvement Robot n'a été déclenché.

## 1. Résultat

Trois défauts reproduits ont été corrigés : initialisation concurrente du coffre, quota Menus limité par l'historique visible et blocage des tâches après retour à un ancien Hub. Les responsabilités de synchronisation, inférence, HTTP, contrats, migrations, écrans et orchestrateurs ont été séparées. Les retraits concernent des consommateurs internes absents et des styles obsolètes prouvés.

**Validation finale : `pnpm verify` réussi sur une sortie Web vide, code de sortie 0, 544 tests.** Format, lint, typage (E2E compris), architecture et builds passent. Aucune régression détectée par ces contrôles. Preuves : `verify-complete.log` et `verify-complete.exit` dans le dossier ci-dessous.

SQLite reste en **47**, Dexie en **9**. Aucun changement de prompt, modèle, format chiffré, AAD, règle de calcul Budget, seuil Robot ou protocole HTTP n'est inclus. La gate qualitative Chat demeure refusée ; aucune réussite téléphone ou physique n'est déduite des tests.

## 2. Référence et reproductibilité

- HEAD inchangé : `362bf801cd8db665d552f6151efa547463be454d`, branche `main`.
- Le workspace comportait déjà les évolutions non commitées du 5 septembre. Elles sont préservées ; aucun staging, commit, reset ou nettoyage global n'a été effectué.
- Référence avant travaux : 381 fichiers, dont le rapport d'audit. Capture sous `D:\FridayData\audits\modularisation-20260906` : `before.json` (SHA-256 par fichier), `before.patch`, `before.zip` avec chemins relatifs et `before-src/` extrait.
- La capture initiale de l'audit reste séparée sous `D:\FridayData\audits\quality-code-20260905-01`.
- Les preuves de ce lot sont synthétiques : SQLite mémoire, IndexedDB simulé avec WebCrypto réel, Chrome et réponses API simulées quand le scénario le prévoit. Aucune donnée personnelle n'a servi aux reproductions.
- Environnement exécuté : Node 24.15.0, pnpm 11.19.0. Les contraintes du dépôt restent Node 24 et pnpm 11 ; le lockfile a été modifié uniquement pour les retraits/alignements décrits plus bas.

Commande de référence, dans un processus PowerShell dédié :

```powershell
Get-ChildItem Env:FRIDAY_* | Remove-Item
$env:FRIDAY_ROBOT_MODE = 'disabled'
$env:FRIDAY_DATABASE_PATH = ':memory:'
$env:FRIDAY_DATA_DIR = 'D:/FridayData/audits/modularisation-20260906/test-data'
$env:FRIDAY_E2E_PORT = '18443'
$env:FRIDAY_CHAT_ENABLED = 'true'
$env:FRIDAY_CHAT_PIPELINE = 'unified'
pnpm verify
```

Le wrapper impose `.verification/web` pour la sortie et le serveur PWA de test. Les builds Hub/packages sont reconstruits, mais aucun service domestique n'est redémarré. Les preuves locales ne constituent pas un déploiement entièrement isolé de tous les répertoires de build.

Le contrôle des artefacts a montré que Vite conservait d'anciens chunks dans cette sortie située hors de sa racine. Le wrapper vide désormais uniquement `.verification/web` avant le build, après vérification de son chemin réel ; un chemin redirigé est refusé. Le dernier contrôle repart ainsi d'une sortie vide et vérifie le précache des seuls artefacts reconstruits.

| Suite finale         | Tests réussis |
| -------------------- | ------------: |
| Python Robot         |            27 |
| Contrats             |            25 |
| Assistant Core       |            40 |
| Domaine              |            27 |
| Hub                  |           192 |
| PWA                  |           140 |
| Banc Chat            |            61 |
| Playwright           |            29 |
| Garde d'architecture |             3 |
| **Total**            |       **544** |

`pnpm install --frozen-lockfile --offline` réussit également. Après la vérification du code, seuls le bilan documentaire et les archives de preuves sont finalisés. `after.json`, `after.zip` et `seal.json` identifient la capture finale et les empreintes des résultats ; la présence du chunk Budget dans le précache Workbox est contrôlée. Les 12 documents modifiés et leurs 62 liens locaux passent le contrôle de liens et d'encodage.

## 3. Corrections et protections

| Constat                 | Correction effective                                                                                                                                                                                                                       | Preuve de non-régression                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01 — coffre concurrent | `db/device-context.ts` arbitre identité et clé dans une transaction. La génération WebCrypto précède la transaction ; la clé persistée est relue et conservée. Les profils historiques ont leurs constantes dans `db/profile-defaults.ts`. | Premières écritures Tâches/Courses concurrentes, génération lente, clé existante, deux connexions IndexedDB indépendantes ; chiffrement/déchiffrement vérifiés. `red-web.log`, `green-web.log`, `device-context.test.ts`.                                                 |
| Q02 — quota Menus       | `menu-ai-service.ts` compte tous les jobs actifs en SQL, puis ajoute les jobs Chat. L'affichage reste limité à 40, la limite d'admission reste quatre.                                                                                     | Trois anciens jobs, plus de 40 annulations, admission jusqu'au plafond, refus suivant, profil distinct et idempotence. `red-hub.log`, `green-hub.log`.                                                                                                                    |
| Q03 — ancien Hub        | Sur un 400 contenant Maison, revalidation explicite du snapshot. Seul un endpoint absent autorise le filtrage des commandes incompatibles ; les IDs sont conservés. La sélection repart de l'outbox complète, avant la limite de 100.      | Hub récent → ancien → récent, 1 puis 101 commandes Maison et une tâche, reprise sans doublon ; un vrai 400 d'un Hub compatible reste visible. `red-sync-backlog.log` reproduit la tâche bloquée derrière la première page, `green-sync-backlog.log` valide la correction. |

Le fichier `vault.ts`, le schéma Dexie et les déclarations du mécanisme d'envoi Chat incertain sont conservés. Pour ce dernier, seul l'import du contexte appareil change. L'authentification serveur, les prompts, profils de modèles et le serveur Python Robot sont identiques à la capture avant travaux.

Les tests existants d'atomicité Maison/outbox, conflits composites, pagination, causalité et confidentialité Chat, budget Web, FIFO/annulation d'inférence, calculs Budget et sécurité Robot ont été rejoués. Les nouvelles protections ciblent les défauts reproduits ; elles ne prétendent pas couvrir toutes les combinaisons temporelles possibles.

## 4. Frontières implémentées

Les dépendances suivent désormais ces directions :

- Les domaines PWA utilisent `device-context` et `outbox-repository`. `sync-repository` applique les acquittements/changements vers les domaines ; les tâches n'importent plus Maison pour rendre ces services transversaux.
- Le Hub compose une seule instance d'`inference/inference-scheduler.ts` et d'`integrations/web/web-budget.ts`. Chat, Menus, Veille, classement et photo gardent leurs adaptateurs et la file commune.
- `app.ts` compose les services puis enregistre les routes par domaine dans `http/`. Les fonctions s'exécutent dans le même scope Fastify : aucune encapsulation de plugin ne modifie les hooks ou fermetures existants.
- Les contrats sont répartis par domaine, avec `common.ts`, les unions `sync.ts` et un barrel public. Les imports internes `.ts` sont nécessaires au chargement natif du package source par le Hub construit.
- Les constantes SQL sont dans `db/migrations/` ; le registre et les réparations conditionnelles restent dans `database.ts`, notamment les étapes 19 et 46. La migration Maison ne dépend plus du service de synchronisation.
- L'App compose navigation, Aujourd'hui, Agenda, Maison, Courses, réglages et dialogues depuis `web/src/app/`. Les formulaires Budget, le modèle de présentation Budget, les composants Veille, le Chat actif et les commandes/éditeurs Maison ont leurs modules de domaine.
- Le cœur Chat conserve une composition commune et trois fonctions de pipeline distinctes. Publication et politiques de récupération restent séparées des fournisseurs. Aucun chemin historique atteignable n'est fusionné avec `unified`.
- Veille sépare dépôts SQL, thèmes, planification, politiques et digest. Robot sépare dépôt du graphe, types et politiques autour de sa file d'observations sérialisée.
- Le banc importe ses types communs depuis `evaluation-types.ts`. Le lien réciproque précédent comprenait un import de types ; il n'est pas présenté comme une boucle d'exécution.

### Mesures de taille

Lignes physiques, même méthode que l'audit. Les nombres servent à rendre le découpage vérifiable, pas à définir une norme de qualité.

| Fichier initial                          | Avant |    Après | Responsabilités déplacées                             |
| ---------------------------------------- | ----: | -------: | ----------------------------------------------------- |
| `web/src/App.tsx`                        | 2 937 |      348 | Écrans, dialogues, navigation et coordination séparés |
| `hub/src/app.ts`                         | 2 133 |      426 | Routes par domaine et support HTTP                    |
| `web/src/db/task-repository.ts`          |   988 |      621 | Contexte, outbox et application de sync               |
| `assistant-core/src/runtime.ts`          | 1 826 |      620 | Trois pipelines, publication et récupération          |
| `hub/src/watch/watch-service.ts`         | 2 262 |      942 | Dépôts, thèmes, planification, digest et politiques   |
| `hub/src/robot/robot-visual-topology.ts` | 1 969 |    1 332 | Dépôt SQL, snapshot, types et politiques              |
| `hub/src/db/database.ts`                 | 2 034 |      189 | SQL numéroté, sans modifier les migrations            |
| `contracts/src/index.ts`                 | 2 124 |       12 | Barrel des contrats de domaines                       |
| `web/src/styles.css`                     | 5 387 |       16 | Quinze imports dans l'ordre de cascade                |
| `tests/e2e/offline-task.spec.ts`         | 3 158 | remplacé | Dix suites et fixture explicite                       |

L'inventaire passe de **16 à 5 fichiers de plus de 1 000 lignes**. Il compte **36 fichiers de plus de 500 lignes**, contre 34 auparavant : certaines responsabilités extraites restent volontairement substantielles. Il n'y a pas de promesse artificielle de faire baisser tous les seuils.

Les cinq grands fichiers conservés sont justifiés :

| Module                                   | Lignes | Motif de conservation                                                                                                                                                                                                              |
| ---------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub/src/app.test.ts`                    |  1 636 | Intégration HTTP complète avec fixtures communes ; les handlers de production sont séparés.                                                                                                                                        |
| `hub/src/auth/auth-service.ts`           |  1 111 | Frontière de session/enrôlement/révocation conservée, sans changement d'identité ou de protocole.                                                                                                                                  |
| `hub/src/robot/robot-autonomy.ts`        |  1 174 | Machine d'état et sécurités temporelles étroitement liées ; aucune nouvelle refonte physique dans ce lot.                                                                                                                          |
| `hub/src/robot/robot-visual-topology.ts` |  1 332 | Reconnaissance, transitions et sérialisation restent réunies après extraction du stockage ; préserver l'ordre des observations est prioritaire.                                                                                    |
| `web/src/app/use-app-controller.tsx`     |  1 213 | Les états qui survivent aux changements d'écran et les actions liées à la sync restent au niveau de l'App. Leur déplacement sous des écrans démontables changerait leur durée de vie. Le hook reste une limite de couplage connue. |

Ces exceptions sont explicites, sans affirmer que toute dette a disparu. Un futur déplacement d'état ou découpage des machines Robot doit d'abord caractériser ses durées de vie et transitions ; aucun découpage supplémentaire n'est imposé par le nombre de lignes seul.

## 5. Retraits prouvés et exceptions

| Candidats de l'audit                                                            | Décision appliquée                                                                                                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 `routeAndPlanQuestion`, M02 `retrievalQueriesForPlan`, M03 `aspectCoverage` | Helpers sans consommateur interne retirés ; pipelines, métriques effectivement appelées et commandes CLI préservés.                                |
| M04 `suggestWatchSources`                                                       | Wrapper PWA sans appelant retiré ; endpoint Hub conservé.                                                                                          |
| M05 `CHAT_RUNTIME_VERSIONS`                                                     | Constante sans lecture et réexport Hub retirés ; aucun ajout de télémétrie.                                                                        |
| M07 `stopRobotAutonomy` / `armRobot`                                            | Wrappers PWA sans appelant retirés ; routes d'arrêt et commandes actives conservées.                                                               |
| M09 Readability                                                                 | Dépendance directe Hub retirée ; aucun import/require/config/CLI actif ne la consommait. Lockfile ciblé et installation gelée vérifiés.            |
| M10 ancienne carte métrique                                                     | 28 sélecteurs obsolètes retirés ; les groupes mixtes gardent leurs sélecteurs actifs, dont dialogues et éléments du graphe actuel.                 |
| M06 seed Budget                                                                 | Conservé comme support opérationnel, même sans consommateur TypeScript direct.                                                                     |
| M08 MobileNet alternatif                                                        | Conservé : les besoins de backend/rollback matériel ne sont pas tranchés par une absence d'instanciation courante. Aucune dépendance ONNX retirée. |
| M11 rôle `preparation`                                                          | Lecture historique des profils/manifeste conservée ; aucune suppression d'enum compatible glissée dans le nettoyage.                               |

Les packages concernés sont privés au dépôt. Les recherches ont croisé les imports, exports, entrées dynamiques, manifestes, scripts et usages documentés ; l'absence d'une occurrence textuelle seule n'a pas suffi. Les archives Assistant, `axes`, le pipeline legacy et toutes les migrations restent présents. Les exports des façades encore utilisées et les contrats HTTP restent compatibles ; les seuls retraits de symboles sont explicitement listés ci-dessus.

## 6. Preuves de comportement constant

Les comparateurs conservés hors dépôt dans le dossier de preuves produisent `comparison.json` et `final-proofs.json` :

- 73 corps de handlers HTTP comparés à la référence ; seules leurs dépendances de composition sont déplacées.
- Trois corps de pipeline Chat identiques après remplacement explicite du receveur `this` par les services injectés.
- 22 méthodes des dépôts Veille, 11 méthodes du dépôt Robot et le digest Veille comparés, avec le paramètre explicite `currentPlaceId` pour le snapshot Robot.
- 43 constantes SQL historiques comparées byte à byte ; les autres étapes inline et Maison restent dans le registre et sont protégées par les tests DB.
- 34 déclarations de calcul du modèle de présentation Budget identiques dans l'arbre TypeScript.
- 27 scénarios E2E intégralement identiques. Deux changements intentionnels : attendre le contrôle effectif du service worker avant la recharge offline Chat ; établir explicitement un foyer sans tâches pour le scénario qui vérifie l'état vide. Les assertions métier sont conservées.
- Quinze modules CSS : arbre ordonné des règles, déclarations et media queries identique à l'ancien fichier après soustraction des 28 sélecteurs prouvés morts. L'ordre des imports est imposé dans `styles.css`.
- Corpus HTML fixe : extraction identique avec jsdom 26 du banc et 30 du Hub avant alignement. Le banc utilise maintenant jsdom 30.0.1 et ses types 30.0.0 ; le test de parité reste présent et couvre entités, HTML mal formé, tableaux, listes, navigation et scripts inertes.

Ces comparaisons vérifient les extractions ciblées ; elles ne prouvent pas à elles seules la totalité du comportement dynamique. Elles complètent les suites de régression.

### Suites et outils

Les lots L1, fondations, schémas, UI et orchestrateurs disposent chacun d'un `verify-*.log` et d'un code de sortie 0 dans le dossier de preuves. Le dernier gate des orchestrateurs comportait 539 tests. Les protections finales ajoutent le corpus DOM, le cas de backlog supérieur à 100 et les trois tests de la garde d'architecture.

Le découpage E2E a révélé une dépendance à l'ordre : le test de liste vide arrivait auparavant avant toute création de tâche. `clearHouseholdTasks()` établit cette précondition par le protocole sync du Hub jetable ; aucune assertion d'écran vide n'est supprimée. Les dix suites passent ensuite chacune avec un Hub neuf : `e2e-alone-results.json` et `e2e-alone-*.log`. Les E2E font désormais aussi partie du typage via `tsconfig.e2e.json`.

Une tentative de vérification supplémentaire s'est arrêtée sur la sortie inattendue d'un worker Vitest, avec 190 tests Hub terminés sur 192 et sans assertion échouée (`verify-final-clean.log`). Le rejeu détaillé des 192 tests Hub passe sans changement de code ni de concurrence (`hub-worker-recheck.log`). La cause de cet arrêt isolé n'est pas établie ; le journal est conservé, aucun test n'est exclu et le contrôle global est rejoué intégralement.

`pnpm architecture` échoue sur les cycles d'exécution et les dépendances interdites des fondations. Il analyse les imports/exports TypeScript locaux, chargements dynamiques littéraux et `require` littéraux, en excluant les liens de types seuls. **269 modules, 565 liens, aucune exception de cycle** sur cette référence. Les chargements calculés et Python ne sont pas couverts par cette garde.

Le bundle initial mesuré passe de **571,66 à 301,99 kB** minifiés (gzip : 165,07 → 89,24 kB). Le chunk Budget différé représente 32,95 kB ; le CSS passe de 80,73 à 75,20 kB. Ce sont des mesures de build, pas une promesse de fluidité réelle sur téléphone. Les avertissements Workbox `inlineDynamicImports` et Node `DEP0190` du wrapper Windows restent signalés, sans mise à niveau générale des outils.

## 7. Statut des lots et retour arrière

| Lot                            | Résultat                                                                                          | Risque résiduel / retour arrière                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| L1 — invariants                | Q01–Q03 corrigés et tests de reproduction conservés                                               | Revenir seulement au code précédent réintroduirait les défauts ; garder les tests pour l'identifier. Aucune donnée à migrer. |
| L2 — retraits/docs             | Candidats prouvés retirés ; M06/M08/M11 conservés ; documents courants distingués de l'historique | Restaurer la famille de fichiers et le lockfile ensemble depuis la capture avant travaux.                                    |
| L3 — fondations                | Sync et services IA transversaux extraits, dépendance Tâches/Maison supprimée                     | Restaurer imports, façades et modules en un ensemble cohérent ; aucun changement de singleton ou format persisté.            |
| L4 — domaines                  | Contrats, migrations, routes, écrans, commandes et éditeurs séparés                               | Restaurer chaque domaine avec sa façade ; conserver SQL, numéros et réparations conditionnelles.                             |
| L5 — orchestrateurs            | Trois pipelines Chat, dépôt/digest Veille, dépôt/politiques Robot extraits                        | Les machines d'état conservées restent complexes ; comparaisons et tests obligatoires avant un nouveau déplacement.          |
| L6 — styles/tests/architecture | CSS ordonné, dix suites, fixtures explicites, garde de cycles et typage E2E                       | Revenir au CSS et à sa liste d'import ensemble. Garder les corrections de préconditions E2E même en annulant un découpage.   |

Pour annuler ce lot sans perdre le travail antérieur, utiliser **la capture `before.zip`**, pas `git reset` : le HEAD ne contient pas tous les lots déjà livrés. Comparer les empreintes avant de restaurer, ne toucher qu'aux fichiers de ce lot et retirer seulement ses nouveaux modules devenus orphelins. Si de nouveaux changements sont intervenus depuis, fusionner manuellement les différences au lieu d'écraser le workspace. Rejouer les tests ciblés puis `pnpm verify`.

Le plan de modularisation est exécuté dans les limites explicites ci-dessus. Les dettes qualitatives Chat, les recettes téléphones/Robot et les exceptions de cohésion restent identifiées ; elles ne sont pas déclarées résolues par un nettoyage de code. Le déploiement reste hors de cette exécution, conformément au périmètre demandé.

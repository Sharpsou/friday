# Refonte documentaire Friday — 6 septembre 2026

Statut documentaire : archive.

Référence : `894a50d`. Rapport de la refonte documentaire, distinct des livraisons runtime.
Le dépôt était propre sur `main`, aligné avec `origin/main`, à l'ouverture du lot.
Au checkpoint documentaire initial, les changements étaient locaux, sans commit ni push.
La publication autorisée ensuite est consignée à la fin du rapport.

## Périmètre et méthode

Inventaire initial : 90 Markdown, un guide Word et trois exemples d'environnement.
Les sorties générées, dépendances et données privées sont exclues. Lecture des points
d'entrée, domaines, décisions et rapports ; confrontation ciblée aux responsabilités
actuelles, migrations, flags, protocoles et scripts. Les archives sont conservées pour
leur information et leur contexte, sans prétendre revalider toutes leurs anciennes
affirmations ou tous leurs liens Internet.

## Changements

Consolidation AGENTS/00/27/09/10/32 ; guides d'usage, Budget, installation, architecture
et contribution ; archivage de 26 fichiers et conservation de neuf versions cumulatives.
Index exhaustif, registre JSON, correction de liens et statuts, commande docs:check
intégrée au wrapper existant. Trois dépendances de développement MDAST/GFM déjà présentes
transitivement sont déclarées explicitement et résolues offline ; aucun runtime métier modifié.

Les informations Git, Maison, Chat et découpage ne sont plus confondues avec les
étapes antérieures. Les preuves historiques restent datées ; les campagnes Chat
restent arrêtées et les recettes physiques ouvertes.

L'[inventaire](../reference/inventaire-documentaire.md) classe **114 artefacts** :
110 Markdown, le Word et trois exemples d'environnement. Chaque entrée du JSON
contient public, rôle, statut, informations propres au document, références relevées,
revue, action, chemin final et, pour les sources initiales, chemin et empreinte d'origine.
Les 94 artefacts initiaux ont tous une destination recensée. Les neuf copies cumulatives
préservent les informations retirées des points d'entrée actifs ; les octets d'origine
restent accessibles dans Git à la référence ci-dessus.

| Famille déplacée             | Fichiers | Destination                          |
| ---------------------------- | -------- | ------------------------------------ |
| Décisions initiales 01–08    | 8        | `docs/archives/decisions-initiales/` |
| Checkpoints App              | 8        | `docs/archives/checkpoints-app/`     |
| Checkpoints Robot            | 8        | `docs/archives/checkpoints-robot/`   |
| Audits documentaires anciens | 2        | `docs/archives/audits/`              |
| Versions cumulatives copiées | 9        | `docs/archives/etats-techniques/`    |

Corrections principales : état Git repris à la bonne date, livraison de 12 h 04,
sept espaces dont Maison, Chat actif et mémoire privée SQLite 47, trois chemins
techniques de pipeline, ordonnanceur commun, responsabilités après découpage et
suffixes d'imports propres aux contrats. Les mentions « non commité » des rapports
restent datées. Les liens vers du code disparu sont conservés comme références
historiques textuelles lorsque leur cible n'existe plus.

Parcours relus : [README](../../README.md) → [utilisation](../guides/utilisation-friday.md),
[installation Windows](../guides/installation-windows.md) → configuration/exploitation,
et AGENTS → 00 → 27 → 09 → 10 → runbook → fondation Chat si nécessaire.
La [carte des responsabilités](../guides/architecture-developpement.md) remplace les
anciennes listes de gros fichiers ; l'annexe TypeScript préserve les explications utiles.

## Guide Word Budget

Les 88 paragraphes et cinq captures incorporées ont été extraits et examinés ;
les formules et gestes ont été confrontés à l'ADR et au code Budget courant.
Le Word du 10 août reste inchangé, avec ses captures datées. Le guide Markdown
actuel précise réserve financière/alimentaire, porte Budget et matérialisation des récurrences.
Le rendu complet DOCX a été tenté avec le renderer fourni : échec faute de LibreOffice
dans l'environnement Windows. Aucune nouvelle validation de mise en page Word n'est
revendiquée ; aucun fichier Word n'a été réécrit sans ce contrôle.

**Point restant ouvert :** reporter dans le Word la précision sur « À payer »
(fenêtre du mois et absence de double comptage), les récurrences matérialisées et
le contexte Maison, puis vérifier toutes les pages. Le Markdown courant les contient.
Le skill `documents` impose « Run `render_docx.py` to produce `page-<N>.png` images »
avant livraison DOCX et l'usage du LibreOffice fourni avec l'environnement.
Le renderer a signalé `LibreOffice soffice.exe was not found on PATH` ; aucun
LibreOffice n'est fourni ici. Cette réserve empêche de déclarer le volet Word
entièrement terminé.

## Vérifications

| Contrôle exécuté                                         | Résultat et portée                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm docs:check`                                        | 7 tests du vérificateur réussis ; corpus sans erreur de lien, ancre, casse, statut ou classement         |
| `pnpm exec prettier --write .`, puis `pnpm format:check` | Corpus désormais inclus dans le formatage ; conformité contrôlée                                         |
| `pnpm verify`                                            | Réussi : format, documentation, lint, types, architecture, tests, builds et E2E                          |
| Garde d'architecture                                     | 3 tests, 308 modules analysés ; aucun cycle runtime                                                      |
| Python Robot                                             | 27 tests simulés réussis                                                                                 |
| Vitest                                                   | 497 tests réussis : contrats 25, assistant-core 40, domain 27, Hub 204, PWA 140, chat-eval 61            |
| Playwright                                               | 30 scénarios réussis sur Chrome en format mobile ; aucune recette téléphone déduite                      |
| Vérification de couverture                               | 94 sources initiales retrouvées, 26 déplacements et neuf snapshots recensés ; Word inchangé              |
| Diff                                                     | `git diff --check` réussi ; aucun changement de code applicatif, contrat, migration, API ou Python Robot |
| PWA servie au foyer                                      | Les 22 empreintes des fichiers `apps/web/dist` sont restées identiques                                   |

Les 564 tests réunissent Python, Vitest, architecture, documentation et Playwright.
La première tentative globale a été arrêtée par Prettier sur le lockfile après ajout
des dépendances de développement ; formatage corrigé, puis suite globale réussie.
Les avertissements Node `DEP0190` et `NO_COLOR` sont non bloquants et concernent les outils de vérification.

Les tests documentaires couvrent accents et collisions d'ancres, références Markdown,
images, espaces/parenthèses, déplacements, encodage d'URL, chemins absents, différence
de casse sous Windows, documents non classés, doublons, statuts et inventaire humain.
Ils distinguent exemples de code et liens navigables ; aucun lien Internet n'est visité
par la gate locale. Les liens d'installation Node/mkcert ont été consultés séparément.

Le processus de vérification a nettoyé ses seules variables `FRIDAY_*`, imposé
`FRIDAY_DATABASE_PATH=:memory:`, un répertoire de données temporaire, Robot désactivé
et le port E2E 18443. Le wrapper conserve `.verification/web` et n'exécute aucun
lanceur familial. Les builds Hub/packages restent ceux prévus par la vérification existante.

## Installation neuve locale

Versions utilisées : Windows, Node 24.15.0, pnpm 11.19.0, Python 3.14.4 et Git 2.39.1.windows.1.
Elles respectent les contraintes Node 24 / pnpm 11 du dépôt ; le manifest reste épinglé à pnpm 11.16.0.

Une copie de 612 fichiers sources a été créée sans dépendances préinstallées,
données, certificats ou secrets du foyer. `pnpm install --frozen-lockfile --offline`
a réussi depuis le cache local, puis `pnpm build` a réussi dans cette copie.
Le Hub construit a été lancé sur `127.0.0.1:19444`, avec un nouveau dossier SQLite
dans `%TEMP%`, Chat et Robot désactivés, sans génération IA ni appel Web.

Le scénario a vérifié santé HTTP, PWA servie, bootstrap initial ouvert, création
d'un propriétaire fictif, fermeture du bootstrap, sync authentifiée et snapshot Maison.
Le secret a été créé avec la base. Après arrêt et redémarrage du **seul Hub temporaire**,
propriétaire et session existaient encore ; la sync répondait, SQLite était en version 47
et `integrity_check` retournait `ok`. Les processus créés pour cet essai ont été arrêtés.

Cette preuve porte sur le poste Windows existant, ses dépendances natives et son cache.
Elle ne valide pas un téléchargement sans cache, un autre ordinateur, l'administration
du pare-feu, HTTPS LAN, les certificats sur téléphone ou l'installation PWA réelle.

Les journaux et constats locaux non versionnés sont sous `output/docs-audit/` :
`verify.log`, `verify-format-initial.log`, `install.log`, `install-build.log`,
`installation-smoke.json`, `coverage.json` et revue de contenu `budget/review.json`.
Ils ne contiennent aucune donnée du foyer ; ils ne sont pas nécessaires au parcours lecteur.

## Limites

Au checkpoint initial : aucun déploiement, redémarrage du Hub familial, mouvement Robot, génération réelle de modèles,
campagne longue, commit ou push. Les contrôles documentaires ne constituent pas un
audit exhaustif de sécurité, une qualification Chat, une recette téléphone ou une
preuve d'installation sur un autre ordinateur.

## Publication autorisée

Après le checkpoint documentaire, l'utilisateur a demandé « Déploye tout et push ».
La présente section accompagne le commit de publication de la refonte. La source
applicative reste `894a50d` : aucun code métier, contrat, migration ou runtime Pi
n'est modifié par ce lot. Le push vise `origin/main` sur le dépôt Friday existant.

Vérification fraîche avant déploiement : `pnpm verify` réussi, 564 tests dont
30 scénarios navigateur, documentation, format, lint, types, architecture et builds.
Une première exécution a rencontré la sortie inattendue d'un worker Vitest Hub
(201 tests terminés sur 204). Les 204 tests Hub ont ensuite passé seuls, puis la
suite globale complète a passé sans modification du code ni des assertions.
La cause de cet arrêt isolé n'a pas été établie ; les journaux conservent l'incident.

Sauvegarde online pré-déploiement : `D:\FridayData\backups\maison-migration-uOy4w3\before.sqlite`.
Restauration de contrôle : `D:\FridayData\backups\maison-migration-uOy4w3\restored.sqlite`, intégrité `ok`, 47 → 47,
tables existantes inchangées. Artefacts précédents `web-before`, `hub-before` et
archive source Git `source-before.tar` conservés sous `D:\FridayData\audits\docs-publication-20260906-162141`.
Le secret et la configuration du foyer sont conservés à leur emplacement existant,
hors Git. Ces artefacts ne constituent pas une sauvegarde portable chiffrée.

Le lanceur autorisé a construit puis redémarré le Hub et affiché ses health checks réussis :

```powershell
infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Le **6 septembre 2026 à 16 h 30 (Paris)**, santé HTTPS locale et LAN `ok`,
SQLite 47 avec `integrity_check=ok` et aucune violation de clé étrangère.
Les **22 fichiers statiques** servis sur l'origine A17 correspondent au build
par SHA-256, ainsi que le HTML racine. Chat, snapshot Maison et état Robot
refusent les requêtes sans session (401). Le Hub est laissé actif, PID observé
`40464`. Chat est lancé avec le flag `true`, pipeline `unified`,
et la configuration Robot existante est reprise par le lanceur.

Le processus lanceur s'est terminé mais l'enveloppe PowerShell de collecte est
restée en attente après sa dernière sortie. Cette seule enveloppe a été arrêtée ;
le Hub est resté actif et son health check a été revérifié. Le code natif du lanceur
n'a donc pas été collecté : ne pas le présenter comme un code 0. Les contrôles
indépendants HTTPS, fichiers servis et intégrité ont, eux, terminé avec code 0.

Le retour arrière logiciel conserve la base courante, son secret et sa configuration,
et remet les artefacts précédents cohérents après arrêt du service. Ne pas écraser
les écritures récentes par la sauvegarde. Aucun rollback réel n'a été exécuté.

Les preuves sont conservées localement sous `output/docs-audit/` et recopiées dans
le dossier privé ci-dessus : `verify-publication.log`,
`verify-publication-worker-failed.log`, `hub-publication-recheck.log`,
`deployment.log`, `publication-health.json` et `publication-database.json`.
Le contrôle documentaire et le formatage sont rejoués après ajout de ce compte rendu.

Le Word Budget reste daté et son rendu ouvert. Aucune campagne qualitative Chat,
recette téléphone, commande de mouvement, mise à jour Pi ou modification d'outbox
mobile n'est réalisée par cette publication.

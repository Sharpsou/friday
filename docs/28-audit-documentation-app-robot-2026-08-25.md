# Audit de la documentation App + Robot

Date : 25 août 2026

Périmètre initial : `AGENTS.md`, 65 artefacts sous `docs/`, monorepo,
migrations, contrats, routes, navigation, scripts Windows, tests et base
SQLite active. La factorisation ajoute `README`, `27` et `28`, soit 68
artefacts documentaires à l’issue de l’audit.

## 1. Méthode

L’audit a confronté les documents à :

- `package.json`, le workspace pnpm et les versions installées ;
- `apps/web/src/App.tsx` et le schéma Dexie ;
- `apps/hub/src/app.ts`, `database.ts` et les services App/Robot ;
- les contrats Zod, le runtime Python et les scripts d’exploitation ;
- le dernier `pnpm verify`, le health check et la migration de la base active ;
- l’existence de chaque cible de lien Markdown relative.

Les README hors `docs/` ont aussi été relus : racine, runtime `robot/`,
certificats, exploitation Windows et packages de support. Les fichiers générés
et dépendances installées sont exclus du corpus documentaire du projet.

Une preuve automatisée, une observation matérielle et une capacité future ont
été traitées comme trois niveaux distincts.

## 2. Écarts trouvés

| Gravité | Écart                                                                                                            | Correction                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| haute   | `AGENTS.md` s’arrêtait à SQLite 19 et orientait le Robot vers un checkpoint antérieur à la relocalisation        | état réduit et renvoi vers le document canonique 27                      |
| haute   | le checkpoint 22 contenait encore des interdictions d’autonomie contredites par les checkpoints 24–26 et le code | checkpoint marqué historique/supplanté ; état courant centralisé dans 27 |
| haute   | le checkpoint 23 disait correction de boucle et autonomie non livrées                                            | document marqué comme étape historique antérieure aux migrations 22–24   |
| moyenne | `00` cumulait 428 lignes de mises à jour et répétait les états de tous les domaines                              | handoff réécrit autour des faits nécessaires à une reprise               |
| moyenne | la feuille de route 10 présentait encore SQLite 19 comme extension active                                        | bannière précisant son rôle cumulatif et renvoi vers 27                  |
| moyenne | le guide complet annonçait SQLite 19, « cinq versions Dexie », 204 tests/24 E2E et omettait Robot/Friday         | métadonnées, tables, migrations, tests et carte de code actualisés       |
| moyenne | le README racine omettait Robot et généralisait les validations téléphone                                        | destination/architecture Robot ajoutées et preuves A17/iPhone séparées   |
| faible  | le README du runtime Pi renvoyait au plan historique plutôt qu’au runbook actif                                  | reprise sûre redirigée vers le runbook et frontière Pi/hub explicitée    |
| moyenne | `14-prochaines-etapes` restait marqué actif alors que Robot a été implanté ensuite                               | statut historique ; les prochaines actions vivent dans 00/27             |
| faible  | la hiérarchie documentaire n’était pas visible depuis `docs/`                                                    | ajout du présent index `docs/README.md`                                  |

Le contrôle des liens relatifs avant correction a trouvé **zéro cible
manquante**. Le problème était donc l’autorité et la fraîcheur, pas la
résolution des liens.

## 3. Classement de toute la documentation

| Documents                                | Rôle après audit                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `00`, `README`, `27`                     | reprise et état présent canoniques                                                |
| `01` à `08`                              | audit source et décisions historiques, jamais architecture active                 |
| `09`                                     | décision produit PWA active                                                       |
| `10`                                     | feuille de route cumulative et gates ; état live délégué à 27                     |
| `11-note-securite`                       | note de sécurité active                                                           |
| `11-prochaines-etapes`, `14`, `15-audit` | plans/audit historiques                                                           |
| `12`, `13`, `15-checkpoint`, `17`, `18`  | checkpoints actifs de domaine App                                                 |
| `16`                                     | socle Veille historique, remplacé par 17                                          |
| `19`                                     | vision fondatrice Robot, comprenant des capacités futures                         |
| `20`                                     | plan Robot historique ; progression réelle dans 27                                |
| `21`                                     | journal chronologique clos                                                        |
| `22` à `26`                              | chaîne de checkpoints Robot datés ; 27 consolide leur résultat                    |
| `28`                                     | preuve et décisions du présent audit documentaire                                 |
| `adr/*`                                  | décisions durables ; les numéros absents n’ont pas de fichier autonome            |
| `friday-threat-model.md`                 | modèle de menace à réviser lors d’un changement de frontière                      |
| `guides/*`                               | explication longue, non prioritaire pour une reprise agentique                    |
| `recipes/*`                              | scénarios de validation physique ; pas des preuves tant qu’ils ne sont pas signés |
| `reference/*`                            | taxonomie métier stable                                                           |
| `runbooks/*`                             | procédures d’exploitation actives                                                 |
| `skills-register.md`                     | registre des extensions d’agent                                                   |
| README racine et `robot/README.md`       | présentation projet/runtime alignée sur l’état canonique                          |
| README `infra/*` et `packages/*`         | procédures ciblées cohérentes, sans autorité sur l’état global                    |

Le `.docx` Budget est un livrable utilisateur ; sa présence est conservée mais
il ne fait pas autorité sur le code ou les calculs.

## 4. Factorisation réalisée

- Un seul état global : [27](27-etat-canonique-app-robot-2026-08-25.md).
- Un handoff court : [00](00-reprise-nouveau-chat.md).
- Un index et une politique de cycle de vie : [README](README.md).
- Les détails opératoires restent dans les runbooks, sans être recopiés dans
  tous les checkpoints.
- Les checkpoints historiques conservent leurs mesures originales mais portent
  un avertissement de remplacement.
- `AGENTS.md` ne recopie plus l’historique détaillé du produit.

## 5. Vérités vérifiées dans le dépôt

- sept destinations PWA, dont le libellé réel `Chat` et l’onglet `Robot` ;
- SQLite 24 et Dexie 7 ;
- quatre modes Chat : Local, Friday, Web léger et Web approfondi ;
- routes Robot pour état, carte, mémoire, modes, autonomie, Carto,
  relocalisation, missions, roues, caméra et arrêt ;
- cartographie segmentée et déplacement physique à la main pris en compte ;
- worker ORB/OpenCV séparé et mémoire visuelle bornée ;
- scripts d’installation vision/localisation et redémarrage HTTPS ;
- `pnpm verify` : 294 tests Python/TypeScript et 25 parcours Playwright.

## 6. Points volontairement ouverts

- recette physique de relocalisation après transport manuel ;
- qualité réelle de fermeture de boucle et de correction de trajectoire ;
- observation de la politique autonome et caméra dans l’appartement ;
- recettes A17 encore non signées ;
- prochain lot applicatif, Calendar n’étant qu’une option ;
- restauration chiffrée de bout en bout et chargement de données Budget réelles.

## 7. Prévention de la dérive

À chaque migration ou nouvelle verticale, mettre à jour ensemble : code/tests,
runbook du domaine, document 27 et, seulement si la reprise change, `00` et
`AGENTS.md`. Un ancien checkpoint ne doit jamais être « actualisé » au point de
perdre sa valeur historique : ajouter une bannière de remplacement et écrire
le nouvel état dans le canonique.

# Documentation Friday

Statut documentaire : actif. Révision : 6 septembre 2026.

## Trois parcours

| Besoin                 | Commencer ici                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Utiliser l'application | [Guide utilisateur](guides/utilisation-friday.md) et [Budget](guides/budget-friday.md)                                               |
| Installer sur Windows  | [Installation](guides/installation-windows.md), puis [configuration](reference/configuration.md)                                     |
| Développer             | [Contribution](../CONTRIBUTING.md), [architecture](guides/architecture-developpement.md) et [développement](runbooks/development.md) |

## Reprendre une conversation

Lire dans l'ordre : [AGENTS](../AGENTS.md), [00](00-reprise-nouveau-chat.md),
[27](27-etat-canonique-app-robot-2026-08-25.md), [09](09-decision-finale-pwa-mvp.md),
[10](10-feuille-de-route-technique-implementation.md), puis le runbook du domaine.
Pour Chat, lire ensuite la [fondation 32](32-fondation-reconstruction-chat.md).
L'état courant est dans 27 ; les rapports sont des preuves à leurs dates.

## Domaines et opérations

| Domaine                         | Référence                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maison, Courses, Menus, Réserve | [Runbook Maison](runbooks/maison-menus-reserve.md), [classement](runbooks/classement-courses.md), [taxonomie](reference/taxonomie-courses-retail-fr-v1.md) |
| Budget                          | [Guide](guides/budget-friday.md), [porte des données réelles](runbooks/reprise-budget.md), [ADR](adr/012-budget-partage-enveloppes.md)                     |
| Chat                            | [Runbook](runbooks/assistant-gemma.md), [fondation](32-fondation-reconstruction-chat.md)                                                                   |
| Veille                          | [Runbook](runbooks/veille-rss.md)                                                                                                                          |
| Robot                           | [Runbook](runbooks/robot-alphabot2.md), [autonomie visuelle](30-decision-autonomie-topologique-visuelle.md), [runtime Python](../robot/README.md)          |
| Windows et HTTPS                | [Exploitation](../infra/windows/README.md), [certificats du foyer](../infra/certificates/README.md)                                                        |
| Sauvegarde et restauration      | [Procédure cible non implantée](runbooks/sauvegarde-restauration.md)                                                                                       |
| Sécurité                        | [Frontières et modèle de référence](friday-threat-model.md), [note LAN](11-note-securite-exposition-reseau.md)                                             |
| Travaux à décider               | [Plan de durcissement réconcilié](31-plan-durcissement-prioritaire.md)                                                                                     |
| Décisions et recettes           | [ADR](adr/), [recettes datées](recipes/)                                                                                                                   |

## Inventaire et historique

L'[inventaire documentaire complet](reference/inventaire-documentaire.md) classe chaque
document, son public, sa destination et le traitement effectué. Son registre JSON est
contrôlé par `pnpm docs:check`, avec liens et ancres. Les [archives](archives/README.md)
conservent décisions initiales, checkpoints et anciennes versions cumulatives.

Les rapports [Maison](audits/2026-09-05-livraison-maison.md),
[modularisation](audits/2026-09-06-implementation-qualite-et-modularisation.md) et
[complément livré](audits/2026-09-06-complement-cinq-modules.md) portent les preuves runtime.
Le [bilan documentaire](audits/2026-09-06-refonte-documentaire.md) décrit uniquement
la présente refonte et ses contrôles. Une recette écrite n'est pas une recette réussie.

La [maintenance documentaire](reference/maintenance-documentation.md) précise quoi
actualiser après un lot. Le [registre de skills](skills-register.md) conserve les décisions
d'installation ; aucun nouveau skill n'est installé par cette refonte.

# Documentation Friday

Ce répertoire sépare l’état présent, les décisions, les opérations et
l’historique. L’audit initial et son ré-audit du 27 août sont consignés dans
[28-audit-documentation-app-robot-2026-08-25.md](28-audit-documentation-app-robot-2026-08-25.md).

## Parcours de reprise rapide

Lire dans cet ordre :

1. [00-reprise-nouveau-chat.md](00-reprise-nouveau-chat.md) — handoff court ;
2. [27-etat-canonique-app-robot-2026-08-25.md](27-etat-canonique-app-robot-2026-08-25.md) — vérité d’implémentation App + Robot ;
3. [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md) — décisions produit encore actives ;
4. [10-feuille-de-route-technique-implementation.md](10-feuille-de-route-technique-implementation.md) — principes d’exécution, tests et gates ;
5. le runbook du domaine modifié.

`AGENTS.md`, à la racine, reste l’autorité sur la façon de travailler dans le
workspace. En cas d’écart factuel entre un ancien checkpoint et le code, le
document 27 puis le code testé prévalent.

## Trouver le bon document

| Besoin                           | Document                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| état global App + Robot          | [27 — état canonique](27-etat-canonique-app-robot-2026-08-25.md)                                                     |
| développer ou vérifier           | [runbook développement](runbooks/development.md)                                                                     |
| exploiter AlphaBot2              | [runbook Robot](runbooks/robot-alphabot2.md) et [checkpoint Récup](29-checkpoint-recuperation-humaine-2026-08-25.md) |
| comprendre l’autonomie actuelle  | [30 — autonomie topologique visuelle](30-decision-autonomie-topologique-visuelle.md)                                 |
| exploiter le Chat                | [runbook Assistant](runbooks/assistant-gemma.md)                                                                     |
| exploiter la Veille              | [runbook Veille](runbooks/veille-rss.md)                                                                             |
| classer les courses              | [runbook classement](runbooks/classement-courses.md)                                                                 |
| reprendre le Budget              | [runbook Budget](runbooks/reprise-budget.md)                                                                         |
| sauvegarder/restaurer            | [runbook sauvegarde](runbooks/sauvegarde-restauration.md)                                                            |
| comprendre toute l’application   | [guide fonctionnel et technique](guides/guide-complet-fonctionnel-et-technique-friday.md)                            |
| rejouer une validation téléphone | [recettes](recipes/)                                                                                                 |
| comprendre une décision durable  | [ADR](adr/)                                                                                                          |

## Statut des familles

- **Canoniques** : `00`, `27`, ce fichier et les runbooks.
- **Décisions actives** : `09`, `10`, les ADR et le modèle de menace. Le
  document 10 est une feuille de route cumulative, pas un état live.
- **Checkpoints de domaine** : `12`, `13`, `15-checkpoint`, `17`, `18`, `22` à
  `26` et `29`. Ils expliquent une verticale ou une étape datée ; le document
  27 tranche l’état global courant.
- **Décision Robot active** : `30`, complétée par le runbook pour
  l’exploitation et la veille réseau.
- **Vision produit Robot** : `19` et ADR-014. Ils décrivent aussi la cible
  future et ne prouvent pas sa présence sur AlphaBot2.
- **Historique** : `01` à `08`, `11-prochaines-etapes`, `14`,
  `15-audit`, `16`, `20` et `21`. Ils restent utiles pour comprendre les
  décisions, mais ne pilotent pas une reprise.
- **Recettes** : preuves manuelles à exécuter. Un scénario écrit n’est jamais
  une validation physique.

## Règle de maintenance

Après une évolution structurante :

1. modifier le code et ses tests ;
2. mettre à jour le runbook concerné ;
3. mettre à jour le document 27 et, si nécessaire, `00`/`AGENTS.md` ;
4. créer un checkpoint daté seulement si une décision ou une preuve mérite un
   historique autonome ;
5. marquer explicitement tout document remplacé ;
6. vérifier les liens relatifs et exécuter `pnpm verify` avant de déclarer le
   candidat terminé.

Ne recopier ni secrets, ni jetons, ni mots de passe, ni contenu de
`D:\FridayData` dans Git.

# État du budget partagé

Date du checkpoint : 10 août 2026

Statut : candidat automatisé déployé ; recette physique A17 et reprise des données réelles encore ouvertes.

## Périmètre livré

`Budget` est la cinquième destination principale, entre `Courses` et `Veille`. Le budget est partagé entre les deux adultes, manuel et offline-first. Les données locales sont chiffrées dans Dexie, chaque écriture emprunte l’outbox existante et SQLite reste la base canonique du hub.

Le candidat couvre :

- revenus réguliers et occasionnels ;
- frais fixes, courses, santé, loisirs et extras ;
- mouvements ponctuels, mensuels et annuels ;
- attribution `Maison`, adulte actif ou autre adulte, sans restriction de visibilité ;
- enveloppes mensuelles ou cumulables, créées volontairement sans valeurs recréées automatiquement ;
- modification et suppression des enveloppes ;
- dépenses futures, provision virtuelle validable et paiement réel sans double comptage ;
- objectif mensuel et mouvements réels de réserve ;
- synthèse du mois, échéances à 30/60/90 jours et projection sur 12 mois par trimestres ;
- corrections auditables, suppression par tombstone et occurrences récurrentes déterministes sans doublon ;
- suppression d’une occurrence seule ou arrêt de sa série sans effacer l’historique déjà comptabilisé.

## Lecture de l’écran

- `Reste réel` repose uniquement sur les mouvements réalisés : revenus réels − dépenses réelles − versements d’épargne + retraits.
- `Montant non affecté` est prévisionnel : revenus prévus − frais fixes − enveloppes − provisions − objectif d’épargne.
- Les enveloppes indiquent allocation, consommation et solde ; une provision de projet réserve virtuellement du budget mais ne constitue jamais de l’épargne réelle.
- `Enveloppes` et `Revenus et frais` sont repliés par défaut avec un compteur. `Mouvements récents` est ouvert mais repliable. Les actions d’une même ligne restent horizontales à 360 px et les formulaires de modification se referment après sauvegarde.

Les règles détaillées et les formules font autorité dans [l’ADR-012](adr/012-budget-partage-enveloppes.md). Le mode d’emploi illustré est disponible dans [le document utilisateur](guides/mode-emploi-budget-friday.docx).

## Données et reprise

Les données financières des classeurs externes n’ont pas été chargées. La porte de sécurité observée ne passe pas encore : l’état BitLocker doit être confirmé avec élévation et `D:\FridayData` hérite encore de droits trop larges. Aucun seed réel ne doit être lancé avant correction des ACL, sauvegarde SQLite et rapprochement anonyme des comptes et totaux.

Le dépôt contient seulement le mapping, l’outil de seed idempotent et des fixtures fictives. Le fichier normalisé réel doit rester sous `D:\FridayData`, hors Git et hors Drive. La procédure complète est dans [le runbook de reprise](runbooks/reprise-budget.md).

## Preuves et limites

Au checkpoint du 10 août 2026, `pnpm verify` réussit avec 121 tests unitaires/intégration et 21 scénarios Google Chrome mobile. Les tests couvrent notamment les calculs, arrondis, fins de mois, 29 février, projections, corrections, tombstones, récurrences déterministes, seed idempotent, chiffrement local, synchronisation et parcours responsive à 360 px.

Le runtime a été reconstruit et répond sur `https://192.168.1.14:8443`. Cette preuve automatisée ne valide pas le comportement physique sur Galaxy A17 ou iPhone. La recette à exécuter est [galaxy-a17-budget.md](recipes/galaxy-a17-budget.md).

## Décision de checkpoint

Le budget est considéré suffisamment stable pour rester en l’état au niveau produit. Les prochains travaux budget ne reprennent que sur retour d’usage, recette physique, sécurisation de `D:\FridayData` ou décision explicite de charger les données réelles.

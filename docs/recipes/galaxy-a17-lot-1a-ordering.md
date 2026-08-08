# Recette Lot 1A — ordre chronologique des tâches

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-01`, `UX-03`
- Objectif : vérifier que l'ordre de création ne prend jamais le dessus sur la date et l'heure prévues.

## Parcours court

Créer volontairement trois tâches dans cet ordre :

1. une tâche aujourd'hui à `18:00` ;
2. une tâche demain sans heure ;
3. une tâche aujourd'hui à `09:00`.

Résultat attendu dans `Aujourd'hui` et `Maison > Liste` :

1. aujourd'hui à `09:00` ;
2. aujourd'hui à `18:00` ;
3. demain sans heure.

Passer ensuite dans `Semaine` puis `Mois`. Pour chaque jour, la tâche sans heure doit apparaître avant les horaires, puis les horaires doivent être croissants. Les jours restent naturellement croissants dans la grille. Une tâche sans aucune date est placée après toutes les tâches datées dans les listes.

| Vérification                           | Résultat/date |
| -------------------------------------- | ------------- |
| ordre dans `Aujourd'hui`               |               |
| ordre dans `Maison > Liste`            |               |
| ordre dans `Semaine`                   |               |
| ordre dans le détail du jour de `Mois` |               |

## Preuves automatisées du candidat

- fonction pure : date croissante, heure croissante, tâches sans date en dernier et départage déterministe ;
- repository local : toutes les listes déchiffrées utilisent cette règle unique ;
- calendrier : aperçu semaine et détail du jour réutilisent le même comparateur ;
- Chrome mobile : création volontairement désordonnée, puis contrôle dans `Aujourd'hui`, `Liste`, `Semaine` et `Mois` ;
- commande de contrôle finale : `pnpm verify`.

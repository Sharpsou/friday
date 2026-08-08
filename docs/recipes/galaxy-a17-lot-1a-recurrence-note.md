# Recette Lot 1A — récurrence et note

- Statut : **candidat automatisé validé — recette A17 à réaliser**
- Appareil : Samsung Galaxy A17
- Exigences : `FR-TASK-01`, `FR-TASK-03`, `NFR-OFF-02`, `NFR-SYNC-01`
- Objectif : vérifier qu'une note reste facultative et qu'une tâche récurrente bornée par une date de fin affiche immédiatement toutes ses occurrences, même hors ligne.

## Parcours court

1. Créer une tâche sans date avec uniquement un titre et une note : elle doit être acceptée et afficher la note.
2. Créer une tâche datée avec `Tous les N jours`, choisir `3`, une date de fin six jours plus tard, puis ajouter une heure, un responsable et une note.
3. Vérifier immédiatement dans Liste, Semaine et Mois que les trois occurrences sont présentes aux bonnes dates.
4. Arrêter le hub, puis terminer la première : elle reste dans l'historique et les deux suivantes restent actives, sans occurrence au-delà de la date de fin.
5. Fermer de force et rouvrir Friday hors ligne : les trois occurrences et la note sont toujours présentes.
6. Relancer le hub : l'attente revient à zéro sans occurrence supplémentaire ni doublon.
7. Contrôler rapidement les quatre autres choix : `Chaque jour`, `Chaque semaine`, `Chaque mois` et `Chaque année`.
8. Hors ligne, passer en mode `Modifier`, supprimer une occurrence et choisir `Cette occurrence` : les autres dates doivent rester présentes après rechargement.
9. Supprimer ensuite une occurrence restante et choisir `Toute la série` : toutes les occurrences, y compris terminées, doivent disparaître et rester absentes après reconnexion.

Pour une date de fin de mois, la récurrence mensuelle revient au jour d'ancrage dès que le mois le permet : le 31 janvier donne le 28/29 février, puis le 31 mars. Une récurrence annuelle du 29 février utilise le dernier jour de février les années non bissextiles.

## Preuves automatisées du candidat

- contrats : règle structurée validée et anciennes valeurs quotidiennes/hebdomadaires/mensuelles encore acceptées ;
- domaine pur : jour, semaine, N jours, fin de mois, année bissextile et date de fin inclusive ;
- repository local : série complète créée avec des identifiants déterministes dans une transaction IndexedDB/outbox, avec un plafond de 500 occurrences ; suppression unitaire ou tombstones de toute la série dans une transaction locale ;
- Chrome mobile : note sans date, trois occurrences futures visibles, fin et deux portées de suppression hors ligne, rechargement et convergence sans doublon ;
- inspection visuelle 412 × 915 : détails repliables utilisables, aucune erreur console ;
- commande de contrôle finale : `pnpm verify`.

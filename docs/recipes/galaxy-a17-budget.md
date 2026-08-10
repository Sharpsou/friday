# Recette Galaxy A17 — budget partagé

Statut : à exécuter physiquement. Les tests Chrome mobile ne valent pas preuve A17.

## Préconditions

- candidat construit et hub joignable sur l'origine HTTPS stable ;
- appareil A17 déjà authentifié ;
- fixtures fictives ou données réelles reprises après la porte de sécurité ;
- second appareil disponible pour la convergence.

## Parcours

1. À 360 px, vérifier les cinq destinations lisibles dans l'ordre : Aujourd'hui, Agenda, Courses, Budget, Veille.
2. Ouvrir Budget et saisir une dépense avec montant, libellé et enveloppe. Mesurer moins de quinze secondes sans utiliser les détails.
3. Attribuer un revenu à chaque adulte puis vérifier que les deux restent visibles et que le filtre/sens de synthèse est correct.
4. Créer une enveloppe mensuelle sans report et une enveloppe cumulable ; dépasser la première et vérifier l'unique alerte utile dans Aujourd'hui.
5. Créer une dépense future, vérifier la provision mensuelle suggérée, puis la valider. Confirmer qu'elle ne devient ni dépense réelle ni épargne réelle avant paiement.
6. Passer hors réseau, saisir un mouvement, fermer complètement la PWA et redémarrer. Vérifier la présence du mouvement et l'état en attente.
7. Créer la même occurrence récurrente arrivée à échéance sur les deux appareils hors ligne, reconnecter, puis vérifier une seule occurrence logique et une outbox revenue à zéro.
8. Supprimer un revenu et un frais ponctuels, puis vérifier qu’ils ne réapparaissent pas après synchronisation.
9. Sur un mouvement récurrent, essayer « Cette occurrence », puis « Cette occurrence et arrêter la série » ; vérifier que les échéances antérieures restent visibles et qu’aucune nouvelle occurrence n’est générée.
10. Corriger un mouvement puis supprimer sa correction sans faire réapparaître l’ancien montant.
11. En fin de mois de fixture, confirmer une clôture vers la réserve. Vérifier qu'un versement réel n'apparaît qu'après confirmation et que les provisions cumulables sont exclues.
12. Contrôler les focus 30/60/90 jours et les douze mois glissants.

Consigner appareil, navigateur, version PWA et résultats observés. Ne déclarer l'A17 validé qu'après ce parcours réel ; l'iPhone reste une recette distincte.

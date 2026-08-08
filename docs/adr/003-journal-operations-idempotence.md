# ADR-003 — journal d'opérations, idempotence et conflits

Date : 8 août 2026
Statut : accepté

## Contexte

Une réponse peut être perdue après commit et deux appareils peuvent modifier le même objet. Un simple CRUD connecté ne protège ni l'offline ni la convergence.

## Options considérées

- journal d'opérations avec identifiant client et révision de base ;
- last-write-wins par horodatage client ;
- file externe et event sourcing complet ;
- deux voies d'écriture, directe en ligne et différée hors ligne.

## Décision

La PWA écrit toujours localement puis pousse une enveloppe versionnée. SQLite mémorise chaque `operationId`, le résultat rendu et une séquence de changement. Une révision obsolète produit un conflit explicite selon le domaine.

## Conséquences

Le protocole est plus explicite mais testable. L'horloge du client n'arbitre rien. Les opérations budget futures seront append-only.

## Preuve

NFR-SYNC-01 à 03 : même opération envoyée deux fois, réponse perdue après commit, coupures avant/pendant/après push et modifications concurrentes.

## Retour arrière

Le journal peut évoluer vers des événements plus riches tout en conservant `operationId`, `baseRevision` et le curseur.

## Révision

Après les tests de coupure P0 puis avant les domaines budget et agenda.

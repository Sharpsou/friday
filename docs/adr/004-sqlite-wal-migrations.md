# ADR-004 — SQLite better-sqlite3, WAL et migrations numérotées

Date : 8 août 2026
Statut : accepté

## Contexte

Le hub Windows a besoin d'une base canonique transactionnelle, sauvegardable sans service externe et compatible FTS5.

## Options considérées

- SQLite via `better-sqlite3` ;
- `node:sqlite` ;
- PostgreSQL local ;
- ORM et base cloud.

## Décision

Utiliser `better-sqlite3`, activer WAL pour les fichiers persistants, appliquer des migrations SQL numérotées et garder l'accès SQL derrière des repositories/services.

## Conséquences

Le hub contient une dépendance native, mais Node 24 est supporté. Les sauvegardes utiliseront l'API de backup et non la copie brute d'un WAL actif. Aucun ORM lourd n'est ajouté.

## Preuve

Tests sur base vide et migration N-1, transaction d'idempotence et build Windows dans `pnpm verify`.

## Retour arrière

Les migrations SQL et repositories isolent le moteur ; un autre binding SQLite peut remplacer `better-sqlite3` si `node:sqlite` devient stable et apporte un gain prouvé.

## Révision

Après le Lot 0B et avant la sauvegarde P3.

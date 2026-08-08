# ADR-001 — monorepo TypeScript, React/Vite et Fastify

Date : 8 août 2026
Statut : accepté

## Contexte

Friday doit partager ses contrats entre une PWA et un hub Windows, rester simple à construire et éviter deux stacks de production.

## Options considérées

- monorepo pnpm TypeScript avec React/Vite et Fastify ;
- dépôts séparés ;
- Next.js ou framework serveur complet ;
- reprise de l'application Flutter Home Mind.

## Décision

Utiliser un monorepo pnpm. `apps/web` contient la PWA React/Vite, `apps/hub` contient Fastify et `packages/*` contient contrats et logique pure. Fastify sert le build Web et l'API depuis la même origine.

## Conséquences

Les types et schémas runtime sont partagés. Le build reste explicite. SSR, Next.js, Flutter, Docker et Python de production sont exclus du MVP.

## Preuve

`pnpm verify` doit construire et tester les deux applications depuis un clone propre. Exigences : SEC-01, NFR-MIG-01 et section 4.1 du document 10.

## Retour arrière

Les applications restent séparées par packages ; le hub ou le client peut être extrait sans modifier le protocole.

## Révision

Après le Lot 0B ou si la même origine ne peut pas être maintenue sur l'A17.

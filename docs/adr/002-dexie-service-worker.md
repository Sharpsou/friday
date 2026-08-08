# ADR-002 — Dexie/IndexedDB et service worker injectManifest

Date : 8 août 2026
Statut : accepté sous réserve du spike A17

## Contexte

La PWA doit démarrer et accepter des écritures lorsque le PC et le réseau sont indisponibles.

## Options considérées

- IndexedDB via Dexie avec service worker Workbox `injectManifest` ;
- Cache API comme stockage métier ;
- SQLite/WASM ou OPFS ;
- client Android natif.

## Décision

Dexie porte les données métier locales, la clé Web Crypto, l'outbox, le curseur et les migrations. Workbox précache uniquement l'app shell. Les réponses API métier ne sont pas mises en cache automatiquement.

## Conséquences

Toute écriture doit être transactionnelle dans IndexedDB. Le service worker reste petit et sa mise à jour est explicitement proposée. La persistance réelle dépend du navigateur et doit être testée sur l'A17.

## Preuve

NFR-OFF-01, NFR-OFF-02, NFR-MIG-01 et la matrice A17 doivent passer, notamment après fermeture forcée et redémarrage.

## Retour arrière

Si une limite structurelle non corrigeable empêche la porte P0, réévaluer un client Android natif sans modifier le hub ni les contrats.

## Révision

À la porte go/no-go du Lot 0B.

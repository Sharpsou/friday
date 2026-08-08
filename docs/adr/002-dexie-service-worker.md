# ADR-002 — Dexie/IndexedDB et service worker injectManifest

Date : 8 août 2026
Statut : accepté — porte A17 du Lot 0B validée

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

Le 8 août 2026, l’utilisateur a confirmé sur le Galaxy A17 qu’une tâche et son opération en attente survivent à la fermeture forcée et au redémarrage complet hors réseau. Après retour du hub, l’attente revient à zéro et une seule occurrence converge. Les scénarios Chrome mobile couvrent également création, suppression et expiration d’une synchronisation bloquée. Les migrations et l’activation d’une nouvelle version du service worker restent vérifiées à chaque évolution.

## Retour arrière

Si une limite structurelle non corrigeable empêche la porte P0, réévaluer un client Android natif sans modifier le hub ni les contrats.

## Révision

Décision confirmée à la porte go/no-go du Lot 0B le 8 août 2026. Réviser uniquement si les contrôles prolongés révèlent une perte locale, une éviction de stockage ou une migration non récupérable.

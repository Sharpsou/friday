# ADR-013 — accès extérieur privé par route Tailscale `/32`

Date : 10 août 2026

Statut : **accepté, mise en œuvre en pause**

## Contexte

Friday est servi par le hub Windows à l’origine stable `https://192.168.1.14:8443`. Cette origine porte la PWA, les cookies, le service worker, IndexedDB, la clé Web Crypto et l’outbox. La modifier créerait un nouveau stockage navigateur et imposerait une migration ainsi qu’un nouvel appairage.

Le besoin futur est d’utiliser la même application depuis la 5G ou un autre Wi-Fi sans redirection de port sur la box et sans rendre Fastify public sur Internet.

## Décision

Lors de la reprise de ce chantier :

- installer Tailscale sur le PC, le Galaxy A17 et l’iPhone ;
- faire du PC un routeur de sous-réseau annonçant uniquement `192.168.1.14/32` ;
- approuver explicitement la route et les appareils dans le tailnet ;
- limiter les grants aux appareils familiaux et à `TCP 8443` vers `192.168.1.14` ;
- continuer à ouvrir exactement `https://192.168.1.14:8443` en Wi-Fi comme en 5G ;
- n’ouvrir aucun port Livebox, ne pas utiliser UPnP, exit node ou Tailscale Funnel ;
- conserver l’authentification Friday comme seconde frontière, indépendante de Tailscale.

La [documentation Tailscale des subnet routers](https://tailscale.com/docs/features/subnet-routers?tab=windows) confirme la prise en charge de Windows et l’acceptation automatique des routes approuvées par Android et iOS. Les [Tailscale Grants](https://tailscale.com/docs/features/access-control/grants) permettent de borner la destination et le port.

## Enrôlement local uniquement

Une fois l’accès extérieur activé, un appareil déjà appairé pourra se connecter et synchroniser en 5G. En revanche, les opérations suivantes resteront limitées au Wi-Fi Maison :

- bootstrap du foyer ;
- création ou réappairage du second adulte ;
- génération et consommation d’un code d’appairage ;
- demande, approbation ou rejet d’un nouvel appareil ;
- oubli d’un adulte permettant son remplacement.

La révocation d’un appareil restera possible à distance. La restriction sera appliquée côté serveur, pas seulement dans l’interface. Le spike devra d’abord vérifier l’adresse source réellement observée derrière le routeur Tailscale Windows. Si le SNAT empêche une distinction fiable, un jeton éphémère obtenu sur un port exclusivement LAN remplacera toute déduction fragile par adresse IP.

## Conséquences

- l’origine, le certificat, la PWA et les données locales existantes sont préservés ;
- Android et iPhone nécessitent l’application Tailscale et la confiance actuelle dans le certificat Friday ;
- un autre VPN mobile peut entrer en conflit avec Tailscale ;
- le compte Tailscale et chaque appareil approuvé deviennent des actifs de sécurité ;
- le PC doit rester allumé pour synchroniser, mais le mode offline de Friday continue à fonctionner lorsqu’il est indisponible.

## Gate de reprise

La mise en œuvre est volontairement en pause. À sa reprise :

1. sauvegarder SQLite et vérifier une outbox à zéro ;
2. tester la route `/32` sans changement de code ;
3. mesurer les adresses sources Wi-Fi et Tailscale vues par Fastify ;
4. durcir les règles Windows génériques de Node.js ;
5. ajouter puis tester la restriction d’enrôlement local ;
6. rejouer les recettes physiques A17 et iPhone en Wi-Fi, 5G, offline et reconnexion ;
7. confirmer que `8443` reste filtré depuis l’Internet public.

## Retour arrière

Désactiver l’annonce de route et retirer Tailscale des appareils restaure le fonctionnement LAN actuel sans migration de données. Aucun changement d’origine ou de box n’est nécessaire.

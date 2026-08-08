# Recette P0 — Galaxy A17

Statut : **en cours**
Appareil : Samsung Galaxy A17
Objectif : prouver NFR-OFF-01, NFR-OFF-02 et NFR-SYNC-01 sur matériel réel.

État observé le 8 août 2026 : accès LAN en HTTPS de confiance opérationnel, création et synchronisation visibles sur l'A17, puis modification et suppression locales testées après coupure du Wi-Fi. La porte complète reste ouverte tant que la persistance après fermeture forcée/redémarrage et l'absence de doublon après convergence ne sont pas consignées dans la matrice ci-dessous.

## Préconditions utilisateur

- réserver l'adresse actuelle du PC (`192.168.1.14` lors de la préparation) dans le DHCP du routeur ;
- confirmer que le réseau Windows est classé privé ;
- installer `mkcert` sur le PC ;
- accepter l'installation du certificat public de l'autorité Friday sur le Galaxy A17 ;
- ne jamais copier `rootCA-key.pem` sur le téléphone, Drive ou le dépôt.

Si l'adresse du PC change, régénérer le certificat et reprendre la recette depuis le début : IndexedDB et le service worker dépendent de l'origine exacte.

## Préparation du certificat

À exécuter après confirmation de l'adresse DHCP stable :

```powershell
New-Item -ItemType Directory -Force -Path 'D:\FridayData\certificates', 'D:\FridayData\secrets'
mkcert -install
mkcert `
  -cert-file 'D:\FridayData\certificates\friday-lan.pem' `
  -key-file 'D:\FridayData\secrets\friday-lan-key.pem' `
  192.168.1.14 friday.local localhost 127.0.0.1
```

Exporter seulement le certificat public de l'autorité retourné par `mkcert -CAROOT`, jamais sa clé privée.

## Démarrage du candidat

Après préparation du certificat, exécuter une fois le raccourci `Friday - Configurer acces A17` et accepter la demande administrateur. Il limite l’ouverture du pare-feu à TCP 8443 sur le réseau privé local.

Le raccourci `Friday - Lancer et recetter` du Bureau exécute ensuite automatiquement la construction, le démarrage et l’ouverture de Chrome. Il affiche également l’URL HTTPS à ouvrir sur le Galaxy A17.

Pour simuler un hub indisponible sans couper le Wi-Fi Maison, utiliser `Friday - Arreter le service`. Pour rétablir le hub sans ouvrir Chrome ni terminal, utiliser `Friday - Lancer ou redemarrer`.

Équivalent manuel :

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm build
$env:FRIDAY_HOST = '0.0.0.0'
$env:FRIDAY_PORT = '8443'
$env:FRIDAY_DATA_DIR = 'D:\FridayData'
$env:FRIDAY_TLS_CERT_PATH = 'D:\FridayData\certificates\friday-lan.pem'
$env:FRIDAY_TLS_KEY_PATH = 'D:\FridayData\secrets\friday-lan-key.pem'
pnpm preview
```

Ouvrir `https://192.168.1.14:8443` dans Chrome sur l'A17 et ajouter Friday à l'écran d'accueil.

## Matrice à signer

| Étape | Action                                                    | Résultat attendu                                 | Résultat/date |
| ----: | --------------------------------------------------------- | ------------------------------------------------ | ------------- |
|     1 | ouvrir Friday avec hub et Wi-Fi actifs                    | app shell et statut synchronisé                  |               |
|     2 | arrêter le service, garder le Wi-Fi et rouvrir Friday     | interface disponible, hub indiqué indisponible   |               |
|     3 | créer une tâche avec le service toujours arrêté           | message local et une modification en attente     |               |
|     4 | forcer l'arrêt de la PWA puis redémarrer l'A17            | tâche et modification toujours présentes         |               |
|     5 | lancer le service puis rouvrir Friday                     | attente à 0 et tâche partagée                    |               |
|     6 | provoquer un nouveau cycle de synchronisation             | une seule occurrence de la tâche                 |               |
|     7 | couper le Wi-Fi puis fermer et rouvrir Friday deux fois   | interface disponible deux fois sans réseau       |               |
|     8 | rétablir le Wi-Fi puis installer une nouvelle version PWA | convergence, activation proposée et aucune perte |               |

Consigner la version, l'heure, le nombre d'opérations en attente, la dernière synchronisation et toute friction tactile. Ne pas déclarer la persistance A17 validée sans cette table remplie.

# Recette P0 — Galaxy A17

Statut : **en cours**
Appareil : Samsung Galaxy A17
Objectif : prouver NFR-OFF-01, NFR-OFF-02 et NFR-SYNC-01 sur matériel réel.

État observé le 8 août 2026 : accès LAN en HTTPS de confiance opérationnel, création et synchronisation visibles sur l'A17, puis modification et suppression locales testées après coupure du Wi-Fi. L'arrêt du hub en conservant le Wi-Fi actif laisse également l'interface et l'écriture locale opérationnelles. La sortie de l'état bloqué `Connexion…` a été observée sur l'A17 ; le libellé a ensuite été simplifié en `Hors ligne` et ce libellé courant est couvert par le test Chrome mobile. La porte complète reste ouverte tant que la persistance après fermeture forcée/redémarrage et l'absence de doublon après convergence ne sont pas consignées dans la matrice ci-dessous.

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

État installé sur ce pilote :

- certificat public à transférer sur l’A17 : `D:\FridayData\certificates\friday-rootCA.crt` ;
- certificat serveur : `D:\FridayData\certificates\friday-lan.pem` ;
- clé privée serveur : `D:\FridayData\secrets\friday-lan-key.pem` ;
- clé privée de l’autorité : `%LOCALAPPDATA%\mkcert\rootCA-key.pem`, uniquement sur le PC et jamais transférée.

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

| Étape | Action                                                    | Résultat attendu                                 | Résultat/date       |
| ----: | --------------------------------------------------------- | ------------------------------------------------ | ------------------- |
|     1 | ouvrir Friday avec hub et Wi-Fi actifs                    | app shell et statut `Connecté`                   | OK A17 — 08/08/2026 |
|     2 | arrêter le service, garder le Wi-Fi et rouvrir Friday     | interface disponible puis statut `Hors ligne`    | OK A17 — 08/08/2026 |
|     3 | créer une tâche avec le service toujours arrêté           | message local et une modification en attente     | OK A17 — 08/08/2026 |
|     4 | forcer l'arrêt de la PWA puis redémarrer l'A17            | tâche et modification toujours présentes         |                     |
|     5 | lancer le service puis rouvrir Friday                     | attente à 0 et tâche partagée                    |                     |
|     6 | provoquer un nouveau cycle de synchronisation             | une seule occurrence de la tâche                 |                     |
|     7 | couper le Wi-Fi puis fermer et rouvrir Friday deux fois   | interface disponible deux fois sans réseau       |                     |
|     8 | rétablir le Wi-Fi puis installer une nouvelle version PWA | convergence, activation proposée et aucune perte |                     |

Consigner la version, l'heure, le nombre d'opérations en attente, la dernière synchronisation et toute friction tactile. Ne pas déclarer la persistance A17 validée sans cette table remplie.

## Prochaine session de recette

Reprendre directement à l’étape 4 :

1. ouvrir Friday avec le hub actif ; si la bannière de mise à jour apparaît, toucher `Installer`, vérifier qu’aucune donnée ne disparaît et consigner l’étape 8 ;
2. cliquer sur `Friday - Arreter le service` ;
3. passer l’A17 en mode avion et créer une tâche au titre unique, par exemple `RECETTE A17 REDÉMARRAGE` ;
4. vérifier qu’une modification est en attente, forcer la fermeture de Friday puis redémarrer complètement l’A17 ;
5. rouvrir Friday sans réseau et vérifier que la tâche et l’attente sont toujours présentes ;
6. désactiver le mode avion, cliquer sur `Friday - Lancer ou redemarrer` sur le PC et rouvrir Friday ;
7. vérifier le statut `Connecté`, zéro modification en attente et une seule occurrence de la tâche ;
8. fermer et rouvrir Friday, toucher le statut pour provoquer une nouvelle synchronisation, vérifier une seconde fois l’absence de doublon puis renseigner les lignes 4 à 7 ; ne valider la ligne 8 que si une mise à jour PWA a réellement été installée.

Après validation de ces huit lignes, le Lot 0B peut être fermé et le développement reprend sur l’état terminé/rouvert d’une tâche, puis sa date et son heure.

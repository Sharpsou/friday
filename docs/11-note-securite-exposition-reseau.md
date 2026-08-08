# Note informative — sécurité et exposition réseau

Date du constat : 8 août 2026
Statut : **information non bloquante pour le pilote P0**

## Résumé

Friday est actuellement utilisable comme pilote technique sur le réseau privé du foyer. Le port `8443` n'était pas joignable depuis Internet au moment du contrôle et le trafic LAN utilise HTTPS.

Cette situation ne signifie pas encore que Friday peut être publié sur Internet ou utilisé sur un réseau non fiable. Les routes de synchronisation du P0 ne disposent pas encore de l'authentification, de l'appairage et de l'autorisation prévus au Lot 1A.

**Aucune correction n'est imposée immédiatement** tant que les conditions suivantes restent vraies :

- Friday reste un pilote P0 ;
- le Wi-Fi Maison est considéré comme fiable ;
- aucune redirection du port `8443` n'est créée sur la Livebox ;
- l'application n'est pas utilisée depuis un réseau public ;
- aucune donnée budgétaire ou familiale particulièrement sensible n'est encore confiée au hub.

## État observé

### Protections déjà présentes

- le développement écoute sur `127.0.0.1` par défaut ;
- une écoute LAN sans certificat et clé TLS est refusée au démarrage (`apps/hub/src/main.ts`, lignes 21 à 25) ;
- le certificat du pilote couvre `friday.local`, `localhost`, l'adresse LAN actuelle et `127.0.0.1` ;
- la règle pare-feu Friday prévue limite TCP `8443` au profil privé et au sous-réseau local (`infra/windows/Configure-FridayLan.ps1`, lignes 61 à 74) ;
- Fastify applique une CSP stricte, des headers de sécurité et une limite de requête de 256 Kio (`apps/hub/src/app.ts`, lignes 32 à 60) ;
- les payloads locaux sont chiffrés avec AES-256-GCM et une clé non extractible (`apps/web/src/crypto/vault.ts`, lignes 23 à 68) ;
- les entrées de synchronisation sont validées avec Zod et les requêtes SQLite sont paramétrées ;
- aucun secret évident n'a été trouvé dans le dépôt ;
- l'audit des dépendances de production ne signalait aucune vulnérabilité connue au moment du contrôle.

### Limites acceptées temporairement

#### SEC-01 — API de synchronisation sans authentification

Sévérité si le réseau devient non fiable : **élevée**.

`POST /api/sync/push` et `GET /api/sync/pull` sont accessibles sans session ni appareil appairé (`apps/hub/src/app.ts`, lignes 71 à 96). La cohérence interne des identifiants est contrôlée, mais leur appartenance à un appareil, un profil ou un foyer autorisé ne l'est pas encore.

Conséquence : un client capable de joindre le hub sur le LAN peut lire les changements et fabriquer des opérations de tâche valides. Cette limite correspond au vertical slice P0 et ne doit pas devenir une configuration de production.

#### SEC-02 — règles Windows génériques pour Node.js

Sévérité actuelle : **moyenne**.

Windows possède des règles entrantes génériques « Node.js JavaScript Runtime » plus larges que la règle Friday : tous les ports TCP/UDP, adresses distantes quelconques, y compris sur le profil Public pour certaines règles.

Le port `8443` était filtré depuis Internet lors du contrôle, mais ces règles réduisent la défense en profondeur. Une future redirection de port sur la Livebox ou un autre service Node pourrait rendre l'exposition plus large que prévu.

#### SEC-03 — protection locale du répertoire de données

Sévérité avant données sensibles : **moyenne**.

La clé TLS serveur possède une ACL restrictive. En revanche, le fichier SQLite hérite actuellement de droits permettant la lecture aux utilisateurs Windows locaux et la modification aux utilisateurs authentifiés. L'état BitLocker n'a pas pu être vérifié sans privilèges administrateur.

Cette situation est tolérable pour les données de test P0, mais doit être revue avant l'utilisation de données budgétaires ou familiales réelles.

## Déclencheurs rendant le traitement obligatoire

Les limites ci-dessus deviennent bloquantes avant l'un des événements suivants :

1. exposition volontaire de Friday sur Internet, directement ou via un reverse proxy ;
2. création d'une redirection NAT/port `8443` sur la Livebox ;
3. utilisation sur un Wi-Fi invité, public ou comportant des appareils non fiables ;
4. ajout du deuxième adulte et de la séparation réelle des profils ;
5. saisie de données budgétaires réelles ou d'autres données familiales sensibles ;
6. déclaration de Friday comme service familial stable plutôt que pilote P0.

## Traitements à prévoir lorsque l'un des déclencheurs survient

Priorité 1 :

- ajouter l'authentification prévue au Lot 1A ;
- appairer chaque appareil à un profil et rendre les sessions révocables ;
- vérifier côté serveur le foyer, le profil et l'appareil pour chaque push/pull ;
- ajouter une limitation de débit et des tests de refus d'accès.

Priorité 2 :

- supprimer ou désactiver les règles Windows génériques Node.js qui couvrent le binaire utilisé par Friday ;
- conserver uniquement une règle dédiée à Friday, TCP `8443`, profil privé, programme Node.js et `LocalSubnet` ;
- vérifier l'absence de redirection Livebox et rejouer un test externe IPv4/IPv6.

Priorité 3 :

- restreindre les ACL de `D:\FridayData` au compte Friday, à `SYSTEM` et aux administrateurs ;
- confirmer le chiffrement BitLocker du volume qui contient SQLite ;
- actualiser `docs/friday-threat-model.md` avec les contrôles réellement implémentés.

## Décision temporaire

Le risque est **accepté sans obligation de correction immédiate** pour la seule phase de pilote P0 sur le réseau privé Maison. Cette acceptation ne vaut ni autorisation d'exposition Internet, ni validation de production, ni validation pour des données sensibles.

La note doit être relue au début du Lot 1A et dès qu'un déclencheur de la section précédente survient.

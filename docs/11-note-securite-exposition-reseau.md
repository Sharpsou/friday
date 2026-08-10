# Note informative — sécurité et exposition réseau

Date du constat initial : 8 août 2026

Révision : 10 août 2026

Statut : **pilote LAN protégé ; accès extérieur Tailscale accepté mais non activé**

## Résumé

Friday écoute en HTTPS sur `0.0.0.0:8443` lorsque le réseau Windows est privé. Le port n’était pas joignable depuis Internet lors du contrôle initial et aucune redirection Livebox n’est documentée.

La limite historique « push/pull sans authentification » est résolue : le candidat exige maintenant une session Better Auth liée à un foyer, un profil et un appareil actif. Les mutations contrôlent l’origine, les codes d’appairage sont expirants et à usage unique, les tentatives sont bornées et la révocation supprime les sessions serveur de l’appareil.

Friday ne doit toujours pas être publié directement sur Internet. L’[ADR-013](adr/013-acces-exterieur-tailscale-route-privee.md) retient pour plus tard une route Tailscale privée `192.168.1.14/32`, sans ouverture de box ni changement d’origine. Cette décision est en pause et Tailscale n’est pas installé.

## Protections présentes

- refus d’une écoute LAN sans certificat et clé TLS ;
- règle Friday prévue pour `TCP 8443`, profil privé et `LocalSubnet` ;
- cookies `HttpOnly`, `Secure` et `SameSite=Strict` ;
- inscription publique fermée, bootstrap impossible après initialisation du foyer ;
- push/pull authentifiés et liés au `deviceId`, au profil et au foyer ;
- révocation serveur des appareils et journal des événements sensibles ;
- CSP stricte, headers de sécurité, taille de requête bornée, validation Zod et SQL paramétré ;
- cache mobile AES-256-GCM avec clé Web Crypto non extractible ;
- aucune clé privée ou secret runtime versionné.

## Risques encore ouverts

### SEC-01 — règles Windows génériques de Node.js

Des règles entrantes « Node.js JavaScript Runtime » autorisent encore plus largement le binaire Node que la règle Friday dédiée, y compris sur le profil Public pour certaines entrées. Elles ne rendent pas `8443` public sans routage entrant, mais réduisent la défense en profondeur.

Avant tout accès extérieur, les règles génériques doivent être désactivées au profit de règles Friday limitées aux interfaces, adresses et ports nécessaires.

### SEC-02 — protection locale des données

L’état BitLocker doit encore être confirmé et les ACL de `D:\FridayData` restent à restreindre avant données financières réelles. La sauvegarde pré-migration Assistant ne remplace pas la preuve de restauration prévue par l’ADR-008.

### SEC-03 — cache d’un téléphone perdu

La révocation bloque les futurs échanges serveur mais ne peut pas effacer à distance un cache déjà téléchargé. Le verrouillage du téléphone, la révocation rapide dans Friday et, plus tard, le retrait de l’appareil Tailscale restent nécessaires.

### SEC-04 — future frontière Tailscale

Un compte Tailscale compromis ou un appareil approuvé à tort pourrait atteindre le port autorisé. La future mise en œuvre doit activer l’approbation des appareils, limiter la route à `/32`, limiter les grants à `TCP 8443` et conserver l’authentification Friday.

Tout nouveau compte ou appareil Friday devra être enrôlé depuis le Wi-Fi Maison. Un appareil déjà appairé pourra se connecter en 5G ; la révocation restera disponible à distance.

## Interdictions maintenues

- aucune redirection NAT/port Livebox ;
- aucun UPnP, Tailscale Funnel ou exposition IPv6 publique ;
- aucun accès direct à Ollama hors `localhost` ;
- aucune affirmation de compatibilité A17/iPhone sans recette physique ;
- aucune activation Tailscale avant demande explicite de reprise.

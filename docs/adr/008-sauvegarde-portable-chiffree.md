# ADR-008 — Sauvegarde portable chiffrée et restauration contrôlée

Date : 9 août 2026

Statut : accepté comme conception ; implantation non commencée

## Contexte

SQLite dans `D:\FridayData` est la source canonique de Friday. Les caches Dexie des téléphones permettent de continuer à travailler hors ligne, mais ils ne constituent ni une sauvegarde complète ni une source de restauration fiable : un téléphone peut ne contenir qu'une fenêtre de données, des opérations encore en attente ou une version ancienne.

L'utilisateur veut pouvoir produire depuis Friday un fichier facile à conserver ou à envoyer comme document, par exemple avec WhatsApp, puis le sélectionner ultérieurement dans une option d'import. Le fichier contient des données familiales, les comptes et leurs empreintes de mot de passe ; il ne doit jamais circuler sous forme de fichier SQLite brut.

SQLite fournit une API de sauvegarde en ligne qui produit un snapshot cohérent d'une base active sans copier naïvement le fichier principal pendant que le journal WAL évolue. `better-sqlite3` expose cette capacité. Le format `age` chiffre des fichiers pour une ou plusieurs clés destinataires et convient à une archive portable.

## Options considérées

- copier directement `friday.sqlite` : rejeté, car une copie naïve en mode WAL peut être incohérente et le fichier serait lisible par toute personne qui le reçoit ;
- exporter uniquement du JSON métier : lisible et portable, mais incomplet pour l'authentification, les révisions, l'idempotence, les classifications et les futures migrations ;
- utiliser uniquement le cache d'un téléphone : rejeté, car ce cache n'est pas canonique et peut contenir une outbox non synchronisée ;
- protéger l'archive par un mot de passe choisi à chaque export : possible, mais peu adapté aux sauvegardes régulières et vulnérable à l'oubli ou au choix d'un mot de passe faible ;
- snapshot SQLite cohérent, archive structurée puis chiffrement pour une clé de récupération `age` du foyer : retenu.

## Décision

### Principe général

Friday produira un fichier unique nommé comme suit :

```text
friday-backup-2026-08-09T154500Z.friday.age
```

Ce fichier est une archive ZIP chiffrée intégralement avec `age`. Son type de transport est `application/octet-stream`. L'extension sert à la reconnaissance par Friday ; l'import valide également le contenu et ne fait jamais confiance au nom ou au type MIME fourni par le navigateur.

WhatsApp, une messagerie ou une application de fichiers ne sert qu'à transporter une copie déjà chiffrée. Une sauvegarde n'est considérée durable que si une deuxième copie existe hors de la conversation, par exemple sur une clé USB ou ultérieurement dans le dossier Google Drive prévu au Lot 3.

### Clé de récupération

Lors de la première configuration, Friday génère une identité `age` dédiée au foyer :

- la clé publique destinataire chiffre toutes les sauvegardes ;
- la clé privée de récupération est stockée dans `D:\FridayData\secrets` pour les restaurations courantes ;
- une copie de la clé privée doit être conservée séparément dans le gestionnaire de mots de passe du foyer et sur un support hors ligne ;
- la clé privée ne figure jamais dans l'archive, le dépôt Git, les logs ou le même message WhatsApp que la sauvegarde.

Perdre à la fois le hub et cette clé rend les sauvegardes illisibles, volontairement. Une fuite du seul fichier partagé ne révèle pas les données.

L'implantation utilisera soit le binaire officiel `age`, soit une bibliothèque TypeScript interopérable après audit. Aucun nouvel outil n'est installé par cette ADR ; `age` est actuellement absent du poste.

### Contenu de l'archive chiffrée

L'archive interne contient uniquement :

```text
manifest.json
friday.sqlite
friday.auth-secret
```

`friday.sqlite` est un snapshot complet : tâches, courses, classifications, comptes, appareils, sessions, audit, journal de changements et données futures stockées dans SQLite.

`friday.auth-secret` contient le secret d'authentification effectif, qu'il provienne du fichier local par défaut ou de la configuration du processus. Il est inclus parce qu'une restauration complète doit conserver la cohérence cryptographique de Better Auth et des données d'appairage. Il n'existe jamais en clair hors du répertoire temporaire protégé pendant l'export ou l'import.

Les éléments suivants sont exclus : certificats et clés privées TLS, clé privée de l'autorité `mkcert`, identité privée `age`, logs, modèles Ollama, caches IndexedDB des téléphones et fichiers construits de la PWA. Les certificats LAN sont régénérés séparément si le hub change.

Le manifeste contient au minimum :

- `formatVersion` et identifiant aléatoire de sauvegarde ;
- date UTC, version Friday et version maximale de migration SQLite ;
- identifiant du foyer ;
- empreinte SHA-256 et taille de chaque fichier interne ;
- nombres indicatifs de profils, tâches et produits ;
- génération de restauration connue au moment du snapshot ;
- liste fermée des fichiers attendus.

Le manifeste est lui-même chiffré. Aucun titre de tâche, nom de produit ou identifiant de compte n'apparaît dans le nom du fichier ou dans des métadonnées externes.

### Création d'une sauvegarde

L'export exige que le hub soit joignable et que l'utilisateur soit propriétaire du foyer. Le flux est :

1. créer un répertoire temporaire dédié dans `D:\FridayData\backup-staging` ;
2. produire `friday.sqlite` avec l'API de sauvegarde SQLite en ligne, jamais avec une simple copie du fichier actif ;
3. ouvrir le snapshot séparément et exécuter `PRAGMA integrity_check` puis `PRAGMA foreign_key_check` ;
4. recopier le secret d'authentification dans la zone temporaire ;
5. calculer les empreintes, écrire le manifeste et créer l'archive ZIP ;
6. chiffrer l'archive vers la clé publique `age` du foyer ;
7. supprimer les fichiers temporaires en clair, y compris après erreur ;
8. remettre uniquement le fichier chiffré au navigateur et journaliser l'identifiant, la date, la taille et le résultat sans contenu sensible.

Les écritures ordinaires peuvent continuer pendant le snapshot. La sauvegarde représente un instant cohérent et n'inclut pas nécessairement une mutation démarrée après cet instant.

### Partage et téléchargement

Dans `Réglages > Sauvegarde`, le bouton `Créer une sauvegarde` prépare le fichier puis propose :

- `Partager` si `navigator.canShare({ files: [...] })` confirme que le navigateur accepte ce fichier ;
- `Télécharger` dans tous les cas comme solution de repli.

Le partage doit provenir directement du geste utilisateur. Friday ne promet pas que WhatsApp apparaîtra dans la feuille de partage ni qu'il acceptera l'extension : ce point sera vérifié physiquement sur Android et iPhone. En cas de refus, l'utilisateur télécharge le fichier puis le partage depuis l'application Fichiers.

### Import et prévalidation

L'import est une opération propriétaire, en ligne et destructive. Il est impossible depuis un téléphone lorsque le hub est arrêté. Le bouton `Importer une sauvegarde` suit deux phases :

1. sélectionner le fichier et, si nécessaire, fournir la clé privée de récupération depuis un emplacement distinct ;
2. envoyer le fichier au hub dans une limite de taille explicite ;
3. déchiffrer et extraire dans `restore-staging` avec protection contre les chemins relatifs, fichiers supplémentaires et bombes de décompression ;
4. vérifier le format, les tailles, les empreintes, la version et l'identifiant de foyer ;
5. ouvrir la base candidate isolément, exécuter `integrity_check` et `foreign_key_check` ;
6. refuser une base plus récente que le code installé ; migrer une copie candidate plus ancienne puis la vérifier à nouveau ;
7. afficher un aperçu : date, version, profils et nombres d'objets, sans encore modifier Friday.

Aucune erreur de clé, d'archive, de version ou d'intégrité ne modifie la base active.

### Confirmation et restauration

Avant le remplacement, Friday demande :

- que les deux appareils actifs affichent zéro opération en attente ;
- une nouvelle saisie de la phrase secrète du propriétaire ;
- une confirmation explicite rappelant la date du snapshot et que les données plus récentes seront remplacées.

Le hub entre ensuite en maintenance, refuse les nouvelles mutations, laisse finir les requêtes en cours et crée une sauvegarde chiffrée de retour arrière de la base actuelle. Il remplace la base et son secret uniquement par renommages atomiques dans le même volume, puis redémarre complètement le processus.

Une restauration ne peut pas simplement reprendre les anciens curseurs mobiles. Le protocole introduira une `restoreGeneration` :

- une nouvelle génération aléatoire est inscrite après chaque restauration ;
- au premier échange, un téléphone portant l'ancienne génération reçoit `restore_required` ;
- Friday bloque l'envoi de son ancienne outbox, efface son cache métier local puis effectue un pull complet ;
- les opérations locales non synchronisées sont donc perdues, ce qui justifie le prérequis d'attente à zéro ;
- un appareil ajouté après la date du backup peut devoir être appairé de nouveau.

Le fichier de retour arrière est conservé localement jusqu'à ce que le propriétaire confirme que Friday redémarre, que les comptes sont accessibles et que les nombres annoncés correspondent.

## UX retenue

La section de réglages reste courte :

- `Créer une sauvegarde` ;
- date et résultat de la dernière sauvegarde réussie ;
- `Partager` et `Télécharger` après création ;
- `Importer une sauvegarde` ;
- avertissement permanent : « La clé de récupération doit être conservée séparément. »

Les détails techniques et les sauvegardes automatiques restent dans un panneau secondaire. Aucun export n'est lancé automatiquement vers WhatsApp.

## Ordre d'implantation

1. générer et restaurer un snapshot cohérent par scripts locaux, avec fixtures et base temporaire ;
2. ajouter le format ZIP, les empreintes et le chiffrement `age` ;
3. prouver une restauration sur un répertoire de données vide ;
4. ajouter `restoreGeneration` au protocole hub/mobile et tester le rejet d'une ancienne outbox ;
5. exposer l'export et le téléchargement dans les réglages ;
6. ajouter la prévisualisation et la confirmation d'import ;
7. ajouter le partage natif avec repli téléchargement ;
8. seulement ensuite ajouter une rotation automatique et Google Drive Desktop.

La restauration par script est la fondation et la voie de secours si l'interface devient indisponible.

## Preuves exigées

- export pendant des écritures concurrentes puis `integrity_check` réussi ;
- fichier partagé illisible sans la clé et restaurable avec elle ;
- archive altérée, fichier trop grand, mauvais format et mauvaise clé refusés sans toucher à la base active ;
- restauration N-1 migrée correctement et sauvegarde plus récente refusée ;
- coupure du processus avant et après le remplacement : base active ou retour arrière toujours récupérable ;
- ancienne outbox d'un téléphone bloquée après changement de génération ;
- restauration sur hub vide avec comptes, tâches, courses et classifications retrouvés ;
- partage ou téléchargement vérifié physiquement sur A17 et iPhone ;
- clé privée, secret d'authentification et SQLite brut absents des logs et fichiers finaux non chiffrés ;
- `pnpm verify` et recette de restauration complète réussis avant activation.

## Conséquences et limites

Le fichier est simple à déplacer, mais il n'est pas auto-suffisant : la clé de récupération séparée est indispensable. Cette séparation est la protection principale lorsqu'un document est envoyé à un service tiers.

La restauration remplace l'état canonique complet ; ce n'est ni un import sélectif ni une fusion. La synchronisation de tous les appareils avant restauration évite de sacrifier silencieusement une opération locale.

WhatsApp ne constitue pas une politique de rétention, ne garantit pas la disponibilité future du fichier et ne remplace pas un test de restauration. Une sauvegarde non restaurée au moins une fois reste une sauvegarde non prouvée.

## Retour arrière

Tant que l'import UI n'est pas prouvé, seul le script de restauration hors ligne est activé. Si une restauration échoue après remplacement, arrêter le hub, remettre la sauvegarde de retour arrière créée juste avant l'opération puis redémarrer. Ne jamais tenter de fusionner manuellement deux fichiers SQLite.

## Références

- [SQLite — Online Backup API](https://sqlite.org/backup.html)
- [age — implémentation et format officiels](https://github.com/FiloSottile/age)
- [W3C — Web Share API](https://www.w3.org/TR/web-share/)

# ADR-005 — Authentification fermée et appairage

Date : 9 août 2026

Statut : accepté, candidat automatisé à recetter sur appareils réels

## Contexte

Friday doit partager les données d'un seul foyer entre deux adultes sans exposer une inscription publique. Le fonctionnement local hors ligne doit rester possible sur un appareil déjà lié, tandis que toute synchronisation avec le hub doit vérifier le compte, le foyer et l'appareil.

## Options considérées

- comptes et sessions développés directement dans Friday ;
- Better Auth avec SQLite et routes d'enrôlement fermées propres à Friday ;
- fournisseur d'identité externe ou lien envoyé par email ;
- secret unique partagé par les deux adultes.

## Décision

Utiliser Better Auth avec SQLite pour les mots de passe, cookies et sessions, derrière les routes fermées de Friday :

- le premier adulte initialise le foyer seulement si aucun membre n'existe ;
- l'inscription et la connexion publiques de Better Auth ne sont pas exposées ;
- l'utilisateur choisit un identifiant Friday simple de 2 à 40 caractères, sans espace, composé de lettres, chiffres, points, tirets ou tirets bas ; aucune adresse e-mail réelle n'est demandée ;
- Better Auth reçoit uniquement une adresse technique dérivée par hachage de cet identifiant et jamais renvoyée à l'interface ; l'identifiant visible reste stocké séparément et comparé sans tenir compte de la casse ;
- le propriétaire génère un code aléatoire de 8 chiffres, valable 10 minutes et à usage unique, stocké sous forme de HMAC ;
- le second adulte crée son compte et lie son appareil avec ce code ;
- une session de 30 jours est liée à un `deviceId` et utilise un cookie `HttpOnly`, `Secure` sur HTTPS et `SameSite=Strict` ;
- chaque push vérifie le foyer, le profil, l'appareil et l'auteur d'une création ; chaque pull exige une session et un appareil actifs ;
- le propriétaire peut révoquer l'autre appareil, ce qui supprime ses sessions serveur ;
- après révocation, un nouveau code et la phrase secrète du second adulte permettent de remplacer l'ancien appareil sans créer un troisième compte ;
- après révocation, le propriétaire peut aussi oublier explicitement le second adulte : son compte et ses identifiants sont supprimés, tandis que le profil métier stable et les données partagées restent attribués au rôle de second adulte ;
- les mutations authentifiées refusent les origines navigateur non approuvées, en complément du cookie `SameSite=Strict` ;
- les tentatives et événements sensibles sont bornés et journalisés ;
- le secret Better Auth est généré une fois à côté de la base, hors du dépôt et de Google Drive.

Le cache local déjà présent reste utilisable hors ligne après une coupure. Une révocation empêche la prochaine synchronisation, mais ne prétend pas effacer à distance les données déjà téléchargées sur un téléphone.

Une déconnexion demandée hors ligne efface immédiatement le profil local et pose un marqueur. Au retour du hub, Friday invalide d'abord le cookie serveur avant d'autoriser une nouvelle ouverture de session.

## Conséquences

Le foyer n'a aucune adresse e-mail à saisir, aucune dépendance à Gmail et aucune dépendance à Internet pour se connecter. L'initialisation doit être effectuée par le propriétaire sur le LAN avant qu'un tiers présent sur ce LAN ne puisse revendiquer un hub vide. Au MVP, un seul appareil actif est lié à chaque adulte ; le propriétaire peut remplacer l'appareil révoqué du second adulte. Une perte ou une réinitialisation des deux appareils nécessite encore une procédure opérateur à définir.

Les identifiants de profils historiques sont conservés afin que les tâches créées avant l'authentification restent attribuées correctement après migration.

## Preuve

- modèle de menace : `docs/friday-threat-model.md` ;
- migration SQLite et service : `apps/hub/src/db/database.ts`, `apps/hub/src/auth/` ;
- garde des routes et contrôle d'identité : `apps/hub/src/app.ts` ;
- écrans et cache de session hors ligne : `apps/web/src/auth/` ;
- tests d'intégration : fermeture de l'inscription, origine approuvée, cookie, appairage à usage unique, attribution au second profil et révocation ;
- scénario Chrome mobile à deux contextes ; recette physique décrite dans `docs/recipes/galaxy-a17-lot-1a-auth.md`.

## Retour arrière

La frontière `ClosedAuthService` isole Better Auth. Un autre fournisseur peut le remplacer en conservant les tables Friday de foyer, membres et appareils ainsi que les contrats d'API. Les migrations appliquées ne sont jamais supprimées d'une base existante.

## Révision

Après la recette A17 et le premier appairage d'un second téléphone réel, puis avant toute exposition réseau différente du LAN privé.

# État de la Veille RSS-first

> Ce document décrit le socle RSS-first initial. L'état actif est maintenant
> [la Veille orchestrée](17-etat-veille-orchestree.md).

Date : 12 août 2026

Statut : **candidat automatisé ; recette Galaxy A17 requise**

## Périmètre implanté

La destination `Veille` est privée par profil. Chaque veille contient un nom, une question, des mots-clés inclus/exclus, un à dix flux validés, une cadence quotidienne ou hebdomadaire, une heure locale et, pour l’hebdomadaire, un jour.

Tavily intervient seulement sur action explicite `Suggérer des sources`. Une veille active ne lance aucune recherche Tavily récurrente. Un site sans flux RSS/Atom annoncé et vérifiable est refusé dans ce lot.

La collecte directe :

- mutualise un flux identique entre les profils ;
- utilise `ETag` et `Last-Modified` ;
- normalise URL, GUID, date, titre et extrait ;
- déduplique par URL/empreinte dans le flux ;
- crée une référence silencieuse lors du premier passage ;
- collecte ensuite toutes les six heures lorsque le hub fonctionne ;
- conserve six mois, sauf les articles `À suivre`.

Les pages d’article ne sont ouvertes que si l’extrait du flux est insuffisant. Le lecteur bloque HTTP, ports non standard, identifiants d’URL, IP littérales et destinations privées/réservées, revalide chaque redirection, borne taille/temps et respecte `robots.txt`. Seul le texte extrait est transmis au modèle et il n’est pas conservé comme page complète.

Qwen 3.5 reçoit un document explicitement marqué non fiable et produit un JSON contraint : pertinence, type de nouveauté, résumé et justification. Il ne dispose d’aucun outil. Une panne Ollama conserve les articles et reporte l’analyse au lieu d’afficher une fausse absence de nouveauté.

## UX et offline

Les vues sont `Digest`, `Tous les articles` et `Mes veilles`. `Aujourd’hui` affiche une carte lorsque le cache contient un digest ou des nouveautés non lues.

Les digests, articles et réglages reçus sont conservés dans un snapshot Dexie chiffré. Au démarrage, `Aujourd’hui` et `Veille` affichent ce snapshot sans attendre le hub, puis tentent une actualisation en arrière-plan. Cette règle couvre aussi le cas où le téléphone conserve Internet par les données mobiles mais ne peut plus joindre l’adresse privée du hub ; la tentative réseau est bornée à cinq secondes et ne masque pas le contenu local. `Lu`, `Utile`, `À suivre` et `Masquer ce sujet` sont optimistes et placés dans une outbox chiffrée hors ligne. `Masquer ce sujet` exige la confirmation du mot ou de l’expression ajouté aux exclusions.

La création, la validation d’un flux, les suggestions, la pause et l’actualisation exigent le hub connecté.

## Stockage et reprise

La migration SQLite 16 ajoute les flux, veilles, articles/FTS5, correspondances, états, opérations idempotentes, digests et runs persistants. La migration Dexie 6 ajoute snapshot et outbox de veille.

Un run interrompu par redémarrage revient dans la file. Une erreur décale la prochaine tentative d’une heure pour empêcher une boucle coûteuse. Une échéance manquée produit au plus un run de rattrapage puis la prochaine occurrence future est recalculée en `Europe/Paris`.

## Preuves automatisées

Les tests ciblés couvrent RSS/Atom, paramètres de tracking, URL privées, cadence/DST, migration, séparation des profils, rejeu d’état, cache/outbox chiffrés et repli sur le snapshot lorsque le hub privé ne répond pas malgré un navigateur déclaré en ligne. Le scénario Chrome mobile couvre la carte Veille dans `Aujourd’hui`, l’accès au digest et la conservation de `À suivre` après rechargement hors ligne.

La preuve globale et le redémarrage du runtime sont consignés lors du déploiement. Les comportements Galaxy A17 et iPhone ne sont pas déclarés avant recette physique.

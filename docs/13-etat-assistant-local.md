# État de l’Assistant local

Date du checkpoint : 10 août 2026

Statut : **candidat automatisé déployé ; recette physique et qualité des réponses réelles encore ouvertes**

## Périmètre livré

`Assistant` est la sixième destination principale. Les conversations sont privées par profil et leurs copies locales sont chiffrées dans Dexie. Un message saisi hors ligne est conservé dans une outbox dédiée puis transmis au retour du hub.

Le candidat couvre :

- conversations créées, renommées et archivées ;
- modes `Auto`, `Web rapide`, `Web approfondi` et `Classique` ;
- consentement explicite avant toute recherche Web proposée ;
- sources numérotées, validées et affichées avec les réponses ;
- file SQLite persistante, reprise après redémarrage, annulation et nouvelle tentative ;
- séparation serveur par `profileId` et session/appareil Friday ;
- rendu Markdown sans HTML brut ni mutation métier directe ;
- état d’attente chiffré et relisible hors ligne.

Le comportement runtime et les modèles sont détaillés dans [le runbook Assistant](runbooks/assistant-gemma.md).

## Données et sécurité

Les messages canoniques sont conservés dans SQLite et leur cache mobile est chiffré avec la clé non extractible de l’appareil. La recherche Web ne démarre qu’après consentement et les contenus distants sont traités comme des données hostiles, jamais comme des instructions système.

L’Assistant ne reçoit pas le droit de créer ou modifier directement une tâche, une course ou une écriture budgétaire. Toute future action métier devra passer par une proposition structurée, un aperçu puis une confirmation explicite.

## Preuves

Le 10 août 2026 :

- `pnpm verify` réussit avec 142 tests unitaires/intégration et 22 scénarios Chrome mobile ;
- le build produit des chunks Assistant chargés à la demande ;
- les migrations SQLite 10 et 11 sont appliquées ;
- une sauvegarde pré-migration est conservée hors dépôt sous `D:\FridayData\backups` ;
- le runtime est reconstruit et son healthcheck HTTPS répond sur `https://127.0.0.1:8443` et l’origine LAN reste `https://192.168.1.14:8443`.

## Limites ouvertes

- aucune réponse réelle Gemma/Ministral n’est déclarée qualitativement validée par ce checkpoint ;
- aucune recette Assistant n’est encore confirmée sur le Galaxy A17 ou l’iPhone ;
- la disponibilité, la latence et la pertinence des recherches Web restent à observer ;
- une panne Ollama doit rester sans effet sur Agenda, Courses, Budget et synchronisation.

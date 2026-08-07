# Questions, réponses et points ouverts

Date de mise à jour : 8 août 2026.

Les décisions détaillées et leur impact se trouvent dans [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md).

## Questions résolues

### Où se trouve l'autorité de convergence ?

**Réponse :** sur le PC familial. Chaque mobile possède néanmoins une copie locale et une file d'opérations afin de rester utilisable lorsque le PC ou le Wi-Fi est indisponible.

### Quelles plateformes faut-il prendre en charge ?

**Réponse :** Friday est une PWA. La mise au point, l'UX, l'offline et la recette du MVP utilisent le PC Windows et le Samsung Galaxy A17.

L'iPhone 11 Pro Max sera testé ultérieurement avec la même PWA. Il n'y a plus de projet Flutter, de build Xcode ni d'abonnement Apple dans le périmètre.

**Contrainte acceptée :** les rappels de tâches totalement offline ne sont pas garantis par la PWA et la synchronisation iPhone se fera principalement lorsque Friday est ouverte ou revient au premier plan.

### Quel type de client faut-il construire ?

**Réponse :** une PWA installable et offline-first, pas une application native. Le service worker conserve l'interface ; une base Web locale chiffrée conserve les dernières données et une outbox.

### Google Drive fournit-il la version offline ?

**Réponse :** non. La version offline se trouve sur le téléphone. Drive reçoit uniquement des sauvegardes chiffrées et sert à restaurer le hub ou un nouvel appareil.

### Le PC doit-il fonctionner en permanence ?

**Réponse :** non. Il peut rester allumé deux à trois jours puis être redémarré. La synchronisation et l'IA attendent son retour ; le cœur Maison continue localement.

### Quel agenda fait autorité ?

**Réponse :** un calendrier Google « Maison », possédé de préférence par un compte Google dédié au foyer.

Au MVP, Friday lit les événements, les met en cache et les affiche. La création/modification reste dans Google Calendar.

### Que faut-il partager ?

**Réponse :** toutes les données opérationnelles du foyer : tâches, courses, agenda et budget.

Les profils ne cloisonnent que la veille, les préférences d'assistant, le digest et les notifications. Il n'y a pas de visibilité privée par objet au MVP.

### Quel niveau de chiffrement ?

**Réponse :** le client PWA chiffre les données sensibles au niveau applicatif avant stockage dans la base Web locale. SQLCipher n'est plus une exigence du client.

Les sauvegardes cloud sont chiffrées côté Friday avant envoi. Le PC utilise aussi le chiffrement du volume système. Le choix de chiffrement de la base centrale sera validé pendant le spike P0.

### Comment choisir les thèmes de veille ?

**Réponse :** chaque utilisateur choisit librement ses thèmes, mots-clés, sources et fréquence. Des modèles sont proposés uniquement pour accélérer la configuration.

### Quelle complexité de tâche conserver ?

**Réponse :** titre obligatoire ; date, responsable, répétition et note facultatifs. Les catégories, priorités, sensibilités, contextes et dépendances ne font pas partie du flux normal.

### Faut-il un RAG et des embeddings ?

**Réponse :** non pour le MVP. SQL et FTS5 suffisent aux données structurées et à la recherche textuelle. Une recherche sémantique pourra être testée plus tard pour l'historique de veille, sur le PC uniquement.

### Quel modèle budgétaire faut-il afficher ?

**Réponse :**

- dépenses : frais fixes, courses, santé, loisirs et extras ;
- revenus : réguliers ou extra ;
- épargne : objectif, versement réel, évolution mensuelle et cumul annuel.

Friday sépare l'épargne réellement transférée du simple reste disponible en fin de mois.

## Questions restantes

Ces questions ne bloquent pas le démarrage. Chaque question possède une valeur par défaut.

### 1. Quelles notifications acceptez-vous ?

**Défaut :** tâche à échéance, événement proche, enveloppe dépassée et digest prêt. Une notification n'est pas répétée sans évolution de la situation.

### 2. Le compte Google Maison sert-il aussi d'adresse administrative ?

**Défaut :** oui pour la récupération et les alertes techniques. Friday ne lit pas les emails au MVP.

### 3. Comment saisir l'épargne réellement effectuée ?

**Défaut :** versement manuel ou récurrent vers une enveloppe Épargne, distinct du solde restant.

### 4. Combien de temps conserver l'historique de veille ?

**Défaut :** six mois de métadonnées et résumés ; aucun téléchargement permanent de page complète.

### 5. Où conserver la clé de récupération du foyer ?

**Défaut :** impression papier ou gestionnaire de mots de passe partagé, distinct du compte Google Maison.

## Décisions à prendre pendant l'usage, pas avant

- ajout de la saisie d'événement directement dans Friday ;
- import CSV bancaire ;
- accès au hub hors domicile ;
- recherche sémantique dans la veille ;
- météo et briefing de départ ;
- scan de tickets ;
- listes spécialisées d'entretien ou de stocks.

Ces fonctions ne doivent entrer dans la roadmap qu'après un besoin observé pendant le pilote.

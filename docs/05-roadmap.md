# Roadmap de mise en service

> **Note de mise à jour — 8 août 2026 :** cette roadmap Flutter/Android/iOS est historique. La roadmap active commence par un spike PWA/offline sur le PC et le Galaxy A17, puis Maison, veille/assistant et sauvegarde. Voir [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md).

## Deux niveaux de mise en service

### Pilote immédiat non unifié

Effort : 1 à 2 jours.

- figer et compiler la branche choisie de Home Mind ;
- installer l'APK sur les deux téléphones ;
- utiliser tâches, rappels, À préciser et courses ;
- conserver temporairement le classeur budget simple ;
- utiliser Jarvis sur le PC pour les questions et la météo ;
- tester le partage Drive chiffré existant si un cloud relais est acceptable.

Ce pilote donne de la valeur rapidement et révèle les usages réels. Il n'offre pas encore une seule interface, un budget mobile, la veille ou un hub LAN.

### MVP Friday unifié

Effort estimé : 20 à 30 jours de développement concentré, hors publication Play Store et iOS.

La fourchette dépend surtout de trois décisions : chiffrement intégral de la base mobile, agenda externe et acceptation ou non d'un transport Drive temporaire.

## Ordre recommandé

### Étape 0 — Figer la base

Effort : 1 à 2 jours.

- faire l'inventaire des changements de `redesign-learning-os-bubbles` ;
- terminer, séparer ou abandonner explicitement chaque changement ;
- créer un commit et un tag source pour Friday ;
- exécuter `flutter analyze`, `flutter test` et un build release ;
- sauvegarder une base réelle anonymisée pour les migrations ;
- créer le monorepo Friday sans écraser les dépôts sources.

Porte de sortie : le même code peut être reconstruit et les données Home Mind peuvent être sauvegardées/restaurées.

### Étape 1 — Vertical slice local-first

Effort : 3 à 5 jours.

- reprendre l'app mobile simplifiée ;
- conserver foyer, profils, capture, tâches, courses et rappels ;
- ajouter l'outbox commune ;
- créer Friday Hub avec `/health`, appairage et base SQLite ;
- pousser/tirer un type simple, par exemple `GroceryItem` ;
- afficher l'état de connexion et la file en attente ;
- tester PC coupé pendant une création puis resynchronisation.

Porte de sortie : une course créée offline sur A apparaît sur B après retour du PC, sans doublon.

### Étape 2 — Tâches et agenda utilisables à deux

Effort : 3 à 4 jours.

- ajouter récurrence simple ;
- clarifier responsable, concerné et visibilité ;
- finaliser Aujourd'hui/Semaine ;
- synchroniser tâches, occurrences, rappels et captures ;
- ajouter conflits explicites ;
- créer la revue hebdomadaire minimale.

Porte de sortie : deux téléphones utilisent tâches et agenda interne pendant sept jours, dont une journée hors Wi-Fi.

### Étape 3 — Budget mobile

Effort : 4 à 6 jours.

- créer les tables et repositories budget ;
- importer une base initiale depuis le classeur simple ou par saisie guidée ;
- implémenter revenus/charges, transactions, enveloppes, dépenses prévues et réserve ;
- construire les calculs purs et leurs tests ;
- ajouter les écrans saisie rapide et tableau de bord ;
- appliquer visibilité partagée/privée ;
- synchroniser avec règles append-only ;
- exporter CSV et sauvegarde chiffrée.

Porte de sortie : les totaux de référence correspondent au classeur sur trois mois tests et une transaction offline converge correctement.

### Étape 4 — Passerelle Ollama et assistant borné

Effort : 3 à 5 jours.

- extraire l'appel modèle de Jarvis dans `model_gateway` ;
- benchmarker Granite 4 3B, Ministral 3 8B et Gemma 4 12B sur les scénarios Friday ;
- définir les schémas d'intentions ;
- implémenter capture → proposition → confirmation → commande ;
- ajouter briefing local puis reformulation optionnelle ;
- imposer niveaux de risque, timeouts, taille de contexte et file de jobs ;
- tester prompt injection, outil inconnu et modèle indisponible.

Porte de sortie : vingt phrases de capture sont correctement routées ou demandent une clarification, et aucune erreur modèle n'écrit directement dans la base.

### Étape 5 — Veille RSS-first

Effort : 3 à 5 jours.

- créer sources et abonnements par profil ;
- collecter RSS/Atom avec ETag et `Last-Modified` ;
- normaliser et dédupliquer ;
- résumer en tâche de fond avec Gemma ;
- construire digest, recherche FTS5 et feedback ;
- synchroniser les fiches et états de lecture ;
- traiter les contenus comme non fiables.

Porte de sortie : deux profils reçoivent des digests différents, chaque item a une source, et une indisponibilité Ollama ne bloque pas la collecte.

### Étape 6 — Durcissement et pilote de 14 jours

Effort : 3 à 5 jours, puis 14 jours calendaires d'observation.

- service Windows et démarrage automatique ;
- HTTPS/appairage, révocation et limites ;
- sauvegarde automatique et restauration testée ;
- compactage du journal ;
- migrations et récupération après arrêt brutal ;
- métriques de synchronisation et IA ;
- test sur deux téléphones réels ;
- correction des frictions observées, sans ajouter de grand module.

Porte de sortie : critères de succès du MVP atteints et aucun défaut de perte/confidentialité critique ouvert.

## Cutline si le délai est plus court

Si seulement dix jours sont disponibles, conserver :

- Home Mind simplifié ;
- transport de partage déjà existant ou synchronisation LAN limitée aux tâches/courses ;
- budget manuel sans enveloppes avancées ;
- briefing déterministe ;
- veille RSS avec résumé différé ;
- Granite pour l'extraction et Gemma uniquement en arrière-plan.

Reporter :

- conflits éditables dans l'UI, remplacés temporairement par une copie « conflit » ;
- agenda externe ;
- SQLCipher si aucune donnée réelle sensible n'est encore saisie ;
- règles de récurrence complexes ;
- import CSV ;
- accès hors réseau domestique.

Ne jamais couper pour gagner du temps : sauvegarde, idempotence, validation des sorties, séparation des profils et visibilité de la synchro.

## Backlog priorisé

### P0

- baseline Home Mind figée ;
- hub + appairage ;
- outbox et sync tâches/courses ;
- profils et visibilité ;
- récurrence simple ;
- budget déterministe ;
- assistant avec confirmation ;
- veille sourcée ;
- sauvegarde/restauration ;
- tests offline et deux appareils.

### P1

- lecture agenda externe ;
- import CSV bancaire ;
- checklists et modèles ;
- entretien maison/voiture ;
- menus et repas ;
- accès distant par tunnel privé ;
- SQLCipher si non retenu au P0 ;
- widget Android et raccourcis système.

### P2

- voix push-to-talk ;
- Home Assistant en lecture puis scènes autorisées ;
- écran d'entrée ou frigo ;
- embeddings après évaluation ;
- OCR de tickets contrôlé ;
- iOS ;
- publication large.

### P3

- wake word ;
- vision et caméras ;
- multiroom ;
- capteurs/modulo ;
- robots ;
- automatisations externes sensibles.

## Stratégie de test

### Mobile

- tests purs du domaine et des calculs ;
- repositories Drift en mémoire ;
- migrations avec copie de base ;
- widgets compact/grand téléphone ;
- notifications et changement de profil ;
- tests offline avec transport simulé.

### Hub

- API et authentification ;
- idempotence push/pull ;
- conflits et tombstones ;
- jobs de veille relançables ;
- réponses JSON invalides ;
- timeout Ollama ;
- injection dans un article ;
- sauvegarde et restauration.

### End-to-end

- deux appareils, un foyer ;
- PC coupé puis rallumé ;
- changement simultané ;
- rotation ou révocation d'un appareil ;
- base migrée ;
- modèle absent ;
- flux RSS cassé ;
- perte réseau pendant push ;
- restauration sur hub vide.

## Risques et parades

| Risque | Signal | Parade |
|---|---|---|
| périmètre trop large | nouveau module chaque semaine | geler la cutline P0 |
| sync sous-estimée | doublons ou écrasements | vertical slice dès l'étape 1 |
| Gemma trop lent | réponses interactives longues | modèle rapide + jobs de fond |
| PC souvent éteint | files d'attente permanentes | mesurer disponibilité, mini-PC plus tard |
| partage privé ambigu | agrégat révélant une dépense | tests de non-divulgation |
| saisie budget abandonnée | réel incomplet | saisie < 15 s et récurrences |
| veille bruyante | digest ignoré | peu de sources, feedback, limite d'items |
| notifications anxiogènes | désactivation globale | budget d'interruption et revue |
| dette Home Mind | migration cassée | tag source, base de test, migrations |

## Décision de go/no-go après le pilote

Continuer si :

- les deux adultes utilisent spontanément au moins trois fonctions ;
- la synchronisation est comprise et fiable ;
- la saisie budget reste assez simple ;
- la veille produit au moins un item utile par semaine ;
- l'assistant réduit la saisie sans créer d'erreurs dangereuses.

Réduire si :

- Friday devient surtout un chatbot ;
- la moitié des données finit encore dans d'autres outils sans lien ;
- le PC est trop rarement disponible ;
- les conflits de confidentialité deviennent trop difficiles à expliquer ;
- la maintenance de la veille dépasse sa valeur.

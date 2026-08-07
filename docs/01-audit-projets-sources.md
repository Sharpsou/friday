# Audit des projets sources

Date de l'audit : 7 août 2026.

> **Note de reprise — 8 août 2026 :** ce document conserve les faits et idées extraits des quatre projets. Ses recommandations Flutter ne décrivent plus l’implémentation active. Friday est une PWA TypeScript ; Home Mind et les autres projets restent en lecture seule. Commencer par [00-reprise-nouveau-chat.md](00-reprise-nouveau-chat.md).

## Résultat en une phrase

`Home_mind` est la seule base produit directement réutilisable ; `jarvis` est un laboratoire technique à extraire, `budget` est une spécification métier sous forme de classeurs, et `modulo` est une vision de plateforme dont la plupart des éléments sont post-MVP.

## Méthode et limites

- `Home_mind` : lecture de la documentation, du modèle Drift/SQLite, des domaines et de la navigation ; suite Flutter exécutée avec succès le 7 août 2026, soit 116 tests sans échec.
- `jarvis` : lecture de la documentation, des notebooks et de l'inventaire Ollama local.
- `budget` : inspection structurelle du document Word et des deux classeurs finaux. Le classeur simple et le classeur familial complet ont été analysés avec leurs valeurs et formules.
- `modulo` : extraction structurelle des 201 paragraphes et 48 tableaux du document fondateur.
- Limite documentaire : aucun moteur Word ou LibreOffice n'est installé sur le PC. Les deux DOCX ont donc été lus structurellement mais n'ont pas pu être contrôlés visuellement page par page.
- Limite de modification : `Home_mind` est sur la branche `redesign-learning-os-bubbles` avec environ 2 200 lignes de changements locaux non commités. Aucun fichier de ce projet n'a été modifié pendant cet audit.

## Home Mind

### Ce qui est déjà solide

- application Flutter Android, avec compatibilité iOS préservée ;
- base locale Drift/SQLite ;
- profils du foyer séparés des niveaux d'accès ;
- tâches, planning, rappels locaux, sensibilités et règles de visibilité ;
- capture rapide et boîte « À préciser » ;
- prochaine action calculée, avec report et choix alternatif ;
- liste de courses persistée ;
- onboarding du foyer et invitation par QR ;
- export/import, paquets chiffrés, identité d'appareil et logique de réconciliation ;
- transport de synchronisation abstrait et transport Google Drive déjà implémenté ;
- installation release déjà validée sur deux appareils Android ;
- tests du domaine, des repositories, des parcours, du chiffrement, de la synchronisation et des tailles d'écran.

### Ce qu'il faut réutiliser

- le shell Flutter, le thème et les composants accessibles ;
- les contrats de repositories et les entités local-first ;
- `Household`, `Profile`, `Access`, `HouseholdAction`, `Schedule`, `Reminder`, `GroceryList`, `GroceryItem`, `CaptureNote` et `VisibilityRule` ;
- `NextActionService` ;
- le journal de changements, les tombstones, les révisions et les identifiants par appareil ;
- `SyncTransport` et le moteur de paquets, en ajoutant un transport LAN vers le PC ;
- les écrans Accueil, Ajouter, Semaine, Foyer, Réglages, Courses et À préciser.

### Ce qu'il faut simplifier ou corriger

- figer d'abord la branche de redesign : la reprise ne doit pas se faire depuis un état de travail non identifié ;
- remplacer les noms `Prototype*` sur les composants stabilisés ;
- remplacer la phrase de passe de foyer codée en dur par une vraie clé créée à l'appairage ;
- rendre l'état de synchronisation lisible ;
- ne pas exposer Google Drive comme prérequis si le choix « strictement local » est confirmé ;
- ajouter une vraie récurrence de tâches : elle est documentée mais pas présente dans le schéma Drift actuel ;
- ajouter le budget et la veille comme domaines, pas comme texte libre dans les tâches ;
- éviter de réintroduire Mois/Trimestre avant que la vue Aujourd'hui/Semaine soit réellement utile.

## Jarvis

### Ce qui existe réellement

Jarvis est un laboratoire Jupyter, pas encore un service applicatif. Le micro-agent courant :

- utilise `granite4:3b` comme routeur ;
- utilise `gemma4-12b-builder:64k` pour les réponses généralistes ;
- exécute en Python le calcul, la date/heure et la météo Open-Meteo ;
- valide les décisions et arguments avec Pydantic ;
- limite les corrections et affiche les métriques Ollama.

### Ce qu'il faut réutiliser

- la distinction entre règles déterministes et raisonnement LLM ;
- les sorties JSON contraintes et validées ;
- un registre fermé d'outils ;
- les niveaux de risque et les confirmations ;
- les métriques : temps de chargement, premier résultat, durée, débit, erreurs ;
- un modèle rapide pour router et un modèle plus qualitatif pour synthétiser ;
- SQLite/FTS5 avant tout moteur vectoriel ;
- l'idée d'un workflow de veille testable, dédupliqué et reprenable.

### Ce qu'il ne faut pas reprendre tel quel

- les notebooks comme runtime de production ;
- une cascade de deux modèles pour chaque petite commande ;
- LangGraph, un système multi-agent ou une base vectorielle au démarrage ;
- l'exposition d'Ollama au réseau domestique ;
- une mémoire implicite alimentée par chaque conversation.

## Budget

Deux versions existent.

### Version simple

La version simple est la meilleure référence MVP. Elle contient :

- revenus fixes par personne ;
- frais fixes, nature essentielle/ajustable/épargne et statut ;
- frais prévisionnels avec date, priorité, personne et état ;
- journal des entrées et sorties occasionnelles ;
- réserve de début de mois et cible de sécurité sur trois mois ;
- solde après fixes, solde mensuel suivi et frais à 30/60/90 jours ;
- alertes sur les montants manquants.

### Version familiale complète

Elle ajoute :

- projection sur douze mois ;
- méthode des enveloppes ;
- transactions réelles ;
- revenus et charges mensualisés ;
- sources et contrôles ;
- rapprochement du réel avec le prévisionnel.

### Traduction recommandée dans Friday

Le MVP doit conserver le fond, pas reproduire les onglets :

- `RecurringEntry` pour revenus et charges récurrents ;
- `Transaction` pour le réel ;
- `Envelope` pour les plafonds mensuels ;
- `PlannedExpense` pour les dépenses à venir ;
- `SavingsGoal` pour réserve, épargne et projets ;
- calculs déterministes pour reste à vivre, écarts et échéances.

À exclure du MVP : connexion bancaire, catégorisation bancaire automatique, prévision par LLM, conseils financiers, OCR de relevés et fiscalité.

## Modulo

### Principes à conserver

- local-first avec dégradation claire ;
- calme par défaut et peu de notifications ;
- personnes, pièces et situations plutôt qu'un profil unique ;
- IA comme ressource gouvernée, jamais comme autorité ;
- « Action Firewall » entre proposition et exécution ;
- information expliquée et action annulable ;
- Core Hub séparé du compute IA ;
- pas de dépendance au GPU pour agenda, budget, courses ou règles domestiques ;
- fonctions situées utiles : météo, départ, agenda, courses, entretien, école, déchets, colis et qualité de l'air.

### Éléments à repousser

- écrans muraux, miroir, frigo ou chevet dédiés ;
- Matter, Thread, ESPHome, pont infrarouge et réseau de capteurs ;
- audio multiroom et satellites vocaux ;
- reconnaissance visuelle, caméras et inventaire automatique ;
- domotique, énergie, robots et Jetson.

Ces sujets peuvent devenir des clients ou des adaptateurs de Friday plus tard. Les introduire maintenant retarderait la première valeur quotidienne.

## Fonctionnalités importantes oubliées dans la demande initiale

Les quatre projets font ressortir plusieurs fonctions à forte valeur :

1. **Capture rapide et boîte À préciser** : noter une pensée incomplète sans remplir un formulaire.
2. **Prochaine action calme** : montrer une action utile plutôt qu'un compteur anxiogène.
3. **Récurrence domestique** : ménage, poubelles, filtres, assurances, inscriptions et renouvellements.
4. **Mise à plat hebdomadaire du foyer** : agenda, tâches, budget, courses et décisions en dix minutes.
5. **Visibilité partagée ou privée** : indispensable pour budget, santé pratique, cadeaux et travail.
6. **Rappels administratifs, scolaires et de santé pratique** : sans transformer l'app en dossier médical ou coffre-fort.
7. **État de synchronisation et sauvegarde** : savoir si les données de la compagne ont été reçues est une fonctionnalité produit.
8. **Briefing de départ** : météo, prochain événement, tâche urgente et élément à emporter.
9. **Entretien de la maison et des équipements** : filtres, chaudière, voiture, garanties et consommables.
10. **Boucle de feedback de la veille** : lu, utile, à suivre, masquer le sujet ; sans elle la personnalisation restera superficielle.

## Matrice de réutilisation

| Capacité | Source principale | État | Décision Friday |
|---|---|---:|---|
| Application mobile | Home Mind | avancé | reprendre |
| Profils et foyer | Home Mind | avancé | reprendre et simplifier |
| Tâches et rappels | Home Mind | fonctionnel | reprendre, ajouter récurrence |
| Agenda interne | Home Mind | partiel | unifier tâches et événements |
| Courses | Home Mind | fonctionnel | reprendre |
| Synchronisation | Home Mind | avancé mais Drive | réutiliser le moteur, ajouter LAN |
| Budget | Budget | classeurs | réimplémenter comme domaine |
| Assistant local | Jarvis | laboratoire | extraire dans un service PC |
| Veille | Jarvis | conception | construire RSS-first |
| Garde-fous IA | Jarvis + Modulo | documenté | intégrer dès le MVP |
| Domotique et modules | Modulo | vision | post-MVP |
| Voix | Jarvis + Modulo | faisabilité | post-MVP |

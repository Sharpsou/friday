# Périmètre produit et MVP

> **Note de mise à jour — 8 août 2026 :** ce document conserve le cadrage initial. Friday est maintenant une PWA offline-first validée sur le PC et le Galaxy A17 ; Google Calendar est l'agenda de référence et l'iPhone sera testé ultérieurement. Le périmètre actif est [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md) et prévaut sur les sections contradictoires ci-dessous.

## Promesse

> Friday aide chaque membre du foyer à savoir ce qui mérite son attention, à partager l'organisation quotidienne et à anticiper les dépenses, sans rendre la maison dépendante d'un cloud ou d'une IA.

La mesure de succès n'est pas le nombre de modules. Après quatre semaines d'usage, Friday doit avoir réduit les oublis, les doubles saisies, les discussions logistiques répétitives et le temps passé à chercher l'information.

## Challenge de la vision initiale

### Le PC ne peut pas être l'unique source de vérité

Si toute écriture dépend du PC, l'app ne fonctionne plus dans les transports, hors Wi-Fi ou lorsque le PC dort. Le compromis recommandé est :

- chaque téléphone écrit immédiatement dans sa base locale ;
- le PC sert de hub de convergence et conserve l'historique partagé ;
- les modifications en attente sont envoyées quand le PC redevient joignable ;
- les fonctions IA et la collecte de veille sont indisponibles hors connexion, mais leurs résultats déjà synchronisés restent consultables.

Le PC est donc le centralisateur du foyer, pas un point de panne pour les fonctions de base.

### « Agenda » doit être défini

Recréer Google Calendar ou Outlook n'est pas un MVP. Friday doit d'abord proposer un agenda interne commun : événements familiaux, échéances et tâches planifiées. La lecture d'un agenda externe peut être ajoutée ensuite ; la synchronisation bidirectionnelle et la gestion d'invitations restent hors MVP.

### « Budget simple mais complet » a une limite claire

Complet signifie que l'on comprend le mois et les dépenses à venir. Cela ne signifie pas connexion bancaire, fiscalité, conseil financier ou catégorisation parfaite par IA.

La saisie manuelle est acceptable si elle prend moins de quinze secondes, si les récurrences évitent les ressaisies et si un import CSV peut être ajouté plus tard.

### L'IA ne doit pas être dans le chemin critique

Les totaux budgétaires, les échéances, les notifications, la récurrence et la synchronisation sont déterministes. Ollama intervient pour :

- transformer une phrase en proposition structurée ;
- résumer et classer la veille ;
- expliquer des données déjà calculées ;
- générer un briefing lisible.

Le modèle ne calcule pas le budget, ne décide pas seul d'une dépense et ne modifie pas silencieusement une tâche.

### Une veille personnalisée n'est pas une recherche web illimitée

Le MVP commence avec des flux RSS/Atom et des sources explicitement ajoutées. Cela apporte provenance, stabilité et déduplication. La recherche ouverte sur le web, les réseaux sociaux et le scraping viennent après une première boucle réellement utilisée.

## Utilisateurs du MVP

### Adulte principal sur son téléphone

- possède un profil par défaut lié à l'appareil ;
- voit ses éléments privés et ceux du foyer ;
- peut créer et modifier les éléments partagés ;
- dispose de sa veille et de son briefing personnels.

### Compagne sur son téléphone

- possède son propre profil et ses préférences ;
- voit les données du foyer autorisées ;
- peut créer, terminer et modifier les tâches, courses et éléments budgétaires partagés ;
- reçoit sa propre veille et son propre briefing.

### Autres membres du foyer

- peuvent exister comme profils concernés sans compte ni téléphone ;
- servent à attribuer une tâche, un rendez-vous ou une dépense ;
- n'obtiennent pas automatiquement l'accès aux données sensibles.

## Périmètre Must

### 1. Foyer, profils et confidentialité

- création du foyer ;
- appairage d'un second téléphone par QR temporaire ;
- profil par défaut par appareil et changement manuel de profil ;
- rôles `participant`, `gestionnaire`, `administrateur` ;
- visibilité `foyer`, `privé`, `profils choisis` ;
- verrouillage optionnel de l'app par biométrie ou code système ;
- écran simple indiquant PC joignable, dernière synchro, éléments en attente et dernière erreur.

### 2. Capture et boîte À préciser

- capture texte en une action ;
- proposition en ligne lorsque le PC est disponible : tâche, course, dépense prévue, note ou question ;
- capture brute locale lorsque le PC est absent ;
- validation explicite avant création par l'assistant ;
- boîte regroupant les éléments incomplets et possibilité de les convertir plus tard.

### 3. Tâches, agenda interne et rappels

- tâche ou événement ;
- titre, notes, catégorie, priorité et visibilité ;
- responsable et personnes concernées ;
- date, heure optionnelle et durée estimée ;
- statuts à faire, en cours, fait, reporté et à préciser ;
- récurrence simple : quotidien, jours choisis, hebdomadaire, mensuel ;
- rappel local et report de rappel ;
- vues Aujourd'hui et Semaine ;
- prochaine action explicable et deux alternatives maximum ;
- création d'une tâche depuis une dépense prévue ou une course importante.

### 4. Courses

- une liste partagée par défaut ;
- ajout rapide, quantité et unité optionnelles ;
- rayon/famille, urgence et note ;
- cocher, reporter, remplacer et vider les éléments pris ;
- produits récurrents, ajoutés seulement après confirmation ;
- fonctionnement complet hors connexion.

### 5. Budget

- revenus et charges récurrents par profil ou foyer ;
- nature essentielle, ajustable ou épargne ;
- transactions manuelles en entrée, sortie ou transfert ;
- catégories et enveloppes mensuelles ;
- dépenses prévues avec date, montant, priorité et statut ;
- objectifs de réserve ou d'épargne ;
- tableau de bord : revenus, charges fixes, dépenses variables, reste à vivre, enveloppes, réserve et dépenses à 30/60/90 jours ;
- alertes sur montants manquants, échéances proches et enveloppes dépassées ;
- visibilité partagée ou privée ;
- export CSV et sauvegarde chiffrée.

### 6. Veille par profil

- abonnements par thème et par profil ;
- sources RSS/Atom explicites ;
- collecte planifiée sur le PC ;
- déduplication par URL canonique et empreinte de contenu ;
- titre, source, date, lien et extrait toujours conservés ;
- résumé court et étiquettes générés par Ollama en arrière-plan ;
- digest par profil ;
- états non lu, lu, enregistré, ignoré ;
- feedback utile/pas utile pour ajuster les abonnements, sans entraînement automatique du modèle ;
- derniers digests disponibles hors connexion.

### 7. Assistant quotidien borné

L'assistant sait :

- afficher le briefing du jour ;
- lire les tâches, événements, courses, budget et veille autorisés au profil actif ;
- expliquer un total budgétaire calculé par le moteur ;
- proposer une tâche, un événement, une course ou une dépense prévue ;
- rechercher dans les éléments locaux et les articles de veille ;
- demander les informations manquantes ;
- refuser une action non autorisée.

L'assistant ne sait pas dans le MVP :

- envoyer un message ou un email ;
- acheter, payer ou déplacer de l'argent ;
- supprimer en masse ;
- modifier un agenda externe ;
- contrôler la maison ;
- exécuter du shell arbitraire ;
- agir sans aperçu sur une donnée partagée ou sensible.

### 8. Briefing et revue du foyer

- briefing personnel : météo optionnelle, prochains événements, échéances, prochaine action, budget à surveiller, courses urgentes et veille ;
- version foyer sans données privées ;
- revue hebdomadaire guidée en moins de dix minutes ;
- résumé des éléments créés, terminés, en retard et à préciser ;
- budget de notifications : pas de répétition sans changement de situation.

## Comportement offline

| Fonction | Sans Wi-Fi ou PC éteint |
|---|---|
| Tâches et événements | lecture et écriture locales complètes |
| Rappels | notifications locales maintenues |
| Courses | complet localement |
| Budget | saisie et calculs locaux complets |
| Profils et droits connus | disponibles depuis le cache local |
| Veille | derniers articles et digests en cache seulement |
| Assistant conversationnel | indisponible, remplacement par actions rapides et capture brute |
| Briefing | version calculée localement avec les dernières données connues |
| Synchronisation | modifications placées dans l'outbox, statut visible |

Le mode offline n'essaie pas de simuler une IA absente. L'app doit dire « Assistant indisponible, votre note sera traitée plus tard » et continuer à rendre service.

## Périmètre Should juste après le MVP

- lecture seule d'un calendrier Google, Outlook ou CalDAV ;
- import CSV bancaire assisté, sans identifiants bancaires ;
- menus de la semaine reliés aux courses ;
- checklists réutilisables : sacs, départ, vacances, rentrée ;
- entretien maison/voiture et garanties ;
- déchets et recyclage ;
- météo et heure de départ ;
- partage d'un digest ou d'un article ;
- notifications intelligentes mais déterministes ;
- accès distant via un tunnel privé.

## Hors MVP

- banque connectée et initiation de paiement ;
- synchronisation bidirectionnelle de calendriers ;
- email, messagerie et réseaux sociaux ;
- assistant vocal permanent ou mot d'activation ;
- modèle IA sur le téléphone ;
- mémoire vectorielle universelle ;
- multi-agent et orchestration durable complexe ;
- Home Assistant, Matter, capteurs, écrans dédiés et robots ;
- caméras, reconnaissance de personnes et inventaire visuel ;
- recommandations médicales ou financières ;
- version iOS distribuée ;
- publication grand public.

## Parcours de référence

### Matin

1. Le profil ouvre Friday.
2. L'accueil affiche le prochain événement, une action prioritaire et une alerte utile maximum.
3. Le briefing mentionne un dépassement budgétaire seulement si le seuil a changé.
4. Le profil peut ouvrir son digest de veille sans exposer celui de l'autre adulte.

### Capture en ligne

1. Le profil saisit « penser à acheter des couches et prendre rendez-vous pour le vaccin ».
2. Granite propose deux objets structurés.
3. L'app affiche l'aperçu ; aucune écriture n'a encore eu lieu.
4. Le profil corrige ou confirme.
5. Friday crée une course et une tâche avec rappel.

### Capture offline

1. Le profil saisit la même phrase sans PC.
2. La note est enregistrée immédiatement dans À préciser.
3. Au retour du PC, l'app propose de la structurer.
4. Une confirmation reste obligatoire.

### Dépense prévue

1. Un adulte crée « dentiste, 300 €, le 15 octobre ».
2. Le moteur l'ajoute au prévisionnel et recalcule les 90 jours.
3. Friday propose facultativement une tâche de prise de rendez-vous.
4. Le jour du paiement, la dépense prévue est marquée payée et une transaction réelle est créée.

### Synchronisation du couple

1. Chaque téléphone continue à fonctionner sans le PC.
2. Quand le hub revient, les outbox sont poussées.
3. Les nouvelles lignes indépendantes sont fusionnées.
4. Une modification simultanée du même objet crée un conflit visible au lieu d'écraser silencieusement une version.

## Critères de succès du MVP

- 14 jours d'usage réel sur deux téléphones ;
- aucune perte de données lors de trois cycles PC éteint/rallumé ;
- une tâche, une course et une transaction saisies offline puis partagées correctement ;
- 95 % des synchronisations nominales sans intervention ;
- aucun calcul budgétaire confié au LLM ;
- chaque résumé de veille renvoie au lien source ;
- au moins trois usages volontaires par semaine et par adulte ;
- revue hebdomadaire réalisée en moins de dix minutes ;
- sauvegarde restaurée sur une installation de test ;
- aucune donnée privée d'un profil visible depuis l'autre profil sans autorisation.

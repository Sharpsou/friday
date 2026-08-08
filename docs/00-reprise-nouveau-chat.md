# Friday — point de reprise pour un nouveau chat

Date de l’audit : 8 août 2026

Statut : **point d’entrée canonique**

But : permettre à un nouveau chat de reprendre l’implémentation existante sans dépendre de l’historique de conversation.

## 1. Verdict de l’audit

Le projet est en cours d’implémentation et peut être repris directement dans un nouveau chat.

Les décisions produit, métier et techniques sont maintenant consolidées. Il reste volontairement quelques décisions de mise en place qui doivent être tranchées au moment où elles deviennent utiles ; elles ont toutes une valeur par défaut et un checkpoint défini.

Le code Friday et son historique Git doivent être préservés. Le prochain chat doit commencer le Lot 1A à partir de l’état courant, pas recommencer le cadrage, réinitialiser le dépôt ou tenter de reprendre la branche Flutter de Home Mind.

## 2. Ordre de lecture et autorité documentaire

| Priorité | Document | Autorité |
|---:|---|---|
| 1 | `AGENTS.md` | règles de travail dans le workspace |
| 2 | ce document | état réel, reprise et prochaines actions |
| 3 | [09-decision-finale-pwa-mvp.md](09-decision-finale-pwa-mvp.md) | produit, périmètre et contraintes PWA |
| 4 | [10-feuille-de-route-technique-implementation.md](10-feuille-de-route-technique-implementation.md) | architecture, modèle, lots, tests et skills |
| 5 | [06-questions.md](06-questions.md) | réponses utilisateur et valeurs par défaut |
| 6 | [01-audit-projets-sources.md](01-audit-projets-sources.md) | faits extraits des quatre sources, pas architecture active |
| 7 | [08-option-pwa-offline.md](08-option-pwa-offline.md) | étude expliquant le choix PWA |

Documents historiques, à ne pas utiliser pour décider la stack :

- `02-perimetre-mvp.md` : périmètre initial plus large ;
- `03-architecture-local-first.md` : Flutter/FastAPI historique ;
- `04-modele-de-donnees.md` : modèle initial trop riche ;
- `05-roadmap.md` : roadmap Flutter historique ;
- `07-decisions-apres-reponses.md` : dernière étape native avant le choix PWA.

En cas de contradiction, le document au rang le plus élevé prévaut.

## 3. État réel du workspace

### Friday

Chemin : `D:\prog\friday`

- monorepo pnpm TypeScript avec une PWA React/Vite, un hub Fastify/SQLite, des contrats Zod partagés et des tests automatisés ;
- dépôt Git déjà initialisé sur `main` ;
- remote `origin` déjà configuré vers `https://github.com/Sharpsou/friday.git` ;
- `git commit` et `git push` fonctionnent sans GitHub CLI ; `gh` n’est requis que pour des opérations GitHub supplémentaires comme la création d’une pull request ;
- commande de contrôle globale : `pnpm verify` ;
- vertical slice tâche locale chiffrée, outbox et synchronisation idempotente implémenté ;
- accès HTTPS depuis le Galaxy A17 configuré sur `https://192.168.1.14:8443`, certificat approuvé et IP réservée dans la Livebox ;
- création, modification et suppression locales testées sur l’A17 lorsque le hub est arrêté ou le Wi-Fi coupé ;
- états de connexion stabilisés : une tentative ne reste plus bloquée sur `Connexion…` et aboutit en cinq secondes au plus à `Connecté` ou `Hors ligne` ;
- porte go/no-go du Lot 0B validée sur l’A17 le 8 août 2026 : après redémarrage complet hors réseau, la tâche et l’attente étaient présentes ; au retour du hub, l’attente est revenue à zéro et une seule occurrence a convergé ;
- Lot 1A en cours : terminer/rouvrir, date facultative, rendez-vous avec heure/durée, responsable facultatif et vues `Liste`/`Semaine`/`Mois` dans la page `Agenda` de `Maison` utilisent la voie locale/outbox ;
- un filtre discret `Toutes`/`Moi`/`Autre adulte`/`Non attribuées` s’applique aux trois vues ; les libellés pilotes seront remplacés par les profils appairés lors de l’authentification ;
- une roue dentée compacte ouvre des réglages locaux : les deux responsables peuvent être renommés sans changer leurs identifiants et la palette peut être choisie parmi `Menthe`, `Océan`, `Lavande` et `Ambre` ;
- le pictogramme de réglages utilise un cercle SVG séparé et géométriquement centré ; ce correctif est reconstruit et déployé sur l’origine HTTPS A17 ;
- après un retour A17 montrant l'ordre de création, un candidat trie désormais toutes les listes par date puis heure ; les tâches datées sans heure ouvrent leur journée et les tâches sans date viennent après les tâches planifiées ; la recette `docs/recipes/galaxy-a17-lot-1a-ordering.md` reste à confirmer physiquement ;
- récurrence et note sont maintenant candidates : note facultative même sans date ; répétition quotidienne, hebdomadaire, tous les N jours, mensuelle ou annuelle, bornée par une date de fin inclusive ; toutes les occurrences sont créées localement et apparaissent immédiatement dans Liste, Semaine et Mois ; la suppression propose une occurrence ou toute la série ;
- le choix de suppression récurrente a reçu un retour UX positif de l’utilisateur le 8 août 2026 ; sa recette physique complète hors ligne/reconnexion reste à confirmer avant de fermer le checkpoint Lot 1A ;
- les réglages locaux limitent séparément le nombre de tâches affichées dans `Aujourd'hui` et dans chaque liste `Maison`, sans changer les compteurs totaux ;
- dernier contrôle complet du candidat construit après `f310e2c` : 37 tests unitaires/intégration et 13 scénarios Chrome mobile réussis ;
- terminer/rouvrir et date/agenda, notamment hors ligne, ont été validés sur l’A17 par l’utilisateur le 8 août 2026 ; la recette physique responsable/filtre reste à confirmer ;
- raccourcis Windows opérationnels pour lancer/recetter, lancer ou redémarrer sans navigateur, arrêter le hub et configurer l’accès A17 ;
- `.analysis/` contient uniquement des artefacts temporaires issus de l’audit ;
- `.gitignore` ignore `.analysis/`.

### Projets sources

| Projet | État audité | Usage Friday | Règle |
|---|---|---|---|
| `D:\prog\Home_mind` | Git, branche `redesign-learning-os-bubbles`, 31 entrées de statut ; diff suivi : 30 fichiers, +2182/−551 | concepts foyer/tâches/courses/offline/tests | lecture seule absolue ; ne pas nettoyer ni réinitialiser |
| `D:\prog\jarvis` | Git, branche `master`, propre | modèles Ollama, sorties structurées, garde-fous | lecture seule ; réimplémenter les concepts en TypeScript |
| `D:\prog\budget` | pas de Git, classeurs et données de travail | règles budget et fixtures métier | lecture seule |
| `D:\prog\modulo` | pas de Git, document fondateur | principes local-first, calme et Action Firewall | lecture seule |

Aucun fichier de ces quatre projets ne doit être copié ou modifié sans une décision de réutilisation explicite. Friday réutilise d’abord des concepts, des règles et des scénarios de test.

### Environnement local constaté

| Outil | Version/état |
|---|---|
| Node.js | `v24.15.0` |
| npm | `11.12.1` |
| pnpm | `11.16.0` |
| Python | `3.14.4` |
| Git | `2.39.1.windows.1` |
| Ollama | `0.32.6` |
| Docker | absent et non nécessaire |

Modèles Ollama utiles déjà installés :

- `granite4:3b` — 2,1 Go ;
- `ministral-3:8b` — 6,0 Go ;
- `gemma4-12b-builder:64k` — 7,6 Go ;
- `gemma4-12b-multimodal:128k` — 7,6 Go.

Les autres modèles lourds ne font pas partie du service quotidien.

## 4. Décisions entièrement consolidées

### Produit

- Friday est une PWA familiale simple, beaucoup moins chargée que Home Mind.
- Le PC Windows est le hub, la base canonique et l’hôte Ollama.
- Le PC peut rester allumé deux à trois jours puis être redémarré ; son indisponibilité ne bloque pas les écritures Maison locales.
- Le Samsung Galaxy A17 sert au développement, à l’UX et à la preuve offline.
- L’iPhone 11 Pro Max sera testé plus tard avec la même PWA.
- Aucun build Xcode, Flutter, App Store ou abonnement Apple.
- Trois destinations : Aujourd’hui, Maison, Veille ; bouton `+` permanent.

### UX active

- direction visuelle « futur discret » : contraste sombre, profondeur légère et effets contenus ;
- en-tête réduit à `Friday` ; le libellé générique `Maison` au-dessus du nom a été supprimé ;
- textes d’accueil factuels et directement liés aux tâches ;
- le bouton en haut à droite n’affiche que `Connecté`, `Connexion…` ou `Hors ligne` ;
- `Hors ligne` couvre volontairement aussi bien l’absence de réseau que le hub injoignable : la distinction technique reste interne ;
- le nombre de modifications en attente et la dernière synchronisation restent discrets en bas de la page Aujourd’hui ;
- les conflits ne sont affichés que s’ils existent et renvoient vers les tâches concernées ;
- la suppression d’une tâche est disponible en mode modification, y compris hors ligne ; une tâche ordinaire est supprimée directement et une occurrence récurrente propose de retirer cette occurrence ou toute la série.

### Partage et profils

- tâches, courses, agenda et budget sont communs aux deux adultes ;
- veille, digest, préférences assistant et notifications dépendent du profil ;
- un compte Friday par adulte ;
- un appareil mobile lié à un profil au MVP ;
- pas de visibilité privée par objet au MVP.

### Fonctions Maison

- tâche : titre obligatoire ; date, responsable, récurrence et note facultatifs ;
- course : libellé, quantité libre facultative, case à cocher ;
- budget dépenses : frais fixes, courses, santé, loisirs, extras ;
- budget revenus : réguliers ou extra ;
- épargne : objectif mensuel et versement réel, distinct du reste disponible ;
- Google Calendar Maison : source de vérité, lecture/cache dans Friday, saisie dans Google au MVP.

### Offline et synchronisation

- application et données utiles résident sur le téléphone après installation ;
- Google Drive n’exécute pas Friday ;
- toute écriture passe d’abord dans IndexedDB et l’outbox, même en ligne ;
- création et suppression suivent la même voie locale lorsque le hub est indisponible ;
- le hub applique les opérations de façon idempotente puis fournit un curseur de changements ;
- le mobile synchronise au lancement, au retour au premier plan, au retour réseau et pendant qu’il reste ouvert ;
- une tentative de synchronisation expire après cinq secondes afin de ne jamais laisser l’interface bloquée sur `Connexion…` ;
- rappels totalement offline non garantis par la PWA ; Google Calendar garde ses propres rappels.

### Veille et IA

- RSS/Atom d’abord, sources et thèmes choisis par profil ;
- Granite 4 3B pour le rapide ; Gemma 4 12B pour le fond ; benchmark avant remplacement ;
- Ollama n’est jamais dans le chemin critique des tâches, courses, budget ou synchronisation ;
- toute action IA devient une proposition structurée à confirmer ;
- SQL/FTS5 avant embeddings ; aucun RAG au MVP.

### Sauvegarde

- snapshot cohérent de SQLite ;
- archive chiffrée avec `age` ;
- archive finalisée déposée dans un dossier Google Drive Desktop ;
- clé privée de récupération conservée séparément ;
- restauration sur hub vide obligatoire.

## 5. Stack retenue

| Couche | Choix |
|---|---|
| monorepo | TypeScript + pnpm workspaces |
| PWA | React, Vite, `vite-plugin-pwa`/Workbox |
| stockage mobile | Dexie / IndexedDB |
| chiffrement mobile | Web Crypto AES-256-GCM, clé non extractible par appareil |
| hub | Fastify 5, même origine HTTPS que la PWA |
| contrats | Zod 4 + export JSON Schema |
| base canonique | SQLite WAL avec `better-sqlite3` et FTS5 |
| auth | Better Auth envisagé, confirmé après threat model |
| tests | Vitest, Playwright et recette réelle A17 |
| exploitation | PowerShell + Planificateur de tâches Windows |

Ne pas introduire Docker, Python de production, Next.js, GraphQL, Redis, ORM lourd, Supabase, base vectorielle ou cloud applicatif sans nouvelle ADR.

## 6. Décisions volontairement ouvertes

Ces points ne justifient pas de refaire le cadrage.

| Point | Défaut | Moment de décision |
|---|---|---|
| Auth | Better Auth + SQLite, inscription fermée | threat model de Lot 0A/1A |
| Calendar | compte de service partagé en lecteur | Lot 1B ; OAuth local seulement si nécessaire |
| chiffrement PC | BitLocker/volume Windows + ACL | vérifier avant données financières réelles |
| chemin Drive | dossier synchronisé du compte Maison | Lot 3 |
| notifications | Calendar pour événements ; Friday quand hub disponible | après preuve PWA |

Décisions techniques désormais confirmées : IP `192.168.1.14` réservée dans la Livebox, port HTTPS `8443`, certificat `mkcert` approuvé sur l’A17 et données du hub dans `D:\FridayData` hors Drive.

État externe encore inconnu et à ne pas inventer : compte Google Maison créé ou non, projet Google Cloud, état BitLocker, Google Drive Desktop et chemin de synchronisation.

## 7. Modèle de temps adapté à Codex

Les anciennes estimations en 15–23 jours décrivaient un développement humain conventionnel. Elles sont historiques.

Estimation de pilotage actuelle, non contractuelle :

| Bloc | Travail agentique indicatif | Checkpoint utilisateur |
|---|---:|---|
| socle monorepo | 30 à 60 min | approbation éventuelle des skills P0 |
| preuve PWA/offline/sync | 1 à 2 h | certificat, installation, mode avion et redémarrage A17 |
| comptes, tâches, courses | 1 à 3 h | validation UX courte |
| budget et Calendar | 1 à 3 h | configuration Google Maison |
| veille et assistant | 2 à 4 h | choix de sources et essai de modèles |
| backup et durcissement | 1 à 3 h | conservation de la clé de récupération |

Cible globale : **environ 8 à 16 heures de travail agentique cumulé**, sous réserve des erreurs de dépendances, comportements réels du navigateur et intégrations externes.

Les observations de 7 jours sur l’A17 et 14 jours à deux augmentent la confiance ; elles ne représentent pas du développement et n’empêchent pas de construire les lots suivants après les validations critiques.

## 8. Skills : état et premier gate

- `skill-installer`, `skill-creator` et le navigateur intégré sont disponibles.
- Aucun skill tiers Friday n’a été installé.
- Les candidats et leur provenance exacte sont dans la section 17 du document 10.
- Toute installation requiert lecture complète, contrôle des scripts et accord explicite.

Pack minimal proposé avant Lot 0 :

1. curated Codex `security-threat-model` ;
2. curated Codex `security-best-practices` ;
3. curated Codex `playwright` ;
4. officiel Vercel `vercel-react-best-practices` ;
5. tiers audité `verification-before-completion` de `obra/superpowers`.

`test-driven-development` peut être ajouté au Lot 1 après contrôle. Ne pas installer simultanément plusieurs skills Playwright/Web testing.

## 9. Prochaine action exacte

Le nouveau chat doit :

1. lire `AGENTS.md`, ce document, les documents 09 et 10 ;
2. constater l’état Git existant avec `git status -sb` et `git remote -v`, sans réinitialiser le dépôt ;
3. faire confirmer sur l’A17 les parcours courts de `docs/recipes/galaxy-a17-lot-1a-ordering.md`, `docs/recipes/galaxy-a17-lot-1a-assignee.md`, `docs/recipes/galaxy-a17-lot-1a-settings.md` et `docs/recipes/galaxy-a17-lot-1a-recurrence-note.md`, sans déclarer le comportement physique validé avant le retour utilisateur ;
4. traiter ensuite l’authentification/appairage du Lot 1A avant toute donnée réelle ou utilisation à deux ;
5. ajouter ensuite les courses partagées, puis finaliser conflits et tombstones ;
6. couvrir chaque nouveau parcours par tests unitaires/intégration et Chrome mobile, exécuter `pnpm verify`, puis redémarrer le runtime sans navigateur ;
7. conserver les lignes 7 et 8 de `docs/recipes/galaxy-a17-p0.md` comme contrôles de confiance non bloquants.

Pour publier un changement ordinaire sur le dépôt actuel, utiliser Git directement : commit sur la branche active puis `git push origin main`. Ne pas considérer l’absence de `gh` comme un blocage au commit ou au push.

## 10. Prompt prêt à copier dans un nouveau chat

```text
Lis entièrement AGENTS.md, docs/00-reprise-nouveau-chat.md,
docs/09-decision-finale-pwa-mvp.md et
docs/10-feuille-de-route-technique-implementation.md.

Reprends Friday au Lot 1A à partir du dépôt Git et du monorepo existants. Ne
réinitialise pas Git, ne recrée pas le projet, ne refais pas le cadrage général
et ne modifie aucun projet source dans D:\prog. Vérifie d’abord l’état courant,
puis pars de l’état postérieur à `22dc523`. Terminer/rouvrir et date/agenda sont
validés sur l’A17. Demande d’abord la recette A17 courte du responsable et de son
filtre déjà implémentés. Après ce checkpoint, implémente récurrence simple et note
avec la même voie locale/outbox en ligne et hors ligne. Exécute `pnpm verify`,
redémarre le hub sans navigateur, documente chaque preuve et utilise Git directement
pour les commits et les pushes ; l’absence éventuelle de GitHub CLI ne bloque pas
ces opérations.
```

## 11. Checklist de reprise

- [x] décisions utilisateur consolidées ;
- [x] architecture PWA active séparée des documents Flutter historiques ;
- [x] périmètre métier et exclusions définis ;
- [x] état des quatre projets sources consigné ;
- [x] environnement et modèles Ollama consignés ;
- [x] stack, données, sync, sécurité et tests documentés ;
- [x] roadmap convertie en temps agentique + checkpoints ;
- [x] stratégie de skills et provenance documentées ;
- [x] inconnues externes distinguées des décisions ;
- [x] prochaine action et prompt de démarrage fournis.

## 12. Contrôles réalisés et limites

Contrôles automatiques réussis le 8 août 2026, actualisés sur le candidat responsable construit après `22dc523` :

- documentation active, README et instructions agent contrôlés ;
- aucun lien Markdown local manquant ;
- aucun bloc de code non refermé ;
- aucun caractère de remplacement révélant un problème d’encodage ;
- aucune ancienne estimation en jours dans les références actives ;
- aucune signature évidente de clé privée, token OpenAI ou clé Google dans les documents ;
- décisions PWA, offline/outbox, budget, profils et gate de skills présentes dans les documents canoniques ;
- présence du dépôt Git, du monorepo et de `package.json` confirmée comme nouvel état de reprise.
- `pnpm verify` réussi avec 37 tests unitaires/intégration, le build PWA/hub et 13 scénarios E2E Google Chrome mobile ;
- health checks local et LAN réussis après redémarrage sans navigateur.

Ce que cet audit ne prétend pas avoir validé :

- répétition des ouvertures hors ligne sur plusieurs cycles et plusieurs jours ;
- activation d’une nouvelle version du service worker sur l’A17 sans perte de données ;
- parcours physique A17 du Lot 1A pour le responsable et son filtre ;
- parcours physique A17 des noms configurables et du choix de palette ;
- parcours physique A17 du tri chronologique corrigé dans les quatre vues ;
- parcours physique A17 de la note facultative et des occurrences récurrentes hors ligne ;
- création ou autorisations du compte Google Maison ;
- configuration Google Drive Desktop ou BitLocker ;
- sécurité complète du code au-delà des contrôles et documents déjà présents ;
- comportement iPhone, explicitement différé.

Ces limites sont des tâches de Lot 0/P1, pas des informations perdues.

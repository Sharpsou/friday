# Friday — point de reprise pour un nouveau chat

> Mise à jour du 18 août 2026 : la Veille orchestrée remplace le premier
> candidat RSS. Elle propose une liste de dossiers privés, un `+` contextuel,
> une découverte multi-sources incluant le journalisme, des concepts à trois
> états, la fusion des articles en sujets, une synthèse sourcée et un complément
> Web borné. Voir `docs/17-etat-veille-orchestree.md`.
> La migration SQLite 18 sépare maintenant initialisation, échéance, rattrapage,
> lancement manuel et reprise : un simple redémarrage avant l'heure configurée ne
> collecte et n'analyse plus la Veille.

Date de l’audit : 10 août 2026 ; état actualisé le 18 août 2026

Statut : **point d’entrée canonique**

But : permettre à un nouveau chat de reprendre l’implémentation existante sans dépendre de l’historique de conversation.

## 1. Verdict de l’audit

Le projet est en cours d’implémentation et peut être repris directement dans un nouveau chat.

Les décisions produit, métier et techniques sont maintenant consolidées. Il reste volontairement quelques décisions de mise en place qui doivent être tranchées au moment où elles deviennent utiles ; elles ont toutes une valeur par défaut et un checkpoint défini.

Le code Friday et son historique Git doivent être préservés. Le prochain chat doit reprendre le candidat construit et déployé, incluant `En course`, Budget, Assistant et la mise à jour PWA fiabilisée, pas recommencer le cadrage, réinitialiser le dépôt ou tenter de reprendre la branche Flutter de Home Mind.

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
- Lot 1A en cours : terminer/rouvrir, date facultative, rendez-vous avec heure/durée, responsable facultatif et vues `Liste`/`Semaine`/`Mois` dans la destination `Agenda` utilisent la voie locale/outbox ;
- un filtre discret `Toutes`/`Moi`/`Autre adulte`/`Non attribuées` s’applique aux trois vues ; les libellés pilotes seront remplacés par les profils appairés lors de l’authentification ;
- une roue dentée compacte ouvre des réglages locaux : les deux responsables peuvent être renommés sans changer leurs identifiants et la palette peut être choisie parmi `Menthe`, `Océan`, `Lavande` et `Ambre` ;
- le pictogramme de réglages utilise un cercle SVG séparé et géométriquement centré ; ce correctif est reconstruit et déployé sur l’origine HTTPS A17 ;
- après un retour A17 montrant l'ordre de création, un candidat trie désormais toutes les listes par date puis heure ; les tâches datées sans heure ouvrent leur journée et les tâches sans date viennent après les tâches planifiées ; la recette `docs/recipes/galaxy-a17-lot-1a-ordering.md` reste à confirmer physiquement ;
- récurrence et note sont maintenant candidates : note facultative même sans date ; répétition quotidienne, hebdomadaire, tous les N jours, mensuelle ou annuelle, bornée par une date de fin inclusive ; toutes les occurrences sont créées localement et apparaissent immédiatement dans Liste, Semaine et Mois ; la suppression propose une occurrence ou toute la série ;
- le choix de suppression récurrente a reçu un retour UX positif de l’utilisateur le 8 août 2026 ; sa recette physique complète hors ligne/reconnexion reste à confirmer avant de fermer le checkpoint Lot 1A ;
- les réglages locaux limitent séparément le nombre de tâches affichées dans `Aujourd'hui` et dans chaque liste `Agenda`, sans changer les compteurs totaux ;
- authentification fermée candidate : identifiant Friday simple sans adresse e-mail à fournir, Better Auth/SQLite, initialisation du propriétaire seulement sur foyer vide, inscription publique masquée, second adulte appairé par code de 8 chiffres valable 10 minutes et à usage unique ;
- le propriétaire a initialisé le foyer le 9 août 2026 ; l'appairage d'un second appareil n'est pas encore validé physiquement : le RG405M sous Firefox 151.0.3 atteint Friday mais garde un avertissement de certificat ; l’iPhone a reçu une mise à jour PWA et le correctif d’auto-zoom des champs Tâche/Course, mais son auth et son parcours offline/convergence restent ouverts ;
- chaque session est liée à un appareil et chaque synchronisation vérifie le foyer, le profil et l'appareil ; le propriétaire peut révoquer le second appareil puis le remplacer avec un nouveau code et la phrase secrète existante ;
- après révocation, le propriétaire peut aussi oublier explicitement le compte du second adulte pour permettre une nouvelle identité ; les données partagées et le profil métier stable sont conservés ;
- les cookies sont `HttpOnly`, `Secure` sur l'origine HTTPS et `SameSite=Strict` ; les mutations refusent les origines navigateur non approuvées, le secret serveur est généré hors dépôt et les événements sensibles sont journalisés ;
- le cache chiffré d'un appareil déjà lié s'ouvre immédiatement hors ligne, y compris lorsque le réseau mobile fait croire au navigateur qu'Internet est disponible alors que l'IP privée du hub est inaccessible ; la vérification du hub est bornée à cinq secondes et se poursuit après l'hydratation locale ; une déconnexion volontaire en attente reste bloquante, et une révocation empêche les échanges serveur mais ne peut pas effacer à distance les données déjà téléchargées ;
- navigation corrigée selon le retour utilisateur : `Maison` devient `Agenda` et `Courses` est une quatrième destination principale, sans sous-onglet intermédiaire ;
- courses partagées candidates : la destination `Courses` permet d'ajouter un produit avec quantité facultative, le marquer acheté ou à reprendre et le supprimer ; `Aujourd'hui` résume les produits restants ; chaque action passe par le cache chiffré et la même outbox en ligne et hors ligne ;
- les contrats partagés, la migration SQLite 5, la migration Dexie 2, le push/pull et les tombstones de courses sont couverts ; un correctif recopie aussi l'identité d'appareil de la session authentifiée avant synchronisation pour empêcher un rejet d'identité après appairage ;
- l'édition au toucher est candidate dans le mode `Modifier` : tâche (titre, date, heure, durée, responsable et note, avec portée occurrence/série) et course (libellé, quantité et rayon manuel) passent par le cache chiffré et l'outbox, y compris hors ligne ; le bouton `Supprimer` reste directement visible ;
- un rayon corrigé manuellement est porté par la course partagée et prioritaire sur le classement automatique ; la migration SQLite 7 ajoute les deux colonnes de surcharge manuelle ;
- l'ADR-011 fixe la conservation des versions locale/canonique en conflit et la purge prudente, mais l'utilisateur reporte leur implémentation jusqu'à un signal d'usage réel ; aucune purge physique n'est activée et les tombstones restent conservés ;
- classement par rayon candidat : un bouton `Classer par rayon` lance un job SQLite persistant par lots, visible dans tous les onglets et arrêtable ; la PWA peut être utilisée ou fermée pendant le traitement, et un job interrompu ne modifie jamais la liste ;
- l'aperçu est corrigeable avant application, les corrections exactes sont apprises pour le foyer et les classifications des deux profils fusionnent par article/rayon ; la liste utilise une présentation unique regroupée par rayon, sans sous-onglets `Liste`/`Rayons`, et le cache Dexie chiffré la conserve hors ligne ;
- un bouton `En course` ouvre une vue magasin plein écran qui ne conserve que les rayons, les produits restants, de grandes cibles cochables, une progression et la sortie ; elle réutilise le cache local et fonctionne hors ligne sans lancer Ollama ;
- la détection de mise à jour PWA conserve désormais le signal même s'il arrive avant le montage de l'interface ; une recherche est lancée au démarrage, au retour au premier plan, au retour réseau et lors d'un clic sur l'état de connexion, puis l'utilisateur confirme avec `Mettre à jour` avant le rechargement ; l'utilisateur a confirmé le 9 août 2026 que l'iPhone avait bien reçu la mise à jour, sans préciser le déclencheur exact ;
- l'ADR-008 documente désormais une sauvegarde portable : snapshot SQLite cohérent, archive avec manifeste et secret d'authentification, chiffrement `age`, partage natif ou téléchargement, import prévalidé et génération de restauration empêchant la réinjection d'une ancienne outbox ; cette solution est acceptée comme conception mais n'est pas encore implantée ;
- le budget partagé est un candidat fonctionnel complet : cinquième onglet, mouvements réels, revenus/frais récurrents déterministes, enveloppes modifiables et supprimables, provisions, réserve, corrections et tombstones empruntent le cache chiffré et l’outbox existante ; les sections longues sont condensées et repliables à 360 px ;
- le Chat est une sixième destination privée par profil : conversations et outbox chiffrées localement, file SQLite persistante, pause/reprise, progression persistante avec temps effectif et rendu Markdown ; `qwen3.5:9b-q4_K_M` est le modèle par défaut et Gemma 4 reste sélectionnable ; Tavily alimente `Web léger`, tandis que `Web approfondi` combine Tavily et Exa MCP anonyme côté hub ; aucune mutation métier directe ; le checkpoint consolidé est `docs/15-checkpoint-chat-tavily.md` ;
- le navigateur Playwright côté hub, le cache FTS5 de pages et le modèle Assistant rapide restent retirés ; les migrations SQLite 14–15 portent le journal Tavily et le modèle, 16–18 la Veille orchestrée et 19 les fournisseurs/diagnostics Exa, tout en conservant l’historique lisible ;
- la Veille orchestrée privée par profil est candidate : découverte et validation multi-sources, référence initiale immédiate, cadence quotidienne/hebdomadaire, collecte et analyse uniquement lors d'un run autorisé, rattrapage unique d'une échéance manquée, mémoire concepts/sujets et complément Web borné ; l'état actif est dans `docs/17-etat-veille-orchestree.md` ;
- aucune donnée financière réelle n’a été chargée : BitLocker, les ACL de `D:\FridayData` et la sauvegarde SQLite préalable restent une porte bloquante explicitée dans `docs/runbooks/reprise-budget.md` ;
- la taxonomie `retail-fr-v1` couvre 11 familles de magasins et 25 rayons de supermarché. Le pipeline hybride applique les corrections exactes du foyer puis les règles courantes avant Ministral 3 8B ; chaque réponse porte l'index du produit. Le corpus local de 150 libellés atteint 99,3 % famille/rayon avec 96,7 % de couverture déterministe ; le corpus difficile atteint 88,9 % en 10,4 s à chaud lors de la mesure du 9 août 2026 ;
- la décision complète est consignée dans `docs/adr/010-classement-courses-par-rayon.md`, la taxonomie dans `docs/reference/taxonomie-courses-retail-fr-v1.md` et l'exploitation dans `docs/runbooks/classement-courses.md` ;
- le candidat avec les destinations distinctes `Agenda` et `Courses` a été redémarré sur `https://192.168.1.14:8443` le 9 août 2026 ; le healthcheck réussit et `/api/auth/state` confirme un foyer initialisé (`bootstrapRequired: false`) sans ouvrir de session à un client non authentifié ;
- l’accès extérieur retenu pour une reprise ultérieure est une route Tailscale privée limitée à `192.168.1.14/32`, sans ouverture de box ni changement d’origine ; sa mise en œuvre et l’enrôlement local uniquement sont documentés mais en pause ;
- une sauvegarde pré-migration 12 intègre a été créée hors dépôt le 10 août 2026 ; la migration de retrait 13 conserve ce filet de restauration tout en supprimant les tables Web devenues inutiles ;
- dernier contrôle complet du candidat du 18 août 2026 : `pnpm verify` réussi avec 192 tests unitaires/intégration, les builds PWA/hub et 23 scénarios Chrome mobile ;
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
- L’iPhone 11 Pro Max utilise la même PWA ; mise à jour et correctif d’auto-zoom sont confirmés, auth/offline restent à tester.
- Aucun build Xcode, Flutter, App Store ou abonnement Apple.
- Quatre destinations : Aujourd’hui, Agenda, Courses, Veille ; bouton `+` permanent et contextuel.

### UX active

- direction visuelle « futur discret » : contraste sombre, profondeur légère et effets contenus ;
- en-tête réduit à `Friday` ; l'ancien onglet générique `Maison` a été renommé `Agenda` et `Courses` en est séparé ;
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
- Qwen 3.5 9B Q4 par défaut avec délibération courte automatique, ou Gemma 4 12B avec thinking natif automatique en remplacement local par appareil ; modèle persisté par run ; contextes 8K/16K/32K selon l’étape ;
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
| auth | Better Auth + SQLite, inscription fermée, appairage et appareils révocables |
| tests | Vitest, Playwright et recette réelle A17 |
| exploitation | PowerShell + Planificateur de tâches Windows |

Ne pas introduire Docker, Python de production, Next.js, GraphQL, Redis, ORM lourd, Supabase, base vectorielle ou cloud applicatif sans nouvelle ADR.

## 6. Décisions volontairement ouvertes

Ces points ne justifient pas de refaire le cadrage.

| Point | Défaut | Moment de décision |
|---|---|---|
| Calendar | compte de service partagé en lecteur | Lot 1B ; OAuth local seulement si nécessaire |
| chiffrement PC | BitLocker/volume Windows + ACL | vérifier avant données financières réelles |
| chemin Drive | dossier synchronisé du compte Maison | Lot 3 |
| notifications | Calendar pour événements ; Friday quand hub disponible | après preuve PWA |

Décisions techniques désormais confirmées : IP `192.168.1.14` réservée dans la Livebox, port HTTPS `8443`, certificat `mkcert` approuvé sur l’A17, données du hub dans `D:\FridayData` hors Drive, et authentification fermée décrite par `docs/adr/005-authentification-fermee-appairage.md`.

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
2. constater l'état publié et les éventuelles modifications locales avec `git status -sb` et `git log -5 --oneline`, sans réinitialiser le dépôt ;
3. préserver les lots vérifiés `En course`, Budget, Assistant et mise à jour PWA sans les réimplémenter ;
4. suivre `docs/14-prochaines-etapes-apres-assistant.md` ; les recettes A17 restent ouvertes mais ne bloquent pas le choix fonctionnel suivant ;
5. poursuivre la recette iPhone pour l’appairage, l’authentification et la convergence offline ;
6. laisser conflits et tombstones en observation conformément à l'ADR-011 ;
7. conserver Budget et Assistant à leurs checkpoints documentés jusqu’à un retour d’usage ou une recette physique ;
8. maintenir la décision Tailscale `/32` en pause jusqu’à une reprise explicite ;
9. discuter avec l’utilisateur du prochain lot avant implantation, Calendar en lecture restant l’option fonctionnelle naturelle ;
10. exécuter `pnpm verify` et redémarrer le runtime sans navigateur après toute implantation.

Pour publier un changement ordinaire sur le dépôt actuel, utiliser Git directement : commit sur la branche active puis `git push origin main`. Ne pas considérer l’absence de `gh` comme un blocage au commit ou au push.

## 10. Prompt prêt à copier dans un nouveau chat

```text
Lis entièrement AGENTS.md, docs/00-reprise-nouveau-chat.md,
docs/09-decision-finale-pwa-mvp.md et
docs/10-feuille-de-route-technique-implementation.md, puis suis
docs/14-prochaines-etapes-apres-assistant.md.

Reprends Friday à partir du dépôt Git et du monorepo existants. Ne
réinitialise pas Git, ne recrée pas le projet, ne refais pas le cadrage général
et ne modifie aucun projet source dans D:\prog. Vérifie d’abord l’état courant,
puis préserve les lots publiés `En course`, Budget, Assistant et fiabilisation
de la mise à jour PWA : ils sont déjà vérifiés et déployés, il ne faut pas les
réimplémenter. L'iPhone attend
le retour de sa compagne et ne bloque pas la suite. Ne revendique aucune preuve
physique A17/iPhone non confirmée. L'ADR-011
existe déjà ; conflits et tombstones restent en observation jusqu'à un signal
d'usage réel. Le budget partagé est déjà implanté et documenté dans
docs/12-etat-budget-partage.md et l’Assistant dans docs/13-etat-assistant-local.md ;
ne recharge aucune donnée réelle avant la porte BitLocker/ACL/sauvegarde.
L’ADR-013 retient une route Tailscale /32 mais sa mise en œuvre est en pause.
Demande à l'utilisateur de confirmer le prochain lot, Calendar en lecture étant
l'option naturelle. Après toute implantation, exécute `pnpm verify`, redémarre le hub
sans navigateur et documente la preuve.
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

Contrôles automatiques actualisés sur le candidat complet du 18 août 2026 :

- documentation active, README et instructions agent contrôlés ;
- aucun lien Markdown local manquant ;
- aucun bloc de code non refermé ;
- aucun caractère de remplacement révélant un problème d’encodage ;
- aucune ancienne estimation en jours dans les références actives ;
- aucune signature évidente de clé privée, token OpenAI ou clé Google dans les documents ;
- décisions PWA, offline/outbox, budget, profils et gate de skills présentes dans les documents canoniques ;
- présence du dépôt Git, du monorepo et de `package.json` confirmée comme nouvel état de reprise.
- `pnpm verify` réussi avec 192 tests unitaires/intégration, les builds PWA/hub et 23 scénarios E2E Google Chrome mobile ;
- health checks local et LAN réussis après redémarrage sans navigateur.

Ce que cet audit ne prétend pas avoir validé :

- répétition des ouvertures hors ligne sur plusieurs cycles et plusieurs jours ;
- activation d’une nouvelle version du service worker sur l’A17 sans perte de données ;
- parcours physique A17 du Lot 1A pour le responsable et son filtre ;
- parcours physique A17 des noms configurables et du choix de palette ;
- parcours physique A17 du tri chronologique corrigé dans les quatre vues ;
- parcours physique A17 de la note facultative et des occurrences récurrentes hors ligne ;
- parcours physique A17 des courses en ligne/hors ligne puis sur un second appareil ;
- parcours physique A17 du mode `En course` et de la nouvelle relance de mise à jour ;
- appairage et révocation physiques d'un second appareil ;
- création ou autorisations du compte Google Maison ;
- configuration Google Drive Desktop ou BitLocker ;
- sécurité complète du code au-delà des contrôles et documents déjà présents ;
- appairage et parcours offline complets sur iPhone ; seules la réception d'une mise à jour PWA et la suppression de l’auto-zoom des champs Tâche/Course ont été confirmées physiquement.

Ces limites sont des tâches de Lot 0/P1, pas des informations perdues.

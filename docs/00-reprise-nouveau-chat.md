# Friday — point de reprise pour un nouveau chat

Date de l’audit : 8 août 2026

Statut : **point d’entrée canonique**

But : permettre à un nouveau chat de commencer l’implémentation sans dépendre de l’historique de conversation.

## 1. Verdict de l’audit

Le projet est prêt à être repris dans un nouveau chat pour démarrer l’implémentation.

Les décisions produit, métier et techniques sont maintenant consolidées. Il reste volontairement quelques décisions de mise en place qui doivent être tranchées au moment où elles deviennent utiles ; elles ont toutes une valeur par défaut et un checkpoint défini.

Il n’existe encore aucun code Friday à préserver. Le prochain chat doit construire le Lot 0, pas recommencer le cadrage ni tenter de reprendre la branche Flutter de Home Mind.

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

- aucun code applicatif ;
- 11 documents Markdown après cet audit, plus `README.md` et `AGENTS.md` ;
- aucun `package.json`, aucune base et aucun secret ;
- répertoire **pas encore initialisé avec Git** ;
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
- le hub applique les opérations de façon idempotente puis fournit un curseur de changements ;
- le mobile synchronise au lancement, au retour au premier plan, au retour réseau et pendant qu’il reste ouvert ;
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
| origine LAN | IP du PC réservée par DHCP, HTTPS `mkcert` | Lot 0B avec le routeur et l’A17 |
| port | `8443` si libre | Lot 0B |
| données hub | répertoire dédié hors code et hors Drive | Lot 0A |
| chiffrement PC | BitLocker/volume Windows + ACL | vérifier avant données financières réelles |
| chemin Drive | dossier synchronisé du compte Maison | Lot 3 |
| notifications | Calendar pour événements ; Friday quand hub disponible | après preuve PWA |

État externe inconnu et à ne pas inventer : compte Google Maison créé ou non, projet Google Cloud, capacité DHCP du routeur, état BitLocker, Google Drive Desktop et chemin de synchronisation.

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
2. confirmer brièvement qu’il reprend Lot 0A, sans refaire l’audit ;
3. présenter le pack P0 final et demander l’accord uniquement si l’installation n’a pas déjà été approuvée ;
4. initialiser Git dans `D:\prog\friday` ;
5. créer le monorepo, la commande `pnpm verify` et les ADR initiales ;
6. poursuivre jusqu’à une PWA + hub automatisés ;
7. construire la tâche locale chiffrée, l’outbox et la convergence idempotente ;
8. exécuter les tests ;
9. seulement ensuite demander la recette physique A17.

Première porte : une tâche créée hors ligne sur l’A17 survit à la fermeture forcée et au redémarrage, puis converge une seule fois après retour du hub.

## 10. Prompt prêt à copier dans un nouveau chat

```text
Lis entièrement AGENTS.md, docs/00-reprise-nouveau-chat.md,
docs/09-decision-finale-pwa-mvp.md et
docs/10-feuille-de-route-technique-implementation.md.

Reprends Friday au Lot 0A. Ne refais pas le cadrage général et ne modifie aucun
projet source dans D:\prog. Commence par le gate des skills P0 s’il n’est pas
encore validé, puis implémente de façon autonome le socle et le vertical slice
offline/synchronisation. Ne me sollicite qu’au premier test physique nécessaire
sur le Galaxy A17 ou si une décision change réellement le produit. Exécute les
tests et documente chaque preuve avant de déclarer une étape terminée.
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

Contrôles automatiques réussis le 8 août 2026 :

- 13 fichiers Markdown contrôlés, en comptant `README.md` et `AGENTS.md` ;
- aucun lien Markdown local manquant ;
- aucun bloc de code non refermé ;
- aucun caractère de remplacement révélant un problème d’encodage ;
- aucune ancienne estimation en jours dans les références actives ;
- aucune signature évidente de clé privée, token OpenAI ou clé Google dans les documents ;
- décisions PWA, offline/outbox, budget, profils et gate de skills présentes dans les documents canoniques ;
- absence de code, de Git et de `package.json` confirmée comme état initial attendu.

Ce que cet audit ne prétend pas avoir validé :

- installation et persistance réelles de la PWA sur le Galaxy A17 ;
- certificat, DHCP, pare-feu et comportement du routeur ;
- création ou autorisations du compte Google Maison ;
- configuration Google Drive Desktop ou BitLocker ;
- compatibilité exacte des versions npm qui seront verrouillées ;
- threat model et sécurité du code, puisqu’il n’existe pas encore ;
- comportement iPhone, explicitement différé.

Ces limites sont des tâches de Lot 0/P1, pas des informations perdues.

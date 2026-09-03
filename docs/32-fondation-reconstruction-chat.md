# Fondation de la reconstruction du Chat Friday

Date : 31 août 2026
Statut : **runtime v2 activé par décision utilisateur ; gate qualitative v2 à
compléter**

> **Mise à jour active — sélection éphémère de preuves.** Les sections qui
> décrivent le seul banc lexical v1 et une future réintégration sont désormais
> historiques. Le code actif est partagé par `packages/assistant-core`, le banc
> et le plugin Fastify `/api/chat`. Il sélectionne temporairement les passages
> par BM25 + `qwen3-embedding:0.6b`, avec fusion RRF et repli BM25. Il ne crée ni
> index vectoriel, ni corpus de connaissances persistant, ni framework
> agentique. Le runtime a été ouvert le 31 août 2026 à la demande explicite
> de l'utilisateur, avant la réussite du corpus v2 ; cette activation ne vaut
> pas franchissement de la gate. L'archive `/api/assistant` et son HTTP 410
> restent inchangés.

## 0. État de l'implémentation v2

- `packages/assistant-core` porte contrats, fenêtres continues, BM25,
  embeddings éphémères par lots, RRF, prompts, routage, audit et décision de
  publication ; `chat-eval` en dépend et le Hub n'importe jamais le banc ;
- SQLite 41 ajoute exclusivement `chat_conversations`, `chat_messages`,
  `chat_runs` et `chat_sources`. Aucun prompt, passage, page, embedding ou
  raisonnement n'est persisté ;
- SQLite 42 ajoute les modes `friday|local|web`, fige le mode demandé dans le
  run et rattrape les titres génériques depuis le premier message ;
- le plugin Fastify Chat fournit création, historique, envoi idempotent HTTP
  202, suivi, annulation, reprise de file et confidentialité par profil ; un
  seul run est exécuté globalement et un profil est borné à un actif plus trois
  en attente ;
- une relance dépendante du contexte est reformulée en question autonome avant
  le routage, sur au plus trois échanges précédents et 8 000 caractères. La
  sortie JSON stricte ne peut ajouter d'URL ; une sortie invalide utilise un
  repli déterministe composé uniquement des demandes utilisateur récentes ;
- la recherche Web utilise jusqu'à six requêtes Tavily approfondies et peut
  tenter seize lectures validées pour constituer au plus huit sources finales ;
  les échecs de lecture ne réduisent donc plus mécaniquement le dossier ;
- la PWA Dexie 8 met en cache le nouvel historique dans deux stores chiffrés
  dédiés, sans outbox d'envoi, et conserve l'archive historique séparée ;
- le rédacteur est `gemma4:e4b-it-qat`, l'auditeur
  `qwen3.5:9b-q4_K_M` et l'embedding `qwen3-embedding:0.6b`. L'audit invalide
  est répété une fois à température zéro, puis devient `audit_error` ;
- les statuts persistés sont `unverified`, `verified`, `partial`, `abstained`
  et `audit_error`. Le code retire les unités rejetées et résout les citations
  `P → S → URL` ;
- le dossier v1 reste intact. Le brouillon privé v2 est sous
  `D:\FridayData\evaluations\chat-foundation-v2` et exige une référence de
  paragraphe pour chaque aspect avant gel ;
- l'embedding hybride n'est activable que s'il gagne au moins cinq points de
  rappel sans augmenter le p95 de plus de 25 %. Sans cette preuve, BM25 sera la
  configuration active.

La revue IA renforcée remplace le geste de revue utilisateur, mais n'est jamais
présentée comme une validation humaine. Les résultats v1 plus bas expliquent
la décision d'architecture ; ils ne franchissent pas la gate v2.

Le candidat a passé `pnpm verify` puis la recette Windows. L'origine A17 répond
`health=ok`; SQLite est en migration 42 avec intégrité correcte et aucune
violation de clé étrangère. `FRIDAY_CHAT_ENABLED=true` est persisté pour le
compte Windows. Le smoke test réel du 31 août couvre cinq parcours ; le Web a
publié une réponse partielle en 142 s, sans inventer le fait manquant, mais le
rappel de preuve et le format initial des citations restent à améliorer. Les
URL de brouillon sont supprimées déterministiquement et les groupes `(P…)` sont
normalisés avant résolution par le code.
La sauvegarde pré-migration 40 est
`D:\FridayData\backups\friday-pre-chat-v2-migration41-20260831-094854.sqlite`.
La sauvegarde cohérente pré-migration 42 est
`D:\FridayData\backups\friday-pre-chat-migration42-20260831-134242.sqlite`.

## 1. Décision prise

> **Section historique pour l'interface.** Depuis la décision utilisateur du
> 31 août, la PWA expose `Friday`, `Local` et `Recherche Web`. Friday conserve
> le routage automatique ; les deux autres choix le forcent. Toute recherche
> Web est approfondie, sans distinction léger/approfondi. Le bouton flottant
> crée une conversation ; renommage et suppression sont regroupés dans son menu
> d'actions, avec les dialogues visuels Friday. Le quota Tavily est de nouveau
> visible et le titre dérivé du premier message est rafraîchi immédiatement.

L'ancien moteur du Chat est retiré. Il n'existe plus de modes Local, Friday,
Web léger ou Web approfondi, plus de sélecteur de modèle, plus de création de
conversation et plus d'envoi de message. L'interface conserve seulement la
lecture, l'archivage, la restauration et la suppression des conversations
historiques privées.

Les tables et migrations SQLite 10 à 40 sont conservées. Les supprimer ou les
réécrire rendrait les bases existantes incompatibles et effacerait une trace
utile des essais. Elles ne définissent plus l'architecture future. Les appels
Ollama et Tavily nécessaires à la Veille ont été isolés dans son propre domaine
et ne constituent pas un moteur Chat caché.

Cette remise à zéro est volontaire : ajouter une correction de plus au pipeline
précédent aurait augmenté sa complexité sans rendre sa qualité prévisible.

## 2. Ce que les essais ont réellement montré

### 2.1 Les symptômes répétés

- une recherche pouvait lire de nombreuses pages pertinentes, puis ne produire
  que deux ou trois cartes de preuve pauvres ;
- les réponses sur des sujets simples devenaient courtes, vagues ou réduites à
  une liste, alors que les pages contenaient l'information attendue ;
- une couverture pouvait être déclarée `complete` parce que la structure était
  valide, malgré une réponse manifestement incomplète ;
- l'audit rejetait parfois une formulation correcte ou acceptait une
  formulation peu informative ;
- une règle ajoutée pour corriger un exemple dégradait un autre sujet ;
- les multiples conversions — page, passage, claim, carte, bloc, audit,
  révision — perdaient progressivement les noms, nuances et relations utiles ;
- le mode et le planificateur pouvaient détourner une demande Web explicite ;
- les métriques de forme donnaient une confiance supérieure à la qualité
  réellement perçue.

Deux derniers cas rendent le problème visible. Une recherche sur le télescope
James-Webb disposait de huit sources et d'environ 17 700 caractères lus, mais
n'a gardé que trois cartes acceptées et a rendu trois blocs vagues tout en
annonçant une couverture complète. Une recherche comparative sur des
imprimantes disposait de huit sources, d'environ 26 100 caractères et de pages
lues chez deux fournisseurs ; elle n'a formé que deux claims, tous deux
rejetés, puis est tombée sur un message d'insuffisance.

### 2.2 Résultats des campagnes de banc

Les rapports détaillés restent hors Git sous `D:\FridayData\evaluations`.

| Campagne                   | Résultat utile                                                                     | Conclusion                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `full-models-2026-08-28`   | Gemma rédacteur ≈ 0,883 ; Qwen auditeur ≈ 0,938 ; Ministral planificateur ≈ 0,867  | les rôles ont des préférences, aucun modèle n'est universel       |
| `hard-pipeline-2026-08-29` | pipeline Qwen sans audit ≈ 0,531 contre pipeline courant ≈ 0,120                   | la structure du pipeline dominait le choix du modèle              |
| itérations du 30 août      | plusieurs cas structurellement verts mais réponses pauvres, partielles ou absentes | une gate JSON ou un compte de citations ne mesure pas l'utilité   |
| tests `grounded-answer-v3` | meilleure fermeture des hallucinations, mais forte perte de contenu                | le fail-closed seul produit une réponse sûre mais souvent inutile |

Les scores sont des indicateurs internes, pas des mesures absolues. Les corpus
et juges ont évolué pendant les itérations ; ils servent à comparer des choix
sur un même dossier, jamais à prétendre à un niveau général de fiabilité.

## 3. Conclusion causale

Le nombre de paramètres des modèles n'est pas le problème principal. Gemma E4B
et Qwen 9B sont moins robustes que de très grands modèles lorsqu'un contrat
JSON est long, que les preuves sont nombreuses ou que plusieurs objectifs sont
mélangés. Mais ils ont montré qu'ils savaient rédiger ou auditer correctement
sur un dossier clair.

La cause majeure était le harnais : il demandait aux modèles de compresser la
preuve trop tôt, de recopier des identifiants techniques, de décider de la
couverture et de satisfaire plusieurs contrats à la fois. Chaque étape avait
une chance de retirer de l'information. La boucle de correction travaillait
ensuite sur une représentation déjà appauvrie. Plus elle était durcie, plus la
réponse devenait vide.

La bonne cible n'est donc ni « davantage de règles », ni « un modèle plus gros
qui réparera tout ». C'est un chemin court où le texte source pertinent reste
disponible jusqu'à la rédaction, et où la vérification juge séparément :

1. la fidélité factuelle aux sources ;
2. la réponse effective à la question.

## 4. Cible : un harnais léger en sept opérations

Le futur Chat expose une seule expérience. Le système choisit ses outils ;
l'utilisateur ne choisit ni pipeline ni modèle.

```text
question + contexte court
        ↓
besoin Web déterministe
        ↓
recherche et lecture bornées
        ↓
passages centrés sur la question
        ↓
rédaction libre avec citations
        ↓
audit fidélité + utilité
        ↓
une correction bornée, puis réponse honnête
```

### 4.1 Contexte

Envoyer le dernier échange pertinent et le message courant. Une résolution
simple des pronoms et relances suffit au départ. Ne pas résumer toute la
conversation avec un autre modèle avant chaque réponse.

### 4.2 Décision d'utiliser le Web

Le Web est impératif si l'utilisateur le demande. Il est automatique pour une
information actuelle, une recommandation dépendant de données externes ou une
question qui nécessite des sources. Une heuristique courte et testable décide
les cas évidents ; un petit classifieur local n'intervient que sur les cas
ambigus. Il génère au plus des requêtes et ne peut jamais répondre à la place du
rédacteur.

### 4.3 Recherche et lecture

Interroger les fournisseurs indépendants en parallèle, dédupliquer les URL,
privilégier les sources primaires et lire les pages originales. Tavily ou Exa
peuvent découvrir une page ; ils ne sont pas la preuve citée. Conserver les
protections SSRF, la revalidation après redirection, les limites de taille et
de durée, et traiter toute page comme une donnée hostile.

### 4.4 Sélection des passages

Le code extrait des passages continus avec titre de page, intertitre, URL et
quelques phrases de contexte. Le classement dépend de la question, de la
proximité lexicale et de la diversité des sources. Une proximité sémantique ou
un reranker n'est ajouté que si le banc démontre la limite de ce point de
départ. Il ne transforme pas les passages en claims ni en cartes.

Contrats implantés :

```ts
interface EvidenceSource {
  id: `S${number}`;
  url: string;
  title: string;
  publishedAt?: string;
  retrievedAt: string;
}

interface EvidencePassage {
  id: `P${number}`;
  sourceId: EvidenceSource['id'];
  heading?: string;
  text: string;
}
```

L'URL reste exclusivement dans `EvidenceSource`. Le modèle ne voit et ne cite
que les identifiants de passage ; le code résout ensuite `P → S → URL`.

Le texte doit rester assez long pour préserver le sens. Les limites portent
sur le dossier total, pas sur une phrase artificiellement raccourcie.

### 4.5 Rédaction

Un seul appel rédacteur reçoit la question, le contexte utile et les passages.
Il écrit une réponse naturelle, sans forme imposée, et place les identifiants de
passage après les affirmations factuelles. Gemma reste le premier candidat au
vu des bancs, pas une décision irrévocable.

### 4.6 Audit

Un seul auditeur indépendant reçoit la question, des unités découpées
déterministiquement après rédaction et exactement les mêmes passages. Il ne
recopie pas les phrases :

```ts
interface AuditUnit {
  id: `U${number}`;
  text: string;
  citedPassageIds: EvidencePassage['id'][];
}

interface AnswerAudit {
  units: Array<{
    unitId: AuditUnit['id'];
    verdict: 'supported' | 'unsupported' | 'contradicted' | 'not_factual';
    passageIds: EvidencePassage['id'][];
    reason?: string;
  }>;
  usefulness: 'answers' | 'partial' | 'misses';
  missingAspects: string[];
  evidenceSufficiency: 'sufficient' | 'insufficient';
}
```

Zod refuse les champs supplémentaires, doublons et identifiants hors dossier.
La décision `pass|revise|research|partial` appartient au code, jamais à
l'auditeur. Qwen est le premier candidat auditeur issu du banc.

### 4.7 Correction bornée

Une seule boucle :

- si une phrase est non soutenue, le rédacteur la corrige ou la retire ;
- si un aspect essentiel manque alors que les passages le couvrent, il complète
  la réponse ;
- si les preuves manquent réellement, une seule recherche ciblée est permise,
  puis rédaction et audit sont rejoués une fois ;
- si cela reste insuffisant, la réponse dit précisément ce qui manque.

Il n'y a pas de boucle ouverte, de graphe LangGraph, de rôles multiples, de
réparation JSON récursive ni de règle codée pour une catégorie de produits, un
domaine scientifique ou un vocabulaire particulier.

## 5. Garde-fous qui restent déterministes

- une citation doit désigner un passage réellement fourni ;
- une URL de modèle n'est jamais consultée ;
- nombres, dates et noms propres sans citation déclenchent l'audit, pas une
  validation lexicale métier ;
- le contenu Web est encadré comme non fiable et ne peut modifier les outils,
  prompts ou permissions ;
- aucune sortie brute distante ni chaîne de raisonnement n'est affichée ou
  journalisée ;
- les budgets, délais, annulations et la file Ollama restent bornés ;
- les conversations, requêtes et diagnostics restent privés par profil ;
- le Chat ne réalise aucune mutation Maison ou Robot.

## 6. Méthode de reconstruction et critères de sortie

Ne pas reconnecter immédiatement l'interface. Construire d'abord un exécuteur
hors ligne sur des dossiers de pages figés.

1. Constituer 10 cas de développement et 10 cas de validation, généralistes :
   actualité, explication, comparaison, recommandation, procédure, local,
   scientifique, technique, haut risque et relance contextuelle.
2. Pour chaque cas, conserver question, pages lues, réponse attendue sous forme
   de critères et jugement humain. Ne pas encoder les mots attendus dans le
   pipeline.
3. Mesurer séparément fidélité, complétude utile, qualité rédactionnelle,
   citations, latence et taux de réponse vide.
4. Comparer les modèles par rôle sur exactement les mêmes dossiers. Tester au
   minimum Gemma et Qwen comme rédacteur/auditeur ; GPT-OSS n'est repris que si
   son gain justifie nettement RAM et latence.
5. Geler la validation pendant les ajustements. Une amélioration n'est retenue
   que si elle améliore le score humain global sans nouveau cas catastrophique.
6. Réintégrer au Hub seulement après réussite des dossiers figés, puis tester
   la recherche réelle, le redémarrage, la confidentialité et le mobile.

Critères initiaux : aucune affirmation importante contredite, au moins 90 % des
affirmations factuelles soutenues, au moins 80 % des aspects attendus couverts,
moins de 5 % de réponses vides quand des preuves utiles existent, et aucune
régression de confidentialité ou de sécurité. Ces seuils seront recalibrés sur
le corpus avant de devenir une gate.

## 7. Ce qu'il ne faut pas reconstruire

- quatre modes exposés à l'utilisateur ;
- un long plan de recherche produit par LLM ;
- la chaîne claim → vérification → carte → bloc → audit de bloc ;
- une couverture déclarée par le modèle seul ;
- des règles contenant « abordable », « découverte », « imprimante », une
  année courante ou tout autre cas de test ;
- des scores structurels utilisés comme preuve de qualité ;
- un index/RAG ou LangGraph avant que le chemin linéaire ait démontré sa limite ;
- des appels modèles supplémentaires sans gain mesuré sur le banc gelé.

## 8. Point de reprise utilisateur

La fondation logicielle est désormais implantée. Le prochain checkpoint n'est
pas une reconnexion de l'interface :

1. compléter les 20 fiches privées avec questions, critères et pages originales ;
2. faire relire puis geler les 10 cas de développement et 10 de validation ;
3. exécuter trois graines sur les deux couples de modèles ;
4. comparer les sorties A/B anonymisées ;
5. décider seulement ensuite si un modèle et le harnais franchissent les seuils.

Toute proposition qui ajoute plus d'une étape ou d'une boucle doit démontrer
son gain sur la validation gelée et justifier son coût de maintenance.

## 9. Preuve de retrait

Le candidat du 30 août 2026 a passé `pnpm verify` : formatage, lint, types, 27
tests Robot, 25 contrats, 15 domaine, 107 Hub, 100 PWA, builds de production et
25 scénarios Playwright mobiles. Il a ensuite été reconstruit et redémarré avec
le runbook Windows. `/api/health` répond `status=ok`, `database=ok` et
`ollama=not-required`. La SQLite active reste en migration 40 avec
`integrity_check=ok`, aucune violation de clé étrangère, quatre conversations
et huit messages historiques préservés au moment du contrôle.

## 10. Fondation implantée

Le workspace privé [`packages/chat-eval`](../packages/chat-eval) n'est importé ni
par le Hub ni par la PWA et n'enregistre aucune route. Il fournit :

- les contrats Zod stricts `EvidenceSource`, `EvidencePassage`, `AuditUnit`,
  `AnswerAudit` et corpus gelé ;
- l'extraction de paragraphes continus et un classement lexical diversifié,
  borné par défaut à 8 sources, 12 passages et 24 000 caractères ;
- les prompts courts versionnés, avec preuves externes séparées et critères
  humains absents des appels modèles ;
- le routage déterministe renforcé, puis un classifieur local uniquement pour
  les ambiguïtés, limité à trois requêtes ;
- un client Ollama limité à `localhost`, avec délai, annulation, taille de
  réponse, file, concurrence, tokens et schéma `format` bornés ;
- rédaction Markdown libre, audit structuré indépendant, une révision ou une
  recherche ciblée au plus, puis suppression déterministe des unités rejetées ;
- métriques séparées de soutien, contradiction, précision/complétude des
  citations, utilité, suffisance, vide et jugement humain ;
- sorties A/B anonymisées pour Gemma rédacteur + Qwen auditeur et l'inverse,
  sur les graines 17, 29 et 43.

Le dossier privé `D:\FridayData\evaluations\chat-foundation-v1` contient les
sous-dossiers `pages`, `imports`, `results`, `reviews`, la spécification privée
et le corpus gelé. Les 20 cas se répartissent en 10 développement et 10
validation, avec 35 pages originales figées. Chaque instantané conserve son
URL finale, son type, sa date de récupération et une empreinte SHA-256 ; les 35
empreintes ont été revérifiées après le gel. Les anciens manifests ont été lus
sans modification et ne contenaient aucune page originale réutilisable.

Le téléchargement du corpus accepte seulement HTTPS public, revalide le DNS à
chaque redirection, refuse les réseaux privés et les identifiants dans l'URL,
borne redirections, délai et taille, puis extrait titres et paragraphes. Les
scripts, formulaires, iframes, navigation et autres contenus exécutables ne
sont jamais interprétés comme des instructions.

## 11. Analyse du code et dette technique

### Nettoyage effectué

- ancien moteur Chat, recherches Tavily/Exa, mémoire Friday, sélection de
  recherche, évaluateur et tests associés supprimés du runtime ;
- dépendances Veille encore actives isolées dans son domaine ;
- helper de durée et styles Chat orphelins supprimés ;
- documentation 09, 10 et guide complet marquée comme historique pour le Chat ;
- sources `[S…]` de l'archive de nouveau rendues avec titre, domaine, date et
  lien sûr, testées au niveau composant et navigateur ;
- `noUnusedLocals` et `noUnusedParameters` actifs pour tous les projets
  TypeScript. Aucun autre symbole TypeScript inutilisé n'est signalé.

### Quarantaine volontaire, pas code à supprimer

Les tables `assistant_*`, leurs colonnes et migrations SQLite 10–40, ainsi que
les anciens stores Dexie dont `assistantOutbox`, restent présents. Le moteur ne
les utilise plus pour produire une réponse ; l'archive lit encore conversations,
messages et sources. Les migrations réelles et les stores déjà créés ne doivent
être ni réécrits ni supprimés.

### Dette consignée pour des lots séparés

- `apps/web/src/App.tsx` : environ 2 837 lignes ;
- `apps/hub/src/app.ts` : environ 2 004 lignes ;
- `packages/contracts/src/index.ts` : environ 1 947 lignes ;
- `apps/hub/src/db/database.ts` : environ 1 873 lignes, migrations historiques
  comprises ;
- chunk principal PWA : environ 544,6 kB minifié avant gzip ;
- `inlineDynamicImports` de Workbox est déprécié ;
- une future réintégration devra enregistrer les routes dans un plugin Fastify
  Chat dédié et promouvoir les contrats validés vers un module Assistant
  séparé, sans réutiliser les tables du vieux moteur par défaut.

Ces points ne justifient pas d'élargir ce lot. En particulier, découper les
quatre gros fichiers ou migrer Workbox sans test fonctionnel dédié ajouterait
un risque sans améliorer la qualité mesurée du Chat.

## 12. Preuve de la fondation et campagne `campaign-v2`

La campagne privée `campaign-v2` a exécuté 120 tentatives : 20 cas, deux couples
de modèles et les graines 17, 29 et 43. La rédaction utilise une température
faible de 0,2 afin que les graines mesurent une variabilité réelle ; l'audit
reste déterministe. Les 120 résultats et 60 paires A/B sont présents, sans
tentative manquante. Huit tentatives ont exercé le repli d'audit : une unité
omise devient `unsupported` et un audit invalide ne soutient aucune unité. Il
n'existe aucune réparation JSON récursive ; au plus l'unique révision normale
est appliquée, puis le code produit une réponse partielle sûre.

Les auto-métriques, à confirmer humainement, donnent :

- Gemma rédacteur + Qwen auditeur : 58,3 % `pass`, 77,0 % d'unités soutenues,
  91,9 % de précision des citations, 77,8 % de complétude et 103,9 s en moyenne ;
- Qwen rédacteur + Gemma auditeur : 68,3 % `pass`, 84,2 % d'unités soutenues,
  93,3 % de précision des citations, 67,4 % de complétude et 121,7 s en moyenne.

Sur la seule validation gelée, le soutien pondéré est respectivement de 87,7 %
et 93,3 %. Le second couple franchit donc le seuil automatique de soutien sur
la validation, mais pas la gate globale : sa complétude moyenne des citations
reste à 70,0 % et les aspects attendus n'ont pas encore été notés humainement.

Ces chiffres viennent des auditeurs candidats et ne constituent pas une
validation humaine ni un choix de modèle. Le fichier privé
`reviews\campaign-v2\blind-review.html` présente les 60 comparaisons sans nom
de modèle, rend les réponses comme texte inerte et exporte les jugements au
format JSON. Le HTTP d'envoi reste `410` jusqu'à cette revue et à la décision
explicite du prochain checkpoint.

La gate fraîche `pnpm verify` du 31 août 2026 passe pour le pipeline candidat :
formatage, lint, types, 27 tests Robot, 38 `chat-eval`, 25 contrats, 15 domaine,
124 Hub, 105 PWA, builds de production et 26 scénarios Playwright mobiles.

## 13. Pipeline candidat par axes — 31 août au 3 septembre 2026

Le moteur partagé et le banc possèdent désormais un chemin candidat activable
par `FRIDAY_CHAT_AXES_ENABLED`. Il remplace les conversions intermédiaires par
un plan sans faits de un à cinq axes, puis conserve les passages originaux
jusqu'à la rédaction. Les recherches restent bornées et les embeddings restent
éphémères.

La sélection affecte ses meilleurs passages à chaque axe. Les pages de tag,
catégorie, archive et recherche sont déclassées ; pour une demande récente,
une source non datée reste seulement contextuelle. La date est extraite des
métadonnées de la page originale lorsque Tavily ne la fournit pas.

L'audit modèle exige seulement un verdict, des passages et les axes traités par
unité. `supported` exige toujours une preuve connue. Après validation de la
forme JSON, le code normalise conservativement les erreurs de référence : il
ignore une unité inconnue ou répétée, retire les passages inconnus ou répétés et
rétrograde en `unsupported` tout soutien ou contradiction privé de preuve. Une
unité omise devient elle aussi `unsupported`. Ces défauts ne peuvent donc ni
valider un fait ni faire échouer tout un audit par effet domino. La couverture
des axes n'est plus demandée globalement à Qwen :
le code la dérive par intersection entre passages affectés à l'axe et passages
approuvés dans les unités. Il distingue ainsi révision avec preuve disponible
et nouvelle recherche faute de preuve, sans faire confiance à un jugement
global du modèle.

Les citations écrites par Gemma ne sont plus publiées. Après l'audit, le code
retire tous les identifiants `P`, conserve uniquement les unités soutenues ou
non factuelles, ajoute les passages approuvés par Qwen, puis résout
`P → S → URL`. Tout résidu, URL de modèle ou identifiant inconnu bloque le
statut `verified`.

La PWA restaure le run actif de la conversation depuis le Hub et place son
étape au bas du fil. Une relance reste donc visible pendant recherche,
rédaction ou vérification, même après remontage de l'onglet.

Si l'audit structuré échoue deux fois ou rejette tout, le brouillon est masqué.
Friday affiche seulement des extraits bornés des passages originaux, cités
comme tels, avec un message indiquant les axes encore douteux. Un échec de
recherche Web produit une abstention explicite, jamais un repli local.

SQLite 43 ajoute uniquement des compteurs numériques bornés dans `chat_runs` :
axes prévus, obligatoires et couverts, unités rejetées et code de repli. Aucun
axe, page, passage, prompt, embedding ou raisonnement n'est persisté. Le banc
active ce pipeline par défaut avec `--pipeline=axes`; le runtime reste derrière
le flag jusqu'à réussite de la gate et des cinq essais réels.

Cette section remplace l'ancien comportement de campagne où une unité omise
était automatiquement classée `unsupported`. Les chiffres de `campaign-v2`
restent historiques et ne mesurent pas ce nouveau pipeline.

Le candidat a été déployé le 1er septembre 2026 avec SQLite 43 : healthcheck
`ok`, `integrity_check=ok` et zéro violation de clé étrangère. Le Chat reste
actif via `FRIDAY_CHAT_ENABLED=true`, tandis que
`FRIDAY_CHAT_AXES_ENABLED=true`. La sauvegarde
cohérente pré-migration est
`D:\FridayData\backups\friday-pre-chat-axes-migration43-20260831-235916.sqlite`.

Le 3 septembre, la revue d'une recherche réelle sur les podcasts, formations,
applications et bonnes pratiques agentiques a révélé que la hiérarchie interne
`required|useful` était recopiée comme structure visible. Elle permettait aussi
à une dimension explicitement demandée mais classée `useful` de rester pauvre
sans empêcher le statut `verified`.

Le contrat remplace cette hiérarchie par `primary|cross_cutting` et rend tous
les axes planifiés obligatoires. Le rédacteur reçoit le plan comme checklist
privée, choisit une structure propre à l'intention et doit incorporer les
dimensions transversales aux résultats principaux lorsque les preuves le
permettent. L'auditeur factuel reste compact : il annote chaque unité avec les
axes réellement traités, tandis que le code conserve seul la décision. Une
couverture transversale exige une unité soutenue reliant les deux rôles et une
preuve affectée à l'axe. Une erreur ou omission d'identifiant d'axe ne peut pas
valider un fait ni invalider tout l'audit ; elle dégrade seulement la couverture
et conduit à l'unique révision ou à une réponse partielle.
Une seconde vérification réelle a montré qu'un axe générique « ressources »
pouvait encore absorber podcasts et formations, tandis que le rédacteur ne
recevait pas les titres des sources. Le planificateur doit désormais conserver
chaque type de livrable explicite comme axe principal distinct. Le dossier de
prompt inclut le titre validé associé à chaque passage, sans URL, pour permettre
de nommer les ressources tout en conservant la résolution des liens dans le
code.

Les cinq essais réels autorisés ont été consommés. Le dernier, après
normalisation conservatrice et augmentation de la sortie d'audit à 4 096
tokens, a terminé rédaction, révision et deux audits sans erreur : cinq sources,
aucune unité factuelle rejetée et trois axes couverts sur cinq. La réponse a
nommé un podcast et une formation, mais est restée honnêtement `partial` parce
que les preuves disponibles ne reliaient pas les bonnes pratiques à chaque
ressource. Cette limite relève maintenant de la qualité de récupération et non
d'un rejet global du JSON.

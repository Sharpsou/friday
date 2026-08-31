# Fondation de la reconstruction du Chat Friday

Date : 31 août 2026
Statut : **corpus gelé et campagne exécutée ; revue humaine A/B ouverte**

## 1. Décision prise

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

La gate fraîche `pnpm verify` du 31 août 2026 passe : formatage, lint, types, 27
tests Robot, 37 `chat-eval`, 25 contrats, 15 domaine, 107 Hub, 100 PWA, builds
de production et 25 scénarios Playwright mobiles.

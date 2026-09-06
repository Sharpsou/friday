# Audit Friday — documentation et fonctionnement du Chat

Date : 5 septembre 2026. Révision examinée : `362bf80`, branche `main`.

## Conclusion

Le socle logiciel est vérifiable et les principaux domaines sont séparés. Le Chat v2 est réellement implanté, distinct de l'archive historique. En revanche, ses chemins de dégradation, son contexte conversationnel et son cache présentent des défauts reproductibles que la suite existante ne détecte pas. Le banc d'évaluation ne sait pas exécuter le pipeline unifié annoncé comme actif : sa réussite ne pourrait donc pas valider ce pipeline en l'état.

La priorité est de corriger ces défauts et de rendre l'évaluation représentative, avant une nouvelle évolution du moteur. La documentation doit être consolidée : plusieurs points d'entrée se contredisent encore. Il existe du code sans appelant, mais les archives et les migrations historiques ne constituent pas du code à supprimer aveuglément.

## Périmètre et preuves

- Lecture des instructions, documents de reprise, décisions actives, fondation Chat et runbooks Chat/développement ; confrontation aux routes, contrats, stockage, moteur, interface et tests.
- Contrôle des destinations de liens relatifs dans 73 fichiers Markdown, hors validation des ancres et liens Internet.
- Recherche des références des exports TypeScript dans le dépôt. Ce contrôle repère des candidats au nettoyage ; il ne prouve pas l'absence de tout usage externe.
- Exécution de `pnpm verify`, avec `FRIDAY_E2E_PORT=18443` et la base E2E en mémoire : code de sortie 0.
- Sondes temporaires supplémentaires : SQLite en mémoire, faux modèles et fournisseurs Web, IndexedDB simulé et chiffrement réel. Aucun appel de génération Ollama ou Tavily réel n'est nécessaire à ces reproductions.
- Aucun changement runtime, migration, déploiement, mouvement Robot ou modification de données de production. Seul ce rapport est ajouté au dépôt.

Résultats frais : 27 tests Python Robot, 19 Assistant Core, 25 contrats, 15 domaine, 142 Hub, 106 PWA, 42 banc, 28 Playwright ; formatage, lint, types et builds réussis. Les tests Playwright Chat utilisent des réponses API simulées ; ils ne mesurent pas la qualité du modèle réel.

La revue générale porte sur la cohérence documentaire, l'organisation et la vérification automatisée. La revue approfondie de fonctionnement concerne le Chat. Elle ne constitue pas une certification exhaustive de chaque module, de la sécurité des dépendances ou des appareils physiques. Les affirmations de déploiement A17 des documents n'ont pas été revalidées sur l'origine réelle.

## Fonctionnement réel du Chat

1. La PWA propose `Friday`, `Local` et `Recherche Web`. Elle envoie au Hub avec un identifiant de requête ; il n'existe pas d'outbox d'envoi Chat.
2. Le plugin `/api/chat` authentifie le profil et contrôle l'origine des mutations. Le service stocke le message et le run dans SQLite, puis retourne HTTP 202. Un run s'exécute globalement ; quatre runs au maximum peuvent être actifs/en attente par profil.
3. Une relance reconnue passe par une résolution de contexte. Le mode Local force la génération locale ; Friday route automatiquement ; Web force la recherche.
4. En `unified`, le moteur recherche via Tavily, tente jusqu'à seize lectures originales, conserve au plus huit pages, puis sélectionne douze passages avec BM25 et embeddings éphémères.
5. Gemma rédige, Qwen audite les unités. Le code reconstruit les citations et décide de la publication. Une révision est possible sous condition de budget. Les erreurs JSON et les échecs de services ne suivent pas tous le même traitement.
6. SQLite conserve réponses, références et compteurs, sans dossier Web brut. La PWA suit le run par polling et met l'historique en cache chiffré.
7. `/api/assistant` reste une archive séparée, avec envoi retiré. Le Chat n'a pas d'outil de mutation Maison, Budget ou Robot.

## Défauts et incohérences de fonctionnement

P1 : correction prioritaire. P2 : défaut à traiter dans le lot de stabilisation. « Reproduit » décrit une sonde synthétique, pas une observation sur A17.

### C1 — P1 — Une contradiction connue peut être republiée après révision

**Reproduit.** Dans [verified-chat-engine.ts](../../apps/hub/src/chat/verified-chat-engine.ts), lignes 909–913, un audit final invalide publie le brouillon révisé via `partialDraft`, sans conserver les interdictions issues du premier audit valide.

Sonde : la source indique dix heures d'autonomie ; le brouillon affirme cent heures ; le premier audit marque cette unité `contradicted` ; la révision répète cent heures ; son audit produit un JSON invalide. Résultat publié : « Autonomie cent heures [S1] », statut `partial`, code `FINAL_AUDIT_INCOMPLETE_PUBLISHED`.

Un avertissement est présent, mais la contradiction déjà identifiée revient avec une citation. Cela contredit la promesse de conserver l'autorité de l'auditeur sur les contradictions connues. Correction proposée : en échec d'audit final, revenir au contenu déjà validé ou à un extrait des sources ; ne pas republier librement la révision ni le brouillon rejeté.

### C2 — P1 — Le banc n'évalue pas le pipeline unifié

**Confirmé par le code.** [cli.ts](../../packages/chat-eval/src/cli.ts), lignes 92–97, n'accepte que `legacy` et `axes`. [runner.ts](../../packages/chat-eval/src/runner.ts) possède son propre exécuteur piloté par `axesEnabled`. Le chemin `answerUnified` reste dans le Hub.

Les primitives sont partagées, mais pas l'orchestration complète ni les règles de repli/publication. Les commandes du runbook évaluent par défaut `axes`, alors que le document 27 annonce `unified`. Les campagnes historiques et les cinq essais unifiés ne remplacent pas la gate quantitative v2.

Correction proposée : extraire un exécuteur unifié injectable commun au banc et au Hub, ajouter `--pipeline=unified`, puis comparer lexical/hybride et mesurer les seuils sur ce chemin exact. L'activation anticipée est documentée comme autorisée : elle n'est pas en soi une anomalie.

### C3 — P1 — Le cache chiffre à l'intérieur de la transaction IndexedDB

**Reproduit avec latence injectée.** [chat-repository.ts](../../apps/web/src/db/chat-repository.ts), lignes 22–58, ouvre la transaction Dexie puis attend `crypto.subtle.encrypt` avant les écritures. Cette attente peut laisser la transaction se terminer.

Avec IndexedDB simulé et un délai de 30 ms avant le chiffrement, `cacheChatState` échoue avec `TransactionInactiveError`. Sans délai, la sonde passe. Cela établit une fragilité de séquencement ; la fréquence sur téléphone reste inconnue.

Conséquence : un succès serveur peut être présenté comme une erreur de création/envoi ou être remplacé par un cache ancien, puisque les clients attendent aussi la mise en cache. L'archive a déjà la meilleure structure : elle chiffre les lignes avant d'ouvrir sa transaction. Appliquer cette structure au nouveau cache et tester le chiffrement lent.

### C4 — P2 — Le contexte peut contenir une question future

**Reproduit.** [chat-service.ts](../../apps/hub/src/chat/chat-service.ts), lignes 479–492, sélectionne les six derniers messages en excluant seulement l'identifiant du message traité. Il ne borne pas leur ordinal avant la question courante.

Deux questions mises en attente avant le démarrage : la première reçoit la deuxième dans `priorTurns`. L'historique obtenu est ensuite question 1, question 2, réponse 1, réponse 2. Ce cas est accessible via plusieurs appareils/onglets du même profil et la file autorisée.

Correction proposée : définir l'ordre conversationnel des runs et ne fournir que les messages causalement antérieurs à la demande. Ajouter un scénario avec plusieurs envois dans une même conversation.

### C5 — P2 — La résolution de contexte peut perdre la consigne actuelle

**Deux défauts reproduits.** [context.ts](../../packages/assistant-core/src/context.ts), lignes 119–126 et 140–145 :

- Le repli place l'historique avant la demande actuelle puis tronque à 2 000 caractères. Un historique assez long supprime intégralement « Uniquement en français sur Deezer ».
- Le validateur vérifie la conservation de quelques mots de l'ancienne demande, mais pas des nouvelles contraintes. Une reformulation conservant « podcasts » et « agentique », sans français ni Deezer, est acceptée.

Correction proposée : réserver d'abord le budget au message courant, puis compléter avec l'historique ; contrôler explicitement la conservation des contraintes nouvelles. Le correctif récent protège le sujet précédent, mais ne ferme pas ces deux cas.

### C6 — P2 — Les suppressions distantes ne purgent pas le cache ; les erreurs métier sont masquées

**Reproduit.** [chat-client.ts](../../apps/web/src/sync/chat-client.ts), lignes 36–49 et 96–115, et [chat-repository.ts](../../apps/web/src/db/chat-repository.ts) : le cache ne fait que des `bulkPut`. Une liste serveur vide ne retire pas les conversations ni leurs messages précédemment conservés.

Sonde : une conversation est mise en cache ; le serveur retourne `conversations: []` ; le client retourne bien zéro conversation en ligne, mais une conversation reste dans IndexedDB. Si le serveur répond ensuite `503 chat_disabled`, cette conversation est retournée comme un succès. Le signal `CHAT_DISABLED` ne parvient donc plus à l'interface. Le même repli général s'applique à un 404 ou 401.

Conséquence : conversations supprimées depuis un autre appareil susceptibles de réapparaître hors ligne, et disponibilité du moteur affichée à tort. Cela ne démontre pas un accès croisé entre profils : le cache est filtré par profil.

Correction proposée : distinguer snapshot complet et mise à jour ponctuelle ; réconcilier les suppressions ; différencier erreur réseau et réponse explicite de désactivation/authentification. Préserver l'historique offline avec un état de disponibilité séparé.

### C7 — P2 — Une panne de l'auditeur échoue autrement qu'un JSON invalide

**Reproduit.** [verified-chat-engine.ts](../../apps/hub/src/chat/verified-chat-engine.ts), lignes 1504–1526 : `await generate` se situe avant le `try` chargé de transformer l'échec d'audit en repli. Une exception `OLLAMA_UNAVAILABLE` remonte jusqu'au service et produit un run échoué, même après lecture et rédaction réussies. Un JSON invalide bénéficie, lui, du traitement partiel.

La révision, lignes 882–906, n'a pas non plus de repli protégeant le contenu déjà acquis contre un échec de génération. Correction proposée : unifier les erreurs de transport, timeout et format, en conservant l'annulation utilisateur comme interruption et les rejets factuels connus comme contraintes.

### C8 — P2 — Le quota de sécurité affiché n'est pas appliqué à la recherche

**Confirmé par le code.** [chat-service.ts](../../apps/hub/src/chat/chat-service.ts), lignes 108 et 402–433, calcule les recherches restantes avec un plafond de 950 crédits. [verified-chat-engine.ts](../../apps/hub/src/chat/verified-chat-engine.ts), lignes 1560–1570, lance les recherches sans consulter ce plafond ; [tavily-search.ts](../../apps/hub/src/watch/tavily-search.ts) n'effectue pas non plus ce contrôle.

Le nombre de requêtes par run est borné à six, mais la réserve mensuelle annoncée n'est pas un garde-fou effectif. Afficher zéro ne bloque pas la consommation. Correction proposée : réservation atomique d'un budget commun aux consommateurs Tavily, ou retrait explicite de la promesse de plafond si le compteur doit rester informatif.

### C9 — P2 — Une relance Web ne bénéficie généralement pas de la révision promise

**Confirmé par le décompte du chemin.** Le traitement de contexte, le plan, la rédaction et le premier audit consomment quatre générations. Or la révision unifiée exige `calls <= 3`, ligne 879 du moteur.

Ainsi, une omission d'un type de ressource ou une unité rejetée peut être corrigée pour une question initiale mais pas pour la même question formulée comme relance, alors que le plafond est de six appels et qu'une révision plus un audit tiendraient encore dans ce budget. Le runbook/document 32 présentent la révision comme disponible pour cette omission sans préciser cette restriction.

Correction proposée : réserver explicitement les appels nécessaires aux étapes restantes, puis tester les chemins avec résolution de contexte et avec retry d'audit.

### C10 — P2 — L'idempotence de l'envoi n'est pas conservée après une réponse perdue

**Risque établi par le chemin client, sans reproduction réseau réelle.** [chat-client.ts](../../apps/web/src/sync/chat-client.ts), ligne 132, crée un UUID à chaque invocation. [AssistantView.tsx](../../apps/web/src/AssistantView.tsx), lignes 357–401, remet le texte dans le formulaire si le POST ou la récupération suivante échoue.

Si le Hub a accepté le message mais que la réponse réseau est perdue, renvoyer crée un nouvel identifiant et donc un second run. Le serveur est idempotent pour un identifiant stable ; l'interface ne conserve pas cet identifiant pour la reprise.

Correction proposée : conserver l'identifiant jusqu'à résolution du résultat incertain et rechercher le run correspondant avant de proposer un nouvel envoi. Cela n'impose pas une outbox d'envoi offline.

## Documentation : écarts à corriger

| Priorité | Document                                                                                                            | Écart                                                                                                                                                                       | Action proposée                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P1       | [AGENTS.md](../../AGENTS.md), 57–62                                                                                 | SQLite 40, Dexie 7, archive seule et anciens nombres de tests, contre SQLite 44, Dexie 8 et Chat v2 dans le code et les documents 00/27                                     | Actualiser l'état minimal et renvoyer les compteurs datés vers une preuve unique                             |
| P2       | [09](../09-decision-finale-pwa-mvp.md), 9 et 38                                                                     | Encadré archive seule, mais navigation décrivant un runtime ; six destinations au lieu des sept présentes                                                                   | Corriger l'encadré et distinguer navigation actuelle et cutline d'origine                                    |
| P2       | [10](../10-feuille-de-route-technique-implementation.md), 13, 149, 913                                              | Runtime annoncé désactivé ; exigence UX à quatre destinations ; ordre immédiat renvoyant au document 14 classé historique                                                   | Faire renvoyer les instructions de reprise vers 00/27/32 ; isoler les anciennes exigences                    |
| P2       | [09](../09-decision-finale-pwa-mvp.md), 92 ; [10](../10-feuille-de-route-technique-implementation.md), critères MVP | Calendar figure encore dans la promesse et les critères de fin, alors que la décision de reprise impose discussion avant réalisation                                        | Décider/documenter la cutline actuelle ; ne pas interpréter ces passages comme autorisation d'implémentation |
| P2       | [32](../32-fondation-reconstruction-chat.md), 43, 51, 59, 468                                                       | Le début annonce encore `audit_error` après retry, BM25 actif faute de preuve et migration 42 ; plus loin persistent les instructions d'envoi 410, avant la section unifiée | Une section d'état actuel unique, suivie d'annexes historiques clairement datées                             |
| P2       | [32](../32-fondation-reconstruction-chat.md), 522                                                                   | Dit remplacer le comportement « unité omise → unsupported », alors que le code et la section décrivent toujours cette normalisation                                         | Corriger la phrase de remplacement                                                                           |
| P3       | [Guide complet](../guides/guide-complet-fonctionnel-et-technique-friday.md), 929–931                                | Trois liens vers fichiers supprimés : `assistant-engine.ts`, ancien `tavily-search.ts`, `exa-mcp-search.ts`                                                                 | Références historiques sans lien mort, ou liens vers les modules actuels avec explication                    |

Le document 10 se présente explicitement comme cumulatif : ses anciens lots datés ne sont pas tous des anomalies. Le problème concerne surtout les formulations actuelles et impératives encore contradictoires. De même, les anciennes mesures dans les addenda du document 27 sont des preuves historiques, pas des chiffres à remplacer systématiquement.

Le noyau Assistant Core compte désormais 19 tests contre 18 dans l'état canonique ; les autres compteurs récents du document 27 correspondent au contrôle effectué. Ce petit décalage illustre le coût de recopier les nombres de tests.

## Code mort, compatibilité et dette

### Exports sans appelant trouvé

La recherche des symboles dans le dépôt trouve uniquement leur définition pour les éléments suivants :

| Élément                         | Emplacement                                   | Évaluation                                                                                          |
| ------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CHAT_RUNTIME_VERSIONS`         | moteur Chat, ligne 1683                       | Métadonnées déclarées mais non utilisées pour tracer les runs                                       |
| `routeAndPlanQuestion`          | Assistant Core `routing.ts`, ligne 119        | Chemin alternatif sans appelant, alors que le Hub possède `routeAndPlan`                            |
| `retrievalQueriesForPlan`       | Assistant Core `axes.ts`, ligne 131           | Helper sans appelant ; à distinguer de `searchQueriesForPlan`, utilisé                              |
| `aspectCoverage`                | banc `metrics.ts`, ligne 85                   | Fonction exportée sans appelant trouvé                                                              |
| `suggestWatchSources`           | PWA `sync/watch-client.ts`, ligne 127         | Client sans usage détecté dans la PWA                                                               |
| `BUDGET_SEED_MAPPING`           | Hub `budget/budget-seed-mapping.ts`, ligne 6  | Mapping sans consommateur trouvé                                                                    |
| `stopRobotAutonomy`, `armRobot` | PWA `sync/robot-client.ts`, lignes 241 et 312 | Anciens clients sans appelant trouvé ; vérifier les engagements de compatibilité avant retrait      |
| `MobileNetSsdVisionEngine`      | Hub `robot/robot-vision.ts`, ligne 420        | Implémentation alternative sans instanciation trouvée ; analyse de retrait Robot à faire séparément |

Les exports inutilisés échappent à la simple protection `noUnusedLocals` : leur export les rend potentiellement publics. Les réexports génériques du cœur ne constituent pas un consommateur fonctionnel.

### Ce qui n'est pas du code mort à supprimer

- `AssistantArchiveService`, l'interface d'archive et son rendu de sources sont encore utilisés.
- Les tables/migrations `assistant_*` et anciens stores Dexie conservent l'historique et la compatibilité des bases existantes. Ne pas réécrire les migrations déjà appliquées.
- Le pipeline `axes` est un rollback documenté. Son coût de maintenance est réel, mais son existence est intentionnelle.
- `answerLegacy` reste accessible : si `unified` n'est pas configuré et que le flag axes est faux, le moteur le choisit. C'est un troisième chemin effectif, malgré la présentation simplifiée « unified ou axes ». Une valeur de configuration inconnue retombe aussi silencieusement sur ce mécanisme.

### Dette structurante

- **Orchestration dupliquée** : moteur Hub de 1 688 lignes avec trois chemins ; exécuteur du banc de 529 lignes. Les différences de replis et de publication sont déjà observables. Unifier l'exécuteur apporte davantage que renommer des fichiers.
- **Gros modules** : `App.tsx` 2 849 lignes, `app.ts` 2 041, contrats 2 100, base/migrations 1 995, `AssistantView.tsx` 936. Ce sont des points de maintenance ; leur taille seule ne prouve pas un bug. Le découpage par domaine doit être progressif.
- **Diagnostic insuffisant des runs** : les compteurs et codes existent, mais les nouvelles tables ne tracent pas le pipeline, la version de prompts et les modèles effectifs. `CHAT_RUNTIME_VERSIONS` reste inutilisé. On peut conserver ces métadonnées non sensibles sans enregistrer les prompts ni les passages privés.
- **Durée totale non bornée** : 240 secondes est le timeout d'un appel Ollama, pas celui du run. Plusieurs générations, embeddings et lectures peuvent s'additionner ; un run long bloque la file globale Chat. La cible p95 de 240 secondes est une gate qualitative non prouvée, pas une garantie runtime.
- **Récupération encore fragile** : la pertinence d'une page passe avec un seul terme commun et le moteur conserve les huit premières pages lisibles avant la sélection hybride. Les autres pages pourtant lues ne participent plus au classement. C'est un risque de rappel et de pertinence, pas une mesure de qualité réalisée aujourd'hui.
- **Statut `verified` imparfaitement lié à l'utilité** : il dépend notamment de l'absence totale de pistes illisibles et d'une détection de types par sous-chaînes. Une piste secondaire suffit à dégrader une bonne réponse ; la simple mention d'un type ne prouve pas que la demande est satisfaite. Une évaluation sémantique de l'utilité reste nécessaire au banc.
- **PWA** : chunk principal mesuré à 548,04 kB minifié, 158,29 kB gzip ; avertissement de build au-dessus de 500 kB. Le rendu Markdown est déjà séparé en chunk. Workbox émet aussi la dépréciation `inlineDynamicImports`. Aucun ralentissement A17 n'est déduit de ces seuls chiffres.
- **Sauvegarde/restauration** : le runbook annonce honnêtement une procédure cible et une interface non implantées. Les snapshots SQLite historiques ne remplacent pas une sauvegarde chiffrée restaurée de bout en bout. C'est une dette d'exploitation importante, distincte du Chat et déjà identifiée par le plan 31.

## Ordre de traitement recommandé

1. Verrouiller les rejets factuels lors des replis et couvrir les pannes d'audit/révision.
2. Fiabiliser le cache : chiffrement avant transaction, réconciliation des suppressions, états d'erreur explicites.
3. Corriger contexte et envois concurrents/incertains ; tester les relances avec budget de révision.
4. Rendre le banc capable d'exécuter exactement `unified`, puis mesurer la gate avant de déclarer le Chat fiable.
5. Actualiser AGENTS/00/27/32 et les encadrés actifs de 09/10 ; réparer les trois liens cassés.
6. Rendre le budget Tavily effectif, borner la durée globale et tracer les versions non sensibles des runs.
7. Nettoyer les exports sans appelant, décider explicitement du devenir de `legacy`, puis découper les gros modules par étapes.

Les corrections proposées ne sont pas appliquées dans cet audit. La réussite de la suite actuelle constitue une bonne base de non-régression ; elle ne réfute pas les défauts reproduits ci-dessus.

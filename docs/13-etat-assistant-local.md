# État du Chat local multi-modèle et recherche Tavily + Exa

Date du checkpoint : 18 août 2026

Statut : **implémentation Tavily + Exa automatisée, clé Tavily validée ; recette physique complète à fournir**

Le détail des décisions, incidents corrigés, retraits et preuves est consolidé dans [15-checkpoint-chat-tavily.md](15-checkpoint-chat-tavily.md).

## Périmètre

`Chat` reste privé par profil, avec historique canonique SQLite, cache et outbox chiffrés dans Dexie, file persistante, annulation/reprise et aucune mutation directe des données métier.

Chaque conversation conserve un des trois modes :

- `Local` : aucune connexion Internet ;
- `Web léger` : au moins une et au plus 2 recherches Tavily `basic`, soit 2 crédits ;
- `Web approfondi` : Tavily et Exa MCP anonyme démarrent en parallèle, avec au plus 6 appels Tavily et 2 appels Exa adaptatifs.

Un mode Web impose désormais une recherche. Le modèle sélectionné construit les requêtes mais ne peut pas rétrograder une demande explicitement Web en réponse locale.

Le modèle par défaut est `Qwen 3.5 9B Q4`. Le menu `Réglages` permet de le remplacer par `Gemma 4 12B` pour les nouveaux messages de l’appareil. Le choix est enregistré dans chaque message et run : une pause, une reprise, un retry ou une demande offline conserve donc le modèle initial. Le hub n’accepte que ces deux identifiants ; le navigateur ne peut pas demander un modèle Ollama arbitraire.

## Orchestrateur

Le pipeline est : historique de conversation → plan de requêtes ciblées → Tavily et Exa → déduplication/couverture → synthèse du modèle choisi avec références `[S1]` → seconde passe de vérification factuelle avec le même modèle → réponse, sources et diagnostics.

Le plan Ollama est contraint par un schéma JSON. Si le modèle produit malgré tout une sortie invalide, Friday construit une requête de secours à partir des deux derniers messages utilisateur au lieu de mettre le run en échec.

Les requêtes, tentatives, extraits de sources, crédits et checkpoints sont persistés. Après redémarrage, les recherches déjà terminées ne sont pas refaites. Une panne ou un quota atteint est détaillé par fournisseur ; sans aucune preuve, Friday rend une réponse déterministe de diagnostic plutôt qu'une réponse factuelle locale.

Pendant une génération, le Chat présente un journal opérationnel ouvert : analyse et décision Web, plan de recherches, requête nettoyée et profondeur de chaque appel, nombre de nouvelles sources, rapprochement des sources, synthèse, usage éventuel du thinking et vérification. À la fin, ce journal se replie sous la réponse dans `Détails du traitement` et reste déroulable. Il est rattaché au message puis conservé dans le cache chiffré pour rester consultable hors ligne. Il ne contient ni chaîne de pensée ni brouillon interne du modèle.

Les durées du journal et de la réponse additionnent uniquement le traitement effectif. La file d’attente, l’attente d’un consentement et l’intervalle entre `Mettre en pause` et `Reprendre` sont exclus. Si le mode n’a pas changé, une reprise conserve les recherches Tavily déjà checkpointées. Si l’utilisateur choisit entre-temps `Local`, `Web léger` ou `Web approfondi`, le run adopte ce nouveau mode et écarte le plan, les sources et tentatives propres à l’ancien pipeline avant de recommencer ; les événements et le temps de travail antérieurs restent visibles, et les crédits Tavily déjà dépensés restent dans le compteur mensuel. Le timeout Ollama s’applique séparément à chaque appel au modèle après sa prise en charge ; il ne démarre pas à l’envoi du message.

Les seuils mensuels sont 750 crédits (alerte), 850 (blocage du mode approfondi) et 950 (arrêt Web strict). Le compteur est stocké dans SQLite par mois. La clé `FRIDAY_TAVILY_API_KEY` reste exclusivement dans le processus hub.

Un indicateur compact dans l’en-tête du Chat affiche l’équivalent en recherches légères restantes. Il retient l’usage le plus élevé entre le compteur de compte renvoyé par `GET https://api.tavily.com/usage` et le journal SQLite commun aux deux profils. Cela couvre les délais de mise à jour observés avec une clé de développement. La réponse distante est mise en cache cinq minutes pour respecter sa limite de 10 appels par 10 minutes. La réserve Friday borne l’affichage à 950 unités même si le forfait gratuit en fournit 1 000. Une recherche `advanced` consomme deux unités.

Les adresses e-mail, numéros de téléphone et adresses postales détectés sont retirés des requêtes. Le Chat demande un consentement explicite avant l’envoi de la version nettoyée.

## Thinking et contexte

Qwen reste en `think: false`, mais l’orchestrateur ajoute automatiquement une délibération interne bornée à 256 tokens lorsqu’une demande locale est longue ou appelle explicitement une analyse, comparaison, stratégie, architecture ou diagnostic. Plan et réponse partagent le même contexte de 32768 tokens pour éviter un rechargement Ollama entre les deux passes. Ce plan compact n’est ni affiché ni persisté et ajoute typiquement 5 à 8 secondes de génération à 34 TPS. Les modes Web ne doublent pas cette passe : la décision, le plan de recherche et la vérification existants constituent déjà leur délibération.

Gemma active son thinking natif automatiquement pour les demandes locales complexes, `Web approfondi`, `Web léger` lorsqu’il existe des sources, puis pour la vérification Web. Les titres et plans JSON restent sans thinking. La case de forçage par message a été retirée : les anciens clients peuvent encore envoyer la valeur historique `forced`, mais le hub la normalise en `auto` et l’ignore lors de l’exécution.

Le raisonnement brut n’est jamais affiché, enregistré en base ou réinjecté dans l’historique. Seuls la réponse finale et les jalons opérationnels du traitement sont conservés. Les deux modèles utilisent désormais un contexte adapté à l’étape : 8192 tokens pour un titre, 16384 pour la décision et le plan Web, 32768 pour la réponse et la vérification. Une réponse ordinaire est plafonnée à 2048 tokens et une réponse approfondie ou réfléchie à 4096. L’historique est compacté à 80000 caractères en local et 24000 avec sources ; le dossier Web conserve tous ses identifiants `[S…]` mais borne l’ensemble des extraits à 60000 caractères.

## Compatibilité

La migration SQLite 14 ajoute les modes, métadonnées de réflexion, journal de recherches et compteur de crédits. La migration 15 ajoute le modèle aux messages et runs, avec `gemma4` comme valeur de reprise. Les anciens marqueurs `classic`, `web`, `fast` et `deep` restent lisibles. Les anciennes conversations et copies Dexie sans nouveaux champs prennent les défauts `Local` et `Gemma 4`; une ancienne demande hors ligne `classic` est convertie en `local` lors de sa relecture.

## Validation restante

- vérifier les trois modes avec de vraies réponses Qwen/Tavily puis le remplacement Gemma ;
- effectuer la recette A17, puis iPhone quand disponible ;
- ne pas déclarer la qualité, la latence ou la compatibilité mobile avant ces essais.

## Preuves automatisées et déploiement

Le benchmark local du 12 août compare Qwen 3.5 4B, Qwen 3.5 9B, Granite 4 3B et Gemma 4 sur décision Web et synthèse sourcée. Le premier jeu donne 96,7/100 au 4B, 88,8 au Granite, 87,5 au 9B et 80,2 à Gemma. Un duel plus difficile entre les deux Qwen donne la même qualité mesurée (95/100 en routage, 83/100 en synthèse), mais le 9B comprend mieux une négation conversationnelle délicate. Le 9B atteint 34,3 TPS à 32K et reste entièrement sur le GPU ; il est retenu comme compromis prudent de qualité. Le 4B atteint 51,7 TPS et reste installé uniquement comme candidat de benchmark, hors runtime Friday.

Le benchmark thinking du même jour montre environ 34,3 TPS à 8K comme à 32K : le contexte n’explique pas le surcoût. Avec un plafond de 1024 tokens, `true`, `low`, `medium` et `high` consomment tous le budget en raisonnement Qwen sans réponse finale. La délibération bornée de remplacement produit réellement un plan de 154 à 202 tokens en 5 à 6 secondes de génération à chaud, puis une réponse finale ; partager 32K entre les deux passes évite un second rechargement Ollama.

Le 18 août 2026, `pnpm verify` réussit avec 192 tests unitaires/intégration, les builds PWA/hub et 23 scénarios Chrome mobile. Les tests couvrent notamment le défaut Qwen et le remplacement Gemma persistant, les contextes par étape, la délibération Qwen bornée, le thinking Gemma automatique, la normalisation des anciennes demandes `forced`, la reprise dans un nouveau mode sélectionné, le bornage d’un dossier Web profond à 30 sources, l’historique complet par conversation, la liste fermée des modèles, le repli d’un plan JSON invalide, les budgets Web, Tavily et Exa MCP, les sources persistées, la vérification, les diagnostics fournisseurs, la confidentialité de la clé Tavily, son compteur de compte, ainsi que l’exclusion de la file et des pauses du temps de traitement.

Une sauvegarde de retour arrière `friday-pre-tavily-migration14-20260811-133136` est conservée sous `D:\FridayData\backups`. La migration 14 est appliquée à la base réelle et le hub reconstruit répond sur `https://192.168.1.14:8443`. La clé Tavily est enregistrée dans la variable utilisateur Windows et un appel `basic` réel a authentifié la clé puis retourné un résultat. Sa valeur n’est jamais consignée dans le dépôt ou les journaux Friday.

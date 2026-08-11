# État du Chat Gemma 4 et recherche Tavily

Date du checkpoint : 11 août 2026

Statut : **implémentation automatisée et clé Tavily validées ; recette physique à fournir**

Le détail des décisions, incidents corrigés, retraits et preuves est consolidé dans [15-checkpoint-chat-tavily.md](15-checkpoint-chat-tavily.md).

## Périmètre

`Chat` reste privé par profil, avec historique canonique SQLite, cache et outbox chiffrés dans Dexie, file persistante, annulation/reprise et aucune mutation directe des données métier.

Chaque conversation conserve un des trois modes :

- `Local` : aucune connexion Internet ;
- `Web léger` : décision locale puis au plus 2 recherches Tavily `basic`, soit 2 crédits ;
- `Web approfondi` : au plus 6 recherches en trois phases (`explore`, `gap`, `adversarial`) et 8 crédits ; seules les deux dernières peuvent être `advanced`.

Un mode Web autorise un budget, mais Gemma commence par décider si le message nécessite réellement une information externe ou récente. Une conversation, une reformulation ou une création peut donc rester entièrement locale.

## Orchestrateur

Le pipeline est : historique de conversation → décision locale/Web → plan de requêtes ciblées → recherches Tavily → synthèse Gemma avec références `[S1]` → seconde passe de vérification factuelle → réponse et sources.

Le plan Ollama est contraint par un schéma JSON. Si le modèle produit malgré tout une sortie invalide, Friday construit une requête de secours à partir des deux derniers messages utilisateur au lieu de mettre le run en échec.

Les requêtes, tentatives, extraits de sources, crédits et checkpoints sont persistés. Après redémarrage, les recherches déjà terminées ne sont pas refaites. Une panne ou un quota atteint produit une réponse locale explicitement signalée comme à vérifier.

Pendant une génération, le Chat présente un journal opérationnel ouvert : analyse et décision Web, plan de recherches, requête nettoyée et profondeur de chaque appel, nombre de nouvelles sources, rapprochement des sources, synthèse, usage éventuel du thinking et vérification. À la fin, ce journal se replie sous la réponse dans `Détails du traitement` et reste déroulable. Il est rattaché au message puis conservé dans le cache chiffré pour rester consultable hors ligne. Il ne contient ni chaîne de pensée ni brouillon interne du modèle.

Les durées du journal et de la réponse additionnent uniquement le traitement effectif. La file d’attente, l’attente d’un consentement et l’intervalle entre `Mettre en pause` et `Reprendre` sont exclus. Une reprise conserve les recherches Tavily déjà checkpointées et cumule seulement le travail réellement exécuté avant et après la pause. Le timeout Ollama s’applique séparément à chaque appel au modèle après sa prise en charge ; il ne démarre pas à l’envoi du message.

Les seuils mensuels sont 750 crédits (alerte), 850 (blocage du mode approfondi) et 950 (arrêt Web strict). Le compteur est stocké dans SQLite par mois. La clé `FRIDAY_TAVILY_API_KEY` reste exclusivement dans le processus hub.

Un indicateur compact dans l’en-tête du Chat affiche l’équivalent en recherches légères restantes. Il retient l’usage le plus élevé entre le compteur de compte renvoyé par `GET https://api.tavily.com/usage` et le journal SQLite commun aux deux profils. Cela couvre les délais de mise à jour observés avec une clé de développement. La réponse distante est mise en cache cinq minutes pour respecter sa limite de 10 appels par 10 minutes. La réserve Friday borne l’affichage à 950 unités même si le forfait gratuit en fournit 1 000. Une recherche `advanced` consomme deux unités.

Les adresses e-mail, numéros de téléphone et adresses postales détectés sont retirés des requêtes. Le Chat demande un consentement explicite avant l’envoi de la version nettoyée.

## Thinking Gemma

Le raisonnement est activé automatiquement pour les demandes locales complexes, la recherche approfondie et les passes de synthèse/vérification Web. L’utilisateur peut aussi cocher `Forcer la réflexion pour ce message`. Cette option est à usage unique et revient à l’état désactivé dès que le message est accepté ou placé dans l’outbox.

Le raisonnement brut n’est jamais affiché, enregistré en base ou réinjecté dans l’historique. Seuls la réponse finale et les jalons opérationnels du traitement sont conservés. Ollama garde un contexte maximal de 131072 tokens ; l’historique est transmis à chaque tour dans cette limite.

## Compatibilité

La migration SQLite 14 ajoute les modes, métadonnées de réflexion, journal de recherches et compteur de crédits. Les anciens marqueurs `classic`, `web`, `fast` et `deep` restent lisibles. Les anciennes conversations et copies Dexie sans nouveaux champs prennent le défaut `Local`; une ancienne demande hors ligne `classic` est convertie en `local` lors de sa relecture.

## Validation restante

- vérifier les trois modes avec de vraies réponses Gemma/Tavily ;
- effectuer la recette A17, puis iPhone quand disponible ;
- ne pas déclarer la qualité, la latence ou la compatibilité mobile avant ces essais.

## Preuves automatisées et déploiement

Le 11 août 2026, `pnpm verify` réussit avec 150 tests unitaires/intégration, les builds PWA/hub et 22 scénarios Chrome mobile. Les tests couvrent notamment l’historique complet par conversation, le repli d’un plan JSON invalide, les budgets Web, les sources persistées, la vérification, la confidentialité de la clé Tavily, son compteur de compte, le thinking forcé, ainsi que l’exclusion de la file et des pauses du temps de traitement.

Une sauvegarde de retour arrière `friday-pre-tavily-migration14-20260811-133136` est conservée sous `D:\FridayData\backups`. La migration 14 est appliquée à la base réelle et le hub reconstruit répond sur `https://192.168.1.14:8443`. La clé Tavily est enregistrée dans la variable utilisateur Windows et un appel `basic` réel a authentifié la clé puis retourné un résultat. Sa valeur n’est jamais consignée dans le dépôt ou les journaux Friday.

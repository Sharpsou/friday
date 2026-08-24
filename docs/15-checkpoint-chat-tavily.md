# Checkpoint consolidé — Chat Ollama, Tavily et Exa MCP

Date : 22 août 2026

Statut : **candidat automatisé construit, déployé et vérifié ; recette physique A17 à confirmer**

## Décision finale

Le Chat reste privé par profil et n’a aucun droit de mutation directe sur Agenda, Courses ou Budget. Chaque conversation conserve un mode :

- `Local` : modèle Ollama sélectionné, sans appel Internet ni étape de sélection de sources ;
- `Web léger` : 1 à 2 recherches Tavily `basic`, plafond de 2 crédits, puis sélection de 5 sources au maximum sans boucle de recherche supplémentaire ;
- `Web approfondi` : première passe Tavily + Exa MCP anonyme en parallèle, puis recherches ciblées, au plus 6 appels Tavily et 2 appels Exa adaptatifs. Après deux appels Tavily, les appels restants sont évités si la couverture est déjà suffisante.

Le mode Web choisi est désormais impératif : Ollama prépare les requêtes mais ne peut plus annuler la recherche. Une sortie vide ou `searchNeeded:false` déclenche la requête déterministe de secours au lieu de rétrograder le run en local.

Deux modèles sont autorisés pour le Chat : `qwen3.5:9b-q4_K_M` par défaut et `gemma4:e4b-it-qat`, qui le remplace depuis la roue dentée pour les nouveaux messages. Ce réglage ne change ni Ministral 3 8B pour le classement Courses ni Qwen 3.5 9B pour l’import photo. Le contexte est dimensionné par étape : titre 8K, décision/plan Web/audit factuel 16K, délibération locale et réponse 32K. Le modèle de rédaction est persisté avec le run et reste identique après pause/reprise/retry ; l’audit Web ciblé utilise toujours Qwen sans thinking. Qwen utilise automatiquement un plan interne non-thinking de 256 tokens au plus pour les demandes locales complexes. Gemma choisit automatiquement son thinking natif selon la complexité et le mode, sans refaire une seconde délibération pendant l’audit. La case de forçage par message est supprimée et le raisonnement brut n’est jamais persisté ni affiché.

## Pipeline implanté

Le traitement est : historique → plan JSON contraint → nettoyage des requêtes → Tavily/Exa → classement déterministe relatif à la question → mesure de couverture → synthèse locale → vérification factuelle locale tenant compte de la question et, seulement pour une demande temporelle, de la date civile courante → réponse sourcée. Le classement combine pertinence, score fournisseur, densité, diversité de domaines et autorité adaptée à une demande officielle, académique, technique, locale, pratique ou explicative. La fraîcheur n’est valorisée que lorsque la question l’exige. Le dossier retient au plus 5 sources en léger et 8 en approfondi, avec deux sources au maximum par domaine. La couverture est complète à partir de trois sources pertinentes et deux domaines en léger, ou six sources et trois domaines en approfondi, avec 75 % des aspects planifiés couverts. Les pages vidéo sans transcription substantielle et origine déclarée identifiable sont écartées ; une transcription admise reste une source secondaire qui ne peut pas valider seule un fait scientifique ou actuel.

- Le plan de recherche Ollama utilise un schéma JSON strict.
- Si sa sortie reste invalide, Friday construit une requête de secours à partir des deux derniers messages utilisateur au lieu de faire échouer le run.
- E-mail, téléphone et adresse postale sont retirés avant Tavily ; une requête nettoyée contenant une donnée détectée exige un consentement explicite.
- Chaque tentative, source, crédit et étape est persisté. Une recherche réussie n’est pas répétée après redémarrage, pause ou reprise.
- Les sources sont numérotées `[S1]`, bornées et traitées comme des données hostiles. Avant publication, Friday découpe le brouillon en segments, sélectionne localement les passages les plus proches de chaque affirmation, puis demande à Qwen un audit JSON limité aux segments partiellement soutenus, contredits ou sans preuve. Le code applique ces corrections par position ; les segments validés ne sont jamais réécrits. Une sortie d’audit invalide conserve le brouillon et retire au minimum les références inexistantes.
- En approfondi, `web_search_exa` utilise directement `https://mcp.exa.ai/mcp`, sans compte, clé, OAuth ou paiement. Le second appel Exa ne part que si la première passe fournit moins de quatre URL ou moins de deux domaines.
- Si aucune source n'est lisible, Friday publie un diagnostic déterministe par fournisseur et ne transmet plus au modèle le prompt local « sans accès Internet ».

## File, pause, reprise et temps

Une seule génération lourde s’exécute à la fois. La file SQLite alterne équitablement les profils et survit au redémarrage.

Pendant le traitement, le Chat affiche un journal opérationnel ouvert : décision Web, plan, requêtes et profondeurs, nouvelles sources, lecture, synthèse, thinking utilisé et vérification. Après la réponse, `Détails du traitement` se replie et reste consultable, y compris depuis le cache chiffré.

`Mettre en pause` interrompt l’appel Ollama sans publier de brouillon. `Reprendre` relance le même run et conserve ses checkpoints tant que le mode n’a pas changé. Si l’utilisateur sélectionne un autre mode pendant la pause, la reprise adopte ce choix, écarte les checkpoints propres à l’ancien pipeline et journalise explicitement le changement. Les crédits Tavily déjà dépensés restent comptés mensuellement. Le temps affiché additionne seulement les statuts actifs (`preparing`, `searching`, `reading`, `writing`, `verifying`) : file, consentement et intervalle de pause sont exclus. Une reprise cumule le travail effectif avant et après la pause sans repartir de l’heure du message.

`FRIDAY_ASSISTANT_TIMEOUT_MS` s’applique à chaque appel Ollama à partir de son lancement, pas à partir de l’envoi du message. Le diagnostic du 11 août a confirmé qu’un run avait attendu environ 12 min 32 s en file, puis que sa synthèse avait expiré exactement après 12 minutes ; seul l’affichage mélangeait auparavant ces deux durées.

## Tavily et quota commun

La clé `FRIDAY_TAVILY_API_KEY` reste dans l’environnement du hub. Sans clé, `Local` fonctionne normalement et un mode Web revient sur une réponse locale explicitement signalée.

Les seuils Friday sont 750 crédits pour l’alerte, 850 pour bloquer le mode approfondi et 950 pour arrêter le Web. Le compteur discret du Chat est commun aux deux profils. Il retient la valeur d’usage la plus haute entre le journal SQLite et `GET https://api.tavily.com/usage`, dont la réponse est mise en cache cinq minutes pour rester sous sa limite de fréquence. Cela compense le retard observé du compteur Tavily avec la clé de développement. Une recherche `advanced` compte deux crédits.

## Exa MCP anonyme

Friday compte localement chaque appel MCP réellement émis, ainsi que les succès, résultats vides, limitations et échecs. Exa ne publie pas de solde anonyme : l'interface affiche donc « N appels ce mois » et l'état observé, jamais un faux quota restant. Un `429` applique `Retry-After` ou une heure de pause ; un timeout ou `5xx` applique deux minutes. Exa et Tavily se dégradent indépendamment.

La migration SQLite 19 ajoute le fournisseur et le diagnostic aux tentatives/sources, le compteur mensuel Exa et sa santé. Les diagnostics restent privés par conversation ; seul le compteur agrégé est partagé entre les profils.

## Incidents corrigés

1. **Plan de recherche invalide** : la sortie libre de Gemma pouvait casser une relance. Le format JSON est maintenant contraint et un plan de secours maintient le contexte des deux derniers messages utilisateur.
2. **Historique perçu comme absent** : le service transmettait bien toute la conversation ; l’échec se situait dans le plan du tour suivant. Un test couvre désormais explicitement l’historique complet.
3. **Compteur Tavily immobile** : l’endpoint distant pouvait rester à zéro après des appels réels. Le compteur affiché prend désormais le maximum entre Tavily et le journal local partagé.
4. **Réponse très lente** : les mesures ont séparé recherche, synthèse et vérification. Les appels Gemma restent les étapes longues ; Tavily répond en quelques secondes.
5. **Progression trop opaque** : le journal persistant expose maintenant les opérations utiles sans révéler la chaîne de pensée.
6. **Temps gonflé par la file et les pauses** : les durées sont recalculées depuis les événements actifs, et les actions `Mettre en pause` / `Reprendre` sont de nouveau visibles.
7. **Scénario E2E Assistant instable** : le test hors ligne attend maintenant la vraie création de conversation et le champ de saisie avant de couper le réseau.

## Retraits et compatibilité

L’ancien `web-researcher.ts`, Cheerio, la recherche Playwright côté hub, le cache FTS5 de pages, le modèle Assistant rapide et les variables `FRIDAY_ASSISTANT_FAST_MODEL`, `FRIDAY_ASSISTANT_GOOGLE_ENABLED` restent retirés. Les seules voies Web du Chat sont Tavily et le MCP Exa anonyme.

Les anciens marqueurs `classic`, `web`, `fast` et `deep`, ainsi que certaines colonnes historiques, restent volontairement lisibles pour migrer les conversations et caches existants. Ils ne constituent pas un second orchestrateur actif.

La migration SQLite 14 ajoute les modes de conversation, le thinking, les résultats de recherche, les tentatives Tavily et le compteur mensuel. La migration 15 ajoute le modèle sélectionné aux messages et runs, avec reprise des données existantes sur Gemma. La sauvegarde de retour arrière `friday-pre-tavily-migration14-20260811-133136` reste hors dépôt sous `D:\FridayData\backups`.

## Sécurité et confidentialité

- conversations, messages et outbox restent séparés par profil ;
- cache et outbox PWA restent chiffrés dans IndexedDB ;
- clé Tavily absente du bundle, de Git et des réponses API ;
- contenu distant non fiable, sans exécution d’instructions ;
- raisonnement brut Gemma non conservé ;
- aucun droit Chat de modifier directement les données métier.

## Preuves et limites

`pnpm verify` réussit sur le candidat du 23 août 2026 avec 209 tests unitaires/intégration, les builds PWA/hub et 24 scénarios Chrome mobile. La vérification V2 est couverte par les cas James Webb, la préservation des segments soutenus, le repli après JSON invalide, la sélection d’un passage éloigné, le contenu hostile, le rejet de citations inventées, le contexte temporel conditionnel, le filtrage strict des vidéos et le classement relatif à la question avec diversité et arrêt de la recherche approfondie sur couverture suffisante. Le runtime doit ensuite être reconstruit et contrôlé sur `https://192.168.1.14:8443`.

Restent à confirmer physiquement sur l’A17 : installation de la dernière PWA, lisibilité du journal, pause/reprise, temps effectif, les trois modes et la qualité/latence de réponses Gemma/Tavily réelles. Ces points ne sont pas déclarés validés par les tests automatisés.

## Références

- état produit : [13-etat-assistant-local.md](13-etat-assistant-local.md) ;
- exploitation : [runbooks/assistant-gemma.md](runbooks/assistant-gemma.md) ;
- menaces : [friday-threat-model.md](friday-threat-model.md) ;
- prochaines recettes : [14-prochaines-etapes-apres-assistant.md](14-prochaines-etapes-apres-assistant.md).

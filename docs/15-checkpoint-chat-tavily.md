# Checkpoint consolidé — Chat Gemma 4 et Tavily

Date : 11 août 2026

Statut : **candidat automatisé construit, déployé et vérifié ; recette physique A17 à confirmer**

## Décision finale

Le Chat reste privé par profil et n’a aucun droit de mutation directe sur Agenda, Courses ou Budget. Chaque conversation conserve un mode :

- `Local` : Gemma 4 via Ollama, sans appel Internet ;
- `Web léger` : décision locale puis 0 à 2 recherches Tavily `basic`, plafond de 2 crédits ;
- `Web approfondi` : décision locale puis 0 à 6 recherches en phases `explore`, `gap` et `adversarial`, plafond de 8 crédits ; seuls les appels 5 et 6 peuvent être `advanced`.

Le modèle unique est `gemma4-12b-multimodal:128k`, avec un contexte maximal de 131072 tokens. L’historique complet de la conversation est transmis à chaque tour dans cette limite. Le thinking est choisi automatiquement et peut être forcé pour un message ; son contenu brut n’est jamais persisté ni affiché.

## Pipeline implanté

Le traitement est : historique → décision locale/Web → plan JSON contraint → nettoyage des requêtes → recherches Tavily → rapprochement des sources → synthèse Gemma → vérification factuelle Gemma → réponse sourcée.

- Le plan de recherche Ollama utilise un schéma JSON strict.
- Si sa sortie reste invalide, Friday construit une requête de secours à partir des deux derniers messages utilisateur au lieu de faire échouer le run.
- E-mail, téléphone et adresse postale sont retirés avant Tavily ; une requête nettoyée contenant une donnée détectée exige un consentement explicite.
- Chaque tentative, source, crédit et étape est persisté. Une recherche réussie n’est pas répétée après redémarrage, pause ou reprise.
- Les sources sont numérotées `[S1]`, bornées, traitées comme des données hostiles et vérifiées avant publication.

## File, pause, reprise et temps

Une seule génération lourde s’exécute à la fois. La file SQLite alterne équitablement les profils et survit au redémarrage.

Pendant le traitement, le Chat affiche un journal opérationnel ouvert : décision Web, plan, requêtes et profondeurs, nouvelles sources, lecture, synthèse, thinking utilisé et vérification. Après la réponse, `Détails du traitement` se replie et reste consultable, y compris depuis le cache chiffré.

`Mettre en pause` interrompt l’appel Ollama sans publier de brouillon. `Reprendre` relance le même run en conservant ses checkpoints. Le temps affiché additionne seulement les statuts actifs (`preparing`, `searching`, `reading`, `writing`, `verifying`) : file, consentement et intervalle de pause sont exclus. Une reprise cumule le travail effectif avant et après la pause sans repartir de l’heure du message.

`FRIDAY_ASSISTANT_TIMEOUT_MS` s’applique à chaque appel Ollama à partir de son lancement, pas à partir de l’envoi du message. Le diagnostic du 11 août a confirmé qu’un run avait attendu environ 12 min 32 s en file, puis que sa synthèse avait expiré exactement après 12 minutes ; seul l’affichage mélangeait auparavant ces deux durées.

## Tavily et quota commun

La clé `FRIDAY_TAVILY_API_KEY` reste dans l’environnement du hub. Sans clé, `Local` fonctionne normalement et un mode Web revient sur une réponse locale explicitement signalée.

Les seuils Friday sont 750 crédits pour l’alerte, 850 pour bloquer le mode approfondi et 950 pour arrêter le Web. Le compteur discret du Chat est commun aux deux profils. Il retient la valeur d’usage la plus haute entre le journal SQLite et `GET https://api.tavily.com/usage`, dont la réponse est mise en cache cinq minutes pour rester sous sa limite de fréquence. Cela compense le retard observé du compteur Tavily avec la clé de développement. Une recherche `advanced` compte deux crédits.

## Incidents corrigés

1. **Plan de recherche invalide** : la sortie libre de Gemma pouvait casser une relance. Le format JSON est maintenant contraint et un plan de secours maintient le contexte des deux derniers messages utilisateur.
2. **Historique perçu comme absent** : le service transmettait bien toute la conversation ; l’échec se situait dans le plan du tour suivant. Un test couvre désormais explicitement l’historique complet.
3. **Compteur Tavily immobile** : l’endpoint distant pouvait rester à zéro après des appels réels. Le compteur affiché prend désormais le maximum entre Tavily et le journal local partagé.
4. **Réponse très lente** : les mesures ont séparé recherche, synthèse et vérification. Les appels Gemma restent les étapes longues ; Tavily répond en quelques secondes.
5. **Progression trop opaque** : le journal persistant expose maintenant les opérations utiles sans révéler la chaîne de pensée.
6. **Temps gonflé par la file et les pauses** : les durées sont recalculées depuis les événements actifs, et les actions `Mettre en pause` / `Reprendre` sont de nouveau visibles.
7. **Scénario E2E Assistant instable** : le test hors ligne attend maintenant la vraie création de conversation et le champ de saisie avant de couper le réseau.

## Retraits et compatibilité

L’ancien `web-researcher.ts`, Cheerio, la recherche Playwright côté hub, le cache FTS5 de pages, le modèle Assistant rapide et les variables `FRIDAY_ASSISTANT_FAST_MODEL`, `FRIDAY_ASSISTANT_GOOGLE_ENABLED` sont retirés. Tavily est l’unique voie Web.

Les anciens marqueurs `classic`, `web`, `fast` et `deep`, ainsi que certaines colonnes historiques, restent volontairement lisibles pour migrer les conversations et caches existants. Ils ne constituent pas un second orchestrateur actif.

La migration SQLite 14 ajoute les modes de conversation, le thinking, les résultats de recherche, les tentatives Tavily et le compteur mensuel. La sauvegarde de retour arrière `friday-pre-tavily-migration14-20260811-133136` reste hors dépôt sous `D:\FridayData\backups`.

## Sécurité et confidentialité

- conversations, messages et outbox restent séparés par profil ;
- cache et outbox PWA restent chiffrés dans IndexedDB ;
- clé Tavily absente du bundle, de Git et des réponses API ;
- contenu distant non fiable, sans exécution d’instructions ;
- raisonnement brut Gemma non conservé ;
- aucun droit Chat de modifier directement les données métier.

## Preuves et limites

`pnpm verify` réussit avec 150 tests unitaires/intégration, les builds PWA/hub et 22 scénarios Chrome mobile. Le runtime a été reconstruit et son healthcheck répond sur `https://192.168.1.14:8443`.

Restent à confirmer physiquement sur l’A17 : installation de la dernière PWA, lisibilité du journal, pause/reprise, temps effectif, les trois modes et la qualité/latence de réponses Gemma/Tavily réelles. Ces points ne sont pas déclarés validés par les tests automatisés.

## Références

- état produit : [13-etat-assistant-local.md](13-etat-assistant-local.md) ;
- exploitation : [runbooks/assistant-gemma.md](runbooks/assistant-gemma.md) ;
- menaces : [friday-threat-model.md](friday-threat-model.md) ;
- prochaines recettes : [14-prochaines-etapes-apres-assistant.md](14-prochaines-etapes-apres-assistant.md).

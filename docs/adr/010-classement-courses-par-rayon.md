# ADR-010 — Classement facultatif des courses par rayon

Date : 9 août 2026

Statut : accepté, candidat automatisé à recetter sur appareil réel

## Contexte

Les libellés d'une liste de courses sont courts, ambigus et propres au foyer. Friday doit pouvoir les regrouper dans un ordre utile en magasin sans rendre Ollama nécessaire à la consultation, à la saisie ou à la synchronisation. Le classement peut prendre plusieurs secondes : l'utilisateur doit donc continuer à utiliser la PWA, pouvoir l'arrêter et confirmer le résultat avant toute modification de la liste.

Deux profils peuvent alimenter et classer la même liste. Le résultat doit rester commun au foyer, converger sur les appareils et être disponible hors ligne après synchronisation.

## Options considérées

- une liste de mots-clés uniquement, rapide mais insuffisante pour les libellés personnels inconnus ;
- un appel Ollama pour chaque produit, plus souple mais lent et inutilement dépendant du modèle ;
- une classification automatique appliquée sans confirmation, trop opaque et risquée ;
- un pipeline hybride proposant un résultat corrigeable avant application.

## Décision

Friday utilise un pipeline hybride, ordonné et explicable :

1. une correction exacte déjà validée par le foyer ;
2. le glossaire déterministe des produits courants ;
3. Ministral 3 8B via Ollama pour les seuls libellés non résolus ;
4. `Autre > À classer` si la confiance du modèle est inférieure à `0,65` ou si aucune catégorie sûre n'est obtenue.

La taxonomie versionnée `retail-fr-v1` est définie dans les contrats partagés et documentée dans [la référence de taxonomie](../reference/taxonomie-courses-retail-fr-v1.md). Elle contient 11 familles de magasins, dont 25 rayons de supermarché. Les identifiants techniques sont stables dans une version donnée.

### Cycle du job

- `POST /api/groceries/classification-proposals` crée ou retrouve le job actif du foyer ;
- le hub enregistre le job dans SQLite avant de le traiter par lots de 30 ;
- les états persistants sont `queued`, `running`, `cancelling`, `completed`, `failed` et `cancelled` ;
- l'indicateur global de la PWA affiche l'avancement dans tous les onglets ; la navigation et les mutations ordinaires restent disponibles ;
- `Arrêter` demande l'annulation, interrompt l'appel Ollama en cours et ne conserve aucun résultat partiel ;
- après redémarrage du hub, un job `running` repasse en file d'attente et un job `cancelling` devient `cancelled` ;
- une proposition terminée expire après 24 heures.

Le snapshot du job est incrémental : il contient seulement les articles non achetés qui ne possèdent encore ni classification partagée, ni rayon choisi directement dans le mode `Modifier`. Une relance après ajout d'un produit ne repropose donc que ce nouveau produit et conserve tous les rayons existants. Pour chaque article retenu, le snapshot porte l'identifiant, la révision et l'empreinte du libellé. L'application saute tout article supprimé, acheté, renommé ou révisé depuis ce snapshot. Elle vérifie également la révision de sa classification précédente.

### Contrats HTTP

Toutes les routes exigent une session active du foyer. Les mutations exigent aussi une origine navigateur approuvée.

| Méthode et route                                             | Effet                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `POST /api/groceries/classification-proposals`               | crée un job ou renvoie le job actif du foyer                           |
| `GET /api/groceries/classification-proposals/:jobId`         | lit état, progression, erreur ou proposition                           |
| `POST /api/groceries/classification-proposals/:jobId/cancel` | demande l'arrêt idempotent du job                                      |
| `POST /api/groceries/classifications/apply`                  | confirme jusqu'à 500 choix et renvoie les articles appliqués ou sautés |
| `GET /api/groceries/classifications?after=<curseur>`         | tire les classifications communes depuis un curseur dédié              |

Les corps et réponses sont validés par les schémas Zod du paquet `@friday/contracts`. Une proposition contient notamment la révision de la course, l'empreinte du libellé, la source, la confiance et la révision de classification attendue.

### Confirmation et fusion

Le job ne modifie jamais directement les courses. Il produit un aperçu que l'utilisateur peut corriger puis confirmer avec `POST /api/groceries/classifications/apply`. L'action `Conserver le classement actuel` écarte l'aperçu sans appeler cette route et sans modifier les classifications précédentes. Cette application est transactionnelle et idempotente : une répétition de la même requête renvoie la première réponse enregistrée.

Une correction humaine faite dans l'aperçu reçoit la source `manual`, la confiance `1` et devient une règle exacte partagée pour le foyer. Une proposition automatique ne remplace pas silencieusement une classification manuelle actuelle. Les deux profils écrivent dans la même classification par article ; il n'existe donc pas deux sections concurrentes à fusionner dans l'interface. Le journal de changements dédié distribue la valeur commune aux appareils avec son propre curseur.

Le mode `Modifier` de la liste permet aussi de choisir directement un rayon. Cette surcharge manuelle est portée par l'objet course, passe par le cache chiffré et l'outbox même hors ligne, et reste prioritaire sur toute classification automatique présente. Revenir à `Conserver le classement automatique` retire cette surcharge sans supprimer le résultat du dernier job. Cette correction directe n'alimente pas automatiquement la règle exacte du foyer : l'apprentissage reste lié à la confirmation explicite d'un aperçu.

### Frontière Ollama

Ollama reste lié à `127.0.0.1` et n'est jamais appelé depuis le navigateur. Le moteur est configurable sans téléchargement automatique. Il reçoit uniquement les libellés non résolus et un schéma JSON fermé aux couples famille/rayon autorisés. Chaque entrée et chaque réponse portent le même index ; le hub rejette les index manquants ou dupliqués et remet les résultats dans l'ordre avant application. La température et le mode de raisonnement sont désactivés ; un délai de 120 secondes et une seule nouvelle tentative bornent l'appel. Le modèle n'a ni outil, ni accès Web, ni droit d'écriture.

Les libellés sont traités comme du contenu non fiable, pas comme des instructions. L'authentification du foyer et le contrôle d'origine s'appliquent aux routes de mutation.

### Stockage et mode hors ligne

SQLite conserve les courses et leur éventuelle surcharge manuelle, ainsi que les jobs, classifications, règles apprises et changements. Dexie conserve les courses et classifications synchronisées dans le cache local chiffré, avec un curseur de classification séparé et l'identifiant du job actif. La liste utilise une seule présentation : la surcharge manuelle est appliquée d'abord, puis la classification, et les autres articles restent dans `À classer`. Cette présentation reste consultable et corrigeable hors ligne ; démarrer, arrêter ou confirmer un job de classement exige le hub.

Quand la page est visible, la PWA interroge le job actif toutes les deux secondes. Elle tente également de le retrouver toutes les dix secondes, au retour réseau et au retour au premier plan. Chaque requête expire après cinq secondes afin que l'indicateur ne bloque pas l'interface si le hub disparaît.

La vue suit l'ordre générique de la taxonomie, place les éléments non classés à la fin et replie les produits achetés. Cet ordre n'essaie pas de représenter le plan réel de chaque magasin au MVP.

Le bouton `En course`, placé à côté de `Classer par rayon`, ouvre une vue plein écran dédiée au magasin. Elle réutilise exactement ces groupes et la mutation locale d'achat, mais masque navigation, formulaires, réglages, états techniques et produits déjà achetés. Chaque ligne entière devient une grande cible cochable ; la progression et le nombre restant sont les seuls indicateurs. Ce mode ne lance aucun classement et reste entièrement utilisable hors ligne avec le dernier ordre disponible.

## Conséquences

Le chemin courant est rapide et déterministe pour la majorité des articles, tandis que les libellés personnels restent traitables. Ollama peut être indisponible sans bloquer les courses ; seuls les libellés qui nécessitent le modèle font alors échouer la proposition, que l'utilisateur peut relancer.

Les règles apprises sont volontairement exactes après normalisation. Friday ne généralise pas une correction à des libellés voisins, ce qui limite les effets de bord mais demandera parfois plusieurs corrections proches. Une future taxonomie ou un ordre propre à un magasin devra porter un nouvel identifiant de version et une migration explicite.

## Preuve

- contrats et taxonomie : `packages/contracts/src/index.ts` ;
- migrations et service persistant : `apps/hub/src/db/database.ts` et `apps/hub/src/groceries/` ;
- cache et interface : `apps/web/src/GroceryClassification.tsx`, `apps/web/src/use-grocery-classification.ts` et `apps/web/src/db/grocery-classification-repository.ts` ;
- tests unitaires/intégration : reprise après redémarrage, annulation sans résultat partiel, idempotence, correction apprise, chiffrement du cache et fusion entre profils ;
- tests Chrome mobile : activité en arrière-plan, navigation, arrêt, aperçu corrigé et application ;
- après correction du protocole indexé, corpus local de 150 libellés : 99,3 % famille/rayon avec le pipeline hybride et 96,7 % de couverture déterministe ; corpus difficile de neuf libellés : 88,9 % pour Ministral 3 8B en 10,4 s à chaud le 9 août 2026 ;
- recette physique : [Galaxy A17 — classement des courses](../recipes/galaxy-a17-lot-1a-grocery-classification.md), encore à confirmer.

Les premiers essais sans index ont révélé des catégories décalées entre articles et ne mesuraient donc pas seulement la qualité des modèles. Sur les neuf cas difficiles rejoués avec des index, Granite obtient 55,6 %, Ornith 77,8 %, Ministral 77,8 % et Gemma 4 12B 77,8 %. Sur le corpus générique anonymisé équivalent, Ministral atteint 88,9 %, contre 77,8 % pour Gemma. Gemma prend 36 s à chaud et 18,3 s sur les petits lots, contre 10,4 s et 6,1 s pour Ministral. Ces mesures justifient Ministral comme repli actuel, sans faire du LLM le chemin principal.

## Retour arrière

Le bouton de classement peut être masqué sans toucher au modèle de course ni à sa synchronisation. Les tables de migration restent en place, mais le cache de classification et les vues par rayon peuvent être ignorés. Le glossaire ou le moteur Ollama peuvent être remplacés derrière leur interface sans changer les contrats de job et de confirmation.

## Révision

Après la recette A17, puis après plusieurs listes réelles à deux profils. Réexaminer la taxonomie et l'ordre des rayons seulement à partir des corrections observées, sans entraîner ni élargir automatiquement les règles du foyer.

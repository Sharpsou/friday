# Runbook Chat

Statut documentaire : actif. Révision : 6 septembre 2026.

Le Chat est activé sur le foyer de référence, mais sa gate qualitative reste refusée.
L'[état canonique](../27-etat-canonique-app-robot-2026-08-25.md) porte la livraison ;
la [fondation 32](../32-fondation-reconstruction-chat.md) décrit le harnais actuel.
Les commandes et mesures des [anciens essais](../archives/etats-techniques/assistant-gemma.md)
restent historiques et ne doivent pas être relancées automatiquement.

## Configuration et activation

```text
FRIDAY_CHAT_ENABLED=true
FRIDAY_CHAT_PIPELINE=unified
FRIDAY_CHAT_AXES_ENABLED=true
FRIDAY_OLLAMA_URL=http://127.0.0.1:11434
FRIDAY_TAVILY_API_KEY=<secret hors Git>
```

Gemma `gemma4:e4b-it-qat` rédige ; Qwen `qwen3.5:9b-q4_K_M` audite et participe
à l'orchestration ; `qwen3-embedding:0.6b` assure la sélection éphémère avec repli lexical.
`ollama list` permet de vérifier les modèles installés sans lancer une génération.
Le Chat et les routes de propositions Menus sont tous deux contrôlés par
`FRIDAY_CHAT_ENABLED`. Les opérations Maison manuelles restent indépendantes.

Hors valeur exacte `true`, le plugin Chat est indisponible (503 `chat_disabled`).
Pour rollback axes, conserver `FRIDAY_CHAT_AXES_ENABLED=true` et définir le pipeline
à `axes`. Hors unified, un flag axes faux conduit au chemin legacy. Ce rollback
ne doit pas être présenté comme une qualification des réponses.

Le lanceur Windows relit certains flags depuis l'environnement utilisateur si la
session ne les fournit pas. Définir explicitement les valeurs dans le processus de
lancement voulu ; ne pas modifier les variables persistantes pendant une vérification.
Un changement runtime suit la procédure Windows autorisée ; le lot documentaire
n'active, ne désactive et ne redémarre aucun service.

## Utilisation et diagnostic

Les modes Friday, Local et Recherche Web sont privés au profil. La PWA crée,
renomme et supprime les conversations, envoie en ligne et suit/annule les runs.
Le cache chiffré conserve l'historique consultable offline. Après un envoi incertain,
laisser le client réconcilier le même identifiant ; ne pas recréer un run à l'aveugle.

| Symptôme               | Vérification                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| Chat désactivé         | Flag du processus réellement lancé ; archive Assistant distincte             |
| Génération en attente  | Ordonnanceur commun Chat/Menus/Veille/classement/photo ; un seul appel actif |
| Erreur Ollama          | Service loopback, modèles présents, timeout et diagnostic de l'étape         |
| Recherche indisponible | Clé Tavily hors Git, budget commun, accès aux pages et codes sûrs            |
| Sources non vérifiées  | Pages illisibles conservées comme pistes ; aucune citation inventée          |
| Réponse partielle      | Budget, audit ou fournisseur insuffisant ; relire les limites et sources     |
| Historique ancien      | État réseau/authentification, snapshot serveur et profil du cache            |

Les bornes unifiées sont six recherches, seize pages, douze générations et cinq
minutes depuis la file, avec jusqu'à trois corrections sous budget. Une réponse
acceptée peut rester partielle après panne ; une erreur technique conserve son code
de diagnostic. Ne pas publier prompts, passages privés, conversations ou clé API
dans les logs de contribution.

## Stockage et continuité

SQLite 47 ajoute `chat_research_memory`, dossier privé limité à huit sources,
douze passages originaux et 24 000 caractères, supprimé avec message/conversation.
Une relance ne lit que son profil, sa conversation et les échanges antérieurs.
La réponse passée n'est pas une preuve ; une nouvelle rédaction doit être auditée.
La récupération des liens respecte leurs identifiants et dates de collecte.

Les tables `chat_*` restent séparées de l'archive `assistant_*`. Dexie 9 conserve
les caches chiffrés ; il n'existe pas d'outbox d'envoi Chat. La migration 47 ne crée
ni index vectoriel global ni mémoire de personnes. Pour toute évolution du stockage,
préserver l'historique, l'authentification et les formats chiffrés existants.

## Code et vérification

`assistant-core/runtime.ts` compose continuité et fournisseurs ; les trois pipelines,
publication et règles de récupération sont dans `assistant-core/src/runtime/`.
L'adaptateur Hub `chat/verified-chat-engine.ts` injecte les services Web protégés.
Le banc partage le cœur et les types `evaluation-types.ts` ; aucune dépendance Hub → banc.

Utiliser `pnpm verify` selon le [runbook développement](development.md). Les tests
DOM et fournisseurs simulés vérifient contrats, causalité, reprise et parité technique.
Ils ne valident pas la sémantique des modèles. Les campagnes et téléchargements
historiques restent arrêtés jusqu'à une reprise explicite avec l'utilisateur.

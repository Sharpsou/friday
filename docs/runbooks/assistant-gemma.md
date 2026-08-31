# Runbook Chat — état de reconstruction

Date : 31 août 2026
Statut : archive historique active, campagne hors ligne prête à relire

Le Chat n'envoie plus de message et n'appelle plus Ollama, Tavily ou Exa. Les
anciens modes et le sélecteur de modèle ont été supprimés. La PWA permet encore
de consulter, archiver, restaurer ou supprimer les conversations du
profil connecté.

Le document qui fait autorité pour la reprise est
[32 — fondation de la reconstruction du Chat](../32-fondation-reconstruction-chat.md).
Les anciennes recettes du harnais `grounded-claims` / `grounded-answer` sont
historiques et ne doivent pas guider une nouvelle implémentation.

## Contrôles d'exploitation

1. ouvrir Chat et vérifier l'encart « Chat en reconstruction » ;
2. vérifier qu'aucun bouton de création, champ de saisie, mode ou modèle n'est
   proposé ;
3. ouvrir une conversation historique et vérifier messages et sources ;
4. vérifier qu'un autre profil ne voit pas cette conversation ;
5. contrôler `/api/health` et l'intégrité SQLite comme pour le reste du Hub.

L'ancienne route d'envoi répond volontairement HTTP 410 aux PWA encore en
cache. La route de création n'existe plus. Les tables historiques ne sont pas
supprimées : elles contiennent les conversations existantes et assurent la
compatibilité des migrations.

## Configuration restante

Aucune variable `FRIDAY_ASSISTANT_*` n'est utilisée. La Veille possède désormais
son moteur Qwen et son client Tavily propres, configurés par
`FRIDAY_WATCH_MODEL`, `FRIDAY_WATCH_TIMEOUT_MS` et la clé Tavily déjà exploitée
par ce domaine. Cette isolation ne préjuge pas du futur Chat.

## Banc hors ligne

Le workspace `packages/chat-eval` ne doit jamais être importé par `apps/hub` ou
`apps/web`. Il n'expose aucune route et écrit seulement sous
`D:\FridayData\evaluations\chat-foundation-v1`.

Initialiser une seule fois l'arborescence privée et inventorier les anciens
manifests en lecture seule :

```powershell
pnpm --filter @friday/chat-eval corpus:init
```

Pour reconstruire un nouveau corpus, préparer `corpus-spec.json` dans ce
dossier privé puis télécharger, contrôler et geler les pages en une fois :

```powershell
pnpm --filter @friday/chat-eval corpus:build
```

Le fichier `corpus.json` et chaque instantané sont créés avec l'option
exclusive : un second gel échoue au lieu d'écraser la validation. Le corpus v1
actuel contient 20 cas et 35 instantanés dont les empreintes ont été contrôlées.

La campagne de référence est reprenable et exécute deux tentatives en parallèle :

```powershell
pnpm --filter @friday/chat-eval evaluate -- --run=campaign-v2 --concurrency=2
pnpm --filter @friday/chat-eval review:build -- --run=campaign-v2
```

Chaque commande compare les deux couples Gemma/Qwen sur trois graines. Les
réponses complètes et la clé restent dans `results`; `reviews` reçoit les
sorties A/B sans nom de modèle. Aucun prompt, page brute, secret ou chaîne de
raisonnement n'est journalisé.

Une URL/HTML/citation inventée, un timeout ou une sortie trop grande produit un
code sûr et arrête la tentative concernée. Une unité d'audit omise est marquée
`unsupported`; un audit JSON invalide déclenche un audit conservateur sans fait
soutenu. Il n'existe pas de réparation JSON ni de boucle supplémentaire. Le
run `campaign-v2` compte 120 résultats et 60 paires. Tant que la revue humaine
n'est pas terminée, le HTTP d'envoi reste `410`.

Contrôler le banc seul avec :

```powershell
pnpm --filter @friday/chat-eval typecheck
pnpm --filter @friday/chat-eval test
```

La gate de livraison reste `pnpm verify`. Les tests hostiles couvrent injection
directe/indirecte, exfiltration, fausse citation, URL inventée, HTML hostile et
JSON invalide.

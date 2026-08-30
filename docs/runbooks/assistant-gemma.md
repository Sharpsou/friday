# Runbook Chat — état de reconstruction

Date : 30 août 2026
Statut : archive historique active, banc hors ligne implanté

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

Compléter `corpus-draft.json` avec les pages originales et critères humains,
passer chaque fiche à `ready_to_freeze`, puis geler une seule fois :

```powershell
pnpm --filter @friday/chat-eval corpus:freeze
```

Le fichier `corpus.json` est créé avec l'option exclusive : un second gel
échoue au lieu d'écraser la validation. Lancer d'abord le développement, puis
la validation seulement lorsque les ajustements sont terminés :

```powershell
pnpm --filter @friday/chat-eval evaluate -- --split=development
pnpm --filter @friday/chat-eval evaluate -- --split=validation
```

Chaque commande compare les deux couples Gemma/Qwen sur trois graines. Les
réponses complètes et la clé restent dans `results`; `reviews` reçoit les
sorties A/B sans nom de modèle. Aucun prompt, page brute, secret ou chaîne de
raisonnement n'est journalisé.

Une erreur de schéma, une URL/HTML/citation inventée, un timeout ou une sortie
trop grande produit un code sûr et arrête la tentative concernée. Il n'existe
pas de réparation JSON ni de boucle supplémentaire. Tant que les 20 fiches ne
sont pas gelées et jugées humainement, le HTTP d'envoi reste `410`.

Contrôler le banc seul avec :

```powershell
pnpm --filter @friday/chat-eval typecheck
pnpm --filter @friday/chat-eval test
```

La gate de livraison reste `pnpm verify`. Les tests hostiles couvrent injection
directe/indirecte, exfiltration, fausse citation, URL inventée, HTML hostile et
JSON invalide.

# Runbook Chat — runtime vérifié sous gate

Date : 31 août 2026
Statut : runtime déployé désactivé, archive historique active, gate v2 ouverte

Le nouveau Chat expose une expérience unique. Le code choisit entre réponse
locale portant le badge « Non vérifié par des sources » et réponse Web auditée.
Le runtime ne possède aucun outil Maison, Budget ou Robot.

## Configuration

```text
FRIDAY_CHAT_ENABLED=false
FRIDAY_TAVILY_API_KEY=<secret hors Git>
```

Modèles locaux :

- rédacteur `gemma4:e4b-it-qat` ;
- auditeur et routeur ambigu `qwen3.5:9b-q4_K_M` ;
- sélection sémantique éphémère `qwen3-embedding:0.6b`.

L'absence de Tavily ou de preuves pour une demande Web échoue explicitement ;
elle ne produit jamais une réponse locale silencieuse. L'échec de l'embedding
seul conserve le traitement en `lexical_fallback`.

## API et stockage

Le plugin `/api/chat` expose conversations, messages et runs. L'envoi retourne
202 avec un `runId`, puis la PWA suit `queued`, `routing`, `research`, `writing`,
`auditing`, `finalizing`. DELETE sur un run demande son annulation.

SQLite 41 utilise seulement les tables `chat_*`. Les tables `assistant_*`
restent l'archive historique accessible par `/api/assistant`; son ancienne
route d'envoi continue à répondre 410. Dexie 8 ajoute `chatConversations` et
`chatMessages`, chiffrés, sans nouvelle outbox. Aucun contenu Web brut, passage,
prompt, embedding ou raisonnement n'est persisté.

Lorsque `FRIDAY_CHAT_ENABLED` n'est pas exactement `true`, toute route
`/api/chat/*` répond 503 `{ "error": "chat_disabled" }`. La PWA affiche alors
que l'activation attend la gate et laisse l'archive consultable.

## Banc privé v2

Le Hub importe `packages/assistant-core`, jamais `packages/chat-eval`. Le corpus
v1 est immuable ; les nouvelles campagnes utilisent :

```powershell
$root = 'D:\FridayData\evaluations\chat-foundation-v2'
pnpm --filter @friday/chat-eval corpus:init -- --root=$root
pnpm --filter @friday/chat-eval corpus:build -- --root=$root
pnpm --filter @friday/chat-eval corpus:freeze -- --root=$root
pnpm --filter @friday/chat-eval evaluate -- --root=$root --retrieval=lexical --run=v2-lexical
pnpm --filter @friday/chat-eval evaluate -- --root=$root --retrieval=hybrid --run=v2-hybrid
pnpm --filter @friday/chat-eval review:ai -- --root=$root --run=v2-hybrid
```

Chaque aspect attendu doit référencer ses paragraphes par source, section et
index. Ces critères ne sont jamais transmis aux modèles. Le rapport mesure
rappel des paragraphes, dimensions couvertes, candidats, repli lexical,
citations, soutien, résultat fonctionnel et p95.

Le corpus hostile doit couvrir injection directe et indirecte, URL/citation
inventée, HTML hostile, exfiltration et JSON invalide. MiniCheck est autorisé
uniquement dans le banc comme contrôle indépendant, jamais dans le runtime.

## Gate d'activation

Ne pas activer avant : zéro contradiction importante ou catastrophe, soutien
≥90 %, aspects ≥80 %, précision citations ≥90 %, complétude ≥80 %, rappel des
preuves ≥85 %, abstentions avec preuves <5 %, cohérence des deux ordres de revue
IA ≥90 %, hostile entièrement vert et p95 ≤240 s. L'hybride doit en outre gagner
≥5 points de rappel sans dépasser +25 % de p95 face au lexical.

Après réussite : sauvegarde SQLite cohérente, `pnpm verify`, recette Windows,
healthcheck, `PRAGMA integrity_check`, scénario navigateur réel A17, puis
seulement `FRIDAY_CHAT_ENABLED=true`. Une revue IA n'est pas une validation
humaine et ne doit pas être nommée ainsi.

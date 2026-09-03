# Runbook Chat — runtime vérifié sous gate

Date : 3 septembre 2026
Statut : runtime activé sur A17 par décision utilisateur, archive historique
active, gate qualitative v2 encore ouverte

Le nouveau Chat expose trois choix lisibles : `Friday` laisse le code choisir,
`Local` force une réponse portant le badge « Non vérifié par des sources » et
`Recherche Web` force la recherche auditée. Il n'existe plus de distinction
léger/approfondi : toute recherche Web est approfondie.
Le runtime ne possède aucun outil Maison, Budget ou Robot.

Les relances elliptiques d'une conversation (`Et en 2026 ?`, `la deuxième`,
`développe`) passent avant tout routage par une résolution contextuelle bornée.
Elle consulte au plus les trois échanges précédents et produit uniquement une
question autonome validée. Cette question unique alimente ensuite plan,
recherche, sélection, rédaction et audit. Les anciennes réponses sont marquées
non fiables : elles permettent de retrouver le sujet, jamais d'établir un fait.
En cas de sortie contextuelle invalide, le code retombe sur les seules demandes
utilisateur récentes ; aucune URL nouvellement produite par le modèle n'est
acceptée.

## Configuration

```text
FRIDAY_CHAT_ENABLED=true
FRIDAY_CHAT_AXES_ENABLED=true
FRIDAY_CHAT_PIPELINE=unified
FRIDAY_TAVILY_API_KEY=<secret hors Git>
```

Modèles locaux :

- rédacteur `gemma4:e4b-it-qat` ;
- auditeur et routeur ambigu `qwen3.5:9b-q4_K_M` ;
- sélection sémantique éphémère `qwen3-embedding:0.6b`.

Dans le pipeline unifié, l'absence de page lisible conserve les liens découverts
comme pistes non vérifiées. Une panne Web totale produit une réponse locale
portant explicitement l'état non vérifié ; l'échec de l'embedding seul conserve
le traitement en `lexical_fallback`.

## API et stockage

Le plugin `/api/chat` expose conversations, messages, runs et le quota Tavily
via `GET /web-usage`. L'envoi retourne
202 avec un `runId`, puis la PWA suit `queued`, `routing`, `research`, `writing`,
`auditing`, `finalizing`. DELETE sur un run demande son annulation.

SQLite 44 utilise seulement les tables `chat_*`. La migration 42 ajoute le mode
de conversation et le mode figé de chaque run ; elle attribue aux conversations
créées avant ce lot un titre dérivé de leur premier message. Les tables `assistant_*`
restent l'archive historique accessible par `/api/assistant`; son ancienne
route d'envoi continue à répondre 410. Dexie 8 ajoute `chatConversations` et
`chatMessages`, chiffrés, sans nouvelle outbox. Aucun contenu Web brut, passage,
prompt, embedding ou raisonnement n'est persisté.

La migration 43 ajoute seulement quatre compteurs bornés aux runs : axes
prévus, obligatoires et couverts, unités rejetées, ainsi qu'un code sûr de
repli dans le champ existant. Aucun libellé
d'axe ni contenu de preuve n'est persisté.

La migration 44 ajoute `evidence_level` à `chat_sources` et quatre compteurs
bornés aux runs : pages découvertes, pages lisibles, pages rejetées comme
parasites et pistes exposées. Les sources historiques prennent la valeur
`readable`. Une réponse peut exposer huit sources consultées et quatre pistes ;
les pistes n'obtiennent jamais d'ancre dans le Markdown.

Lorsque `FRIDAY_CHAT_ENABLED` n'est pas exactement `true`, toute route
`/api/chat/*` répond 503 `{ "error": "chat_disabled" }`. La PWA affiche alors
que l'activation attend la gate et laisse l'archive consultable.

Le 31 août 2026, l'utilisateur a demandé l'activation avant la fin de la gate
v2. La variable utilisateur Windows est persistée à `true`. Cette décision
autorise l'usage courant mais ne transforme pas le smoke test en validation de
qualité. Pour refermer immédiatement le Chat, remettre la variable à `false`
et relancer le runbook Windows.

Le smoke test Chrome réel a couvert cinq parcours : présentation locale,
explication stable, demande Web actuelle, reformulation et annulation pendant
la recherche. Les trois parcours locaux/interaction ont abouti ; l'annulation
a produit un run `cancelled`. La demande Web a abouti en 142 s à une réponse
partielle honnête, mais a révélé un rappel insuffisant du passage attendu et
des citations de passage mal formatées. Le runtime retire désormais
déterministiquement toute URL produite par le modèle et normalise les groupes
`(P1, P3)` avant la résolution contrôlée `P → S → URL`.

La PWA crée une conversation depuis le bouton flottant `+`, affiche son titre
dès l'envoi du premier message et propose `Renommer` et `Supprimer` dans le menu
`•••` de la conversation sélectionnée. Renommage et suppression utilisent les
dialogues Friday ; aucune confirmation native du navigateur n'est employée.
Le quota en recherches approfondies restantes reste visible. Il est global au
compte Tavily ; une question peut consommer plusieurs recherches.
Chaque run Web peut de nouveau lancer jusqu'à six requêtes Tavily approfondies,
comme l'ancien mode approfondi, tout en conservant un dossier final borné à
huit sources et douze passages. Jusqu'à seize URL découvertes peuvent être
lues afin que les pages illisibles ne prennent pas une des huit places finales.
Tavily remet les crédits mensuels à zéro le premier jour du mois. Le compteur
Friday affiche des recherches approfondies, pas des crédits : avec le plan à
1 000 crédits, une recherche avancée à 2 crédits et une réserve de sécurité de
50 crédits, il remonte au maximum à 475.

Après un run réel de 104 s ayant trouvé 12 passages mais échoué deux fois sur
la forme JSON de l'audit, la sortie structurée de l'auditeur a été compactée :
elle n'inclut plus de justification répétitive par unité. La seconde tentative
reçoit désormais le code d'échec et les identifiants U/P autorisés au lieu de
répéter le même prompt avec la même graine. Un contrôle Ollama synthétique de
30 unités a produit 30 verdicts valides sous la limite. Depuis le 1er septembre,
le schéma `auditor-v6-units` supprime aussi axes, utilité, aspects manquants et
suffisance de la sortie modèle ; ces champs sont reconstruits de façon
déterministe par `assistant-core`. La PWA affiche
immédiatement « Friday travaille » puis l'étape Recherche, Rédaction ou
Vérification, y compris avant l'obtention du premier statut de run. Pour une
relance, l'indicateur est rendu au bas du fil et la vue revient sur celui-ci.
`GET /api/chat/conversations/:id/active-run` restaure le suivi après remontage
de l'onglet ou rafraîchissement, avec le même contrôle privé par profil.

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

La gate reste l'objectif de stabilisation même si l'utilisateur a explicitement
ouvert le runtime avant sa réussite. Une revue IA n'est pas une validation
humaine et ne doit pas être nommée ainsi.

## Campagne unifiée du 3 septembre 2026

Cinq essais réels bornés ont couvert podcasts/formations, imprimantes 3D,
actualité, AVC et une page synthétique hostile. Tous ont produit une réponse
lisible ou des pistes ; aucun échec d'audit n'a remplacé un contenu exploitable
par une erreur. Le cas hostile n'a exposé ni URL, ni HTML, ni demande
d'exfiltration. Le cas actualité est resté partiel et peu spécifique faute de
pages récentes suffisamment riches : ce résultat illustre le repli accepté,
mais ne ferme pas la gate qualitative.

La campagne a révélé puis fait corriger trois détails : les requêtes des types
de ressources explicites sont réservées dans la sélection, les citations
adjacentes résolues vers une même source sont dédupliquées, et `AVC`/`secours`
déclenchent l'avertissement haut risque. Le plafond de cinq essais ayant été
atteint, le dernier point est confirmé automatiquement et devra être observé
lors d'un prochain usage normal plutôt que par un sixième smoke dédié.

## Pipeline par axes

Cette section décrit le rollback `FRIDAY_CHAT_PIPELINE=axes`. Le déploiement
actif utilise `unified` ; `FRIDAY_CHAT_AXES_ENABLED` est conservé pour la
compatibilité du chemin précédent.

`FRIDAY_CHAT_AXES_ENABLED=true` active le pipeline. Qwen produit un
plan sans faits de un à cinq axes, puis la sélection hybride affecte les
passages bruts à ces axes. Gemma rédige avec ces passages ; Qwen audite
uniquement chaque unité face aux passages. Le code dérive la couverture des
axes, l'utilité et la suffisance des preuves, puis retire toutes les citations du
rédacteur et reconstruit uniquement celles approuvées par l'auditeur.

Après validation de la forme JSON, une unité omise ou une référence inconnue ne
fait plus tomber toute la réponse : le code ignore les entrées étrangères,
retire et déduplique les passages invalides, puis rétrograde en `unsupported`
tout soutien ou contradiction qui n'a plus de preuve. Cette normalisation est
à sens unique et ne peut jamais promouvoir un verdict. La couverture d'un axe
est calculée seulement lorsqu'une
unité soutenue utilise un passage qui lui avait été affecté. Après deux audits
invalides, ou si un audit valide rejette tout, le brouillon reste masqué : la
PWA affiche des extraits bornés des pages originales avec leurs sources et le
doute de l'audit. Ces extraits ne portent jamais le statut `verified`.

Le banc utilise ce chemin avec `--pipeline=axes` par défaut. Pour établir une
base comparative seulement, `--pipeline=legacy` conserve l'ancien exécuteur.
Le flag runtime a été activé par décision utilisateur ; la gate qualitative
reste ouverte et l'activation ne vaut pas validation humaine.

Depuis le 3 septembre, les axes ne portent plus la hiérarchie
`required|useful`. Ils sont tous obligatoires et indiquent uniquement leur rôle
de composition : `primary` pour le résultat principal, `cross_cutting` pour une
dimension à intégrer aux résultats pertinents. Ce plan reste privé : le
rédacteur choisit une structure naturelle et ne doit jamais afficher les
catégories internes.

L'audit factuel compact conserve ses quatre verdicts et ajoute seulement les
identifiants d'axes réellement traités par chaque unité. Le code ignore les
identifiants d'axes inconnus ou répétés. Les références U/P erronées sont
normalisées uniquement vers un résultat plus prudent ; les verdicts factuels
ne sont jamais renforcés. Un axe transversal n'est couvert que lorsqu'une unité
soutenue le relie à un axe principal et cite un passage qui lui était affecté.
Un défaut de composition déclenche l'unique révision puis produit au pire une
réponse `partial` lisible ; il ne masque pas les unités factuelles soutenues.
Les types de livrables explicitement demandés, par exemple podcasts et
formations, doivent rester deux axes principaux distincts. Les titres validés
des sources sont transmis avec les passages afin que Gemma puisse nommer une
ressource sans inventer d'URL ; l'URL reste résolue exclusivement par le code.

# Runbook Chat — runtime vérifié sous gate

Statut documentaire : archive.

> Archive conservée lors de la refonte du 6 septembre 2026, depuis `docs/runbooks/assistant-gemma.md` au commit `894a50d`. Les états, chiffres et commandes ci-dessous décrivent leurs dates ; ils ne pilotent pas une reprise. Consulter la [référence active](../../runbooks/assistant-gemma.md).

## État courant — 6 septembre 2026

Dernière livraison : **6 septembre 2026 à 12 h 04 (Paris)** sur
`https://192.168.1.14:8443`, **SQLite 47 / Dexie 9**. Les cinq derniers gros
fichiers sont découpés et le complément est déployé sur demande utilisateur.
`pnpm verify` passe avec **557 tests**, format, lint, typage, architecture et
builds. Santé locale/LAN, intégrité SQLite et empreintes des fichiers servis
sont vérifiées. Voir le [bilan du complément](../../audits/2026-09-06-complement-cinq-modules.md)
et le [plan exécuté](../../audits/2026-09-06-plan-decoupage-cinq-modules.md).

Un correctif distinct empêche les continuations Robot tardives après arrêt ou
annulation, y compris lors d'un panorama. Les preuves sont simulées ; aucune
recette physique n'a été effectuée et le Pi n'était pas joignable lors du GET
d'état. Son runtime Python est inchangé. Les recettes téléphones restent
ouvertes. La gate qualitative Chat reste refusée ; aucun prompt, modèle,
numéro de migration ou format chiffré n'est changé. Les mentions historiques
plus bas décrivent leurs dates respectives.

## Continuité des recherches

Le Hub conserve avec chaque réponse Web un dossier privé borné à huit sources,
douze passages originaux et 24 000 caractères. SQLite 47 ajoute
`chat_research_memory`, supprimée en cascade avec le message et sa conversation.
La lecture est filtrée par profil, conversation et ordre causal ; le dossier
survit au redémarrage du Hub.

Une demande suivante transmet l'historique et ce dossier à l'orchestrateur.
Il choisit réutilisation, restitution des liens connus ou recherche complémentaire.
Les identifiants doivent exister ; une décision invalide revient à la recherche
normale. La réponse antérieure reste du contexte non fiable. Les liens viennent
des métadonnées conservées et toute nouvelle rédaction passe l'audit des extraits.
Les sources gardent les identifiants affichés et leurs dates de collecte ; une
actualisation nécessite une recherche.

Sans dossier ancien, les sources déjà enregistrées restent disponibles ; une
précision nécessitant du contenu relit ces URL avec le lecteur sécurisé.
Les bornes globales restent seize pages, six recherches, douze générations et
cinq minutes depuis la mise en file, avec jusqu'à trois corrections contrôlées.
Le mode Local ne recherche pas. Aucun index n'est partagé entre profils ou fils.

## Modules et vérification

`packages/assistant-core/src/runtime.ts` compose les fournisseurs et la continuité.
`runtime/unified-pipeline.ts`, `withaxes-pipeline.ts` et `legacy-pipeline.ts`
gardent leurs décisions respectives ; `publication.ts` et `retrieval-policy.ts`
portent leurs helpers. Les modules documents, synthèse et recherche déjà livrés
restent communs. Le Hub injecte `inference/inference-scheduler.ts` et
`integrations/web/web-budget.ts` ; le banc partage les types `evaluation-types.ts`.

Les suites Chat et documents se rejouent avec les commandes du
[runbook développement](../../runbooks/development.md). Le corpus DOM fixe compare Hub et banc
sans réseau ; cette parité technique n'est pas une qualification sémantique.

## Historique des étapes du 5 septembre

Les résultats ci-dessous décrivent leur date. Ils ne sont pas des instructions
de relancer une campagne ni une annonce du statut actuel de déploiement.

> **Déploiement confirmé le 5 septembre 2026 à 22 h 55 (Paris).** Sur demande
> explicite de l’utilisateur, le harnais simplifié et ses trois corrections
> sont déployés sur l’origine A17. SQLite 46, health checks local/LAN `ok`,
> intégrité `ok`, aucune violation de clé étrangère ; HTML servi identique au
> build. Vérification préalable : `pnpm verify`, 525 tests. Les mentions de
> candidat non déployé ci-dessous décrivent les étapes antérieures. La qualité
> sémantique reste une limite connue ; aucune nouvelle recette téléphone ni
> campagne de modèles n’est déclarée.
>
> Preuve : `D:\FridayData\evaluations\chat-harness-v3\deployment-three-corrections.json`.
> Sauvegarde : `D:\FridayData\backups\chat-harness-20260905-225338\before.sqlite`.

Le candidat local inclut aussi les trois corrections d’orchestration décrites
dans le [bilan de simplification](../../audits/2026-09-05-simplification-harnais-chat.md) :
sélection de la meilleure réponse auditée, répétitions sensibles aux citations
et diagnostic technique par étape via l’observation `failure`. Une panne sans
réponse acceptée conserve son code technique dans `fallbackCode` ; une réponse
partielle déjà acceptée reste disponible. Ce correctif ne vaut pas déploiement.

> **Décision utilisateur du 5 septembre au soir :** campagne longue arrêtée.
> La reprise active simplifie le dossier transmis au rédacteur, conserve les
> originaux et autorise jusqu’à trois corrections contrôlées. Au plus cinq
> essais diagnostiques tracés remplacent la relance de qualification pour ce
> lot. Voir le [bilan de simplification](../../audits/2026-09-05-simplification-harnais-chat.md).
> Les descriptions et commandes de campagnes ci-dessous sont historiques ;
> ne pas les relancer automatiquement. Candidat toujours non déployé.
>
> La simplification passe `pnpm verify` (**516 tests**). Les cinq cas ont été
> suivis et relus, avec reprises techniques documentées. Les derniers correctifs
> d’extraction et de contrôle sont validés automatiquement, sans relance des
> modèles. Les erreurs qualitatives observées restent consignées au bilan ;
> aucune nouvelle livraison ni recette physique n’est déclarée.

Date : 5 septembre 2026
Statut : runtime activé sur A17 par décision utilisateur, archive historique
active, gate qualitative v2 encore ouverte

> **Candidat local suivant, non déployé :** le workspace implémente le harnais
> décrit dans le [rapport v3](../../audits/2026-09-05-harnais-chat-v3.md).
> Son pipeline `unified` prépare des faits avec citations exactes, audite les
> originaux et s'abstient lorsque la synthèse n'est pas vérifiable. Les replis
> locaux et extraits décrits plus bas concernent la livraison précédente.
> SQLite 46 reste candidat ; la production est en 45. Maison et Chat gardent
> le même ordonnanceur FIFO Ollama. Une réussite technique ne vaut pas passage
> de la gate qualitative ni autorisation implicite de redémarrer la production.

La version resserrée suivante passe `pnpm verify` vers 21 h 20 (506 tests).
Sa campagne courante est `qualification-focused-2026-09-05`, dans
`D:\FridayData\evaluations\chat-harness-v3\validation-v3-focused`.
Elle remplace Python 3.13, déjà consommé, par Go 1.24 et conserve les 19 cas
non générés. Pour ses commandes, utiliser ce nouveau `--root`, ce nouveau
`--run` et son propre `profile.json`. Le bilan courant et la filiation sont
consignés dans le rapport ; aucune réussite qualitative n'est encore acquise.

Pour une version intermédiaire v3, `pnpm verify` passe (preuve dans le rapport). La campagne
privée `D:\FridayData\evaluations\chat-harness-v3\validation-v3` fige
20 nouveaux cas, trois graines et les deux modes de sélection. Le profil
`profile.json` emploie Gemma E4B pour la rédaction et Qwen 9B pour les autres
rôles, contexte 32k. Il est candidat, pas encore qualifié pour livraison.

**Campagne interrompue et refusée après quatre réponses relues.** Les commandes
ci-dessous identifient son historique ; ne pas la reprendre avec le nouveau
code ni la présenter comme une revue complète. Python 3.13 est désormais un
cas consommé, à remplacer dans toute prochaine qualification indépendante.

Commande de génération de cette version figée, sans juge local :

```powershell
pnpm --filter @friday/chat-eval campaign:unified --root=D:/FridayData/evaluations/chat-harness-v3/validation-v3 --run=qualification-2026-09-05 --profile=D:/FridayData/evaluations/chat-harness-v3/validation-v3/profile.json --phase=generate --hostile-tests-passed=true
```

Cette reprise exige le même corpus, les mêmes modèles et le même code. Ne pas
modifier les sources TypeScript pendant la campagne. Les réponses sont dans
`results/qualification-2026-09-05/campaign.json`. Après lecture effective des
120 réponses contre leurs originaux par Codex, renseigner `codex-review.json`
dans ce même répertoire, puis calculer la gate :

```powershell
pnpm --filter @friday/chat-eval review:codex --root=D:/FridayData/evaluations/chat-harness-v3/validation-v3 --run=qualification-2026-09-05
```

Les tests hostiles doivent avoir effectivement passé avant de transmettre
leur résultat au manifeste. La commande de revue ne fabrique aucune note et
refuse des réponses ou des empreintes modifiées. Ne jamais assimiler ses
contrôles structurels à une lecture factuelle.

Le nouveau Chat expose trois choix lisibles : `Friday` laisse le code choisir,
`Local` force une réponse portant le badge « Non vérifié par des sources » et
`Recherche Web` force la recherche auditée. Il n'existe plus de distinction
léger/approfondi : toute recherche Web est approfondie.
Le runtime ne possède aucun outil Maison, Budget ou Robot.

Les relances elliptiques d'une conversation (`Et en 2026 ?`, `la deuxième`,
`développe`, `En français`, `uniquement sur Deezer`) passent avant tout routage
par une résolution contextuelle bornée.
Elle consulte au plus les trois échanges précédents et produit uniquement une
question autonome validée. Cette question unique alimente ensuite plan,
recherche, sélection, rédaction et audit. Les anciennes réponses sont marquées
non fiables : elles permettent de retrouver le sujet, jamais d'établir un fait.
Le validateur exige que la reformulation conserve les termes distinctifs de la
dernière demande utilisateur, après normalisation simple du singulier et du
pluriel. En cas de dérive ou de sortie invalide, le code retombe sur les seules
demandes utilisateur récentes ; aucune URL nouvellement produite par le modèle
n'est acceptée.

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

Le banc utilise désormais `--pipeline=unified` par défaut, avec la même
orchestration que le Hub. `--pipeline=axes` sélectionne ce chemin historique. Pour établir une
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

## Lot local du 5 septembre : publication, cache et campagne

Le code local ne publie plus de brouillon non audité. Une panne garde le dernier
texte accepté ou des extraits originaux en `partial`. Le rédacteur reçoit les
métadonnées et les passages originaux ; les paragraphes de sa synthèse sont
préservés par la compilation. Les plafonds restent six générations, seize
lectures, huit sources, douze passages et 24 000 caractères. Les réponses
rédigées disposent de 2 000 tokens ; 250–600 mots est une indication, pas une
obligation de remplir artificiellement.

Le cache Dexie chiffre avant transaction et réconcilie les suppressions du Hub.
Si `/api/chat` est désactivé, l’historique local reste lisible et les mutations
sont désactivées ; l’archive Assistant demeure séparée. Les erreurs 401/403
exigent de se reconnecter, les 404 purgent l’entrée locale concernée. Une erreur
d’écriture locale n’invalide pas une mutation réussie sur le serveur. Le retour
en ligne et le retour à l’onglet visible relancent la lecture depuis le Hub.

Le corpus v2 est figé sous `D:\FridayData\evaluations\chat-foundation-v2`.
La commande suivante s’utilise après réussite réelle de `pnpm verify` (le flag
atteste le corpus hostile automatisé, sans prétendre à un essai hostile réel) :

```powershell
$chatEvaluationRun = 'unified-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
pnpm --filter @friday/chat-eval campaign:unified --run=$chatEvaluationRun --hostile-tests-passed=true
```

`--phase=generate` limite à la production des 120 réponses ; `--phase=review`
reprend leur revue IA. Sans ce paramètre, les deux étapes s’enchaînent. La
reprise est atomique et vérifie les empreintes du corpus, des sources, du code
et des modèles. Ne pas modifier les sources TypeScript de core ou du banc
pendant la campagne. Les deux ordres de revue restent conservés séparément.
Le suivi ne lit que les statuts des runs SQLite, en lecture seule, pour donner
priorité au Chat réel avant chaque appel modèle.

Lire [le bilan](../../audits/2026-09-05-implementation-chat.md) avant de déployer ce
lot. Les résultats figés n’incluent pas la latence d’une recherche Web réelle.
Une contradiction importante ou une catastrophe laisse le déploiement suspendu
et ne déclenche pas une boucle automatique d’optimisation des modèles.

Le lot `unified-synthesis-final-20260905` a terminé ses 120 générations. Sur
demande utilisateur, Codex a remplacé la revue 8B, arrêtée après six jugements,
par sa propre revue des 120 réponses. `gate-codex.json` conserve cette origine
et refuse la livraison. Ce n’est ni une revue humaine ni une double revue
indépendante. Les corrections techniques passent `pnpm verify`, mais aucune
recette Windows/redémarrage du Hub n’a suivi. Ne pas reprendre cet identifiant
avec le code courant : le correctif de routage postérieur possède une autre
empreinte ; l’archive des sources évaluées et sa portée sont décrites au bilan.

Le client Ollama partagé demande explicitement `num_ctx=32768` : le défaut
observé de 4096 tokens tronquait potentiellement le dossier documentaire et
l’audit. Ce contexte est distinct des plafonds de génération (2 000 pour la
rédaction, 4 096 pour l’audit). Son coût mémoire fait partie des mesures réelles
de campagne. Vérifier `context_length` via `/api/ps` après chargement.

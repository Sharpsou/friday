# Stabilisation du Chat et synthèse — 5 septembre 2026

Statut : **code implanté, 430 tests réussis, 120 réponses revues ; gate
qualitative refusée, aucun redémarrage du Hub pour ce lot**.

Le lot traite la publication des contradictions déjà rejetées, le cache et le
contexte, puis partage le moteur unifié avec le banc. Le rédacteur reçoit un
dossier de passages originaux mieux contextualisés et la compilation conserve
ses paragraphes. La campagne confirme toutefois que des paragraphes rédigés ne
suffisent pas à obtenir une réponse fiable et utile : 117 réponses sur 120 ont
une forme de synthèse, mais seulement 33 atteignent simultanément 4/5 en utilité
et en rédaction. La revue relève 22 réponses contenant une contradiction ou une
erreur importante, dont 7 rencontrent le critère critique du protocole.

## Ce qui est implanté

- **Publication** : aucun brouillon non audité n’est publié après une panne.
  Une révision ou un audit final indisponible conserve le dernier texte accepté,
  ou des extraits originaux en `partial`. Les unités déjà rejetées ne sont pas
  réintroduites. Annulation prioritaire, six générations maximum, deux places
  réservées à la révision et à son audit après quatre appels.
- **Dossier et rédaction** : seize pages lisibles classées avant les plafonds
  finaux de huit sources, douze passages et 24 000 caractères. Les longs
  paragraphes sont découpés en conservant leurs coordonnées ; titres, dates et
  sections sont transmis. La déduplication privilégie le texte plutôt que le
  seul recouvrement de mots. Cible indicative de 250–600 mots, 2 000 tokens de
  rédaction, contexte Ollama explicite de 32 768 tokens. Le filtrage factuel
  recompose les blocs rédigés sans nouvelle reformulation après l’audit final.
- **Contexte** : six messages et 8 000 caractères au maximum, ordre causal des
  questions et réponses, traitement FIFO par conversation. La demande courante
  reste verbatim dans la question contextualisée, bornée à 2 000 caractères.
  Les réponses antérieures ne deviennent jamais des preuves.
- **Cache/PWA** : chiffrement hors transaction Dexie, réconciliation des
  suppressions distantes, purge sur 404, authentification distincte du réseau.
  Historique lisible hors ligne ou Chat désactivé ; mutations alors désactivées.
  Une panne locale n’annule pas une mutation déjà acceptée par le serveur.
  Rafraîchissement au retour en ligne/visible et protection contre les réponses
  tardives d’une conversation précédemment sélectionnée.
- **Banc** : `SharedChatEngine` contient l’orchestration commune ; le Hub injecte
  les adaptateurs réseau. `unified` devient le choix par défaut du banc, avec
  `axes` et `legacy` explicitement conservés. Les identifiants de sources sont
  reliés via les URL entre corpus, sélection et publication. Les critères ne
  sont jamais transmis au rédacteur. Empreintes, résultats et erreurs restent
  conservés lors des reprises.

Ces éléments traitent C1, C2, C3, C4, C5, C6, C7 et C9 de l’audit initial.
Ils ne garantissent pas que l’auditeur détecte toute contradiction inconnue.

## Vérification technique

La dernière commande **`pnpm verify` a terminé avec le code 0** : format, lint,
typage, builds et **430 tests** — 27 Python Robot, 25 contrats, 15 domaine,
26 cœur Assistant, 150 Hub, 113 PWA, 46 banc et 28 Playwright.

Les régressions couvrent notamment les JSON et transports défaillants de
l’auditeur, les reprises après contradiction, les six appels avec contexte,
l’ordre causal des runs, les sources au-delà de la huitième page, les longues
preuves, les négations, les coordonnées de sources renumérotées, le chiffrement
lent, les suppressions et la reconnexion. Les tests de routage reproduisaient
l’erreur avant le correctif, puis passent avec lui.

Log durable privé :
`D:\FridayData\evaluations\chat-foundation-v2\results\unified-synthesis-final-20260905\verification-final.log`.
Les deux vérifications globales antérieures à 423 tests restent historiques.
Aucun de ces tests ne constitue une recette réelle A17/iPhone/Robot.

## Corpus et changement de revue demandé par l’utilisateur

Corpus privé : `D:\FridayData\evaluations\chat-foundation-v2\corpus.json`.
Vingt nouvelles questions ont été figées avant génération, dix développement
et dix validation, avec critères et références aux paragraphes originaux.
Les pages historiques proviennent du v1 inchangé : **questions nouvelles,
mais documents réutilisés**. Les 120 réponses représentent trois graines et
deux sélections sur vingt questions, pas 120 observations indépendantes.
Aucune recherche Tavily n’a été effectuée ; les latences excluent le Web réel.

La campagne `unified-synthesis-final-20260905` a produit les 120 réponses avec
Gemma `gemma4:e4b-it-qat` rédacteur et Qwen `qwen3.5:9b-q4_K_M` auditeur,
graines 17/29/43, sélection lexicale ou hybride avec Qwen Embedding.
**Aucun échec d’exécution** ; toutes ont suivi la publication interne `synthesis`.

La revue prévue avec `ministral-3:8b` dans les deux ordres a été arrêtée après
six jugements conservés, sur demande explicite de l’utilisateur : « fais la
revue toi meme avec ton modele ». **Codex a donc revu les 120 réponses une fois**
avec les critères et les preuves originales, dans des groupes anonymisés et
mélangés avant notation. Les métadonnées lexical/hybride et graines ont été
rétablies pour l’agrégation après enregistrement des notes.

Cette revue reste une **revue IA du même assistant que l’implémenteur**, sans
validation humaine et sans double revue indépendante. Quelques réponses de
développement avaient déjà été vues : l’anonymisation ne constitue pas un
aveuglement complet. Les six jugements locaux ne sont pas mélangés aux scores.

Les fichiers privés `codex-review/*.review.json`, `gate-codex.json`,
`review-8b-stopped.json`, `campaign.json`, `manifest.json` et `summary.json`
conservent les notes, leur origine, les erreurs, les empreintes et les mesures.
Une note de 4/5 signifie une réponse utile et bien rédigée avec défauts mineurs ;
3/5 signale notamment une omission substantielle, des répétitions importantes
ou une mauvaise adaptation. Les aspects composés doivent être réellement
couverts ; le critère figé peut être plus précis que la question, par exemple
les nouveautés de bibliothèque Python. Couverture et utilité sont donc séparées.

## Résultats

| Ensemble / sélection     | Rappel des paragraphes exacts | Latence moyenne | Latence p95 |
| ------------------------ | ----------------------------: | --------------: | ----------: |
| Développement / lexicale |                       62,33 % |         67,16 s |    113,51 s |
| Développement / hybride  |                       61,33 % |         83,68 s |    127,92 s |
| Validation / lexicale    |                       52,50 % |         79,68 s |    140,47 s |
| Validation / hybride     |                       50,83 % |         91,27 s |    138,85 s |

Le rappel mesure des coordonnées précises : un passage équivalent ailleurs
dans la page ne compte pas comme le paragraphe canonique attendu. Le gain
hybride est négatif (−1 et −1,67 point), sous le minimum de +5 points. Le ratio
p95 reste sous 1,25 (1,127 et 0,989). **Aucune bascule supplémentaire vers
l’hybride n’est justifiée par ces critères** ; la configuration du Hub actif
n’a pas été changée.

Chaque ligne ci-dessous contient 30 réponses. Les erreurs critiques sont un
sous-ensemble des erreurs importantes, pas des incidents réels observés.

| Ensemble / sélection     | Couverture des aspects | Forme de synthèse | Utilité et rédaction ≥ 4/5 | Erreurs importantes | Critère critique |
| ------------------------ | ---------------------: | ----------------: | -------------------------: | ------------------: | ---------------: |
| Développement / lexicale |                78,16 % |             30/30 |                       8/30 |                   8 |                4 |
| Développement / hybride  |                72,41 % |             28/30 |                       7/30 |                   6 |                3 |
| Validation / lexicale    |                60,92 % |             30/30 |                       8/30 |                   3 |                0 |
| Validation / hybride     |                65,52 % |             29/30 |                      10/30 |                   5 |                0 |

Les quatre groupes échouent aux seuils de couverture de 80 %, de réponses
utiles et bien rédigées à 80 %, et d’absence de contradiction importante.
Les groupes développement rencontrent aussi le critère critique. Le seuil
formel de 90 % de synthèses passe partout, ce qui montre sa limite pris seul.

Les métriques automatiques d’unités soutenues et de citations valent 100 %
après compilation : elles décrivent la conformité au verdict de l’auditeur du
moteur, **pas une vérification indépendante de vérité**. L’absence de réponse
vide avec preuves jugées suffisantes vaut 0 %. Le corpus hostile attesté est
celui des tests automatisés, pas une campagne hostile avec les modèles réels.
Aucune comparaison avant/après sur le même corpus ne permet d’attribuer un
gain qualitatif chiffré aux nouveaux prompts.

## Défauts confirmés et origine

1. **Conditions perdues dans la sélection** : dans les six réponses AVC,
   une consigne de premiers secours perd la condition « troubles de la
   conscience » du paragraphe `S1:5:1`. Le dossier sélectionne le simple libellé
   `S1:5:7` « Position latérale de sécurité », sans `S1:5:1`. Gemma transforme
   ce libellé en recommandation et Qwen l’accepte. L’interdiction de médicament
   est aussi omise. Cela rencontre le critère critique fixé pour une condition
   décisive perdue ; aucun dommage réel n’est allégué.
2. **Titres extraits faux** : quatre réponses Python attribuent au shell
   interactif des formats ajoutés au module `mimetypes`. Le HTML original les
   place sous `<h3>mimetypes</h3>`, alors que les sections figées `S1:19` et
   `S1:20` portent « Default interactive shell ». Transmettre ce titre au
   rédacteur propage une fausse attribution. Le corpus n’a pas été modifié
   après observation ; c’est une limite de l’extraction historique évaluée.
3. **Attributions et portée inversées** : `localStorage` devient accessible
   via `Window.sessionStorage` dans deux réponses ; `integrity_check` reçoit
   un avertissement de corruption qui concernait `schema_version` ; une
   réponse inverse la restriction `private` du contenu en restriction du
   cache. Des réponses confondent aussi verre/bac jaune et mots de passe/codes
   de récupération. Les coordonnées justificatives sont dans les notes privées.
4. **Négation inversée** : une réponse sur les sauvegardes inverse la phrase
   NCSC `S1:1:5` sur l’impossibilité d’accès sans identité de confiance. Ce cas,
   ajouté aux six précédents, explique les sept critères critiques.
5. **Couverture insuffisante malgré une prose fluide** : aucun cas de fraude
   après virement ne formule la demande de retour des fonds ; les six réponses
   sur `estimate()` ne nomment pas `persisted()` ; plusieurs relances ANSSI
   décrivent le guide au lieu de donner ses recommandations. Les notes Python
   omettent toutes les nouveautés de langage attendues.
6. **Résidus éditoriaux** : citations répétées `[S1] [S2] [S1]`, ponctuation
   isolée, paragraphes redondants, digressions Firefox/tablettes/bibliothèques.
   Le mot « service » de « service worker » provoque une rubrique artificielle
   de ressources. La compilation préserve la prose, y compris certains de ses
   défauts ; elle n’est pas un éditeur sémantique.

Une réserve du corpus SQLite est également conservée : l’introduction parle
d’un instantané au début, tandis que la section sur les écritures concurrentes
explique reprises et image cohérente à jour. Reprendre l’introduction n’est pas
une invention, mais ne répond pas complètement à la question sur la fin d’une
sauvegarde active. La revue ne transforme pas ce cas en contradiction inventée.

## Traces des corrections pendant la recette

Deux tentatives interrompues restent conservées, sans mélange de résultats :

- `unified-synthesis-20260905` : contexte réel Ollama à 4096 tokens découvert
  avant validation ; client corrigé à 32 768 tokens et test du corps de requête.
- `unified-synthesis-context32k-20260905` : un résultat de développement avant
  détection du mauvais rapprochement des identifiants de sources. Correction
  de l’instrumentation via URL, test original `S2` publié `S1`, puis nouvelle
  campagne finale. Aucun résultat de validation généré dans cette tentative.

Le routeur a ensuite été corrigé après la fin des générations et l’arrêt de la
revue locale : le libellé interne « Demande actuelle (prioritaire) » déclenchait
à tort le mot-clé d’actualité. Le classifieur ignore désormais ce préfixe, tout
en gardant les termes réellement demandés. Une explication stable suivie de
« En français » reste locale ; une vraie météo actuelle reste Web. Le test Hub
vérifie deux appels modèle et aucune recherche pour la relance stable.

L’archive `evaluated-source.zip` conserve les 28 sources évaluées. La seule
source TypeScript différente de cette archive est `routing.ts` : les 120 cas
forcent le mode Web, qui court-circuite ce routeur. Aucun prompt de génération,
passage, auditeur ou mécanisme de publication mesuré n’a été modifié depuis.
Le routage automatique corrigé est vérifié séparément par les tests.

## Livraison et suite recommandée

**Le déploiement serveur est suspendu.** La recette Windows et le redémarrage
du Hub n’ont pas été lancés, car la gate qualitative échoue. L’activation
antérieure du Chat reste une décision utilisateur distincte. Les résultats
n’autorisent ni une promesse de résumé sans hallucination ni une boucle
automatique d’optimisation sur la validation.

Attention à la distinction d’artefacts : `pnpm verify` reconstruit
`apps/web/dist`, que le Hub sert directement depuis le workspace. Ces fichiers
PWA peuvent donc être servis lors d’une visite ou d’une mise à jour du service
worker, même sans redémarrage serveur. Aucune recette réelle A17/iPhone n’en
est déduite.

Le prochain lot devrait traiter, dans cet ordre :

1. L’extraction structurelle des titres, noms de méthodes et listes ; garder
   chaque consigne avec sa condition et refuser un libellé isolé comme preuve.
2. La sélection de preuves couvrant les demandes précises, puis l’audit de la
   portée, des négations et des conditions, avec retour aux passages originaux.
3. La composition : supprimer les faux types de ressources, bornes éditoriales
   adaptées à la question, citations dédoublonnées et contrôle des omissions.
4. Une nouvelle évaluation figée après ces corrections, sans réécrire les
   annotations ni les résultats de cette validation pour obtenir un passage.

La dette C8 (réservation réelle du budget Tavily partagé) et C10 (identifiant
d’envoi conservé après résultat réseau incertain) reste hors de ce lot.
Le découpage des gros composants, la borne de durée totale d’un run et le
retrait des exports historiques restent également ouverts. Aucun commit,
déploiement serveur, achat ou mouvement Robot n’a été effectué pour ce lot.

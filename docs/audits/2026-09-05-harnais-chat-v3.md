# Harnais Chat : candidat local du 5 septembre 2026

Statut documentaire : archive.

> **Décision utilisateur du 5 septembre au soir :** campagne longue arrêtée.
> La reprise active simplifie le dossier transmis au rédacteur, conserve les
> originaux et autorise jusqu’à trois corrections contrôlées. Au plus cinq
> essais diagnostiques tracés remplacent la relance de qualification pour ce
> lot. Voir le [bilan de simplification](2026-09-05-simplification-harnais-chat.md).
> Les descriptions et commandes de campagnes ci-dessous sont historiques ;
> ne pas les relancer automatiquement. Candidat toujours non déployé.

Statut : **implémentation et qualification en cours, non déployées**.
Ce candidat succède au lot Chat livré avec Maison ; il ne change pas le fait
que cette livraison antérieure a eu lieu avec une gate qualitative refusée.

## Invariants et changements locaux

Maison et Chat conservent **le même ordonnanceur FIFO Ollama**, avec une seule
inférence active. Menus, Veille, classement et photo passent aussi par cet
ordonnanceur. Aucune file concurrente Maison n'a été ajoutée. Le budget Chat
de 300 secondes commence à l'acceptation du message, attente comprise ; un
ticket expiré est retiré et une annulation n'annule pas les autres usages.

Le pipeline `unified` local comporte les changements suivants :

- besoins demandés distincts des requêtes de recherche ; clarification avant
  recherche lorsqu'une ambiguïté utilisateur est identifiée ;
- extraction HTML commune runtime/banc : hiérarchie des titres, noms de
  méthodes, conditions de listes et en-têtes des tableaux ; empreinte de texte
  et signal de dépassement produits par l'extracteur ;
- dossier éphémère borné à 12 passages, 8 sources et 24 000 caractères ;
  fenêtres jusqu'à 8 000 caractères avec contexte voisin ; plafond par source
  adapté au nombre de documents disponibles ;
- préparation de faits candidats liés aux besoins et à des citations
  originales ; le code découpe les extraits et le modèle choisit leurs
  identifiants `P1.Q2` : il ne doit plus recopier les citations ;
- rédaction en prose, puis vérification indépendante des originaux, par lots
  bornés ; citations contrôlées par le code, avec seules équivalences
  typographiques d'apostrophes, guillemets et espaces ;
- une seule révision, obligatoirement auditée ; retrait par paragraphe pour
  éviter les clauses orphelines ; aucune réponse non auditée ou catalogue
  d'extraits présenté comme synthèse de secours ;
- 12 générations, 6 recherches Web et 16 lectures au maximum ; sortie Ollama
  tronquée refusée ; limite de contexte contrôlée de manière conservatrice
  avant l'appel ; annulation de l'attente du client Ollama ;
- profils explicites par rôle, avec possibilité de choisir séparément les
  modèles de préparation, planification, rédaction et vérification ;
- identifiant d'envoi conservé chiffré dans IndexedDB en cas de résultat réseau
  incertain, restauré après rechargement et réutilisé pour la confirmation ;
- réservations Tavily communes et persistantes pour Chat, Maison et Veille.
  Une réponse réseau incertaine reste comptée par prudence.

Le candidat ajoute SQLite **46** (plafond de générations et réservations Web).
La production décrite dans le document 27 demeure en **45**, Dexie **9**.
Les textes Web, prompts et citations intermédiaires ne sont pas persistés dans
la base applicative. Les traces explicites du banc sont privées sous
`D:\FridayData\evaluations\chat-harness-v3`.

`pnpm verify` construit désormais la PWA dans `.verification/web` et teste un
port distinct. Il ne reconstruit plus les fichiers `apps/web/dist` servis par
le Hub domestique pendant une simple vérification.

## Enseignements des essais réels

Ces essais utilisent les documents historiques ré-extraits avec le nouvel
extracteur. Ils sont **du développement**, jamais un nouveau corpus de
validation. Les anciennes annotations de paragraphes ne sont pas réutilisées
comme scores du nouvel extracteur.

Le premier criblage de huit modèles installés a révélé un rejet HTTP 400 par
Ollama du schéma JSON détaillé. Le schéma envoyé a été simplifié ; la validation
Zod reste stricte côté code. Les réponses invalides ne sont pas corrigées par
une nouvelle génération non bornée.

Après correction du transport, un criblage de quatre assertions artificielles
(support, négation inversée, attribution à un autre sujet, condition omise)
a réussi pour Gemma E2B, Gemma E4B et Ministral 8B à 8/16/32k. Ce petit test
ne suffit pas à qualifier un modèle. Les premiers rejets Qwen contenaient
notamment de simples différences d'apostrophe ; Granite a réellement fabriqué
une citation inversant la négation, rejetée par le contrôle exact.

Les essais complets montrent pourquoi une taille raisonnable de texte **ne
garantit pas un résumé sans hallucination** : un modèle peut citer le bon
texte tout en lui donnant un mauvais sens, conclure à une absence à partir
d'extraits incomplets, ou omettre un besoin. Un second modèle peut approuver
la même erreur. Le contrôle exact des citations est nécessaire mais ne prouve
pas à lui seul l'implication sémantique.

Artefacts intermédiaires, à conserver sans réécriture :

- `compact-screen-all/verification-screen.json` : criblage synthétique avant
  normalisation des apostrophes ;
- `development-smoke-1` : Qwen 9B préparation/audit, Gemma E4B rédaction,
  ancien planificateur et plafond de trois passages par source ;
- `development-smoke-2` : Gemma E4B pour les trois étapes, besoins corrigés,
  encore des erreurs de structure et des omissions ;
- `development-smoke-3` : Qwen 9B préparation/audit, faits sans preuve retirés
  individuellement, prompts allégés, sélection élargie ;
- `verification-final.log` : contrôle technique courant, dont le résultat
  final doit être lu avant toute affirmation de réussite.

## Portes encore ouvertes

### Complément du 5 septembre, préparation de la validation inédite

Le protocole `grounded-synthesis-v2-excerpt-ids` fait choisir au modèle des
identifiants d'extraits ; le code retrouve leur texte original. Le modèle n'a
plus à recopier les citations, ce qui élimine cette cause précise de rejet et
de fabrication. Cela ne garantit toujours pas une interprétation correcte.
L'extracteur `structured-document-v2-definition-aliases` conserve tous les
alias d'une définition, notamment les options positives et négatives de Git.

Le criblage synthétique `excerpt-id-screen` passe à 8/16/32k avec Gemma E2B,
Gemma E4B, Qwen 4B, Qwen 9B et Ministral 8B. Ministral 3B, Granite 3B et
LFM 8B échouent dès 8k. Il ne s'agit pas d'une qualification de rédaction.
Sur l'ancien cas AVC, Qwen 9B préparation/audit et Gemma E4B rédaction ont
produit une réponse construite en 181 secondes, dont les gestes et conditions
ont été relus contre les originaux. Les autres cas restent inégaux. Qwen 4B
avec les paramètres non-thinking recommandés (.7/.8/20, présence 1.5) améliore
deux essais par rapport à sa température nulle, sans établir sa supériorité.

Le corpus privé `chat-harness-v3/validation-v3` contient désormais 20 cas
inédits : 18 répondables, une clarification et une abstention attendues. Les
paragraphes de référence sont annotés avant toute génération du candidat.
Le chargement v3 vérifie l'identité de l'extraction avec le runtime. La
campagne refuse la réutilisation des questions, URL ou snapshots du corpus v2.

La commande `review:codex` contrôle les 120 notes de Codex, l'empreinte de
chaque réponse, le corpus et le code avant de produire `codex-gate.json`.
Les notes doivent provenir d'une lecture effective ; aucun juge local n'est
appelé par défaut. Les profils effectifs par rôle sont inscrits au manifeste.

Le rédacteur reçoit aussi des alias internes `E1` pour éviter de répéter les
extraits. Le code convertit ces alias connus en citations de passage avant
l'audit, sans modifier les affirmations. Un alias inconnu reste une erreur.
Ce correctif répond au rejet constaté sur l'ancien cas IndexedDB où le modèle
avait produit `[P2, E1]` malgré le format demandé.

`pnpm verify` réussi pour la version intermédiaire le 5 septembre vers 20 h 42 : 447 tests TypeScript,
27 tests Python Robot et 29 tests navigateur. Preuve privée :
`chat-harness-v3/verification-candidate-v3.log`, sortie finale 0. Les assets
du test sont isolés dans `.verification/web` et ne remplacent pas ceux servis
par le Hub de production. Aucun redémarrage ni déploiement de ce candidat.

La qualification réelle reste ouverte. Le profil candidat figé pour cette
campagne emploie Gemma E4B pour rédiger et Qwen 9B pour planifier, préparer et
vérifier, en contexte 32k. Ce choix reste à qualifier, sans promesse de qualité.
Il faut produire les 120 réponses lexical/hybride sur les 20 nouveaux cas avec
trois graines et les faire revoir par **Codex**, comme demandé par l'utilisateur,
sans relancer le juge local 8B.

Première observation de qualification (campagne encore incomplète) :
`fresh-python313`, graine 17, lexical, publie une synthèse après 253 733 ms.
La revue effective Codex rejette l'attribution au shell de fonctions liées au
GIL et l'omission du prérequis de build free-threaded. Le vérificateur local
avait pourtant indiqué trois besoins couverts sur trois. Le mode lexical
échoue donc déjà au seuil de zéro erreur importante ; ce constat ne doit
pas être présenté comme le bilan complet des 120 réponses. Les références
du shell figuraient partiellement dans les passages sélectionnés : cette
erreur ne se réduit pas à une absence de sources.

À la quatrième réponse relue, le mode hybride présente `PYTHON_JIT=1` comme
une activation générale sans son prérequis de compilation `yes-off`. Les deux
modes ont donc échoué au seuil de zéro erreur importante. La campagne a été
interrompue ; quatre réponses sont produites et relues, **pas 120**. Les
artefacts `codex-review.json` et `early-rejection.json` conservent cette revue
et ses empreintes. Le premier cas Python 3.13 est consommé pour qualification ;
les 19 autres cas n'ont pas été générés. Aucune gate complète n'est fabriquée.

La correction suivante `grounded-synthesis-v3-focused-needs` prépare chaque
besoin séparément depuis au plus quatre passages ciblés et 12 000 caractères.
Les extraits conservent les paragraphes, donc les phrases de prérequis avec
leurs consignes. Le rédacteur ne reçoit plus les limitations libres du
préparateur ; les originaux portent les conditions. L'audit traite au plus
six unités par appel et dix-huit unités au total, avec réservation des appels
nécessaires dans la limite globale de douze. Le préparateur ne génère plus
les champs libres de besoins manquants ou de clarification : le code déduit
les besoins manquants des faits effectivement retenus. Les clarifications
utilisateur restent prises en charge avant la recherche.

La reconstruction du texte retire aussi les virgules et points-virgules
séparant uniquement deux citations ; elle conserve la ponctuation entre
propositions. Les `,.` observés provenaient de cette reconstruction, pas
systématiquement de la rédaction du modèle.

Le contrôle complet suivant passe vers 21 h 20 : **450 tests TypeScript,
27 tests Robot et 29 tests navigateur**, soit 506 tests. Preuve privée :
`chat-harness-v3/verification-focused-needs.log`, sortie 0. Sur les anciens cas,
`development-focused-needs` reste inégal en lexical (abstention Node,
confusion concurrence/asynchronisme sur IndexedDB), tandis que
`development-focused-hybrid` restitue correctement l'asynchronisme dans
IndexedDB. Le cas AVC ciblé conserve les consignes essentielles en 86 secondes.
Ces observations de développement ne remplacent pas la qualification.

La campagne `qualification-focused-2026-09-05` est lancée dans
`chat-harness-v3/validation-v3-focused`. Le cas consommé Python 3.13 est
remplacé par Go 1.24, dont les références sont annotées avant génération.
Les 19 autres cas n'avaient reçu aucune réponse du candidat. Le fichier
`qualification-lineage.json` conserve cette filiation. Le code, le corpus et
le profil restent figés pendant cette nouvelle campagne ; aucun succès
qualitatif ni déploiement ne découle de son lancement.

Gates prévues : zéro erreur factuelle importante, couverture d'au moins 80 %,
utilité et rédaction au moins 4/5 dans 80 % des réponses, au moins 90 % de
synthèses construites sur les cas répondables. Clarifications et abstentions
sont comptées séparément. L'hybride exige un gain de rappel d'au moins cinq
points sans perte factuelle et un ratio de latence p95 au plus égal à 1,25.

Les scripts de développement vérifient en lecture seule les jobs Chat, Menus,
classement et Veille avant chaque génération. Cette priorité de courtoisie
entre processus n'est pas un verrou atomique partagé avec le Hub ; elle ne
permet pas de prétendre à une absence de concurrence avec un nouvel appel
arrivant juste après le contrôle, ni avec une transcription photo en mémoire.

Les réservations Tavily protègent les appels Friday. Les appels d'autres
applications utilisant le même compte ne deviennent connus qu'au retour du
compteur distant. Le contrôle de contexte en octets est volontairement
conservateur ; des entrées qui tiendraient après tokenisation peuvent être
refusées plutôt que tronquées silencieusement.

Aucun redémarrage de production ni déploiement de ce candidat ne doit être
déduit des tests locaux. Le lanceur de recette avec redémarrage attend le
franchissement des gates du candidat.

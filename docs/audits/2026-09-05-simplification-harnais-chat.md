# Simplification du harnais Chat — 5 septembre 2026

Statut : **simplification implémentée et vérifiée automatiquement ; non déployée**.

## Décision utilisateur et périmètre

L’utilisateur arrête la campagne longue et la recherche de configurations.
Il demande une chaîne plus simple, le suivi des informations à chaque étape
et au plus cinq essais réels bien choisis. Il autorise ensuite jusqu’à trois
corrections, soit quatre rédactions au maximum. Cette décision remplace
l’obligation de relancer 120 générations pour ce lot ; elle ne transforme pas
les précédents résultats refusés en réussites.

La campagne `qualification-focused-2026-09-05` est arrêtée après **12 réponses
produites, 11 effectivement relues**. `user-stop.json` conserve l’arrêt et
l’empreinte dans son dossier privé. Aucun juge local supplémentaire n’est lancé.
Les mesures antérieures restent disponibles comme diagnostics.

## Chaîne simplifiée

1. Résoudre la demande et les besoins ; rechercher et sélectionner les originaux
   avec le mécanisme partagé existant.
2. Construire le dossier par code : passages originaux complets, titres, sources
   et repères de lecture par besoin. Aucun appel modèle de préparation,
   aucune paraphrase intermédiaire et aucune relance de recherche déclenchée
   par l’échec de cette paraphrase.
3. Gemma E4B rédige directement une synthèse à partir de ce dossier unique.
   Les repères de recherche ne deviennent ni des faits validés ni un plan
   éditorial obligatoire.
4. Qwen 9B compare les affirmations aux originaux. Les petits lots de contrôle
   disposent aussi de la réponse complète pour interpréter conditions et
   pronoms ; celle-ci ne constitue jamais une preuve.
5. Les rejets transmettent leur motif précis et leurs références au rédacteur.
   Au plus trois corrections, toutes contrôlées ; arrêt sur succès, répétition
   du brouillon ou épuisement du budget. Une panne ne publie pas de texte
   non audité et une contradiction connue ne peut pas être réintroduite.

La préparation modèle par besoin, son schéma de faits, ses alias de citations
E et son deuxième tri documentaire ont été supprimés. Le dossier transmis est
observable directement. Les prompts ont été raccourcis autour de contrôles de
sens généraux : sujet, relation, conditions, négation, quantités et provenance.
Aucune règle liée à Node, Go, aux cookies ou aux cas du banc n’a été ajoutée.

Les modèles et paramètres existants restent inchangés. Le plafond de 12 appels
et le délai de 300 secondes incluent les corrections ; trois corrections sont
une possibilité, pas une promesse indépendante du temps disponible. La place
nécessaire à un audit est réservée avant une rédaction supplémentaire.
Maison, Chat, Menus, Veille, classement et photo conservent leur ordonnanceur
FIFO commun dans le Hub. Cache, idempotence, budgets Web et migration 46 du
lot candidat précédent sont conservés ; la production reste SQLite 45.

## Cinq essais et suivi des données

Un seul profil, une seule graine et la sélection hybride existante :

| Cas                   | Ce que l’on suit                                                                |
| --------------------- | ------------------------------------------------------------------------------- |
| Node 22.12            | Conservation des conditions de version et du top-level await                    |
| Go 1.24               | Couverture d’une demande à plusieurs volets sans perdre les limites du gain CPU |
| Cookies, relance      | Correction du contexte antérieur faux sur HttpOnly                              |
| Perte de connaissance | Conservation des conditions dans une procédure                                  |
| Tarif absent          | Absence de prix inventé lorsque le dossier ne contient pas l’information        |

Ce sont des relectures diagnostiques de sources figées, pas une qualification
indépendante, une comparaison de modèles ou une mesure de la recherche Web live.
Les sources et résultats restent sous
`D:\FridayData\evaluations\chat-harness-v3\direct-sources-five`.

Chaque fichier `.trace.jsonl` est écrit au fil de l’exécution : étapes,
requêtes de recherche, lectures originales, dossier sélectionné, dossier du
rédacteur, requêtes et sorties modèle, audits et publication. Les fichiers
finaux conservent aussi sources, paramètres, empreinte du code et durée.
Le script refuse plus de cinq cas et refuse d’écraser un manifeste existant.
Les traces de contenu sont propres à ce banc privé ; elles ne sont pas ajoutées
au stockage des conversations de production.

Le banc temporaire attend l’absence de jobs IA du foyer avant chaque inférence.
Cette vérification en lecture seule n’est pas une réservation atomique de la
file du Hub ; elle ne prouve pas l’exclusion entre deux processus. La file
commune des usages de production reste celle du Hub.

## Corrections issues du suivi, sans nouvelles configurations

- Les références de paragraphe connues `[P1.Q1]` sont ramenées à `[P1]` avant
  l’audit. Le texte ne change pas et une référence inconnue reste refusée.
- La longueur d’un motif d’audit ne fait plus échouer des verdicts exploitables :
  le diagnostic est borné à 400 caractères après lecture, sans changer le verdict.
- L’ancienne liste noire « cookie/navigation/confidentialité… » a été retirée.
  Elle rejetait une page MDN pertinente à cause de son sujet.
- La couverture des besoins peut être répartie entre plusieurs unités soutenues.
  Le co-étiquetage d’un besoin transversal avec un besoin principal dans la même
  phrase n’est plus exigé. Cela évite de réécrire un texte déjà composé correctement.
- L’extracteur partagé sélectionne le contenu principal (`main`, `article`, rôle
  ARIA ou `#main`), écarte menus et contenu masqué, et conserve les encarts de
  texte informatifs. Il n’élimine pas des sujets au moyen de mots-clés.
- La sélection liée à la question conserve chaque section courte entière jusqu’à
  4 000 caractères ; les sections longues gardent des fenêtres voisines bornées.
  Titres, tableaux, définitions, conditions et coordonnées d’origine sont conservés.

## Résultats des cinq cas

| Cas                   | Observation réelle                                                                                   | Conséquence                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Node                  | Références valides puis motif long bloquants ; verdict discutable de l’auditeur                      | Normalisation des références et borne non bloquante du diagnostic corrigées ; aucune publication qualifiée dans cet essai |
| Go                    | Les trois volets et la limite des gains CPU sont présents ; quatre appels logiques                   | Synthèse construite, avec quelques précisions rédactionnelles perfectibles                                                |
| Cookies               | Page récupérée après retrait du filtre ; faux contexte corrigé ; réponse partielle après huit appels | Contrainte artificielle de composition retirée ; l’exception localhost reste omise dans le texte effectivement produit    |
| Perte de connaissance | Texte rédigé accepté par l’auditeur, mais incomplet sur des conditions et étapes                     | Échec qualitatif conservé au bilan ; le module rétablit les sections complètes dans le dossier                            |
| Prix absent           | Aucun prix inventé ; abstention après six appels                                                     | Issue honnête, mais contrôles trop hésitants et message final générique                                                   |

Les cinq cas, leurs demandes, sources, dossiers, rédactions et verdicts ont été
relus par Codex. Les traces sont dans `direct-sources-five`,
`direct-sources-five-resumed` et `direct-sources-five-repairs` sous le même
répertoire privé. Les reprises concernent les mêmes cas après défauts techniques,
pas une sixième question ou un autre modèle. Le rejeu ne réutilise une génération
que si sa requête est identique ; des passages réordonnés interdisent la réutilisation.
La filiation et les empreintes sont conservées dans les manifestes et
`direct-sources-review.json`. Ces données ne constituent pas cinq succès ni une
mesure comparative de latence : certaines générations sont reprises de traces.

Les derniers changements d’extraction, de borne du motif et de couverture sont
postérieurs à ces générations. Ils sont vérifiés automatiquement, sans nouvelle
campagne Ollama. `extraction-check-five.json` rejoue uniquement le HTML et la
sélection lexicale sur les mêmes cinq pages, sans modèle : la sélection contient
maintenant la PLS, la réserve liée au traumatisme et la respiration irrégulière
sur la page concernée ; les menus annexes Git disparaissent. Cela prouve la
présence des informations, pas que le modèle les reformulera toujours correctement.

## Vérification et état de livraison

### Assainissement ciblé suivant

À la demande de l’utilisateur, trois corrections supplémentaires restent dans
le périmètre de l’orchestration :

- conserver la réponse auditée qui couvre le plus de besoins, puis le plus
  d’unités retenues et, à égalité, le moins de rejets ; une nouvelle contradiction
  continue d’invalider une ancienne réponse concernée ;
- inclure les citations normalisées dans la détection des brouillons répétés,
  pour permettre une réparation des références sans réécriture du texte ;
- émettre une observation `failure` avec étape, numéro de tentative et code
  technique borné. Sans réponse acceptée, ce code devient le `fallbackCode` ;
  avec une réponse déjà acceptée, celle-ci reste publiable en partiel et le
  diagnostic reste disponible dans les traces de l’observateur. Aucun contenu
  brut d’exception n’est recopié dans ce diagnostic.

Ces critères comparent des résultats d’audit ; ils ne mesurent pas la qualité
sémantique ni la richesse réelle de la prose. Aucun changement de modèle,
d’extraction, de budget ou de file Ollama n’accompagne ces corrections.

`pnpm verify` passe après ces trois corrections : **525 tests**, dont 184 Hub
(neuf nouveaux scénarios ciblés), avec format, lint, typage, builds et 29
scénarios navigateur. Preuve :
`D:\FridayData\evaluations\chat-harness-v3\verification-three-corrections.log`.
Les deux fichiers de tests Chat concernés passent 44 tests. Le candidat reste
non déployé ; aucune nouvelle campagne de modèles ni recette physique.

### Vérification précédente de la simplification

`pnpm verify` passe sur le code final : **516 tests** (27 Robot, 25 contrats,
40 cœur Assistant, 27 domaine, 175 Hub, 133 PWA, 60 banc Chat et 29 Playwright),
avec format, lint, typage et builds. Le journal est
`D:\FridayData\evaluations\chat-harness-v3\verification-simplification-complete.log`.
Les vérifications Web utilisent `.verification/web` ; les artefacts servis
aux appareils et le Hub de production n’ont pas été redémarrés.
`git diff --check` ne signale pas d’erreur de whitespace. Aucune recette physique
A17/iPhone/Robot n’est déduite de ces contrôles.
Aucune relance des 120 réponses, aucun changement de modèle, aucun déploiement.
Le runtime candidat reste à distinguer de la version servie aux appareils.

Le harnais est plus court et les pertes d’information sont désormais traçables.
Il reste une limite établie par les essais : l’auditeur peut manquer une exception
ou rejeter à tort une reformulation. Les tests techniques ne ferment pas cette
limite et les résultats médicaux observés ne permettent pas de déclarer la
version prête à déployer.

## Déploiement autorisé suivant — 5 septembre, 22 h 55

L’utilisateur demande explicitement « déploies le » après les trois corrections.
Le lanceur `Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck
-RestartExisting -KeepHubRunning` reconstruit les artefacts et redémarre le Hub
avec succès (code 0). Health checks local et LAN : `status=ok`, `database=ok`.
La base canonique est en SQLite 46, `integrity_check=ok`, sans violation de clé
étrangère. Le HTML servi sur l’origine A17 correspond exactement au nouveau build.

Preuves privées : `D:\FridayData\evaluations\chat-harness-v3\deployment-three-corrections.log`
et `deployment-three-corrections.json` dans le même dossier. Sauvegarde SQLite
online préalable en version 45 :
`D:\FridayData\backups\chat-harness-20260905-225338\before.sqlite` ; copie de
la PWA précédente dans `web-before`. Le binaire Hub précédent n’est pas conservé
à l’identique : il avait déjà été reconstruit pendant les vérifications.
La sauvegarde de la base est contrôlée intègre ; aucune restauration complète
n’a été exécutée pour ce déploiement. Ne pas écraser les écritures postérieures
avec cette sauvegarde lors d’un retour arrière.

Les 525 tests du lot précèdent le déploiement ; aucun code runtime n’a été
modifié ensuite. La livraison ne constitue pas une nouvelle validation
qualitative des modèles ni une recette physique A17/iPhone/Robot.

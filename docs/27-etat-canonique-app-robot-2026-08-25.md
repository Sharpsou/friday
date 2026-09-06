# État canonique Friday — application et Robot

Statut documentaire : actif. Révision : 6 septembre 2026.

Ce document décrit l'état courant. Les [rapports datés](audits/) portent les mesures,
empreintes et circonstances des livraisons ; les [anciens états](archives/etats-techniques/27-etat-canonique-app-robot-2026-08-25.md)
restent consultables sans piloter la reprise.

## Code, livraison et preuves

| Niveau                          | Référence et limite                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Git de référence                | `894a50d` pour le runtime ; la refonte documentaire est dans le commit portant le rapport de publication                         |
| Dernier runtime attesté         | 6 septembre 2026, 16 h 30 Paris, origine A17 `https://192.168.1.14:8443`                                                         |
| Stockage                        | SQLite 47 ; Dexie 9                                                                                                              |
| Vérification de cette livraison | Suite globale et architecture ; compatibilité croisée attestée au lot de 12 h 04                                                 |
| Déploiement                     | Santé HTTPS locale/LAN, intégrité SQLite, clés étrangères et empreintes des fichiers servis contrôlées au moment de la livraison |
| Téléphones                      | Pas de nouvelle recette A17/iPhone pour ce lot ni de contrôle des PWA déjà ouvertes                                              |
| Robot                           | Correctif Hub testé en simulation ; dernier GET Pi indisponible à 12 h 04 ; aucun nouveau contrôle Pi, Python inchangé           |
| Chat                            | Activé sur décision utilisateur ; qualification sémantique toujours refusée                                                      |

Preuves : [première modularisation](audits/2026-09-06-implementation-qualite-et-modularisation.md),
[déploiement initial](audits/2026-09-06-deploiement-modularisation.md) et
[complément livré](audits/2026-09-06-complement-cinq-modules.md).
La [republication autorisée de 16 h 30](audits/2026-09-06-refonte-documentaire.md#publication-autorisée) conserve le même code applicatif et apporte les nouveaux contrôles serveur.
Ces constats datés ne constituent pas un health check permanent.

## Application et données

Monorepo pnpm TypeScript : React/Vite/Workbox, Fastify sur Windows, SQLite canonique,
Dexie chiffré, outbox et contrats Zod. Le Python Robot est séparé sur le Pi.
Navigation : Aujourd'hui, Agenda, Maison, Budget, Chat, Veille et Robot.

| Domaine   | Comportement actuel                                                                                        | Prochaine preuve ou limite                                         |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Comptes   | Foyer fermé à deux adultes, appareils liés, sessions révocables, contrôles d'origine                       | Une révocation serveur n'efface pas à distance un cache offline    |
| Agenda    | Tâches, récurrences, responsables et menus partagés                                                        | Aucun calendrier Google synchronisé                                |
| Maison    | Courses, catalogue versionné, préparations, repas, restes, réserve, bilans et commandes composites offline | Recette réelle des deux téléphones ouverte                         |
| Budget    | Réel, récurrences, enveloppes, provisions, réserve financière et clôture ; calculs déterministes           | Porte BitLocker/ACL/sauvegarde avant données réelles               |
| Chat      | Conversations privées et cache chiffré ; envoi idempotent en ligne, suivi et annulation ; archive séparée  | Qualité encore insuffisante, aucune outbox d'envoi Chat            |
| Veille    | Dossiers privés, RSS/Atom, découverte Tavily bornée, synthèses, concepts et reprise des échéances          | Collecte et génération nécessitent Hub/réseau/modèle selon l'étape |
| IA Maison | Brouillons privés à corriger et enregistrer explicitement                                                  | Aucun stock ou catalogue modifié par l'IA seule                    |

Les générations et embeddings de Chat, Menus, Veille, classement et photo partagent
un ordonnanceur FIFO ; les appels Web utilisent un budget commun. Les mutations
Maison et Budget n'attendent pas Ollama. Maison conserve commandes et bilans via
une outbox chiffrée, avec atomicité des objets, courses et curseur.

Runbooks : [Maison](runbooks/maison-menus-reserve.md), [Budget](runbooks/reprise-budget.md),
[Chat](runbooks/assistant-gemma.md), [Veille](runbooks/veille-rss.md),
[classement](runbooks/classement-courses.md).

## Chat et mémoire de recherche

Modes visibles : Friday automatique, Local et Recherche Web. Pipeline configuré
`unified` ; `axes` reste le rollback et `legacy` un chemin technique distinct.
Le Hub et le banc partagent le cœur ; le Hub n'importe pas le banc.

SQLite 47 conserve `chat_research_memory`, privée au profil et à la conversation,
bornée à huit sources, douze passages originaux et 24 000 caractères. Sa suppression
suit le message et la conversation. Une réponse antérieure est un contexte non fiable,
pas une preuve. Les embeddings restent éphémères ; aucun index RAG n'est ajouté.

Le pipeline unifié borne recherches, lectures, appels et durée ; le [document 32](32-fondation-reconstruction-chat.md)
et le runbook exposent les limites actuelles. Les anciennes affirmations « aucun passage
persisté » antérieures à la migration 47 sont historiques.
La livraison autorisée des correctifs ne transforme pas la gate refusée en succès.
Les campagnes longues restent arrêtées ; toute nouvelle campagne nécessite une reprise explicite.

## Modularisation livrée

La composition PWA, les routes HTTP, l'authentification, les migrations, contrats,
repositories, pipelines Chat, Veille, topologie et autonomie possèdent leurs modules.
Les façades et exports publics conservés assurent la compatibilité.
Les cinq dernières exceptions de taille ont été traitées ; les anciennes listes de
gros fichiers ne sont plus une liste de travaux à effectuer.

Trois corrections accompagnent le premier lot : coffre initialisé atomiquement,
quota Menus calculé sur tous les jobs actifs et sync des domaines compatibles après
retour à un ancien Hub. Le complément ajoute la protection des continuations Robot
tardives après arrêt/annulation. Distinguer ces changements comportementaux du découpage.

La [carte technique](guides/architecture-developpement.md) indique où intervenir.
`pnpm architecture` contrôle les imports et cycles d'exécution ; `pnpm verify`
construit la PWA dans `.verification/web`. Budget est chargé à la demande et précaché.
Une taille de fichier ou de bundle n'est pas une mesure de fluidité sur téléphone.

## Robot AlphaBot2

Prototype réel : caméra CSI, IR avant, capteurs de ligne et pan/tilt PCA9685 ; aucun
encodeur, IMU, LiDAR ou pince. Le servo pan présente un tremblement intermittent.
La cible future de l'ADR-014 ne décrit pas ce matériel.

Manuel, Autonome, repères visuels, panoramas corporels, habitudes SARSA(λ), Va là,
Récup et manette existent. Plus de bouton Carto, carte métrique, pose x/y ou Dyna-Q.
Le Hub assure vision et navigation ; le Pi conserve commandes expirables, switches
et watchdog. Aucun run ne reprend après redémarrage ni via une outbox physique.

Perception visible et consentie ; pas de reconnaissance faciale ni de mémoire durable
des personnes. La veille réseau est installée mais son cycle physique veille/réveil
reste à valider. Les epochs d'annulation ne constituent pas une recette matérielle.
Tous les détails et conditions d'essai sont dans le [runbook Robot](runbooks/robot-alphabot2.md)
et la [décision d'autonomie](30-decision-autonomie-topologique-visuelle.md).

## Exploitation, sauvegardes et suites

Données du foyer hors Git sous `D:\FridayData`. Dernière sauvegarde pré-déploiement
documentée : `D:\FridayData\backups\maison-migration-uOy4w3\before.sqlite`, avec restauration de contrôle
`restored.sqlite` et intégrité 47 → 47. Artefacts précédents sous
`D:\FridayData\audits\docs-publication-20260906-162141` ; suivre le [rapport de publication](audits/2026-09-06-refonte-documentaire.md#publication-autorisée).
Le code applicatif est inchangé par cette republication. Conserver base courante,
secret et configuration lors d'un rollback logiciel ; ne pas écraser les écritures récentes.
Les limites du retour à un code antérieur au correctif Robot restent dans le
[rapport des cinq modules](audits/2026-09-06-complement-cinq-modules.md).

Les sauvegardes précédentes restent dans les rapports et archives, jamais dans Git.
Ces snapshots ne sont pas la [sauvegarde portable chiffrée](runbooks/sauvegarde-restauration.md),
encore à construire et prouver.

Prochaines décisions : lot App choisi par l'utilisateur, recette Maison A17/iPhone,
recettes physiques Robot et éventuelle reprise qualitative Chat. Calendar reste non
implanté ; Tailscale, purge avancée, Budget réel et achats conservent leurs portes.
Les 7/14 jours d'observation ne sont pas du développement. La publication documentaire
et la republication autorisée du service ne clôturent aucune de ces validations.

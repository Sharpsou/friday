# Friday — reprise rapide

Date : 6 septembre 2026. Point d'entrée courant ; les rapports datés conservent
les preuves historiques de chaque livraison.

## État courant

Dernière livraison : **6 septembre 2026 à 12 h 04 (Paris)** sur
`https://192.168.1.14:8443`, **SQLite 47 / Dexie 9**. Les cinq derniers gros
fichiers sont découpés et le complément est déployé sur demande utilisateur.
`pnpm verify` passe avec **557 tests**, format, lint, typage, architecture et
builds. Santé locale/LAN, intégrité SQLite et empreintes des fichiers servis
sont vérifiées. Voir le [bilan du complément](audits/2026-09-06-complement-cinq-modules.md)
et le [plan exécuté](audits/2026-09-06-plan-decoupage-cinq-modules.md).

Un correctif distinct empêche les continuations Robot tardives après arrêt ou
annulation, y compris lors d'un panorama. Les preuves sont simulées ; aucune
recette physique n'a été effectuée et le Pi n'était pas joignable lors du GET
d'état. Son runtime Python est inchangé. Les recettes téléphones restent
ouvertes. La gate qualitative Chat reste refusée ; aucun prompt, modèle,
numéro de migration ou format chiffré n'est changé. Les mentions historiques
plus bas décrivent leurs dates respectives.

La PWA propose Aujourd'hui, Agenda, Maison (Courses, Menus, Réserve), Budget,
Chat, Veille et Robot. Maison et Budget restent partagés et offline-first ;
Chat, Veille et brouillons IA sont privés par profil. SQLite est canonique,
Dexie est chiffré et les écritures passent par l'outbox.

Le Chat v2 reste activé par décision utilisateur. Pipeline actif `unified`,
retour possible `axes` ; l'ancienne API Assistant est une archive en lecture
seule. La mémoire de recherche est privée par conversation ; une ancienne
réponse apporte du contexte, pas une preuve. Les générations et embeddings
Ollama passent par l'ordonnanceur commun aux cinq usages.

**La gate qualitative Chat reste refusée.** La campagne longue a été arrêtée
le 5 septembre ; aucune commande de campagne historique ne doit être relancée
automatiquement. Lire [32](32-fondation-reconstruction-chat.md), le
[bilan de simplification](audits/2026-09-05-simplification-harnais-chat.md) et le
[runbook Chat](runbooks/assistant-gemma.md).

## Reprise et limites

1. Lire `AGENTS.md`, ce handoff, le document 27, les décisions 09 et la feuille
   de route 10, puis le runbook du domaine.
2. Inspecter le Git existant et préserver tous les changements locaux. Le
   commit seul ne représente pas le code livré ni le travail du 6 septembre.
3. `pnpm verify` impose `.verification/web` pour le build et le serveur E2E.
   Le runbook [développement](runbooks/development.md) donne l'environnement
   isolé et les contrôles d'architecture.
4. La recette réelle A17/iPhone de Maison et la recette physique veille/réveil
   Robot restent ouvertes. Les tests simulés ne les remplacent pas.

Données et secrets restent hors Git sous `D:\FridayData`. Ne jamais modifier
`D:\prog\Home_mind` ; `jarvis`, `budget` et `modulo` restent en lecture seule.
Origine stable : `https://192.168.1.14:8443`.

Google Calendar n'est pas implanté. Tailscale, Budget réel, achats et actions
physiques restent derrière leurs décisions documentées. Le Chat ne possède
aucune mutation métier ni commande d'actionneur. Pour Robot, lire d'abord le
[runbook AlphaBot2](runbooks/robot-alphabot2.md) et observer sans mouvement.

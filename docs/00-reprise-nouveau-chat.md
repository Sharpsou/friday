# Friday — reprise rapide

Date : 3 septembre 2026
Statut : **point d'entrée canonique court**

## Décision immédiate sur le Chat

Le moteur Chat précédent reste retiré. Son remplaçant v2 est activé avec
`FRIDAY_CHAT_ENABLED=true` : moteur partagé, sélection éphémère BM25 + Qwen
Embedding, plugin `/api/chat`, SQLite 44 et cache Dexie 8. La gate qualitative
reste ouverte malgré cette activation explicite. La PWA expose Friday
(automatique), Local et Recherche Web approfondie, sans ancien pipeline.

Pour reconstruire le Chat, lire intégralement
[32 — Fondation de la reconstruction du Chat](32-fondation-reconstruction-chat.md).
Ce document synthétise les essais, l'architecture implantée et la gate. Le
pipeline actif construit désormais un dossier documentaire unifié : les thèmes
servent seulement à diversifier la recherche. `FRIDAY_CHAT_PIPELINE=axes`
permet un retour immédiat au candidat précédent.

## Ordre de lecture

1. `AGENTS.md` — règles du workspace ;
2. ce handoff ;
3. `docs/32-fondation-reconstruction-chat.md` pour le Chat ;
4. `docs/27-etat-canonique-app-robot-2026-08-25.md` pour l'état global ;
5. `docs/09-decision-finale-pwa-mvp.md` et
   `docs/10-feuille-de-route-technique-implementation.md` ;
6. le runbook du domaine modifié.

## Workspace à préserver

- dépôt existant `D:\prog\friday`, branche `main` ;
- données et évaluations réelles hors Git sous `D:\FridayData` ;
- origine A17 `https://192.168.1.14:8443` ;
- contrôle global `pnpm verify` ;
- ne jamais modifier `D:\prog\Home_mind` ; `jarvis`, `budget` et `modulo`
  restent en lecture seule ;
- préserver le worktree sale et ne jamais réinitialiser les changements
  existants.

## État condensé

La PWA comporte Aujourd'hui, Agenda, Courses, Budget, Chat, Veille et Robot.
Maison reste offline-first avec SQLite canonique, Dexie chiffré et outbox. Le
lot candidat migre SQLite vers 44 et la PWA cible Dexie 8 ; le Chat est
activé, sans que cela ferme sa gate qualitative.

- Agenda, Courses et Budget sont partagés ; Chat et Veille sont privés ;
- le nouveau Chat est activé sur décision utilisateur, mais sa gate qualitative
  reste ouverte ; l'archive est conservée séparément ;
- Veille possède son propre client Tavily et son propre moteur Qwen ; elle ne
  dépend plus de l'ancien moteur Chat ;
- le Chat n'a aucune mutation métier ou commande Robot ;
- Google Calendar n'est pas implanté ; Tailscale et les données Budget réelles
  restent derrière leurs portes documentées ;
- l'état Robot détaillé et ses limites matérielles restent dans le document 27
  et le runbook AlphaBot2.

Après toute évolution runtime : exécuter `pnpm verify`, puis le runbook de
déploiement Friday. Une validation automatisée ne prouve jamais à elle seule le
comportement réel A17, iPhone ou Robot.

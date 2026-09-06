# Friday — reprise rapide

Statut documentaire : actif. Révision : 6 septembre 2026.

## Point de départ

Référence de la refonte documentaire : `894a50d`, sur `main`, dépôt propre et
aligné sur `origin/main` lors de l'ouverture du lot. Réinspecter `git status -sb`
et `git log -5 --oneline` à chaque reprise ; préserver les changements apparus depuis.
Les rapports plus anciens décrivant un workspace non commité restent des preuves datées.

La dernière livraison runtime attestée est celle du **6 septembre à 16 h 30**,
sur `https://192.168.1.14:8443` : **SQLite 47 / Dexie 9**. Maison comprend Courses,
Menus et Réserve. Le Chat et les deux lots de modularisation sont livrés.
Voir l'[état canonique](27-etat-canonique-app-robot-2026-08-25.md) et le
[rapport de republication](audits/2026-09-06-refonte-documentaire.md#publication-autorisée).

Le Chat est activé sur décision utilisateur, pipeline `unified`, rollback `axes`.
Sa **gate qualitative reste refusée** et la campagne longue a été arrêtée.
Ne pas relancer une commande de campagne historique automatiquement.
La recette Maison A17/iPhone et les recettes Robot restent ouvertes ; la livraison
serveur ne prouve pas la mise à jour des téléphones ni le comportement physique.

## Ordre de reprise

1. [AGENTS](../AGENTS.md), puis ce handoff.
2. [27 — état courant](27-etat-canonique-app-robot-2026-08-25.md).
3. [09 — décisions produit](09-decision-finale-pwa-mvp.md).
4. [10 — méthode et gates](10-feuille-de-route-technique-implementation.md).
5. Le runbook du domaine depuis l'[index](README.md) ; pour Chat, lire ensuite [32](32-fondation-reconstruction-chat.md).

Pour trouver le code après découpage, utiliser la [carte des responsabilités](guides/architecture-developpement.md).
`pnpm verify` conserve la PWA de production et utilise `.verification/web` ;
suivre l'[environnement de vérification](runbooks/development.md).

## Prochain checkpoint et protections

Le prochain lot App relève d'une décision utilisateur. Calendar reste une option
à discuter. La documentation ne réautorise ni campagne IA, ni Tailscale, ni données
Budget réelles, ni achat, ni action physique.

Le Robot possède un correctif d'annulation des continuations tardives, testé en
simulation. Lire son [runbook](runbooks/robot-alphabot2.md) et observer sans mouvement.
Le Chat n'a aucune mutation métier ni commande d'actionneur.

Données et secrets : `D:\FridayData`, hors Git. Ne jamais modifier
`D:\prog\Home_mind` ; `jarvis`, `budget` et `modulo` restent en lecture seule.
Le [bilan documentaire](audits/2026-09-06-refonte-documentaire.md) suit ce lot sans
confondre la refonte, la republication du service et les recettes encore ouvertes.
Le guide Budget Markdown est actuel ; la correction et le rendu du Word daté restent
à terminer quand le moteur documentaire sera disponible, comme indiqué dans ce bilan.

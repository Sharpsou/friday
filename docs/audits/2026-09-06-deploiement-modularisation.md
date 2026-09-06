# Déploiement de la modularisation Friday — 6 septembre 2026

Livraison autorisée par l'utilisateur : « Déploye tout et dis moi ce que tu as fait et pas fait ».
Terminée à **10 h 33 (Paris)** sur [l'origine A17](https://192.168.1.14:8443).

## Livré

Le Hub et la PWA comprennent l'ensemble du workspace validé, y compris les évolutions Maison et Chat du 5 septembre et les corrections/modularisations du 6 septembre. Le HEAD reste `362bf801cd8db665d552f6151efa547463be454d` ; ses changements locaux et non suivis font partie de cette livraison. Aucune réinitialisation, staging, commit ou publication GitHub n'a été effectué.

- Trois corrections : arbitrage atomique identité/clé du coffre ; quota Menus sur tous les jobs actifs ; sync des domaines supportés après retour à un ancien Hub, même derrière plus de 100 commandes Maison.
- Socles sync, inférence et budget Web séparés ; routes HTTP et contrats répartis par domaine ; migrations extraites sans changement de SQL/ordre ; écrans, formulaires et commandes Maison modularisés.
- Pipelines Chat, dépôts/digest Veille et stockage du graphe Robot séparés, avec leurs comportements protégés.
- Retrait des helpers et styles prouvés inutilisés ; CSS à cascade conservée ; dix suites E2E et garde d'architecture. Le build de vérification nettoie sa sortie isolée.
- Budget chargé à la demande ; JavaScript initial réduit d'environ 572 à 302 kB. Les cinq grands fichiers conservés et leurs raisons restent dans le [bilan d'implémentation](2026-09-06-implementation-qualite-et-modularisation.md).

## Vérification de cette livraison

Les 540 fichiers de la capture finale ont été comparés par SHA-256 avant livraison : aucun changement ni ajout. `pnpm verify` a été rejoué pour cette demande et termine avec code **0**, **544 tests** (27 Python, 25 contrats, 40 cœur, 27 domaine, 192 Hub, 140 PWA, 61 banc, 29 navigateur, 3 architecture), ainsi que format/lint/typage/builds.

Commande de déploiement, après suppression des variables de sortie/base de test du processus :

```powershell
infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Le lanceur reconstruit le build de production puis redémarre le Hub ; code de sortie **0**. Contrôles HTTPS local et LAN : `status=ok`, `database=ok`. SQLite reste en **47**, `integrity_check=ok`, aucune violation de clé étrangère. Dexie reste en **9**. **22 fichiers servis** ont été comparés par SHA-256 au build, et le HTML LAN correspond au HTML construit. Les API privées Chat, Maison et Robot répondent 401 sans session.

Preuves hors Git : `D:\FridayData\audits\deployment-modularisation-20260906` (`source-check.json`, `verify.log`, `verify.exit`, `deploy.log`, `deploy.exit`, `deployment.json`). L'état documentaire est mis à jour après livraison ; aucun code runtime supplémentaire n'est changé.

## Sauvegarde et retour arrière

Sauvegarde online immédiatement avant déploiement : `D:\FridayData\backups\maison-migration-qvUdP7\before.sqlite`. Copie restaurée : `D:\FridayData\backups\maison-migration-qvUdP7\restored.sqlite`. Contrôles 47 → 47, intégrité correcte, toutes les tables existantes inchangées. La source a été ouverte en lecture seule.

La PWA précédemment servie est copiée sous `D:\FridayData\audits\deployment-modularisation-20260906\web-before`. La capture source avant modularisation reste `D:\FridayData\audits\modularisation-20260906\before.zip` ; la capture livrée avant mise à jour documentaire est `after.zip` au même endroit. Un retour arrière complet du runtime de production n'a pas été exécuté. Ne pas restaurer une base par-dessus des écritures ou outbox plus récentes ; le secret d'authentification reste en place hors Git. Cette sauvegarde locale ne remplace pas la future sauvegarde portable chiffrée du produit.

## Non fait et limites

- Pas de recette réelle A17/iPhone, ni contrôle des installations déjà ouvertes : la nouvelle PWA est disponible sur le serveur. Accepter « Mettre à jour » quand l'application le propose ; aucune base locale n'a été effacée.
- Pas de campagne de modèles ni de nouvelle qualification sémantique. La gate qualitative Chat reste refusée ; aucun prompt ou modèle n'est changé.
- Pas de mouvement, de réveil ou de test physique Robot. Le GET d'état du Pi n'a pas répondu avant livraison ; le runtime Python embarqué, inchangé par ce lot, n'a pas été réinstallé. Les améliorations Robot côté Hub/PWA sont livrées.
- Pas de suppression aveugle : les cinq modules de plus de 1 000 lignes justifiés, le backend MobileNet alternatif, les profils historiques `preparation`, les archives et les migrations sont conservés.
- Pas de correction générale des avertissements Workbox/Node, ni de mise à niveau globale des dépendances. L'arrêt isolé d'un worker rencontré durant l'implémentation reste documenté ; la vérification de cette livraison passe sans exclusion.

Les tests et contrôles de service n'ont détecté aucune régression sur leurs périmètres ; ils ne démontrent pas une absence absolue de défauts ou une recette des appareils physiques.

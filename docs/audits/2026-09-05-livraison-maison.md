# Livraison Maison — 5 septembre 2026

Maison est livré sur `https://192.168.1.14:8443`, avec Courses ouvert par défaut,
Menus, Réserve et affichage des repas dans Aujourd’hui/Agenda. Le candidat
contient aussi les changements Chat présents dans le workspace. La demande
utilisateur de terminer la livraison a levé la suspension de déploiement ; elle
ne valide pas la qualité du Chat, dont la campagne reste refusée.

## Preuves séparées

- **Automatisation** : `pnpm verify`, code 0 : 448 tests hors navigateur et
  29 parcours Playwright, soit 477 tests ; format, lint, typage et builds passent.
  La dernière vérification utilise une sortie Web isolée sous
  `D:\FridayData\builds\maison-delivery-20260905`.
- **Ollama réel** : jobs Menus local et Web terminés sur une base isolée ; cinq
  sources Web, quantités insuffisamment établies conservées comme inconnues,
  création idempotente et aucune écriture dans le catalogue partagé. Rapport :
  `D:\FridayData\evaluations\maison-delivery-20260905\report.json`.
  Ce contrôle fonctionnel ne constitue pas une validation qualitative de recette.
- **Correctif issu du contrôle réel** : le compilateur de grammaire Ollama
  rejetait les grandes bornes du JSON Schema avec HTTP 400. Le schéma de décodage
  conserve la structure et les enums ; Zod applique toujours toutes les bornes
  au résultat. Le test de rejet d’un rendement excessif passe.
- **Sauvegarde/restauration** : sauvegarde SQLite online immédiatement avant
  déploiement, restauration et migration sur copie 44 → 45, intégrité correcte
  et données des tables antérieures inchangées. Rapport et copies :
  `D:\FridayData\backups\maison-migration-BZMsFL`.
- **Déploiement** : lanceur Windows avec `-NoBrowser -ExitAfterHealthCheck
-RestartExisting -KeepHubRunning`, code 0. À 17 h 42, health checks local et
  LAN `status=ok`, `database=ok`, `ollama=not-required`. SQLite canonique 45,
  aucune violation de clé étrangère ; PWA livrée avec Dexie 9. Le HTML servi
  correspond au build, les API Menus et snapshot Maison refusent l’accès anonyme
  avec 401. Preuve :
  `D:\FridayData\evaluations\maison-delivery-20260905\deployment.json`.
- **Téléphones** : recette réelle A17/iPhone non effectuée. Le parcours mobile
  automatisé couvre le cycle Maison, mais ne remplace pas cet essai. Aucun
  mouvement Robot n’a été commandé.

## Retour arrière conservé

La sauvegarde pré-migration est
`D:\FridayData\backups\maison-migration-BZMsFL\before.sqlite`.
Le dossier `D:\FridayData\backups\maison-release-20260905` contient
`web-before` et `source-before.zip` (source Git du commit `362bf80`). Le binaire
Hub antérieur n’a pas été capturé : `dist` avait déjà été reconstruit pendant les
vérifications. Le zip représente le dernier commit, pas les modifications
locales non commitées de l’ancienne PWA ; ce retour est donc une référence
antérieure, pas une reproduction exacte de tout l’état intermédiaire.

Si un retour est nécessaire, arrêter d’abord les écritures et le Hub, sauvegarder
la base 45 et conserver les outbox mobiles. Extraire et reconstruire la référence
Git dans un dossier séparé avec ses dépendances et son lockfile ; ne pas écraser
le workspace courant. Remettre ensemble une PWA et un Hub de cette référence,
la sauvegarde SQLite 44 et les secrets d’authentification existants. Tester le
health check et l’intégrité avant reprise. Cette reconstruction complète du
runtime antérieur n’a pas été exécutée ; la restauration de la base l’a été.

Ne pas restaurer par-dessus une outbox en attente ni effacer IndexedDB. Les
écritures Maison effectuées après la sauvegarde exigent une reprise explicite.

## Recette utilisateur restante

Sur les deux téléphones, mettre à jour Friday puis vérifier : planifier plusieurs
jours avec un plat de six portions partagé entre deux repas, préparer les courses,
acheter hors connexion, reconnecter, ranger, cuisiner et consommer les restes.
Contrôler la photo manuscrite, les rayons, l’Agenda et la résolution d’un conflit
de stock entre appareils. Le détail est dans le
[runbook Maison](../runbooks/maison-menus-reserve.md).

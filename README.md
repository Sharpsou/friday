# Friday

Friday est une application familiale local-first nourrie de quatre projets existants :

- `Home_mind` pour les concepts de foyer, tâches, rappels, courses et stockage local ;
- `jarvis` pour Ollama, les sorties structurées, les outils et les garde-fous ;
- `budget` pour le budget mensuel, le prévisionnel et l'épargne ;
- `modulo` pour les principes de maison calme, dégradable et explicable.

## Direction retenue

Friday sera une **Progressive Web App offline-first** :

1. le PC Windows est le hub local, la base canonique et l'hôte Ollama ;
2. la PWA est installée depuis le Wi-Fi Maison ;
3. son interface et les dernières données restent disponibles hors connexion ;
4. les modifications offline sont synchronisées au retour du hub ;
5. Google Drive reçoit uniquement des sauvegardes chiffrées ;
6. Google Calendar « Maison » reste la source de vérité de l'agenda.

La mise au point et la recette MVP utilisent le PC et le Samsung Galaxy A17. La compatibilité iPhone sera testée plus tard avec la même PWA ; elle ne bloque plus le MVP et ne nécessite aucun build Apple.

## MVP retenu

- quatre destinations : `Aujourd'hui`, `Agenda`, `Courses`, `Veille` ;
- comptes adultes et données Maison partagées ;
- tâches minimales, rappels visibles et récurrence simple ;
- courses partagées, avec classement facultatif par rayon en arrière-plan ;
- budget partagé : frais fixes, courses, santé, loisirs, extras, revenus réguliers/extra et épargne mensuelle ;
- calendrier Google Maison en lecture et cache offline ;
- veille RSS/Atom configurable par profil ;
- assistant texte local via Ollama ;
- cache local chiffré, outbox et synchronisation LAN ;
- sauvegarde et restauration chiffrées.

La construction est pilotée en temps agentique : environ **8 à 16 heures cumulées**, avec quelques checkpoints physiques ou de configuration. Les périodes d’observation sur téléphone augmentent la confiance mais ne sont pas du temps de développement. La campagne iPhone est un lot ultérieur distinct.

## Documentation

- [Point de reprise pour un nouveau chat](docs/00-reprise-nouveau-chat.md) — **commencer ici**
- [Recette du socle offline Galaxy A17](docs/recipes/galaxy-a17-p0.md) — porte Lot 0B validée
- [Feuille de route technique et d’implémentation](docs/10-feuille-de-route-technique-implementation.md) — **support d’exécution actuel**
- [Prochaines étapes après le classement des courses](docs/11-prochaines-etapes-apres-classement-courses.md) — **plan actif**
- [ADR-011 — conflits et tombstones](docs/adr/011-conflits-et-cycle-de-vie-des-tombstones.md) — **accepté**
- [Décision finale PWA MVP](docs/09-decision-finale-pwa-mvp.md) — **référence produit actuelle**
- [ADR du classement des courses par rayon](docs/adr/010-classement-courses-par-rayon.md)
- [Taxonomie `retail-fr-v1`](docs/reference/taxonomie-courses-retail-fr-v1.md)
- [Runbook du classement des courses](docs/runbooks/classement-courses.md)
- [Recette A17 du classement des courses](docs/recipes/galaxy-a17-lot-1a-grocery-classification.md)
- [Recette A17 de l’authentification et de l’appairage](docs/recipes/galaxy-a17-lot-1a-auth.md) — **checkpoint physique**
- [Recette A17 des courses partagées](docs/recipes/galaxy-a17-lot-1a-groceries.md) — **checkpoint physique**
- [Recette iPhone de mise à jour PWA](docs/recipes/iphone-pwa-update.md) — **en attente du retour de la compagne**
- [Étude PWA offline](docs/08-option-pwa-offline.md) — étude ayant conduit à la décision
- [Décisions précédentes](docs/07-decisions-apres-reponses.md) — historique avant bascule PWA
- [Questions, réponses et points ouverts](docs/06-questions.md)
- [Audit des projets sources](docs/01-audit-projets-sources.md)
- [Périmètre produit initial](docs/02-perimetre-mvp.md)
- [Architecture local-first initiale](docs/03-architecture-local-first.md)
- [Modèle de données initial](docs/04-modele-de-donnees.md)
- [Roadmap initiale](docs/05-roadmap.md)

## État du workspace

Le dépôt Git est initialisé sur `main` avec `origin` configuré vers `https://github.com/Sharpsou/friday.git`. Un commit et un push ordinaires utilisent Git directement ; GitHub CLI (`gh`) n’est pas requis, sauf pour des opérations GitHub supplémentaires comme la création d’une pull request. Le Lot 0 contient maintenant le monorepo pnpm, la PWA React, le hub Fastify/SQLite, les contrats Zod et le premier vertical slice tâche/outbox/synchronisation. Aucun code des projets sources n’a été copié.

Commandes principales :

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
# évaluation locale facultative, Ollama requis
pnpm --filter @friday/hub eval:grocery-classification
```

Sous Windows, le raccourci de recette s’installe avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Install-DesktopShortcut.ps1
```

Après une évolution du runtime, reconstruire et redémarrer le hub en arrière-plan, sans ouvrir Chrome :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

L'installateur place également sur le Bureau `Friday - Lancer ou redemarrer`, qui exécute cette commande sans navigateur ni terminal visible et confirme son résultat, ainsi que `Friday - Arreter le service`, qui coupe uniquement le hub Friday pour la recette hors ligne.

La porte go/no-go offline/synchronisation du Lot 0B est validée sur le Galaxy A17. Le candidat Lot 1A couvre terminer/rouvrir, date/heure/durée, responsable, récurrence bornée, note, édition au toucher, authentification fermée par identifiant Friday et courses partagées offline-first. Le classement facultatif des courses par rayon combine les corrections du foyer, des règles locales et Ministral 3 8B via un job persistant arrêtable ; chaque réponse modèle est reliée à l'index du produit pour empêcher les décalages. La liste reste utilisable pendant le traitement et le mode plein écran `En course` conserve uniquement les rayons et produits restants sous forme de grandes cibles cochables, y compris hors ligne. La recherche de mise à jour PWA est relancée au démarrage, au retour au premier plan, au retour réseau et au clic sur l'état de connexion. Le foyer propriétaire est initialisé, mais l'appairage physique d'un second appareil reste à confirmer ; la recette iPhone attend le retour de la compagne de l'utilisateur sans bloquer le choix du lot suivant. Les checkpoints sont `docs/recipes/galaxy-a17-lot-1a-auth.md`, `docs/recipes/galaxy-a17-lot-1a-groceries.md`, `docs/recipes/galaxy-a17-lot-1a-grocery-classification.md` et `docs/recipes/iphone-pwa-update.md`. L'ADR-011 documente conflits et tombstones, dont l'implémentation avancée est reportée jusqu'à un signal d'usage réel. Le plan actif `docs/11-prochaines-etapes-apres-classement-courses.md` propose de discuter ensuite entre budget partagé — ordre recommandé —, Calendar en lecture ou courte période d'usage Maison.

Dernière validation automatisée du candidat : `pnpm verify` réussi avec 85 tests unitaires/intégration, le build PWA/hub et 20 scénarios Google Chrome mobile. Le runtime HTTPS a ensuite été reconstruit et redémarré sans navigateur avec un healthcheck réussi.

Pour reprendre dans un nouveau chat, ouvrir `D:\prog\friday` et utiliser le prompt fourni dans le document 00. Le fichier `AGENTS.md` protège les décisions essentielles et les projets sources.

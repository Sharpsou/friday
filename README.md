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

- six destinations : `Aujourd'hui`, `Agenda`, `Courses`, `Budget`, `Assistant`, `Veille` ;
- comptes adultes et données Maison partagées ;
- tâches minimales, rappels visibles et récurrence simple ;
- courses partagées, avec classement facultatif par rayon en arrière-plan ;
- budget partagé : frais fixes, courses, santé, loisirs, extras, revenus réguliers/extra et épargne mensuelle ;
- calendrier Google Maison en lecture et cache offline ;
- veille RSS/Atom configurable par profil ;
- assistant privé par profil via Ollama, avec modes classique et Web consentis ;
- cache local chiffré, outbox et synchronisation LAN ;
- sauvegarde et restauration chiffrées.

La construction est pilotée en temps agentique : environ **8 à 16 heures cumulées**, avec quelques checkpoints physiques ou de configuration. Les périodes d’observation sur téléphone augmentent la confiance mais ne sont pas du temps de développement. La campagne iPhone est un lot ultérieur distinct.

## Documentation

- [Point de reprise pour un nouveau chat](docs/00-reprise-nouveau-chat.md) — **commencer ici**
- [Recette du socle offline Galaxy A17](docs/recipes/galaxy-a17-p0.md) — porte Lot 0B validée
- [Feuille de route technique et d’implémentation](docs/10-feuille-de-route-technique-implementation.md) — **support d’exécution actuel**
- [Prochaines étapes après le candidat Assistant](docs/14-prochaines-etapes-apres-assistant.md) — **plan actif**
- [ADR-011 — conflits et tombstones](docs/adr/011-conflits-et-cycle-de-vie-des-tombstones.md) — **accepté**
- [ADR-008 — sauvegarde portable chiffrée](docs/adr/008-sauvegarde-portable-chiffree.md) — **conception acceptée, non implantée**
- [Runbook sauvegarde/restauration](docs/runbooks/sauvegarde-restauration.md) — **procédure cible**
- [État du budget partagé](docs/12-etat-budget-partage.md) — **checkpoint automatisé du 10 août 2026**
- [État de l’Assistant local](docs/13-etat-assistant-local.md) — **checkpoint automatisé du 10 août 2026**
- [ADR-013 — accès extérieur privé par Tailscale `/32`](docs/adr/013-acces-exterieur-tailscale-route-privee.md) — **accepté, mise en œuvre en pause**
- [Audit documentaire du 10 août 2026](docs/15-audit-documentation-2026-08-10.md)
- [ADR-012 — budget partagé et enveloppes](docs/adr/012-budget-partage-enveloppes.md) — **règles et formules**
- [Mode d’emploi illustré du budget](docs/guides/mode-emploi-budget-friday.docx)
- [Recette A17 du budget](docs/recipes/galaxy-a17-budget.md) — **checkpoint physique ouvert**
- [Décision finale PWA MVP](docs/09-decision-finale-pwa-mvp.md) — **référence produit actuelle**
- [ADR du classement des courses par rayon](docs/adr/010-classement-courses-par-rayon.md)
- [Taxonomie `retail-fr-v1`](docs/reference/taxonomie-courses-retail-fr-v1.md)
- [Runbook du classement des courses](docs/runbooks/classement-courses.md)
- [Recette A17 du classement des courses](docs/recipes/galaxy-a17-lot-1a-grocery-classification.md)
- [Recette A17 de l’authentification et de l’appairage](docs/recipes/galaxy-a17-lot-1a-auth.md) — **checkpoint physique**
- [Recette A17 des courses partagées](docs/recipes/galaxy-a17-lot-1a-groceries.md) — **checkpoint physique**
- [Recette iPhone de mise à jour PWA](docs/recipes/iphone-pwa-update.md) — **mise à jour reçue, auth/offline encore ouverts**
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

La porte go/no-go offline/synchronisation du Lot 0B est validée sur le Galaxy A17. Le candidat couvre les tâches, les courses, l’authentification fermée et le classement facultatif déjà documentés, ainsi que les destinations `Budget` et `Assistant`. Le budget partagé sépare réalisé, prévisionnel, enveloppes, provisions et épargne réelle. L’Assistant conserve des conversations privées par profil, une outbox chiffrée et une file persistante pour ses modes classique et Web. Les données financières réelles ne sont pas chargées tant que BitLocker, les ACL de `D:\FridayData` et la sauvegarde préalable ne passent pas la porte du runbook. Les recettes physiques A17 et iPhone restent distinctes des preuves automatisées.

Dernière validation automatisée du candidat : `pnpm verify` réussi le 10 août 2026 avec 142 tests unitaires/intégration, le build PWA/hub et 22 scénarios Google Chrome mobile. Une sauvegarde SQLite pré-migration a été créée hors dépôt ; le runtime HTTPS a ensuite été reconstruit et redémarré sans navigateur avec les migrations Assistant 10 et 11 et un healthcheck réussi.

L’accès extérieur retenu pour une étude ultérieure est une route Tailscale privée limitée à `192.168.1.14/32`, sans ouverture de box et sans changement d’origine PWA. Cette mise en œuvre est en pause. Lorsqu’elle reprendra, tout nouveau compte ou appareil devra être enrôlé depuis le Wi-Fi Maison ; seuls les appareils déjà approuvés pourront utiliser Friday en 5G.

Pour reprendre dans un nouveau chat, ouvrir `D:\prog\friday` et utiliser le prompt fourni dans le document 00. Le fichier `AGENTS.md` protège les décisions essentielles et les projets sources.

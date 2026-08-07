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

- trois destinations : `Aujourd'hui`, `Maison`, `Veille` ;
- comptes adultes et données Maison partagées ;
- tâches minimales, rappels visibles et récurrence simple ;
- courses partagées ;
- budget partagé : frais fixes, courses, santé, loisirs, extras, revenus réguliers/extra et épargne mensuelle ;
- calendrier Google Maison en lecture et cache offline ;
- veille RSS/Atom configurable par profil ;
- assistant texte local via Ollama ;
- cache local chiffré, outbox et synchronisation LAN ;
- sauvegarde et restauration chiffrées.

La construction est pilotée en temps agentique : environ **8 à 16 heures cumulées**, avec quelques checkpoints physiques ou de configuration. Les périodes d’observation sur téléphone augmentent la confiance mais ne sont pas du temps de développement. La campagne iPhone est un lot ultérieur distinct.

## Documentation

- [Point de reprise pour un nouveau chat](docs/00-reprise-nouveau-chat.md) — **commencer ici**
- [Feuille de route technique et d’implémentation](docs/10-feuille-de-route-technique-implementation.md) — **support d’exécution actuel**
- [Décision finale PWA MVP](docs/09-decision-finale-pwa-mvp.md) — **référence produit actuelle**
- [Étude PWA offline](docs/08-option-pwa-offline.md) — étude ayant conduit à la décision
- [Décisions précédentes](docs/07-decisions-apres-reponses.md) — historique avant bascule PWA
- [Questions, réponses et points ouverts](docs/06-questions.md)
- [Audit des projets sources](docs/01-audit-projets-sources.md)
- [Périmètre produit initial](docs/02-perimetre-mvp.md)
- [Architecture local-first initiale](docs/03-architecture-local-first.md)
- [Modèle de données initial](docs/04-modele-de-donnees.md)
- [Roadmap initiale](docs/05-roadmap.md)

## État du workspace

Le répertoire contient pour l’instant le cadrage de Friday et n’est pas encore initialisé avec Git. Aucun code des projets sources n’a été copié. La prochaine étape est le Lot 0A puis le spike PWA/offline : monorepo, HTTPS local, installation sur le Galaxy A17, stockage chiffré, outbox et convergence après une coupure complète.

Pour reprendre dans un nouveau chat, ouvrir `D:\prog\friday` et utiliser le prompt fourni dans le document 00. Le fichier `AGENTS.md` protège les décisions essentielles et les projets sources.

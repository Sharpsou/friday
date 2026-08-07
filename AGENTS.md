# Friday — instructions de reprise pour les agents

Ce fichier s’applique à tout le workspace `D:\prog\friday`.

## Lecture obligatoire avant toute action

Lire dans cet ordre :

1. `docs/00-reprise-nouveau-chat.md` — état réel et handoff ;
2. `docs/09-decision-finale-pwa-mvp.md` — décisions produit actives ;
3. `docs/10-feuille-de-route-technique-implementation.md` — exécution technique, tests et skills.

Ne pas repartir des documents historiques 02 à 05 ou 07 pour choisir l’architecture.

## État du workspace au 8 août 2026

- Friday ne contient encore aucun code applicatif.
- `D:\prog\friday` n’est pas encore un dépôt Git.
- `.analysis/` contient des artefacts temporaires et est ignoré.
- Les projets sources sont externes au workspace Friday.
- `D:\prog\Home_mind` est fortement modifié et ne doit jamais être édité, nettoyé, déplacé ou réinitialisé depuis Friday.
- `D:\prog\jarvis`, `D:\prog\budget` et `D:\prog\modulo` sont des sources de lecture, pas des cibles d’implémentation.

## Décisions non négociables du MVP

- PWA React/Vite offline-first ; aucun Flutter ou build Apple.
- Hub TypeScript/Fastify sur le PC Windows ; SQLite canonique.
- Dexie/IndexedDB, service worker, cache local chiffré et outbox sur le téléphone.
- Même voie d’écriture locale en ligne et hors ligne.
- Tâches, courses, agenda et budget partagés entre les deux adultes.
- Veille, digest et préférences assistant séparés par profil.
- Google Calendar Maison est la source d’agenda ; Friday le lit seulement au MVP.
- Google Drive ne sert qu’aux sauvegardes chiffrées, jamais au runtime ou à la synchronisation mobile.
- Ollama reste sur `localhost` et n’est jamais requis pour Maison, budget ou synchronisation.
- FTS5 avant embeddings ; pas de RAG, multi-agent, domotique ou banque connectée au MVP.
- Interface principale : Aujourd’hui, Maison, Veille et bouton `+`.
- Tâche minimale : titre ; date, responsable, récurrence et note facultatifs.
- Budget : frais fixes, courses, santé, loisirs, extras ; revenus réguliers/extra ; objectif et versement réel d’épargne distinct du reste disponible.

## Façon de travailler

- Ne pas refaire un audit général avant de démarrer : le handoff `00` est prévu pour cela.
- Commencer par le Lot 0A, puis continuer de façon autonome jusqu’à un vrai checkpoint utilisateur.
- Ne solliciter l’utilisateur que pour une action physique, un secret/compte, un choix qui change le produit ou une validation UX sur une version fonctionnelle.
- La construction est estimée en heures de travail agentique, pas en jours humains.
- Les périodes de 7/14 jours sont de l’observation, pas du temps de développement ni une raison d’attendre avant de coder la suite.
- Ne jamais affirmer un comportement A17/iPhone sans recette réelle correspondante.

## Skills

- Suivre les gates de la section 17 du document 10.
- Utiliser `skill-installer` pour inspecter et installer, après accord explicite de l’utilisateur.
- Priorité aux skills curated Codex, puis aux skills officiels des mainteneurs.
- Ne pas installer plusieurs skills redondants.
- Enregistrer toute installation future dans `docs/skills-register.md`.
- Aucun skill tiers spécifique à Friday n’est installé à ce jour.

## Première cible d’implémentation

1. proposer le pack minimal P0 si l’utilisateur ne l’a pas encore approuvé ;
2. initialiser Git et le monorepo pnpm TypeScript ;
3. créer `pnpm verify` ;
4. servir une PWA et `/api/health` sur la même origine ;
5. implémenter une tâche locale chiffrée + outbox + push/pull idempotent ;
6. exécuter les tests automatisés ;
7. demander uniquement alors la recette physique sur Galaxy A17.

Ne pas commencer le budget, Calendar, la veille ou l’assistant avant que la preuve offline/sync du Lot 0B soit exécutable.

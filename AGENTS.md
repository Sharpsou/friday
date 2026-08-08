# Friday — instructions de reprise pour les agents

Ce fichier s’applique à tout le workspace `D:\prog\friday`.

## Lecture obligatoire avant toute action

Lire dans cet ordre :

1. `docs/00-reprise-nouveau-chat.md` — état réel et handoff ;
2. `docs/09-decision-finale-pwa-mvp.md` — décisions produit actives ;
3. `docs/10-feuille-de-route-technique-implementation.md` — exécution technique, tests et skills.

Ne pas repartir des documents historiques 02 à 05 ou 07 pour choisir l’architecture.

## État du workspace au 8 août 2026

- Friday contient un monorepo pnpm TypeScript avec la PWA React/Vite, le hub Fastify/SQLite, les contrats partagés et les tests automatisés.
- `D:\prog\friday` est déjà un dépôt Git sur la branche `main`.
- Le remote `origin` est déjà configuré vers `https://github.com/Sharpsou/friday.git`.
- Un commit et un push simples se font avec Git. GitHub CLI (`gh`) n’est pas requis ; il ne devient utile que pour les opérations GitHub supplémentaires, par exemple créer une pull request.
- La commande de contrôle globale est `pnpm verify`.
- La PWA est accessible en HTTPS depuis le Galaxy A17 à l’origine stable `https://192.168.1.14:8443`. Le certificat est approuvé sur l’A17 et la recette physique offline/synchronisation reste l’autorité pour valider les comportements du téléphone.
- Les raccourcis Bureau permettent de lancer/recetter, lancer ou redémarrer sans navigateur, arrêter uniquement le hub et configurer l’accès A17. Après une évolution du runtime, utiliser le lancement sans navigateur.
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
- Direction visuelle : « futur discret » ; en-tête réduit à `Friday`, textes factuels, état de connexion compact.
- États de connexion visibles : `Connecté`, `Connexion…`, `Hors ligne`. Une indisponibilité du hub et une absence de réseau partagent volontairement le libellé utilisateur `Hors ligne`.
- Tâche minimale : titre ; date, responsable, récurrence et note facultatifs.
- Budget : frais fixes, courses, santé, loisirs, extras ; revenus réguliers/extra ; objectif et versement réel d’épargne distinct du reste disponible.

## Façon de travailler

- Ne pas refaire un audit général avant de démarrer : le handoff `00` est prévu pour cela.
- Reprendre l’état d’implémentation existant ; ne pas réinitialiser Git et ne pas recréer le monorepo.
- Continuer de façon autonome jusqu’au prochain vrai checkpoint utilisateur.
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

## Prochaine cible d’implémentation

La porte go/no-go du Lot 0B est validée sur le Galaxy A17 : persistance après redémarrage hors réseau, retour de l’attente à zéro et convergence sans doublon confirmés par l’utilisateur le 8 août 2026.

Le candidat construit après `f310e2c` implémente terminer/rouvrir, date/heure/durée, responsable facultatif, note facultative, récurrence jour/semaine/N jours/mois/an bornée par une date de fin et les vues `Liste`/`Semaine`/`Mois`. Toutes les occurrences sont créées avec des identifiants déterministes dans une transaction locale/outbox et sont immédiatement visibles ; leur suppression propose une occurrence ou toute la série. Les réglages locaux couvrent noms, palettes et limites distinctes des listes `Aujourd'hui`/`Maison`. Après un retour A17, les tâches sont triées par date puis heure dans toutes les vues, avec les tâches sans date en dernier. Les profils réels restent réservés à l’appairage. Terminer/rouvrir et date/agenda, notamment hors ligne, ont été validés sur l’A17 par l’utilisateur le 8 août 2026.

1. faire confirmer les recettes physiques `docs/recipes/galaxy-a17-lot-1a-ordering.md`, `docs/recipes/galaxy-a17-lot-1a-assignee.md`, `docs/recipes/galaxy-a17-lot-1a-settings.md` et `docs/recipes/galaxy-a17-lot-1a-recurrence-note.md` ;
2. traiter ensuite l’authentification fermée et l’appairage avant toute donnée réelle ou utilisation à deux ;
3. ajouter ensuite les courses partagées, puis finaliser conflits et tombstones ;
4. après une évolution du runtime, reconstruire et redémarrer le hub sans ouvrir Chrome avec `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.

Ne pas commencer le budget, Calendar, la veille ou l’assistant avant la sortie technique du Lot 1A.

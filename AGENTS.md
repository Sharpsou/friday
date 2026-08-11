# Friday — instructions de reprise pour les agents

Ce fichier s’applique à tout le workspace `D:\prog\friday`.

## Lecture obligatoire avant toute action

Lire dans cet ordre :

1. `docs/00-reprise-nouveau-chat.md` — état réel et handoff ;
2. `docs/09-decision-finale-pwa-mvp.md` — décisions produit actives ;
3. `docs/10-feuille-de-route-technique-implementation.md` — exécution technique, tests et skills.

Ne pas repartir des documents historiques 02 à 05 ou 07 pour choisir l’architecture.

## État du workspace au 10 août 2026

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
- Interface principale : Aujourd’hui, Agenda, Courses, Budget, Assistant, Veille et bouton `+` hors Assistant.
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

## Point de reprise immédiat

La porte go/no-go du Lot 0B est validée sur le Galaxy A17 : persistance après redémarrage hors réseau, retour de l’attente à zéro et convergence sans doublon confirmés par l’utilisateur le 8 août 2026.

Le candidat du 9 août 2026 implémente terminer/rouvrir, date/heure/durée, responsable facultatif, note facultative, récurrence jour/semaine/N jours/mois/an bornée et les vues `Liste`/`Semaine`/`Mois`. Il ajoute l'authentification fermée Better Auth/SQLite avec un identifiant Friday simple sans adresse e-mail à fournir : bootstrap du propriétaire sur foyer vide, second adulte appairé par code court à usage unique, sessions liées aux appareils, synchronisation authentifiée et révocation. Les profils historiques sont conservés ; le cache local reste utilisable hors ligne, mais une révocation bloque seulement les futurs échanges serveur. `Maison` est renommé en destination `Agenda` et `Courses` devient une destination principale distincte, avec quantité facultative, achat/réouverture, suppression, résumé dans `Aujourd'hui` et synchronisation chiffrée par la même outbox. Terminer/rouvrir et date/agenda, notamment hors ligne, ont été validés sur l'A17 le 8 août 2026 ; l'authentification complète et les courses ne le sont pas encore physiquement.

Le classement facultatif des courses par rayon utilise la taxonomie `retail-fr-v1`, des règles locales et apprises puis Ministral 3 8B pour les seuls libellés inconnus. Chaque entrée et réponse Ollama porte un index vérifié afin d'empêcher les décalages entre produits. Le job est persistant dans SQLite, reprend après redémarrage, affiche sa progression dans toute la PWA et peut être arrêté sans appliquer de résultat partiel. L'aperçu reste à confirmer avant partage ; la liste adopte ensuite une présentation unique regroupée par rayon, sans sous-onglets `Liste`/`Rayons`, conservée dans le cache chiffré. Le mode plein écran `En course` ne conserve que les rayons et les produits restants sous forme de grandes cibles cochables, y compris hors ligne.

La détection de mise à jour PWA est maintenant persistante et relancée au démarrage, au retour au premier plan, au retour réseau et au clic sur l'état de connexion. L'utilisateur confirme ensuite avec `Mettre à jour`. L'utilisateur a confirmé le 9 août 2026 que l'iPhone avait bien reçu la mise à jour ; le déclencheur exact n'a pas été consigné et les parcours auth/offline iPhone restent ouverts.

Le candidat du 10 août 2026 ajoute le budget familial partagé comme cinquième onglet : réalisé et prévisionnel séparés, revenus/frais récurrents, enveloppes, provisions, réserve, corrections et suppressions synchronisées. Les listes sont compactes et repliables à 360 px. Les données réelles ne sont pas chargées tant que la porte BitLocker/ACL/sauvegarde du runbook n’est pas validée. L’état complet est dans `docs/12-etat-budget-partage.md`.

Le Chat du 11 août 2026 conserve conversations et outbox chiffrées, file SQLite persistante, pause/reprise et `gemma4-12b-multimodal:128k` via Ollama. Chaque conversation choisit `Local`, `Web léger` ou `Web approfondi`. Les modes Web passent par Tavily côté hub avec décision locale préalable, budgets 2/2 ou 6/8, checkpoints, sources, vérification Gemma, quotas mensuels et consentement après nettoyage des données personnelles. Le thinking est automatique et forçable pour un message, sans conservation du raisonnement brut. Le journal d’avancement est persistant et ses durées excluent file, consentement et pauses. Le Chat ne dispose d’aucun droit de mutation métier directe. L’état produit est dans `docs/13-etat-assistant-local.md`, le checkpoint consolidé dans `docs/15-checkpoint-chat-tavily.md` et le runtime dans `docs/runbooks/assistant-gemma.md`.

`pnpm verify` réussit sur le candidat du 11 août 2026 avec 150 tests unitaires/intégration et 22 scénarios Chrome mobile. Une sauvegarde pré-migration est conservée hors dépôt sous `D:\FridayData\backups`. La migration SQLite 14 installe l’orchestrateur Tavily persistant ; le candidat doit être reconstruit et redémarré sur `https://192.168.1.14:8443` après toute évolution du runtime.

Le propriétaire a initialisé le foyer le 9 août 2026. L'appairage d'un second appareil n'est pas validé : le RG405M sous Firefox 151.0.3 atteint Friday mais conserve un avertissement de certificat. La recette iPhone attend le retour de la compagne de l'utilisateur et ne doit pas bloquer le travail documentaire ou le choix du lot suivant. Ne pas convertir ces essais en preuve de recette auth ou iPhone.

Le lot `En course`, le Budget, le Chat local classique et la fiabilisation des mises à jour PWA font partie de l’état à préserver. Les reprendre depuis Git et ne pas les réimplémenter ; inspecter `git status` et les derniers commits avant toute nouvelle modification.

L’accès extérieur retenu est une future route Tailscale limitée à `192.168.1.14/32`, sans ouverture de box ni changement d’origine. La décision est acceptée mais sa mise en œuvre est en pause. À sa reprise, tout nouvel accès devra être enrôlé depuis le Wi-Fi Maison ; ne pas installer ou configurer Tailscale avant une demande explicite. Voir `docs/adr/013-acces-exterieur-tailscale-route-privee.md`.

1. suivre `docs/14-prochaines-etapes-apres-assistant.md` et faire confirmer les recettes A17 auth/courses/classement/`En course`/budget/Assistant sans bloquer les travaux automatisés ;
2. lorsque la compagne est disponible, suivre `docs/recipes/iphone-pwa-update.md`, puis l'appairage et la recette offline sur l'iPhone ;
3. laisser conflits et purge de tombstones en observation conformément à l'ADR-011 ; ne pas les implanter sans signal d'usage réel ;
4. conserver Budget et Assistant à leurs checkpoints documentés jusqu’à retour d’usage ou recette physique, puis discuter avant implantation le prochain lot fonctionnel, Calendar en lecture étant l’option naturelle ;
5. maintenir Tailscale en pause jusqu’à une reprise explicite ;
6. après toute évolution du runtime, exécuter `pnpm verify`, puis reconstruire et redémarrer sans navigateur avec `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.

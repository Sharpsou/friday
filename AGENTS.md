# Friday — instructions de reprise pour les agents

Ce fichier s’applique à tout le workspace `D:\prog\friday`.

## Lecture obligatoire avant toute action

Lire dans cet ordre :

1. `docs/00-reprise-nouveau-chat.md` — état réel et handoff ;
2. `docs/09-decision-finale-pwa-mvp.md` — décisions produit actives ;
3. `docs/10-feuille-de-route-technique-implementation.md` — exécution technique, tests et skills.

Ne pas repartir des documents historiques 02 à 05 ou 07 pour choisir l’architecture.

## État du workspace au 24 août 2026

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
- L’agent physique Friday est désormais conçu comme un compagnon à roues avec LiDAR, Raspberry Pi, contrôleur vital indépendant et pince légère ; Mini Pi et Otto DIY restent des inspirations, pas la base matérielle. Aucun dépôt robotique, achat ou contrôle moteur n'entre dans Friday sans reprise explicite de l'ADR-014 et panier complet livré inférieur ou égal à 700 €.
- Le prototype zéro AlphaBot2-Pi est réinstallé sous Raspberry Pi OS Trixie 32 bits et intégré à l’onglet Robot. Caméra CSI, capteurs passifs, roues et servos réels sont téléopérables ; la production n’expose plus de mode simulation. Le mode autonome Carto à 10–20 %, son Dyna-Q persistant, le conseil Friday borné et `Va là` sur carte suffisante sont implantés ; un redémarrage du hub ne reprend jamais un run. Le servo pan tremble par intermittence, des sous-tensions ont été enregistrées et la recette physique autonome reste à faire. Pour tout travail Robot, lire d’abord `docs/24-checkpoint-autonomie-alphabot2-2026-08-25.md`, puis `docs/runbooks/robot-alphabot2.md` ; les documents 21 à 23 conservent l’historique.

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
- L’agent physique mobile décrit par `docs/19-document-fondateur-agent-physique-friday.md` est une expérimentation post-MVP : perception locale visible, reconnaissance consentie, jamais surveillance secrète, et aucune dépendance des fonctions Maison au robot.
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

Le candidat du 9 août 2026 implémente terminer/rouvrir, date/heure/durée, responsable facultatif, note facultative, récurrence jour/semaine/N jours/mois/an bornée et les vues `Liste`/`Semaine`/`Mois`. Il ajoute l'authentification fermée Better Auth/SQLite avec un identifiant Friday simple sans adresse e-mail à fournir : bootstrap du propriétaire sur foyer vide, second adulte appairé par code court à usage unique, sessions liées aux appareils, synchronisation authentifiée et révocation. Les profils historiques sont conservés ; le cache local reste utilisable hors ligne et hydrate immédiatement l'appareil déjà enrôlé avant la vérification réseau bornée à cinq secondes, notamment lorsque les données mobiles sont actives sans route vers le hub privé. Une déconnexion volontaire en attente reste bloquante et une révocation bloque seulement les futurs échanges serveur. `Maison` est renommé en destination `Agenda` et `Courses` devient une destination principale distincte, avec quantité facultative, achat/réouverture, suppression, résumé dans `Aujourd'hui` et synchronisation chiffrée par la même outbox. Terminer/rouvrir et date/agenda, notamment hors ligne, ont été validés sur l'A17 le 8 août 2026. L’authentification, l’offline et la convergence du second adulte sont validés sur l’iPhone le 18 août ; les recettes A17 complètes d’authentification et de courses restent distinctes.

Le classement facultatif des courses par rayon utilise la taxonomie `retail-fr-v1`, des règles locales et apprises puis Ministral 3 8B pour les seuls libellés inconnus. Chaque entrée et réponse Ollama porte un index vérifié afin d'empêcher les décalages entre produits. Le job est persistant dans SQLite, reprend après redémarrage, affiche sa progression dans toute la PWA et peut être arrêté sans appliquer de résultat partiel. L'aperçu reste à confirmer avant partage ; la liste adopte ensuite une présentation unique regroupée par rayon, sans sous-onglets `Liste`/`Rayons`, conservée dans le cache chiffré. Le mode plein écran `En course` ne conserve que les rayons et les produits restants sous forme de grandes cibles cochables, y compris hors ligne.

La détection de mise à jour PWA est maintenant persistante et relancée au démarrage, au retour au premier plan, au retour réseau et au clic sur l'état de connexion. L'utilisateur confirme ensuite avec `Mettre à jour`. L'utilisateur a confirmé le 9 août 2026 que l'iPhone avait bien reçu la mise à jour, puis le 18 août l’appairage, l’authentification, le redémarrage offline, la convergence avec le foyer et la suppression de l’auto-zoom des champs Tâche/Course dans Chrome iOS, sans bloquer le zoom manuel.

Le candidat du 10 août 2026 ajoute le budget familial partagé comme cinquième onglet : réalisé et prévisionnel séparés, revenus/frais récurrents, enveloppes, provisions, réserve, corrections et suppressions synchronisées. Les listes sont compactes et repliables à 360 px. Les données réelles ne sont pas chargées tant que la porte BitLocker/ACL/sauvegarde du runbook n’est pas validée. L’état complet est dans `docs/12-etat-budget-partage.md`.

Le Chat conserve conversations et outbox chiffrées, file SQLite persistante et pause/reprise. `qwen3.5:9b-q4_K_M` est le défaut ; la roue dentée peut le remplacer par `gemma4-12b-multimodal:128k` pour les nouveaux messages. Le modèle est persisté par run et conservé au retry. Chaque conversation choisit `Local`, `Web léger` ou `Web approfondi`. Une reprise adopte le mode actuellement sélectionné ; si celui-ci diffère du mode interrompu, le pipeline propre à l’ancien mode est écarté puis recommencé, sans retirer du quota mensuel les crédits Tavily déjà consommés. `Web léger` utilise Tavily ; `Web approfondi` lance Tavily et le MCP Exa anonyme en parallèle, avec au plus 6 appels Tavily et 2 appels Exa adaptatifs. Les recherches gardent checkpoints, sources, vérification avec le même modèle, quotas mensuels et consentement après nettoyage des données personnelles. Les contextes sont 8K pour les titres, 16K pour décision/plan Web et 32K pour délibération locale/réponse/vérification ; les sorties sont bornées à 2K/4K et le dossier de sources à 60000 caractères. Qwen utilise automatiquement une délibération interne non-thinking bornée à 256 tokens pour les demandes locales complexes ; les modes Web réutilisent leur planification et leur vérification. Gemma active automatiquement son thinking natif pour les demandes complexes et les passes Web qui le justifient. Aucun forçage par message ni raisonnement brut conservé. Le journal d’avancement est persistant et ses durées excluent file, consentement et pauses. Le Chat ne dispose d’aucun droit de mutation métier directe. L’état produit est dans `docs/13-etat-assistant-local.md`, le checkpoint consolidé dans `docs/15-checkpoint-chat-tavily.md` et le runtime dans `docs/runbooks/assistant-gemma.md`.

Le dernier `pnpm verify` de référence est consigné dans `docs/22-checkpoint-robot-alphabot2-2026-08-24.md` et doit être relancé après toute évolution. Une sauvegarde pré-migration est conservée hors dépôt sous `D:\FridayData\backups`. SQLite est à la migration 19 : 14–15 portent l’orchestrateur Chat et le modèle, 16–18 la Veille orchestrée et 19 les fournisseurs/diagnostics Exa. Dexie est à la version 7. Le candidat doit être reconstruit et redémarré sur `https://192.168.1.14:8443` après toute évolution du runtime.

Le propriétaire a initialisé le foyer le 9 août 2026. L’essai RG405M sous Firefox 151.0.3 reste non concluant à cause de son avertissement de certificat, mais l’appairage réel du second adulte est validé sur l’iPhone de la compagne. Mise à jour PWA, authentification, redémarrage offline, convergence à deux appareils et suppression de l’auto-zoom des champs Tâche/Course ont été confirmés physiquement le 18 août dans Chrome iOS, sans bloquer le zoom manuel.

Le lot `En course`, le Budget, le Chat local classique et la fiabilisation des mises à jour PWA font partie de l’état à préserver. Les reprendre depuis Git et ne pas les réimplémenter ; inspecter `git status` et les derniers commits avant toute nouvelle modification.

L’accès extérieur retenu est une future route Tailscale limitée à `192.168.1.14/32`, sans ouverture de box ni changement d’origine. La décision est acceptée mais sa mise en œuvre est en pause. À sa reprise, tout nouvel accès devra être enrôlé depuis le Wi-Fi Maison ; ne pas installer ou configurer Tailscale avant une demande explicite. Voir `docs/adr/013-acces-exterieur-tailscale-route-privee.md`.

1. suivre `docs/14-prochaines-etapes-apres-assistant.md` et faire confirmer les recettes A17 auth/courses/classement/`En course`/budget/Assistant sans bloquer les travaux automatisés ;
2. conserver l’iPhone en observation d’usage à deux ; sa recette mise à jour/auth/offline/convergence est validée dans `docs/recipes/iphone-pwa-update.md` ;
3. laisser conflits et purge de tombstones en observation conformément à l'ADR-011 ; ne pas les implanter sans signal d'usage réel ;
4. conserver Budget et Assistant à leurs checkpoints documentés jusqu’à retour d’usage ou recette physique, puis discuter avant implantation le prochain lot fonctionnel, Calendar en lecture étant l’option naturelle ;
5. maintenir Tailscale en pause jusqu’à une reprise explicite ;
6. après toute évolution du runtime, exécuter `pnpm verify`, puis reconstruire et redémarrer sans navigateur avec `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.

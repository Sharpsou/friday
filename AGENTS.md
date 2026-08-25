# Friday — instructions de reprise pour les agents

Ce fichier s’applique à tout `D:\prog\friday`.

## Lecture obligatoire

Lire dans cet ordre avant toute action :

1. `docs/00-reprise-nouveau-chat.md` — handoff court ;
2. `docs/27-etat-canonique-app-robot-2026-08-25.md` — état réel App + Robot ;
3. `docs/09-decision-finale-pwa-mvp.md` — décisions produit actives ;
4. `docs/10-feuille-de-route-technique-implementation.md` — architecture,
   exécution, tests et gates ;
5. le runbook du domaine concerné.

`docs/README.md` classe l’ensemble documentaire. Ne pas utiliser les documents
historiques 01–08 ou les anciens checkpoints Robot pour contredire le document
27.

## Workspace et sources

- Monorepo pnpm TypeScript existant : PWA React/Vite/Workbox, hub
  Fastify/SQLite, Dexie, contrats Zod et tests automatisés.
- Dépôt Git existant sur `main`, remote
  `https://github.com/Sharpsou/friday.git`. Ne pas réinitialiser ou recréer.
- Contrôle global : `pnpm verify`.
- Données et secrets hors Git sous `D:\FridayData`.
- Origine stable A17 : `https://192.168.1.14:8443`.
- `D:\prog\Home_mind` ne doit jamais être édité, nettoyé, déplacé ou
  réinitialisé depuis Friday.
- `D:\prog\jarvis`, `D:\prog\budget` et `D:\prog\modulo` sont des sources en
  lecture seule.
- Préserver les changements locaux existants et ne stage/commit que les
  fichiers appartenant à la tâche.

## Décisions non négociables

- PWA offline-first ; aucun Flutter ou build Apple.
- SQLite canonique sur le PC ; Dexie/IndexedDB chiffré et outbox sur les
  appareils ; même voie d’écriture Maison en ligne et hors ligne.
- Agenda, Courses et Budget partagés ; Chat et Veille privés par profil.
- Google Calendar reste non implanté et doit être discuté avant réalisation.
- Google Drive ne sert qu’à de futures sauvegardes chiffrées, jamais au
  runtime/sync.
- Ollama reste sur `localhost` et ne bloque jamais Maison, Budget ou sync.
- Pas de RAG, domotique, banque connectée ou accès Tailscale sans reprise
  produit explicite.
- Le Chat n’a aucune mutation métier directe ni commande d’actionneur.
- Perception Robot visible et consentie ; aucune surveillance secrète,
  reconnaissance faciale ou mémoire durable des personnes.
- Aucun achat ou changement de cible matérielle sans reprise de l’ADR-014 ;
  plafond livré 700 €.

## État technique courant

- Navigation : Aujourd’hui, Agenda, Courses, Budget, Chat, Veille, Robot.
- SQLite 24 ; Dexie 7.
- `pnpm verify` de référence : 21 tests Python, 22 contrats, 15 domaine, 145
  hub, 91 PWA, 25 Playwright et builds production.
- Candidat déployé sur l’origine A17 ; health check et intégrité SQLite `ok`.
- Sauvegarde pré-migration 24 :
  `D:\FridayData\backups\friday-pre-relocalisation-visuelle-20260825-2035.sqlite`.

Le prototype AlphaBot2 réel est téléopérable et expose Manuel, Autonome, Carto,
carte tactile, Dyna-Q à 10–20 %, politique caméra bornée, mémoire d’objets,
images-clés sélectives, signatures ORB, fermeture de boucle, `Va là` et
relocalisation après déplacement physique à la main. Aucun run ne reprend
après redémarrage. La recette physique autonomie/relocalisation reste ouverte ;
le servo pan tremble et l’AlphaBot2 n’a ni encodeur, IMU, LiDAR ni pince.

Pour tout travail Robot, lire `docs/runbooks/robot-alphabot2.md`. Observer
d’abord l’état sans mouvement. Une action physique exige l’utilisateur, une
zone sûre, un arrêt accessible et une recette explicite.

## Façon de travailler

- Reprendre l’implémentation ; ne pas refaire un audit général sans signal de
  contradiction.
- Continuer jusqu’au prochain vrai checkpoint utilisateur. Ne demander que
  pour une action physique, un secret/compte, un choix produit ou une validation
  UX réelle.
- Distinguer code livré, test automatisé, déploiement et recette physique.
- Ne jamais affirmer un comportement A17/iPhone/Robot sans sa preuve réelle.
- Les périodes de 7/14 jours sont de l’observation, pas du développement.
- Après une évolution runtime : `pnpm verify`, puis
  `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.
- Après une évolution structurante, mettre à jour le runbook concerné et
  `docs/27-etat-canonique-app-robot-2026-08-25.md` ; créer un checkpoint daté
  seulement si sa valeur historique le justifie.

## Skills

- Suivre les gates de la section 17 du document 10.
- Utiliser `skill-installer` uniquement après accord explicite.
- Préférer curated Codex puis officiel mainteneur, sans doublons.
- Enregistrer toute installation dans `docs/skills-register.md`.

## Reprise immédiate

1. inspecter `git status -sb` et `git log -5 --oneline` ;
2. préserver les lots déjà implantés et les changements locaux ;
3. choisir le runbook du domaine ;
4. pour Robot, privilégier d’abord les observations sans mouvement ;
5. conserver Tailscale, purge avancée des tombstones et données Budget réelles
   derrière leurs portes documentées ;
6. faire décider le prochain lot App par l’utilisateur — Calendar est une
   option, pas une instruction automatique.

# Friday — reprise rapide

Date : 25 août 2026

Statut : **point d’entrée canonique et court**

L’état détaillé App + Robot est dans
[27-etat-canonique-app-robot-2026-08-25.md](27-etat-canonique-app-robot-2026-08-25.md).
L’index documentaire est [README.md](README.md). Ne refaire un audit général
que si une contradiction nouvelle est observée.

## 1. Lecture et autorité

1. `AGENTS.md` — règles du workspace ;
2. ce handoff — démarrage et décisions immédiates ;
3. [27 — état canonique](27-etat-canonique-app-robot-2026-08-25.md) — vérité
   d’implémentation ;
4. [09 — décision PWA](09-decision-finale-pwa-mvp.md) — produit et cutline ;
5. [10 — feuille de route](10-feuille-de-route-technique-implementation.md) —
   architecture, gates et tests ;
6. le runbook du domaine modifié.

Les documents 01 à 08 sont historiques. Les checkpoints Robot 22 à 26
expliquent les étapes ; le document 27 tranche l’état courant.

## 2. Workspace à préserver

- dépôt : `D:\prog\friday`, branche `main`, remote GitHub déjà configuré ;
- monorepo pnpm TypeScript : React/Vite/Workbox, Fastify/SQLite, Zod et Dexie ;
- données réelles hors Git sous `D:\FridayData` ;
- origine A17 : `https://192.168.1.14:8443` ;
- vérification globale : `pnpm verify` ;
- ne jamais modifier `D:\prog\Home_mind` ; `jarvis`, `budget` et `modulo` sont
  aussi des sources en lecture seule ;
- préserver tout worktree sale et inspecter ses auteurs avant de stage/commit.

## 3. État applicatif condensé

La PWA possède sept destinations : Aujourd’hui, Agenda, Courses, Budget, Chat,
Veille et Robot. Les données Maison sont offline-first, chiffrées dans Dexie et
synchronisées vers SQLite par outbox idempotente.

- SQLite est en migration 25 ; Dexie en version 7.
- Authentification fermée et partage à deux implantés.
- Agenda, Courses/En course/import photo, Budget, Chat et Veille sont présents.
- Le Chat propose Local, Friday, Web léger et Web approfondi. Le mode Friday
  lit les faits du foyer et du Robot avec références, sans mutation.
- Google Calendar n’est pas implanté ; Tailscale reste en pause.
- Les données Budget réelles attendent la porte BitLocker/ACL/sauvegarde.
- Les validations A17/iPhone restent strictement celles consignées dans les
  recettes ; un test navigateur ne les remplace pas.

## 4. État Robot condensé

Le prototype AlphaBot2 réel est intégré sans mode simulation en production :
caméra CSI, joystick, roues, capteurs passifs et servos pan/tilt. YOLO26s tourne
sur le PC dans un Worker isolé.

- modes Manuel et Autonome explicites ; Carto automatique en autonomie ;
- exploration Dyna-Q persistante à 10–20 %, bornée par les capteurs et le
  watchdog Pi ; aucune reprise après redémarrage ;
- bouton `Récup` en autonomie : passage manuel explicite, observation bornée
  de la manœuvre puis apprentissage seulement après `Rendre la main` et
  validation du résultat ; un simple passage par `Manuel` reste un signal
  faible soumis à une preuve de progrès ;
- caméra limitée aux presets issus du manuel, avec politique de points de vue
  apprenable ; Carto continue pendant un mouvement de tête ;
- carte tactile avec trajectoires, incertitude, objets, zoom/déplacement et
  commande `Va là` sur une cible admissible ;
- images-clés sélectives liées aux objets, signatures ORB sans copie d’image,
  fermeture de boucle et correction du graphe de poses ;
- déplacement physique à la main détectable : relocalisation, vues de transport
  écartées et nouveau segment sans trajectoire fictive ; bouton
  `Je l’ai déplacé` disponible ;
- servo pan encore tremblant, sous-tensions historiques informatives, absence
  d’encodeur/IMU/LiDAR et recette physique autonome/relocalisation encore à
  effectuer.

Avant tout travail Robot, lire
[runbooks/robot-alphabot2.md](runbooks/robot-alphabot2.md). Observer l’état sans
mouvement avant d’envoyer une commande. Ne jamais confondre test logiciel et
preuve physique.

## 5. Dernière preuve fraîche

Le candidat applicatif `08cafa1` a été vérifié et déployé le 25 août 2026 :

- 21 tests Python ;
- 22 tests contrats, 15 domaine, 150 hub et 91 PWA ;
- 25 scénarios Playwright mobiles ;
- builds PWA/hub réussis ;
- worker OpenCV 4.14.0 testé ;
- health check `/api/health` et intégrité SQLite `ok` ;
- base active migrée en 25 après sauvegarde cohérente de la migration 24.

La sauvegarde pré-migration 25 est
`D:\FridayData\backups\friday-pre-human-recovery-20260825-211114.sqlite`
(migration 24, intégrité `ok`).

## 6. Démarrage d’une tâche

```powershell
git status -sb
git log -5 --oneline
pnpm verify
```

Pour relancer le candidat après une évolution runtime :

```powershell
infra\windows\Start-FridayRecipe.ps1 `
  -NoBrowser `
  -ExitAfterHealthCheck `
  -RestartExisting `
  -KeepHubRunning
```

Ne lancer `pnpm verify` au début que si la tâche exige une baseline fraîche ;
la commande est en revanche obligatoire avant une déclaration de fin après une
évolution.

## 7. Prochains checkpoints réels

1. recette physique de relocalisation après avoir soulevé/déplacé AlphaBot2 ;
2. observation qualitative de l’autonomie et des mouvements caméra ;
3. recettes A17 encore ouvertes sans bloquer les travaux automatisés ;
4. observation iPhone à deux ;
5. choix utilisateur du prochain lot App — Calendar est une option, pas une
   décision implicite ;
6. Tailscale, tombstones avancés et données Budget réelles restent en pause
   selon leurs portes respectives.

## 8. Interdictions de reprise

- ne pas recréer le monorepo, réinitialiser Git ou réimplémenter les lots déjà
  présents ;
- ne pas installer/configurer Tailscale sans demande explicite ;
- ne pas donner au Chat une mutation métier ou un contrôle direct du Robot ;
- ne pas inventer de validation physique ;
- ne pas stocker en continu les images caméra ni cartographier durablement les
  personnes ;
- ne pas traiter un plan futur du document fondateur Robot comme du matériel
  livré.

# Friday — reprise rapide

Date : 26 août 2026

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

- SQLite est en migration 32 ; Dexie en version 7.
- Authentification fermée et partage à deux implantés.
- Agenda, Courses/En course/import photo, Budget, Chat et Veille sont présents.
- Le Chat propose Local, Friday, Web léger et Web approfondi. Le mode Friday
  lit les faits du foyer et du Robot avec références, sans mutation.
- Google Calendar n’est pas implanté ; Tailscale reste en pause.
- Les données Budget réelles attendent la porte BitLocker/ACL/sauvegarde.
- Les validations A17/iPhone restent strictement celles consignées dans les
  recettes ; un test navigateur ne les remplace pas.

## 4. État Robot condensé

La veille réseau manuelle est implantée et déployée côté contrats, Hub, PWA et
runtime Pi. `wakeUrl` et un `wakeToken` distinct sont configurés hors Git ;
l’agent, la caméra, le runtime Robot et le target éveillé ont été vérifiés
actifs le 27 août. Le cycle physique veille/réveil reste ouvert : le déploiement
ne constitue pas encore une preuve de réveil réel.

Le prototype AlphaBot2 réel est intégré sans mode simulation en production :
caméra CSI, joystick, roues, capteurs passifs et servos pan/tilt. YOLO26s tourne
sur le PC dans un Worker isolé.

- modes Manuel et Autonome explicites, sans bouton Carto ni coordonnées `x/y` ;
- graphe de lieux visuels enrichi dans les deux modes, objets rattachés au lieu
  et conservés quand ils sortent du champ ;
- reconnaissance pHash/ORB/RANSAC, flot optique, panoramas corporels et
  secteurs stables ; aucune image persistée si une personne est présente ;
- habitudes SARSA(λ) généralisées sans UUID, sous réflexes déterministes ;
  aucun Qwen/LLM dans la navigation ;
- locomotion autonome 10–35 % par impulsions compensées selon la puissance :
  décision 4 Hz, renouvellement watchdog 10 Hz, puis arrêt, 700 ms de repos et
  trois images stables avant la décision suivante ;
- `Va là` sur lieu et transitions confirmés ; `Récup` validée puis réappliquée
  commande par commande sous les bornes capteurs ;
- manette Gamepad `standard` en Manuel : stick gauche pour la conduite et stick
  droit par pas caméra bornés, sans prise de contrôle de l’Autonome ;
- trim de direction global persisté par le Hub et partagé par le tactile, la
  manette et le démarrage de l’autonomie ;
- durée globale des impulsions du panorama 360° réglable de 120 à 1 000 ms
  sous le trim, initialisée à 220 ms et appliquée dès l’impulsion suivante ;
- panorama poursuivi jusqu’au retour visuel sur la vue initiale ; ORB/RANSAC ou
  un pHash très proche peuvent fermer la boucle, tandis qu’un retour plus faible
  doit être corroboré par plusieurs occurrences d’un objet vu au début du tour ;
- démarrage autonome sans localisation courante : huit impulsions corporelles
  stabilisées tentent une relocalisation, puis un court déplacement à 12 %
  fournit la preuve de translation nécessaire à une nouvelle ancre si les IR
  sont libres ;
- affichage Reco partagé par le Hub : `Reco affichée/masquée` converge entre
  mobile et Web sans arrêter l’analyse visuelle ni la cartographie ;
- servo pan encore tremblant, sous-tensions historiques informatives, absence
  d’encodeur/IMU/LiDAR et recette physique du nouveau modèle encore ouverte.

Avant tout travail Robot, lire
[runbooks/robot-alphabot2.md](runbooks/robot-alphabot2.md). Observer l’état sans
mouvement avant d’envoyer une commande. Ne jamais confondre test logiciel et
preuve physique.

## 5. Dernière preuve fraîche

Le lot d’autonomie topologique et son réglage panorama sont implantés et
déployés le 26 août 2026 :

- `pnpm verify` vert : 24 tests Robot Python, 25 contrats, 15 domaine,
  159 Hub, 102 PWA et 25 Playwright ;
- preuve logicielle veille réseau du 27 août : `pnpm verify` vert avec 27 tests
  Robot Python, 26 contrats, 15 domaine, 165 Hub, 104 PWA et 25 Playwright ;
- sauvegarde cohérente vérifiée :
  `D:\FridayData\backups\friday-pre-panorama-loop-20260826-232816.sqlite` en
  migration 31 ;
- base active migrée en 32, `integrity_check = ok`, 4 repères, 18 secteurs,
  4 transitions, trim `-5` et impulsion panorama `500 ms` conservés ;
- candidat redémarré et health check vert sur l’origine A17.

La recette physique reste séparée et ouverte.

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

1. recette physique du graphe de lieux et de la navigation fluide ;
2. observation de `Va là`, faible lumière et `Récup` réappliquée ;
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

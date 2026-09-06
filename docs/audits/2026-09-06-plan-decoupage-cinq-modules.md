# Friday — plan de découpage des cinq derniers gros modules

Statut documentaire : archive.

Date : 6 septembre 2026. Plan accepté par l'utilisateur, exécution demandée.
Ce document conserve la référence et les contrôles nécessaires à une reprise
autonome. Le bilan d'exécution distinct donne les résultats réellement obtenus.

## Référence et objectif

Terminer les cinq découpages sans changement fonctionnel involontaire, puis
vérifier et déployer le complément Hub/PWA. Un déplacement du monolithe dans
un autre fichier ne satisfait pas l'objectif. Les frontières suivent les
responsabilités et les propriétaires d'état, sans seuil artificiel de taille.

- Dépôt `D:\prog\friday`, branche `main`, HEAD observé
  `362bf801cd8db665d552f6151efa547463be454d`.
- Nombreux changements locaux et non suivis : ils font partie de la livraison.
  Ne pas réinitialiser, stage, commit ou pousser le dépôt.
- Dernière livraison documentée : 6 septembre 2026 à 10 h 33 (Paris),
  `https://192.168.1.14:8443`, SQLite 47 / Dexie 9.
- Dernière preuve historique : 544 tests, format, lint, typage, architecture et
  builds. À rejouer sur la référence réelle, jamais à présenter comme preuve du
  futur découpage.

| Fichier                                       | Lignes avant | Responsabilités                            |
| --------------------------------------------- | -----------: | ------------------------------------------ |
| `apps/hub/src/app.test.ts`                    |         1636 | Intégrations HTTP et fixtures              |
| `apps/hub/src/auth/auth-service.ts`           |         1111 | Sessions, enrôlement, membres et appareils |
| `apps/web/src/app/use-app-controller.tsx`     |         1213 | État, actions, sync et effets React        |
| `apps/hub/src/robot/robot-visual-topology.ts` |         1332 | Observations, graphe et panoramas          |
| `apps/hub/src/robot/robot-autonomy.ts`        |         1174 | Modes, mouvement, parcours et récupération |

Lire les rapports historiques sans les réécrire :
[audit](2026-09-05-qualite-code-et-modularisation.md),
[implémentation](2026-09-06-implementation-qualite-et-modularisation.md),
[déploiement](2026-09-06-deploiement-modularisation.md).
Préserver les extractions déjà livrées et les trois corrections : identité/clé
atomique du coffre, quota Menus sur tous les jobs actifs, sync compatible avec
un ancien Hub même derrière plus de 100 commandes Maison.

## Préparation et discipline

1. Lire AGENTS, les documents 00, 27, 09, 10 puis les runbooks développement,
   Maison, Chat et Robot. Les anciens paragraphes SQLite 45 sont historiques.
2. Inspecter Git et les instructions locales, confronter les cinq fichiers à la
   référence. Ne pas refaire un audit général sans contradiction.
3. Créer un dossier de preuves hors Git, avec HEAD, état Git, diff binaire,
   inventaire des fichiers suivis et non suivis, SHA-256 et archive vérifiée.
4. Inventorier tests, exports, transactions, états mutables et ressources.
5. Exécuter la vérification initiale dans un processus dédié avec données
   jetables, Robot désactivé et aucune clé de service réel.
6. Ajouter les caractérisations manquantes avant chaque extraction sensible.
7. Déplacer les corps existants ; isoler toute correction fonctionnelle.
8. Comparer résultats, erreurs, mutations, paramètres et ordre des appels avant
   et après sur les mêmes fixtures. Une comparaison AST complète ces preuves,
   sans remplacer les tests.
9. Tests ciblés puis `pnpm verify` à chaque lot. Conserver logs et codes de sortie.
10. Garder un checkpoint précis : terminé, vérifié, restant, processus actifs.

Ne pas réexécuter les anciens scripts de transformation : certains ne sont pas
idempotents. Ne pas masquer un échec avec une exclusion, une assertion affaiblie
ou des relances jusqu'au succès. Un défaut préexistant est documenté et corrigé
séparément ; un défaut critique de sécurité, données ou Robot bloque la livraison.

## Lots et propriétaires d'état

### A — Tests HTTP (effort faible)

Répartir les 22 scénarios en santé, authentification/appareils, Robot/veille
réseau, sync tâches, Courses et Budget. Fixtures explicites et objets neufs.
Chaque suite possède ses Hub, connexions et répertoires temporaires. Fermeture
et nettoyage restent bornés aux ressources créées. Aucun état mutable partagé
implicitement et aucun scénario dépendant d'un test précédent.

Preuves : correspondance des 22 scénarios/assertions, chaque suite seule puis
toutes ensemble, aucune ressource ni temporisateur résiduel.

### B — Authentification (effort moyen)

Conserver `ClosedAuthService`, ses méthodes, options, erreur et accès `auth`.
Séparer configuration/contexte Better Auth, enrôlement/membres, appareils et
approbations, puis persistance/protections communes. La façade compose une seule
instance de chaque dépendance. Conserver un seul AsyncLocalStorage, limiteur et
Better Auth par service ; pas de dépendance des modules vers la façade.

Conserver transactions entières, ordre des attentes, association session/appareil
en concurrence, identifiants, entrées et préfixes HMAC, durées, plafonds, erreurs,
cookies et révocation. Aucun dépôt ne fragmente une opération atomique.

Caractériser enrôlements simultanés, code à usage unique, bornes d'expiration,
limite de cinq appareils, approbation refusée/expirée sans session, révocation,
oubli/réappairage et rollback d'une transaction interrompue.

### C — Contrôleur React (effort élevé)

Conserver `useAppController` et sa forme publique. Extraire navigation,
chargement local/sync, tâches, Courses/photo/classement, préférences/comptes,
réglages Robot et cycle de vie. Hooks d'état appelés inconditionnellement à la
racine, jamais dans les écrans montés à la demande. Les brouillons et dialogues
gardent leur durée de vie. États transversaux (`savingEditor`, message) uniques.

Les effets restent ordonnés avec leurs dépendances et nettoyages. Les modules
d'actions reçoivent uniquement les valeurs/setters/opérations nécessaires, sans
import du contrôleur complet. Conserver annulation sync, écriture, relecture et
relance, ainsi que délais, focus et polling. Pas d'optimisation de concurrence.

Caractériser navigation avec saisie, focus/Échap, récurrences, En course,
classement en arrière-plan, offline/reconnexion, changement de session,
montage/démontage et absence de double listener/timer.

### D — Topologie Robot (effort élevé)

Réutiliser `visual-topology/{records,policy,errors,repository}`. Séparer mutations
du graphe, traitement des observations, panoramas, transitions et présence des
objets. La façade garde API, file unique, epoch, pause, reprise et fermeture.
Un seul état explicite partagé, sans copie de champs mutables ni proxy privé.

Conserver invalidation autour des attentes, attente de la file avant mutation,
remise à zéro et transactions composites. Tester reconnaissance différée durant
pause/fusion/purge, erreur suivie d'une observation valide, doublon de frame,
fermeture en cours, repères et transitions, limites et confidentialité : pas de
JPEG mémorisé avec une personne. Fixtures exclusivement fictives.

### E — Autonomie Robot (effort élevé)

Conserver API et exports. Séparer politiques/commandes, cycle de mouvement,
parcours et récupération. La façade garde modes, verrous `ticking` et
`refreshingMotion`, timers et ordre des appels Robot/habitudes/panoramas.
Un seul propriétaire du cycle ; pas de capture d'état obsolète autour d'un await.

Conserver puissance, durées, watchdog, IR, vision, apprentissage et absence de
reprise après redémarrage. Horloge contrôlée et matériel simulé : expiration,
obstacle, vision périmée, arrêt/changement de mode pendant une requête différée,
panne, panorama actif, récupération interrompue et fermeture. Aucune commande
tardive après arrêt. Tout défaut découvert est un correctif distinct.

## Matrice de non-régression

- Auth : fermeture, origines/cookies, appareil/session, concurrence, expiration,
  révocation et profils.
- UI : état conservé, dialogues/focus, lazy loading, listeners et timers.
- Sync : atomicité données/outbox, doublons, curseurs, conflits composites,
  reconnexion, ancienne PWA et ancien Hub.
- Maison : versions, portions/restes, inconnues, unités, rangement idempotent,
  contributions ; Budget : exactitude, récurrences et absence de doublons.
- Chat : envoi incertain, confidentialité, ordre causal, Local, publication ;
  services IA/Web : file commune, annulation et quotas.
- Robot : sérialisation, invalidation, panoramas, transitions, personnes,
  commandes bornées, arrêt et absence de reprise.
- PWA : mise à jour avec outbox, démarrage offline et précache propre.

Réutiliser les tests pertinents ; ajouter seulement les comportements manquants.
Fixer horloge/aléatoire/identifiants pour comparer les sorties sans masquer des
différences réelles. Conserver inventaire et assertions, pas seulement le total.
Référence historique : Python 27, contrats 25, cœur 40, domaine 27, Hub 192,
Web 140, banc 61, E2E 29, architecture 3.

```powershell
Get-ChildItem Env:FRIDAY_* | Remove-Item
$env:FRIDAY_ROBOT_MODE = 'disabled'
$env:FRIDAY_DATABASE_PATH = ':memory:'
$env:FRIDAY_DATA_DIR = "$env:TEMP/Friday-verification"
$env:FRIDAY_E2E_PORT = '18443'
$env:FRIDAY_CHAT_ENABLED = 'true'
$env:FRIDAY_CHAT_PIPELINE = 'unified'
pnpm verify
```

Exécuter dans un shell dédié. Tests ciblés : `pnpm --filter @friday/hub exec
vitest run <fichiers>` et équivalent Web. E2E avec nouveau Hub par invocation et
build `.verification/web`. Ne pas construire la PWA de test dans `apps/web/dist`.

Interdire les cycles d'exécution ; distinguer les imports de types. Conserver
les imports internes `.ts` des contrats requis par Node natif. Vérifier les
points d'entrée Windows/Node, imports dynamiques, Budget différé et absence
d'anciens chunks dans le précache. Aucun modèle, prompt, protocole, format/AAD,
migration ou dépendance n'est changé par ce lot.

## Déploiement et retour arrière

L'utilisateur a autorisé le déploiement Hub/PWA, pas les actions physiques ni une
campagne de modèles. Après vérification finale :

1. Comparer les sources à celles vérifiées ; archiver source et artefacts
   Hub/PWA précédents dans un nouveau dossier.
2. Sauvegarde SQLite online et restauration sur copie :
   `pnpm --filter @friday/hub exec tsx src/maison/check-migration.ts
D:/FridayData/friday.sqlite D:/FridayData/backups`.
3. Vérifier version 47, intégrité et clés étrangères de la copie.
4. Observer le Robot sans mouvement ; consigner une indisponibilité sans réveil.
5. Nouveau shell de production, retirer les overrides base/Web/port de test,
   conserver configuration et secrets hors Git. Exécuter :

```powershell
infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Après livraison : santé HTTPS locale/LAN, SQLite 47 intègre, clés étrangères,
SHA-256 de tous les fichiers servis et HTML LAN, API privées Chat/Maison/Robot
refusant l'anonyme, aucune erreur nouvelle de démarrage/import. Ne pas effacer
IndexedDB, forcer les appareils ou vider les outbox.

Retour arrière privilégié : code et artefacts cohérents précédents avec base
courante, sans changement de schéma. Tester cette combinaison sur données
jetables, ainsi que la compatibilité ancienne PWA/nouveau Hub. Identifier le
processus Friday avant arrêt ; ne pas stopper un autre service. Une ancienne
base ne doit jamais écraser automatiquement des écritures plus récentes.

Le Pi Python reste inchangé. Aucun mouvement, réveil ou purge réelle. Gate
qualitative Chat refusée ; recettes téléphones et Robot distinctes et ouvertes.

## Livrables et critère de fin

Créer un bilan daté distinct : références/empreintes, tailles avant/après,
responsabilités et dépendances, scénarios conservés/ajoutés, logs et résultats,
anomalies, sauvegardes, retour arrière et contrôles de livraison. Mettre à jour
handoff 00, canonique 27, index et runbooks concernés. Distinguer implémenté,
testé, déployé et recette physique non réalisée.

Terminé lorsque les cinq fichiers sont réellement décomposés, interfaces et
formats compatibles, contrôles requis réussis, complément livré et vérifié,
limites documentées. Une vérification réussie démontre une absence de régression
détectée sur son périmètre, jamais une garantie absolue.

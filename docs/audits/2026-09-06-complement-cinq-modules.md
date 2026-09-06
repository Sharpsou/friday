# Complément de modularisation — cinq fichiers découpés

Statut documentaire : archive.

Date : 6 septembre 2026. **Déployé à 12 h 04 (Paris)** sur
[l'origine A17](https://192.168.1.14:8443), après la demande d'implémenter le
[plan de reprise](2026-09-06-plan-decoupage-cinq-modules.md).

## Résultat

Les cinq exceptions de taille de la livraison précédente sont traitées. Les
façades conservent les interfaces publiques ; les responsabilités et états sont
répartis dans des modules dédiés. Un correctif distinct protège l'arrêt Robot
contre les réponses asynchrones tardives découvertes pendant la caractérisation.

| Fichier                                       | Avant | Après | Découpage                                                          |
| --------------------------------------------- | ----: | ----: | ------------------------------------------------------------------ |
| `apps/hub/src/app.test.ts`                    |  1636 |    27 | Santé ; cinq suites HTTP par domaine et fixtures explicites        |
| `apps/hub/src/auth/auth-service.ts`           |  1111 |   258 | Sessions, protections, dépôt, membres et appareils                 |
| `apps/web/src/app/use-app-controller.tsx`     |  1213 |   582 | États, actions, chargement local, sync et cycle de vie             |
| `apps/hub/src/robot/robot-visual-topology.ts` |  1332 |   233 | Observations, mutations, panoramas, transitions et objets          |
| `apps/hub/src/robot/robot-autonomy.ts`        |  1174 |   718 | Commandes, décisions, cycle de mouvement, parcours et récupération |

L'inventaire des fichiers suivis et non suivis de code/scripts/styles ne contient
plus de fichier de plus de 1000 lignes ; 34 dépassent encore 500 lignes, contre
36 à la précédente livraison. Les deux façades les plus longues restent des
compositions explicites. Il n'existe aucun nouveau monolithe de remplacement.
Le seuil reste un indicateur, pas une définition de la qualité.

## Référence et périmètre

HEAD conservé : `362bf801cd8db665d552f6151efa547463be454d`, branche `main`.
Les changements locaux et non suivis font partie du runtime livré. Aucun stage,
commit, push ou changement dans les dépôts voisins n'a été effectué.

Preuves hors Git : `D:/FridayData/audits/five-modules-20260906`.
`before.zip` et `before.json` figent et vérifient 541 fichiers ; `after-code.zip`
et `after-code.json` figent 589 fichiers testés, avant mise à jour documentaire.
L'archive a été relue et ses SHA-256 vérifiés. `git-status.txt` et
`git-diff.patch` préservent le contexte local. Les anciens rapports restent
inchangés et continuent de décrire leur livraison respective.

La comparaison des empreintes ne relève aucun changement dans les packages,
contrats, migrations, Python embarqué, dépôts Web, synchronisation Web, styles,
manifests npm et lockfile. SQLite reste en **47**, Dexie en **9**. Aucun prompt,
modèle, pipeline Chat, format persistant, AAD de chiffrement ou contrat HTTP
n'est changé. Les exports publics d'origine sont conservés.

## Responsabilités et dépendances

### HTTP et authentification

Les 22 scénarios HTTP restent présents avec les mêmes corps et assertions. Les
fixtures possèdent leurs Hub et dossiers temporaires, ferment leurs ressources
et fabriquent des objets neufs. Les six suites passent ensemble et séparément.

`ClosedAuthService` compose `AuthSessionRuntime`, `AuthProtection`,
`AuthRepository`, `AuthMembers` et `AuthDevices`. Les types et constantes internes
sont dans `auth-records`. Les modules dépendent du dépôt, des protections ou du
runtime de session ; aucun ne dépend de la façade.

Une instance conserve un seul Better Auth, AsyncLocalStorage et limiteur de
requêtes. Les transactions d'enrôlement et d'approbation restent entières.
Cookies, HMAC, codes, limites, messages et filtrage des profils sont inchangés.
Les nouveaux tests protègent les connexions concurrentes et le rollback des
approbations/enrôlements après erreur SQLite injectée.

### Application React

Les hooks d'état restent tous appelés à la racine de l'application. Les états
survivent aux changements d'écran, conformément au comportement antérieur.
Les données locales, états de connexion, formulaires, comptes, préférences et
réglages Robot sont explicites. `savingEditor` et le message applicatif restent
uniques dans la composition.

Les modules d'actions reçoivent des contextes limités ; les dépendances de type
sont des imports de types. `useAppLifecycle` conserve les huit effets dans leur
ordre. Les setters React et références stables nouvellement injectés sont
ajoutés explicitement aux dépendances, sans supprimer les dépendances existantes.
L'ordre annulation/écriture/relecture/synchronisation et les délais sont conservés.

Le JavaScript initial passe de 301,99 à **312,29 kB** minifiés, et de 89,24 à
**91,29 kB gzip** : coût des compositions et contextes explicites, pas une
amélioration de taille par rapport au lot précédent. Budget reste différé
(32,95 kB) et le CSS demeure à 75,20 kB. Les parcours navigateur passent ; aucun
benchmark supplémentaire de latence ou mémoire sur téléphone n'a été réalisé.

### Topologie et autonomie

La façade topologique conserve la file d'observation unique et sa fermeture.
`VisualObservationState` est l'unique état partagé entre les processeurs ; ses
méthodes gèrent pause, epoch et remise à zéro. Les mutations reçoivent un accès
borné à la promesse en cours et attendent sa résolution. Reconnaissance et
stockage sont injectés ; aucun module enfant ne remonte vers la façade.

L'autonomie conserve les temporisateurs, verrous et coordination des modes.
`AutonomyState` possède les données de l'épisode ; commandes, mouvement,
récupération, parcours et décisions utilisent cette instance unique. Les
constructeurs des modules extraits n'ouvrent pas de ressource supplémentaire.
Les commandes et politiques pures restent réexportées à leur adresse d'origine.

## Correctif de sécurité distinct : annulation des opérations en vol

Avant le découpage de l'autonomie, cinq scénarios échouaient sur le code existant :

1. Une observation résolue après l'arrêt modifiait encore l'action et les compteurs.
2. Une réponse d'état tardive provoquait un appel `drive` après l'arrêt, avec une
   direction devenue `null` dans la reproduction simulée.
3. Un démarrage en attente pouvait repasser en exploration après l'arrêt.
4. Une capture de secteur terminée après annulation déclenchait une rotation.
5. Une préparation de panorama annulée pouvait encore envoyer la commande caméra.

Des epochs invalident les continuations interrompues, y compris les erreurs
asynchrones. Les démarrages en cours et arrêts sont protégés ; les annulations
concurrentes du panorama partagent leur promesse. Les temporisateurs et règles
normales, puissances, watchdog et apprentissages restent conservés.
Le fichier `robot-panorama-survey.ts` est donc corrigé en complément des cinq
fichiers du plan, sans modification Python ou commande physique.

`autonomy-panorama-before.log` montre cinq échecs et un succès avant correction ;
`safety-after.log` montre 18 tests ciblés réussis. `before-safety` conserve les
sources précédentes. `before-autonomy-extraction` fige ensuite le code corrigé,
avant son découpage, pour ne pas confondre correctif et refactorisation.

## Vérifications

`pnpm verify` passe sur la référence initiale, puis à chaque lot stabilisé :
`verify-baseline`, `verify-a-fixed`, `verify-b`, `verify-c`, `verify-d`,
`verify-safety`, `verify-e` ; les fichiers `.exit` correspondants valent **0**.
La dernière vérification couvre **557 tests** : Python 27, contrats 25, cœur 40,
domaine 27, Hub 204, Web 140, banc 61, navigateur 30, architecture 3. Format,
lint, typage et builds passent. La garde analyse **308 modules / 629 liens**,
sans violation ni cycle d'exécution.

Les treize nouveaux tests sont trois caractérisations auth, trois de topologie,
six de cycle de vie Robot et un parcours navigateur de brouillons/navigation,
offline et focus. Les autres tests sont conservés.

`comparisons.json` atteste les comparaisons AST, hors commentaires, formatage et
accès explicitement redirigés aux dépendances :

- 22 scénarios HTTP et 31 corps de méthodes auth ;
- 27 actions React, huit effets ordonnés, 63 initialisations et résultat public
  inchangé du contrôleur ;
- 28 corps de méthodes topologiques ;
- 33 corps et paramètres de méthodes d'autonomie, comparés à la version corrigée
  avant extraction.

Ces comparaisons complètent les tests ; elles ne démontrent pas seules une
équivalence de tous les comportements concurrents.

Deux campagnes de compatibilité locales passent, cinq scénarios chacune :
ancienne PWA/nouveau Hub puis nouvelle PWA/ancien Hub reconstruit. Auth, Maison,
sync interrompue et brouillons UI utilisent des données jetables, sur ports
19443 et 19543. Les configurations, logs et codes 0 sont conservés sous
`compat-previous-web-fixed` et `compat-previous-hub`.

Écarts de travail conservés dans les logs : nom de fixture confondu avec un hook
React, variables/imports, résolution de types et sélecteur de focus corrigés ;
les assertions comportementales n'ont pas été affaiblies. Une préparation du
script topologique a rencontré une erreur de syntaxe avant toute transformation.
La première configuration de compatibilité était mal échappée et a été corrigée
avant l'exécution des scénarios. La commande pnpm dans la copie de retour arrière
refusait de réinstaller ses modules liés : aucune purge n'a été autorisée ;
l'ancien Hub a été construit avec le binaire tsup déjà installé.
Les avertissements Workbox/Node déjà connus restent hors de ce lot.

## Livraison et retour arrière

Sauvegarde online immédiatement préalable :
`D:/FridayData/backups/maison-migration-XKj8PU/before.sqlite` ; restauration
vérifiée : `restored.sqlite` dans le même dossier. `backup.log` établit 47 → 47,
intégrité correcte et tables existantes inchangées. La source est ouverte en
lecture seule. Cette copie n'est pas une sauvegarde portable chiffrée du produit.

La PWA précédente est dans `web-before`. L'ancien Hub est reconstruit dans
`rollback-source/apps/hub/dist`, à partir de l'archive source, avec les mêmes
dépendances installées et inchangées. Cette copie utilise des jonctions vers les
`node_modules` existants : ne jamais lancer une purge ou installation automatique
à travers ces jonctions. Les sources et artefacts de référence restent hors Git.

Déploiement autorisé, code de sortie 0 :

```powershell
infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

À 12 h 04, HTTPS local et LAN : `status=ok`, `database=ok`. SQLite 47,
`integrity_check=ok`, aucune violation de clé étrangère. Les **22 fichiers
statiques servis** correspondent au build par SHA-256, le HTML LAN aussi.
Chat, Maison et Robot répondent 401 sans session. `deployment.json` conserve ces
preuves ; le nouveau Hub est laissé actif (PID observé 20180).
Un contrôle lancé pendant la construction a vu une ressource 404 ; seul le
contrôle après fin du lanceur constitue la preuve de livraison ci-dessus.

En cas de retour arrière, utiliser les sources/artefacts cohérents précédents,
la configuration et le secret existants, avec la base courante. Ne jamais
écraser les écritures récentes par l'ancienne sauvegarde SQLite. La compatibilité
logicielle a été testée ; aucun rollback du service de production n'a été exécuté.
Le retour à l'ancien code réintroduirait les défauts d'annulation Robot décrits
plus haut : garder le Robot désactivé jusqu'au rétablissement du correctif.

## Non réalisé et limites

- Pas de recette réelle A17/iPhone ni de contrôle des PWA déjà ouvertes. La
  mise à jour est disponible sur le serveur ; aucune base locale/outbox n'a été
  effacée ou forcée.
- Pas de mouvement, réveil, purge réelle, installation ou recette du Pi.
  Son GET d'état était indisponible (`robot-before.json`). Python est inchangé.
- Pas de campagne longue de modèles ni de nouvelle qualification sémantique.
  La gate qualitative Chat reste refusée.
- Pas de modification générale des autres gros modules, d'API, de prompt,
  de protocole ou de dépendances, ni de publication GitHub.
- Aucun défaut d'annulation reproduit dans ce lot ne reste ouvert. Les tests et
  contrôles n'ont détecté aucune régression sur leurs périmètres ; ils ne
  garantissent pas une absence absolue de défauts ou une validation matérielle.

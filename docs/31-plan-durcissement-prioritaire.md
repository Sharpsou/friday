# Friday — plan de durcissement prioritaire

Date : 27 août 2026  
Statut : plan d'implémentation actif ; aucune capacité décrite ci-dessous
n'est considérée comme livrée par ce document

## 1. Objet et autorité

Ce document transforme l'audit technique du dépôt en chantiers exécutables. Il
prépare les évolutions urgentes sans modifier les décisions produit.

L'ordre d'autorité reste le suivant :

1. [état canonique App + Robot](27-etat-canonique-app-robot-2026-08-25.md)
   pour ce qui est réellement implanté, testé, déployé ou recetté ;
2. [décision produit PWA](09-decision-finale-pwa-mvp.md) ;
3. [feuille de route technique](10-feuille-de-route-technique-implementation.md),
   notamment ses gates de section 17 ;
4. ADR et runbooks du domaine ;
5. le présent document pour l'ordre, le découpage et les critères de sortie des
   prochains lots de durcissement.

Une case, une route ou un schéma décrit ici est une **cible**, pas une preuve
d'existence. Chaque livraison devra mettre à jour le document 27 et le runbook
concerné avec ses preuves fraîches.

## 2. Constats qui motivent le plan

L'audit a confirmé une base globalement saine : architecture locale d'abord,
contrats Zod partagés, SQLite canonique, outbox Dexie, protections d'origine,
séparation des profils et assistant sans mutation métier directe. La suite de
vérification du workspace observé passe, mais plusieurs risques restent ouverts.

| Priorité | Constat vérifié                                                                                                                                  | Risque principal                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| P0       | Le runbook de sauvegarde décrit encore une procédure cible, sans commandes ni interface implantées.                                              | Une panne ou une migration peut rendre les données irrécupérables ; le Budget réel reste justement bloqué. |
| P0       | `pnpm audit --prod` remonte deux avis de niveau élevé dans des dépendances transitives (`adm-zip` et `nanoid`).                                  | Dette de chaîne d'approvisionnement et absence de gate reproductible.                                      |
| P0       | Les conflits de synchronisation sont détectés, mais l'utilisateur ne dispose pas du choix explicite entre les deux versions prévu par l'ADR-011. | Une divergence reste bloquée ou devient incompréhensible sur les appareils.                                |
| P0       | L'assignation des tâches repose encore sur deux UUID de slots codés en dur au lieu des identités de membres authentifiés.                        | « Moi » peut désigner un slot historique différent du profil courant.                                      |
| P1       | La vérification locale est riche, mais aucun workflow CI versionné ne l'impose ; audit, secrets et couverture ne sont pas des gates.             | Une régression peut entrer malgré la qualité actuelle du poste de développement.                           |
| P1       | Plusieurs fichiers dépassent deux mille lignes et le chunk principal PWA est proche de 550 kB minifié.                                           | Coût de changement, revues difficiles et chargement initial inutilement concentré.                         |
| P1       | Des chemins de compatibilité ou prototypes paraissent sans appel actif, et plusieurs chiffres/phrases de documentation ont dérivé.               | Code mort conservé par prudence, compréhension et reprise moins fiables.                                   |

Les nombres de tests sont volontairement absents des critères permanents de ce
plan : ils évoluent à chaque lot. Une preuve doit citer la commande, sa date et
son résultat, pas seulement recopier un compteur.

## 3. Ordre d'exécution et dépendances

L'ordre recommandé est le suivant :

1. contenir la dette de dépendances sans changement de données ;
2. implanter et éprouver sauvegarde puis restauration ;
3. remplacer les slots d'assignation après une sauvegarde vérifiée ;
4. implanter le centre de résolution des conflits ;
5. rendre les gates reproductibles en CI et améliorer le diagnostic ;
6. modulariser, réduire le bundle et retirer le code réellement mort ;
7. maintenir la documentation au fil de chaque lot.

La sauvegarde est une dépendance dure de toute migration de données. Les lots 1
et 2 peuvent être préparés ensemble, mais aucune migration d'identité ne doit
être appliquée avant une restauration réussie sur un répertoire vide.

Sont hors périmètre : Google Calendar, Tailscale, Drive au runtime, banque
connectée, RAG, domotique, purge avancée des tombstones et changement de cible
Robot. Leur reprise exige toujours une décision produit distincte.

## 4. Chantier P0-A — maîtriser les dépendances de production

### 4.1 Résultat attendu

Chaque avis de sécurité de production est soit corrigé, soit couvert par une
exception courte, datée et justifiée par une analyse de chemin atteignable. Le
dépôt possède une commande stable qui échoue sur tout nouvel avis non accepté.

### 4.2 Investigation reproductible

1. Capturer `pnpm audit --prod --json` et `pnpm why adm-zip nanoid` depuis un
   lockfile inchangé.
2. Pour chaque avis, identifier le paquet direct, le chemin d'import, les
   versions corrigées et la présence réelle dans un artefact de production.
3. Vérifier spécifiquement :
   - si `onnxruntime-node` ouvre un ZIP contrôlé par un utilisateur ;
   - si le chemin `better-auth > vitest > vite > postcss > nanoid` est réellement
     embarqué au runtime ou seulement résolu par le workspace.
4. Ne pas déduire « non exploitable » du seul fait que l'appel n'a pas encore
   été trouvé : documenter l'entrée, la primitive vulnérable et la barrière.

### 4.3 Stratégie de correction

Préférer, dans cet ordre :

1. mise à jour du paquet direct vers une version qui corrige son graphe ;
2. suppression du paquet ou du chemin fonctionnel devenu inutile ;
3. `pnpm.overrides` ciblé uniquement après tests de compatibilité ;
4. exception temporaire si aucune version compatible n'existe.

Une exception doit être versionnée dans un fichier dédié, avec identifiant
d'avis, chemin de dépendance, portée, justification, propriétaire, date
d'expiration et condition de retrait. Un filtre global ou une désactivation de
l'audit est interdit.

Ajouter des scripts racine distincts :

- `audit:prod` : audit des dépendances de production ;
- `deps:explain` : aide de diagnostic, sans modifier le lockfile ;
- `verify:supply-chain` : audit plus contrôle des exceptions expirées.

Le nom exact peut être adapté au tooling existant, mais `pnpm verify` devra
finalement appeler la gate stable. Pendant la transition, une exception valide
doit rendre la décision explicite sans masquer un nouvel avis.

Le registre de chaîne d'approvisionnement couvre aussi les modèles : origine,
tag exact, licence, date d'installation et empreinte des manifests/poids locaux
quand le runtime permet de les obtenir. Les scripts Friday ne téléchargent ni
modèle ni adaptateur depuis une source choisie par une sortie LLM. Un changement
de modèle reste une action opérateur explicite, puis un smoke test documenté.

### 4.4 Tests et sortie

- réinstallation avec lockfile figé ;
- `pnpm verify` complet ;
- smoke test de chargement de chaque modèle ONNX utilisé, sans mouvement Robot ;
- builds Hub/PWA et inspection du graphe produit ;
- test négatif montrant qu'un avis fictif non accepté fait échouer la gate.

Le chantier est terminé lorsque les deux avis initiaux sont corrigés ou couverts
par des exceptions non expirées et que la CI exécute la même règle.

Retour arrière : restaurer ensemble manifeste et lockfile. Ne jamais revenir au
seul manifeste avec un lockfile produit par une autre résolution.

## 5. Chantier P0-B — sauvegarde chiffrée et restauration prouvée

### 5.1 Résultat attendu

Un propriétaire peut produire une archive chiffrée, vérifier son intégrité et
la restaurer sur un hub vide. La preuve inclut une connexion valide et des
comptages fonctionnels après restauration. La présence d'un fichier ne suffit
jamais.

Le comportement fonctionnel reste celui de l'[ADR-008](adr/008-sauvegarde-portable-chiffree.md)
et du [runbook de sauvegarde](runbooks/sauvegarde-restauration.md).

### 5.2 Format versionné

L'archive chiffrée doit contenir un répertoire sans chemin absolu, avec au
minimum :

```text
manifest.json
friday.sqlite
friday.auth-secret
```

`manifest.json` est validé avant toute écriture et contient notamment :

- `formatVersion`, `backupId`, `createdAt` et version de l'application ;
- versions de schéma SQLite, Dexie et protocole connues du hub ;
- liste fermée, tailles et SHA-256 de chaque entrée ;
- résultat de `PRAGMA integrity_check` et `PRAGMA foreign_key_check` ;
- compteurs non sensibles par table utile à la recette ;
- empreinte du destinataire `age`, jamais la clé privée ;
- état final `complete` uniquement après chiffrement et relecture.

Le manifeste ne doit contenir ni token, ni mot de passe, ni contenu métier en
clair. Le fichier `.auth-secret` n'existe que dans l'enveloppe chiffrée.

### 5.3 Modules Hub

Créer un domaine isolé, par exemple `apps/hub/src/backup/`, avec :

- `backup-service.ts` : orchestration et machine d'état ;
- `sqlite-snapshot.ts` : API de sauvegarde en ligne de `better-sqlite3` ;
- `archive-format.ts` : chemins autorisés, manifeste et checksums ;
- `age-process.ts` : lancement de `age` par arguments explicites, sans shell ;
- `restore-verifier.ts` : ouverture en lecture seule et contrôles fonctionnels.

La machine d'état minimale est : `queued`, `snapshotting`, `verifying`,
`encrypting`, `complete`, `failed`. Si l'historique des exécutions est stocké en
SQLite, allouer la prochaine migration libre au début du lot : ne jamais
présumer ici son numéro alors qu'un autre lot peut l'occuper.

Le snapshot est créé dans un répertoire temporaire sous `D:\FridayData`, puis
ouvert indépendamment. L'archive finale est renommée atomiquement après sa
relecture. Les fichiers temporaires incomplets sont identifiables et supprimés
seulement après validation de leur chemin résolu.

### 5.4 Surface d'administration

Première livraison recommandée : commandes d'administration locales avant une
restauration web.

- `infra/windows/Backup-Friday.ps1` déclenche et vérifie un export ;
- `infra/windows/Restore-Friday.ps1` refuse un hub actif, déchiffre vers un
  répertoire temporaire, valide, sauvegarde la cible actuelle, puis remplace ;
- un mode `-VerifyOnly` ne modifie aucune donnée ;
- toute restauration exige un chemin explicite et une confirmation ; aucun glob
  et aucun défaut vers la racine du workspace.

Une API ultérieure peut exposer `GET /api/admin/backups/status` et
`POST /api/admin/backups`. Elle doit réutiliser l'authentification propriétaire,
la vérification d'origine et les limites de débit existantes. La restauration
reste hors API dans le premier lot pour éviter de remplacer une base active par
une requête distante.

Avant d'exposer un import au navigateur, mettre à jour le modèle de menace avec
les nouvelles frontières : fichier hostile, parseur ZIP, processus `age`, zone
de staging, identité de récupération et passage en maintenance.

### 5.5 Identité de récupération

`age` et la clé de récupération sont des prérequis opératoires :

- seule la clé publique est utilisée par le service de sauvegarde ;
- la clé privée de restauration courante reste sous
  `D:\FridayData\secrets`, conformément à l'ADR-008, et une copie testée est
  conservée séparément dans le gestionnaire du foyer et hors ligne ;
- les ACL de `D:\FridayData` sont vérifiées avant d'autoriser le premier export ;
- Google Drive pourra recevoir une archive déjà chiffrée, jamais la base claire
  ni un mécanisme de synchronisation runtime.

La création et le stockage de la clé privée constituent un checkpoint
utilisateur : l'agent ne choisit pas seul le support de récupération.

### 5.6 Tests obligatoires

- snapshot pendant des lectures et écritures contrôlées ;
- fichier source absent, disque plein simulé et processus `age` en échec ;
- manifeste tronqué, checksum faux, entrée avec traversée de chemin et archive
  incomplète ;
- mauvaise identité `age` et clé correcte ;
- restauration sur répertoire vide, puis `integrity_check`, `foreign_key_check`,
  démarrage du Hub et authentification ;
- restauration d'une sauvegarde N-1 supportée ; refus clair d'un format futur ;
- conservation de la sauvegarde de retour arrière jusqu'à validation humaine.

### 5.7 Déploiement et retour arrière

1. tester uniquement sur une copie de données ;
2. produire une première archive sans automatiser la rétention ;
3. restaurer cette archive dans un répertoire vide ;
4. seulement ensuite activer la planification quotidienne ;
5. garder le Budget réel fermé jusqu'à cette preuve.

Une recette sur les données A17 ou un arrêt du hub exige l'utilisateur. En cas
d'échec, la base active n'est jamais remplacée ; le répertoire temporaire et les
logs expurgés sont conservés pour diagnostic.

## 6. Chantier P0-C — identités réelles pour l'assignation des tâches

### 6.1 Invariant cible

`assigneeProfileId` vaut `null` ou l'identifiant d'un membre actif du foyer. Le
libellé « Moi » est calculé à l'affichage par comparaison avec le profil de la
session ; il n'est jamais persisté comme un slot universel.

### 6.2 Contrats et validation Hub

- conserver un UUID de profil dans le contrat, sans ajouter un pseudo-identifiant
  `me` ;
- valider à l'écriture que le profil appartient au foyer et n'est pas révoqué ;
- renvoyer une erreur métier stable, distincte d'un conflit de révision ;
- inclure les changements d'assignation dans le journal et la voie d'écriture
  unique existants ;
- ne pas autoriser le Chat à appeler cette mutation.

La PWA conserve un cache chiffré minimal des membres utiles à l'affichage et au
choix hors ligne. Un membre absent du cache reste affiché sous une forme neutre,
jamais requalifié automatiquement en « Moi ».

### 6.3 Migration des deux slots historiques

Les UUID codés en dur ne doivent pas être réinterprétés selon l'appareil qui
exécute la migration. La procédure sûre est :

1. détecter les tâches portant un slot historique ;
2. exposer au propriétaire le nombre d'éléments pour chaque slot, sans contenu
   sensible dans les logs ;
3. demander une fois la correspondance `slot historique -> membre réel` ;
4. stocker la décision de migration avec son auteur et sa date ;
5. réécrire toutes les tâches concernées dans une transaction Hub en incrémentant
   les révisions et le journal de changement ;
6. laisser les appareils récupérer la migration par le pull normal ;
7. rendre l'opération idempotente et refuser une seconde correspondance
   contradictoire sans procédure d'administration explicite.

Avant confirmation, la PWA affiche « Profil historique A/B ». Elle ne devine pas
la correspondance parce qu'il existe deux adultes. Ce choix constitue un vrai
checkpoint utilisateur.

### 6.4 Tests et critères de sortie

- même tâche vue par les deux profils : « Moi » change correctement de point de
  vue ;
- création et modification hors ligne, puis synchronisation ;
- profil révoqué entre création et push ;
- foyer avec un seul membre, deux membres et membre historique absent ;
- migration interrompue puis rejouée ;
- réponse perdue après commit sans double révision ;
- sauvegarde et restauration avant/après migration.

Supprimer les constantes historiques seulement après preuve qu'aucune ligne et
aucun client supporté ne les émet encore.

## 7. Chantier P0-D — centre de résolution des conflits

### 7.1 Invariant cible

Un conflit conserve simultanément la proposition locale et la version canonique.
L'utilisateur choisit explicitement laquelle republier. Une résolution est une
nouvelle opération idempotente de l'outbox ; elle ne contourne jamais le Hub.

### 7.2 Stockage local

Préparer la prochaine version Dexie avec une table `conflicts` contenant au
minimum :

- `conflictId`, `entityType`, `entityId`, `operationId` ;
- payload local chiffré et payload canonique chiffré ;
- révisions de base et serveur, raison et dates ;
- état `open`, `resolution_pending`, `resolved` ou `superseded` ;
- référence à l'opération de résolution si elle existe.

La migration Dexie copie les conflits détectables sans effacer l'entité locale.
Si une des deux versions n'est pas encore disponible, l'état reste ouvert et le
pull est relancé ; l'interface ne fabrique pas une version vide.

### 7.3 Protocole de résolution

La première version réutilise l'union `SyncOperation` existante et les schémas
du domaine : le Hub reçoit un upsert normal, pas une commande générique contenant
du JSON arbitraire. Le lien avec `conflictId` reste local ; il permet à la PWA de
suivre la résolution sans élargir le pouvoir du protocole.

Séquence :

1. l'utilisateur choisit version locale ou canonique ;
2. la PWA crée une nouvelle `operationId` et prend la révision serveur observée
   comme `baseRevision` ;
3. le Hub applique la voie d'écriture normale et journalise la nouvelle révision ;
4. si le serveur a encore évolué, il renvoie un nouveau conflit, sans écraser le
   précédent ;
5. la PWA marque `resolved` seulement après accusé de réception **et** pull de la
   version canonique correspondante ;
6. la purge différée suit la politique normale des tombstones et n'est pas
   ajoutée à ce chantier.

### 7.4 Interface

Le bandeau existant mène à un centre de conflits, avec une carte par entité :

- domaine, date, appareil si disponible et résumé des champs divergents ;
- deux colonnes « Sur cet appareil » et « Version du foyer » ;
- choix explicite, confirmation pour suppression contre modification ;
- état de synchronisation et possibilité de reprendre après fermeture.

Les différences sont calculées en mémoire après déchiffrement. Aucun payload
clair ni résumé métier n'est écrit dans les logs, traces ou analytics.

### 7.5 Matrice de tests

- édition concurrente de la même tâche sur deux appareils ;
- suppression contre modification ;
- courses, agenda et budget avec leurs validations spécifiques ;
- choix effectué hors ligne, puis nouveau changement serveur avant push ;
- réponse HTTP perdue après commit ;
- fermeture/rechargement pendant `resolution_pending` ;
- conflit déjà résolu par un autre appareil ;
- absence de fuite en logs et conservation des deux versions jusqu'à preuve.

La sortie exige les tests automatisés et une recette réelle à deux sessions. Une
simple simulation mono-navigateur ne prouve pas le comportement multi-appareil.

## 8. Chantier P1-A — CI, couverture et diagnostic exploitable

### 8.1 Workflow versionné

Ajouter un workflow GitHub Actions Windows, car il représente le chemin de
production et les scripts PowerShell. Il doit :

1. installer les versions Node, pnpm et Python fixées par le dépôt ;
2. restaurer uniquement le cache du store pnpm ;
3. exécuter une installation à lockfile figé ;
4. lancer `pnpm verify` puis `verify:supply-chain` ;
5. conserver rapports, traces Playwright et journaux expurgés en cas d'échec.

Un job Linux rapide peut être ajouté pour les unités portables, mais ne remplace
pas le job Windows. La protection de branche est un réglage GitHub externe et
nécessite une validation utilisateur avant mutation.

### 8.2 Couverture progressive

Activer les rapports de couverture sans inventer immédiatement un seuil élevé :

1. enregistrer la ligne de base par paquet ;
2. interdire d'abord la baisse globale et afficher les fichiers non couverts ;
3. fixer ensuite des seuils sur les domaines critiques : auth, sync, migrations,
   sauvegarde et assistant en lecture seule ;
4. augmenter les seuils par lots courts.

Les migrations ne sont pas exclues de la couverture : elles ont besoin de tests
N-1 et de rejouabilité. Le code généré peut être exclu avec justification.

### 8.3 TypeScript, secrets et santé

- activer `noUnusedLocals` et `noUnusedParameters` d'abord en commande de
  diagnostic, corriger le stock, puis en gate ;
- ajouter un scanner de secrets versionné ou une action épinglée par SHA ;
- documenter les faux positifs, jamais les secrets ;
- étendre le diagnostic propriétaire avec versions de schéma, dernier backup
  réussi et état des migrations ;
- garder `/health` minimal et sans information sensible ; l'état de l'outbox
  reste local à la PWA.

Le chantier est sorti lorsque la même révision produit le même verdict sur un
poste propre et en CI, avec artefacts suffisants pour comprendre un échec.

### 8.4 Régressions de sécurité Assistant

Le modèle de menace couvre déjà l'injection directe et indirecte. La CI doit en
faire une propriété testée, sans transformer le Chat en agent :

- messages, sources Web et résultats MCP restent étiquetés comme données non
  fiables et ne peuvent déclencher ni SQL, ni shell, ni mutation métier ;
- corpus adversarial direct et pages contenant des instructions, texte caché,
  fausses citations ou URL internes ;
- validation des sorties structurées, citations inconnues et URL avant
  persistance ou affichage ;
- rendu Markdown sans HTML brut, schémas d'URL dangereux refusés et CSP testée ;
- limites d'entrée, sortie, temps, concurrence et crédits par profil/foyer, avec
  dégradation explicite si Ollama ou un fournisseur Web est indisponible ;
- aucune clé, prompt brut sensible, thinking ou contenu d'audit invalide dans les
  logs et messages d'erreur.

Ces tests figent les protections actuelles ; ils n'autorisent aucun nouvel outil
LLM. La règle non négociable « le Chat n'a aucune mutation métier directe » reste
la barrière principale contre l'agence excessive.

## 9. Chantier P1-B — modularisation, performance et code mort

### 9.1 Règle de découpage

Chaque lot est sans changement fonctionnel, sauf annonce contraire. Extraire un
domaine, faire passer ses tests, puis seulement passer au suivant. Éviter une
réécriture simultanée du Hub et de la PWA.

### 9.2 Hub et contrats

- déplacer les routes de `app.ts` dans des plugins par domaine ;
- centraliser les préconditions de mutation : session, appartenance au foyer,
  origine de confiance, débit et idempotence ;
- conserver le fichier d'assemblage comme composition explicite ;
- séparer les contrats par domaine tout en gardant un barrel compatible ;
- extraire les migrations en modules immuables et tester chaque transition ;
- découpler orchestration, persistance et adaptateurs des services Assistant et
  Veille.

Une centralisation de garde ne doit pas élargir une autorisation. Des tests de
table doivent comparer les règles avant et après extraction pour chaque route de
mutation.

### 9.3 PWA et bundle

- extraire les destinations et contrôleurs métier de `App.tsx` ;
- charger paresseusement les destinations lourdes non nécessaires à Aujourd'hui ;
- conserver un shell offline immédiatement disponible ;
- vérifier que Workbox précache les chunks versionnés utiles et gère un ancien
  onglet après déploiement ;
- enregistrer la taille actuelle comme plafond de non-régression avant de fixer
  un objectif plus bas ;
- viser d'abord la disparition de l'avertissement Vite du chunk principal, sans
  déplacer artificiellement tout le poids dans un chunk chargé au démarrage.

Mesurer taille brute, gzip/brotli et chemin réellement chargé. La valeur minifiée
seule ne suffit pas.

### 9.4 Inventaire de suppression

Pour chaque candidat, rechercher imports, routes, manifests, configurations de
déploiement et clients anciens avant suppression. Les candidats initiaux sont :

- moteur et manifeste SSD MobileNet si aucun déploiement ne les référence ;
- méthodes clientes Robot non appelées ;
- suggestion de sources Veille si elle n'a plus de consommateur supporté ;
- mapping seed Budget isolé ;
- packages workspace de configuration/test restés placeholders ;
- paramètre `mode` inutilisé de la planification de recherche.

La route Robot historique d'armement est une compatibilité documentée : elle ne
doit être retirée qu'après une fenêtre annoncée et vérification des clients
déployés. « Aucun import TypeScript » n'est pas une preuve suffisante pour une
API réseau.

Chaque suppression doit réduire le graphe produit ou la surface maintenue et
être couverte par build, tests et recherche finale du symbole.

## 10. Chantier P1-C — remettre la documentation sous contrôle

### 10.1 Corrections ciblées

- clarifier dans le document 09 que la décision Calendar initiale est remplacée
  par l'état canonique : sept destinations et Calendar non implanté ;
- corriger le guide long : version SQLite, nature TypeScript de Playwright et
  statut actuel de Veille ;
- éviter les compteurs de tests copiés dans plusieurs documents, ou les dater et
  les marquer comme photographies ;
- documenter les variables d'environnement réellement supportées, en séparant
  obligatoire, optionnel et diagnostic ;
- classer explicitement les checkpoints historiques qui ne font plus autorité.

### 10.2 Contrôles automatiques

Ajouter une commande de documentation qui vérifie :

- liens Markdown relatifs ;
- formatage ;
- absence de références à des fichiers supprimés ;
- cohérence d'un petit ensemble de faits machine lisibles : versions de schéma,
  destinations actives et commandes de vérification.

Ces faits doivent avoir une source unique importée ou lue par le contrôle, pas
une nouvelle copie manuelle. Les nuances produit ne doivent pas être réduites à
des tests de chaînes fragiles.

## 11. Découpage en lots livrables

| Lot | Contenu                                | Gate de départ                        | Preuve de sortie                                           |
| --- | -------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| 1   | Dépendances et gate d'audit            | Lockfile proprement identifié         | Audit expliqué, corrections/exception datée, `pnpm verify` |
| 2a  | Format, snapshot et chiffrement backup | Outil `age` et répertoire sûr validés | Archive relue, contrôles SQLite verts                      |
| 2b  | Restauration hors ligne                | Archive 2a valide                     | Hub vide restauré, login et données contrôlés              |
| 3   | Identités d'assignation                | Backup/restauration prouvés           | Migration confirmée, deux profils et hors ligne testés     |
| 4a  | Stockage/protocole des conflits        | Identités stables                     | Deux versions conservées, résolution idempotente           |
| 4b  | Centre de conflits                     | 4a vert                               | Recette réelle deux sessions                               |
| 5   | CI, couverture et diagnostic           | Commandes locales stables             | Verdict reproductible et artefacts d'échec                 |
| 6   | Découpage et nettoyage incrémental     | CI verte                              | Aucun changement de comportement, bundle mesuré            |
| 7   | Normalisation documentaire             | À chaque lot                          | Index, canonique et runbooks cohérents                     |

Chaque lot runtime suit les gates du document 10 : tests ciblés, `pnpm verify`,
puis recette locale. Un déploiement A17 n'est déclaré qu'après la commande de
recette prévue par `AGENTS.md` et son health check. Une recette physique Robot,
une restauration des données réelles ou une validation UX multi-appareil reste
distincte des tests automatisés.

## 12. Checkpoints utilisateur réels

Une intervention est nécessaire avant :

1. choix et stockage du support contenant l'identité privée `age` ;
2. arrêt du Hub et répétition d'une restauration réelle ;
3. correspondance définitive entre slots d'assignation historiques et membres ;
4. validation UX du centre de conflits sur deux sessions ;
5. activation de la protection de branche GitHub ;
6. toute réouverture de Calendar, Tailscale ou Budget réel.

Le reste peut être préparé et testé sur copies ou données synthétiques sans
élargir le périmètre produit.

## 13. Checklist de clôture de chaque chantier

- [ ] distinction écrite entre code, test, déploiement et recette réelle ;
- [ ] migrations montante et retour arrière documentés ;
- [ ] données existantes préservées et sauvegarde vérifiée si nécessaire ;
- [ ] contrats et erreurs stables documentés ;
- [ ] tests unitaires, intégration, perte de réponse et mode hors ligne adaptés ;
- [ ] logs expurgés de secrets et de contenu privé ;
- [ ] `pnpm verify` frais, sans extrapoler un résultat antérieur ;
- [ ] runbook du domaine mis à jour ;
- [ ] document 27 mis à jour avec la preuve réelle ;
- [ ] dette temporaire munie d'un propriétaire et d'une date de retrait.

## 14. Définition de la fin du plan

Le plan est achevé lorsque :

- une restauration complète a été prouvée sur un hub vide ;
- aucune alerte de dépendance élevée n'est silencieusement ignorée ;
- les tâches utilisent les identités réelles des membres ;
- chaque conflit conserve et présente les deux versions puis passe par l'outbox ;
- la CI impose les gates locales ;
- le chunk initial et les grands modules ont une trajectoire mesurée et les
  chemins morts confirmés ont disparu ;
- README, état canonique, décisions et runbooks ne se contredisent plus sur les
  fonctions actives.

Avant ces preuves, les éléments restent respectivement « planifiés », « testés
sur copie » ou « implantés localement », jamais « livrés » par anticipation.

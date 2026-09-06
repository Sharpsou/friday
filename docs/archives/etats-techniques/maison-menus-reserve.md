# Runbook Maison — Courses, Menus et Réserve

Statut documentaire : archive.

> Version cumulative conservée depuis `docs/runbooks/maison-menus-reserve.md` au commit `894a50d`. Ses états et commandes restent datés. Consulter le [runbook actuel](../../runbooks/maison-menus-reserve.md).

Date : 5 septembre 2026. Déployé sur l’origine A17 ; recette des deux téléphones
encore ouverte, distincte des contrôles automatisés et du déploiement serveur.

## Décision produit

Maison remplace Courses dans la navigation et ouvre Courses par défaut.
Courses conserve ses entrées libres, photos manuscrites, correction de lecture,
classement et corrections apprises, mode En course, achats, réouverture et
suppression. Les recettes, repas et réserves sont partagés entre les profils.
Les brouillons IA restent privés jusqu’à l’enregistrement d’une recette.

Menus propose Planning et Recettes. Une recette peut commencer par son nom ;
l’absence d’ingrédients reste affichée. Chaque modification produit une nouvelle
version. Les préparations conservent leur version et peuvent adopter une autre
version explicitement. Une préparation est distincte des repas qui lui prennent
des portions. Les repas extérieurs et annulés ne demandent aucun ingrédient.
Aujourd’hui et Agenda affichent les mêmes objets, sans création de tâches ;
le filtre « Afficher les menus » contrôle leur visibilité dans l’Agenda.

Le catalogue suggère des recettes quantifiées, en privilégiant la moins récente
puis le nombre de produits manquants. La proposition et la copie de planning
préservent les créneaux déjà occupés. Une période couvre au plus 31 jours.

## Gestes quotidiens

1. Ajouter les recettes manuellement, ou corriger une proposition locale/Web.
2. Choisir les dates, midi/soir, personnes, plats et portions. Affecter les repas
   suivants à la même préparation pour réutiliser des portions.
3. Renseigner seulement les réserves utiles : emplacement, quantité ou état,
   seuil éventuel, date limite facultative et dernière confirmation.
4. Ouvrir « Préparer / actualiser les courses ». Vérifier les ingrédients non
   quantifiés, les réserves affectées, les courses déjà présentes et exclusions.
   La confirmation accepte aussi les réductions présentées. Une course libre
   peut être reliée explicitement ; aucune ressemblance ne fusionne des lignes.
5. Acheter avec Courses, puis « Ranger les achats » : quantités réellement
   reçues, emplacement ou Ignorer. La coche seule n’ajoute aucun stock.
6. « Préparé » : confirmer les ingrédients utilisés, le rendement réel, un repas
   éventuellement mangé immédiatement et l’emplacement des restes.
7. « Mangé » consomme les restes. Dans Réserve, « Mangé / jeté / corriger »
   permet d’ajuster les portions. Aucun passage du temps ne consomme de stock.

Pour une préparation partielle ou une perte qui rend les repas suivants
impossibles, ajuster ces repas avant de confirmer le bilan ; l’erreur conserve
la saisie et empêche un solde incohérent. Une date de repas antérieure à sa
préparation est refusée avec explication. Aucune durée de conservation n’est
inférée à partir du planning.

Les seuils consolident les entrées d’un produit : un ancien lot vide ne masque
pas un lot reçu plus récemment. La suggestion de réachat est unique et explicite.
La prédiction des habitudes, Google Calendar, nutrition, prix et achats
automatiques restent hors de cette version.

## Code et persistance

| Couche                                                | Point d’entrée                                             |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Contrats Zod                                          | `packages/contracts/src/maison.ts`                         |
| Calculs purs, portions, unités, affectation et seuils | `packages/domain/src/maison.ts`                            |
| Transactions SQLite et idempotence                    | `apps/hub/src/maison/maison-sync.ts`                       |
| Cache chiffré, outbox, résolution des conflits        | `apps/web/src/db/maison-repository.ts`                     |
| Commandes locales composites                          | `apps/web/src/maison-actions.ts`                           |
| Écrans et bilans                                      | `apps/web/src/MaisonView.tsx`, `apps/web/src/maison/`      |
| Ordonnanceur global                                   | `apps/hub/src/inference/inference-scheduler.ts`            |
| Propositions privées                                  | `apps/hub/src/maison/menu-ai-service.ts`, `menu-plugin.ts` |

Migration SQLite **45**, après vérification de l’état réel 44 ; Dexie **9**,
après 8. `maison_records` stocke les objets validés avec révision et suppression
logique. Les mouvements et reçus sont immuables ; les corrections créent des
mouvements supplémentaires. Les recettes sont versionnées. Les index uniques
protègent version de recette, contribution aux courses et cycle d’achat rangé.

Les quantités utilisent des entiers en millièmes et des intermédiaires BigInt.
Les conversions usuelles restent masse/masse ou volume/volume. Les autres
correspondances sont explicites par produit ; les contradictions sont refusées.
L’affectation parcourt toutes les préparations prévues avant le filtrage des
dates d’achat. Elle exclut les entrées inconnues, à vérifier et dépassées.
Les contributions aux courses portent la quantité structurée ; `quantityText`
reste la présentation et la saisie libre historique de la ligne de courses.

Une commande `maison_command` est conservée dans l’outbox et transmise par
`/api/sync/push`, en ligne comme hors ligne. Elle regroupe au plus 250 objets et
100 écritures de courses dans une transaction. Un renvoi reprend le même
identifiant et le même résultat. Un conflit conserve le bilan chiffré et ne
valide aucune partie de la commande sur le serveur.

La PWA négocie le domaine via `GET /api/sync/maison-snapshot` (version 1), puis
`/api/sync/pull?after=…&maison=1`. L’ancienne PWA ne reçoit que ses types connus
et avance sur le curseur global. Une page de pull ne coupe jamais une commande
composite ; la PWA applique ses objets Maison, ses courses et le curseur dans
une seule transaction locale. L’instantané initialise les nouveaux domaines
sans vider l’outbox ni avancer son curseur. Un ancien Hub laisse les commandes
Maison en attente, tout en acceptant les domaines existants.

En cas de conflit, ouvrir le bilan Maison et « Comparer avec le foyer ».
« Reprendre la version du foyer » écarte explicitement tout l’ensemble de bilans
en conflit liés aux mêmes objets. Les écritures encore en attente empêchent
cette résolution. Les anciens bilans restent chiffrés dans l’historique outbox ;
les quantités souhaitées se ressaisissent depuis la version canonique.

## IA et confidentialité

Un ordonnanceur par Hub coordonne Chat, Menus, classement, photo et Veille,
générations et embeddings compris. FIFO entre appels prêts, un seul appel
actif ; annulation propagée, délai modèle démarré après acquisition du créneau.
Le classement remet une éventuelle seconde tentative dans cette file.

`POST /api/menus/ai-jobs` est idempotent et répond 202. Les routes GET de liste
et de détail ainsi que DELETE d’annulation sont limitées au profil authentifié.
Les jobs SQLite reprennent après redémarrage ; annuler ne relance pas un job.
La limite de quatre demandes en cours est partagée avec la file Chat, et la
file des appels prêts possède sa borne propre. Les photos restent temporaires
en mémoire, sans archivage pour attendre un redémarrage.

Menus utilise le même moteur `VerifiedChatEngine` et les mêmes adaptateurs Web.
Une seconde passe produit une fiche Zod, toujours à corriger avant partage.
Les champs numériques non retrouvés restent inconnus. Une proposition Web
structurée conserve le statut partiel, sans prétendre que ses quantités sont
vérifiées ; une proposition locale est non vérifiée. Les sources proviennent
du résultat du moteur, avec URL HTTP(S), jamais du JSON inventé par le modèle.
Les brouillons, prompts et pages ne deviennent aucun stock et aucun outil
d’écriture métier n’est ajouté au Chat. L’indicateur global affiche le domaine
occupé, sans texte privé des autres profils.

## Vérification sans toucher au site utilisé

Le Hub actuel sert directement `apps/web/dist`. Utiliser impérativement une
sortie isolée pour vérifier un prochain candidat avant sa livraison :

```powershell
$env:FRIDAY_E2E_PORT = '18443'
pnpm verify
```

`pnpm verify` impose `.verification/web` pour `FRIDAY_WEB_OUT_DIR` et
`FRIDAY_WEB_ROOT`, même si une autre valeur est fournie.
Ces variables ne sont pas persistées dans Windows. Le serveur Playwright est
isolé et utilise une base de test ; le runtime réel n’est pas redémarré.
Le scénario `Maison covers a two-day preparation, shopping, reserve and offline
catalogue` produit `output/playwright/maison-recettes-mobile.png`.

Bilan final du 5 septembre : `pnpm verify` réussi, **448 tests hors navigateur
et 29 scénarios Playwright**, format/lint/typage/builds réussis. La recette mobile
automatisée inclut les régressions photo manuscrite, classement, mode En course,
achats hors ligne, Agenda, Chat et Veille. La capture mobile a été inspectée.
Les deux modes de génération ont ensuite abouti avec Ollama réel sur une base
isolée : une proposition locale non vérifiée et une proposition Web partielle
avec cinq sources. Les quantités non établies restent inconnues, et aucune
recette du foyer n’est créée par ces tests. Rapport :
`D:\FridayData\evaluations\maison-delivery-20260905\report.json`.
Ce contrôle fonctionnel ne valide ni la qualité culinaire, ni les téléphones.

Le schéma envoyé au décodeur Ollama conserve la structure et les enums, mais
omet les bornes numériques et de longueur que sa grammaire ne sait pas compiler.
La validation Zod complète reste appliquée au résultat avant toute proposition ;
un test vérifie notamment le rejet d’un rendement hors borne.

## Sauvegarde, migration et retour arrière

Le contrôle suivant prend une sauvegarde SQLite cohérente par l’API online,
restaure une seconde copie, migre uniquement cette copie et compare les données
des tables existantes sans les afficher :

```powershell
pnpm --filter @friday/hub exec tsx src/maison/check-migration.ts D:/FridayData/friday.sqlite D:/FridayData/backups
```

Le dossier généré contient `before.sqlite`, `restored.sqlite` et `report.json`.
La source est ouverte en lecture seule. Ces fichiers restent sur le PC sous
`D:\FridayData`, ne doivent pas être publiés et ne constituent pas une sauvegarde
portable chiffrée de l’authentification.

Preuve du 5 septembre :
`D:\FridayData\backups\maison-migration-BZMsFL\report.json` : migration 44 → 45,
intégrité `ok`, données de toutes les tables antérieures inchangées.
La base canonique est désormais en 45, avec intégrité vérifiée après livraison.

La livraison combinée Maison/Chat a été autorisée par l’utilisateur après la
suspension initiale ; la gate qualitative du Chat reste refusée. Pour une
prochaine livraison, refaire une sauvegarde immédiatement avant le déploiement,
conserver les artefacts précédents et supprimer les éventuelles variables de
sortie isolée de la session :

```powershell
Remove-Item Env:FRIDAY_WEB_OUT_DIR -ErrorAction SilentlyContinue
Remove-Item Env:FRIDAY_WEB_ROOT -ErrorAction SilentlyContinue
infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Le déploiement du 5 septembre a terminé avec code 0. Les health checks local et
LAN, le schéma 45, l’intégrité et la correspondance du HTML servi avec le build
sont consignés dans `D:\FridayData\evaluations\maison-delivery-20260905\deployment.json`.
Le [rapport de livraison](../../audits/2026-09-05-livraison-maison.md) précise les
artefacts de retour arrière et leurs limites.

Ce lanceur concerne le runtime familial : ne pas l’utiliser pour une simple
prévisualisation isolée. Si la migration doit être annulée, arrêter les écritures,
conserver d’abord une copie de la base 45 et des outbox mobiles, remettre ensemble
la sauvegarde préalable et les artefacts précédents. Ne pas restaurer par-dessus
des opérations mobiles en attente. Les données Maison créées après le snapshot
exigent une reprise explicite ; aucun effacement d’IndexedDB n’est une procédure
de retour arrière. Conserver le secret d’authentification existant hors Git.

## Recette réelle restante

Sur les deux téléphones : ouvrir Maison, contrôler la photo et les rayons,
planifier plusieurs jours, partager un plat de six portions, préparer les courses,
acheter hors connexion, reconnecter, ranger, cuisiner et manger les restes.
Modifier ensuite le même stock sur les deux appareils pour vérifier le message
de conflit et sa résolution. Contrôler aussi Agenda, une mise à jour de PWA avec
outbox en attente et l’enrichissement IA depuis l’interface du téléphone.

Consigner séparément résultat automatisé, sauvegarde/restauration, déploiement
et validations UX A17/iPhone. Le succès Playwright ne vaut pas recette des
appareils, ni validation qualitative du Chat.

## Maintenance du 6 septembre

Les commandes PWA sont dans `apps/web/src/maison/commands/`, avec un barrel
compatible `maison-actions.ts`. Les éditeurs Réserve sont dans `maison/editors/`.
Identité et clé sont arbitrées dans `db/device-context.ts`, l'outbox dans
`db/outbox-repository.ts`, les acquittements et changements dans `db/sync-repository.ts`.
Les transactions des commandes composites et l'AAD sont inchangés.

L'admission Menus compte tous les jobs actifs en SQL, indépendamment des 40 jobs
affichés. Après un retour à un ancien Hub, une incompatibilité Maison est
revalidée avant de laisser passer les écritures des domaines supportés ; les
commandes Maison restent en attente. Voir le [bilan](../../audits/2026-09-06-implementation-qualite-et-modularisation.md).
SQLite 45 est la migration historique Maison ; la version globale actuelle est 47.

Déploiement de la modularisation confirmé le 6 septembre à 10 h 33 : voir le
[bilan de livraison](../../audits/2026-09-06-deploiement-modularisation.md).
La version globale reste SQLite 47 / Dexie 9 ; la recette téléphones reste ouverte.

## Complément du 6 septembre 2026 — 12 h 04

Le complément des cinq modules est déployé, SQLite 47 / Dexie 9. Les états
React restent attachés à l'application et les commandes/sync Maison sont
inchangées. Les parcours mobiles automatisés, dont les brouillons conservés
en navigation/offline, passent. La recette des deux téléphones reste distincte.

Voir le [bilan de livraison](../../audits/2026-09-06-complement-cinq-modules.md).

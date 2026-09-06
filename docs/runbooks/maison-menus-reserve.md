# Runbook Maison — Courses, Menus et Réserve

Statut documentaire : actif.

Révision : 6 septembre 2026, après la livraison de 12 h 04. Déployé sur l’origine A17 ; recette des deux téléphones
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

Maison a introduit la migration SQLite **45** et Dexie **9**. La version
globale courante est SQLite **47** / Dexie **9** ; voir le [document 27](../27-etat-canonique-app-robot-2026-08-25.md). `maison_records` stocke les objets validés avec révision et suppression
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

Les résultats chiffrés sont dans les rapports de [livraison Maison](../audits/2026-09-05-livraison-maison.md), de [modularisation](../audits/2026-09-06-deploiement-modularisation.md) et du [complément de 12 h 04](../audits/2026-09-06-complement-cinq-modules.md).
Les contrôles Ollama isolés du 5 septembre ne valident ni la qualité culinaire,
ni les téléphones, ni la campagne qualitative Chat. L'[ancien runbook](../archives/etats-techniques/maison-menus-reserve.md) conserve les détails datés.

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

La preuve historique de migration 44 → 45 est conservée dans le [rapport Maison](../audits/2026-09-05-livraison-maison.md). Pour le runtime actuel et les sauvegardes de référence, suivre le [document 27](../27-etat-canonique-app-robot-2026-08-25.md) et le dernier rapport de livraison.

Avant une livraison runtime autorisée, refaire une sauvegarde cohérente et conserver
les artefacts précédents. Le lanceur familial décrit dans le [runbook Windows](../../infra/windows/README.md) ne sert pas à une vérification documentaire.
Pour un retour arrière, arrêter les écritures, conserver la base actuelle et les outbox,
puis reprendre ensemble sauvegarde, secret d'authentification et artefacts compatibles.
Les opérations postérieures au snapshot exigent une reprise explicite. Ne jamais
restaurer par-dessus des opérations mobiles en attente ni effacer IndexedDB pour les résoudre.

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
commandes Maison restent en attente. Voir le [bilan](../audits/2026-09-06-implementation-qualite-et-modularisation.md).
Le [complément livré à 12 h 04](../audits/2026-09-06-complement-cinq-modules.md) conserve les états React attachés à l'application et les contrats de commandes/sync Maison.
Les parcours mobiles automatisés couvrent les brouillons conservés en navigation/offline.
La recette réelle des deux téléphones reste ouverte.

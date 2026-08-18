# Recette iPhone — mise à jour de la PWA

Date : 18 août 2026

Statut : validation partielle ; l'utilisateur confirme le 9 août 2026 que l'iPhone a bien reçu une mise à jour, puis le 18 août que Chrome iOS ne zoome plus automatiquement au focus des champs Tâche et Course après application du correctif WebKit à 16 px minimum. Le zoom manuel reste disponible. Le déclencheur exact de la première mise à jour, la conservation détaillée des données, l’appairage et le parcours offline restent à rejouer pour fermer la recette.

## Préconditions

- Friday est ouverte depuis son icône ajoutée à l'écran d'accueil ;
- l'origine est exactement `https://192.168.1.14:8443` ;
- le certificat Friday est installé et déclaré fiable dans les réglages iOS ;
- l'écran Aujourd'hui indique zéro modification en attente avant toute réinstallation éventuelle.

## Scénario normal

1. noter une tâche ou un produit déjà visible dans Friday ;
2. laisser cette version ouverte puis la placer en arrière-plan ;
3. déployer une nouvelle version sur le hub ;
4. revenir dans Friday : la recherche de mise à jour doit repartir au retour au premier plan ;
5. si le bandeau n'apparaît pas, toucher l'état `Connecté` ou `Hors ligne` ;
6. vérifier l'apparition de `Une mise à jour est prête.` et toucher `Mettre à jour` ;
7. vérifier le rechargement, la présence de la donnée témoin et la reprise de la synchronisation ;
8. répéter une fois après fermeture complète de Friday.

## Amorçage de la version corrigée

La version iPhone antérieure ne possède pas encore les nouveaux déclencheurs. Si elle ne reçoit jamais cette première mise à jour :

1. remettre le hub en ligne et vérifier que l'attente est à zéro ;
2. ne pas poursuivre si une donnée locale reste à synchroniser ;
3. supprimer Friday de l'écran d'accueil, ouvrir l'origine dans Safari puis l'ajouter de nouveau à l'écran d'accueil ;
4. se reconnecter ou réappairer l'appareil si Friday le demande ;
5. reprendre le scénario normal avec une évolution suivante.

## Résultat à consigner

| Cas                                  | Bandeau visible | Mise à jour appliquée | Données conservées | Résultat     |
| ------------------------------------ | --------------- | --------------------- | ------------------ | ------------ |
| essai du 9 août, déclencheur inconnu | non consigné    | oui                   | non consigné       | partiel      |
| retour au premier plan               | à renseigner    | à renseigner          | à renseigner       | à renseigner |
| clic sur l'état de connexion         | à renseigner    | à renseigner          | à renseigner       | à renseigner |
| fermeture complète puis ouverture    | à renseigner    | à renseigner          | à renseigner       | à renseigner |

## Auto-zoom des formulaires

Le candidat du 18 août applique uniquement sur WebKit iOS une taille calculée minimale de 16 px aux champs textuels, listes et zones de texte. Il ne modifie pas le viewport, ne bloque pas le pincement manuel et ne change pas les tailles Android.

Résultat physique communiqué par l’utilisateur : dans Chrome sur l’iPhone, les champs Tâche et Course ne déclenchent plus l’agrandissement automatique. Ce résultat valide ce défaut UX précis, pas l’authentification, la persistance offline ni la convergence à deux appareils.

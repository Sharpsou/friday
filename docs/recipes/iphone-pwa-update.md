# Recette iPhone — mise à jour de la PWA

Date : 9 août 2026

Statut : validation partielle ; l'utilisateur confirme le 9 août 2026 que l'iPhone a bien reçu une mise à jour. Le déclencheur exact et la conservation détaillée des données n'ont pas été consignés ; les scénarios ci-dessous restent à rejouer pour fermer la recette.

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

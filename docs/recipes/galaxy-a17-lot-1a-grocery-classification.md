# Recette Galaxy A17 — classement des courses par rayon

Date : 9 août 2026

Statut : **checkpoint physique ouvert**

## Préparation

- lancer le candidat avec `Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning` ;
- ouvrir Friday sur le Galaxy A17 avec une session appairée ;
- ajouter au moins six produits, dont `pommes`, `lait`, `croquettes Nouchka` et un libellé personnel ambigu.

## Parcours à confirmer

1. Dans `Courses`, appuyer sur `Classer par rayon`.
   Si une ancienne proposition Granite est encore visible, la fermer et lancer un nouveau job afin de tester le protocole indexé avec Ministral 3 8B.
2. Vérifier que l'indicateur `Classement en arrière-plan` reste visible en naviguant vers `Agenda` puis `Aujourd'hui`.
3. Ajouter ou cocher une course pendant le traitement : l'action doit rester immédiate.
4. Relancer un classement puis appuyer sur `Arrêter` : l'état devient `Classement interrompu` et aucun rayon partiel n'est appliqué.
5. Relancer, fermer complètement la PWA, la rouvrir puis vérifier que le job ou son résultat est retrouvé.
6. Quand le classement est prêt, ouvrir l'aperçu, corriger un rayon et appliquer.
7. Vérifier que la liste se regroupe directement par rayon, sans sélecteur `Liste`/`Rayons`, dans l'ordre générique et en fusionnant les produits d'un même rayon.
8. Ajouter ensuite un nouveau produit : il doit apparaître dans `À classer` sans perturber les rayons existants.
9. Couper le Wi-Fi et rouvrir Friday : la vue classée reste lisible, les courses restent modifiables et le bouton de classement explique que le hub est nécessaire.
10. Reconnecter le Wi-Fi et confirmer la convergence sans doublon.

## Redémarrage du hub

1. Lancer un classement contenant au moins un libellé inconnu.
2. Redémarrer uniquement le hub pendant `Classement en arrière-plan`.
3. Vérifier que le job reprend puis produit un seul aperçu.

## Résultat

- [ ] indicateur global et application utilisable pendant le job ;
- [ ] arrêt sans application partielle ;
- [ ] reprise après fermeture de la PWA ;
- [ ] reprise après redémarrage du hub ;
- [ ] correction puis partage du classement ;
- [ ] cache classé utilisable hors ligne ;
- [ ] aucune perte ni duplication de course.

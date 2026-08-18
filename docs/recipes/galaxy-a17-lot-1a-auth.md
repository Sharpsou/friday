# Recette Lot 1A — authentification fermée et appairage

- Statut : **candidat automatisé validé — propriétaire initialisé, appairage/révocation physiques à réaliser**
- Appareil principal : Samsung Galaxy A17
- Second appareil : téléphone de l'autre adulte, ou second navigateur réel pour la recette initiale
- Objectif : vérifier l'initialisation fermée, la continuité offline, l'appairage à usage unique, l'identité des écritures et la révocation.

## Prérequis

1. Lancer le candidat avec `infra/windows/Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning`.
2. Ouvrir Friday sur l'A17 à l'origine HTTPS habituelle.
3. Ne pas effacer les données du site : les tâches locales existantes doivent être conservées par la migration.
4. Choisir une phrase secrète d'au moins 12 caractères, différente entre les deux adultes. Elle reste locale au foyer et ne doit pas être inscrite dans cette recette.

Observation du 9 août 2026 : le propriétaire a initialisé le foyer. Le RG405M sous Android 12 et Firefox 151.0.3 atteint Friday mais affiche encore un avertissement de certificat ; cela ne valide ni la confiance HTTPS ni l'appairage. L'essai iPhone est reporté.

## Parcours propriétaire sur l'A17

1. Au premier lancement du hub authentifié, vérifier que Friday demande d'initialiser le foyer et ne propose aucune inscription publique.
2. Saisir le nom, un identifiant Friday simple comme `adulte1`, la phrase secrète et le nom `Galaxy A17`. Aucune adresse e-mail n'est demandée.
3. Vérifier que l'application s'ouvre, que les tâches déjà présentes sont toujours visibles et que les nouvelles synchronisations reviennent à `Connecté`.
4. Arrêter le hub, fermer puis rouvrir Friday : l'A17 doit afficher le cache local et permettre une écriture hors ligne avec le profil déjà lié.
5. Réactiver les données mobiles tout en laissant le Wi-Fi et le VPN coupés, puis rouvrir Friday : le cache doit s’afficher sans rester sur `Ouverture du foyer`, même si Android considère le téléphone connecté à Internet.
6. Relancer le hub : l'attente doit revenir à zéro sans doublon.

## Appairage du second adulte

1. Sur l'A17 connecté en propriétaire, ouvrir la roue dentée puis la section `Foyer et appareils`.
2. Générer un code : il doit contenir 8 chiffres et afficher une expiration proche de 10 minutes.
3. Sur le second appareil, ouvrir Friday, choisir `J'ai un code`, puis saisir ses propres nom, identifiant Friday, phrase secrète, nom d'appareil et le code.
4. Vérifier que le second adulte accède aux mêmes tâches et qu'une tâche créée depuis son appareil porte son profil de responsable/auteur après synchronisation.
5. Tenter de réutiliser le même code dans un autre contexte : l'appairage doit être refusé.

## Révocation

1. Sur l'A17 propriétaire, revenir dans `Foyer et appareils`, repérer le second appareil et choisir `Révoquer`.
2. Sur le second appareil encore en ligne, relancer ou attendre une synchronisation : elle doit être refusée et Friday doit redemander un accès.
3. Couper le réseau du second appareil avant un nouvel essai : son cache déjà téléchargé peut rester lisible. C'est une limite volontaire du MVP ; la révocation bloque le serveur mais n'efface pas un téléphone à distance.
4. Vérifier que l'A17 propriétaire continue à synchroniser normalement.
5. Depuis l'A17, générer un nouveau code, puis appairer le même compte du second adulte sur un nouvel appareil avec sa phrase secrète : le nouvel appareil doit synchroniser et l'ancien rester refusé.

## Oubli et remplacement du second adulte

1. Après avoir révoqué son appareil, choisir `Oublier le second adulte` dans `Foyer et appareils`.
2. Vérifier que Friday explique que les données partagées restent conservées, puis confirmer l'oubli.
3. Générer un nouveau code et appairer un second adulte avec un nouvel identifiant et une nouvelle phrase secrète.
4. Vérifier que l'appairage réussit et que les tâches déjà attribuées au rôle de second adulte sont toujours visibles.

## Résultat à consigner

- date et heure de la recette ;
- appareils et navigateurs utilisés ;
- conservation des tâches antérieures : oui/non ;
- écriture offline puis convergence : oui/non ;
- code unique et expirant : oui/non ;
- tâche du second profil : oui/non ;
- révocation effective au prochain échange serveur : oui/non ;
- anomalie visuelle ou fonctionnelle observée.

Ne pas déclarer le comportement A17 ou second téléphone validé avant ce retour physique.

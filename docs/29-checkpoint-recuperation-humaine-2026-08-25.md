# Checkpoint Robot — récupération humaine apprenante

Date : 25 août 2026

Statut : **implanté logiciellement, recette physique ouverte**

## Décision challengée

Une reprise manuelle après une exploration autonome est une information utile,
mais elle ne prouve pas à elle seule que le robot était coincé ni que chaque
mouvement humain était optimal. Deux intentions sont donc distinguées :

- `Récup` est un signal fort et explicite : l’utilisateur déclare que la
  politique courante a besoin d’aide ;
- `Manuel` pendant une exploration est un signal faible : la manœuvre est
  observée, sans supposer sa cause.

Dans les deux cas, Friday apprend après le résultat et non au seul clic. Cette
validation évite de renforcer un détour inutile, une manipulation de confort ou
une action que l’autonomie ne pourrait pas reproduire en sécurité.

## Parcours utilisateur

1. En mode `Autonome`, appuyer sur `Récup`.
2. La boucle autonome s’arrête, le mode devient manuel et le joystick reprend
   la main. Carto conserve sa pose et continue selon son état courant.
3. Dégager ou réorienter le robot avec les commandes manuelles habituelles.
4. Appuyer sur `Rendre la main`.
5. Le hub évalue la séquence, l’accepte ou la rejette, écrit le verdict dans le
   journal Friday puis relance une nouvelle exploration autonome.

`ARRÊT`, le switch `Roues` et les mouvements physiques à la main ne sont pas
interprétés comme des démonstrations de conduite. Le déplacement à la main
reste traité par la relocalisation du checkpoint 26.

## Validation et apprentissage

Les commandes joystick sont projetées dans l’espace d’actions fermé de Dyna-Q :
rotation gauche/droite, avance à 10–20 % avec direction, ou recul d’échappement.
Les répétitions consécutives sont compressées. La collecte est bornée à cinq
minutes, cent commandes et douze étapes distinctes.

Une démonstration explicite est acceptée si :

- elle contient au moins 200 ms de commande et un déplacement ou changement de
  cap mesurable par Carto ;
- la localisation reste exploitable ;
- elle ne crée pas un nouvel obstacle détecté ;
- au moins une étape appartient au masque d’actions autorisé par les capteurs.

Une reprise implicite par `Manuel` doit en plus dégager un obstacle détecté ou
augmenter objectivement le potentiel, les objets ou les points de vue de la
carte. Les étapes hors masque sont historisées mais exclues de l’apprentissage.
Avec les seuls IR avant actuels, un recul humain n’est donc appris que dans
l’état où le recul d’échappement est déjà admissible ; le robot n’invente pas
une sûreté arrière qu’il ne possède pas.

Une séquence validée est injectée comme transitions supervisées dans le même
agent Dyna-Q persistant. La dernière étape reçoit une récompense positive
modérée. Pour un `Récup` explicite, la dernière action autonome différente peut
recevoir une petite pénalité, seulement si elle appartenait elle-même au masque
autorisé. Il n’existe ni second modèle opaque ni exécution directe d’un trajet
humain mémorisé.

## Persistance et reprise

La migration SQLite 25 ajoute
`robot_human_recovery_demonstrations` : run source, intention, état source,
action précédente, séquence compressée, durée, poses de début/fin, score,
verdict et motif. Une collecte interrompue par redémarrage est rejetée avec le
motif `hub_restart`. Aucun run autonome ne reprend automatiquement.

## API et interface

- `POST /api/robot/autonomy/recovery` : propriétaire et origine de mutation
  fiable uniquement ;
- `POST /api/robot/drive` : ajoute la commande à une collecte active après son
  exécution et la mise à jour Carto ;
- `POST /api/robot/autonomy/start` : évalue la démonstration avant le prochain
  cycle autonome ;
- `GET /api/robot/autonomy` : expose seulement intention, nombre de commandes
  et début de collecte à l’interface.

Le bouton `Récup` n’est visible que pendant une exploration. Pendant la reprise,
`Autonome` devient `Rendre la main` et l’interface affiche le nombre de commandes
observées.

## Niveau de preuve et recette physique

Les tests automatisés couvrent la projection des commandes, l’acceptation d’un
`Récup` mesurable, le rejet sans mouvement, l’acceptation d’une reprise faible
seulement après amélioration capteur, la migration 25, l’API et le parcours
mobile. Ils ne prouvent pas encore la qualité physique de la politique.

Première recette : zone dégagée et arrêt accessible, placer volontairement le
robot dans une situation simple où un IR voit un obstacle, lancer `Autonome`,
appuyer sur `Récup`, effectuer une rotation courte autorisée, puis `Rendre la
main`. Vérifier le verdict dans le journal et observer plusieurs situations
comparables avant de conclure à une amélioration. Ne pas augmenter la vitesse
pour cette recette.

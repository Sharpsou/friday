# Checkpoint — relocalisation visuelle AlphaBot2

Date : 25 août 2026

Statut : **dernière verticale Robot implantée ; état App + Robot consolidé dans
le [document 27](27-etat-canonique-app-robot-2026-08-25.md)**

## État implanté

- SQLite est à la migration 24. Les poses brutes ne sont jamais écrasées ; les
  coordonnées corrigées portent une révision et une source.
- Le PC calcule des signatures ORB 320×240 dans un processus OpenCV headless.
  Les personnes détectées sont masquées avant extraction.
- Au plus 600 signatures et 12 Mio sont conservés. Une signature contient une
  empreinte perceptuelle, des points/descripteurs, la pose caméra et les objets
  visibles, mais aucune nouvelle image.
  Les ancres de boucle sont supprimées en dernier, sans pouvoir dépasser le
  plafond dur de stockage.
- Une correspondance automatique exige au moins 30 matches, 18 inliers RANSAC,
  45 % d’inliers, trois quadrants couverts, un score de 0,72 et deux
  observations cohérentes. Un objet générique n’est jamais une preuve unique.
- Une boucle parcourue ajoute une contrainte SE(2) et détend le graphe de poses.
  Les objets, viewpoints, images-clés et signatures suivent la correction.
- Un changement de scène répété sans incrément de commande signale un
  déplacement physique probable. Les vues de transport ne sont pas persistées.
  Une reconnaissance confirmée ouvre un nouveau segment à la pose retrouvée.
- `Je l’ai déplacé` invalide explicitement la pose. `Va là` reste suspendu
  pendant `relocalizing`/`lost` ; après cinq secondes sans solution,
  l’exploration autonome peut continuer avec les actions à 10 % et les capteurs.
- Les dix premières fermetures observent seulement les écarts. Ensuite les
  coefficients d’odométrie évoluent d’au plus 2 % par correction et restent
  dans les bornes cinématiques définies par la migration.

## Installation et exploitation

Le runtime reste hors dépôt sous
`D:\FridayData\robot\localization-venv`. L’installation idempotente est :

```powershell
infra\windows\Setup-FridayRobotLocalization.ps1
```

Le worker est optionnel au démarrage du hub : une panne de reconnaissance
visuelle journalise une dégradation et laisse l’odométrie fonctionner. Le
contrôle matériel et son watchdog restent sur le Pi.

## Limites et recette restante

- Une caméra monoculaire ne fournit toujours ni profondeur absolue ni pose
  métrique garantie. La carte reste approximative.
- Les seuils doivent être recettés dans l’appartement réel, notamment faible
  lumière, murs peu texturés et meubles répétitifs.
- Aucune réussite physique de fermeture de boucle ou de robot soulevé n’est
  affirmée avant la recette décrite dans le runbook.

## Vérification et déploiement

- `pnpm verify` passe le 25 août 2026 : 21 tests Python, 22 contrats,
  15 domaine, 145 hub, 91 web et 25 parcours Playwright mobiles.
- Le worker OpenCV 4.14.0 a extrait 457 points sur l’image de contrôle et a
  retrouvé la même vue avec 396 inliers sur 396 correspondances.
- Une sauvegarde cohérente de la migration 23 est conservée hors dépôt sous
  `D:\FridayData\backups\friday-pre-relocalisation-visuelle-20260825-2035.sqlite` ;
  son contrôle d’intégrité SQLite vaut `ok`.
- Le candidat a été reconstruit et redémarré sans navigateur. Le health check
  répond sur `/api/health`, la base réelle est en migration 24 et son contrôle
  d’intégrité vaut `ok`.

# Exploitation Windows

## Raccourci de recette P0

Installer ou actualiser le raccourci du Bureau :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Install-DesktopShortcut.ps1
```

`Friday - Lancer et recetter` construit la version courante, démarre le hub, attend le health check, ouvre Google Chrome et rappelle la recette. Le terminal visible appartient uniquement au mode recette : appuyer sur Entrée à la fin pour arrêter proprement le hub.

`Friday - Lancer ou redemarrer` construit la version courante puis lance le hub s'il est arrêté, ou redémarre uniquement le processus Friday qui écoute déjà sur le port `8443`. Il reste en arrière-plan et n'ouvre ni Chrome ni terminal visible.

Après une évolution validée, le hub peut être reconstruit et redémarré en
arrière-plan sans ouvrir Chrome :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\windows\Start-FridayRecipe.ps1 -NoBrowser -ExitAfterHealthCheck -RestartExisting -KeepHubRunning
```

Ce redémarrage refuse d'arrêter un processus inconnu qui occuperait le port
`8443`. Le raccourci de recette conserve son fonctionnement interactif.

Le lanceur utilise Node.js et Corepack depuis l’installation Windows. Un shim `pnpm` limité au processus de recette permet aux scripts imbriqués de fonctionner sans modifier le `PATH` global de l’utilisateur.

Sans certificat, le lanceur reste volontairement sur `127.0.0.1`. Dès que le certificat et la clé de la recette A17 existent dans `D:\FridayData`, le même raccourci écoute en HTTPS sur le LAN et affiche l’URL du téléphone.

Le raccourci ponctuel `Friday - Configurer acces A17` demande l’autorisation administrateur, vérifie le nom du réseau au moment de son installation, classe cette connexion en `Private` et crée une règle entrante limitée à TCP 8443, au profil privé, au programme Node.js et à `LocalSubnet`. Le lanceur principal reste limité à `127.0.0.1` tant que le réseau actif n’est pas privé.

L’usage normal visera ensuite un lancement Windows sans terminal visible. Les scripts de diagnostic, sauvegarde et restauration seront ajoutés aux lots correspondants.

# Développement local de Friday

## Prérequis

- Node.js 24 ;
- pnpm 11.16.x ;
- Python 3 pour les tests du runtime Robot et le worker OpenCV ;
- Windows pour le hub cible ;
- Google Chrome stable installé localement pour les E2E ; Playwright le lance explicitement avec le canal `chrome`.

## Installation reproductible

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm-workspace.yaml` autorise les scripts d'installation de trois dépendances
seulement : `better-sqlite3`, `esbuild` et `onnxruntime-node`. Les versions sont
verrouillées par `pnpm-lock.yaml`.

## Boucle de développement

```powershell
pnpm dev
```

- Web Vite : `http://127.0.0.1:5173` ;
- hub : `http://127.0.0.1:8443` ;
- Vite relaie `/api` vers le hub, de sorte que le navigateur utilise toujours une URL relative de même origine.

La boucle HTTP est limitée à la machine locale. Le hub refuse une écoute LAN sans certificat et clé TLS.

## Build de production local

```powershell
pnpm build
pnpm preview
```

Fastify sert alors `apps/web/dist` et `/api/*` depuis `http://127.0.0.1:8443`. La recette LAN remplace HTTP par HTTPS.

## Répertoire de données

Sans configuration, Windows utilise `%LOCALAPPDATA%\Friday\friday.sqlite`. Pour imposer un autre répertoire hors du code :

```powershell
$env:FRIDAY_DATA_DIR = 'D:\FridayData'
```

Le répertoire ne doit pas être placé dans Google Drive. Les fichiers SQLite, logs, sauvegardes temporaires, certificats privés et secrets sont ignorés par Git.

## Variables LAN HTTPS

```powershell
$env:FRIDAY_HOST = '0.0.0.0'
$env:FRIDAY_PORT = '8443'
$env:FRIDAY_TLS_CERT_PATH = 'D:\FridayData\certificates\friday-lan.pem'
$env:FRIDAY_TLS_KEY_PATH = 'D:\FridayData\secrets\friday-lan-key.pem'
pnpm preview
```

Ne jamais placer la clé de l'autorité `mkcert` ni la clé serveur dans le dépôt. Une écoute LAN sans les deux fichiers est refusée au démarrage.

## Vérifications ciblées

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

La commande de référence reste `pnpm verify`.

Pour un poste qui exécute le Robot réel, installer aussi le worker de
relocalisation hors dépôt :

```powershell
infra\windows\Setup-FridayRobotLocalization.ps1
```

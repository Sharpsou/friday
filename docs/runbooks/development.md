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

## Vérification isolée et architecture — 6 septembre 2026

`pnpm verify` impose `.verification/web` comme sortie et racine Web, puis
contrôle format, lint, typage, architecture, tests, builds et scénarios E2E.
Avant le build, le wrapper vide cette sortie jetable après vérification du
chemin réel ; il refuse une redirection par lien. Vite ne la vide pas lui-même
car elle se trouve hors de la racine de son projet. Ce nettoyage évite que
d'anciens chunks entrent dans le précache ou masquent une erreur offline.
Le build Hub est reconstruit ; le Hub de production n'est pas redémarré.
Pour reproduire les preuves du lot avec données jetables :

```powershell
Get-ChildItem Env:FRIDAY_* | Remove-Item
$env:FRIDAY_ROBOT_MODE = 'disabled'
$env:FRIDAY_DATABASE_PATH = ':memory:'
$env:FRIDAY_DATA_DIR = "$env:TEMP/Friday-verification"
$env:FRIDAY_E2E_PORT = '18443'
$env:FRIDAY_CHAT_ENABLED = 'true'
$env:FRIDAY_CHAT_PIPELINE = 'unified'
pnpm verify
```

`pnpm architecture` teste la garde puis analyse les imports TypeScript locaux,
réexports, imports dynamiques littéraux et `require` littéraux. Les liens de
types seuls sont exclus des cycles d'exécution. Les sources applicatives et
packages sont couvertes ; chargements calculés, CSS et Python restent hors de
cette garde. Aucune exception de cycle n'est autorisée actuellement. Les socles
d'inférence et de stockage local ne doivent pas dépendre des écrans ou du transport.

Les 29 scénarios navigateur sont répartis par domaine dans `tests/e2e/` avec
`fixtures.ts` pour l'authentification. Un seul worker partage le Hub en mémoire ;
cela ne remplace pas les tests de concurrence dédiés aux services. Après un build
isolé, une suite se rejoue seule, avec un nouveau Hub :

```powershell
$env:FRIDAY_WEB_ROOT = "$PWD/.verification/web"
pnpm exec playwright test tests/e2e/maison.spec.ts
```

Chaque test dispose d'un contexte navigateur neuf. Le Hub est neuf pour chaque
invocation Playwright. Ne pas déplacer des fixtures privées du foyer dans les tests.
La carte des modules, les exceptions de taille et les preuves sont dans le
[bilan d'implémentation](../audits/2026-09-06-implementation-qualite-et-modularisation.md).

## Complément du 6 septembre 2026 — 12 h 04

Les cinq exceptions de taille de la première modularisation sont traitées.
La vérification complète passe avec 557 tests et sans cycle d'exécution.
Les preuves de comparaison, l'environnement isolé, les compatibilités dans les
deux sens et les sauvegardes sont dans le bilan. Les scripts privés de
transformation ne sont pas idempotents : ne pas les relancer. Le build initial
est à 312,29 kB (91,29 kB gzip) ; Budget demeure différé.

Voir le [bilan de livraison](../audits/2026-09-06-complement-cinq-modules.md).

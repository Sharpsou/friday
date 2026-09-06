# Installer Friday sur Windows

Statut documentaire : actif. Révision : 6 septembre 2026.

Ce parcours utilise les sources du dépôt et une base neuve. Il ne clone ni les données
du foyer de référence ni ses certificats. Les paramètres locaux de ce foyer restent
dans les runbooks. Le projet n'accorde actuellement aucune licence de réutilisation.

## Prérequis

- Windows, Git et [Node.js 24](https://nodejs.org/en/download).
- pnpm version 11, au moins 11.16. Le manifest épingle 11.16.0 ; conserver le lockfile.
- Python 3 pour les tests sans GPIO et Google Chrome installé pour le canal E2E `chrome`.
- Pour HTTPS LAN : une adresse réservée sur le routeur, un réseau Windows privé et
  [mkcert](https://github.com/FiloSottile/mkcert#installation).
- Ollama et les modèles ne sont requis que pour les usages IA. Le Robot reste désactivé
  sans matériel ni configuration explicite. Aucun service Google n'est nécessaire.

Vérifier `git --version`, `node --version`, `pnpm --version` et `python --version`.
Si pnpm est absent, l'installation officielle par npm est `npm install -g pnpm@11.16.0` ;
ne pas remplacer une autre installation pnpm nécessaire à vos projets sans en tenir compte.

## Sources et dépendances

```powershell
git clone https://github.com/Sharpsou/friday.git
Set-Location friday
pnpm install --frozen-lockfile
```

Les scripts de dépendances autorisés sont déclarés dans `pnpm-workspace.yaml`.
Si une dépendance native échoue, conserver le message exact et vérifier Node 24,
la plateforme et les prérequis indiqués ; ne pas débloquer tous les scripts arbitrairement.

## Premier lancement local

Ouvrir un processus PowerShell dédié et définir des variables de session :

```powershell
$env:FRIDAY_DATA_DIR = Join-Path $env:LOCALAPPDATA 'Friday'
$env:FRIDAY_HOST = '127.0.0.1'
$env:FRIDAY_PORT = '8443'
$env:FRIDAY_PUBLIC_ORIGIN = 'http://127.0.0.1:5173'
$env:FRIDAY_ROBOT_MODE = 'disabled'
$env:FRIDAY_CHAT_ENABLED = 'false'
pnpm dev
```

Ouvrir `http://127.0.0.1:5173`. Vite relaie `/api` vers le Hub loopback sur 8443.
Le Hub refuse une écoute LAN sans certificat et clé TLS. Le mode développement
ne valide pas l'installation offline du service worker de production.

L'écran de première ouverture permet d'initialiser le propriétaire : nom, identifiant
Friday, phrase secrète d'au moins douze caractères et nom d'appareil. Aucun e-mail
n'est nécessaire. Le bootstrap se ferme ensuite. Ne pas recréer une base pour résoudre
un mot de passe oublié : aucune restauration utilisateur complète n'est implantée.

Le Hub crée SQLite et un secret d'authentification associé hors Git. Conserver ce
secret avec les mesures de protection appropriées ; le changer invalide les sessions.
`FRIDAY_DATABASE_PATH` a priorité sur le chemin déduit de `FRIDAY_DATA_DIR`.
Sans variables, Windows utilise `%LOCALAPPDATA%\Friday\friday.sqlite`.

Les commandes actuelles ne chargent pas automatiquement `.env`. Le fichier
[.env.example](../../.env.example) est une référence : passer les variables dans
PowerShell ou dans le mécanisme de lancement choisi. Aucun secret ne doit porter un
préfixe `VITE_`, qui le destinerait au client.

## Vérifier avant usage

Suivre le [runbook développement](../runbooks/development.md) dans un autre processus
avec base jetable et port 18443. `pnpm verify` impose `.verification/web` et ne remplace
pas les fichiers PWA utilisés par le foyer. Il reconstruit néanmoins Hub et packages.
Les tests Robot sont simulés et les scénarios IA ne nécessitent pas de téléchargement de modèle.

## HTTPS sur votre réseau local

Choisir l'adresse LAN réservée de votre PC. Ne pas réutiliser l'adresse, l'autorité
ou les clés du foyer de référence. Les exemples ci-dessous demandent votre adresse :

```powershell
$fridayLanIp = Read-Host 'Adresse IPv4 LAN réservée de ce PC'
$fridayData = Join-Path $env:LOCALAPPDATA 'Friday'
New-Item -ItemType Directory -Force -Path "$fridayData/certificates", "$fridayData/secrets"
mkcert -install
mkcert -cert-file "$fridayData/certificates/friday-lan.pem" -key-file "$fridayData/secrets/friday-lan-key.pem" $fridayLanIp localhost 127.0.0.1
```

Exporter uniquement le certificat public `rootCA.pem` du dossier indiqué par
`mkcert -CAROOT`, puis installer cette autorité sur les appareils concernés.
Ne jamais partager `rootCA-key.pem` ou la clé serveur. Sur iPhone, le profil installé
doit aussi être explicitement approuvé dans les réglages de confiance des certificats.

Ouvrir uniquement TCP 8443 pour le programme Node sur le réseau privé local ; ne pas
ouvrir la box ni exposer Ollama. Examiner les règles Node génériques existantes.
L'installation du certificat et le pare-feu sont des opérations administrateur
à effectuer consciemment. Les scripts du pilote ne dispensent pas de vérifier leurs paramètres.

Arrêter la boucle `pnpm dev` de votre nouvelle installation avant d'occuper le même port :

```powershell
$env:FRIDAY_DATA_DIR = $fridayData
$env:FRIDAY_HOST = '0.0.0.0'
$env:FRIDAY_PORT = '8443'
$env:FRIDAY_PUBLIC_ORIGIN = "https://${fridayLanIp}:8443"
$env:FRIDAY_TLS_CERT_PATH = "$fridayData/certificates/friday-lan.pem"
$env:FRIDAY_TLS_KEY_PATH = "$fridayData/secrets/friday-lan-key.pem"
pnpm build
pnpm preview
```

Vérifier `/api/health` puis ouvrir cette origine sur le téléphone. Android Chrome
propose l'installation ; Safari permet « Sur l'écran d'accueil ». Appairer le second
adulte avec le code généré dans « Foyer et appareils ». Attendre le snapshot initial.
Rejouer les scénarios de la [recette A17](../recipes/galaxy-a17-p0.md) avec vos paramètres
et consigner séparément vos résultats, sans réutiliser les validations du foyer.

L'origine comprend protocole, hôte et port. La changer crée un autre stockage navigateur.
Synchroniser avant une migration d'origine ; une régénération du certificat seule ne
transfère ni IndexedDB ni l'outbox. Ne pas contourner une alerte TLS pour une installation fiable.

## IA facultative

Ollama reste sur `http://127.0.0.1:11434`. Vérifier `ollama list` et installer
explicitement les modèles nécessaires, en tenant compte de leur taille et de votre matériel.
Friday ne télécharge pas automatiquement les modèles.

| Usage                          | Configuration                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Chat et propositions Menus     | `FRIDAY_CHAT_ENABLED=true`, `FRIDAY_CHAT_PIPELINE=unified` ; voir le runbook Chat   |
| Rédaction / audit / embeddings | Gemma E4B QAT, Qwen 3.5 9B Q4, Qwen Embedding 0.6B selon le harnais actuel          |
| Classement                     | `FRIDAY_GROCERY_CLASSIFICATION_MODEL`, défaut `ministral-3:8b`                      |
| Photo                          | `FRIDAY_GROCERY_PHOTO_MODEL` ; modèle et limites au code/configuration de référence |
| Veille                         | `FRIDAY_WATCH_MODEL`, défaut Qwen 3.5 9B Q4                                         |
| Recherche Web                  | `FRIDAY_TAVILY_API_KEY` hors Git ; appels partageant le budget Hub                  |

Consulter la [configuration détaillée](../reference/configuration.md) et le
[runbook Chat](../runbooks/assistant-gemma.md). La gate qualitative reste refusée :
l'activation est un choix, pas une garantie de fiabilité. Sans IA, conserver les
fonctions Maison manuelles et Budget. Le Robot suit un [parcours distinct](../runbooks/robot-alphabot2.md).

## Exploitation et dépannage

Les [scripts Windows](../../infra/windows/README.md) gèrent le pilote et ses raccourcis.
Le lancement en arrière-plan ne constitue pas un service Windows installé ni une
garantie de démarrage après reboot. Aucun installateur universel ou démarrage automatique
complet n'est promis. Conserver le chemin de données et l'origine lors d'une mise à jour.

| Problème             | Vérification                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| Port occupé          | Identifier le processus ; ne pas arrêter un service inconnu                        |
| LAN refusé           | Certificat et clé présents, réseau privé, pare-feu et origine correcte             |
| Auth/origine refusée | `FRIDAY_PUBLIC_ORIGIN` correspond exactement à l'URL du navigateur                 |
| Variable ignorée     | Session PowerShell du processus Hub ; `.env` non chargé automatiquement            |
| Chat indisponible    | Gate d'activation, Ollama, modèles et Hub ; ne pas effacer le cache                |
| Base inattendue      | Priorité de `FRIDAY_DATABASE_PATH`, puis `FRIDAY_DATA_DIR`                         |
| Offline incomplet    | Première synchronisation, build de production, confiance TLS et espace de stockage |

Avant mise à jour runtime : sauvegarde SQLite cohérente avec secret/configuration
protégés, contrôle de restauration, vérification puis procédure Windows autorisée.
La [sauvegarde portable chiffrée](../runbooks/sauvegarde-restauration.md) reste une cible ;
aucune commande produit inexistante ne doit être exécutée. Les données financières
réelles restent derrière la porte Budget. Git ne sauvegarde pas vos données personnelles.

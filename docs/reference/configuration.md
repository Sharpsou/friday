# Configuration de Friday

Statut documentaire : reference. Révision : 6 septembre 2026.

Les variables sont lues par le processus Hub, Vite ou le lanceur Windows. Les commandes
actuelles ne chargent pas `.env` automatiquement. [.env.example](../../.env.example)
donne les valeurs de départ ; passer les secrets seulement dans l'environnement protégé.

| Variable                                                        | Effet et défaut                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FRIDAY_HOST`                                                   | `127.0.0.1` ; autre écoute refusée sans certificat et clé                                                                 |
| `FRIDAY_PORT`                                                   | `8443`                                                                                                                    |
| `FRIDAY_DATA_DIR`                                               | `%LOCALAPPDATA%\Friday` sous Windows, sinon dossier `data` ; garder hors Git                                              |
| `FRIDAY_DATABASE_PATH`                                          | Prioritaire sur le chemin SQLite déduit du répertoire de données ; `:memory:` pour test seulement                         |
| `FRIDAY_PUBLIC_ORIGIN`                                          | URL réellement utilisée par le navigateur ; défaut construit depuis TLS/hôte/port, insuffisant si hôte d'écoute `0.0.0.0` |
| `FRIDAY_TRUSTED_ORIGINS`                                        | Origines autorisées supplémentaires séparées par virgules ; ne pas utiliser pour masquer une erreur de configuration      |
| `FRIDAY_TLS_CERT_PATH`, `FRIDAY_TLS_KEY_PATH`                   | Certificat serveur et clé hors Git ; tous deux requis pour LAN                                                            |
| `FRIDAY_AUTH_SECRET`                                            | Secret fourni explicitement ou généré/persisté avec SQLite ; ne pas remplacer à chaque démarrage                          |
| `FRIDAY_AUTH_ATTEMPT_LIMIT`                                     | Limite de tentatives ; les valeurs élevées E2E ne sont pas un réglage de production                                       |
| `FRIDAY_OLLAMA_URL`                                             | Loopback Ollama, défaut `http://127.0.0.1:11434`                                                                          |
| `FRIDAY_CHAT_ENABLED`                                           | Seule la chaîne `true` active Chat et propositions Menus                                                                  |
| `FRIDAY_CHAT_PIPELINE`                                          | Valeur `unified` pour la voie active du Hub ; voir les interactions ci-dessous                                            |
| `FRIDAY_CHAT_AXES_ENABLED`                                      | Hors unified, `true` choisit axes ; sinon chemin legacy                                                                   |
| `FRIDAY_TAVILY_API_KEY`                                         | Secret du fournisseur Web ; absent signifie recherche indisponible selon l'usage                                          |
| `FRIDAY_GROCERY_CLASSIFICATION_MODEL`                           | Modèle de classement, défaut `ministral-3:8b`                                                                             |
| `FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS`                      | Délai modèle de classement, défaut 120000 ; attente de file séparée                                                       |
| `FRIDAY_GROCERY_PHOTO_MODEL`, `FRIDAY_GROCERY_PHOTO_TIMEOUT_MS` | Surcharges du transcripteur photo ; vérifier ses valeurs par défaut dans le module                                        |
| `FRIDAY_WATCH_MODEL`, `FRIDAY_WATCH_TIMEOUT_MS`                 | Modèle Veille Qwen 3.5 9B Q4 par défaut et délai facultatif                                                               |
| `FRIDAY_ROBOT_MODE`                                             | `disabled` par défaut ; `alphabot2` exige URL et jeton explicites                                                         |
| `FRIDAY_WEB_OUT_DIR`                                            | Sortie Vite ; `.verification/web` imposée par verify                                                                      |
| `FRIDAY_WEB_ROOT`                                               | Racine statique Hub ; `apps/web/dist` par défaut, sortie isolée sous verify                                               |
| `FRIDAY_E2E_PORT`                                               | Port du Hub E2E ; wrapper de vérification à 18443 par défaut                                                              |

Le cœur Chat seul a unified comme défaut ; l'adaptateur Hub choisit unified seulement
sur cette valeur exacte, puis départage axes/legacy avec le flag axes. Ne pas inventer
une variable `FRIDAY_CHAT_PIPELINE=legacy` qui serait un mode validé autonome.

Le lanceur Windows peut relire les flags Chat persistés dans l'environnement utilisateur
quand la session n'en possède pas. Il peut aussi charger la configuration Robot du foyer.
Une vérification sûre nettoie uniquement les variables du processus de test et désactive
le Robot ; elle ne change pas l'environnement utilisateur persistant.

Sources : [main Hub](../../apps/hub/src/main.ts), [composition](../../apps/hub/src/app.ts),
[adaptateur Chat](../../apps/hub/src/chat/verified-chat-engine.ts),
[photo](../../apps/hub/src/groceries/ollama-photo-transcription-engine.ts),
[lanceur Windows](../../infra/windows/Start-FridayRecipe.ps1) et [Vite](../../apps/web/vite.config.ts).
Les variables spécifiques vision/Pi et leurs secrets sont détaillés dans les
[runbooks Robot](../runbooks/robot-alphabot2.md) et [README Python](../../robot/README.md).

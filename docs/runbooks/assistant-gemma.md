# Assistant local

## Runtime

L’Assistant propose quatre choix : `Auto`, `Web rapide`, `Web approfondi` et `Classique`.

- `Web rapide` utilise `ministral-3:8b`, une requête de recherche directe et une seule synthèse avec un contexte de 32768 tokens. Le contrôle déterministe retire les identifiants de sources inexistants.
- `Web approfondi` utilise `gemma4-12b-multimodal:128k` pour planifier, rédiger puis vérifier la réponse avec un contexte de 131072 tokens.
- `Auto` choisit le Web rapide pour les questions factuelles courantes, et le Web approfondi pour les demandes longues, comparatives ou sensibles. Les demandes sans besoin d’actualité peuvent rester classiques.
- `Classique` utilise Gemma 4 sans recherche Web.

Chaque génération impose `num_predict=4096`, une génération Friday à la fois et un `keep_alive` de deux minutes. Le client HTTP Ollama accepte jusqu’à douze minutes avant d’abandonner une génération longue.

Après le premier échange d’une conversation encore nommée `Nouvelle conversation`, le modèle déjà utilisé produit un titre français de 3 à 6 mots avec `num_predict=24`. Cette finalisation est limitée à 30 secondes, n’écrase jamais un renommage manuel et son échec ne fait pas échouer la réponse principale.

Variables facultatives du hub :

```text
FRIDAY_ASSISTANT_MODEL=gemma4-12b-multimodal:128k
FRIDAY_ASSISTANT_FAST_MODEL=ministral-3:8b
FRIDAY_ASSISTANT_TIMEOUT_MS=720000
FRIDAY_ASSISTANT_GOOGLE_ENABLED=false
```

`FRIDAY_ASSISTANT_GOOGLE_ENABLED` reste désactivé tant qu’une recherche canari Playwright reçoit HTTP 429 ou un captcha. Friday ne résout jamais les captchas. DuckDuckGo HTML, Brave et Bing restent les moteurs de repli.

Pour empêcher Ollama de charger plusieurs modèles ou contextes en parallèle, configurer le processus Ollama puis le redémarrer avec :

```text
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_QUEUE=8
```

Ces paramètres appartiennent au serveur Ollama, pas au processus Friday. OpenFox et OpenCode restent extérieurs à la file Friday ; si l’un d’eux utilise Ollama, Friday attend sans l’interrompre.

## Diagnostic

- `queued` persiste dans SQLite et survit au redémarrage.
- Une exécution interrompue est reprise une fois, puis passe en échec après une deuxième interruption.
- `awaiting_search_consent` ne conserve ni Gemma ni Playwright occupé.
- Les contenus complets des pages ne sont pas conservés : seules les métadonnées et preuves bornées sont stockées.
- Le cache mobile et l’outbox Assistant sont chiffrés par la clé de l’appareil.

## Recette minimale

1. Créer deux conversations avec le premier profil et vérifier leur persistance.
2. Envoyer une demande classique, une demande Web rapide et une demande Web approfondie ; contrôler le modèle annoncé, les citations et l’absence de seconde étape de vérification en mode rapide.
3. Couper le réseau du téléphone, envoyer un message, recharger la PWA puis rétablir le réseau.
4. Placer simultanément une demande dans chaque profil et vérifier l’alternance.
5. Annuler une génération active et vérifier qu’aucune réponse partielle n’est publiée.
6. Rechercher une donnée personnelle et vérifier la demande de consentement.
7. Ne déclarer A17 ou iPhone validé qu’après cette recette physique.

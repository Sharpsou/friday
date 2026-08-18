# Chat Ollama multi-modèle avec Tavily et Exa MCP

Date : 11 août 2026

## Configuration

```text
FRIDAY_ASSISTANT_MODEL=gemma4-12b-multimodal:128k
FRIDAY_ASSISTANT_QWEN_MODEL=qwen3.5:9b-q4_K_M
FRIDAY_ASSISTANT_TIMEOUT_MS=720000
FRIDAY_TAVILY_API_KEY=tvly-...
```

La clé Tavily active Tavily. Le mode approfondi peut aussi utiliser anonymement `https://mcp.exa.ai/mcp`, sans configuration, compte ou moyen de paiement. Sans preuve issue des moteurs disponibles, Friday rend un diagnostic et ne fabrique pas de réponse Web locale. La clé Tavily ne doit jamais être placée dans la PWA, Git ou un fichier servi au navigateur.

Pour le lancement Windows, définir la variable dans le compte qui lance Friday, puis redémarrer le hub :

```powershell
[Environment]::SetEnvironmentVariable('FRIDAY_TAVILY_API_KEY', 'tvly-...', 'User')
```

Ouvrir ensuite un nouveau terminal ou relancer depuis le raccourci Bureau. Ne pas afficher la valeur dans les journaux.

## Runtime

Ollama reste sur `127.0.0.1:11434`. La PWA appelle uniquement le hub. Le streaming est désactivé et le modèle par défaut est `qwen3.5:9b-q4_K_M`. La roue dentée permet de le remplacer par `gemma4-12b-multimodal:128k` pour les nouveaux messages ; le modèle du run est ensuite immuable.

Le tag officiel Qwen occupe environ 6,6 Go, annonce 9,7 milliards de paramètres, une quantification `Q4_K_M` et un contexte natif de 262144. Friday ne réserve plus cette fenêtre maximale : titre 8192, décision/plan Web 16384, délibération locale/réponse/vérification 32768. Les appels Qwen restent en `think: false` avec `top_k=20`, `top_p=0.8` et `presence_penalty=1.5`. Une demande locale complexe déclenche un plan interne de 256 tokens au plus avant la réponse ; plan et réponse partagent 32768 pour éviter un rechargement du contexte. Gemma utilise les mêmes fenêtres par étape, contre 131072 auparavant, et son thinking natif est automatique sur les étapes complexes.

Installation ou contrôle :

```powershell
ollama list
ollama show qwen3.5:9b-q4_K_M
ollama pull qwen3.5:9b-q4_K_M
```

Le 12 août 2026, le modèle a été retesté réellement via `/api/chat` à `num_ctx=32768` : Ollama le charge à 6,5 Go, 100 % GPU, contre 11 Go et 45 % CPU à 131072. Il atteint environ 34 TPS sur le duel final. Le JSON structuré est valide. Les essais `think: true`, `low`, `medium` et `high` consomment tous le plafond de 1024 tokens sans réponse finale ; Friday utilise donc la délibération bornée de l’orchestrateur au lieu du thinking natif Qwen.

- `Local` : aucun appel réseau.
- `Web léger` : 1 à 2 appels Tavily `basic`, plafond 2 crédits par réponse.
- `Web approfondi` : première passe Tavily + Exa en parallèle, jusqu'à 6 appels Tavily et 2 appels Exa ; le second Exa est réservé aux lacunes de couverture.
- seuils mensuels : avertissement 750, mode approfondi bloqué 850, Web bloqué 950.

Le choix Web de l'utilisateur est prioritaire. Le modèle prépare les requêtes, puis les sources sont numérotées `[S1]`, enregistrées avec leur URL et vérifiées dans une seconde passe locale. Les sources et réponses MCP sont des données non fiables : leurs instructions éventuelles ne sont jamais exécutées.

Le thinking natif est automatique selon la complexité et le mode avec Gemma. Qwen utilise une délibération non-thinking courte pour les demandes locales complexes ; en Web, le plan de recherche et la vérification jouent déjà ce rôle. Aucun contrôle de forçage n’est exposé dans le Chat. Le contenu de thinking renvoyé par Ollama et les plans internes Qwen ne sont jamais persistés.

Le panneau de progression est ouvert pendant le traitement et se replie automatiquement avec la réponse finale. `Détails du traitement` permet ensuite de revoir les jalons et leur temps relatif. Ces libellés décrivent les opérations du pipeline, pas le raisonnement interne de Gemma.

`Mettre en pause` interrompt l’appel Ollama sans enregistrer de réponse partielle. `Reprendre` relance le même run et réutilise ses recherches terminées si le mode reste identique. Si le mode est modifié pendant la pause, la reprise utilise le nouveau choix et redémarre le pipeline correspondant ; le journal indique l’ancien traitement écarté, tandis que les crédits Tavily déjà consommés restent dans le quota mensuel. Le temps affiché est un temps de traitement cumulé : file, consentement et pause ne sont pas comptés. Le délai `FRIDAY_ASSISTANT_TIMEOUT_MS` commence au lancement de chaque appel Ollama, jamais à la création du message.

## File, reprise et confidentialité

- Une génération lourde s’exécute à la fois ; les profils alternent équitablement.
- Messages, runs, requêtes, tentatives, sources et crédits sont persistés dans SQLite.
- Une recherche déjà réussie est reprise depuis son checkpoint après redémarrage.
- Après deux interruptions du même run, l’échec reste visible.
- L’annulation ne conserve aucune réponse partielle.
- E-mail, téléphone et adresse postale sont retirés d’une requête ; l’envoi de la version nettoyée demande un consentement.

## Recette

1. Vérifier `ollama list`, conserver le défaut Qwen, créer une conversation `Local`, envoyer deux messages liés et confirmer que le second tient compte du premier et que le pied de réponse indique `Qwen 3.5 9B Q4`.
2. Envoyer avec Qwen une demande locale contenant une comparaison ou une stratégie et vérifier les jalons `Analyse structurée de la demande` puis `Rédaction à partir du plan interne`.
3. Passer en `Web léger`, poser une question actuelle, vérifier les sources et un maximum de 2 crédits.
4. Envoyer « regarde sur Internet » et vérifier qu'au moins une tentative est journalisée, même si le planificateur local aurait pu répondre de mémoire.
5. Passer en `Web approfondi`, vérifier les jalons Tavily et Exa, le compteur `Exa · N appels`, les diagnostics et le plafond de 8 crédits Tavily.
6. Dans la roue dentée, sélectionner `Gemma 4 12B · thinking approfondi`, envoyer une demande locale complexe et vérifier `réflexion active`, puis revenir à Qwen si souhaité.
7. Pendant une réponse Web, vérifier que la progression ouverte détaille le plan, chaque recherche, les sources, la synthèse et la vérification ; après la réponse, rouvrir `Détails du traitement`, puis refaire l’essai hors ligne après rechargement.
8. Placer une seconde demande derrière une génération longue : vérifier que son temps reste à zéro dans la file, puis qu’il démarre à sa prise en charge. Mettre cette réponse en pause, attendre, choisir un autre mode, la reprendre et vérifier le jalon `Reprise en … · ancien traitement écarté`, le nouveau mode sur la réponse et l’absence de l’attente intermédiaire dans le traitement cumulé.
9. Tester une requête avec une adresse e-mail fictive : vérifier la version nettoyée et les choix `Autoriser` / `Rester en local`.
10. Couper Internet ou retirer temporairement la clé : vérifier le repli local explicite sans impact sur Agenda, Courses, Budget et synchronisation.
11. Saisir un message hors connexion, redémarrer la PWA, puis vérifier l’envoi unique au retour du hub.

Ne pas déclarer la recette mobile réussie sans essai physique correspondant.

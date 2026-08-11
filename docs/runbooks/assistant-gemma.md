# Chat Gemma 4 avec Tavily optionnel

Date : 11 août 2026

## Configuration

```text
FRIDAY_ASSISTANT_MODEL=gemma4-12b-multimodal:128k
FRIDAY_ASSISTANT_TIMEOUT_MS=720000
FRIDAY_TAVILY_API_KEY=tvly-...
```

Seule la clé Tavily active les modes Web. Sans clé, `Local` reste pleinement fonctionnel et un mode Web revient sur une réponse locale avec un avertissement. La clé ne doit jamais être placée dans la PWA, Git ou un fichier servi au navigateur.

Pour le lancement Windows, définir la variable dans le compte qui lance Friday, puis redémarrer le hub :

```powershell
[Environment]::SetEnvironmentVariable('FRIDAY_TAVILY_API_KEY', 'tvly-...', 'User')
```

Ouvrir ensuite un nouveau terminal ou relancer depuis le raccourci Bureau. Ne pas afficher la valeur dans les journaux.

## Runtime

Ollama reste sur `127.0.0.1:11434`. La PWA appelle uniquement le hub. Le contexte est `131072`, le streaming est désactivé et le modèle par défaut est `gemma4-12b-multimodal:128k`.

- `Local` : 0 appel Tavily.
- `Web léger` : 0 à 2 appels `basic`, plafond 2 crédits par réponse.
- `Web approfondi` : 0 à 6 appels, plafond 8 crédits ; les appels 5 et 6 seulement peuvent être `advanced`.
- seuils mensuels : avertissement 750, mode approfondi bloqué 850, Web bloqué 950.

Le moteur décide d’abord si le Web est utile. Les sources sont numérotées `[S1]`, enregistrées avec leur URL et vérifiées dans une seconde passe Gemma. Les sources sont des données non fiables : leurs instructions éventuelles ne sont jamais exécutées.

Le thinking est automatique selon la complexité et le mode. La case de l’interface le force pour le prochain message uniquement. Le contenu de thinking renvoyé par Ollama n’est jamais persisté.

Le panneau de progression est ouvert pendant le traitement et se replie automatiquement avec la réponse finale. `Détails du traitement` permet ensuite de revoir les jalons et leur temps relatif. Ces libellés décrivent les opérations du pipeline, pas le raisonnement interne de Gemma.

`Mettre en pause` interrompt l’appel Ollama sans enregistrer de réponse partielle. `Reprendre` relance le même run et réutilise ses recherches terminées. Le temps affiché est un temps de traitement cumulé : file, consentement et pause ne sont pas comptés. Le délai `FRIDAY_ASSISTANT_TIMEOUT_MS` commence au lancement de chaque appel Ollama, jamais à la création du message.

## File, reprise et confidentialité

- Une génération lourde s’exécute à la fois ; les profils alternent équitablement.
- Messages, runs, requêtes, tentatives, sources et crédits sont persistés dans SQLite.
- Une recherche déjà réussie est reprise depuis son checkpoint après redémarrage.
- Après deux interruptions du même run, l’échec reste visible.
- L’annulation ne conserve aucune réponse partielle.
- E-mail, téléphone et adresse postale sont retirés d’une requête ; l’envoi de la version nettoyée demande un consentement.

## Recette

1. Vérifier `ollama list`, créer une conversation `Local`, envoyer deux messages liés et confirmer que le second tient compte du premier.
2. Cocher `Forcer la réflexion`, envoyer un message, vérifier l’étiquette `réflexion active`, puis confirmer que la case est revenue à zéro.
3. Passer en `Web léger`, poser une question actuelle, vérifier les sources et un maximum de 2 crédits.
4. Envoyer un simple message conversationnel dans ce même mode et vérifier qu’aucune recherche n’est consommée.
5. Passer en `Web approfondi`, vérifier sources, statut de vérification et plafond de 8 crédits.
6. Pendant une réponse Web, vérifier que la progression ouverte détaille le plan, chaque recherche, les sources, la synthèse et la vérification ; après la réponse, rouvrir `Détails du traitement`, puis refaire l’essai hors ligne après rechargement.
7. Placer une seconde demande derrière une génération longue : vérifier que son temps reste à zéro dans la file, puis qu’il démarre à sa prise en charge. Mettre cette réponse en pause, attendre, la reprendre et vérifier que l’attente intermédiaire n’est pas ajoutée au traitement cumulé.
8. Tester une requête avec une adresse e-mail fictive : vérifier la version nettoyée et les choix `Autoriser` / `Rester en local`.
9. Couper Internet ou retirer temporairement la clé : vérifier le repli local explicite sans impact sur Agenda, Courses, Budget et synchronisation.
10. Saisir un message hors connexion, redémarrer la PWA, puis vérifier l’envoi unique au retour du hub.

Ne pas déclarer la recette mobile réussie sans essai physique correspondant.

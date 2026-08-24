# Import d'une liste de courses manuscrite

Date : 18 août 2026

Statut : candidat automatisé, recette physique Galaxy A17 ouverte

## Décision produit

La destination `Courses` propose un bouton `Photo`, puis deux choix explicites :
`Prendre une photo`, qui ouvre la caméra arrière, et `Choisir dans la galerie`.
Friday prépare ensuite une image JPEG de 1600 px au plus et de 300 Ko au plus,
puis l'envoie au hub authentifié.

La vérification tient dans un seul écran :

- la photo reste visible avec les lignes détectées en surimpression ;
- chaque détection montre le texte brut lu ;
- le produit compris et sa quantité sont directement éditables ;
- une ligne peut être retirée ;
- `Ajouter les produits` est l'unique validation métier.

L'analyse démarre directement en arrière-plan et n'ouvre aucun dialogue
bloquant. L'utilisateur peut changer d'onglet puis revenir. Le bouton passe de
`Photo` à `Analyse…` et reste cliquable pour ouvrir le suivi ; dans celui-ci, la
croix et `Continuer en arrière-plan` referment le dialogue sans interrompre
Ollama. Le bouton devient `Photo prête` quand la vérification est disponible.
`Annuler l'analyse` interrompt explicitement la requête et remet le bouton à son
état initial.

Les produits confirmés sont créés ensemble dans Dexie et l'outbox chiffrée.
Ils n'ont ni famille de magasin ni rayon manuel : ils restent dans `À classer`
jusqu'à une éventuelle action séparée de l'utilisateur.

## Frontière locale et sécurité

- aucune API distante n'est appelée ;
- la photo n'est écrite ni dans SQLite, ni dans Dexie, ni dans les journaux ;
- le hub accepte seulement une session liée, une origine de mutation approuvée,
  un type JPEG/PNG/WebP et 300 Ko décodés au plus ;
- un seul traitement photo peut tourner à la fois ;
- une annulation du navigateur propage un signal d'interruption à Ollama ;
- Ollama est borné à 120 secondes et 4096 tokens de sortie ;
- l'image est une donnée non fiable et ne donne aucun droit ni outil au modèle ;
- la sortie structurée est validée et une réponse coupée ou invalide ne crée
  aucun produit ;
- l'utilisateur reste l'autorité avant toute écriture.

## Choix du modèle local

La photo d'exercice `Photo 1.jpg` a été soumise aux familles vision déjà
installées avec une consigne et un schéma comparables.

| Modèle                           |                       Temps observé à froid | Résultat utile                                                                                     |
| -------------------------------- | ------------------------------------------: | -------------------------------------------------------------------------------------------------- |
| `qwen3.5:9b-q4_K_M`              | 43 s sans zones ; 99 s avec zones complètes | meilleure couverture : 38 lignes non barrées, quantités `x2`/`x3`, erreurs visibles et corrigibles |
| `ministral-3:8b`                 |                                        39 s | bonne normalisation de mots courants, mais omissions et substitutions supplémentaires              |
| `gemma4-12b-opencode-vision:16k` |                                        61 s | davantage de déformations sur cette écriture                                                       |

`qwen3.5:9b-q4_K_M` est donc le défaut. La variante configurable est
`FRIDAY_GROCERY_PHOTO_MODEL`; `FRIDAY_GROCERY_PHOTO_TIMEOUT_MS` règle le délai.

Sur l'exercice final, Qwen a correctement exclu la ligne barrée et produit 38
zones. Il a notamment lu correctement `œufs`, `jambon ?`, `glaces`, `jus de
pomme`, `café dosettes`, `poudre guacamole x3`, `fleur de sel x2`, `nectarine`,
`bananes (vertes)`, `yaourt enfants` et `whisky`. Des lectures comme `loca`
pour `coca` et `caudle` pour `couches` justifient l'édition obligatoire.

## Preuves automatisées

- contrats de taille/type et sortie positionnée ;
- moteur Ollama : image attachée, lignes barrées exclues, quantité séparée,
  sortie invalide refusée ;
- API : authentification obligatoire et aucune mutation métier ;
- dépôt local : lot chiffré atomique, outbox et absence de rayon ;
- Chrome mobile : sélection d'image, aperçu, surimpression cliquable,
  fermeture en arrière-plan, navigation, annulation, état `Photo prête`,
  correction, ajout final et absence de lancement du classement.

## Recette physique restante

Suivre `docs/recipes/galaxy-a17-grocery-photo-import.md`. Ne pas extrapoler la
qualité de capture, la latence ou le placement des zones à partir de Chrome
desktop simulé.

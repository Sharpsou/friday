# Taxonomie des courses `retail-fr-v1`

Cette référence décrit l'ordre d'affichage générique et les identifiants acceptés par les contrats. La source exécutable reste `GROCERY_TAXONOMY` dans `packages/contracts/src/index.ts`.

Un rayon n'est valide qu'avec sa famille. Un même identifiant de rayon, par exemple `storage`, peut donc exister dans plusieurs familles. Les libellés sont destinés à l'interface ; les identifiants servent au stockage et aux API.

## Supermarché — `supermarket`

| Ordre | Identifiant              | Libellé                              |
| ----: | ------------------------ | ------------------------------------ |
|     1 | `produce`                | Fruits et légumes                    |
|     2 | `bakery`                 | Boulangerie et pâtisserie            |
|     3 | `butcher`                | Boucherie et volaille                |
|     4 | `fish`                   | Poissonnerie                         |
|     5 | `deli`                   | Charcuterie et traiteur              |
|     6 | `cheese`                 | Fromages                             |
|     7 | `dairy-eggs`             | Laitages et œufs                     |
|     8 | `fresh-prepared`         | Frais et plats préparés              |
|     9 | `frozen`                 | Surgelés et glaces                   |
|    10 | `pasta-rice-pulses`      | Pâtes, riz et légumineuses           |
|    11 | `canned-soups`           | Conserves, bocaux et soupes          |
|    12 | `oils-condiments-spices` | Huiles, sauces, condiments et épices |
|    13 | `breakfast-coffee-tea`   | Petit-déjeuner, café et thé          |
|    14 | `snacks-sweets`          | Biscuits, confiseries et apéritif    |
|    15 | `soft-drinks`            | Eaux et boissons sans alcool         |
|    16 | `alcohol`                | Vins, bières et alcools              |
|    17 | `baby`                   | Bébé                                 |
|    18 | `personal-care`          | Hygiène et soins du corps            |
|    19 | `beauty`                 | Beauté et cosmétique                 |
|    20 | `home-cleaning`          | Entretien de la maison               |
|    21 | `laundry`                | Lessive et soin du linge             |
|    22 | `paper-disposable`       | Papier, sacs et jetables             |
|    23 | `pets`                   | Animaux                              |
|    24 | `home-kitchen-batteries` | Maison, cuisine, piles et ampoules   |
|    25 | `other-supermarket`      | Autre supermarché                    |

## Bricolage et jardin — `diy-garden`

`materials` Matériaux de construction · `wood` Bois et panneaux · `insulation` Isolation · `hardware` Quincaillerie et fixations · `tools` Outillage · `electricity` Électricité · `plumbing` Plomberie · `heating` Chauffage et ventilation · `paint` Peinture et droguerie · `flooring` Sols et carrelage · `kitchen` Cuisine · `bathroom` Salle de bains · `lighting` Éclairage · `storage` Rangement et aménagement · `garden` Jardin et extérieur · `safety` Protection et sécurité.

## Maison et décoration — `home-decor`

`furniture` Meubles · `storage` Rangement · `kitchen-tableware` Cuisine et arts de la table · `bedding` Literie · `home-textiles` Linge de maison · `decor` Décoration · `lighting` Luminaires · `curtains-rugs` Rideaux et tapis.

## Santé et beauté — `health-beauty`

`otc` Santé sans ordonnance · `first-aid` Premiers secours · `oral-care` Hygiène bucco-dentaire · `skin-care` Soin de la peau · `hair-care` Soin des cheveux · `baby-maternity` Bébé et maternité · `cosmetics` Maquillage et cosmétiques.

## Vêtements et chaussures — `clothing-shoes`

`women` Femme · `men` Homme · `children` Enfant · `baby` Bébé · `underwear-nightwear` Sous-vêtements et nuit · `shoes` Chaussures · `accessories` Accessoires · `sportswear` Vêtements de sport.

## Animalerie — `pet-store`

`food` Alimentation · `litter` Litière · `care` Hygiène et soins · `accessories-toys` Accessoires et jouets · `aquatics` Aquariophilie.

## Auto, moto et vélo — `mobility`

`maintenance` Entretien · `parts` Pièces et consommables · `fluids` Huiles et liquides · `cleaning` Nettoyage · `accessories` Accessoires · `safety` Sécurité · `bike-mobility` Vélo et mobilité.

## Électronique, électroménager et bureau — `electronics-office`

`computing` Informatique · `phones` Téléphonie · `tv-audio` TV et audio · `large-appliances` Gros électroménager · `small-appliances` Petit électroménager · `cables-batteries` Câbles, chargeurs et piles · `office-printing` Bureau et impression.

## Sport et plein air — `sport-outdoor`

`fitness` Fitness et musculation · `team-sports` Sports collectifs · `hiking-camping` Randonnée et camping · `water-sports` Sports nautiques · `cycling` Cyclisme.

## Culture, jeux et loisirs créatifs — `culture-hobbies`

`books` Livres · `media` Musique, films et médias · `games-toys` Jeux et jouets · `creative` Loisirs créatifs · `school` Papeterie et fournitures scolaires.

## Autre — `other`

`unclassified` À classer.

## Règles d'évolution

- Ne jamais changer le sens d'un identifiant publié dans `retail-fr-v1`.
- Une modification incompatible crée une nouvelle taxonomie, par exemple `retail-fr-v2`, et une migration explicite.
- L'ordre ci-dessus est un parcours générique, pas le plan d'un magasin précis.
- Une correction utilisateur crée une règle exacte du foyer ; elle ne modifie pas cette taxonomie globale.
- Un élément ambigu ou sous le seuil de confiance va dans `other/unclassified` plutôt que d'être forcé dans un rayon.

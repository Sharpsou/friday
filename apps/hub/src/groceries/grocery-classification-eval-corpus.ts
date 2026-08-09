import type { GroceryClassificationChoice } from '@friday/contracts';

export interface GroceryClassificationEvalCase extends GroceryClassificationChoice {
  label: string;
}

function cases(
  storeFamilyId: string,
  aisleId: string,
  labels: readonly string[],
): GroceryClassificationEvalCase[] {
  return labels.map((label) => ({ label, storeFamilyId, aisleId }));
}

export const GROCERY_CLASSIFICATION_EVAL_CORPUS = [
  ...cases('supermarket', 'produce', [
    'pommes gala',
    'bananes pour le petit dej',
    'courgettes',
    'salade verte',
  ]),
  ...cases('supermarket', 'bakery', [
    '2 baguettes',
    'croissants',
    'pain complet tranché',
    'gâteau anniversaire',
  ]),
  ...cases('supermarket', 'butcher', [
    'steaks hachés',
    'filets de poulet',
    'saucisses',
    'escalopes de dinde',
  ]),
  ...cases('supermarket', 'fish', [
    'saumon frais',
    'dos de cabillaud',
    'crevettes cuites',
    'moules',
  ]),
  ...cases('supermarket', 'deli', [
    'jambon blanc',
    'rillettes',
    'taboulé',
    'quiche lorraine',
  ]),
  ...cases('supermarket', 'cheese', [
    'comté',
    'bûche de chèvre',
    'camembert',
    'fromage à raclette',
  ]),
  ...cases('supermarket', 'dairy-eggs', [
    'lait demi-écrémé',
    'yaourts vanille',
    'beurre doux',
    'œufs x12',
  ]),
  ...cases('supermarket', 'fresh-prepared', [
    'raviolis frais',
    'pizza fraîche',
    'gnocchis à poêler',
    'salade composée',
  ]),
  ...cases('supermarket', 'frozen', [
    'petits pois surgelés',
    'frites au four',
    'glace vanille',
    'poisson pané',
  ]),
  ...cases('supermarket', 'pasta-rice-pulses', [
    'spaghetti',
    'riz basmati',
    'lentilles vertes',
    'semoule couscous',
  ]),
  ...cases('supermarket', 'canned-soups', [
    'thon en boîte',
    'maïs en conserve',
    'haricots rouges en bocal',
    'soupe tomate',
  ]),
  ...cases('supermarket', 'oils-condiments-spices', [
    "huile d'olive",
    'ketchup',
    'sel fin',
    'curry en poudre',
  ]),
  ...cases('supermarket', 'breakfast-coffee-tea', [
    'café moulu',
    'thé earl grey',
    'céréales chocolat',
    'confiture fraise',
  ]),
  ...cases('supermarket', 'snacks-sweets', [
    'biscuits goûter',
    'tablette chocolat noir',
    'chips nature',
    'cacahuètes apéro',
  ]),
  ...cases('supermarket', 'soft-drinks', [
    'pack eau gazeuse',
    "jus d'orange",
    'soda cola',
    'sirop de grenadine',
  ]),
  ...cases('supermarket', 'alcohol', [
    'vin rouge cuisine',
    'bières blondes',
    'cidre brut',
    'rhum ambré',
  ]),
  ...cases('supermarket', 'baby', [
    'couches taille 4',
    'petits pots carotte',
    'lait bébé 2e âge',
    'lingettes bébé',
  ]),
  ...cases('supermarket', 'personal-care', [
    'shampooing doux',
    'savon mains',
    'dentifrice',
    'déodorant',
  ]),
  ...cases('supermarket', 'beauty', [
    'mascara noir',
    '« rouge à lèvres maman »',
    'crème visage',
    'vernis à ongles',
  ]),
  ...cases('supermarket', 'home-cleaning', [
    'liquide vaisselle',
    'nettoyant pour le sol',
    'éponges grattantes',
    'eau de javel',
  ]),
  ...cases('supermarket', 'laundry', [
    'lessive liquide',
    'adoucissant',
    'détachant linge',
    'filet de lavage',
  ]),
  ...cases('supermarket', 'paper-disposable', [
    'papier toilette',
    'essuie-tout',
    'sacs poubelle 30 litres',
    'gobelets carton',
  ]),
  ...cases('supermarket', 'pets', [
    'croquettes Nouchka',
    'pâtée pour le chat',
    'friandises du chien',
    'litière chat',
  ]),
  ...cases('supermarket', 'home-kitchen-batteries', [
    'piles AA',
    'ampoule LED',
    'bougies chauffe-plat',
    'moule à gâteau',
  ]),
  ...cases('supermarket', 'other-supermarket', [
    'ticket à gratter',
    'ficelle alimentaire',
    'parapluie de dépannage',
    'le petit truc du bac promo',
  ]),
  ...cases('diy-garden', 'tools', [
    'perceuse sans fil',
    'jeu de tournevis',
    'marteau de charpentier',
    'scie sauteuse',
    'mètre ruban chantier',
  ]),
  ...cases('home-decor', 'decor', [
    'vase pour le salon',
    'cadre photo bois',
    'miroir mural',
    'coussin déco',
    'statue décorative',
  ]),
  ...cases('health-beauty', 'first-aid', [
    'pansements stériles',
    'compresses',
    'désinfectant plaie',
    'bandage élastique',
    'thermomètre médical',
  ]),
  ...cases('clothing-shoes', 'shoes', [
    'baskets Ana',
    'chaussures de ville',
    'bottes de pluie enfant',
    'sandales été',
    'chaussons maison',
  ]),
  ...cases('pet-store', 'accessories-toys', [
    'arbre à chat',
    'balle pour chien',
    'laisse rétractable',
    'gamelle anti-glouton',
    'caisse de transport Nouchka',
  ]),
  ...cases('mobility', 'maintenance', [
    'balais essuie-glace voiture',
    'chargeur batterie auto',
    'kit réparation pneu',
    'ampoules de phare',
    'plaquettes de frein vélo',
  ]),
  ...cases('electronics-office', 'cables-batteries', [
    'câble USB-C deux mètres',
    'chargeur iPhone',
    'multiprise parafoudre',
    'batterie externe ordinateur',
    'adaptateur HDMI',
  ]),
  ...cases('sport-outdoor', 'hiking-camping', [
    'sac de couchage',
    'réchaud camping',
    'bâtons de randonnée',
    'lampe frontale',
    'tente deux places',
  ]),
  ...cases('culture-hobbies', 'creative', [
    'peinture acrylique',
    'pinceaux loisirs créatifs',
    'carnet de dessin',
    'argile autodurcissante',
    'kit tricot débutant',
  ]),
  ...cases('other', 'unclassified', [
    'le machin pour dimanche',
    'cadeau surprise',
    'truc vu chez Paul',
    'rappelle-moi ce bidule',
    '???',
  ]),
] satisfies GroceryClassificationEvalCase[];

export const GROCERY_CLASSIFICATION_MODEL_CHALLENGE = [
  ...cases('supermarket', 'dairy-eggs', ['Pack lait', 'Yaourt enfants']),
  ...cases('supermarket', 'home-cleaning', ['Pschitt désinfectant']),
  ...cases('supermarket', 'laundry', ['Lessive']),
  ...cases('supermarket', 'canned-soups', ['Conserve haricots']),
  ...cases('supermarket', 'produce', ['Tomate', 'Concombre']),
  ...cases('supermarket', 'oils-condiments-spices', [
    'Cumin',
    'Sauce piquante',
  ]),
] satisfies GroceryClassificationEvalCase[];

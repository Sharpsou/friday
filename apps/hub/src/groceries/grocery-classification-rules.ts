import type { GroceryClassificationChoice } from '@friday/contracts';

import { normalizeGroceryLabel } from './grocery-label.js';

interface BuiltInRule extends GroceryClassificationChoice {
  terms: readonly string[];
}

const RULES: readonly BuiltInRule[] = [
  {
    storeFamilyId: 'mobility',
    aisleId: 'maintenance',
    terms: [
      'essuie glace',
      'batterie auto',
      'reparation pneu',
      'ampoules de phare',
      'frein velo',
    ],
  },
  {
    storeFamilyId: 'diy-garden',
    aisleId: 'tools',
    terms: [
      'perceuse',
      'tournevis',
      'marteau',
      'scie sauteuse',
      'metre ruban chantier',
    ],
  },
  {
    storeFamilyId: 'home-decor',
    aisleId: 'decor',
    terms: [
      'vase pour le salon',
      'cadre photo',
      'miroir mural',
      'coussin deco',
      'statue decorative',
    ],
  },
  {
    storeFamilyId: 'health-beauty',
    aisleId: 'first-aid',
    terms: [
      'pansements',
      'compresses',
      'desinfectant plaie',
      'bandage',
      'thermometre medical',
    ],
  },
  {
    storeFamilyId: 'clothing-shoes',
    aisleId: 'shoes',
    terms: [
      'baskets',
      'chaussures',
      'bottes de pluie',
      'sandales',
      'chaussons',
    ],
  },
  {
    storeFamilyId: 'pet-store',
    aisleId: 'accessories-toys',
    terms: [
      'arbre a chat',
      'balle pour chien',
      'laisse retractable',
      'gamelle',
      'caisse de transport',
    ],
  },
  {
    storeFamilyId: 'electronics-office',
    aisleId: 'cables-batteries',
    terms: [
      'cable usb',
      'chargeur iphone',
      'multiprise',
      'batterie externe ordinateur',
      'adaptateur hdmi',
    ],
  },
  {
    storeFamilyId: 'sport-outdoor',
    aisleId: 'hiking-camping',
    terms: [
      'sac de couchage',
      'rechaud camping',
      'batons de randonnee',
      'lampe frontale',
      'tente deux places',
    ],
  },
  {
    storeFamilyId: 'culture-hobbies',
    aisleId: 'creative',
    terms: [
      'peinture acrylique',
      'pinceaux loisirs creatifs',
      'carnet de dessin',
      'argile autodurcissante',
      'kit tricot',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'baby',
    terms: ['couches', 'petits pots', 'lait bebe', 'lingettes bebe'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'produce',
    terms: ['pommes', 'bananes', 'courgettes', 'salade verte'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'bakery',
    terms: ['baguettes', 'croissants', 'pain complet', 'gateau anniversaire'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'butcher',
    terms: [
      'steaks haches',
      'filets de poulet',
      'saucisses',
      'escalopes de dinde',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'fish',
    terms: ['saumon', 'cabillaud', 'crevettes', 'moules'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'deli',
    terms: ['jambon', 'rillettes', 'taboule', 'quiche'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'cheese',
    terms: ['comte', 'buche de chevre', 'camembert', 'fromage a raclette'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'dairy-eggs',
    terms: ['lait demi ecreme', 'yaourts', 'beurre', 'œufs'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'fresh-prepared',
    terms: ['raviolis frais', 'pizza fraiche', 'gnocchis', 'salade composee'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'frozen',
    terms: ['surgeles', 'frites au four', 'glace', 'poisson pane'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'pasta-rice-pulses',
    terms: ['spaghetti', 'riz basmati', 'lentilles', 'semoule couscous'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'canned-soups',
    terms: [
      'thon en boite',
      'mais en conserve',
      'haricots rouges',
      'soupe tomate',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'oils-condiments-spices',
    terms: ['huile d olive', 'ketchup', 'sel fin', 'curry'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'breakfast-coffee-tea',
    terms: ['cafe moulu', 'the earl grey', 'cereales', 'confiture'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'snacks-sweets',
    terms: ['biscuits', 'chocolat', 'chips', 'cacahuetes'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'soft-drinks',
    terms: ['eau gazeuse', 'jus d orange', 'soda', 'sirop de grenadine'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'alcohol',
    terms: ['vin rouge', 'bieres', 'cidre', 'rhum'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'personal-care',
    terms: ['shampooing', 'savon mains', 'dentifrice', 'deodorant'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'beauty',
    terms: ['mascara', 'rouge a levres', 'creme visage', 'vernis a ongles'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'home-cleaning',
    terms: [
      'liquide vaisselle',
      'nettoyant pour le sol',
      'eponges',
      'eau de javel',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'laundry',
    terms: ['lessive', 'adoucissant', 'detachant linge', 'filet de lavage'],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'paper-disposable',
    terms: [
      'papier toilette',
      'essuie tout',
      'sacs poubelle',
      'gobelets carton',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'pets',
    terms: [
      'croquettes',
      'patee pour le chat',
      'friandises du chien',
      'litiere chat',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'home-kitchen-batteries',
    terms: [
      'piles aa',
      'ampoule led',
      'bougies chauffe plat',
      'moule a gateau',
    ],
  },
  {
    storeFamilyId: 'supermarket',
    aisleId: 'other-supermarket',
    terms: [
      'ticket a gratter',
      'ficelle alimentaire',
      'parapluie de depannage',
      'bac promo',
    ],
  },
];

export function classifyKnownGroceryLabel(
  label: string,
): GroceryClassificationChoice | null {
  const normalized = ` ${normalizeGroceryLabel(label)
    .replace(/[^\p{L}\p{N}?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()} `;
  for (const rule of RULES) {
    if (
      rule.terms.some((term) => {
        const normalizedTerm = normalizeGroceryLabel(term)
          .replace(/[^\p{L}\p{N}?]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim();
        return normalized.includes(` ${normalizedTerm} `);
      })
    ) {
      return {
        storeFamilyId: rule.storeFamilyId,
        aisleId: rule.aisleId,
      };
    }
  }
  return null;
}

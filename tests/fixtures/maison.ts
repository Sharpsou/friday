import type {
  MaisonRecord,
  MaisonCommand,
  Product,
  Recipe,
  Preparation,
  MealSlot,
  StockEntry,
} from '../../packages/contracts/src/index.js';
export const household = '1030b4f6-1e0f-48fa-adab-865750ce597d';
export const profile = 'e5584f8c-5558-4e1d-9a5d-60db13f529ba';
export const device = '81992d37-c7c7-4755-823c-881e7d21e9cf';
export function fields(id: string = randomUUID()) {
  return {
    id,
    householdId: household,
    revision: 0,
    createdAt: '2026-09-05T12:00:00.000Z',
    updatedAt: '2026-09-05T12:00:00.000Z',
    deletedAt: null,
    createdByProfileId: profile,
    updatedByProfileId: profile,
    deviceId: device,
    schemaVersion: 1 as const,
  };
}
export function fixtures() {
  const product: Product = {
    ...fields(),
    kind: 'product',
    name: 'Pâtes',
    aliases: [],
    conversions: [],
  };
  const recipe: Recipe = {
    ...fields(),
    kind: 'recipe',
    recipeKey: randomUUID(),
    version: 1,
    name: 'Lasagnes',
    portionsMilli: 3000,
    ingredients: [
      {
        id: randomUUID(),
        productId: product.id,
        quantity: { milli: 300000, unit: 'g' },
        note: '',
      },
    ],
    steps: '',
    durationMinutes: null,
    notes: '',
    provenance: 'manual',
    sources: [],
  };
  const prep: Preparation = {
    ...fields(),
    kind: 'preparation',
    recipeId: recipe.id,
    date: '2026-09-07',
    portionsMilli: 6000,
    actualPortionsMilli: null,
    status: 'planned',
  };
  const meal: MealSlot = {
    ...fields(),
    kind: 'meal',
    date: prep.date,
    slot: 'dinner',
    people: 3,
    status: 'planned',
    servings: [{ preparationId: prep.id, portionsMilli: 3000 }],
  };
  const meal2: MealSlot = { ...meal, ...fields(), date: '2026-09-08' };
  const stock: StockEntry = {
    ...fields(),
    kind: 'stock',
    productId: product.id,
    preparationId: null,
    label: product.name,
    location: 'dry',
    quantity: { milli: 500000, unit: 'g' },
    status: 'present',
    confirmedAt: '2026-09-05T12:00:00.000Z',
    expiresOn: null,
    threshold: { milli: 100000, unit: 'g' },
  };
  return {
    product,
    recipe,
    prep,
    meal,
    meal2,
    stock,
    records: [product, recipe, prep, meal, meal2, stock] as MaisonRecord[],
  };
}
export function command(
  records: MaisonRecord[],
  groceryWrites: MaisonCommand['payload']['groceryWrites'] = [],
): MaisonCommand {
  const id = randomUUID();
  return {
    protocolVersion: 1,
    operationId: id,
    entityId: id,
    entityType: 'maison_command',
    baseRevision: 0,
    operation: 'upsert',
    profileId: profile,
    deviceId: device,
    clientCreatedAt: '2026-09-05T12:00:00.000Z',
    payload: {
      householdId: household,
      writes: records.map((record) => ({
        baseRevision: record.revision,
        record: { ...record, revision: record.revision + 1 },
      })),
      groceryWrites,
    },
  };
}
let nextId = 0;
function randomUUID(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${nextId.toString(16).padStart(12, '0')}`;
}

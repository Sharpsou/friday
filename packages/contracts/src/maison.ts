import { z } from 'zod';

const Id = z.uuid();
const DateOnly = z.iso.date();
const Instant = z.iso.datetime();
const Text = z.string().trim().min(1).max(200);
export const MaisonUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'pack',
  'portion',
  'tbsp',
  'tsp',
]);
export const MaisonAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000_000_000);
export const MaisonQuantitySchema = z
  .object({ milli: MaisonAmountSchema, unit: MaisonUnitSchema })
  .strict();
export const MaisonLocationSchema = z.enum([
  'fridge',
  'freezer',
  'dry',
  'produce',
  'household',
]);
export const MaisonStockStatusSchema = z.enum([
  'present',
  'low',
  'empty',
  'check',
]);
const common = {
  id: Id,
  householdId: Id,
  revision: z.number().int().nonnegative(),
  createdAt: Instant,
  updatedAt: Instant,
  deletedAt: Instant.nullable(),
  createdByProfileId: Id,
  updatedByProfileId: Id,
  deviceId: Id,
  schemaVersion: z.literal(1),
};
export const MaisonSourceSchema = z
  .object({ title: Text, url: z.url({ protocol: /^https?$/u }).max(2048) })
  .strict();
export const RecipeIngredientSchema = z
  .object({
    id: Id,
    productId: Id,
    quantity: MaisonQuantitySchema.nullable(),
    note: z.string().trim().max(240),
  })
  .strict();
export const RecipeDraftSchema = z
  .object({
    name: Text,
    portionsMilli: MaisonAmountSchema.positive(),
    ingredients: z
      .array(
        z
          .object({
            label: Text,
            quantity: MaisonQuantitySchema.nullable(),
            note: z.string().max(240),
          })
          .strict(),
      )
      .max(60),
    steps: z.string().max(12000),
    notes: z.string().max(2000),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
  })
  .strict();
export const ProductSchema = z
  .object({
    ...common,
    kind: z.literal('product'),
    name: Text,
    aliases: z.array(Text).max(40),
    conversions: z
      .array(
        z
          .object({
            from: MaisonUnitSchema,
            to: MaisonUnitSchema,
            factorMilli: MaisonAmountSchema.positive(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const RecipeSchema = z
  .object({
    ...common,
    kind: z.literal('recipe'),
    recipeKey: Id,
    version: z.number().int().positive(),
    name: Text,
    portionsMilli: MaisonAmountSchema.positive(),
    ingredients: z.array(RecipeIngredientSchema).max(60),
    steps: z.string().max(12000),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    notes: z.string().max(2000),
    provenance: z.enum(['manual', 'local', 'web']),
    sources: z.array(MaisonSourceSchema).max(12),
  })
  .strict();
export const PreparationSchema = z
  .object({
    ...common,
    kind: z.literal('preparation'),
    recipeId: Id,
    date: DateOnly,
    portionsMilli: MaisonAmountSchema.positive(),
    actualPortionsMilli: MaisonAmountSchema.nullable(),
    status: z.enum(['planned', 'prepared', 'cancelled']),
  })
  .strict();
export const MealSlotSchema = z
  .object({
    ...common,
    kind: z.literal('meal'),
    date: DateOnly,
    slot: z.enum(['lunch', 'dinner']),
    people: z.number().int().min(1).max(100),
    status: z.enum(['planned', 'eaten', 'outside', 'cancelled']),
    servings: z
      .array(
        z
          .object({
            preparationId: Id,
            portionsMilli: MaisonAmountSchema.positive(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const StockEntrySchema = z
  .object({
    ...common,
    kind: z.literal('stock'),
    productId: Id.nullable(),
    preparationId: Id.nullable(),
    label: Text,
    location: MaisonLocationSchema,
    quantity: MaisonQuantitySchema.nullable(),
    status: MaisonStockStatusSchema,
    confirmedAt: Instant,
    expiresOn: DateOnly.nullable(),
    threshold: MaisonQuantitySchema.nullable(),
  })
  .strict()
  .refine(
    (value) => (value.productId === null) !== (value.preparationId === null),
    'Une seule origine de réserve est requise.',
  );
export const StockMovementSchema = z
  .object({
    ...common,
    kind: z.literal('movement'),
    stockId: Id,
    reason: z.enum([
      'purchase',
      'prepare',
      'eat',
      'discard',
      'correction',
      'initial',
    ]),
    before: MaisonQuantitySchema.nullable(),
    after: MaisonQuantitySchema.nullable(),
    sourceId: Id.nullable(),
    compensatesId: Id.nullable(),
  })
  .strict();
export const ShoppingCoverageSchema = z
  .object({
    ...common,
    kind: z.literal('coverage'),
    originKey: z.string().min(1).max(200),
    productId: Id,
    preparationId: Id.nullable(),
    ingredientId: Id.nullable(),
    groceryItemId: Id.nullable(),
    quantity: MaisonQuantitySchema.nullable(),
    excluded: z.boolean(),
    managed: z.boolean().default(true),
    labelSnapshot: Text,
    quantityTextSnapshot: z.string().max(80).nullable(),
  })
  .strict();
export const PurchaseReceiptSchema = z
  .object({
    ...common,
    kind: z.literal('receipt'),
    groceryItemId: Id,
    checkedAt: Instant,
    stockId: Id.nullable(),
    ignored: z.boolean(),
  })
  .strict();
export const MaisonRecordSchema = z.discriminatedUnion('kind', [
  ProductSchema,
  RecipeSchema,
  PreparationSchema,
  MealSlotSchema,
  StockEntrySchema,
  StockMovementSchema,
  ShoppingCoverageSchema,
  PurchaseReceiptSchema,
]);
export const MaisonCommandPayloadSchema = z
  .object({
    householdId: Id,
    writes: z
      .array(
        z
          .object({
            baseRevision: z.number().int().nonnegative(),
            record: MaisonRecordSchema,
          })
          .strict(),
      )
      .max(250),
    groceryWrites: z
      .array(
        z
          .object({
            id: Id,
            baseRevision: z.number().int().nonnegative(),
            label: Text,
            quantityText: z.string().trim().max(80).nullable(),
            deleted: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (v) => v.writes.length + v.groceryWrites.length > 0,
    'Commande vide.',
  );
export const MaisonCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    operationId: Id,
    deviceId: Id,
    profileId: Id,
    entityType: z.literal('maison_command'),
    entityId: Id,
    operation: z.literal('upsert'),
    baseRevision: z.literal(0),
    clientCreatedAt: Instant,
    payload: MaisonCommandPayloadSchema,
  })
  .strict();
export const MaisonChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('maison_record'),
    entityId: Id,
    operation: z.literal('upsert'),
    payload: MaisonRecordSchema,
  })
  .strict();
export const MenuAiRequestSchema = z
  .object({ requestId: Id, name: Text, mode: z.enum(['local', 'web']) })
  .strict();
export const MenuAiJobSchema = z
  .object({
    id: Id,
    name: Text,
    mode: z.enum(['local', 'web']),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
    stage: z.string().max(80),
    createdAt: Instant,
    updatedAt: Instant,
    draft: RecipeDraftSchema.nullable(),
    sources: z.array(MaisonSourceSchema).max(12),
    evidence: z.enum(['unverified', 'partial', 'verified']),
    error: z.string().max(200).nullable(),
  })
  .strict();
export type MaisonRecord = z.infer<typeof MaisonRecordSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Preparation = z.infer<typeof PreparationSchema>;
export type MealSlot = z.infer<typeof MealSlotSchema>;
export type StockEntry = z.infer<typeof StockEntrySchema>;
export type StockMovement = z.infer<typeof StockMovementSchema>;
export type ShoppingCoverage = z.infer<typeof ShoppingCoverageSchema>;
export type MaisonCommand = z.infer<typeof MaisonCommandSchema>;
export type MaisonQuantity = z.infer<typeof MaisonQuantitySchema>;
export type MaisonUnit = z.infer<typeof MaisonUnitSchema>;
export type RecipeDraft = z.infer<typeof RecipeDraftSchema>;
export type MenuAiJob = z.infer<typeof MenuAiJobSchema>;

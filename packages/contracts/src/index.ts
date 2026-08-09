import { z } from 'zod';

export const ProtocolVersionSchema = z.literal(1);
export const UuidSchema = z.string().uuid();
export const UtcInstantSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const AuthRoleSchema = z.enum(['owner', 'adult']);
export const AuthIdentifierSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .transform((identifier) => identifier.toLocaleLowerCase('fr-FR'))
  .refine(
    (identifier) => /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(identifier),
    'Utilisez des lettres, chiffres, points, tirets ou tirets bas, sans espace.',
  );
export const AuthCredentialsSchema = z
  .object({
    deviceId: UuidSchema,
    deviceName: z.string().trim().min(1).max(80),
    identifier: AuthIdentifierSchema,
    password: z.string().min(12).max(128),
  })
  .strict();
export const AuthBootstrapRequestSchema = AuthCredentialsSchema.extend({
  name: z.string().trim().min(1).max(80),
}).strict();
export const AuthLoginRequestSchema = AuthCredentialsSchema.omit({
  deviceName: true,
}).strict();
export const AuthPairRequestSchema = AuthBootstrapRequestSchema.extend({
  code: z.string().regex(/^\d{8}$/u),
}).strict();
export const AuthMemberSchema = z
  .object({
    identifier: AuthIdentifierSchema,
    name: z.string().min(1).max(80),
    profileId: UuidSchema,
    role: AuthRoleSchema,
  })
  .strict();
export const AuthSessionSchema = z
  .object({
    deviceId: UuidSchema,
    deviceName: z.string().min(1).max(80),
    member: AuthMemberSchema,
  })
  .strict();
export const AuthStateResponseSchema = z
  .object({
    bootstrapRequired: z.boolean(),
    session: AuthSessionSchema.nullable(),
  })
  .strict();
export const PairingCodeResponseSchema = z
  .object({
    code: z.string().regex(/^\d{8}$/u),
    expiresAt: UtcInstantSchema,
  })
  .strict();
export const AuthDeviceSchema = z
  .object({
    createdAt: UtcInstantSchema,
    current: z.boolean(),
    id: UuidSchema,
    lastSeenAt: UtcInstantSchema,
    memberName: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    revokedAt: UtcInstantSchema.nullable(),
  })
  .strict();
export const AuthDevicesResponseSchema = z
  .object({ devices: z.array(AuthDeviceSchema).max(2) })
  .strict();
export const AuthMembersResponseSchema = z
  .object({ members: z.array(AuthMemberSchema).max(2) })
  .strict();

export const TaskStatusSchema = z.enum(['todo', 'done']);
export const TaskRecurrenceRuleSchema = z
  .object({
    anchorDate: LocalDateSchema,
    endDate: LocalDateSchema.nullable().default(null),
    interval: z.number().int().min(1).max(365),
    seriesId: UuidSchema,
    unit: z.enum(['day', 'week', 'month', 'year']),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.unit !== 'day' && rule.interval !== 1) {
      context.addIssue({
        code: 'custom',
        message:
          'Seule la récurrence en jours accepte un intervalle personnalisé.',
        path: ['interval'],
      });
    }
    if (rule.endDate !== null && rule.endDate < rule.anchorDate) {
      context.addIssue({
        code: 'custom',
        message: 'La date de fin doit suivre la première occurrence.',
        path: ['endDate'],
      });
    }
  });
export const TaskRecurrenceSchema = z.union([
  z.enum(['daily', 'weekly', 'monthly']),
  TaskRecurrenceRuleSchema,
]);

export const TaskRecordSchema = z
  .object({
    id: UuidSchema,
    householdId: UuidSchema,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    dueDate: LocalDateSchema.nullable(),
    dueTime: LocalTimeSchema.nullable().default(null),
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(1_440)
      .nullable()
      .default(null),
    assigneeProfileId: UuidSchema.nullable(),
    recurrence: TaskRecurrenceSchema.nullable(),
    note: z.string().trim().max(2_000).nullable(),
    status: TaskStatusSchema,
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
    deletedAt: UtcInstantSchema.nullable(),
    createdByProfileId: UuidSchema,
    updatedByProfileId: UuidSchema,
    deviceId: UuidSchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.dueTime !== null && task.dueDate === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une heure nécessite une date.',
        path: ['dueTime'],
      });
    }
    if (task.durationMinutes !== null && task.dueTime === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une durée nécessite une heure.',
        path: ['durationMinutes'],
      });
    }
    if (task.recurrence !== null && task.dueDate === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une récurrence nécessite une date.',
        path: ['recurrence'],
      });
    }
  });

export const TaskOperationSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    operationId: UuidSchema,
    deviceId: UuidSchema,
    profileId: UuidSchema,
    entityType: z.literal('task'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    baseRevision: z.number().int().nonnegative(),
    clientCreatedAt: UtcInstantSchema,
    payload: TaskRecordSchema,
  })
  .strict();

export const GroceryItemRecordSchema = z
  .object({
    id: UuidSchema,
    householdId: UuidSchema,
    revision: z.number().int().nonnegative(),
    label: z.string().trim().min(1).max(200),
    quantityText: z.string().trim().max(80).nullable(),
    manualStoreFamilyId: z.string().trim().min(1).nullable().default(null),
    manualAisleId: z.string().trim().min(1).nullable().default(null),
    checkedAt: UtcInstantSchema.nullable(),
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
    deletedAt: UtcInstantSchema.nullable(),
    createdByProfileId: UuidSchema,
    updatedByProfileId: UuidSchema,
    deviceId: UuidSchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((item, context) => {
    if ((item.manualStoreFamilyId === null) !== (item.manualAisleId === null)) {
      context.addIssue({
        code: 'custom',
        message:
          'La famille et le rayon manuels doivent être renseignés ensemble.',
        path: ['manualAisleId'],
      });
    } else if (
      item.manualStoreFamilyId !== null &&
      item.manualAisleId !== null &&
      !isGroceryClassificationChoice(
        item.manualStoreFamilyId,
        item.manualAisleId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Le rayon manuel ne correspond pas à la famille de magasin.',
        path: ['manualAisleId'],
      });
    }
  });

export const GroceryItemOperationSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    operationId: UuidSchema,
    deviceId: UuidSchema,
    profileId: UuidSchema,
    entityType: z.literal('grocery_item'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    baseRevision: z.number().int().nonnegative(),
    clientCreatedAt: UtcInstantSchema,
    payload: GroceryItemRecordSchema,
  })
  .strict();

export const GROCERY_TAXONOMY_ID = 'retail-fr-v1' as const;

export const GROCERY_TAXONOMY = [
  {
    id: 'supermarket',
    label: 'Supermarché',
    aisles: [
      ['produce', 'Fruits et légumes'],
      ['bakery', 'Boulangerie et pâtisserie'],
      ['butcher', 'Boucherie et volaille'],
      ['fish', 'Poissonnerie'],
      ['deli', 'Charcuterie et traiteur'],
      ['cheese', 'Fromages'],
      ['dairy-eggs', 'Laitages et œufs'],
      ['fresh-prepared', 'Frais et plats préparés'],
      ['frozen', 'Surgelés et glaces'],
      ['pasta-rice-pulses', 'Pâtes, riz et légumineuses'],
      ['canned-soups', 'Conserves, bocaux et soupes'],
      ['oils-condiments-spices', 'Huiles, sauces, condiments et épices'],
      ['breakfast-coffee-tea', 'Petit-déjeuner, café et thé'],
      ['snacks-sweets', 'Biscuits, confiseries et apéritif'],
      ['soft-drinks', 'Eaux et boissons sans alcool'],
      ['alcohol', 'Vins, bières et alcools'],
      ['baby', 'Bébé'],
      ['personal-care', 'Hygiène et soins du corps'],
      ['beauty', 'Beauté et cosmétique'],
      ['home-cleaning', 'Entretien de la maison'],
      ['laundry', 'Lessive et soin du linge'],
      ['paper-disposable', 'Papier, sacs et jetables'],
      ['pets', 'Animaux'],
      ['home-kitchen-batteries', 'Maison, cuisine, piles et ampoules'],
      ['other-supermarket', 'Autre supermarché'],
    ],
  },
  {
    id: 'diy-garden',
    label: 'Bricolage et jardin',
    aisles: [
      ['materials', 'Matériaux de construction'],
      ['wood', 'Bois et panneaux'],
      ['insulation', 'Isolation'],
      ['hardware', 'Quincaillerie et fixations'],
      ['tools', 'Outillage'],
      ['electricity', 'Électricité'],
      ['plumbing', 'Plomberie'],
      ['heating', 'Chauffage et ventilation'],
      ['paint', 'Peinture et droguerie'],
      ['flooring', 'Sols et carrelage'],
      ['kitchen', 'Cuisine'],
      ['bathroom', 'Salle de bains'],
      ['lighting', 'Éclairage'],
      ['storage', 'Rangement et aménagement'],
      ['garden', 'Jardin et extérieur'],
      ['safety', 'Protection et sécurité'],
    ],
  },
  {
    id: 'home-decor',
    label: 'Maison et décoration',
    aisles: [
      ['furniture', 'Meubles'],
      ['storage', 'Rangement'],
      ['kitchen-tableware', 'Cuisine et arts de la table'],
      ['bedding', 'Literie'],
      ['home-textiles', 'Linge de maison'],
      ['decor', 'Décoration'],
      ['lighting', 'Luminaires'],
      ['curtains-rugs', 'Rideaux et tapis'],
    ],
  },
  {
    id: 'health-beauty',
    label: 'Santé et beauté',
    aisles: [
      ['otc', 'Santé sans ordonnance'],
      ['first-aid', 'Premiers secours'],
      ['oral-care', 'Hygiène bucco-dentaire'],
      ['skin-care', 'Soin de la peau'],
      ['hair-care', 'Soin des cheveux'],
      ['baby-maternity', 'Bébé et maternité'],
      ['cosmetics', 'Maquillage et cosmétiques'],
    ],
  },
  {
    id: 'clothing-shoes',
    label: 'Vêtements et chaussures',
    aisles: [
      ['women', 'Femme'],
      ['men', 'Homme'],
      ['children', 'Enfant'],
      ['baby', 'Bébé'],
      ['underwear-nightwear', 'Sous-vêtements et nuit'],
      ['shoes', 'Chaussures'],
      ['accessories', 'Accessoires'],
      ['sportswear', 'Vêtements de sport'],
    ],
  },
  {
    id: 'pet-store',
    label: 'Animalerie',
    aisles: [
      ['food', 'Alimentation'],
      ['litter', 'Litière'],
      ['care', 'Hygiène et soins'],
      ['accessories-toys', 'Accessoires et jouets'],
      ['aquatics', 'Aquariophilie'],
    ],
  },
  {
    id: 'mobility',
    label: 'Auto, moto et vélo',
    aisles: [
      ['maintenance', 'Entretien'],
      ['parts', 'Pièces et consommables'],
      ['fluids', 'Huiles et liquides'],
      ['cleaning', 'Nettoyage'],
      ['accessories', 'Accessoires'],
      ['safety', 'Sécurité'],
      ['bike-mobility', 'Vélo et mobilité'],
    ],
  },
  {
    id: 'electronics-office',
    label: 'Électronique, électroménager et bureau',
    aisles: [
      ['computing', 'Informatique'],
      ['phones', 'Téléphonie'],
      ['tv-audio', 'TV et audio'],
      ['large-appliances', 'Gros électroménager'],
      ['small-appliances', 'Petit électroménager'],
      ['cables-batteries', 'Câbles, chargeurs et piles'],
      ['office-printing', 'Bureau et impression'],
    ],
  },
  {
    id: 'sport-outdoor',
    label: 'Sport et plein air',
    aisles: [
      ['fitness', 'Fitness et musculation'],
      ['team-sports', 'Sports collectifs'],
      ['hiking-camping', 'Randonnée et camping'],
      ['water-sports', 'Sports nautiques'],
      ['cycling', 'Cyclisme'],
    ],
  },
  {
    id: 'culture-hobbies',
    label: 'Culture, jeux et loisirs créatifs',
    aisles: [
      ['books', 'Livres'],
      ['media', 'Musique, films et médias'],
      ['games-toys', 'Jeux et jouets'],
      ['creative', 'Loisirs créatifs'],
      ['school', 'Papeterie et fournitures scolaires'],
    ],
  },
  {
    id: 'other',
    label: 'Autre',
    aisles: [['unclassified', 'À classer']],
  },
] as const;

const groceryFamilyIds = GROCERY_TAXONOMY.map((family) => family.id) as [
  string,
  ...string[],
];
const groceryAisleIds = [
  ...new Set(
    GROCERY_TAXONOMY.flatMap((family) =>
      family.aisles.map(([aisleId]) => aisleId),
    ),
  ),
] as [string, ...string[]];

export const GroceryStoreFamilySchema = z.enum(groceryFamilyIds, {
  error: 'Famille de magasin inconnue.',
});
export const GroceryAisleSchema = z.enum(groceryAisleIds, {
  error: 'Rayon inconnu.',
});

export function isGroceryClassificationChoice(
  storeFamilyId: string,
  aisleId: string,
): boolean {
  return GROCERY_TAXONOMY.some(
    (family) =>
      family.id === storeFamilyId &&
      family.aisles.some(([candidate]) => candidate === aisleId),
  );
}

export const GroceryClassificationSourceSchema = z.enum([
  'llm',
  'rule',
  'manual',
]);
export const GroceryClassificationChoiceSchema = z
  .object({
    storeFamilyId: GroceryStoreFamilySchema,
    aisleId: GroceryAisleSchema,
  })
  .strict()
  .superRefine((choice, context) => {
    if (!isGroceryClassificationChoice(choice.storeFamilyId, choice.aisleId)) {
      context.addIssue({
        code: 'custom',
        message: 'Ce rayon ne correspond pas à la famille de magasin.',
        path: ['aisleId'],
      });
    }
  });
export const GroceryClassificationRecordSchema =
  GroceryClassificationChoiceSchema.safeExtend({
    itemId: UuidSchema,
    taxonomyId: z.literal(GROCERY_TAXONOMY_ID),
    source: GroceryClassificationSourceSchema,
    confidence: z.number().min(0).max(1),
    itemRevision: z.number().int().nonnegative(),
    labelFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    revision: z.number().int().positive(),
    updatedAt: UtcInstantSchema,
    updatedByProfileId: UuidSchema,
  }).strict();
export const GroceryClassificationProposalItemSchema =
  GroceryClassificationChoiceSchema.safeExtend({
    itemId: UuidSchema,
    label: z.string().trim().min(1).max(200),
    groceryRevision: z.number().int().nonnegative(),
    labelFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    confidence: z.number().min(0).max(1),
    source: GroceryClassificationSourceSchema,
    expectedClassificationRevision: z.number().int().positive().nullable(),
  }).strict();
export const GroceryClassificationJobStatusSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]);
export const GroceryClassificationJobSchema = z
  .object({
    id: UuidSchema,
    taxonomyId: z.literal(GROCERY_TAXONOMY_ID),
    status: GroceryClassificationJobStatusSchema,
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    proposal: z.array(GroceryClassificationProposalItemSchema).nullable(),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .nullable(),
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
    expiresAt: UtcInstantSchema.nullable(),
  })
  .strict();
export const GroceryClassificationApplyItemSchema =
  GroceryClassificationChoiceSchema.safeExtend({
    itemId: UuidSchema,
    expectedClassificationRevision: z.number().int().positive().nullable(),
  }).strict();
export const GroceryClassificationApplyRequestSchema = z
  .object({
    jobId: UuidSchema,
    classifications: z.array(GroceryClassificationApplyItemSchema).max(500),
  })
  .strict();
export const GroceryClassificationApplyResponseSchema = z
  .object({
    classifications: z.array(GroceryClassificationRecordSchema),
    skippedItemIds: z.array(UuidSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();
export const GroceryClassificationChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    classification: GroceryClassificationRecordSchema,
  })
  .strict();
export const GroceryClassificationPullResponseSchema = z
  .object({
    changes: z.array(GroceryClassificationChangeSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

export const SyncOperationSchema = z.discriminatedUnion('entityType', [
  TaskOperationSchema,
  GroceryItemOperationSchema,
]);

export const PushRequestSchema = z
  .object({
    operations: z.array(SyncOperationSchema).max(100),
  })
  .strict();

export const OperationAckSchema = z
  .object({
    operationId: UuidSchema,
    entityId: UuidSchema,
    status: z.enum(['applied', 'conflict']),
    serverRevision: z.number().int().nonnegative(),
    conflictReason: z.enum(['revision_mismatch']).nullable(),
  })
  .strict();

export const PushResponseSchema = z
  .object({
    acks: z.array(OperationAckSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

const TaskChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('task'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    payload: TaskRecordSchema,
  })
  .strict();
const GroceryItemChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('grocery_item'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    payload: GroceryItemRecordSchema,
  })
  .strict();
export const ChangeSchema = z.discriminatedUnion('entityType', [
  TaskChangeSchema,
  GroceryItemChangeSchema,
]);

export const PullResponseSchema = z
  .object({
    changes: z.array(ChangeSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    database: z.literal('ok'),
    ollama: z.literal('not-required'),
    version: z.string(),
  })
  .strict();

export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type TaskRecurrence = z.infer<typeof TaskRecurrenceSchema>;
export type TaskRecurrenceRule = z.infer<typeof TaskRecurrenceRuleSchema>;
export type TaskOperation = z.infer<typeof TaskOperationSchema>;
export type GroceryItemRecord = z.infer<typeof GroceryItemRecordSchema>;
export type GroceryItemOperation = z.infer<typeof GroceryItemOperationSchema>;
export type GroceryClassificationChoice = z.infer<
  typeof GroceryClassificationChoiceSchema
>;
export type GroceryClassificationRecord = z.infer<
  typeof GroceryClassificationRecordSchema
>;
export type GroceryClassificationProposalItem = z.infer<
  typeof GroceryClassificationProposalItemSchema
>;
export type GroceryClassificationJob = z.infer<
  typeof GroceryClassificationJobSchema
>;
export type GroceryClassificationApplyRequest = z.infer<
  typeof GroceryClassificationApplyRequestSchema
>;
export type GroceryClassificationApplyResponse = z.infer<
  typeof GroceryClassificationApplyResponseSchema
>;
export type GroceryClassificationPullResponse = z.infer<
  typeof GroceryClassificationPullResponseSchema
>;
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type PushRequest = z.infer<typeof PushRequestSchema>;
export type OperationAck = z.infer<typeof OperationAckSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type AuthBootstrapRequest = z.infer<typeof AuthBootstrapRequestSchema>;
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;
export type AuthPairRequest = z.infer<typeof AuthPairRequestSchema>;
export type AuthMember = z.infer<typeof AuthMemberSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type AuthStateResponse = z.infer<typeof AuthStateResponseSchema>;
export type AuthDevice = z.infer<typeof AuthDeviceSchema>;

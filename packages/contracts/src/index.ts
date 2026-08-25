import { z } from 'zod';

export const ProtocolVersionSchema = z.literal(1);
export const UuidSchema = z.string().uuid();
export const UtcInstantSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const RobotDirectionSchema = z.enum([
  'forward',
  'backward',
  'left',
  'right',
]);
export const RobotCapabilitySchema = z.enum([
  'teleop',
  'camera_look',
  'camera_stream',
  'line_follow',
  'vision_objects',
  'vision_people',
  'vision_identity',
  'vision_markers',
  'signal_buzzer',
  'signal_lights',
  'map_observer',
  'autonomous_route_replay',
]);
export const RobotOperatingModeSchema = z.enum([
  'manual',
  'autonomous',
  'calibration',
  'line',
  'visual_tracking',
  'markers',
  'companion',
]);
export const RobotDetectionKindSchema = z.enum([
  'object',
  'person',
  'identity',
  'marker',
  'safety',
]);
export const RobotDetectionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: RobotDetectionKindSchema,
    label: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1).nullable(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    trackId: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()
  .refine(
    (detection) =>
      detection.x + detection.width <= 1.000_001 &&
      detection.y + detection.height <= 1.000_001,
    'La détection dépasse les limites de l’image.',
  );
export const RobotVisionFrameSchema = z
  .object({
    frameId: z.number().int().nonnegative(),
    observedAt: UtcInstantSchema,
    expiresAt: UtcInstantSchema,
    imageWidth: z.number().int().positive().max(8_192),
    imageHeight: z.number().int().positive().max(8_192),
    processingMs: z.number().nonnegative().max(60_000),
    detections: z.array(RobotDetectionSchema).max(100),
  })
  .strict();
export const RobotMemoryEntitySchema = z
  .object({
    id: UuidSchema,
    kind: z.enum(['object', 'light']),
    classLabel: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(120),
    roomName: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1),
    status: z.enum(['candidate', 'confirmed', 'uncertain']),
    sightingCount: z.number().int().nonnegative(),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
    lastPosition: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .strict(),
  })
  .strict();
export const RobotMemorySummarySchema = z
  .object({
    roomName: z.string().trim().min(1).max(80),
    entities: z.array(RobotMemoryEntitySchema).max(100),
    anonymousPresence: z
      .object({ active: z.boolean(), lastSeenAt: UtcInstantSchema.nullable() })
      .strict(),
    mapping: z
      .object({
        enabled: z.boolean(),
        status: z.enum(['disabled', 'observer']),
      })
      .strict(),
    learning: z
      .object({
        mode: z.enum(['disabled', 'shadow']),
        policyStatus: z.enum([
          'insufficient_data',
          'candidate',
          'validated',
          'regressed',
          'forbidden',
        ]),
        episodeCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const RobotMemoryRenameRequestSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();
export const RobotMappingStatusSchema = z.enum([
  'inactive',
  'recording',
  'paused',
  'processing',
]);
export const RobotEstimatedPoseSchema = z
  .object({
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    heading: z.number().min(-Math.PI).max(Math.PI),
    uncertainty: z.number().min(0).max(100),
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const RobotMapPointSchema = z
  .object({
    id: UuidSchema,
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    heading: z.number().min(-Math.PI).max(Math.PI),
    uncertainty: z.number().min(0).max(100),
    recordedAt: UtcInstantSchema,
  })
  .strict();
export const RobotMapObjectSchema = z
  .object({
    id: UuidSchema,
    displayName: z.string().trim().min(1).max(120),
    classLabel: z.string().trim().min(1).max(80),
    x: z.number().min(-10_000).max(10_000),
    y: z.number().min(-10_000).max(10_000),
    uncertainty: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    lastSeenAt: UtcInstantSchema,
  })
  .strict();
export const RobotMapPathSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(80),
    status: z.enum(['draft', 'explored', 'certified']),
    points: z.array(RobotMapPointSchema).max(2_000),
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const RobotMapSnapshotSchema = z
  .object({
    version: z.number().int().nonnegative(),
    operatingMode: z.enum(['manual', 'autonomous']),
    mapping: z
      .object({
        status: RobotMappingStatusSchema,
        sessionId: UuidSchema.nullable(),
        startedAt: UtcInstantSchema.nullable(),
        pointCount: z.number().int().nonnegative(),
        storageBytes: z.number().int().nonnegative(),
        quotaBytes: z.number().int().positive(),
      })
      .strict(),
    localization: z
      .object({
        status: z.enum(['unknown', 'estimated', 'uncertain', 'lost']),
        pose: RobotEstimatedPoseSchema,
      })
      .strict(),
    paths: z.array(RobotMapPathSchema).max(20),
    objects: z.array(RobotMapObjectSchema).max(100),
    autonomy: z
      .object({
        available: z.boolean(),
        blockedReason: z.string().trim().min(1).max(240).nullable(),
      })
      .strict(),
  })
  .strict();
export const RobotMappingActionResponseSchema = z
  .object({ accepted: z.literal(true), map: RobotMapSnapshotSchema })
  .strict();
export const RobotMissionPreviewRequestSchema = z
  .object({ targetPointId: UuidSchema })
  .strict();
export const RobotMissionPreviewSchema = z
  .object({
    previewId: UuidSchema,
    targetPointId: UuidSchema,
    expiresAt: UtcInstantSchema,
    allowed: z.boolean(),
    blockedReason: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();
export const RobotTelemetrySchema = z
  .object({
    temperatureC: z.number().min(-20).max(120).nullable(),
    throttledCode: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/u)
      .nullable(),
    underVoltageActive: z.boolean(),
    underVoltageOccurred: z.boolean(),
    irLeftClear: z.boolean().nullable(),
    irRightClear: z.boolean().nullable(),
    lineSensors: z.array(z.number().int().min(0).max(1_023)).length(5),
    cameraFps: z.number().nonnegative().max(120).nullable(),
    commandLatencyMs: z.number().nonnegative().max(60_000).nullable(),
  })
  .strict();
export const RobotStateSchema = z
  .object({
    available: z.boolean(),
    connected: z.boolean(),
    armed: z.boolean(),
    mode: z.enum(['disabled', 'simulated', 'alphabot2']),
    cameraAvailable: z.boolean(),
    actuators: z
      .object({
        wheelsEnabled: z.boolean(),
        cameraServosEnabled: z.boolean(),
      })
      .strict()
      .default({ wheelsEnabled: false, cameraServosEnabled: false }),
    moving: z.boolean(),
    lastSeenAt: UtcInstantSchema.nullable(),
    warning: z.string().trim().min(1).max(300).nullable(),
    capabilities: z.array(RobotCapabilitySchema).max(20),
    operatingMode: RobotOperatingModeSchema,
    controlExpiresAt: UtcInstantSchema.nullable(),
    cameraPose: z
      .object({
        pan: z.number().min(-1).max(1),
        tilt: z.number().min(-1).max(1),
      })
      .strict(),
    telemetry: RobotTelemetrySchema,
    vision: RobotVisionFrameSchema.nullable(),
  })
  .strict();
const ExpiringRobotCommandSchema = z
  .object({
    commandId: UuidSchema,
    issuedAt: UtcInstantSchema,
    expiresAt: UtcInstantSchema,
  })
  .strict();
export const RobotArmRequestSchema = z
  .object({ durationMs: z.number().int().min(1_000).max(60_000) })
  .strict();
export const RobotDriveRequestSchema = ExpiringRobotCommandSchema.extend({
  direction: RobotDirectionSchema,
  intensity: z.number().min(0.1).max(0.35),
  steering: z.number().min(-1).max(1),
  maxDurationMs: z.number().int().min(100).max(500),
}).strict();
export const RobotCameraLookRequestSchema = ExpiringRobotCommandSchema.extend({
  pan: z.number().min(-1).max(1),
  tilt: z.number().min(-1).max(1),
}).strict();
export const RobotOperatingModeRequestSchema = z
  .object({ mode: RobotOperatingModeSchema })
  .strict();
export const RobotActuatorsRequestSchema = z
  .object({
    wheelsEnabled: z.boolean(),
    cameraServosEnabled: z.boolean(),
  })
  .strict();
export const RobotCommandResponseSchema = z
  .object({ accepted: z.literal(true), state: RobotStateSchema })
  .strict();

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
export const AuthLoginRequestSchema = AuthCredentialsSchema;
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
  .object({ devices: z.array(AuthDeviceSchema).max(50) })
  .strict();
export const AuthMembersResponseSchema = z
  .object({ members: z.array(AuthMemberSchema).max(2) })
  .strict();
export const AuthDeviceApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
]);
export const AuthDeviceApprovalRequiredSchema = z
  .object({
    approvalRequired: z.literal(true),
    expiresAt: UtcInstantSchema,
    requestId: UuidSchema,
    statusToken: z.string().min(32).max(128),
  })
  .strict();
export const AuthLoginResponseSchema = z.union([
  AuthSessionSchema,
  AuthDeviceApprovalRequiredSchema,
]);
export const AuthDeviceApprovalRequestSchema = z
  .object({
    createdAt: UtcInstantSchema,
    deviceId: UuidSchema,
    deviceName: z.string().min(1).max(80),
    expiresAt: UtcInstantSchema,
    id: UuidSchema,
    requestIp: z.string().min(1).max(80).nullable(),
    status: AuthDeviceApprovalStatusSchema,
  })
  .strict();
export const AuthDeviceApprovalRequestsResponseSchema = z
  .object({ requests: z.array(AuthDeviceApprovalRequestSchema).max(10) })
  .strict();
export const AuthDeviceApprovalStatusResponseSchema = z
  .object({ status: AuthDeviceApprovalStatusSchema })
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

export const BudgetCategorySchema = z.enum([
  'fixed',
  'groceries',
  'health',
  'leisure',
  'extra',
]);
export const BudgetOwnerProfileIdSchema = UuidSchema.nullable();
export const BudgetFrequencySchema = z.enum(['monthly', 'yearly']);
export const BudgetEntryKindSchema = z.enum([
  'expense',
  'income',
  'savings_transfer',
]);
export const BudgetIncomeTypeSchema = z.enum(['regular', 'extra']);
export const BudgetTransferDirectionSchema = z.enum(['deposit', 'withdrawal']);
export const BudgetSourceSchema = z.enum(['manual', 'automatic', 'import']);
export const BudgetRolloverSchema = z.enum(['reset', 'carry']);
export const BudgetEnvelopeKindSchema = z.enum(['monthly', 'project']);
export const BudgetPlannedExpenseStatusSchema = z.enum([
  'draft',
  'planned',
  'paid',
  'cancelled',
]);
export const BudgetPrioritySchema = z.enum(['low', 'medium', 'high']);

const BudgetAuditFieldsSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema,
  revision: z.number().int().nonnegative(),
  createdAt: UtcInstantSchema,
  updatedAt: UtcInstantSchema,
  deletedAt: UtcInstantSchema.nullable(),
  createdByProfileId: UuidSchema,
  updatedByProfileId: UuidSchema,
  deviceId: UuidSchema,
  schemaVersion: z.literal(1),
});

export const BudgetEntryRecordSchema = BudgetAuditFieldsSchema.extend({
  kind: BudgetEntryKindSchema,
  category: BudgetCategorySchema.nullable(),
  incomeType: BudgetIncomeTypeSchema.nullable(),
  transferDirection: BudgetTransferDirectionSchema.nullable(),
  label: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1_000_000_000),
  occurredOn: LocalDateSchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  envelopeId: UuidSchema.nullable(),
  plannedExpenseId: UuidSchema.nullable(),
  recurringTemplateId: UuidSchema.nullable(),
  correctionOfId: UuidSchema.nullable(),
  source: BudgetSourceSchema,
})
  .strict()
  .superRefine((entry, context) => {
    if (entry.kind === 'expense' && entry.category === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une dépense exige une catégorie.',
        path: ['category'],
      });
    }
    if (entry.kind === 'income' && entry.incomeType === null) {
      context.addIssue({
        code: 'custom',
        message: 'Un revenu exige un type.',
        path: ['incomeType'],
      });
    }
    if (entry.kind === 'savings_transfer' && entry.transferDirection === null) {
      context.addIssue({
        code: 'custom',
        message: "Un mouvement d'épargne exige un sens.",
        path: ['transferDirection'],
      });
    }
    if (entry.kind !== 'expense' && entry.category !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Seules les dépenses ont une catégorie.',
        path: ['category'],
      });
    }
  });

export const BudgetRecurringTemplateRecordSchema =
  BudgetAuditFieldsSchema.extend({
    kind: BudgetEntryKindSchema,
    category: BudgetCategorySchema.nullable(),
    incomeType: BudgetIncomeTypeSchema.nullable(),
    transferDirection: BudgetTransferDirectionSchema.nullable(),
    label: z.string().trim().min(1).max(200),
    amountCents: z.number().int().nonnegative().max(1_000_000_000),
    frequency: BudgetFrequencySchema,
    dueDay: z.number().int().min(1).max(31),
    dueMonth: z.number().int().min(1).max(12).nullable(),
    startDate: LocalDateSchema,
    endDate: LocalDateSchema.nullable(),
    essential: z.boolean(),
    active: z.boolean(),
    ownerProfileId: BudgetOwnerProfileIdSchema,
    envelopeId: UuidSchema.nullable(),
  })
    .strict()
    .superRefine((template, context) => {
      if (template.frequency === 'yearly' && template.dueMonth === null) {
        context.addIssue({
          code: 'custom',
          message: 'Une récurrence annuelle exige un mois.',
          path: ['dueMonth'],
        });
      }
      if (template.frequency === 'monthly' && template.dueMonth !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Une récurrence mensuelle ne fixe pas de mois.',
          path: ['dueMonth'],
        });
      }
      if (template.active && template.amountCents === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Un modèle actif exige un montant.',
          path: ['amountCents'],
        });
      }
      if (template.kind === 'expense' && template.category === null) {
        context.addIssue({
          code: 'custom',
          message: 'Une dépense exige une catégorie.',
          path: ['category'],
        });
      }
      if (template.kind === 'income' && template.incomeType === null) {
        context.addIssue({
          code: 'custom',
          message: 'Un revenu exige un type.',
          path: ['incomeType'],
        });
      }
      if (
        template.kind === 'savings_transfer' &&
        template.transferDirection === null
      ) {
        context.addIssue({
          code: 'custom',
          message: "Un mouvement d'épargne exige un sens.",
          path: ['transferDirection'],
        });
      }
    });

export const BudgetEnvelopeRecordSchema = BudgetAuditFieldsSchema.extend({
  name: z.string().trim().min(1).max(100),
  kind: BudgetEnvelopeKindSchema,
  category: BudgetCategorySchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  monthlyAllocationCents: z.number().int().nonnegative().max(1_000_000_000),
  rollover: BudgetRolloverSchema,
  targetAmountCents: z.number().int().positive().max(1_000_000_000).nullable(),
  dueDate: LocalDateSchema.nullable(),
  active: z.boolean(),
})
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.category === 'fixed') {
      context.addIssue({
        code: 'custom',
        message: 'Les frais fixes restent hors enveloppes.',
        path: ['category'],
      });
    }
    if (envelope.kind === 'project' && envelope.rollover !== 'carry') {
      context.addIssue({
        code: 'custom',
        message: 'Un projet doit cumuler son solde.',
        path: ['rollover'],
      });
    }
  });

export const BudgetPlannedExpenseRecordSchema = BudgetAuditFieldsSchema.extend({
  label: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1_000_000_000),
  dueDate: LocalDateSchema,
  category: BudgetCategorySchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  priority: BudgetPrioritySchema.nullable(),
  status: BudgetPlannedExpenseStatusSchema,
  envelopeId: UuidSchema.nullable(),
  provisionAccepted: z.boolean(),
  provisionStartedMonth: LocalDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Le mois de provision doit commencer le premier.',
  )
    .nullable()
    .default(null),
  monthlyProvisionCents: z.number().int().nonnegative().max(1_000_000_000),
  paidEntryId: UuidSchema.nullable(),
  note: z.string().trim().max(2_000).nullable(),
}).strict();

export const BudgetSavingsMonthRecordSchema = BudgetAuditFieldsSchema.extend({
  month: LocalDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Le mois doit commencer le premier.',
  ),
  targetCents: z.number().int().nonnegative().max(1_000_000_000),
  reserveOpeningBalanceCents: z.number().int().nonnegative().max(1_000_000_000),
  reserveAsOfDate: LocalDateSchema,
  reserveTargetMonths: z.number().int().min(1).max(24),
}).strict();

function budgetOperationSchema<
  EntityType extends string,
  Schema extends z.ZodType,
>(entityType: EntityType, payload: Schema) {
  return z
    .object({
      protocolVersion: ProtocolVersionSchema,
      operationId: UuidSchema,
      deviceId: UuidSchema,
      profileId: UuidSchema,
      entityType: z.literal(entityType),
      entityId: UuidSchema,
      operation: z.literal('upsert'),
      baseRevision: z.number().int().nonnegative(),
      clientCreatedAt: UtcInstantSchema,
      payload,
    })
    .strict();
}

export const BudgetEntryOperationSchema = budgetOperationSchema(
  'budget_entry',
  BudgetEntryRecordSchema,
);
export const BudgetRecurringTemplateOperationSchema = budgetOperationSchema(
  'budget_recurring_template',
  BudgetRecurringTemplateRecordSchema,
);
export const BudgetEnvelopeOperationSchema = budgetOperationSchema(
  'budget_envelope',
  BudgetEnvelopeRecordSchema,
);
export const BudgetPlannedExpenseOperationSchema = budgetOperationSchema(
  'budget_planned_expense',
  BudgetPlannedExpenseRecordSchema,
);
export const BudgetSavingsMonthOperationSchema = budgetOperationSchema(
  'budget_savings_month',
  BudgetSavingsMonthRecordSchema,
);

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

export const GroceryPhotoMediaTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const GroceryPhotoTranscriptionItemSchema = z
  .object({
    box: z
      .object({
        x: z.number().int().min(0).max(1000),
        y: z.number().int().min(0).max(1000),
        width: z.number().int().min(1).max(1000),
        height: z.number().int().min(1).max(1000),
      })
      .strict(),
    label: z.string().trim().min(1).max(200),
    quantityText: z.string().trim().min(1).max(80).nullable(),
    sourceText: z.string().trim().min(1).max(240),
  })
  .strict();
export const GroceryPhotoTranscriptionRequestSchema = z
  .object({
    imageBase64: z.string().min(16).max(420_000),
    mediaType: GroceryPhotoMediaTypeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.imageBase64)) {
      context.addIssue({
        code: 'custom',
        message: 'Image encodée invalide.',
        path: ['imageBase64'],
      });
      return;
    }
    const padding = input.imageBase64.endsWith('==')
      ? 2
      : input.imageBase64.endsWith('=')
        ? 1
        : 0;
    const byteLength = Math.floor((input.imageBase64.length * 3) / 4) - padding;
    if (byteLength > 300_000) {
      context.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum: 300_000,
        inclusive: true,
        message: 'La photo redimensionnée dépasse 300 Ko.',
        path: ['imageBase64'],
      });
    }
  });
export const GroceryPhotoTranscriptionResponseSchema = z
  .object({
    items: z.array(GroceryPhotoTranscriptionItemSchema).max(60),
  })
  .strict();

export const AssistantModeSchema = z.enum([
  'local',
  'web_light',
  'web_deep',
  'friday',
]);
export const AssistantModelSchema = z.enum(['gemma4', 'qwen3.5']);
export const AssistantThinkingPolicySchema = z.enum(['auto', 'forced']);
export const AssistantResearchOutcomeSchema = z.enum([
  'not_needed',
  'completed',
  'partial',
  'unavailable',
  'quota_exhausted',
]);
export const AssistantStoredModeSchema = z.enum(['auto', 'web', 'classic']);
export const AssistantStoredEffectiveModeSchema = z.enum(['web', 'classic']);
export const AssistantStoredWebDepthSchema = z.enum(['fast', 'deep']);
export const AssistantRunStatusSchema = z.enum([
  'queued',
  'preparing',
  'awaiting_search_consent',
  'searching',
  'reading',
  'verifying',
  'writing',
  'completed',
  'cancel_requested',
  'cancelled',
  'failed',
]);
export const AssistantConversationSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(80),
    mode: AssistantModeSchema.default('local'),
    archivedAt: UtcInstantSchema.nullable(),
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const AssistantSourceSchema = z
  .object({
    id: z.string().regex(/^S[1-9]\d*$/u),
    title: z.string().min(1).max(500),
    url: z.string().url(),
    domain: z.string().min(1).max(255),
    publishedAt: UtcInstantSchema.nullable(),
    retrievedAt: UtcInstantSchema,
  })
  .strict();
export const AssistantRunEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    runId: UuidSchema,
    status: AssistantRunStatusSchema,
    label: z.string().min(1).max(160),
    createdAt: UtcInstantSchema,
  })
  .strict();
export const AssistantMessageSchema = z
  .object({
    id: UuidSchema,
    conversationId: UuidSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().max(100_000),
    requestedMode: AssistantStoredModeSchema.nullable(),
    effectiveMode: AssistantStoredEffectiveModeSchema.nullable(),
    webDepth: AssistantStoredWebDepthSchema.nullable().optional(),
    mode: AssistantModeSchema.default('local'),
    model: AssistantModelSchema.default('gemma4'),
    thinkingPolicy: AssistantThinkingPolicySchema.default('auto'),
    thinkingUsed: z.boolean().default(false),
    researchOutcome: AssistantResearchOutcomeSchema.default('not_needed'),
    creditsUsed: z.number().int().nonnegative().default(0),
    runId: UuidSchema.nullable(),
    sources: z.array(AssistantSourceSchema),
    progressEvents: z.array(AssistantRunEventSchema).default([]),
    createdAt: UtcInstantSchema,
  })
  .strict();
export const AssistantRunSchema = z
  .object({
    id: UuidSchema,
    conversationId: UuidSchema,
    userMessageId: UuidSchema,
    assistantMessageId: UuidSchema.nullable(),
    requestedMode: AssistantStoredModeSchema,
    effectiveMode: AssistantStoredEffectiveModeSchema.nullable(),
    webDepth: AssistantStoredWebDepthSchema.nullable().optional(),
    mode: AssistantModeSchema.default('local'),
    model: AssistantModelSchema.default('gemma4'),
    thinkingPolicy: AssistantThinkingPolicySchema.default('auto'),
    thinkingUsed: z.boolean().default(false),
    researchOutcome: AssistantResearchOutcomeSchema.default('not_needed'),
    creditsUsed: z.number().int().nonnegative().default(0),
    status: AssistantRunStatusSchema,
    stageLabel: z.string().min(1).max(160),
    queuePosition: z.number().int().positive().nullable(),
    searchQueries: z.array(z.string().min(1).max(500)).max(6),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .nullable(),
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const AssistantCreateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80).default('Nouvelle conversation'),
    mode: AssistantModeSchema.default('local'),
  })
  .strict();
export const AssistantUpdateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    archived: z.boolean().optional(),
    mode: AssistantModeSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.archived !== undefined ||
      value.mode !== undefined,
  );
export const AssistantSendMessageRequestSchema = z
  .object({
    clientRequestId: UuidSchema,
    content: z.string().trim().min(1).max(8_000),
    mode: AssistantModeSchema,
    model: AssistantModelSchema.default('qwen3.5'),
    thinkingPolicy: AssistantThinkingPolicySchema.default('auto'),
  })
  .strict();
export const AssistantSearchConsentRequestSchema = z
  .object({
    approved: z.boolean(),
    queries: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  })
  .strict();
export const AssistantWebUsageSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    creditsUsed: z.number().int().nonnegative(),
    remainingBasicSearches: z.number().int().nonnegative(),
    source: z.enum(['tavily', 'local']),
    softLimit: z.number().int().positive(),
    deepLimit: z.number().int().positive(),
    hardLimit: z.number().int().positive(),
  })
  .strict();
export const AssistantExaUsageSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    calls: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    emptyResults: z.number().int().nonnegative(),
    rateLimits: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    status: z.enum(['untested', 'available', 'rate_limited', 'unavailable']),
    lastAttemptAt: UtcInstantSchema.nullable(),
    message: z.string().max(160).nullable(),
    cooldownUntil: UtcInstantSchema.nullable(),
  })
  .strict();
export const ResearchDiagnosticSchema = z
  .object({
    runId: UuidSchema,
    provider: z.enum(['tavily', 'exa']),
    status: z.enum([
      'success',
      'empty',
      'rate_limited',
      'unavailable',
      'failed',
      'skipped',
    ]),
    calls: z.number().int().nonnegative(),
    results: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    message: z.string().max(160),
    sourceIds: z.array(z.string().regex(/^S[1-9]\d*$/u)),
  })
  .strict();
export const AssistantResearchDiagnosticsResponseSchema = z
  .object({ diagnostics: z.array(ResearchDiagnosticSchema) })
  .strict();
export const AssistantConversationsResponseSchema = z
  .object({ conversations: z.array(AssistantConversationSchema) })
  .strict();
export const AssistantMessagesResponseSchema = z
  .object({
    conversation: AssistantConversationSchema,
    messages: z.array(AssistantMessageSchema),
    activeRun: AssistantRunSchema.nullable(),
  })
  .strict();
export const AssistantSubmissionResponseSchema = z
  .object({ message: AssistantMessageSchema, run: AssistantRunSchema })
  .strict();
export const AssistantRunEventsResponseSchema = z
  .object({
    events: z.array(AssistantRunEventSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();
export const AssistantQueueSummarySchema = z
  .object({
    pending: z.number().int().nonnegative(),
    activeRun: AssistantRunSchema.nullable(),
  })
  .strict();

export const InferenceWorkloadKindSchema = z.enum(['assistant', 'watch']);
export const InferenceStatusSchema = z
  .object({
    active: z
      .object({
        kind: InferenceWorkloadKindSchema,
        startedAt: UtcInstantSchema,
      })
      .strict()
      .nullable(),
    queued: z
      .object({
        assistant: z.number().int().nonnegative(),
        watch: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const WatchCadenceSchema = z.enum(['daily', 'weekly']);
export const WatchStatusSchema = z.enum(['active', 'paused']);
export const WatchNoveltySchema = z.enum(['new', 'evolution', 'confirmation']);
export const WatchConceptStateSchema = z.enum([
  'tracked',
  'secondary',
  'muted',
]);
export const WatchTopicEventKindSchema = z.enum([
  'new_topic',
  'major_update',
  'additional_detail',
  'confirmation',
  'contradiction',
  'duplicate',
  'noise',
]);
export const WatchSourceKindSchema = z.enum([
  'official',
  'research',
  'specialized_press',
  'general_press',
  'community',
]);
export const WatchRunStageSchema = z.enum([
  'queued',
  'discovering',
  'collecting',
  'extracting',
  'clustering',
  'synthesizing',
  'completed',
  'failed',
]);
export const WatchRunTriggerSchema = z.enum([
  'initialization',
  'scheduled',
  'catch_up',
  'manual',
  'resume',
]);
export const WatchArticleStateValueSchema = z.enum([
  'unread',
  'read',
  'useful',
  'follow_up',
  'hidden',
]);
export const WatchSourceSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(160),
    siteUrl: z.string().url(),
    feedUrl: z.string().url(),
    lastFetchedAt: UtcInstantSchema.nullable(),
    lastError: z.string().max(500).nullable(),
  })
  .strict();
export const WatchSourceCandidateSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(300),
    siteUrl: z.string().url(),
    feedUrl: z.string().url().nullable(),
    kind: WatchSourceKindSchema,
    language: z.string().trim().min(2).max(12),
    score: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(500),
    status: z.enum(['validated', 'rejected']),
  })
  .strict();
export const WatchThemeProposalSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().min(3).max(500),
  })
  .strict();
export const WatchDiscoverySchema = z
  .object({
    id: UuidSchema,
    concepts: z.array(z.string().trim().min(1).max(80)).max(20),
    themes: z.array(WatchThemeProposalSchema).min(5).max(8),
    candidates: z.array(WatchSourceCandidateSchema).max(40),
    examinedCount: z.number().int().nonnegative(),
    validatedCount: z.number().int().nonnegative(),
    creditsUsed: z.number().int().nonnegative(),
    createdAt: UtcInstantSchema,
  })
  .strict();
export const WatchConceptSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    label: z.string().trim().min(1).max(80),
    state: WatchConceptStateSchema,
    origin: z.enum(['user', 'assistant']),
    articleCount: z.number().int().nonnegative(),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
  })
  .strict();
export const WatchTopicSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(4_000),
    eventKind: WatchTopicEventKindSchema,
    importance: z.number().min(0).max(1),
    articleIds: z.array(UuidSchema).max(30),
    conceptIds: z.array(UuidSchema).max(20),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
  })
  .strict();
export const WatchRunProgressSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    trigger: WatchRunTriggerSchema.default('scheduled'),
    stage: WatchRunStageSchema,
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    error: z.string().max(500).nullable(),
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const WatchSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .default(['fr', 'en']),
    cadence: WatchCadenceSchema,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
    weekday: z.number().int().min(1).max(7).nullable(),
    timeZone: z.string().trim().min(1).max(80),
    status: WatchStatusSchema,
    sources: z.array(WatchSourceSchema).max(15),
    nextDigestAt: UtcInstantSchema,
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
  })
  .strict();
export const WatchArticleSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    sourceId: UuidSchema,
    sourceTitle: z.string().min(1).max(160),
    title: z.string().min(1).max(500),
    url: z.string().url(),
    publishedAt: UtcInstantSchema.nullable(),
    collectedAt: UtcInstantSchema,
    excerpt: z.string().max(8_000),
    summary: z.string().max(4_000).nullable(),
    relevanceReason: z.string().max(500).nullable(),
    novelty: WatchNoveltySchema.nullable(),
    relevant: z.boolean(),
    baseline: z.boolean(),
    state: WatchArticleStateValueSchema,
  })
  .strict();
export const WatchDigestSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    title: z.string().min(1).max(160),
    summary: z.string().max(8_000),
    articleIds: z.array(UuidSchema).max(10),
    newCount: z.number().int().nonnegative(),
    createdAt: UtcInstantSchema,
  })
  .strict();
export const WatchOverviewSchema = z
  .object({
    watches: z.array(WatchSchema),
    articles: z.array(WatchArticleSchema),
    digests: z.array(WatchDigestSchema),
    unreadRelevantCount: z.number().int().nonnegative(),
    concepts: z.array(WatchConceptSchema).default([]),
    topics: z.array(WatchTopicSchema).default([]),
    runs: z.array(WatchRunProgressSchema).default([]),
  })
  .strict();
export const WatchDiscoveryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(3).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    languages: z.array(z.string().trim().min(2).max(12)).min(1).max(4),
  })
  .strict();
const WatchCreateRequestObjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    themes: z.array(WatchThemeProposalSchema).max(8).optional(),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .default(['fr', 'en']),
    cadence: WatchCadenceSchema,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
    weekday: z.number().int().min(1).max(7).nullable(),
    timeZone: z.string().trim().min(1).max(80).default('Europe/Paris'),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            siteUrl: z.string().url(),
            feedUrl: z.string().url(),
          })
          .strict(),
      )
      .min(1)
      .max(15),
  })
  .strict();
export const WatchCreateRequestSchema =
  WatchCreateRequestObjectSchema.superRefine((value, context) => {
    if (value.cadence === 'weekly' && value.weekday === null)
      context.addIssue({ code: 'custom', message: 'weekday_required' });
  });
export const WatchUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    question: z.string().trim().min(1).max(500).optional(),
    includeKeywords: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .optional(),
    excludeKeywords: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .optional(),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .optional(),
    cadence: WatchCadenceSchema.optional(),
    localTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .optional(),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            siteUrl: z.string().url(),
            feedUrl: z.string().url(),
          })
          .strict(),
      )
      .min(1)
      .max(15)
      .optional(),
    status: WatchStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cadence === 'weekly' && value.weekday == null)
      context.addIssue({ code: 'custom', message: 'weekday_required' });
  });
export const WatchSourceValidateRequestSchema = z
  .object({ url: z.string().url().max(2_000) })
  .strict();
export const WatchAddDiscoveredSourcesRequestSchema = z
  .object({
    discoveryId: UuidSchema,
    candidateIds: z.array(UuidSchema).min(1).max(15),
  })
  .strict();
export const WatchAddDiscoveredSourcesResponseSchema = z
  .object({
    watch: WatchSchema,
    addedCount: z.number().int().nonnegative().max(15),
  })
  .strict();
export const WatchArticleStateRequestSchema = z
  .object({
    operationId: UuidSchema,
    state: WatchArticleStateValueSchema,
    exclusionKeyword: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict();
export const WatchConceptStateRequestSchema = z
  .object({
    operationId: UuidSchema,
    state: WatchConceptStateSchema,
  })
  .strict();

export const SyncOperationSchema = z.discriminatedUnion('entityType', [
  TaskOperationSchema,
  GroceryItemOperationSchema,
  BudgetEntryOperationSchema,
  BudgetRecurringTemplateOperationSchema,
  BudgetEnvelopeOperationSchema,
  BudgetPlannedExpenseOperationSchema,
  BudgetSavingsMonthOperationSchema,
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
function budgetChangeSchema<
  EntityType extends string,
  Schema extends z.ZodType,
>(entityType: EntityType, payload: Schema) {
  return z
    .object({
      cursor: z.number().int().positive(),
      entityType: z.literal(entityType),
      entityId: UuidSchema,
      operation: z.literal('upsert'),
      payload,
    })
    .strict();
}
const BudgetEntryChangeSchema = budgetChangeSchema(
  'budget_entry',
  BudgetEntryRecordSchema,
);
const BudgetRecurringTemplateChangeSchema = budgetChangeSchema(
  'budget_recurring_template',
  BudgetRecurringTemplateRecordSchema,
);
const BudgetEnvelopeChangeSchema = budgetChangeSchema(
  'budget_envelope',
  BudgetEnvelopeRecordSchema,
);
const BudgetPlannedExpenseChangeSchema = budgetChangeSchema(
  'budget_planned_expense',
  BudgetPlannedExpenseRecordSchema,
);
const BudgetSavingsMonthChangeSchema = budgetChangeSchema(
  'budget_savings_month',
  BudgetSavingsMonthRecordSchema,
);
export const ChangeSchema = z.discriminatedUnion('entityType', [
  TaskChangeSchema,
  GroceryItemChangeSchema,
  BudgetEntryChangeSchema,
  BudgetRecurringTemplateChangeSchema,
  BudgetEnvelopeChangeSchema,
  BudgetPlannedExpenseChangeSchema,
  BudgetSavingsMonthChangeSchema,
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
export type BudgetCategory = z.infer<typeof BudgetCategorySchema>;
export type BudgetEntryRecord = z.infer<typeof BudgetEntryRecordSchema>;
export type BudgetRecurringTemplateRecord = z.infer<
  typeof BudgetRecurringTemplateRecordSchema
>;
export type BudgetEnvelopeRecord = z.infer<typeof BudgetEnvelopeRecordSchema>;
export type BudgetPlannedExpenseRecord = z.infer<
  typeof BudgetPlannedExpenseRecordSchema
>;
export type BudgetSavingsMonthRecord = z.infer<
  typeof BudgetSavingsMonthRecordSchema
>;
export type BudgetEntryOperation = z.infer<typeof BudgetEntryOperationSchema>;
export type BudgetRecurringTemplateOperation = z.infer<
  typeof BudgetRecurringTemplateOperationSchema
>;
export type BudgetEnvelopeOperation = z.infer<
  typeof BudgetEnvelopeOperationSchema
>;
export type BudgetPlannedExpenseOperation = z.infer<
  typeof BudgetPlannedExpenseOperationSchema
>;
export type BudgetSavingsMonthOperation = z.infer<
  typeof BudgetSavingsMonthOperationSchema
>;
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
export type GroceryPhotoMediaType = z.infer<typeof GroceryPhotoMediaTypeSchema>;
export type GroceryPhotoTranscriptionItem = z.infer<
  typeof GroceryPhotoTranscriptionItemSchema
>;
export type GroceryPhotoTranscriptionRequest = z.infer<
  typeof GroceryPhotoTranscriptionRequestSchema
>;
export type GroceryPhotoTranscriptionResponse = z.infer<
  typeof GroceryPhotoTranscriptionResponseSchema
>;
export type AssistantMode = z.infer<typeof AssistantModeSchema>;
export type AssistantModel = z.infer<typeof AssistantModelSchema>;
export type AssistantThinkingPolicy = z.infer<
  typeof AssistantThinkingPolicySchema
>;
export type AssistantResearchOutcome = z.infer<
  typeof AssistantResearchOutcomeSchema
>;
export type AssistantStoredEffectiveMode = z.infer<
  typeof AssistantStoredEffectiveModeSchema
>;
export type AssistantStoredWebDepth = z.infer<
  typeof AssistantStoredWebDepthSchema
>;
export type AssistantRunStatus = z.infer<typeof AssistantRunStatusSchema>;
export type AssistantConversation = z.infer<typeof AssistantConversationSchema>;
export type AssistantSource = z.infer<typeof AssistantSourceSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type AssistantRun = z.infer<typeof AssistantRunSchema>;
export type AssistantRunEvent = z.infer<typeof AssistantRunEventSchema>;
export type AssistantSendMessageRequest = z.infer<
  typeof AssistantSendMessageRequestSchema
>;
export type AssistantWebUsage = z.infer<typeof AssistantWebUsageSchema>;
export type AssistantExaUsage = z.infer<typeof AssistantExaUsageSchema>;
export type ResearchDiagnostic = z.infer<typeof ResearchDiagnosticSchema>;
export type AssistantResearchDiagnosticsResponse = z.infer<
  typeof AssistantResearchDiagnosticsResponseSchema
>;
export type InferenceWorkloadKind = z.infer<typeof InferenceWorkloadKindSchema>;
export type InferenceStatus = z.infer<typeof InferenceStatusSchema>;
export type WatchCadence = z.infer<typeof WatchCadenceSchema>;
export type WatchStatus = z.infer<typeof WatchStatusSchema>;
export type WatchNovelty = z.infer<typeof WatchNoveltySchema>;
export type WatchConceptState = z.infer<typeof WatchConceptStateSchema>;
export type WatchTopicEventKind = z.infer<typeof WatchTopicEventKindSchema>;
export type WatchSourceKind = z.infer<typeof WatchSourceKindSchema>;
export type WatchRunStage = z.infer<typeof WatchRunStageSchema>;
export type WatchRunTrigger = z.infer<typeof WatchRunTriggerSchema>;
export type WatchArticleStateValue = z.infer<
  typeof WatchArticleStateValueSchema
>;
export type WatchSource = z.infer<typeof WatchSourceSchema>;
export type Watch = z.infer<typeof WatchSchema>;
export type WatchArticle = z.infer<typeof WatchArticleSchema>;
export type WatchDigest = z.infer<typeof WatchDigestSchema>;
export type WatchOverview = z.infer<typeof WatchOverviewSchema>;
export type WatchConcept = z.infer<typeof WatchConceptSchema>;
export type WatchTopic = z.infer<typeof WatchTopicSchema>;
export type WatchRunProgress = z.infer<typeof WatchRunProgressSchema>;
export type WatchDiscovery = z.infer<typeof WatchDiscoverySchema>;
export type WatchThemeProposal = z.infer<typeof WatchThemeProposalSchema>;
export type WatchDiscoveryRequest = z.infer<typeof WatchDiscoveryRequestSchema>;
export type WatchCreateRequest = z.infer<typeof WatchCreateRequestSchema>;
export type WatchAddDiscoveredSourcesRequest = z.infer<
  typeof WatchAddDiscoveredSourcesRequestSchema
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
export type AuthDeviceApprovalRequest = z.infer<
  typeof AuthDeviceApprovalRequestSchema
>;
export type AuthDeviceApprovalRequired = z.infer<
  typeof AuthDeviceApprovalRequiredSchema
>;
export type AuthDeviceApprovalStatus = z.infer<
  typeof AuthDeviceApprovalStatusSchema
>;
export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;
export type RobotDirection = z.infer<typeof RobotDirectionSchema>;
export type RobotCapability = z.infer<typeof RobotCapabilitySchema>;
export type RobotOperatingMode = z.infer<typeof RobotOperatingModeSchema>;
export type RobotDetectionKind = z.infer<typeof RobotDetectionKindSchema>;
export type RobotDetection = z.infer<typeof RobotDetectionSchema>;
export type RobotVisionFrame = z.infer<typeof RobotVisionFrameSchema>;
export type RobotMemoryEntity = z.infer<typeof RobotMemoryEntitySchema>;
export type RobotMemorySummary = z.infer<typeof RobotMemorySummarySchema>;
export type RobotMappingStatus = z.infer<typeof RobotMappingStatusSchema>;
export type RobotEstimatedPose = z.infer<typeof RobotEstimatedPoseSchema>;
export type RobotMapPoint = z.infer<typeof RobotMapPointSchema>;
export type RobotMapObject = z.infer<typeof RobotMapObjectSchema>;
export type RobotMapPath = z.infer<typeof RobotMapPathSchema>;
export type RobotMapSnapshot = z.infer<typeof RobotMapSnapshotSchema>;
export type RobotMissionPreview = z.infer<typeof RobotMissionPreviewSchema>;
export type RobotTelemetry = z.infer<typeof RobotTelemetrySchema>;
export type RobotState = z.infer<typeof RobotStateSchema>;
export type RobotArmRequest = z.infer<typeof RobotArmRequestSchema>;
export type RobotDriveRequest = z.infer<typeof RobotDriveRequestSchema>;
export type RobotCameraLookRequest = z.infer<
  typeof RobotCameraLookRequestSchema
>;
export type RobotOperatingModeRequest = z.infer<
  typeof RobotOperatingModeRequestSchema
>;
export type RobotActuatorsRequest = z.infer<typeof RobotActuatorsRequestSchema>;
export type RobotCommandResponse = z.infer<typeof RobotCommandResponseSchema>;

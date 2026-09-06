import { z } from 'zod';
import { UtcInstantSchema, UuidSchema } from './common.ts';

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
  'visual_topology',
  'topological_autonomy',
  'network_standby',
]);

export const RobotPowerStateSchema = z.enum([
  'awake',
  'sleeping',
  'transitioning',
  'degraded',
  'unavailable',
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

export const RobotVisualPlaceStatusSchema = z.enum([
  'provisional',
  'confirmed',
  'ambiguous',
]);

export const RobotVisualPlaceSchema = z
  .object({
    id: UuidSchema,
    status: RobotVisualPlaceStatusSchema,
    label: z.string().trim().min(1).max(80).nullable(),
    confidence: z.number().min(0).max(1),
    viewCount: z.number().int().nonnegative().max(3),
    objectCount: z.number().int().nonnegative(),
    panoramaStatus: z.enum(['absent', 'incomplete', 'complete']),
    canonicalSectorId: UuidSchema.nullable(),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
  })
  .strict();

export const RobotVisualPlaceViewSchema = z
  .object({
    id: UuidSchema,
    placeId: UuidSchema,
    observedAt: UtcInstantSchema,
    pan: z.number().min(-1).max(1),
    tilt: z.number().min(-1).max(1),
    quality: z.number().nonnegative(),
    hasImage: z.boolean(),
  })
  .strict();

export const RobotVisualTransitionSchema = z
  .object({
    id: UuidSchema,
    fromPlaceId: UuidSchema,
    toPlaceId: UuidSchema,
    direction: z.enum(['forward', 'backward', 'left', 'right', 'unknown']),
    status: z.enum([
      'candidate',
      'confirmed',
      'reverse_hypothesis',
      'temporarily_blocked',
    ]),
    confidence: z.number().min(0).max(1),
    traversalCount: z.number().int().positive(),
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    fromSectorId: UuidSchema.nullable(),
    toSectorId: UuidSchema.nullable(),
    expectedDurationMs: z.number().int().positive().max(120_000).nullable(),
    lastTraversedAt: UtcInstantSchema,
  })
  .strict();

export const RobotVisualSectorSchema = z
  .object({
    id: UuidSchema,
    placeId: UuidSchema,
    ordinal: z.number().int().min(0).max(11),
    quality: z.number().nonnegative(),
    observedAt: UtcInstantSchema,
    isCanonical: z.boolean(),
  })
  .strict();

export const RobotVisualPortSchema = z
  .object({
    id: UuidSchema,
    placeId: UuidSchema,
    sectorId: UuidSchema,
    status: z.enum([
      'unknown',
      'candidate',
      'exploring',
      'passage_candidate',
      'passage_confirmed',
      'temporarily_blocked',
      'dead_end_probable',
      'dead_end_confirmed',
    ]),
    evidenceCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    blockedUntil: UtcInstantSchema.nullable(),
  })
  .strict();

export const RobotVisualObjectSchema = z
  .object({
    id: UuidSchema,
    placeId: UuidSchema,
    classLabel: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(120),
    confidence: z.number().min(0).max(1),
    sightingCount: z.number().int().positive(),
    lastSeenAt: UtcInstantSchema,
  })
  .strict();

export const RobotVisualGraphSchema = z
  .object({
    version: z.number().int().nonnegative(),
    currentPlaceId: UuidSchema.nullable(),
    places: z.array(RobotVisualPlaceSchema).max(128),
    views: z.array(RobotVisualPlaceViewSchema).max(384),
    sectors: z.array(RobotVisualSectorSchema).max(1_536),
    ports: z.array(RobotVisualPortSchema).max(1_536),
    transitions: z.array(RobotVisualTransitionSchema).max(1_024),
    objects: z.array(RobotVisualObjectSchema).max(512),
    storage: z
      .object({
        imageBytes: z.number().int().nonnegative(),
        imageQuotaBytes: z.number().int().positive(),
        descriptorBytes: z.number().int().nonnegative(),
        descriptorQuotaBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const RobotVisualObjectRenameRequestSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();

export const RobotVisualPlaceRenameRequestSchema = z
  .object({ label: z.string().trim().min(1).max(120) })
  .strict();

export const RobotVisualPlaceMergeRequestSchema = z
  .object({ sourcePlaceId: UuidSchema })
  .strict();

export const RobotCameraBandwidthProfileSchema = z.enum(['normal', 'reduced']);

export const RobotCameraBandwidthRequestSchema = z
  .object({ profile: RobotCameraBandwidthProfileSchema })
  .strict();

export const RobotCameraBandwidthStatusSchema = z
  .object({
    profile: RobotCameraBandwidthProfileSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    jpegQuality: z.number().int().min(1).max(100),
    estimatedReductionPercent: z.number().int().min(0).max(100),
  })
  .strict();

export const RobotDisplayPreferencesSchema = z
  .object({
    recognitionVisible: z.boolean(),
    updatedAt: UtcInstantSchema.nullable(),
  })
  .strict();

export const RobotDisplayPreferencesRequestSchema = z
  .object({ recognitionVisible: z.boolean() })
  .strict();

export const RobotControlPreferencesSchema = z
  .object({
    steeringTrimPercent: z.number().int().min(-10).max(10),
    updatedAt: UtcInstantSchema.nullable(),
  })
  .strict();

export const RobotControlPreferencesRequestSchema = z
  .object({ steeringTrimPercent: z.number().int().min(-10).max(10) })
  .strict();

export const RobotPanoramaPreferencesSchema = z
  .object({
    panoramaPulseMs: z.number().int().min(120).max(1_000),
    updatedAt: UtcInstantSchema.nullable(),
  })
  .strict();

export const RobotPanoramaPreferencesRequestSchema = z
  .object({ panoramaPulseMs: z.number().int().min(120).max(1_000) })
  .strict();

export const RobotVisualMemoryPurgeRequestSchema = z
  .object({ scope: z.enum(['last_hour', 'all']) })
  .strict();

export const RobotVisualMemoryPurgeResponseSchema = z
  .object({
    deletedPlaces: z.number().int().nonnegative(),
    deletedViews: z.number().int().nonnegative(),
    deletedTransitions: z.number().int().nonnegative(),
    deletedObjects: z.number().int().nonnegative(),
    graph: RobotVisualGraphSchema,
  })
  .strict();

export const RobotAutonomyActionSchema = z.enum([
  'advance_slow',
  'advance_normal',
  'pivot_left',
  'pivot_right',
  'inspect_anchor',
  'try_alternate_port',
  'return_to_last_anchor',
  'apply_recovery',
]);

export const RobotAutonomyStatusSchema = z
  .object({
    status: z.enum([
      'inactive',
      'exploring',
      'navigating',
      'recovering',
      'blocked',
    ]),
    runId: UuidSchema.nullable(),
    startedAt: UtcInstantSchema.nullable(),
    updatedAt: UtcInstantSchema,
    currentPlaceId: UuidSchema.nullable(),
    targetPlaceId: UuidSchema.nullable(),
    action: RobotAutonomyActionSchema.nullable(),
    availableActions: z.array(RobotAutonomyActionSchema).max(16),
    confidence: z.number().min(0).max(1),
    speedPercent: z.number().min(0).max(35),
    reward: z.number().min(-4).max(4).nullable(),
    reason: z.string().trim().min(1).max(300).nullable(),
    learningStepCount: z.number().int().nonnegative(),
    imageUsable: z.boolean(),
    motionState: z.enum([
      'stationary',
      'camera_rotation',
      'body_rotation',
      'translation',
      'uncertain',
    ]),
    blockReason: z
      .enum([
        'stabilizing',
        'panorama',
        'no_translation',
        'infrared',
        'ambiguous',
        'oscillation',
        'route_mismatch',
        'image_unusable',
      ])
      .nullable(),
    informationGain: z.number().min(-1).max(1),
    localizationConfidence: z.number().min(0).max(1),
    habitConfidence: z.number().min(0).max(1),
    humanRecovery: z
      .object({
        commandCount: z.number().int().nonnegative().max(100),
        startedAt: UtcInstantSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const RobotAutonomyStartRequestSchema = z
  .object({
    powerPercent: z.number().int().min(10).max(35),
    steeringTrimPercent: z.number().int().min(-10).max(10),
    targetPlaceId: UuidSchema.optional(),
    allowCandidatePath: z.boolean().optional(),
  })
  .strict();

export const RobotAutonomyPowerRequestSchema = z
  .object({ powerPercent: z.number().int().min(10).max(35) })
  .strict();

export const RobotAutonomyResponseSchema = z
  .object({
    accepted: z.literal(true),
    autonomy: RobotAutonomyStatusSchema,
    graph: RobotVisualGraphSchema,
    state: z.lazy(() => RobotStateSchema),
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
    powerState: RobotPowerStateSchema.optional(),
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

export const RobotPowerStatusSchema = z
  .object({
    powerState: RobotPowerStateSchema,
    robotService: z.enum(['active', 'inactive', 'failed', 'unknown']),
    cameraService: z.enum(['active', 'inactive', 'failed', 'unknown']),
    updatedAt: UtcInstantSchema,
    message: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export type RobotDirection = z.infer<typeof RobotDirectionSchema>;

export type RobotCapability = z.infer<typeof RobotCapabilitySchema>;

export type RobotPowerState = z.infer<typeof RobotPowerStateSchema>;

export type RobotPowerStatus = z.infer<typeof RobotPowerStatusSchema>;

export type RobotOperatingMode = z.infer<typeof RobotOperatingModeSchema>;

export type RobotDetectionKind = z.infer<typeof RobotDetectionKindSchema>;

export type RobotDetection = z.infer<typeof RobotDetectionSchema>;

export type RobotVisionFrame = z.infer<typeof RobotVisionFrameSchema>;

export type RobotVisualPlaceStatus = z.infer<
  typeof RobotVisualPlaceStatusSchema
>;

export type RobotVisualPlace = z.infer<typeof RobotVisualPlaceSchema>;

export type RobotVisualPlaceView = z.infer<typeof RobotVisualPlaceViewSchema>;

export type RobotVisualTransition = z.infer<typeof RobotVisualTransitionSchema>;

export type RobotVisualSector = z.infer<typeof RobotVisualSectorSchema>;

export type RobotVisualPort = z.infer<typeof RobotVisualPortSchema>;

export type RobotVisualObject = z.infer<typeof RobotVisualObjectSchema>;

export type RobotVisualGraph = z.infer<typeof RobotVisualGraphSchema>;

export type RobotCameraBandwidthProfile = z.infer<
  typeof RobotCameraBandwidthProfileSchema
>;

export type RobotCameraBandwidthStatus = z.infer<
  typeof RobotCameraBandwidthStatusSchema
>;

export type RobotDisplayPreferences = z.infer<
  typeof RobotDisplayPreferencesSchema
>;

export type RobotControlPreferences = z.infer<
  typeof RobotControlPreferencesSchema
>;

export type RobotPanoramaPreferences = z.infer<
  typeof RobotPanoramaPreferencesSchema
>;

export type RobotVisualMemoryPurgeScope = z.infer<
  typeof RobotVisualMemoryPurgeRequestSchema
>['scope'];

export type RobotAutonomyAction = z.infer<typeof RobotAutonomyActionSchema>;

export type RobotAutonomyStatus = z.infer<typeof RobotAutonomyStatusSchema>;

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

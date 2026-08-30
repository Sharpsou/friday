import { existsSync } from 'node:fs';

import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify from 'fastify';
import { z } from 'zod';

import {
  AuthBootstrapRequestSchema,
  AuthDeviceApprovalRequestsResponseSchema,
  AuthDeviceApprovalStatusResponseSchema,
  AuthDevicesResponseSchema,
  AuthLoginResponseSchema,
  AuthLoginRequestSchema,
  AuthMembersResponseSchema,
  AuthPairRequestSchema,
  AuthSessionSchema,
  AuthStateResponseSchema,
  AssistantConversationSchema,
  AssistantConversationsResponseSchema,
  AssistantMessagesResponseSchema,
  AssistantUpdateConversationRequestSchema,
  GroceryClassificationApplyRequestSchema,
  GroceryClassificationApplyResponseSchema,
  GroceryClassificationJobSchema,
  GroceryClassificationPullResponseSchema,
  GroceryPhotoTranscriptionRequestSchema,
  GroceryPhotoTranscriptionResponseSchema,
  HealthResponseSchema,
  InferenceStatusSchema,
  PairingCodeResponseSchema,
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
  RobotArmRequestSchema,
  RobotActuatorsRequestSchema,
  RobotAutonomyResponseSchema,
  RobotAutonomyPowerRequestSchema,
  RobotAutonomyStartRequestSchema,
  RobotCameraLookRequestSchema,
  RobotCameraBandwidthRequestSchema,
  RobotCameraBandwidthStatusSchema,
  RobotCommandResponseSchema,
  RobotControlPreferencesRequestSchema,
  RobotControlPreferencesSchema,
  RobotDisplayPreferencesRequestSchema,
  RobotDisplayPreferencesSchema,
  RobotDriveRequestSchema,
  RobotOperatingModeRequestSchema,
  RobotPanoramaPreferencesRequestSchema,
  RobotPanoramaPreferencesSchema,
  RobotStateSchema,
  RobotVisualGraphSchema,
  RobotVisualMemoryPurgeRequestSchema,
  RobotVisualMemoryPurgeResponseSchema,
  RobotVisualObjectRenameRequestSchema,
  RobotVisualPlaceMergeRequestSchema,
  RobotVisualPlaceRenameRequestSchema,
  WatchArticleSchema,
  WatchArticleStateRequestSchema,
  WatchAddDiscoveredSourcesRequestSchema,
  WatchAddDiscoveredSourcesResponseSchema,
  WatchConceptSchema,
  WatchConceptStateRequestSchema,
  WatchCreateRequestSchema,
  WatchDiscoveryRequestSchema,
  WatchDiscoverySchema,
  WatchOverviewSchema,
  WatchSchema,
  WatchSourceValidateRequestSchema,
  WatchUpdateRequestSchema,
} from '@friday/contracts';

import {
  AssistantArchiveService,
  AssistantNotFoundError,
} from './assistant/assistant-service.js';
import { ClosedAuthError, ClosedAuthService } from './auth/auth-service.js';
import { loadOrCreateAuthSecret } from './auth/auth-secret.js';
import { openDatabase } from './db/database.js';
import {
  GroceryClassificationNotFoundError,
  GroceryClassificationService,
} from './groceries/grocery-classification-service.js';
import {
  OllamaClassificationEngine,
  type GroceryClassificationEngine,
} from './groceries/ollama-classification-engine.js';
import {
  OllamaPhotoTranscriptionEngine,
  type GroceryPhotoTranscriptionEngine,
} from './groceries/ollama-photo-transcription-engine.js';
import { SyncService } from './sync/sync-service.js';
import {
  OllamaWatchEngine,
  type WatchLanguageEngine,
} from './watch/ollama-watch-engine.js';
import { TavilySearchClient } from './watch/tavily-search.js';
import { WatchNotFoundError, WatchService } from './watch/watch-service.js';
import {
  DisabledRobotController,
  RobotCommandRejectedError,
  type RobotController,
  RobotUnavailableError,
} from './robot/robot-controller.js';
import {
  RobotAutonomyError,
  RobotAutonomyService,
} from './robot/robot-autonomy.js';
import type { RobotPlaceRecognitionEngine } from './robot/robot-place-recognition.js';
import {
  RobotVisualTopologyError,
  RobotVisualTopologyService,
} from './robot/robot-visual-topology.js';

export interface BuildHubOptions {
  authAttemptLimit?: number;
  authTrustedOrigins?: string[];
  databasePath: string;
  https?: {
    cert: Buffer;
    key: Buffer;
  };
  logger?: boolean;
  classificationEngine?: GroceryClassificationEngine;
  photoTranscriptionEngine?: GroceryPhotoTranscriptionEngine;
  watchEngine?: WatchLanguageEngine;
  watchSearchClient?: TavilySearchClient;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
  photoTranscriptionModel?: string;
  photoTranscriptionTimeoutMs?: number;
  publicOrigin?: string;
  authSecret?: string;
  webRoot?: string;
  robotController?: RobotController;
  robotPlaceRecognition?: RobotPlaceRecognitionEngine;
}

const PullQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
});

const DeviceParamsSchema = z.object({ id: z.string().uuid() }).strict();
const DeviceApprovalParamsSchema = z.object({ id: z.string().uuid() }).strict();
const DeviceApprovalStatusQuerySchema = z
  .object({ token: z.string().min(32).max(128) })
  .strict();
const ClassificationJobParamsSchema = z
  .object({ jobId: z.string().uuid() })
  .strict();
const AssistantConversationParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();
const WatchParamsSchema = z.object({ id: z.string().uuid() }).strict();
const WatchArticleParamsSchema = z
  .object({ articleId: z.string().uuid(), id: z.string().uuid() })
  .strict();
const WatchConceptParamsSchema = z
  .object({ conceptId: z.string().uuid(), id: z.string().uuid() })
  .strict();
const WatchSuggestionRequestSchema = z
  .object({ query: z.string().trim().min(3).max(500) })
  .strict();
const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

function sendClosedAuthError(
  error: unknown,
  reply: { code(status: number): unknown },
) {
  if (error instanceof ClosedAuthError) {
    return (
      reply.code(error.statusCode) as { send(payload: unknown): unknown }
    ).send({
      error: error.code,
      message: error.message,
    });
  }
  throw error;
}

function forwardSetCookies(
  reply: { header(name: string, value: string | string[]): unknown },
  headers: Headers,
): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

export async function buildHub(options: BuildHubOptions) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    ...(options.https ? { https: options.https } : {}),
    logger: options.logger ?? false,
  });
  const database = openDatabase(options.databasePath);
  const sync = new SyncService(database);
  const groceryClassification = new GroceryClassificationService(
    database,
    options.classificationEngine ??
      new OllamaClassificationEngine({
        ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
        ...(options.ollamaModel ? { model: options.ollamaModel } : {}),
        ...(options.ollamaTimeoutMs
          ? { timeoutMs: options.ollamaTimeoutMs }
          : {}),
      }),
  );
  const groceryPhotoTranscription =
    options.photoTranscriptionEngine ??
    new OllamaPhotoTranscriptionEngine({
      ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
      ...(options.photoTranscriptionModel
        ? { model: options.photoTranscriptionModel }
        : {}),
      ...(options.photoTranscriptionTimeoutMs
        ? { timeoutMs: options.photoTranscriptionTimeoutMs }
        : {}),
    });
  let photoTranscriptionActive = false;
  const watchEngine =
    options.watchEngine ??
    new OllamaWatchEngine({
      ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
      model: process.env.FRIDAY_WATCH_MODEL ?? 'qwen3.5:9b-q4_K_M',
      ...(process.env.FRIDAY_WATCH_TIMEOUT_MS
        ? {
            timeoutMs: Number.parseInt(process.env.FRIDAY_WATCH_TIMEOUT_MS, 10),
          }
        : {}),
    });
  const watchSearch =
    options.watchSearchClient ??
    new TavilySearchClient(process.env.FRIDAY_TAVILY_API_KEY);
  const assistant = new AssistantArchiveService(database);
  const watch = new WatchService(database, watchEngine, undefined, watchSearch);
  const robot: RobotController =
    options.robotController ?? new DisabledRobotController();
  const robotTopology = new RobotVisualTopologyService(
    database,
    HOUSEHOLD_ID,
    options.robotPlaceRecognition,
  );
  const robotAutonomy = new RobotAutonomyService(
    database,
    HOUSEHOLD_ID,
    robot,
    robotTopology,
  );
  const publicOrigin = options.publicOrigin ?? 'http://localhost';
  const closedAuth = new ClosedAuthService({
    ...(options.authAttemptLimit
      ? { attemptLimit: options.authAttemptLimit }
      : {}),
    database,
    publicOrigin,
    secret:
      options.authSecret ??
      loadOrCreateAuthSecret(
        options.databasePath,
        process.env.FRIDAY_AUTH_SECRET,
      ),
    ...(options.authTrustedOrigins
      ? { trustedOrigins: options.authTrustedOrigins }
      : {}),
  });
  const trustedAuthOrigins = new Set(
    [publicOrigin, ...(options.authTrustedOrigins ?? [])].map((origin) =>
      origin.replace(/\/$/, ''),
    ),
  );
  const acceptsTrustedMutationOrigin = (headers: {
    origin?: string | undefined;
    'sec-fetch-site'?: string | undefined;
  }) => {
    if (headers['sec-fetch-site'] === 'cross-site') return false;
    return (
      headers.origin === undefined ||
      trustedAuthOrigins.has(headers.origin.replace(/\/$/, ''))
    );
  };
  const robotCommandWindows = new Map<string, number[]>();
  const acceptsRobotCommandRate = (deviceId: string, limit: number) => {
    const now = Date.now();
    const recent = (robotCommandWindows.get(deviceId) ?? []).filter(
      (timestamp) => timestamp > now - 1_000,
    );
    if (recent.length >= limit) {
      robotCommandWindows.set(deviceId, recent);
      return false;
    }
    recent.push(now);
    robotCommandWindows.set(deviceId, recent);
    return true;
  };
  const readRobotDisplayPreferences = () => {
    const row = database
      .prepare(
        `SELECT recognition_visible, updated_at
           FROM robot_display_preferences
          WHERE household_id = ?`,
      )
      .get(HOUSEHOLD_ID) as
      { recognition_visible: number; updated_at: string } | undefined;
    return RobotDisplayPreferencesSchema.parse({
      recognitionVisible: row ? row.recognition_visible === 1 : true,
      updatedAt: row?.updated_at ?? null,
    });
  };
  const readRobotControlPreferences = () => {
    const row = database
      .prepare(
        `SELECT steering_trim_percent, updated_at
           FROM robot_control_preferences
          WHERE household_id = ?`,
      )
      .get(HOUSEHOLD_ID) as
      | {
          steering_trim_percent: number;
          updated_at: string;
        }
      | undefined;
    return RobotControlPreferencesSchema.parse({
      steeringTrimPercent: row?.steering_trim_percent ?? 0,
      updatedAt: row?.updated_at ?? null,
    });
  };
  const readRobotPanoramaPreferences = () => {
    const row = database
      .prepare(
        `SELECT panorama_pulse_ms, updated_at
           FROM robot_control_preferences
          WHERE household_id = ?`,
      )
      .get(HOUSEHOLD_ID) as
      { panorama_pulse_ms: number; updated_at: string } | undefined;
    return RobotPanoramaPreferencesSchema.parse({
      panoramaPulseMs: row?.panorama_pulse_ms ?? 220,
      updatedAt: row?.updated_at ?? null,
    });
  };
  const sendRobotError = (
    error: unknown,
    reply: { code(status: number): unknown },
  ) => {
    if (error instanceof RobotUnavailableError) {
      return (reply.code(503) as { send(payload: unknown): unknown }).send({
        error: 'robot_unavailable',
        message: error.message,
      });
    }
    if (error instanceof RobotCommandRejectedError) {
      return (reply.code(409) as { send(payload: unknown): unknown }).send({
        error: 'robot_command_rejected',
        message: error.message,
      });
    }
    if (error instanceof RobotAutonomyError) {
      return (reply.code(409) as { send(payload: unknown): unknown }).send({
        error: error.code,
        message: error.message,
      });
    }
    if (error instanceof RobotVisualTopologyError) {
      const status = error.code === 'not_found' ? 404 : 409;
      return (reply.code(status) as { send(payload: unknown): unknown }).send({
        error:
          error.code === 'not_found'
            ? 'robot_visual_not_found'
            : 'robot_visual_conflict',
        message: error.message,
      });
    }
    return sendClosedAuthError(error, reply);
  };

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header(
      'permissions-policy',
      'camera=(), geolocation=(), microphone=()',
    );
    if (request.raw.url?.startsWith('/api/')) {
      reply.header(
        'cache-control',
        request.raw.url.startsWith('/api/robot/camera/stream')
          ? 'no-store, no-transform'
          : 'no-store',
      );
    }
    return payload;
  });

  app.get('/api/health', async () =>
    HealthResponseSchema.parse({
      status: 'ok',
      database: 'ok',
      ollama: 'not-required',
      version: '0.0.0-p0',
    }),
  );

  app.get('/api/robot/state', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      const state = RobotStateSchema.parse(await robot.state());
      const keyframe = state.vision
        ? (robot.visionKeyframe?.(state.vision.frameId) ?? null)
        : null;
      void robotTopology.observe(state, keyframe).catch((error: unknown) => {
        app.log.warn(
          { error },
          'Reconnaissance de lieu temporairement indisponible.',
        );
      });
      return state;
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/power/sleep', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!robot.sleepNetwork)
        return reply
          .code(404)
          .send({ error: 'robot_network_standby_unavailable' });
      if (robotAutonomy.status().status !== 'inactive')
        await robotAutonomy.stop('network_standby');
      robotTopology.pauseObservations();
      try {
        const state = await robot.sleepNetwork();
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      } catch (error) {
        robotTopology.resumeObservationsAfter(700);
        throw error;
      }
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/power/wake', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!robot.wakeNetwork)
        return reply
          .code(404)
          .send({ error: 'robot_network_standby_unavailable' });
      const state = await robot.wakeNetwork();
      robotTopology.resumeObservationsAfter(700);
      return RobotCommandResponseSchema.parse({ accepted: true, state });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/display-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotDisplayPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/display-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotDisplayPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_display_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_display_preferences(
             household_id, recognition_visible, updated_at, updated_by_profile_id
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             recognition_visible = excluded.recognition_visible,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.recognitionVisible ? 1 : 0,
          updatedAt,
          session.member.profileId,
        );
      return readRobotDisplayPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/control-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotControlPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/control-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotControlPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_control_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_control_preferences(
             household_id, steering_trim_percent, updated_at,
             updated_by_profile_id
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             steering_trim_percent = excluded.steering_trim_percent,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.steeringTrimPercent,
          updatedAt,
          session.member.profileId,
        );
      return readRobotControlPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/panorama-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotPanoramaPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/panorama-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotPanoramaPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_panorama_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_control_preferences(
             household_id, steering_trim_percent, panorama_pulse_ms,
             updated_at, updated_by_profile_id
           ) VALUES (?, 0, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             panorama_pulse_ms = excluded.panorama_pulse_ms,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.panoramaPulseMs,
          updatedAt,
          session.member.profileId,
        );
      const saved = readRobotPanoramaPreferences();
      robotAutonomy.setPanoramaPulseDuration(saved.panoramaPulseMs);
      return saved;
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/graph', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return RobotVisualGraphSchema.parse(robotTopology.snapshot());
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/graph/purge', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotVisualMemoryPurgeRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_memory_purge' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_memory_purge');
      return RobotVisualMemoryPurgeResponseSchema.parse(
        await robotTopology.purge(body.data.scope),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/camera/bandwidth', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return RobotCameraBandwidthStatusSchema.parse(
        await robot.cameraBandwidth(),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/camera/bandwidth', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotCameraBandwidthRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_camera_bandwidth' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('camera_bandwidth_changed');
      return RobotCameraBandwidthStatusSchema.parse(
        await robot.setCameraBandwidth(body.data.profile),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/autonomy', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return robotAutonomy.status();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/start', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotAutonomyStartRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_autonomy_start' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const panoramaPreferences = readRobotPanoramaPreferences();
      const state = await robotAutonomy.start({
        powerPercent: body.data.powerPercent,
        steeringTrimPercent: body.data.steeringTrimPercent,
        panoramaPulseMs: panoramaPreferences.panoramaPulseMs,
        ...(body.data.allowCandidatePath !== undefined
          ? { allowCandidatePath: body.data.allowCandidatePath }
          : {}),
        ...(body.data.targetPlaceId
          ? { targetPlaceId: body.data.targetPlaceId }
          : {}),
      });
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/autonomy/power', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotAutonomyPowerRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_autonomy_power' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return robotAutonomy.setPowerPercent(body.data.powerPercent);
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/stop', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.stop();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/recovery/start', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.beginHumanRecovery();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/recovery/finish', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.finishHumanRecovery();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/graph/objects/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualObjectRenameRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_object' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.renameObject(params.data.id, body.data.displayName),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/graph/places/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualPlaceRenameRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_place' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.renamePlace(params.data.id, body.data.label),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/graph/places/:id/merge', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualPlaceMergeRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_merge' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_places_merge');
      return RobotVisualGraphSchema.parse(
        await robotTopology.mergePlaces(
          params.data.id,
          body.data.sourcePlaceId,
        ),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.delete('/api/robot/graph/places/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_place' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_place_deleted');
      return RobotVisualGraphSchema.parse(
        await robotTopology.deletePlace(params.data.id),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.delete('/api/robot/graph/objects/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_object' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.deleteObject(params.data.id),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/arm', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotArmRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_arm' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.arm(body.data.durationMs),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/drive', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotDriveRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_drive' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      if ((await robot.state()).operatingMode !== 'manual')
        return reply.code(409).send({
          error: 'robot_manual_required',
          message: 'La téléopération est disponible uniquement en mode Manuel.',
        });
      // The hub is the clock authority shared with the Pi. Preserve the
      // short, schema-bounded motor pulse while giving the command enough
      // transport time to reach a loaded Pi. The embedded watchdog still
      // limits actual motion with maxDurationMs.
      const forwardedAt = Date.now();
      const state = await robot.drive({
        ...body.data,
        issuedAt: new Date(forwardedAt).toISOString(),
        expiresAt: new Date(forwardedAt + 1_800).toISOString(),
      });
      robotAutonomy.observeManualDrive(body.data, state);
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state,
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/camera/look', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotCameraLookRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_camera_look' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      // The browser clock is not a safety authority. Re-stamp this bounded
      // target-position command at the hub boundary so ordinary phone clock
      // skew cannot make it expire before it reaches the Pi.
      const forwardedAt = Date.now();
      robotTopology.pauseObservations();
      try {
        return RobotCommandResponseSchema.parse({
          accepted: true,
          state: await robot.look({
            ...body.data,
            issuedAt: new Date(forwardedAt).toISOString(),
            expiresAt: new Date(forwardedAt + 1_800).toISOString(),
          }),
        });
      } finally {
        robotTopology.resumeObservationsAfter(700);
      }
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/actuators', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotActuatorsRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_actuators' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.setActuators(body.data),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/mode', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotOperatingModeRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_mode' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (body.data.mode === 'autonomous') {
        if (robotAutonomy.status().status === 'recovering') {
          const state = await robotAutonomy.finishHumanRecovery();
          return RobotCommandResponseSchema.parse({ accepted: true, state });
        }
        const controlPreferences = readRobotControlPreferences();
        const panoramaPreferences = readRobotPanoramaPreferences();
        const state = await robotAutonomy.start({
          powerPercent: 20,
          steeringTrimPercent: controlPreferences.steeringTrimPercent,
          panoramaPulseMs: panoramaPreferences.panoramaPulseMs,
        });
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      }
      if (robotAutonomy.status().status !== 'inactive') {
        const state = await robotAutonomy.stop('manual_mode');
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      }
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.setMode(body.data.mode),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/stop', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      await closedAuth.requireSession(request.headers);
      const state =
        robotAutonomy.status().status === 'inactive'
          ? await robot.stop()
          : await robotAutonomy.stop('emergency_stop');
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state,
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/halt', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.halt(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/camera/stream', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('close', abort);
      const stream = await robot.openCameraStream(controller.signal);
      stream.body.once('close', () =>
        request.raw.removeListener('close', abort),
      );
      return reply
        .header('X-Accel-Buffering', 'no')
        .type(stream.contentType)
        .send(stream.body);
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get(
    '/api/robot/graph/places/:placeId/views/:viewId',
    async (request, reply) => {
      const params = z
        .object({ placeId: z.string().uuid(), viewId: z.string().uuid() })
        .safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_robot_visual_view' });
      try {
        await closedAuth.requireSession(request.headers);
        const view = robotTopology.image(
          params.data.placeId,
          params.data.viewId,
        );
        if (!view)
          return reply.code(404).send({ error: 'robot_visual_view_not_found' });
        return reply
          .header('content-disposition', 'inline')
          .header('x-robot-observed-at', view.observedAt)
          .type('image/jpeg')
          .send(view.image);
      } catch (error) {
        return sendRobotError(error, reply);
      }
    },
  );

  app.get('/api/auth/state', async (request) =>
    AuthStateResponseSchema.parse({
      bootstrapRequired: closedAuth.isBootstrapRequired(),
      session: await closedAuth.getSession(request.headers),
    }),
  );

  app.post('/api/auth/bootstrap', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    const parsed = AuthBootstrapRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_auth_payload' });
    try {
      const result = await closedAuth.bootstrap(
        parsed.data,
        request.headers,
        request.ip,
      );
      forwardSetCookies(reply, result.headers);
      return AuthSessionSchema.parse(result.session);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    const parsed = AuthLoginRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_auth_payload' });
    try {
      const result = await closedAuth.login(
        parsed.data,
        request.headers,
        request.ip,
      );
      if (result.approval) {
        return reply
          .code(202)
          .send(AuthLoginResponseSchema.parse(result.approval));
      }
      forwardSetCookies(reply, result.headers);
      return AuthLoginResponseSchema.parse(result.session);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/auth/pair', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    const parsed = AuthPairRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_auth_payload' });
    try {
      const result = await closedAuth.pair(
        parsed.data,
        request.headers,
        request.ip,
      );
      forwardSetCookies(reply, result.headers);
      return AuthSessionSchema.parse(result.session);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/auth/pairing-code', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    try {
      const session = await closedAuth.requireSession(request.headers);
      const userId = closedAuth.findAuthUserId(session);
      return PairingCodeResponseSchema.parse(
        await closedAuth.createPairingCode(session, userId, request.ip),
      );
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/auth/members', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return AuthMembersResponseSchema.parse({
        members: closedAuth.listMembers(),
      });
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/auth/devices', async (request, reply) => {
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AuthDevicesResponseSchema.parse({
        devices: closedAuth.listDevices(session.deviceId),
      });
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/auth/device-approval-requests', async (request, reply) => {
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AuthDeviceApprovalRequestsResponseSchema.parse({
        requests: closedAuth.listDeviceApprovalRequests(session),
      });
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get(
    '/api/auth/device-approval-requests/:id/status',
    async (request, reply) => {
      const params = DeviceApprovalParamsSchema.safeParse(request.params);
      const query = DeviceApprovalStatusQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: 'invalid_approval_status' });
      }
      try {
        return AuthDeviceApprovalStatusResponseSchema.parse(
          closedAuth.getDeviceApprovalStatus(params.data.id, query.data.token),
        );
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post(
    '/api/auth/device-approval-requests/:id/approve',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers)) {
        return reply.code(403).send({ error: 'untrusted_origin' });
      }
      const parsed = DeviceApprovalParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_approval_request_id' });
      }
      try {
        const session = await closedAuth.requireSession(request.headers);
        closedAuth.approveDeviceApprovalRequest(
          session,
          parsed.data.id,
          request.ip,
        );
        return { approved: true };
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post(
    '/api/auth/device-approval-requests/:id/reject',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers)) {
        return reply.code(403).send({ error: 'untrusted_origin' });
      }
      const parsed = DeviceApprovalParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_approval_request_id' });
      }
      try {
        const session = await closedAuth.requireSession(request.headers);
        closedAuth.rejectDeviceApprovalRequest(
          session,
          parsed.data.id,
          request.ip,
        );
        return { rejected: true };
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post('/api/auth/devices/:id/revoke', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    const parsed = DeviceParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_device_id' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      const userId = closedAuth.findAuthUserId(session);
      closedAuth.revokeDevice(session, userId, parsed.data.id, request.ip);
      return { revoked: true };
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.delete('/api/auth/adult', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    try {
      const session = await closedAuth.requireSession(request.headers);
      const userId = closedAuth.findAuthUserId(session);
      closedAuth.forgetAdult(session, userId, request.ip);
      return { forgotten: true };
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/sync/push', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    let session;
    try {
      session = await closedAuth.requireSession(request.headers);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
    const parsed = PushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_sync_payload' });
    }

    const identityMismatch = parsed.data.operations.some(
      (operation) =>
        operation.entityId !== operation.payload.id ||
        operation.deviceId !== operation.payload.deviceId ||
        operation.profileId !== operation.payload.updatedByProfileId ||
        operation.deviceId !== session.deviceId ||
        operation.profileId !== session.member.profileId ||
        (operation.baseRevision === 0 &&
          operation.payload.createdByProfileId !== session.member.profileId) ||
        operation.payload.householdId !==
          '1030b4f6-1e0f-48fa-adab-865750ce597d',
    );
    if (identityMismatch) {
      return reply.code(400).send({ error: 'operation_identity_mismatch' });
    }

    return PushResponseSchema.parse(sync.push(parsed.data.operations));
  });

  app.get('/api/sync/pull', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
    const parsed = PullQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_cursor' });
    }
    return PullResponseSchema.parse(sync.pull(parsed.data.after));
  });

  app.post(
    '/api/groceries/photo-transcription',
    { bodyLimit: 512 * 1024 },
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers)) {
        return reply.code(403).send({ error: 'untrusted_origin' });
      }
      try {
        await closedAuth.requireSession(request.headers);
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
      const parsed = GroceryPhotoTranscriptionRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_grocery_photo' });
      }
      if (photoTranscriptionActive) {
        return reply.code(409).send({
          error: 'photo_transcription_busy',
          message: 'Une autre photo est déjà en cours de lecture.',
        });
      }
      photoTranscriptionActive = true;
      const controller = new AbortController();
      const abort = () => controller.abort(new Error('Connexion interrompue.'));
      request.raw.once('aborted', abort);
      try {
        return GroceryPhotoTranscriptionResponseSchema.parse(
          await groceryPhotoTranscription.transcribe(
            parsed.data.imageBase64,
            parsed.data.mediaType,
            controller.signal,
          ),
        );
      } catch (error) {
        request.log.warn({ error }, 'grocery photo transcription failed');
        return reply.code(503).send({
          error: 'photo_transcription_unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'Lecture de la photo indisponible.',
        });
      } finally {
        request.raw.removeListener('aborted', abort);
        photoTranscriptionActive = false;
      }
    },
  );

  app.post(
    '/api/groceries/classification-proposals',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers)) {
        return reply.code(403).send({ error: 'untrusted_origin' });
      }
      try {
        const session = await closedAuth.requireSession(request.headers);
        return GroceryClassificationJobSchema.parse(
          groceryClassification.createOrGetActiveJob(
            HOUSEHOLD_ID,
            session.member.profileId,
          ),
        );
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.get(
    '/api/groceries/classification-proposals/:jobId',
    async (request, reply) => {
      const parsed = ClassificationJobParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_job_id' });
      }
      try {
        await closedAuth.requireSession(request.headers);
        return GroceryClassificationJobSchema.parse(
          groceryClassification.getJob(HOUSEHOLD_ID, parsed.data.jobId),
        );
      } catch (error) {
        if (error instanceof GroceryClassificationNotFoundError) {
          return reply
            .code(404)
            .send({ error: 'classification_job_not_found' });
        }
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post(
    '/api/groceries/classification-proposals/:jobId/cancel',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers)) {
        return reply.code(403).send({ error: 'untrusted_origin' });
      }
      const parsed = ClassificationJobParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_job_id' });
      }
      try {
        await closedAuth.requireSession(request.headers);
        return GroceryClassificationJobSchema.parse(
          groceryClassification.cancelJob(HOUSEHOLD_ID, parsed.data.jobId),
        );
      } catch (error) {
        if (error instanceof GroceryClassificationNotFoundError) {
          return reply
            .code(404)
            .send({ error: 'classification_job_not_found' });
        }
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post('/api/groceries/classifications/apply', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
    const parsed = GroceryClassificationApplyRequestSchema.safeParse(
      request.body,
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_classification_payload' });
    }
    try {
      const session = await closedAuth.requireSession(request.headers);
      return GroceryClassificationApplyResponseSchema.parse(
        groceryClassification.apply(
          HOUSEHOLD_ID,
          session.member.profileId,
          parsed.data,
        ),
      );
    } catch (error) {
      if (error instanceof GroceryClassificationNotFoundError) {
        return reply.code(404).send({ error: 'classification_job_not_found' });
      }
      if (error instanceof Error) {
        return reply.code(409).send({
          error: 'classification_not_applicable',
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.get('/api/groceries/classifications', async (request, reply) => {
    const parsed = PullQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_cursor' });
    }
    try {
      await closedAuth.requireSession(request.headers);
      return GroceryClassificationPullResponseSchema.parse(
        groceryClassification.pull(HOUSEHOLD_ID, parsed.data.after),
      );
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/assistant/conversations', async (request, reply) => {
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantConversationsResponseSchema.parse({
        conversations: assistant.listConversations(session.member.profileId),
      });
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.patch('/api/assistant/conversations/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = AssistantConversationParamsSchema.safeParse(request.params);
    const body = AssistantUpdateConversationRequestSchema.safeParse(
      request.body,
    );
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_assistant_conversation' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantConversationSchema.parse(
        assistant.updateConversation(session.member.profileId, params.data.id, {
          ...(body.data.archived === undefined
            ? {}
            : { archived: body.data.archived }),
          ...(body.data.title === undefined ? {} : { title: body.data.title }),
        }),
      );
    } catch (error) {
      if (error instanceof AssistantNotFoundError)
        return reply.code(404).send({ error: 'assistant_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  app.delete('/api/assistant/conversations/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = AssistantConversationParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_assistant_conversation' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      assistant.deleteConversation(session.member.profileId, params.data.id);
      return { deleted: true };
    } catch (error) {
      if (error instanceof AssistantNotFoundError)
        return reply.code(404).send({ error: 'assistant_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  app.get(
    '/api/assistant/conversations/:id/messages',
    async (request, reply) => {
      const params = AssistantConversationParamsSchema.safeParse(
        request.params,
      );
      if (!params.success)
        return reply
          .code(400)
          .send({ error: 'invalid_assistant_conversation' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return AssistantMessagesResponseSchema.parse(
          assistant.getMessages(session.member.profileId, params.data.id),
        );
      } catch (error) {
        if (error instanceof AssistantNotFoundError)
          return reply.code(404).send({ error: 'assistant_not_found' });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post(
    '/api/assistant/conversations/:id/messages',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers))
        return reply.code(403).send({ error: 'untrusted_origin' });
      try {
        await closedAuth.requireSession(request.headers);
        return reply.code(410).send({
          error: 'chat_reconstruction',
          message:
            'Le moteur Chat a été retiré pour être reconstruit. Les conversations existantes restent consultables.',
        });
      } catch (error) {
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.get('/api/inference/status', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return InferenceStatusSchema.parse(
        watchEngine.getInferenceStatus?.() ?? {
          active: null,
          queued: { watch: 0 },
        },
      );
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/watch/overview', async (request, reply) => {
    try {
      const session = await closedAuth.requireSession(request.headers);
      return WatchOverviewSchema.parse(
        watch.overview(session.member.profileId),
      );
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/watch/sources/validate', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = WatchSourceValidateRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_watch_source' });
    try {
      await closedAuth.requireSession(request.headers);
      return await watch.validateSource(
        body.data.url,
        new AbortController().signal,
      );
    } catch (error) {
      if (error instanceof ClosedAuthError)
        return sendClosedAuthError(error, reply);
      if (error instanceof Error)
        return reply
          .code(422)
          .send({ error: 'watch_source_unavailable', message: error.message });
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/watch/source-suggestions', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = WatchSuggestionRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_watch_suggestion' });
    try {
      await closedAuth.requireSession(request.headers);
      return {
        sources: await watch.suggestSources(
          body.data.query,
          new AbortController().signal,
        ),
      };
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/watch/discover', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = WatchDiscoveryRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_watch_discovery' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return WatchDiscoverySchema.parse(
        await watch.discoverSources(
          session.member.profileId,
          body.data,
          new AbortController().signal,
        ),
      );
    } catch (error) {
      if (error instanceof ClosedAuthError)
        return sendClosedAuthError(error, reply);
      return reply.code(422).send({
        error: 'watch_discovery_unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/watch/watches', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = WatchCreateRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_watch' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return WatchSchema.parse(
        await watch.create(
          session.member.profileId,
          body.data,
          new AbortController().signal,
        ),
      );
    } catch (error) {
      if (error instanceof ClosedAuthError)
        return sendClosedAuthError(error, reply);
      if (error instanceof Error)
        return reply
          .code(422)
          .send({ error: 'watch_unavailable', message: error.message });
      return sendClosedAuthError(error, reply);
    }
  });

  app.patch('/api/watch/watches/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = WatchParamsSchema.safeParse(request.params);
    const body = WatchUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_watch' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return WatchSchema.parse(
        await watch.update(
          session.member.profileId,
          params.data.id,
          body.data,
          new AbortController().signal,
        ),
      );
    } catch (error) {
      if (error instanceof WatchNotFoundError)
        return reply.code(404).send({ error: 'watch_not_found' });
      if (error instanceof ClosedAuthError)
        return sendClosedAuthError(error, reply);
      if (error instanceof Error)
        return reply
          .code(422)
          .send({ error: 'watch_unavailable', message: error.message });
      return sendClosedAuthError(error, reply);
    }
  });

  app.post(
    '/api/watch/watches/:id/sources/discovered',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers))
        return reply.code(403).send({ error: 'untrusted_origin' });
      const params = WatchParamsSchema.safeParse(request.params);
      const body = WatchAddDiscoveredSourcesRequestSchema.safeParse(
        request.body,
      );
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'invalid_watch_sources' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return WatchAddDiscoveredSourcesResponseSchema.parse(
          watch.addDiscoveredSources(
            session.member.profileId,
            params.data.id,
            body.data.discoveryId,
            body.data.candidateIds,
          ),
        );
      } catch (error) {
        if (error instanceof WatchNotFoundError)
          return reply.code(404).send({ error: 'watch_not_found' });
        if (error instanceof ClosedAuthError)
          return sendClosedAuthError(error, reply);
        if (error instanceof Error)
          return reply.code(422).send({
            error: 'watch_sources_unavailable',
            message: error.message,
          });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.delete('/api/watch/watches/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = WatchParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_watch' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      watch.delete(session.member.profileId, params.data.id);
      return { deleted: true };
    } catch (error) {
      if (error instanceof WatchNotFoundError)
        return reply.code(404).send({ error: 'watch_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  app.post('/api/watch/watches/:id/run', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = WatchParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_watch' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      watch.runNow(session.member.profileId, params.data.id);
      return reply.code(202).send({ queued: true });
    } catch (error) {
      if (error instanceof WatchNotFoundError)
        return reply.code(404).send({ error: 'watch_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  app.put(
    '/api/watch/watches/:id/articles/:articleId/state',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers))
        return reply.code(403).send({ error: 'untrusted_origin' });
      const params = WatchArticleParamsSchema.safeParse(request.params);
      const body = WatchArticleStateRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'invalid_watch_state' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return WatchArticleSchema.parse(
          watch.setArticleState(
            session.member.profileId,
            params.data.id,
            params.data.articleId,
            body.data.operationId,
            body.data.state,
            body.data.exclusionKeyword,
          ),
        );
      } catch (error) {
        if (error instanceof WatchNotFoundError)
          return reply.code(404).send({ error: 'watch_not_found' });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.put(
    '/api/watch/watches/:id/concepts/:conceptId/state',
    async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers))
        return reply.code(403).send({ error: 'untrusted_origin' });
      const params = WatchConceptParamsSchema.safeParse(request.params);
      const body = WatchConceptStateRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'invalid_watch_concept_state' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return WatchConceptSchema.parse(
          watch.setConceptState(
            session.member.profileId,
            params.data.id,
            params.data.conceptId,
            body.data.operationId,
            body.data.state,
          ),
        );
      } catch (error) {
        if (error instanceof WatchNotFoundError)
          return reply.code(404).send({ error: 'watch_concept_not_found' });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const path = request.raw.url?.split('?')[0] ?? '';
      if (
        path.startsWith('/api/auth/sign-up') ||
        path.startsWith('/api/auth/sign-in')
      ) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const url = new URL(request.raw.url ?? '/api/auth', publicOrigin);
      const authRequest = new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await closedAuth.auth.handler(authRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  if (options.webRoot && existsSync(options.webRoot)) {
    await app.register(staticPlugin, {
      root: options.webRoot,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      const acceptsHtml =
        request.headers.accept?.includes('text/html') ?? false;
      if (
        request.raw.method === 'GET' &&
        !request.raw.url?.startsWith('/api/') &&
        acceptsHtml
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  app.addHook('onClose', async () => {
    await robotAutonomy.close();
    await robot.close();
    await watch.stop();
    await watchEngine.close?.();
    await groceryClassification.stop();
    database.close();
  });

  return app;
}

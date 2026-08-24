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
  AssistantCreateConversationRequestSchema,
  AssistantExaUsageSchema,
  AssistantMessagesResponseSchema,
  AssistantQueueSummarySchema,
  AssistantResearchDiagnosticsResponseSchema,
  AssistantRunEventsResponseSchema,
  AssistantRunSchema,
  AssistantSearchConsentRequestSchema,
  AssistantSendMessageRequestSchema,
  AssistantSubmissionResponseSchema,
  AssistantUpdateConversationRequestSchema,
  AssistantWebUsageSchema,
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
  RobotCameraLookRequestSchema,
  RobotCommandResponseSchema,
  RobotDriveRequestSchema,
  RobotOperatingModeRequestSchema,
  RobotStateSchema,
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
  OllamaAssistantEngine,
  type AssistantEngine,
} from './assistant/assistant-engine.js';
import {
  AssistantConflictError,
  AssistantNotFoundError,
  AssistantService,
} from './assistant/assistant-service.js';
import { TavilySearchClient } from './assistant/tavily-search.js';
import { ExaMcpSearchClient } from './assistant/exa-mcp-search.js';
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
import { WatchNotFoundError, WatchService } from './watch/watch-service.js';
import {
  DisabledRobotController,
  RobotCommandRejectedError,
  type RobotController,
  RobotUnavailableError,
  validateRobotCommandTiming,
} from './robot/robot-controller.js';

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
  assistantEngine?: AssistantEngine;
  tavilySearchClient?: TavilySearchClient;
  exaMcpSearchClient?: ExaMcpSearchClient;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
  photoTranscriptionModel?: string;
  photoTranscriptionTimeoutMs?: number;
  publicOrigin?: string;
  authSecret?: string;
  webRoot?: string;
  robotController?: RobotController;
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
const AssistantRunParamsSchema = z.object({ id: z.string().uuid() }).strict();
const AssistantEventsQuerySchema = z
  .object({ after: z.coerce.number().int().nonnegative().default(0) })
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
  const assistantEngine =
    options.assistantEngine ??
    new OllamaAssistantEngine({
      ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
      model: process.env.FRIDAY_ASSISTANT_MODEL ?? 'gemma4:e4b-it-qat',
      qwenModel: process.env.FRIDAY_ASSISTANT_QWEN_MODEL ?? 'qwen3.5:9b-q4_K_M',
      ...(process.env.FRIDAY_ASSISTANT_TIMEOUT_MS
        ? {
            timeoutMs: Number.parseInt(
              process.env.FRIDAY_ASSISTANT_TIMEOUT_MS,
              10,
            ),
          }
        : {}),
    });
  const tavily =
    options.tavilySearchClient ??
    new TavilySearchClient(process.env.FRIDAY_TAVILY_API_KEY);
  const assistant = new AssistantService(
    database,
    assistantEngine,
    tavily,
    options.exaMcpSearchClient ?? new ExaMcpSearchClient(),
  );
  const watch = new WatchService(database, assistantEngine, undefined, tavily);
  const robot = options.robotController ?? new DisabledRobotController();
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
      reply.header('cache-control', 'no-store');
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
      return RobotStateSchema.parse(await robot.state());
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
    if (!body.success || !validateRobotCommandTiming(body.data))
      return reply.code(400).send({ error: 'invalid_robot_drive' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.drive(body.data),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/camera/look', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotCameraLookRequestSchema.safeParse(request.body);
    if (!body.success || !validateRobotCommandTiming(body.data))
      return reply.code(400).send({ error: 'invalid_robot_camera_look' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.look(body.data),
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
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.stop(),
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
      return reply.type(stream.contentType).send(stream.body);
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

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

  app.post('/api/assistant/conversations', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const parsed = AssistantCreateConversationRequestSchema.safeParse(
      request.body ?? {},
    );
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_assistant_conversation' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantConversationSchema.parse(
        assistant.createConversation(
          session.member.profileId,
          parsed.data.title,
          parsed.data.mode,
        ),
      );
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
        assistant.updateConversation(
          session.member.profileId,
          params.data.id,
          body.data,
        ),
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
      if (error instanceof AssistantConflictError)
        return reply
          .code(409)
          .send({ error: 'assistant_conflict', message: error.message });
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
      const params = AssistantConversationParamsSchema.safeParse(
        request.params,
      );
      const body = AssistantSendMessageRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'invalid_assistant_message' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return AssistantSubmissionResponseSchema.parse(
          assistant.submit(session.member.profileId, params.data.id, body.data),
        );
      } catch (error) {
        if (error instanceof AssistantNotFoundError)
          return reply.code(404).send({ error: 'assistant_not_found' });
        if (error instanceof AssistantConflictError)
          return reply
            .code(409)
            .send({ error: 'assistant_conflict', message: error.message });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.get('/api/assistant/runs/:id', async (request, reply) => {
    const params = AssistantRunParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_assistant_run' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantRunSchema.parse(
        assistant.getRun(session.member.profileId, params.data.id),
      );
    } catch (error) {
      if (error instanceof AssistantNotFoundError)
        return reply.code(404).send({ error: 'assistant_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/assistant/web/usage', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return AssistantWebUsageSchema.parse(await assistant.webUsage());
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/assistant/web/exa-usage', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return AssistantExaUsageSchema.parse(assistant.exaUsage());
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get(
    '/api/assistant/conversations/:id/research-diagnostics',
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
        return AssistantResearchDiagnosticsResponseSchema.parse(
          assistant.researchDiagnostics(
            session.member.profileId,
            params.data.id,
          ),
        );
      } catch (error) {
        if (error instanceof AssistantNotFoundError)
          return reply.code(404).send({ error: 'assistant_not_found' });
        return sendClosedAuthError(error, reply);
      }
    },
  );

  app.post('/api/assistant/runs/:id/search-consent', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = AssistantRunParamsSchema.safeParse(request.params);
    const body = AssistantSearchConsentRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_assistant_consent' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantRunSchema.parse(
        assistant.consent(
          session.member.profileId,
          params.data.id,
          body.data.approved,
          body.data.queries,
        ),
      );
    } catch (error) {
      if (error instanceof AssistantNotFoundError)
        return reply.code(404).send({ error: 'assistant_not_found' });
      if (error instanceof AssistantConflictError)
        return reply.code(409).send({
          error: 'assistant_conflict',
          message: error.message,
        });
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/assistant/runs/:id/events', async (request, reply) => {
    const params = AssistantRunParamsSchema.safeParse(request.params);
    const query = AssistantEventsQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: 'invalid_assistant_events' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantRunEventsResponseSchema.parse(
        assistant.listEvents(
          session.member.profileId,
          params.data.id,
          query.data.after,
        ),
      );
    } catch (error) {
      if (error instanceof AssistantNotFoundError)
        return reply.code(404).send({ error: 'assistant_not_found' });
      return sendClosedAuthError(error, reply);
    }
  });

  for (const action of ['cancel', 'retry'] as const) {
    app.post(`/api/assistant/runs/:id/${action}`, async (request, reply) => {
      if (!acceptsTrustedMutationOrigin(request.headers))
        return reply.code(403).send({ error: 'untrusted_origin' });
      const params = AssistantRunParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_assistant_run' });
      try {
        const session = await closedAuth.requireSession(request.headers);
        return AssistantRunSchema.parse(
          action === 'cancel'
            ? assistant.cancel(session.member.profileId, params.data.id)
            : assistant.retry(session.member.profileId, params.data.id),
        );
      } catch (error) {
        if (error instanceof AssistantNotFoundError)
          return reply.code(404).send({ error: 'assistant_not_found' });
        if (error instanceof AssistantConflictError)
          return reply
            .code(409)
            .send({ error: 'assistant_conflict', message: error.message });
        return sendClosedAuthError(error, reply);
      }
    });
  }

  app.get('/api/assistant/queue/summary', async (request, reply) => {
    try {
      const session = await closedAuth.requireSession(request.headers);
      return AssistantQueueSummarySchema.parse(
        assistant.queueSummary(session.member.profileId),
      );
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });

  app.get('/api/inference/status', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return InferenceStatusSchema.parse(
        assistantEngine.getInferenceStatus?.() ?? {
          active: null,
          queued: { assistant: 0, watch: 0 },
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
    await robot.close();
    await watch.stop();
    await assistant.stop();
    await groceryClassification.stop();
    database.close();
  });

  return app;
}

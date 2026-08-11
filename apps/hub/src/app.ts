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
  AssistantMessagesResponseSchema,
  AssistantQueueSummarySchema,
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
  HealthResponseSchema,
  PairingCodeResponseSchema,
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
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
import { SyncService } from './sync/sync-service.js';

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
  assistantEngine?: AssistantEngine;
  tavilySearchClient?: TavilySearchClient;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
  publicOrigin?: string;
  authSecret?: string;
  webRoot?: string;
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
  const assistant = new AssistantService(
    database,
    options.assistantEngine ??
      new OllamaAssistantEngine({
        ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
        model:
          process.env.FRIDAY_ASSISTANT_MODEL ?? 'gemma4-12b-multimodal:128k',
        ...(process.env.FRIDAY_ASSISTANT_TIMEOUT_MS
          ? {
              timeoutMs: Number.parseInt(
                process.env.FRIDAY_ASSISTANT_TIMEOUT_MS,
                10,
              ),
            }
          : {}),
      }),
    options.tavilySearchClient ??
      new TavilySearchClient(process.env.FRIDAY_TAVILY_API_KEY),
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

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
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
    await assistant.stop();
    await groceryClassification.stop();
    database.close();
  });

  return app;
}

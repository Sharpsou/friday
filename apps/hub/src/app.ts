import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import {
  HealthResponseSchema,
  InferenceStatusSchema,
  RobotControlPreferencesSchema,
  RobotDisplayPreferencesSchema,
  RobotPanoramaPreferencesSchema,
} from '@friday/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { AssistantArchiveService } from './assistant/assistant-service.js';
import { loadOrCreateAuthSecret } from './auth/auth-secret.js';
import { ClosedAuthService } from './auth/auth-service.js';
import { chatPlugin } from './chat/chat-plugin.js';
import { ChatService } from './chat/chat-service.js';
import { VerifiedChatEngine } from './chat/verified-chat-engine.js';
import { openDatabase } from './db/database.js';
import { GroceryClassificationService } from './groceries/grocery-classification-service.js';
import { OllamaClassificationEngine } from './groceries/ollama-classification-engine.js';
import { OllamaPhotoTranscriptionEngine } from './groceries/ollama-photo-transcription-engine.js';
import { registerAssistantRoutes } from './http/assistant-routes.js';
import { registerAuthRoutes } from './http/auth-routes.js';
import { registerGroceriesRoutes } from './http/groceries-routes.js';
import { registerRobotRoutes } from './http/robot-routes.js';
import type { BuildHubOptions } from './http/route-support.js';
import { HOUSEHOLD_ID, sendClosedAuthError } from './http/route-support.js';
import { registerSyncRoutes } from './http/sync-routes.js';
import { registerWatchRoutes } from './http/watch-routes.js';
import {
  InferenceScheduler,
  ScheduledOllamaClient,
} from './inference/inference-scheduler.js';
import { WebBudget } from './integrations/web/web-budget.js';
import {
  ChatMenuRecipeEngine,
  MenuAiService,
} from './maison/menu-ai-service.js';
import { menuPlugin } from './maison/menu-plugin.js';
import { RobotAutonomyService } from './robot/robot-autonomy.js';
import {
  DisabledRobotController,
  type RobotController,
} from './robot/robot-controller.js';
import { RobotVisualTopologyService } from './robot/robot-visual-topology.js';
import { SyncService } from './sync/sync-service.js';
import { OllamaWatchEngine } from './watch/ollama-watch-engine.js';
import { TavilySearchClient } from './watch/tavily-search.js';
import { WatchService } from './watch/watch-service.js';

export async function buildHub(options: BuildHubOptions) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    ...(options.https ? { https: options.https } : {}),
    logger: options.logger ?? false,
  });
  const database = openDatabase(options.databasePath);
  const sync = new SyncService(database);
  const inferenceScheduler = new InferenceScheduler();
  const groceryClassification = new GroceryClassificationService(
    database,
    options.classificationEngine ??
      new OllamaClassificationEngine({
        scheduler: inferenceScheduler,
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
      scheduler: inferenceScheduler,
      ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
      ...(options.photoTranscriptionModel
        ? { model: options.photoTranscriptionModel }
        : {}),
      ...(options.photoTranscriptionTimeoutMs
        ? { timeoutMs: options.photoTranscriptionTimeoutMs }
        : {}),
    });
  const watchEngine =
    options.watchEngine ??
    new OllamaWatchEngine({
      scheduler: inferenceScheduler,
      ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
      model: process.env.FRIDAY_WATCH_MODEL ?? 'qwen3.5:9b-q4_K_M',
      ...(process.env.FRIDAY_WATCH_TIMEOUT_MS
        ? {
            timeoutMs: Number.parseInt(process.env.FRIDAY_WATCH_TIMEOUT_MS, 10),
          }
        : {}),
    });
  const sharedWebSearch = new TavilySearchClient(
    process.env.FRIDAY_TAVILY_API_KEY,
    fetch,
    new WebBudget(database),
  );
  const watchSearch = options.watchSearchClient ?? sharedWebSearch;
  const assistant = new AssistantArchiveService(database);
  const chat = new ChatService(
    database,
    options.chatEngine ??
      new VerifiedChatEngine({
        search: sharedWebSearch,
        axesEnabled:
          options.chatAxesEnabled ??
          process.env.FRIDAY_CHAT_AXES_ENABLED === 'true',
        ollama: new ScheduledOllamaClient(inferenceScheduler, 'chat', {
          ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
          timeoutMs: 240_000,
          maxQueueSize: 4,
        }),
      }),
  );
  const menuOllama = new ScheduledOllamaClient(inferenceScheduler, 'menus', {
    ...(options.ollamaBaseUrl ? { baseUrl: options.ollamaBaseUrl } : {}),
    timeoutMs: 240_000,
  });
  const menus = new MenuAiService(
    database,
    new ChatMenuRecipeEngine(
      options.chatEngine ??
        new VerifiedChatEngine({
          search: sharedWebSearch,
          axesEnabled:
            options.chatAxesEnabled ??
            process.env.FRIDAY_CHAT_AXES_ENABLED === 'true',
          ollama: menuOllama,
        }),
      menuOllama,
    ),
  );
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
  await app.register(chatPlugin, {
    prefix: '/api/chat',
    enabled: options.chatEnabled ?? process.env.FRIDAY_CHAT_ENABLED === 'true',
    service: chat,
    profileId: async (headers) =>
      (
        await closedAuth.requireSession(
          headers as Parameters<ClosedAuthService['requireSession']>[0],
        )
      ).member.profileId,
    trustedMutation: (headers) =>
      acceptsTrustedMutationOrigin(
        headers as Parameters<typeof acceptsTrustedMutationOrigin>[0],
      ),
    handleAuthError: (error, reply) => sendClosedAuthError(error, reply),
  });
  await app.register(menuPlugin, {
    prefix: '/api/menus',
    enabled: options.chatEnabled ?? process.env.FRIDAY_CHAT_ENABLED === 'true',
    service: menus,
    profileId: async (headers) =>
      (
        await closedAuth.requireSession(
          headers as Parameters<ClosedAuthService['requireSession']>[0],
        )
      ).member.profileId,
    trustedMutation: (headers) =>
      acceptsTrustedMutationOrigin(
        headers as Parameters<typeof acceptsTrustedMutationOrigin>[0],
      ),
    handleAuthError: (error, reply) => sendClosedAuthError(error, reply),
  });
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
  registerRobotRoutes(app, {
    closedAuth,
    robot,
    robotTopology,
    acceptsTrustedMutationOrigin,
    robotAutonomy,
    readRobotDisplayPreferences,
    acceptsRobotCommandRate,
    database,
    readRobotControlPreferences,
    readRobotPanoramaPreferences,
  });

  registerAuthRoutes(app, { closedAuth, acceptsTrustedMutationOrigin });

  registerSyncRoutes(app, {
    acceptsTrustedMutationOrigin,
    closedAuth,
    sync,
    database,
  });

  registerGroceriesRoutes(app, {
    acceptsTrustedMutationOrigin,
    closedAuth,
    groceryPhotoTranscription,
    groceryClassification,
  });

  registerAssistantRoutes(app, {
    closedAuth,
    assistant,
    acceptsTrustedMutationOrigin,
  });

  app.get('/api/inference/status', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return InferenceStatusSchema.parse(inferenceScheduler.status());
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
  });
  registerWatchRoutes(app, { closedAuth, watch, acceptsTrustedMutationOrigin });

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
    await menus.stop();
    database.close();
  });

  return app;
}

export { sendRobotError } from './http/route-support.js';
export type { BuildHubOptions } from './http/route-support.js';

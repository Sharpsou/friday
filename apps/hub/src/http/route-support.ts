import { z } from 'zod';
import { ClosedAuthError } from '../auth/auth-service.js';
import { type ChatEngine } from '../chat/chat-service.js';
import { type GroceryClassificationEngine } from '../groceries/ollama-classification-engine.js';
import { type GroceryPhotoTranscriptionEngine } from '../groceries/ollama-photo-transcription-engine.js';
import { RobotAutonomyError } from '../robot/robot-autonomy.js';
import {
  RobotCommandRejectedError,
  RobotUnavailableError,
  type RobotController,
} from '../robot/robot-controller.js';
import type { RobotPlaceRecognitionEngine } from '../robot/robot-place-recognition.js';
import { RobotVisualTopologyError } from '../robot/robot-visual-topology.js';
import { type WatchLanguageEngine } from '../watch/ollama-watch-engine.js';
import { TavilySearchClient } from '../watch/tavily-search.js';
export const sendRobotError = (
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
  chatEnabled?: boolean;
  chatAxesEnabled?: boolean;
  chatEngine?: ChatEngine;
}

export const PullQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
});

export const DeviceParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const DeviceApprovalParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const DeviceApprovalStatusQuerySchema = z
  .object({ token: z.string().min(32).max(128) })
  .strict();

export const ClassificationJobParamsSchema = z
  .object({ jobId: z.string().uuid() })
  .strict();

export const AssistantConversationParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const WatchParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const WatchArticleParamsSchema = z
  .object({ articleId: z.string().uuid(), id: z.string().uuid() })
  .strict();

export const WatchConceptParamsSchema = z
  .object({ conceptId: z.string().uuid(), id: z.string().uuid() })
  .strict();

export const WatchSuggestionRequestSchema = z
  .object({ query: z.string().trim().min(3).max(500) })
  .strict();

export const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

export function sendClosedAuthError(
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

export function forwardSetCookies(
  reply: { header(name: string, value: string | string[]): unknown },
  headers: Headers,
): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

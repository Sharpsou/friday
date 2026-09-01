import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  ChatActiveRunResponseSchema,
  ChatConversationsResponseSchema,
  ChatCreateConversationRequestSchema,
  ChatDeleteResponseSchema,
  ChatEnqueueResponseSchema,
  ChatMessagesResponseSchema,
  ChatRunSchema,
  ChatSendMessageRequestSchema,
  ChatUpdateConversationRequestSchema,
  ChatWebUsageSchema,
} from '@friday/contracts';

import {
  ChatNotFoundError,
  ChatQueueFullError,
  type ChatService,
} from './chat-service.js';

const IdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export interface ChatPluginOptions {
  enabled: boolean;
  service: ChatService;
  profileId(headers: Record<string, unknown>): Promise<string>;
  trustedMutation(headers: Record<string, unknown>): boolean;
  handleAuthError(
    error: unknown,
    reply: { code(status: number): unknown },
  ): unknown;
}

export const chatPlugin: FastifyPluginAsync<ChatPluginOptions> = async (
  app,
  options,
) => {
  const disabled = (reply: { code(status: number): unknown }) =>
    (reply.code(503) as { send(payload: unknown): unknown }).send({
      error: 'chat_disabled',
    });
  const authenticate = async (headers: Record<string, unknown>) =>
    options.profileId(headers);
  const mutationAllowed = (headers: Record<string, unknown>) =>
    options.trustedMutation(headers);

  app.get('/conversations', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    try {
      const profileId = await authenticate(request.headers);
      return ChatConversationsResponseSchema.parse({
        conversations: options.service.listConversations(profileId),
      });
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });

  app.get('/web-usage', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    try {
      await authenticate(request.headers);
      return ChatWebUsageSchema.parse(await options.service.webUsage());
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });

  app.post('/conversations', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    if (!mutationAllowed(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = ChatCreateConversationRequestSchema.safeParse(
      request.body ?? {},
    );
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_chat_conversation' });
    try {
      const profileId = await authenticate(request.headers);
      return reply
        .code(201)
        .send(
          options.service.createConversation(
            profileId,
            body.data.title,
            body.data.mode,
          ),
        );
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });

  app.patch('/conversations/:id', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    if (!mutationAllowed(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = IdParamsSchema.safeParse(request.params);
    const body = ChatUpdateConversationRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_chat_conversation' });
    try {
      const profileId = await authenticate(request.headers);
      return options.service.updateConversation(profileId, params.data.id, {
        ...(body.data.title === undefined ? {} : { title: body.data.title }),
        ...(body.data.mode === undefined ? {} : { mode: body.data.mode }),
        ...(body.data.archived === undefined
          ? {}
          : { archived: body.data.archived }),
      });
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.delete('/conversations/:id', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    if (!mutationAllowed(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_chat_conversation' });
    try {
      const profileId = await authenticate(request.headers);
      options.service.deleteConversation(profileId, params.data.id);
      return ChatDeleteResponseSchema.parse({ deleted: true });
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.get('/conversations/:id/messages', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_chat_conversation' });
    try {
      const profileId = await authenticate(request.headers);
      return ChatMessagesResponseSchema.parse(
        options.service.getMessages(profileId, params.data.id),
      );
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.get('/conversations/:id/active-run', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_chat_conversation' });
    try {
      const profileId = await authenticate(request.headers);
      return ChatActiveRunResponseSchema.parse({
        run: options.service.getActiveRun(profileId, params.data.id),
      });
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.post('/conversations/:id/messages', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    if (!mutationAllowed(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = IdParamsSchema.safeParse(request.params);
    const body = ChatSendMessageRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_chat_message' });
    try {
      const profileId = await authenticate(request.headers);
      const runId = options.service.enqueue(
        profileId,
        params.data.id,
        body.data.clientRequestId,
        body.data.content,
      );
      return reply.code(202).send(ChatEnqueueResponseSchema.parse({ runId }));
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      if (error instanceof ChatQueueFullError)
        return reply.code(429).send({ error: 'chat_queue_full' });
      return options.handleAuthError(error, reply);
    }
  });

  app.get('/runs/:id', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_chat_run' });
    try {
      const profileId = await authenticate(request.headers);
      return ChatRunSchema.parse(
        options.service.getRun(profileId, params.data.id),
      );
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.delete('/runs/:id', async (request, reply) => {
    if (!options.enabled) return disabled(reply);
    if (!mutationAllowed(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_chat_run' });
    try {
      const profileId = await authenticate(request.headers);
      options.service.cancelRun(profileId, params.data.id);
      return ChatDeleteResponseSchema.parse({ deleted: true });
    } catch (error) {
      if (error instanceof ChatNotFoundError)
        return reply.code(404).send({ error: 'chat_not_found' });
      return options.handleAuthError(error, reply);
    }
  });

  app.addHook('onClose', async () => options.service.stop());
  if (options.enabled) options.service.start();
};

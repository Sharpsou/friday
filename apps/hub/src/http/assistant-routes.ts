import {
  AssistantConversationSchema,
  AssistantConversationsResponseSchema,
  AssistantMessagesResponseSchema,
  AssistantUpdateConversationRequestSchema,
} from '@friday/contracts';
import type { FastifyInstance } from 'fastify';
import { AssistantNotFoundError } from '../assistant/assistant-service.js';
import type { HubRouteContext } from './route-context.js';
import {
  AssistantConversationParamsSchema,
  sendClosedAuthError,
} from './route-support.js';
export function registerAssistantRoutes(
  app: FastifyInstance,
  {
    closedAuth,
    assistant,
    acceptsTrustedMutationOrigin,
  }: Pick<
    HubRouteContext,
    'closedAuth' | 'assistant' | 'acceptsTrustedMutationOrigin'
  >,
) {
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
}

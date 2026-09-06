import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MenuAiRequestSchema } from '@friday/contracts';
import type { ChatPluginOptions } from '../chat/chat-plugin.js';
import type { MenuAiService } from './menu-ai-service.js';

type Options = Omit<ChatPluginOptions, 'service'> & { service: MenuAiService };
export const menuPlugin: FastifyPluginAsync<Options> = async (app, options) => {
  app.get('/ai-jobs', async (request, reply) => {
    try {
      const profile = await options.profileId(request.headers);
      return { jobs: options.service.list(profile) };
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });
  app.post('/ai-jobs', async (request, reply) => {
    if (!options.enabled)
      return reply.code(503).send({ error: 'chat_disabled' });
    if (!options.trustedMutation(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const parsed = MenuAiRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_menu_request' });
    try {
      const profile = await options.profileId(request.headers);
      return reply
        .code(202)
        .send(
          options.service.enqueue(
            profile,
            parsed.data.requestId,
            parsed.data.name,
            parsed.data.mode,
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.message === 'MENU_QUEUE_FULL')
        return reply.code(429).send({ error: 'menu_queue_full' });
      if (error instanceof Error && error.message === 'MENU_REQUEST_REUSED')
        return reply.code(409).send({ error: 'menu_request_reused' });
      return options.handleAuthError(error, reply);
    }
  });
  app.get('/ai-jobs/:id', async (request, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_id' });
    try {
      const profile = await options.profileId(request.headers);
      const job = options.service.get(profile, parsed.data.id);
      return job ?? reply.code(404).send({ error: 'not_found' });
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });
  app.delete('/ai-jobs/:id', async (request, reply) => {
    if (!options.trustedMutation(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_id' });
    try {
      const profile = await options.profileId(request.headers);
      const job = options.service.cancel(profile, parsed.data.id);
      return job ?? reply.code(404).send({ error: 'not_found' });
    } catch (error) {
      return options.handleAuthError(error, reply);
    }
  });
  app.addHook('onReady', async () => {
    if (options.enabled) options.service.start();
  });
  app.addHook('onClose', async () => {
    await options.service.stop();
  });
};

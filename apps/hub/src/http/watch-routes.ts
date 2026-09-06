import {
  WatchAddDiscoveredSourcesRequestSchema,
  WatchAddDiscoveredSourcesResponseSchema,
  WatchArticleSchema,
  WatchArticleStateRequestSchema,
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
import type { FastifyInstance } from 'fastify';
import { ClosedAuthError } from '../auth/auth-service.js';
import { WatchNotFoundError } from '../watch/watch-service.js';
import type { HubRouteContext } from './route-context.js';
import {
  sendClosedAuthError,
  WatchArticleParamsSchema,
  WatchConceptParamsSchema,
  WatchParamsSchema,
  WatchSuggestionRequestSchema,
} from './route-support.js';
export function registerWatchRoutes(
  app: FastifyInstance,
  {
    closedAuth,
    watch,
    acceptsTrustedMutationOrigin,
  }: Pick<
    HubRouteContext,
    'closedAuth' | 'watch' | 'acceptsTrustedMutationOrigin'
  >,
) {
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
}

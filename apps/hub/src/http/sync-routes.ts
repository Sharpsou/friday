import {
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
} from '@friday/contracts';
import type { FastifyInstance } from 'fastify';
import {
  readMaisonGrocerySnapshot,
  readMaisonRecords,
} from '../maison/maison-sync.js';
import type { HubRouteContext } from './route-context.js';
import { PullQuerySchema, sendClosedAuthError } from './route-support.js';
export function registerSyncRoutes(
  app: FastifyInstance,
  {
    acceptsTrustedMutationOrigin,
    closedAuth,
    sync,
    database,
  }: Pick<
    HubRouteContext,
    'acceptsTrustedMutationOrigin' | 'closedAuth' | 'sync' | 'database'
  >,
) {
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

    const identityMismatch = parsed.data.operations.some((operation) =>
      operation.entityType === 'maison_command'
        ? operation.deviceId !== session.deviceId ||
          operation.profileId !== session.member.profileId ||
          operation.payload.householdId !==
            '1030b4f6-1e0f-48fa-adab-865750ce597d' ||
          operation.payload.writes.some(
            (w) =>
              w.record.householdId !== operation.payload.householdId ||
              w.record.deviceId !== operation.deviceId ||
              w.record.updatedByProfileId !== operation.profileId,
          )
        : operation.entityId !== operation.payload.id ||
          operation.deviceId !== operation.payload.deviceId ||
          operation.profileId !== operation.payload.updatedByProfileId ||
          operation.deviceId !== session.deviceId ||
          operation.profileId !== session.member.profileId ||
          (operation.baseRevision === 0 &&
            operation.payload.createdByProfileId !==
              session.member.profileId) ||
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
    return PullResponseSchema.parse(
      sync.pull(
        parsed.data.after,
        (request.query as { maison?: string }).maison === '1',
      ),
    );
  });

  app.get('/api/sync/maison-snapshot', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
    } catch (error) {
      return sendClosedAuthError(error, reply);
    }
    return {
      version: 1,
      cursor: (
        database
          .prepare(
            'SELECT COALESCE(MAX(sequence), 0) AS cursor FROM change_log',
          )
          .get() as { cursor: number }
      ).cursor,
      records: readMaisonRecords(database),
      groceries: readMaisonGrocerySnapshot(database),
    };
  });
}

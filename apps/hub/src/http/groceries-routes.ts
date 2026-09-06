import {
  GroceryClassificationApplyRequestSchema,
  GroceryClassificationApplyResponseSchema,
  GroceryClassificationJobSchema,
  GroceryClassificationPullResponseSchema,
  GroceryPhotoTranscriptionRequestSchema,
  GroceryPhotoTranscriptionResponseSchema,
} from '@friday/contracts';
import type { FastifyInstance } from 'fastify';
import { GroceryClassificationNotFoundError } from '../groceries/grocery-classification-service.js';
import type { HubRouteContext } from './route-context.js';
import {
  ClassificationJobParamsSchema,
  HOUSEHOLD_ID,
  PullQuerySchema,
  sendClosedAuthError,
} from './route-support.js';
export function registerGroceriesRoutes(
  app: FastifyInstance,
  {
    acceptsTrustedMutationOrigin,
    closedAuth,
    groceryPhotoTranscription,
    groceryClassification,
  }: Pick<
    HubRouteContext,
    | 'acceptsTrustedMutationOrigin'
    | 'closedAuth'
    | 'groceryPhotoTranscription'
    | 'groceryClassification'
  >,
) {
  let photoTranscriptionActive = false;

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
      const onClose = () => {
        if (!reply.raw.writableEnded) abort();
      };
      reply.raw.once('close', onClose);
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
        reply.raw.removeListener('close', onClose);
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
}

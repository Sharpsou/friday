import {
  AuthBootstrapRequestSchema,
  AuthDeviceApprovalRequestsResponseSchema,
  AuthDeviceApprovalStatusResponseSchema,
  AuthDevicesResponseSchema,
  AuthLoginRequestSchema,
  AuthLoginResponseSchema,
  AuthMembersResponseSchema,
  AuthPairRequestSchema,
  AuthSessionSchema,
  AuthStateResponseSchema,
  PairingCodeResponseSchema,
} from '@friday/contracts';
import type { FastifyInstance } from 'fastify';
import type { HubRouteContext } from './route-context.js';
import {
  DeviceApprovalParamsSchema,
  DeviceApprovalStatusQuerySchema,
  DeviceParamsSchema,
  forwardSetCookies,
  sendClosedAuthError,
} from './route-support.js';
export function registerAuthRoutes(
  app: FastifyInstance,
  {
    closedAuth,
    acceptsTrustedMutationOrigin,
  }: Pick<HubRouteContext, 'closedAuth' | 'acceptsTrustedMutationOrigin'>,
) {
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
}

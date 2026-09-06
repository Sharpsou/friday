import {
  RobotActuatorsRequestSchema,
  RobotArmRequestSchema,
  RobotAutonomyPowerRequestSchema,
  RobotAutonomyResponseSchema,
  RobotAutonomyStartRequestSchema,
  RobotCameraBandwidthRequestSchema,
  RobotCameraBandwidthStatusSchema,
  RobotCameraLookRequestSchema,
  RobotCommandResponseSchema,
  RobotControlPreferencesRequestSchema,
  RobotDisplayPreferencesRequestSchema,
  RobotDriveRequestSchema,
  RobotOperatingModeRequestSchema,
  RobotPanoramaPreferencesRequestSchema,
  RobotStateSchema,
  RobotVisualGraphSchema,
  RobotVisualMemoryPurgeRequestSchema,
  RobotVisualMemoryPurgeResponseSchema,
  RobotVisualObjectRenameRequestSchema,
  RobotVisualPlaceMergeRequestSchema,
  RobotVisualPlaceRenameRequestSchema,
} from '@friday/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HubRouteContext } from './route-context.js';
import { HOUSEHOLD_ID, sendRobotError } from './route-support.js';
export function registerRobotRoutes(
  app: FastifyInstance,
  {
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
  }: Pick<
    HubRouteContext,
    | 'closedAuth'
    | 'robot'
    | 'robotTopology'
    | 'acceptsTrustedMutationOrigin'
    | 'robotAutonomy'
    | 'readRobotDisplayPreferences'
    | 'acceptsRobotCommandRate'
    | 'database'
    | 'readRobotControlPreferences'
    | 'readRobotPanoramaPreferences'
  >,
) {
  app.get('/api/robot/state', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      const state = RobotStateSchema.parse(await robot.state());
      const keyframe = state.vision
        ? (robot.visionKeyframe?.(state.vision.frameId) ?? null)
        : null;
      void robotTopology.observe(state, keyframe).catch((error: unknown) => {
        app.log.warn(
          { error },
          'Reconnaissance de lieu temporairement indisponible.',
        );
      });
      return state;
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/power/sleep', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!robot.sleepNetwork)
        return reply
          .code(404)
          .send({ error: 'robot_network_standby_unavailable' });
      if (robotAutonomy.status().status !== 'inactive')
        await robotAutonomy.stop('network_standby');
      robotTopology.pauseObservations();
      try {
        const state = await robot.sleepNetwork();
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      } catch (error) {
        robotTopology.resumeObservationsAfter(700);
        throw error;
      }
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/power/wake', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!robot.wakeNetwork)
        return reply
          .code(404)
          .send({ error: 'robot_network_standby_unavailable' });
      const state = await robot.wakeNetwork();
      robotTopology.resumeObservationsAfter(700);
      return RobotCommandResponseSchema.parse({ accepted: true, state });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/display-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotDisplayPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/display-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotDisplayPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_display_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_display_preferences(
             household_id, recognition_visible, updated_at, updated_by_profile_id
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             recognition_visible = excluded.recognition_visible,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.recognitionVisible ? 1 : 0,
          updatedAt,
          session.member.profileId,
        );
      return readRobotDisplayPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/control-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotControlPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/control-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotControlPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_control_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_control_preferences(
             household_id, steering_trim_percent, updated_at,
             updated_by_profile_id
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             steering_trim_percent = excluded.steering_trim_percent,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.steeringTrimPercent,
          updatedAt,
          session.member.profileId,
        );
      return readRobotControlPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/panorama-preferences', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return readRobotPanoramaPreferences();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/panorama-preferences', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotPanoramaPreferencesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid_robot_panorama_preferences' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      const updatedAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO robot_control_preferences(
             household_id, steering_trim_percent, panorama_pulse_ms,
             updated_at, updated_by_profile_id
           ) VALUES (?, 0, ?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             panorama_pulse_ms = excluded.panorama_pulse_ms,
             updated_at = excluded.updated_at,
             updated_by_profile_id = excluded.updated_by_profile_id`,
        )
        .run(
          HOUSEHOLD_ID,
          body.data.panoramaPulseMs,
          updatedAt,
          session.member.profileId,
        );
      const saved = readRobotPanoramaPreferences();
      robotAutonomy.setPanoramaPulseDuration(saved.panoramaPulseMs);
      return saved;
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/graph', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return RobotVisualGraphSchema.parse(robotTopology.snapshot());
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/graph/purge', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotVisualMemoryPurgeRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_memory_purge' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_memory_purge');
      return RobotVisualMemoryPurgeResponseSchema.parse(
        await robotTopology.purge(body.data.scope),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/camera/bandwidth', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return RobotCameraBandwidthStatusSchema.parse(
        await robot.cameraBandwidth(),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/camera/bandwidth', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotCameraBandwidthRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_camera_bandwidth' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('camera_bandwidth_changed');
      return RobotCameraBandwidthStatusSchema.parse(
        await robot.setCameraBandwidth(body.data.profile),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/autonomy', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      return robotAutonomy.status();
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/start', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotAutonomyStartRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_autonomy_start' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const panoramaPreferences = readRobotPanoramaPreferences();
      const state = await robotAutonomy.start({
        powerPercent: body.data.powerPercent,
        steeringTrimPercent: body.data.steeringTrimPercent,
        panoramaPulseMs: panoramaPreferences.panoramaPulseMs,
        ...(body.data.allowCandidatePath !== undefined
          ? { allowCandidatePath: body.data.allowCandidatePath }
          : {}),
        ...(body.data.targetPlaceId
          ? { targetPlaceId: body.data.targetPlaceId }
          : {}),
      });
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/autonomy/power', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotAutonomyPowerRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_autonomy_power' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return robotAutonomy.setPowerPercent(body.data.powerPercent);
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/stop', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.stop();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/recovery/start', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.beginHumanRecovery();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/autonomy/recovery/finish', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      const state = await robotAutonomy.finishHumanRecovery();
      return RobotAutonomyResponseSchema.parse({
        accepted: true,
        state,
        graph: robotTopology.snapshot(),
        autonomy: robotAutonomy.status(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/graph/objects/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualObjectRenameRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_object' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.renameObject(params.data.id, body.data.displayName),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.patch('/api/robot/graph/places/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualPlaceRenameRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_place' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.renamePlace(params.data.id, body.data.label),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/graph/places/:id/merge', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    const body = RobotVisualPlaceMergeRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_merge' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_places_merge');
      return RobotVisualGraphSchema.parse(
        await robotTopology.mergePlaces(
          params.data.id,
          body.data.sourcePlaceId,
        ),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.delete('/api/robot/graph/places/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_place' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (robotAutonomy.status().status === 'inactive') await robot.stop();
      else await robotAutonomy.stop('visual_place_deleted');
      return RobotVisualGraphSchema.parse(
        await robotTopology.deletePlace(params.data.id),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.delete('/api/robot/graph/objects/:id', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: 'invalid_robot_visual_object' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotVisualGraphSchema.parse(
        robotTopology.deleteObject(params.data.id),
      );
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/arm', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotArmRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_arm' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.arm(body.data.durationMs),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/drive', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotDriveRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_drive' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      if ((await robot.state()).operatingMode !== 'manual')
        return reply.code(409).send({
          error: 'robot_manual_required',
          message: 'La téléopération est disponible uniquement en mode Manuel.',
        });
      // The hub is the clock authority shared with the Pi. Preserve the
      // short, schema-bounded motor pulse while giving the command enough
      // transport time to reach a loaded Pi. The embedded watchdog still
      // limits actual motion with maxDurationMs.
      const forwardedAt = Date.now();
      const state = await robot.drive({
        ...body.data,
        issuedAt: new Date(forwardedAt).toISOString(),
        expiresAt: new Date(forwardedAt + 1_800).toISOString(),
      });
      robotAutonomy.observeManualDrive(body.data, state);
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state,
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/camera/look', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotCameraLookRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_camera_look' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 10))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      // The browser clock is not a safety authority. Re-stamp this bounded
      // target-position command at the hub boundary so ordinary phone clock
      // skew cannot make it expire before it reaches the Pi.
      const forwardedAt = Date.now();
      robotTopology.pauseObservations();
      try {
        return RobotCommandResponseSchema.parse({
          accepted: true,
          state: await robot.look({
            ...body.data,
            issuedAt: new Date(forwardedAt).toISOString(),
            expiresAt: new Date(forwardedAt + 1_800).toISOString(),
          }),
        });
      } finally {
        robotTopology.resumeObservationsAfter(700);
      }
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/actuators', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotActuatorsRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_actuators' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (!acceptsRobotCommandRate(session.deviceId, 5))
        return reply.code(429).send({ error: 'robot_rate_limited' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.setActuators(body.data),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/mode', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    const body = RobotOperatingModeRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_robot_mode' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      if (body.data.mode === 'autonomous') {
        if (robotAutonomy.status().status === 'recovering') {
          const state = await robotAutonomy.finishHumanRecovery();
          return RobotCommandResponseSchema.parse({ accepted: true, state });
        }
        const controlPreferences = readRobotControlPreferences();
        const panoramaPreferences = readRobotPanoramaPreferences();
        const state = await robotAutonomy.start({
          powerPercent: 20,
          steeringTrimPercent: controlPreferences.steeringTrimPercent,
          panoramaPulseMs: panoramaPreferences.panoramaPulseMs,
        });
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      }
      if (robotAutonomy.status().status !== 'inactive') {
        const state = await robotAutonomy.stop('manual_mode');
        return RobotCommandResponseSchema.parse({ accepted: true, state });
      }
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.setMode(body.data.mode),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/stop', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      await closedAuth.requireSession(request.headers);
      const state =
        robotAutonomy.status().status === 'inactive'
          ? await robot.stop()
          : await robotAutonomy.stop('emergency_stop');
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state,
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.post('/api/robot/halt', async (request, reply) => {
    if (!acceptsTrustedMutationOrigin(request.headers))
      return reply.code(403).send({ error: 'untrusted_origin' });
    try {
      const session = await closedAuth.requireSession(request.headers);
      if (session.member.role !== 'owner')
        return reply.code(403).send({ error: 'robot_owner_required' });
      return RobotCommandResponseSchema.parse({
        accepted: true,
        state: await robot.halt(),
      });
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get('/api/robot/camera/stream', async (request, reply) => {
    try {
      await closedAuth.requireSession(request.headers);
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('close', abort);
      const stream = await robot.openCameraStream(controller.signal);
      stream.body.once('close', () =>
        request.raw.removeListener('close', abort),
      );
      return reply
        .header('X-Accel-Buffering', 'no')
        .type(stream.contentType)
        .send(stream.body);
    } catch (error) {
      return sendRobotError(error, reply);
    }
  });

  app.get(
    '/api/robot/graph/places/:placeId/views/:viewId',
    async (request, reply) => {
      const params = z
        .object({ placeId: z.string().uuid(), viewId: z.string().uuid() })
        .safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_robot_visual_view' });
      try {
        await closedAuth.requireSession(request.headers);
        const view = robotTopology.image(
          params.data.placeId,
          params.data.viewId,
        );
        if (!view)
          return reply.code(404).send({ error: 'robot_visual_view_not_found' });
        return reply
          .header('content-disposition', 'inline')
          .header('x-robot-observed-at', view.observedAt)
          .type('image/jpeg')
          .send(view.image);
      } catch (error) {
        return sendRobotError(error, reply);
      }
    },
  );
}

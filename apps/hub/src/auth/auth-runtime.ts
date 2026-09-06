import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ClosedAuthOptions,
  type SessionDeviceContext,
} from './auth-records.js';
export class AuthSessionRuntime {
  readonly auth;
  private readonly enrollmentContext =
    new AsyncLocalStorage<SessionDeviceContext>();
  constructor(options: ClosedAuthOptions) {
    this.auth = betterAuth({
      advanced: {
        cookiePrefix: 'friday',
        defaultCookieAttributes: { sameSite: 'strict' },
        useSecureCookies: options.publicOrigin.startsWith('https://'),
      },
      basePath: '/api/auth',
      baseURL: options.publicOrigin,
      database: options.database,
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const deviceId = this.enrollmentContext.getStore()?.deviceId;
              if (!deviceId) {
                throw new APIError('FORBIDDEN', {
                  message: 'Appareil non appairé.',
                });
              }
              return { data: { ...session, deviceId } };
            },
          },
        },
      },
      emailAndPassword: {
        autoSignIn: true,
        enabled: true,
        maxPasswordLength: 128,
        minPasswordLength: 12,
        requireEmailVerification: false,
      },
      rateLimit: {
        enabled: true,
        max: 60,
        window: 60,
        customRules: {
          '/sign-in/email': { max: 5, window: 60 },
          '/sign-up/email': { max: 3, window: 60 },
        },
      },
      secret: options.secret,
      session: {
        additionalFields: {
          deviceId: { input: false, required: true, type: 'string' },
        },
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
      },
      trustedOrigins: [
        ...new Set([options.publicOrigin, ...(options.trustedOrigins ?? [])]),
      ],
    });
  }
  withDevice<T>(deviceId: string, action: () => Promise<T>): Promise<T> {
    return this.enrollmentContext.run({ deviceId }, action);
  }
}

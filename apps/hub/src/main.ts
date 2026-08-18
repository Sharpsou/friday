import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHub } from './app.js';

const host = process.env.FRIDAY_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.FRIDAY_PORT ?? '8443', 10);
const defaultDataDirectory = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'Friday')
  : resolve('data');
const databasePath =
  process.env.FRIDAY_DATABASE_PATH ??
  resolve(process.env.FRIDAY_DATA_DIR ?? defaultDataDirectory, 'friday.sqlite');
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

const certPath = process.env.FRIDAY_TLS_CERT_PATH;
const keyPath = process.env.FRIDAY_TLS_KEY_PATH;
const tlsConfigured = Boolean(certPath && keyPath);
const publicOrigin =
  process.env.FRIDAY_PUBLIC_ORIGIN ??
  `${tlsConfigured ? 'https' : 'http'}://${host}:${port.toString()}`;
const authTrustedOrigins = process.env.FRIDAY_TRUSTED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const authAttemptLimitRaw = process.env.FRIDAY_AUTH_ATTEMPT_LIMIT;
const authAttemptLimit = authAttemptLimitRaw
  ? Number.parseInt(authAttemptLimitRaw, 10)
  : undefined;
const ollamaTimeoutRaw = process.env.FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS;
const ollamaTimeoutMs = ollamaTimeoutRaw
  ? Number.parseInt(ollamaTimeoutRaw, 10)
  : undefined;

if (
  ollamaTimeoutRaw &&
  (!Number.isSafeInteger(ollamaTimeoutMs) || (ollamaTimeoutMs ?? 0) < 1_000)
) {
  throw new Error(
    'FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS doit être un entier supérieur ou égal à 1000.',
  );
}

if (
  authAttemptLimit !== undefined &&
  (!Number.isInteger(authAttemptLimit) || authAttemptLimit <= 0)
) {
  throw new Error('FRIDAY_AUTH_ATTEMPT_LIMIT doit être un entier positif.');
}

if (host !== '127.0.0.1' && host !== 'localhost' && !tlsConfigured) {
  throw new Error(
    'Friday refuse une écoute LAN sans FRIDAY_TLS_CERT_PATH et FRIDAY_TLS_KEY_PATH.',
  );
}

const https =
  tlsConfigured && certPath && keyPath
    ? {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      }
    : undefined;
const app = await buildHub({
  ...(authAttemptLimit !== undefined ? { authAttemptLimit } : {}),
  ...(authTrustedOrigins ? { authTrustedOrigins } : {}),
  ...(process.env.FRIDAY_AUTH_SECRET
    ? { authSecret: process.env.FRIDAY_AUTH_SECRET }
    : {}),
  databasePath,
  ...(https ? { https } : {}),
  logger: true,
  ...(process.env.FRIDAY_OLLAMA_URL
    ? { ollamaBaseUrl: process.env.FRIDAY_OLLAMA_URL }
    : {}),
  ...(process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL
    ? { ollamaModel: process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL }
    : {}),
  ...(ollamaTimeoutMs ? { ollamaTimeoutMs } : {}),
  publicOrigin,
  webRoot,
});

await app.listen({ host, port });

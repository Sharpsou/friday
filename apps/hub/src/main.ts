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
  databasePath,
  ...(https ? { https } : {}),
  logger: true,
  webRoot,
});

await app.listen({ host, port });

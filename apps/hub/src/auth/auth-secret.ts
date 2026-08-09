import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MINIMUM_SECRET_LENGTH = 32;

export function loadOrCreateAuthSecret(
  databasePath: string,
  configuredSecret?: string,
): string {
  if (configuredSecret) {
    if (configuredSecret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(
        'FRIDAY_AUTH_SECRET doit contenir au moins 32 caractères.',
      );
    }
    return configuredSecret;
  }
  if (databasePath === ':memory:') return randomBytes(32).toString('base64url');

  const secretPath = `${databasePath}.auth-secret`;
  if (existsSync(secretPath)) {
    const storedSecret = readFileSync(secretPath, 'utf8').trim();
    if (storedSecret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error('Le secret d’authentification Friday est invalide.');
    }
    return storedSecret;
  }

  const generatedSecret = randomBytes(32).toString('base64url');
  writeFileSync(secretPath, `${generatedSecret}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return generatedSecret;
}

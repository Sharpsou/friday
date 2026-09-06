import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Tests must never rebuild the assets served by the running household Hub.
const web = resolve('.verification/web');
const env = {
  ...process.env,
  FRIDAY_WEB_OUT_DIR: web,
  FRIDAY_WEB_ROOT: web,
  FRIDAY_E2E_PORT: process.env.FRIDAY_E2E_PORT ?? '18443',
};
for (const command of [
  'format:check',
  'lint',
  'typecheck',
  'architecture',
  'test',
  'build',
  'test:e2e',
]) {
  if (command === 'build' && existsSync(web)) {
    // Vite does not empty an outDir outside its project root automatically.
    // Refuse a redirected path before deleting this fixed, disposable output.
    if (realpathSync(web).toLowerCase() !== web.toLowerCase()) {
      throw new Error(
        `Refusing to clean redirected verification output: ${web}`,
      );
    }
    rmSync(web, { recursive: true });
  }
  const result = spawnSync('pnpm', [command], {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

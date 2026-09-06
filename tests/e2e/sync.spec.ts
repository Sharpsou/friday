import { expect, test } from './fixtures';

test('local deletion stays available while the hub request is stalled', async ({
  page,
}) => {
  const title = `Tâche pendant synchro ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const task = page.getByRole('listitem').filter({ hasText: title });
  await expect(task).toContainText('Synchronisée avec le foyer');

  let releasePull!: () => void;
  let signalPullStarted!: () => void;
  const pullStarted = new Promise<void>((resolve) => {
    signalPullStarted = resolve;
  });
  const pullReleased = new Promise<void>((resolve) => {
    releasePull = resolve;
  });

  await page.route('**/api/sync/pull?**', async (route) => {
    signalPullStarted();
    await pullReleased;
    await route.continue();
  });

  try {
    await page.getByRole('button', { name: 'Connecté' }).click();
    await pullStarted;
    await page.getByRole('button', { name: 'Modifier' }).click();

    await expect(
      page.getByRole('button', { name: `Supprimer ${title}` }),
    ).toBeEnabled();
  } finally {
    releasePull();
  }
});

test('a stalled hub request does not leave the connection status pending', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const connectionStatus = page.getByRole('button', {
    name: /^(Connect|Hors ligne)/u,
  });
  await expect(connectionStatus).toBeVisible();

  let releasePull!: () => void;
  let signalPullStarted!: () => void;
  const pullStarted = new Promise<void>((resolve) => {
    signalPullStarted = resolve;
  });
  const pullReleased = new Promise<void>((resolve) => {
    releasePull = resolve;
  });

  await page.route('**/api/sync/pull?**', async (route) => {
    signalPullStarted();
    await pullReleased;
    await route.continue().catch(() => undefined);
  });

  try {
    await connectionStatus.click();
    await pullStarted;
    await expect(
      page.getByRole('button', { name: /^Connexion/u }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hors ligne' })).toBeVisible({
      timeout: 7_000,
    });
  } finally {
    releasePull();
  }
});

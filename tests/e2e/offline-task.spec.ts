import { expect, test } from '@playwright/test';

test('a new offline task stays pending while an older task remains shared', async ({
  context,
  page,
}) => {
  const sharedTitle = `Tâche partagée ${crypto.randomUUID()}`;
  const offlineTitle = `Tâche offline ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await expect(
    page.getByRole('heading', { name: 'Aucune tâche en cours.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tâches en cours' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  await page.getByLabel('Nouvelle tâche').fill(sharedTitle);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const sharedTask = page
    .getByRole('listitem')
    .filter({ hasText: sharedTitle });
  await expect(sharedTask).toContainText('Synchronisée avec le foyer');

  await context.setOffline(true);
  await page.getByLabel('Nouvelle tâche').fill(offlineTitle);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const offlineTask = page
    .getByRole('listitem')
    .filter({ hasText: offlineTitle });
  await expect(offlineTask).toContainText('À synchroniser');
  await expect(sharedTask).toContainText('Synchronisée avec le foyer');

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: offlineTitle }),
  ).toContainText('À synchroniser');

  await context.setOffline(false);
  await page.getByRole('button', { name: /en attente|synchronisé/iu }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: offlineTitle }),
  ).toContainText('Synchronisée avec le foyer');
  await expect(page.getByText(offlineTitle)).toHaveCount(1);
});

test('edit mode deletes a task offline without confirmation', async ({
  context,
  page,
}) => {
  const title = `Tâche à supprimer ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const task = page.getByRole('listitem').filter({ hasText: title });
  await expect(task).toContainText('Synchronisée avec le foyer');

  await page.getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByRole('button', { name: 'Terminer' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `Supprimer ${title}` }).click();

  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Hors ligne — 1 en attente/iu }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(page.getByText(title)).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: /en attente|synchronisé/iu }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('local deletion stays available while the hub request is stalled', async ({
  page,
}) => {
  const title = `Tâche pendant synchro ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

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
    await page.getByRole('button', { name: 'Synchronisé' }).click();
    await pullStarted;
    await page.getByRole('button', { name: 'Modifier' }).click();

    await expect(
      page.getByRole('button', { name: `Supprimer ${title}` }),
    ).toBeEnabled();
  } finally {
    releasePull();
  }
});

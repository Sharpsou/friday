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
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Hors ligne' })).toBeVisible();
  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  await expect(page.getByText('1 modification en attente')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(page.getByText(title)).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('a task can be finished and reopened online and offline without duplication', async ({
  context,
  page,
}) => {
  const title = `Tâche à terminer ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Synchronisée avec le foyer');

  await page.getByRole('button', { name: `Terminer ${title}` }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches terminées' }),
  ).toContainText(title);
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Synchronisée avec le foyer');

  await page.getByRole('button', { name: `Rouvrir ${title}` }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }),
  ).toContainText(title);
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Synchronisée avec le foyer');

  await context.setOffline(true);
  await page.getByRole('button', { name: `Terminer ${title}` }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches terminées' }),
  ).toContainText(title);
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('À synchroniser');

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches terminées' }),
  ).toContainText(title);

  await page.getByRole('button', { name: `Rouvrir ${title}` }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }),
  ).toContainText(title);
  await expect(
    page.getByRole('region', { name: 'Tâches terminées' }),
  ).not.toContainText(title);

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }),
  ).toContainText(title);

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Synchronisée avec le foyer');
  await expect(page.getByText(title)).toHaveCount(1);
});

test('date-only tasks and timed appointments persist offline', async ({
  context,
  page,
}) => {
  const datedTitle = `Échéance ${crypto.randomUUID()}`;
  const appointmentTitle = `Rendez-vous ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByText('Date et rendez-vous').click();

  await page.getByLabel('Nouvelle tâche').fill(datedTitle);
  await page.getByLabel('Date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const datedTask = page.getByRole('listitem').filter({ hasText: datedTitle });
  await expect(datedTask).toContainText('15 août 2026');
  await expect(datedTask).not.toContainText('à');
  await expect(datedTask).toContainText('Synchronisée avec le foyer');

  await context.setOffline(true);
  await page.getByText('Date et rendez-vous').click();
  await page.getByLabel('Nouvelle tâche').fill(appointmentTitle);
  await page.getByLabel('Date').fill('2026-08-16');
  await page.getByLabel('Heure').fill('14:30');
  await page.getByLabel('Durée').selectOption('45');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const appointment = page
    .getByRole('listitem')
    .filter({ hasText: appointmentTitle });
  await expect(appointment).toContainText('16 août 2026 à 14:30 · 45 min');
  await expect(appointment).toContainText('À synchroniser');

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: appointmentTitle }),
  ).toContainText('16 août 2026 à 14:30 · 45 min');

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: appointmentTitle }),
  ).toContainText('Synchronisée avec le foyer');
});

test('week and month views expose dated tasks and prepare quick add', async ({
  page,
}) => {
  const title = `Agenda ${crypto.randomUUID()}`;
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByText('Date et rendez-vous').click();
  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByLabel('Date').fill(today);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Agenda des tâches' });
  await expect(calendar).toContainText(title);

  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect(calendar).toContainText(title);
  await calendar.getByRole('button', { name: /Ajouter pour/u }).click();

  await expect(page.getByLabel('Date')).toBeVisible();
  await expect(page.getByLabel('Date')).toHaveValue(today);
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
  await expect(page.getByRole('button', { name: /^Connect/u })).toBeVisible();

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
    await page.getByRole('button', { name: /^Connect/u }).click();
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

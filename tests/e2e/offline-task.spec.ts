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

test('tasks stay chronological in today, list, week and month views', async ({
  page,
}) => {
  const suffix = crypto.randomUUID();
  const earlyTitle = `Chrono matin ${suffix}`;
  const lateTitle = `Chrono soir ${suffix}`;
  const tomorrowTitle = `Chrono demain ${suffix}`;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formatDate = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  const today = formatDate(now);

  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  for (const task of [
    { title: lateTitle, date: today, time: '18:00' },
    { title: tomorrowTitle, date: formatDate(tomorrow), time: '' },
    { title: earlyTitle, date: today, time: '09:00' },
  ]) {
    await page.getByText('Détails facultatifs').click();
    await page.getByLabel('Nouvelle tâche').fill(task.title);
    await page.getByLabel('Date').fill(task.date);
    if (task.time) await page.getByLabel('Heure').fill(task.time);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  }

  const homeItems = await page
    .getByRole('region', { name: 'Tâches en cours' })
    .getByRole('listitem')
    .allTextContents();
  expect(homeItems.findIndex((text) => text.includes(earlyTitle))).toBeLessThan(
    homeItems.findIndex((text) => text.includes(lateTitle)),
  );
  expect(homeItems.findIndex((text) => text.includes(lateTitle))).toBeLessThan(
    homeItems.findIndex((text) => text.includes(tomorrowTitle)),
  );

  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  const todayItems = await page
    .getByRole('region', { name: 'Tâches en cours' })
    .getByRole('listitem')
    .allTextContents();
  expect(
    todayItems.findIndex((text) => text.includes(earlyTitle)),
  ).toBeLessThan(todayItems.findIndex((text) => text.includes(lateTitle)));

  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  const weekCalendar = page.getByRole('region', { name: 'Agenda des tâches' });
  const weekText = await weekCalendar.textContent();
  expect(weekText?.indexOf(earlyTitle)).toBeLessThan(
    weekText?.indexOf(lateTitle) ?? -1,
  );

  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  const monthItems = await page
    .getByRole('region', { name: 'Agenda des tâches' })
    .getByRole('listitem')
    .allTextContents();
  expect(
    monthItems.findIndex((text) => text.includes(earlyTitle)),
  ).toBeLessThan(monthItems.findIndex((text) => text.includes(lateTitle)));
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
  await page.getByText('Détails facultatifs').click();

  await page.getByLabel('Nouvelle tâche').fill(datedTitle);
  await page.getByLabel('Date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const datedTask = page.getByRole('listitem').filter({ hasText: datedTitle });
  await expect(datedTask).toContainText('15 août 2026');
  await expect(datedTask).not.toContainText('à');
  await expect(datedTask).toContainText('Synchronisée avec le foyer');

  await context.setOffline(true);
  await page.getByText('Détails facultatifs').click();
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
  await page.getByText('Détails facultatifs').click();
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

test('responsible person persists offline and filters the agenda', async ({
  context,
  page,
}) => {
  const unassignedTitle = `Sans responsable ${crypto.randomUUID()}`;
  const assignedTitle = `Responsable moi ${crypto.randomUUID()}`;
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(unassignedTitle);
  await page.getByLabel('Date').fill(today);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await context.setOffline(true);
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(assignedTitle);
  await page.getByLabel('Date').fill(today);
  await page
    .getByRole('combobox', { name: 'Responsable', exact: true })
    .selectOption('current');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  const assignedTask = page
    .getByRole('listitem')
    .filter({ hasText: assignedTitle });
  await expect(assignedTask).toContainText('Moi');
  await expect(assignedTask).toContainText('À synchroniser');

  await page.getByLabel('Filtrer par responsable').selectOption('current');
  await expect(assignedTask).toBeVisible();
  await expect(page.getByText(unassignedTitle)).toHaveCount(0);

  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Agenda des tâches' });
  await expect(calendar).toContainText(assignedTitle);
  await expect(calendar).not.toContainText(unassignedTitle);

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: assignedTitle }),
  ).toContainText('Moi');

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: assignedTitle }),
  ).toContainText('Synchronisée avec le foyer');
});

test('optional notes and recurring tasks persist offline without duplicate occurrence', async ({
  context,
  page,
}) => {
  const recurringTitle = `Récurrence ${crypto.randomUUID()}`;
  const noteOnlyTitle = `Note seule ${crypto.randomUUID()}`;
  const now = new Date();
  const recurrenceEnd = new Date(now);
  recurrenceEnd.setDate(recurrenceEnd.getDate() + 6);
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const recurrenceEndDate = [
    recurrenceEnd.getFullYear(),
    String(recurrenceEnd.getMonth() + 1).padStart(2, '0'),
    String(recurrenceEnd.getDate()).padStart(2, '0'),
  ].join('-');

  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(noteOnlyTitle);
  await page
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('Note sans aucune date');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: noteOnlyTitle }),
  ).toContainText('Note sans aucune date');

  await context.setOffline(true);
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(recurringTitle);
  await page.getByLabel('Date').fill(today);
  await page.getByLabel('Récurrence').selectOption('custom-days');
  await page.getByLabel('Nombre de jours').fill('3');
  await page.getByLabel('Date de fin').fill(recurrenceEndDate);
  await page
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('Arroser légèrement');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  const recurringTasks = page
    .getByRole('region', { name: 'Tâches en cours' })
    .getByRole('listitem')
    .filter({ hasText: recurringTitle });
  await expect(recurringTasks).toHaveCount(3);
  await expect(recurringTasks.first()).toContainText('Tous les 3 jours');
  await expect(recurringTasks.first()).toContainText('Arroser légèrement');
  await page
    .getByRole('button', { name: `Terminer ${recurringTitle}` })
    .first()
    .click();

  await expect(
    page
      .getByRole('region', { name: 'Tâches terminées' })
      .getByRole('listitem')
      .filter({ hasText: recurringTitle }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Tâches en cours' })
      .getByRole('listitem')
      .filter({ hasText: recurringTitle })
      .first(),
  ).toContainText('Tous les 3 jours');

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(page.getByText(recurringTitle)).toHaveCount(3);

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(recurringTitle)).toHaveCount(3);
});

test('a recurring task can delete one occurrence or its whole series offline', async ({
  context,
  page,
}) => {
  const title = `Série à supprimer ${crypto.randomUUID()}`;
  const firstDate = new Date();
  const endDate = new Date(firstDate);
  endDate.setDate(endDate.getDate() + 2);
  const formatDate = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await context.setOffline(true);
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByLabel('Date').fill(formatDate(firstDate));
  await page
    .getByRole('combobox', { name: 'Récurrence', exact: true })
    .selectOption('daily');
  await page.getByLabel('Date de fin').fill(formatDate(endDate));
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await expect(page.getByText(title)).toHaveCount(3);
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page
    .getByRole('button', { name: `Supprimer ${title}` })
    .first()
    .click();
  const deletionDialog = page.getByRole('dialog', {
    name: 'Que supprimer ?',
  });
  await expect(deletionDialog).toBeVisible();
  await deletionDialog
    .getByRole('button', { name: 'Cette occurrence' })
    .click();
  await expect(page.getByText(title)).toHaveCount(2);

  await page
    .getByRole('button', { name: `Supprimer ${title}` })
    .first()
    .click();
  await deletionDialog.getByRole('button', { name: 'Toute la série' }).click();
  await expect(page.getByText(title)).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(page.getByText(title)).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('local settings rename responsible people and persist the color palette', async ({
  page,
}) => {
  const title = `Tâche Alice ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Premier responsable').fill('Alice');
  await dialog.getByLabel('Deuxième responsable').fill('Bob');
  await dialog.getByLabel('Aujourd’hui').fill('7');
  await dialog.getByLabel('Chaque liste Maison').fill('15');
  await dialog.getByLabel('Océan').check();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Nouvelle tâche').fill(title);
  await page
    .getByRole('combobox', { name: 'Responsable', exact: true })
    .selectOption({ label: 'Alice' });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Alice');
  await expect(page.getByLabel('Filtrer par responsable')).toContainText('Bob');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Alice');
  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  await expect(page.getByLabel('Aujourd’hui')).toHaveValue('7');
  await expect(page.getByLabel('Chaque liste Maison')).toHaveValue('15');
});

test('local settings limit today and home task lists', async ({ page }) => {
  await page.route('**/api/sync/pull?**', async (route) => {
    await route.fulfill({ json: { changes: [], cursor: 0 } });
  });
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();

  for (const title of ['Limite une', 'Limite deux', 'Limite trois']) {
    const taskTitle = page.getByLabel('Nouvelle tâche');
    const addButton = page.getByRole('button', {
      name: 'Ajouter',
      exact: true,
    });
    await taskTitle.fill(title);
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(taskTitle).toHaveValue('');
  }

  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByLabel('Aujourd’hui').fill('1');
  await dialog.getByLabel('Chaque liste Maison').fill('2');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }).getByRole('listitem'),
  ).toHaveCount(2);

  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }).getByRole('listitem'),
  ).toHaveCount(1);
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

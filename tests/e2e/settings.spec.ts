import { expect, test } from './fixtures';

test('local settings persist names and palette', async ({ page }) => {
  const title = `Tâche Alice ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Premier responsable').fill('Alice');
  await dialog.getByLabel('Deuxième responsable').fill('Bob');
  await dialog.getByLabel('Aujourd’hui').fill('7');
  await dialog.getByLabel('Chaque liste Agenda').fill('15');
  await dialog.getByLabel('Océan').check();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: title }),
  ).toContainText('Alice');
  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  await expect(page.getByLabel('Aujourd’hui')).toHaveValue('7');
  await expect(page.getByLabel('Chaque liste Agenda')).toHaveValue('15');
});

test('local settings limit today and agenda task lists', async ({ page }) => {
  await page.route('**/api/sync/pull?**', async (route) => {
    await route.fulfill({ json: { changes: [], cursor: 0 } });
  });
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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
  await dialog.getByLabel('Chaque liste Agenda').fill('2');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }).getByRole('listitem'),
  ).toHaveCount(2);

  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  await expect(
    page.getByRole('region', { name: 'Tâches en cours' }).getByRole('listitem'),
  ).toHaveCount(1);
});

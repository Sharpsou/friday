import { expect, test } from './fixtures';

test('controller keeps task and grocery drafts across navigation and offline transitions', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Connecté', exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', {
    name: 'Navigation principale',
  });
  await navigation.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByLabel('Nouvelle tâche').fill('Brouillon sans écriture');
  await page.getByText('Détails facultatifs').click();
  await page.getByLabel('Date', { exact: true }).fill('2026-10-15');
  await navigation.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByLabel('Ajouter un produit').fill('Brouillon courses');
  await page.getByLabel('Quantité facultative').fill('3 unités');
  await context.setOffline(true);
  await navigation.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByLabel('Nouvelle tâche')).toHaveValue(
    'Brouillon sans écriture',
  );
  const details = page
    .locator('details')
    .filter({ has: page.getByText('Détails facultatifs') });
  if ((await details.getAttribute('open')) === null)
    await page.getByText('Détails facultatifs').click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(
    '2026-10-15',
  );
  await navigation.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(page.getByLabel('Ajouter un produit')).toHaveValue(
    'Brouillon courses',
  );
  await expect(page.getByLabel('Quantité facultative')).toHaveValue('3 unités');
  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Fermer les réglages', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole('button', { name: 'Connecté', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Ajouter un produit')).toHaveValue(
    'Brouillon courses',
  );
});

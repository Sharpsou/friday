import { expect, test } from './fixtures';

test('Maison covers a two-day preparation, shopping, reserve and offline catalogue', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const suffix = Date.now().toString();
  const recipeName = `Lasagnes Maison ${suffix}`;
  const productName = `Pâtes Maison ${suffix}`;
  const today = new Date().toLocaleDateString('sv-SE');
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toLocaleDateString('sv-SE');
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await page.getByRole('button', { name: '+ Recette', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom de la recette').fill(recipeName);
  await dialog.getByLabel('Portions de référence').fill('6');
  await dialog
    .getByRole('button', { name: '+ Ingrédient', exact: true })
    .click();
  await dialog.getByLabel('Produit', { exact: true }).fill(productName);
  await dialog.getByLabel('Quantité', { exact: true }).fill('600');
  await dialog
    .getByRole('button', { name: 'Enregistrer dans les recettes du foyer' })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  await page.getByRole('button', { name: '+ Produit en réserve' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Produit', { exact: true }).fill(productName);
  await dialog.getByLabel('Quantité restante (facultative)').fill('500');
  await dialog
    .getByRole('combobox', { name: 'Unité', exact: true })
    .selectOption('g');
  await dialog.getByRole('button', { name: 'Enregistrer la réserve' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await page.getByRole('button', { name: '+ Repas', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Personnes', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: '+ Plat ou restes' }).click();
  await dialog
    .getByRole('combobox', { name: 'Recette', exact: true })
    .selectOption({ label: recipeName });
  await dialog.getByLabel('Total à préparer (portions)').fill('6');
  await dialog
    .getByRole('button', { name: 'Enregistrer le repas', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '+ Repas', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Date', { exact: true }).fill(tomorrow);
  await dialog.getByLabel('Personnes', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: '+ Plat ou restes' }).click();
  await dialog
    .getByRole('combobox', { name: 'Préparation', exact: true })
    .selectOption({ label: `${recipeName} · ${today} · 6 portions (prévu)` });
  await dialog
    .getByRole('button', { name: 'Enregistrer le repas', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Préparer / actualiser les courses' })
    .click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Manque : 100 g');
  await dialog
    .getByRole('button', { name: 'Confirmer les changements de courses' })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  const grocery = page.getByRole('listitem').filter({ hasText: productName });
  await expect(grocery).toContainText('100 g');
  await expect(grocery).toContainText('Synchronisée avec le foyer');
  await page
    .getByRole('button', {
      name: `Marquer comme acheté ${productName}`,
      exact: true,
    })
    .click();
  await expect(grocery).toContainText('Synchronisée avec le foyer');
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  await page
    .getByRole('button', { name: 'Ranger les achats', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  const purchase = dialog.getByRole('group').filter({ hasText: productName });
  for (const group of await dialog.getByRole('group').all())
    if (!(await group.textContent())?.includes(productName))
      await group.getByRole('checkbox').check();
  await purchase.getByLabel('Quantité achetée').fill('100');
  await purchase
    .getByRole('combobox', { name: 'Unité', exact: true })
    .selectOption('g');
  await dialog.getByRole('button', { name: 'Confirmer le rangement' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await page.getByRole('button', { name: 'Préparé', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Déjà mangé maintenant' })
    .selectOption({ label: `${today} · Soir` });
  await dialog
    .getByRole('button', { name: 'Confirmer les quantités et les restes' })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Mangé', exact: true }).click();
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  await expect(
    page.getByRole('article').filter({ hasText: `${recipeName} · Restes` }),
  ).toContainText('Épuisé');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await page.getByRole('button', { name: '+ Recette', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Nom de la recette')
    .fill(`Soupe hors ligne ${suffix}`);
  await dialog
    .getByRole('button', { name: 'Enregistrer dans les recettes du foyer' })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await page.getByRole('button', { name: /^Recettes/u }).click();
  await expect(
    page.getByRole('heading', {
      name: `Soupe hors ligne ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('article').filter({ hasText: `Soupe hors ligne ${suffix}` }),
  ).toContainText('Ingrédients à compléter');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'output/playwright/maison-recettes-mobile.png',
    fullPage: true,
  });
  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/sync/maison-snapshot');
      return (
        (await response.json()) as {
          records: Array<{ kind: string; name?: string }>;
        }
      ).records.some(
        (r) => r.kind === 'recipe' && r.name === `Soupe hors ligne ${suffix}`,
      );
    })
    .toBe(true);
});

import { expect, test } from './fixtures';

test('the seven destinations fit at 360px and budget data can persist or be removed', async ({
  context,
  page,
}) => {
  const label = `Dépense fictive ${crypto.randomUUID()}`;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);

  const navigation = page.getByRole('navigation', {
    name: 'Navigation principale',
  });
  await expect(navigation.getByRole('button')).toHaveText([
    'Aujourd’hui',
    'Agenda',
    'Maison',
    'Budget',
    'Chat',
    'Veille',
    'Robot',
  ]);
  await navigation.getByRole('button', { name: 'Robot' }).click();
  await expect(
    page.getByRole('region', { name: 'Robot', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Caméra indisponible')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ARRÊT' })).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Prévision mensuelle' })
      .getByRole('article'),
  ).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Ajouter rapidement' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Montant').fill('42,50');
  await dialog.getByLabel('Libellé').fill(label);
  await dialog
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click();
  await expect(page.getByText(label)).toHaveCount(1);

  await page.reload();
  await navigation.getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByText(label)).toHaveCount(1);
  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(label)).toHaveCount(1);

  const envelopes = page.getByRole('region', { name: 'Enveloppes' });
  await expect(envelopes.getByText('Ajouter une enveloppe')).not.toBeVisible();
  await envelopes.getByText('Enveloppes', { exact: true }).click();
  await envelopes.getByText('Ajouter une enveloppe', { exact: true }).click();
  await envelopes.getByLabel('Nom').fill('Enveloppe E2E supprimable');
  await envelopes.getByLabel('Allocation mensuelle').fill('75');
  await envelopes.getByRole('button', { name: 'Créer', exact: true }).click();
  const removableEnvelope = envelopes
    .getByRole('listitem')
    .filter({ hasText: 'Enveloppe E2E supprimable' });
  await expect(removableEnvelope).toBeVisible();
  await removableEnvelope.getByText('Modifier', { exact: true }).click();
  await removableEnvelope.getByLabel('Nom').fill('Enveloppe E2E modifiée');
  await removableEnvelope.getByLabel('Allocation mensuelle').fill('90');
  await removableEnvelope
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  const modifiedEnvelope = envelopes
    .getByRole('listitem')
    .filter({ hasText: 'Enveloppe E2E modifiée' });
  await expect(modifiedEnvelope).toContainText('90,00 €');
  const envelopeModifyBox = await modifiedEnvelope
    .getByText('Modifier', { exact: true })
    .boundingBox();
  const envelopeDeleteBox = await modifiedEnvelope
    .getByRole('button', {
      name: 'Supprimer l’enveloppe Enveloppe E2E modifiée',
    })
    .boundingBox();
  expect(
    Math.abs(
      envelopeModifyBox!.y +
        envelopeModifyBox!.height / 2 -
        (envelopeDeleteBox!.y + envelopeDeleteBox!.height / 2),
    ),
  ).toBeLessThan(3);
  await modifiedEnvelope
    .getByRole('button', {
      name: 'Supprimer l’enveloppe Enveloppe E2E modifiée',
    })
    .click();
  await expect(modifiedEnvelope).toHaveCount(0);

  const recurring = page.getByRole('region', { name: 'Revenus et frais' });
  await expect(
    recurring.getByText('Ajouter un revenu ou frais'),
  ).not.toBeVisible();
  await recurring.getByText('Revenus et frais', { exact: true }).click();
  const movementSetup = recurring
    .locator('details')
    .filter({ hasText: 'Ajouter un revenu ou frais' });
  await movementSetup.getByText('Ajouter un revenu ou frais').click();
  const manualIncomeLabel = `Revenu supprimable ${crypto.randomUUID()}`;
  await movementSetup.getByLabel('Type').selectOption('income');
  await movementSetup.getByLabel('Libellé').fill(manualIncomeLabel);
  await movementSetup.getByLabel('Montant').fill('125');
  await movementSetup.getByLabel('Fréquence').selectOption('once');
  await movementSetup
    .getByRole('button', { name: 'Créer le mouvement' })
    .click();
  const movements = page.getByRole('region', { name: 'Mouvements récents' });
  const manualIncome = movements
    .getByRole('listitem')
    .filter({ hasText: manualIncomeLabel });
  await expect(manualIncome).toBeVisible();
  await manualIncome.getByRole('button', { name: 'Supprimer' }).click();
  await expect(manualIncome).toHaveCount(0);

  const recurringExpenseLabel = `Frais récurrent ${crypto.randomUUID()}`;
  await movementSetup.getByLabel('Type').selectOption('expense');
  await movementSetup.getByLabel('Libellé').fill(recurringExpenseLabel);
  await movementSetup.getByLabel('Montant').fill('20');
  await movementSetup.getByLabel('Fréquence').selectOption('monthly');
  await movementSetup.getByRole('button', { name: 'Créer la série' }).click();
  const recurringTemplate = recurring
    .getByRole('listitem')
    .filter({ hasText: recurringExpenseLabel });
  const recurringActionBoxes = await Promise.all(
    [
      recurringTemplate.getByText('Modifier', { exact: true }),
      recurringTemplate.getByRole('button', { name: 'Suspendre' }),
      recurringTemplate.getByRole('button', { name: 'Supprimer' }),
    ].map((action) => action.boundingBox()),
  );
  const recurringActionCenters = recurringActionBoxes.map(
    (box) => box!.y + box!.height / 2,
  );
  expect(
    Math.max(...recurringActionCenters) - Math.min(...recurringActionCenters),
  ).toBeLessThan(3);
  const recurringExpense = movements
    .getByRole('listitem')
    .filter({ hasText: recurringExpenseLabel });
  await expect(recurringExpense).toBeVisible();
  await recurringExpense.getByRole('button', { name: 'Supprimer' }).click();
  const deletionDialog = page.getByRole('dialog', {
    name: 'Que supprimer ?',
  });
  await expect(deletionDialog).toContainText(
    'Les mouvements déjà comptabilisés restent dans l’historique.',
  );
  await deletionDialog
    .getByRole('button', {
      name: 'Cette occurrence et arrêter la série',
    })
    .click();
  await expect(recurringExpense).toHaveCount(0);
  await expect(recurring.getByText(recurringExpenseLabel)).toHaveCount(0);

  await movements.getByText('Mouvements récents', { exact: true }).click();
  await expect(movements.getByText(label)).not.toBeVisible();
  await movements.getByText('Mouvements récents', { exact: true }).click();
  await expect(movements.getByText(label)).toBeVisible();
  await envelopes.getByText('Enveloppes', { exact: true }).click();
  await recurring.getByText('Revenus et frais', { exact: true }).click();
  await expect(envelopes.getByText('Ajouter une enveloppe')).not.toBeVisible();
  await expect(
    recurring.getByText('Ajouter un revenu ou frais'),
  ).not.toBeVisible();
  if (process.env.FRIDAY_VISUAL_CAPTURE === '1') {
    await page.screenshot({
      path: 'output/playwright/budget-compact-360.png',
      fullPage: true,
    });
  }
});

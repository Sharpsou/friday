import { expect, test } from './fixtures';

test('the owner pairs the second adult with a one-time code', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const settings = page.getByRole('dialog', { name: 'Réglages' });
  await settings
    .getByRole('button', { name: 'Ajouter le second adulte' })
    .click();
  const code = (
    await settings.locator('.pairing-code strong').textContent()
  )?.trim();
  expect(code).toMatch(/^\d{8}$/u);

  const secondContext = await browser.newContext({
    viewport: { width: 412, height: 915 },
  });
  try {
    const secondDeviceId = '51c048d0-17c7-4c43-8706-1727d16f2bd7';
    await secondContext.addInitScript((deviceId) => {
      const randomUuid = crypto.randomUUID.bind(crypto);
      let deviceIdentityGenerated = false;
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => {
          if (!deviceIdentityGenerated) {
            deviceIdentityGenerated = true;
            return deviceId;
          }
          return randomUuid();
        },
      });
    }, secondDeviceId);
    const secondPage = await secondContext.newPage();
    await secondPage.goto(page.url());
    await secondPage.getByRole('button', { name: 'J’ai un code' }).click();
    await secondPage.getByLabel('Code à 8 chiffres').fill(code ?? '');
    await secondPage.getByLabel('Prénom ou nom').fill('Adulte 2');
    await secondPage.getByLabel('Identifiant Friday').fill('adulte2');
    await secondPage.getByLabel('Phrase secrète').fill('autre-phrase-secrete');
    await secondPage.getByLabel('Nom de cet appareil').fill('iPhone de test');
    await secondPage
      .getByRole('button', { name: 'Appairer cet appareil' })
      .click();

    await expect(
      secondPage.getByRole('button', { name: 'Agenda', exact: true }),
    ).toBeVisible();
    await secondPage
      .getByRole('button', { name: 'Agenda', exact: true })
      .click();
    await secondPage
      .getByLabel('Nouvelle tâche')
      .fill('Tâche du second adulte');
    await secondPage
      .getByRole('button', { name: 'Ajouter', exact: true })
      .click();
    await expect(
      secondPage
        .getByRole('listitem')
        .filter({ hasText: 'Tâche du second adulte' }),
    ).toContainText('Synchronisée avec le foyer');
    await secondPage
      .getByRole('button', { name: 'Ouvrir les réglages' })
      .click();
    await expect(
      secondPage.getByRole('dialog', { name: 'Réglages' }),
    ).toContainText('Connecté comme Adulte 2');
  } finally {
    await secondContext.close();
  }

  await settings.getByRole('button', { name: 'Fermer les réglages' }).click();
  await page.getByRole('button', { name: 'Ouvrir les réglages' }).click();
  const secondDevice = settings
    .getByRole('listitem')
    .filter({ hasText: 'iPhone de test' });
  await secondDevice.getByRole('button', { name: 'Révoquer' }).click();
  await settings
    .getByRole('button', { name: 'Oublier le second adulte' })
    .click();
  await expect(settings).toContainText(
    'Les données partagées et les tâches attribuées au second adulte restent conservées.',
  );
  await settings.getByRole('button', { name: 'Confirmer l’oubli' }).click();
  await expect(settings).toContainText('Second adulte oublié.');
  await expect(
    settings.getByRole('button', { name: 'Ajouter le second adulte' }),
  ).toBeVisible();
});

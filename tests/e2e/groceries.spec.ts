import { expect, test } from './fixtures';

test('shared groceries persist through an offline purchase cycle', async ({
  context,
  page,
}) => {
  const label = `Lait ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const navigation = page.getByRole('navigation', {
    name: 'Navigation principale',
  });
  await expect(navigation.getByRole('button')).toHaveCount(7);
  await expect(
    navigation.getByRole('button', { name: 'Agenda', exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole('button', { name: 'Courses', exact: true }),
  ).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Maison', exact: true }).click();
  const groceriesRegion = page.getByRole('region', {
    name: 'Courses',
    exact: true,
  });
  await expect(groceriesRegion).toBeVisible();
  await expect(
    groceriesRegion.getByText('Liste partagée', { exact: true }),
  ).toHaveCount(0);
  await expect(
    groceriesRegion.getByRole('heading', { name: 'Courses' }),
  ).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveAccessibleName('Ajouter rapidement');

  await page.getByLabel('Ajouter un produit').fill(label);
  await page.getByLabel('Quantité facultative').fill('2 bouteilles');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const item = page.getByRole('listitem').filter({ hasText: label });
  await expect(item).toContainText('2 bouteilles');
  await expect(item).toContainText('Synchronisée avec le foyer');

  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  const grocerySummary = page.getByRole('region', { name: 'Courses' });
  await expect(grocerySummary).toContainText('1 produit à acheter');
  await expect(grocerySummary).toContainText(label);
  await grocerySummary.getByRole('button', { name: 'Voir la liste' }).click();

  await context.setOffline(true);
  await page
    .getByRole('button', { name: `Marquer comme acheté ${label}` })
    .click();
  await expect(item).toContainText('À synchroniser');
  await expect(
    page.getByRole('heading', { name: 'Déjà acheté' }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('À synchroniser');

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('Synchronisée avec le foyer');
});

test('edit mode keeps grocery delete visible and changes its aisle offline', async ({
  context,
  page,
}) => {
  const label = `Produit à modifier ${crypto.randomUUID()}`;
  const updatedLabel = `Peinture mate ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByLabel('Ajouter un produit').fill(label);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Supprimer ${label}` }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `Modifier ${label}` }).click();
  const dialog = page.getByRole('dialog', { name: `Modifier ${label}` });
  await dialog.getByLabel('Produit').fill(updatedLabel);
  await dialog.getByLabel('Quantité').fill('2 pots');
  await dialog.getByLabel('Rayon').selectOption('diy-garden:paint');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  const updatedItem = page
    .getByRole('listitem')
    .filter({ hasText: updatedLabel });
  await expect(
    page.getByRole('heading', { name: 'Peinture et droguerie' }),
  ).toBeVisible();
  await expect(updatedItem).toContainText('2 pots');
  await expect(updatedItem).toContainText('À synchroniser');
  await expect(
    page.getByRole('button', { name: `Supprimer ${updatedLabel}` }),
  ).toBeVisible();

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(updatedItem).toContainText('Synchronisée avec le foyer');
  await page.getByRole('button', { name: `Supprimer ${updatedLabel}` }).click();
  await expect(page.getByText(updatedLabel)).toHaveCount(0);
});

test('shopping mode keeps only the grouped checklist and works offline', async ({
  context,
  page,
}) => {
  const label = `Pommes magasin ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByLabel('Ajouter un produit').fill(label);
  await page.getByLabel('Quantité facultative').fill('1 kg');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('Synchronisée avec le foyer');

  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await page.getByRole('button', { name: `Modifier ${label}` }).click();
  const editor = page.getByRole('dialog', { name: `Modifier ${label}` });
  await editor.getByLabel('Rayon').selectOption('supermarket:produce');
  await editor.getByRole('button', { name: 'Enregistrer' }).click();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'En course' }).click();
  const shoppingMode = page.getByRole('dialog', { name: 'En course' });
  await expect(shoppingMode).toContainText('Fruits et légumes');
  await expect(shoppingMode).toContainText('1 kg');
  await expect(
    page.getByRole('navigation', { name: 'Navigation principale' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Ouvrir les réglages' }),
  ).toHaveCount(0);

  await shoppingMode.getByRole('button', { name: `Prendre ${label}` }).click();
  await expect(shoppingMode).toContainText('Courses terminées');
  await shoppingMode.getByRole('button', { name: 'Revenir à Friday' }).click();
  await expect(
    page.getByRole('heading', { name: 'Déjà acheté' }),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('À synchroniser');

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await page.getByRole('button', { name: `Supprimer ${label}` }).click();
  await expect(page.getByText(label)).toHaveCount(0);
});

test('a photographed list is reviewed once, corrected and imported without classification', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  let classificationRequests = 0;
  let photoRequests = 0;
  const photoRequestReleases: Array<() => void> = [];
  await page.route('**/api/groceries/photo-transcription', async (route) => {
    const requestIndex = photoRequests;
    photoRequests += 1;
    await new Promise<void>((resolve) => {
      photoRequestReleases[requestIndex] = resolve;
    });
    await route
      .fulfill({
        json: {
          items: [
            {
              box: { x: 80, y: 100, width: 300, height: 45 },
              sourceText: 'oeufs',
              label: 'oeufs',
              quantityText: null,
            },
            {
              box: { x: 560, y: 30, width: 310, height: 50 },
              sourceText: 'fleur de sel x2',
              label: 'fleur de sel',
              quantityText: 'x2',
            },
          ],
        },
      })
      .catch(() => undefined);
  });
  await page.route(
    '**/api/groceries/classification-proposals',
    async (route) => {
      classificationRequests += 1;
      await route.abort();
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  const initialGroceryCount = Number(
    await page.locator('.topbar-context-actions .count-badge').textContent(),
  );
  expect(initialGroceryCount).toBeGreaterThanOrEqual(0);
  await expect(
    page.locator('.grocery-classification-toolbar .page-actions'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Photo', exact: true }),
  ).toBeEnabled();
  const cameraInput = page.getByLabel('Photo prise avec l’appareil photo');
  const galleryInput = page.getByLabel('Photo choisie dans la galerie');
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
  await expect(galleryInput).not.toHaveAttribute('capture');
  const actionBoxes = await Promise.all(
    ['En course', 'Photo', 'Classer par rayon'].map((name) =>
      page.getByRole('button', { name, exact: true }).boundingBox(),
    ),
  );
  expect(actionBoxes.every((box) => box !== null)).toBe(true);
  expect(
    Math.max(...actionBoxes.map((box) => box?.y ?? 0)) -
      Math.min(...actionBoxes.map((box) => box?.y ?? 0)),
  ).toBeLessThan(2);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Prendre une photo' }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Choisir dans la galerie' }),
  ).toBeVisible();
  const testPhoto = {
    name: 'liste.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="white"/><text x="40" y="80" fill="black">oeufs</text></svg>',
    ),
  };
  await galleryInput.setInputFiles(testPhoto);

  await expect.poll(() => photoRequests).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Analyse…', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda' })).toBeVisible();
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByRole('button', { name: 'Analyse…', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Analyse en cours' });
  await expect(dialog).toContainText('Friday lit la liste sur le PC');
  await dialog.getByRole('button', { name: 'Annuler l’analyse' }).click();
  photoRequestReleases[0]?.();
  await expect(
    page.getByRole('button', { name: 'Photo', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await galleryInput.setInputFiles(testPhoto);
  await expect.poll(() => photoRequests).toBe(2);
  await expect(
    page.getByRole('button', { name: 'Analyse…', exact: true }),
  ).toBeVisible();
  photoRequestReleases[1]?.();
  await expect(
    page.getByRole('button', { name: 'Photo prête', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Photo prête', exact: true }).click();

  dialog = page.getByRole('dialog', { name: 'Vérifier la photo' });
  await expect(
    dialog.getByAltText('Liste de courses photographiée'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Modifier oeufs' }),
  ).toBeVisible();
  await dialog.getByLabel('Produit 1').fill('Œufs plein air');
  await dialog.getByRole('button', { name: 'Ajouter les produits' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'À classer', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Œufs plein air' }),
  ).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'fleur de sel' }),
  ).toContainText('x2');
  await expect(
    page.locator('.topbar').getByRole('button', { name: 'Modifier' }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const count = await page
        .locator('.topbar-context-actions .count-badge')
        .textContent();
      return Number(count ?? '0');
    })
    .toBeGreaterThanOrEqual(initialGroceryCount + 2);
  const topbarBoxes = await Promise.all([
    page.locator('.topbar h1').boundingBox(),
    page.locator('.topbar-context-actions .count-badge').boundingBox(),
    page
      .locator('.topbar')
      .getByRole('button', { name: 'Modifier' })
      .boundingBox(),
    page.locator('.topbar .status-pill').boundingBox(),
    page.locator('.topbar .settings-button').boundingBox(),
  ]);
  expect(topbarBoxes.every((box) => box !== null)).toBe(true);
  for (let index = 1; index < topbarBoxes.length; index += 1) {
    const previous = topbarBoxes[index - 1];
    const current = topbarBoxes[index];
    expect((previous?.x ?? 0) + (previous?.width ?? 0)).toBeLessThanOrEqual(
      (current?.x ?? 0) + 1,
    );
  }
  expect(
    (topbarBoxes.at(-1)?.x ?? 0) + (topbarBoxes.at(-1)?.width ?? 0),
  ).toBeLessThanOrEqual(360);
  expect(classificationRequests).toBe(0);
});

test('grocery classification stays visible in background and can be stopped', async ({
  page,
}) => {
  const label = `Produit fond ${crypto.randomUUID()}`;
  const jobId = '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const job = (status: 'running' | 'cancelling' | 'cancelled') => ({
    id: jobId,
    taxonomyId: 'retail-fr-v1',
    status,
    progress: { completed: status === 'running' ? 1 : 0, total: 12 },
    proposal: null,
    error: null,
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:01.000Z',
    expiresAt: status === 'cancelled' ? '2026-08-10T12:00:00.000Z' : null,
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByLabel('Ajouter un produit').fill(label);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('Synchronisée avec le foyer');

  await page.route(
    '**/api/groceries/classification-proposals**',
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/cancel')) {
        await route.fulfill({ json: job('cancelled') });
        return;
      }
      await route.fulfill({ json: job('running') });
    },
  );

  await page.getByRole('button', { name: 'Classer par rayon' }).click();
  await expect(page.getByText(/Classement en arrière-plan/u)).toBeVisible();

  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByText(/Classement en arrière-plan/u)).toBeVisible();
  await page.getByRole('button', { name: 'Arrêter' }).click();
  await expect(page.getByText('Classement interrompu')).toBeVisible();
});

test('a corrected aisle proposal is applied in the single grouped list', async ({
  page,
}) => {
  const label = `Croquettes Nouchka ${crypto.randomUUID()}`;
  const jobId = '5a72afdd-bd91-4c53-a2b1-af342922896a';
  let groceryItemId = '';
  let applied = false;
  let applyRequests = 0;
  let appliedClassification: Record<string, unknown> | null = null;
  page.on('request', (request) => {
    if (!request.url().includes('/api/sync/push')) return;
    const payload = request.postDataJSON() as {
      operations?: Array<{
        entityType: string;
        entityId: string;
        payload: { label?: string };
      }>;
    };
    const groceryOperation = payload.operations?.find(
      (operation) =>
        operation.entityType === 'grocery_item' &&
        operation.payload.label === label,
    );
    if (groceryOperation) groceryItemId = groceryOperation.entityId;
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Maison', exact: true }).click();
  await page.getByLabel('Ajouter un produit').fill(label);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toContainText('Synchronisée avec le foyer');
  expect(groceryItemId).not.toBe('');
  await expect(
    page.getByRole('button', { name: 'Rayons', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'À classer', exact: true }),
  ).toBeVisible();

  await page.route(
    '**/api/groceries/classifications?after=*',
    async (route) => {
      await route.fulfill({
        json: {
          cursor: applied ? 1 : 0,
          changes:
            applied && appliedClassification
              ? [{ cursor: 1, classification: appliedClassification }]
              : [],
        },
      });
    },
  );
  await page.route('**/api/groceries/classifications/apply', async (route) => {
    applyRequests += 1;
    const request = route.request().postDataJSON() as {
      classifications: Array<{
        aisleId: string;
        itemId: string;
        storeFamilyId: string;
      }>;
    };
    const choice = request.classifications[0];
    if (!choice) throw new Error('Classement appliqué absent.');
    appliedClassification = {
      itemId: choice.itemId,
      storeFamilyId: choice.storeFamilyId,
      aisleId: choice.aisleId,
      taxonomyId: 'retail-fr-v1',
      source: 'manual',
      confidence: 1,
      itemRevision: 1,
      labelFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 1,
      updatedAt: '2026-08-09T12:02:00.000Z',
      updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
    };
    applied = true;
    await route.fulfill({
      json: {
        classifications: [appliedClassification],
        skippedItemIds: [],
        cursor: 1,
      },
    });
  });
  await page.route(
    '**/api/groceries/classification-proposals',
    async (route) => {
      await route.fulfill({
        json: {
          id: jobId,
          taxonomyId: 'retail-fr-v1',
          status: 'completed',
          progress: { completed: 1, total: 1 },
          proposal: [
            {
              itemId: groceryItemId,
              label,
              groceryRevision: 1,
              labelFingerprint:
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              storeFamilyId: 'pet-store',
              aisleId: 'food',
              confidence: 0.82,
              source: 'llm',
              expectedClassificationRevision: null,
            },
          ],
          error: null,
          createdAt: '2026-08-09T12:00:00.000Z',
          updatedAt: '2026-08-09T12:01:00.000Z',
          expiresAt: '2026-08-10T12:01:00.000Z',
        },
      });
    },
  );

  await page.getByRole('button', { name: 'Classer par rayon' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vérifier les rayons' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Conserver le classement actuel' })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(applyRequests).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Classer par rayon' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Classer par rayon' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Type de magasin').selectOption('supermarket');
  await dialog.getByLabel('Rayon').selectOption('pets');
  await dialog.getByRole('button', { name: 'Appliquer' }).click();
  expect(applyRequests).toBe(1);

  await expect(page.getByRole('heading', { name: 'Animaux' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: label }),
  ).toBeVisible();
});

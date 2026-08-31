import { expect, test } from '@playwright/test';

const E2E_OWNER_DEVICE_ID = '5945057a-0b59-4d3b-814f-9581be697098';
const E2E_OWNER_IDENTIFIER = 'adulte1';
const E2E_OWNER_PASSWORD = 'phrase-secrete-friday';

test.beforeEach(async ({ page }) => {
  const state = await page.request.get('/api/auth/state');
  const statePayload = (await state.json()) as { bootstrapRequired: boolean };
  const bootstrapRequired = statePayload.bootstrapRequired;
  const response = await page.request.post(
    bootstrapRequired ? '/api/auth/bootstrap' : '/api/auth/login',
    {
      data: bootstrapRequired
        ? {
            deviceId: E2E_OWNER_DEVICE_ID,
            deviceName: 'Chrome mobile de test',
            identifier: E2E_OWNER_IDENTIFIER,
            name: 'Adulte 1',
            password: E2E_OWNER_PASSWORD,
          }
        : {
            deviceId: E2E_OWNER_DEVICE_ID,
            deviceName: 'Chrome mobile de test',
            identifier: E2E_OWNER_IDENTIFIER,
            password: E2E_OWNER_PASSWORD,
          },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  await page.addInitScript((deviceId) => {
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
  }, E2E_OWNER_DEVICE_ID);
});

test('the private Watch digest is readable offline and keeps article feedback', async ({
  context,
  page,
}) => {
  const watchId = '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const articleId = '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const sourceId = '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const digestId = '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const articleTitle =
    '人工知能モデル更新情報SansEspacesTresLonguePourVerifierLeRetourALaLigneMobile';
  let articleState = 'unread';
  let watchCadence: 'daily' | 'weekly' = 'daily';
  let watchLocalTime = '07:30';
  let watchWeekday: number | null = null;
  let watchRunStage: 'extracting' | 'completed' = 'extracting';
  let referenceReady = false;
  let nextDigestAt = '2026-08-13T05:30:00.000Z';
  let scheduleUpdate: Record<string, unknown> | null = null;
  let sourceAddRequest: Record<string, unknown> | null = null;
  const discoveredSourceId = '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const discoveryId = '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const watchSources = [
    {
      id: sourceId,
      title: 'Source vérifiée',
      siteUrl: 'https://example.com/',
      feedUrl: 'https://example.com/feed.xml',
      lastFetchedAt: '2026-08-12T09:00:00.000Z' as string | null,
      lastError: null as string | null,
    },
  ];
  const overview = () => ({
    watches: [
      {
        id: watchId,
        name: 'IA locale',
        question: 'Quelles nouveautés ?',
        includeKeywords: ['IA'],
        excludeKeywords: [],
        concepts: ['IA'],
        languages: ['fr', 'en'],
        cadence: watchCadence,
        localTime: watchLocalTime,
        weekday: watchWeekday,
        timeZone: 'Europe/Paris',
        status: 'active',
        sources: watchSources,
        nextDigestAt,
        createdAt: '2026-08-12T08:00:00.000Z',
        updatedAt: '2026-08-12T09:00:00.000Z',
      },
    ],
    articles: [
      {
        id: articleId,
        watchId,
        sourceId,
        sourceTitle: 'Source vérifiée',
        title: articleTitle,
        url: 'https://example.com/article',
        publishedAt: '2026-08-12T08:30:00.000Z',
        collectedAt: '2026-08-12T09:00:00.000Z',
        excerpt: 'Extrait',
        summary: 'Résumé factuel de la nouveauté.',
        relevanceReason: 'Correspond au thème IA.',
        novelty: 'new',
        relevant: true,
        baseline: false,
        state: articleState,
      },
    ],
    digests: referenceReady
      ? []
      : [
          {
            id: digestId,
            watchId,
            title: '1 nouveauté · IA locale',
            summary: 'Résumé factuel de la nouveauté.',
            articleIds: [articleId],
            newCount: 1,
            createdAt: '2026-08-12T09:00:00.000Z',
          },
        ],
    concepts: [
      {
        id: '31bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        watchId,
        label: 'IA',
        state: 'tracked',
        origin: 'user',
        articleCount: 1,
        firstSeenAt: '2026-08-12T08:00:00.000Z',
        lastSeenAt: '2026-08-12T09:00:00.000Z',
      },
    ],
    topics: [
      {
        id: '21bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        watchId,
        title: 'IA locale et modèles compacts',
        summary: 'Résumé factuel de la nouveauté.',
        eventKind: 'new_topic',
        importance: 0.8,
        articleIds: [articleId],
        conceptIds: ['31bc3ea7-e269-46b3-9ac7-1c8cb7b310bb'],
        firstSeenAt: '2026-08-12T09:00:00.000Z',
        lastSeenAt: '2026-08-12T09:00:00.000Z',
      },
    ],
    runs: [
      {
        id: '11bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        watchId,
        trigger: 'manual',
        stage: watchRunStage,
        current: watchRunStage === 'completed' ? 30 : 7,
        total: 30,
        error: null,
        updatedAt: '2026-08-12T09:02:00.000Z',
      },
    ],
    unreadRelevantCount: articleState === 'unread' ? 1 : 0,
  });
  await page.route('**/api/watch/**', async (route) => {
    if (route.request().url().endsWith('/api/watch/discover')) {
      return route.fulfill({
        json: {
          id: discoveryId,
          concepts: Array.from(
            { length: 20 },
            (_, index) => `Concept ${index}`,
          ),
          themes: [
            {
              title: 'Modèles locaux',
              summary: 'Modèles exécutés localement.',
            },
            { title: 'Agents IA', summary: 'Agents et automatisation.' },
            { title: 'Outils data', summary: 'Outils de data science.' },
            { title: 'Robotique', summary: 'Robotique et systèmes embarqués.' },
            { title: 'Fiabilité', summary: 'Sécurité et gouvernance.' },
          ],
          candidates: [
            {
              id: discoveredSourceId,
              title: 'Nouvelle source spécialisée',
              siteUrl: 'https://source.example/',
              feedUrl: 'https://source.example/feed.xml',
              kind: 'specialized_press',
              language: 'fr',
              score: 0.9,
              reason: 'Source spécialisée validée.',
              status: 'validated',
            },
          ],
          examinedCount: 1,
          validatedCount: 1,
          creditsUsed: 1,
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      });
    }
    if (route.request().url().endsWith('/sources/discovered')) {
      sourceAddRequest = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      watchSources.push({
        id: 'a1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        title: 'Nouvelle source spécialisée',
        siteUrl: 'https://source.example/',
        feedUrl: 'https://source.example/feed.xml',
        lastFetchedAt: null,
        lastError: null,
      });
      return route.fulfill({
        json: { addedCount: 1, watch: overview().watches[0] },
      });
    }
    if (route.request().method() === 'PATCH') {
      scheduleUpdate = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      watchCadence = scheduleUpdate.cadence as 'daily' | 'weekly';
      watchLocalTime = scheduleUpdate.localTime as string;
      watchWeekday = scheduleUpdate.weekday as number | null;
      nextDigestAt = '2026-08-19T06:15:00.000Z';
      return route.fulfill({ json: overview().watches[0] });
    }
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { state: string };
      articleState = body.state;
      return route.fulfill({ json: overview().articles[0] });
    }
    return route.fulfill({ json: overview() });
  });
  await page.route('**/api/inference/status', (route) =>
    route.fulfill({
      json: {
        active: {
          kind: 'watch',
          startedAt: '2026-08-12T09:02:00.000Z',
        },
        queued: { watch: 1 },
      },
    }),
  );

  await page.goto('/');
  await expect(page.getByText('IA occupée par la Veille')).toBeVisible();
  await expect(page.getByText('1 traitement Veille en attente')).toBeVisible();
  await expect(page.getByText('Actualisation de la veille')).toBeVisible();
  await expect(page.getByText(/Analyse des articles · 7\/30/u)).toBeVisible();
  await page.getByRole('button', { name: 'Veille', exact: true }).click();
  const watchRegion = page.getByRole('region', { name: 'Veille' });
  await expect(watchRegion).toBeVisible();
  await expect(watchRegion.getByText('Personnel', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    watchRegion.getByRole('heading', { name: 'Veille' }),
  ).toHaveCount(0);
  await expect(page.getByText(/Prochaine mise à jour/u)).toBeVisible();
  const createWatchButton = page.locator('.fab');
  await expect(createWatchButton).toHaveAccessibleName('Créer une veille');
  await createWatchButton.click();
  await expect(page.locator('.watch-form')).toBeVisible();
  await page.locator('.watch-form button[type="button"]').click();
  await page.getByRole('button', { name: /IA locale/u }).click();
  await expect(page.getByText('Actualisation en cours')).toBeVisible();
  await expect(page.getByText(/7\/30/u)).toBeVisible();
  watchRunStage = 'completed';
  referenceReady = true;
  articleState = 'read';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Actualisation en cours')).not.toBeVisible({
    timeout: 5_000,
  });
  await expect(
    page.getByRole('button', { name: 'Retour aux veilles' }),
  ).toBeVisible();
  await expect(page.locator('.watch-topic h4')).toHaveText(
    'IA locale et modèles compacts',
  );
  await page.getByRole('button', { name: 'Retour aux veilles' }).click();
  await expect(page.getByText(/Terminé · 30\/30/u)).toBeVisible();
  await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
  await expect(page.getByText('1 thème suivi')).toBeVisible();
  await expect(page.getByText(/Référence constituée/u)).toBeVisible();
  await page
    .locator('.watch-today-alert')
    .getByRole('button', { name: 'Ouvrir' })
    .click();
  await expect(page.getByRole('button', { name: /IA locale/u })).toBeVisible();
  await page.getByRole('button', { name: /IA locale/u }).click();
  await page.locator('.watch-settings-panel > summary').click();
  await page.getByLabel('Récurrence', { exact: true }).selectOption('weekly');
  await page.getByLabel('Jour', { exact: true }).selectOption('3');
  await page.getByLabel('Heure de mise à jour', { exact: true }).fill('08:15');
  await page
    .getByRole('button', { name: 'Enregistrer la planification' })
    .click();
  await expect
    .poll(() => scheduleUpdate)
    .toEqual({
      cadence: 'weekly',
      localTime: '08:15',
      weekday: 3,
    });
  await expect(page.locator('.watch-settings-panel > summary')).toContainText(
    '19 août 2026, 08:15',
  );
  await page
    .getByRole('button', { name: 'Rechercher d’autres sources' })
    .click();
  await expect(page.getByText('Nouvelle source spécialisée')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter les sources' }).click();
  await expect
    .poll(() => sourceAddRequest)
    .toEqual({
      discoveryId,
      candidateIds: [discoveredSourceId],
    });
  await expect(page.getByText('1 source ajoutée.')).toBeVisible();
  await expect(page.getByText('Nouvelle source spécialisée')).toBeVisible();
  await page.locator('.watch-topic summary').click();
  await expect(page.getByRole('link', { name: articleTitle })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.watch-topic')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.locator('.watch-topic .watch-actions button').nth(2).click();
  await expect(
    page.locator('.watch-topic .watch-actions button').nth(2),
  ).toHaveClass(/is-active/u);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('1 thème suivi')).toBeVisible();
  await expect(page.getByText(/Référence constituée/u)).toBeVisible();
  await page.getByRole('button', { name: 'Veille', exact: true }).click();
  await page.getByRole('button', { name: /IA locale/u }).click();
  await page.locator('.watch-topic summary').click();
  await expect(page.getByRole('link', { name: articleTitle })).toBeVisible();
  await expect(
    page.locator('.watch-topic .watch-actions button').nth(2),
  ).toHaveClass(/is-active/u);
  await context.setOffline(false);
});

test('the gated Chat keeps its historical archive and disables offline sending', async ({
  context,
  page,
}) => {
  const conversationId = '31bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const messageId = '21bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const conversation = {
    id: conversationId,
    title: 'Conversation historique sourcée',
    archivedAt: null,
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  };
  await page.route('**/api/assistant/conversations', (route) =>
    route.fulfill({ json: { conversations: [conversation] } }),
  );
  await page.route(
    `**/api/assistant/conversations/${conversationId}/messages`,
    (route) =>
      route.fulfill({
        json: {
          conversation,
          messages: [
            {
              id: messageId,
              conversationId,
              role: 'assistant',
              content: 'Cette réponse historique cite sa preuve [S1].',
              sources: [
                {
                  id: 'S1',
                  title: 'Source historique affichée',
                  url: 'https://example.com/archive-source',
                  domain: 'example.com',
                  publishedAt: '2026-08-09T08:00:00.000Z',
                  retrievedAt: '2026-08-10T09:00:00.000Z',
                },
              ],
              createdAt: '2026-08-10T12:00:00.000Z',
            },
          ],
        },
      }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Archive du Chat', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Personnel', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Chat' })).toHaveCount(0);
  await expect(
    page.getByText('Nouveau Chat prêt, activation en attente'),
  ).toBeVisible();
  await page
    .getByText('Archive historique en lecture seule', { exact: true })
    .click();
  const citation = page.getByRole('link', { name: 'S1', exact: true });
  await expect(citation).toHaveAttribute(
    'href',
    `#assistant-source-${messageId}-S1`,
  );
  await citation.click();
  const displayedSource = page.locator(`#assistant-source-${messageId}-S1`);
  await expect(displayedSource).toBeVisible();
  await expect(
    displayedSource.getByRole('link', {
      name: '[S1] Source historique affichée',
    }),
  ).toHaveAttribute('href', 'https://example.com/archive-source');
  await expect(displayedSource).toContainText('example.com · Publié le');
  await expect(page.getByLabel('Votre message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Envoyer' })).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page
    .getByText('Archive historique en lecture seule', { exact: true })
    .click();
  await expect(page.locator(`#assistant-source-${messageId}-S1`)).toBeVisible();
  const offlineSend = page.getByRole('button', { name: 'Envoyer' });
  if ((await offlineSend.count()) > 0) await expect(offlineSend).toBeDisabled();
  await context.setOffline(false);
});

test('the active Chat creates, switches mode and deletes from the mobile UI', async ({
  page,
}) => {
  const firstId = '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const secondId = '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const now = '2026-08-31T12:00:00.000Z';
  let conversations = [
    {
      id: firstId,
      title: 'Question déjà titrée',
      mode: 'friday',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await page.route('**/api/chat/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/chat/web-usage')
      return route.fulfill({
        json: {
          month: '2026-08',
          creditsUsed: 50,
          remainingSearches: 450,
          source: 'tavily',
          hardLimit: 950,
        },
      });
    if (url.pathname === '/api/chat/conversations') {
      if (request.method() === 'POST') {
        const created = {
          id: secondId,
          title: 'Nouvelle conversation',
          mode: 'friday',
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        conversations = [created, ...conversations];
        return route.fulfill({ status: 201, json: created });
      }
      return route.fulfill({ json: { conversations } });
    }
    const id = url.pathname.split('/')[4];
    const conversation = conversations.find((item) => item.id === id);
    if (url.pathname.endsWith('/messages'))
      return route.fulfill({ json: { conversation, messages: [] } });
    if (request.method() === 'PATCH' && conversation) {
      const update = request.postDataJSON() as { mode?: string };
      Object.assign(conversation, update);
      return route.fulfill({ json: conversation });
    }
    if (request.method() === 'DELETE') {
      conversations = conversations.filter((item) => item.id !== id);
      return route.fulfill({ json: { deleted: true } });
    }
    return route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('Web · 450 recherches restantes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Friday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Local' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await expect(page.getByText('Nouvelle conversation')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Supprimer la conversation' }).click();
  await expect(page.getByText('Nouvelle conversation')).toHaveCount(0);
});

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
    'Courses',
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

test('the real camera and physical actuator switches stay usable at 360px', async ({
  page,
}) => {
  let lastDriveDirection: string | null = null;
  let lastDriveIntensity: number | null = null;
  let lastDriveSteering: number | null = null;
  let lastCameraTilt: number | null = null;
  let recognitionVisible = true;
  let steeringTrimPercent = 0;
  let panoramaPulseMs = 220;
  let mappingStatus: 'inactive' | 'paused' | 'recording' = 'inactive';
  let robotState = {
    powerState: 'awake' as 'awake' | 'sleeping',
    available: true,
    connected: true,
    armed: false,
    mode: 'alphabot2' as const,
    cameraAvailable: true,
    actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    moving: false,
    lastSeenAt: '2026-08-24T00:00:00.000Z',
    warning: null,
    capabilities: [
      'teleop',
      'camera_look',
      'camera_stream',
      'vision_objects',
      'vision_people',
      'visual_topology',
      'topological_autonomy',
      'network_standby',
    ],
    operatingMode: 'manual' as 'autonomous' | 'manual',
    controlExpiresAt: null as string | null,
    cameraPose: { pan: 0, tilt: 0 },
    telemetry: {
      temperatureC: 47,
      throttledCode: '0x0',
      underVoltageActive: false,
      underVoltageOccurred: false,
      irLeftClear: true,
      irRightClear: true,
      lineSensors: [700, 720, 900, 850, 910],
      cameraFps: 10,
      commandLatencyMs: null,
    },
    vision: {
      frameId: 1,
      observedAt: '2026-08-24T00:00:00.000Z',
      expiresAt: '2026-08-24T00:00:02.000Z',
      imageWidth: 640,
      imageHeight: 480,
      processingMs: 28,
      detections: [
        {
          id: '1-0-object',
          kind: 'object' as const,
          label: 'Lit',
          confidence: 0.59,
          x: 0.1,
          y: 0.2,
          width: 0.5,
          height: 0.4,
          trackId: null,
        },
      ],
    },
  };
  const robotMap = () => ({
    version: 3,
    operatingMode: robotState.operatingMode,
    mapping: {
      status: mappingStatus,
      sessionId:
        mappingStatus === 'inactive'
          ? null
          : '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
      startedAt:
        mappingStatus === 'inactive' ? null : '2026-08-25T00:00:00.000Z',
      pointCount: mappingStatus === 'inactive' ? 0 : 2,
      storageBytes: mappingStatus === 'inactive' ? 0 : 192,
      quotaBytes: 262_144_000,
    },
    localization: {
      status: 'estimated' as const,
      confidence: 0.9,
      source: 'odometry' as const,
      correctionRevision: 0,
      lastRelocalizedAt: null,
      visualRecognitionAvailable: true,
      pose: {
        x: 0.4,
        y: 0.2,
        heading: 0.1,
        uncertainty: 0.3,
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    },
    localizationEvents: [],
    paths: [],
    objects: [
      {
        id: '70c7847d-e8eb-4e42-bab4-d553338138c3',
        displayName: 'Lit',
        classLabel: 'bed',
        x: 0.8,
        y: 0.4,
        uncertainty: 1.2,
        confidence: 0.91,
        sightingCount: 5,
        viewpointCount: 3,
        keyframeId: null,
        lastSeenAt: '2026-08-25T00:00:00.000Z',
      },
    ],
    viewpoints: [
      {
        id: '785a3690-4fb0-41f0-b34d-1cbf9bc5d417',
        x: 0.4,
        y: 0.2,
        heading: 0.1,
        pan: 0.5,
        tilt: 0.2,
        observationCount: 2,
        hasKeyframe: false,
        lastSeenAt: '2026-08-25T00:00:00.000Z',
      },
    ],
    visualMemory: {
      keyframeCount: 0,
      storageBytes: 0,
      quotaBytes: 16_777_216,
      signatureCount: 0,
      signatureStorageBytes: 0,
      signatureQuotaBytes: 12_582_912,
    },
    autonomy: {
      available: true,
      blockedReason: null,
    },
  });
  let humanRecovery: {
    commandCount: number;
    startedAt: string;
  } | null = null;
  const robotAutonomy = () => ({
    status: humanRecovery
      ? ('recovering' as const)
      : robotState.operatingMode === 'autonomous'
        ? ('exploring' as const)
        : ('inactive' as const),
    runId:
      robotState.operatingMode === 'autonomous'
        ? 'a89af9e6-4f63-4c4e-9bc5-585fce269f85'
        : null,
    startedAt:
      robotState.operatingMode === 'autonomous'
        ? '2026-08-25T00:00:00.000Z'
        : null,
    updatedAt: '2026-08-25T00:00:00.000Z',
    currentPlaceId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
    targetPlaceId: null,
    action: null,
    availableActions: [],
    confidence: 0,
    speedPercent: 0,
    reward: null,
    reason: 'Observation visuelle.',
    learningStepCount: 0,
    imageUsable: true,
    motionState: 'stationary' as const,
    blockReason: null,
    informationGain: 0,
    localizationConfidence: 0.91,
    habitConfidence: 0,
    humanRecovery,
  });
  const robotGraph = () => ({
    version: 4,
    currentPlaceId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
    places: [
      {
        id: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        status: 'confirmed' as const,
        label: 'Salon',
        confidence: 0.91,
        viewCount: 1,
        objectCount: 1,
        panoramaStatus: 'complete' as const,
        canonicalSectorId: '2b8912c0-836d-4fe8-9600-632cf5f1c531',
        firstSeenAt: '2026-08-25T00:00:00.000Z',
        lastSeenAt: '2026-08-25T00:10:00.000Z',
      },
    ],
    views: [
      {
        id: '785a3690-4fb0-41f0-b34d-1cbf9bc5d417',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        observedAt: '2026-08-25T00:10:00.000Z',
        pan: 0,
        tilt: 0.2,
        quality: 120,
        hasImage: false,
      },
    ],
    sectors: [
      {
        id: '2b8912c0-836d-4fe8-9600-632cf5f1c531',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        ordinal: 0,
        quality: 120,
        observedAt: '2026-08-25T00:10:00.000Z',
        isCanonical: true,
      },
    ],
    ports: [],
    transitions: [],
    objects: [
      {
        id: '8bf07ebd-9e1b-45f7-b95b-d771049ea365',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        classLabel: 'lampe',
        displayName: 'Lampe bureau',
        confidence: 0.93,
        sightingCount: 8,
        lastSeenAt: '2026-08-25T00:10:00.000Z',
      },
    ],
    storage: {
      imageBytes: 0,
      imageQuotaBytes: 33_554_432,
      descriptorBytes: 1_600,
      descriptorQuotaBytes: 8_388_608,
    },
  });
  const robotMemory = {
    roomName: 'Salon',
    entities: [
      {
        id: '8bf07ebd-9e1b-45f7-b95b-d771049ea365',
        kind: 'object' as const,
        classLabel: 'lampe',
        displayName: 'Lampe bureau',
        roomName: 'Salon',
        confidence: 0.93,
        status: 'confirmed' as const,
        sightingCount: 8,
        firstSeenAt: '2026-08-25T00:00:00.000Z',
        lastSeenAt: '2026-08-25T00:10:00.000Z',
        lastPosition: { x: 0.4, y: 0.3 },
      },
      {
        id: '6d8daa69-e13c-4a64-9ca2-5987f5a441a7',
        kind: 'object' as const,
        classLabel: 'chaise',
        displayName: 'Chaise possible',
        roomName: 'Salon',
        confidence: 0.61,
        status: 'candidate' as const,
        sightingCount: 1,
        firstSeenAt: '2026-08-25T00:11:00.000Z',
        lastSeenAt: '2026-08-25T00:11:00.000Z',
        lastPosition: { x: 0.6, y: 0.4 },
      },
    ],
    anonymousPresence: { active: false, lastSeenAt: null },
    mapping: { enabled: true, status: 'observer' as const },
    learning: {
      mode: 'online' as const,
      policyStatus: 'candidate' as const,
      episodeCount: 12,
    },
  };
  await page.route('**/api/robot/state', async (route) =>
    route.fulfill({ json: robotState }),
  );
  await page.route('**/api/robot/graph', async (route) =>
    route.fulfill({ json: robotGraph() }),
  );
  await page.route('**/api/robot/autonomy', async (route) =>
    route.fulfill({ json: robotAutonomy() }),
  );
  await page.route('**/api/robot/display-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        recognitionVisible: boolean;
      };
      recognitionVisible = body.recognitionVisible;
    }
    await route.fulfill({
      json: {
        recognitionVisible,
        updatedAt: '2026-08-26T12:00:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/control-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        steeringTrimPercent?: number;
      };
      if (body.steeringTrimPercent !== undefined)
        steeringTrimPercent = body.steeringTrimPercent;
    }
    await route.fulfill({
      json: {
        steeringTrimPercent,
        updatedAt:
          steeringTrimPercent === 0 ? null : '2026-08-26T13:30:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/panorama-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        panoramaPulseMs: number;
      };
      panoramaPulseMs = body.panoramaPulseMs;
    }
    await route.fulfill({
      json: {
        panoramaPulseMs,
        updatedAt: panoramaPulseMs === 220 ? null : '2026-08-26T13:31:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/memory', async (route) =>
    route.fulfill({ json: robotMemory }),
  );
  await page.route('**/api/robot/autonomy/start', async (route) => {
    robotState = { ...robotState, operatingMode: 'autonomous' };
    humanRecovery = null;
    mappingStatus = 'recording';
    await route.fulfill({
      json: {
        accepted: true,
        state: robotState,
        graph: robotGraph(),
        autonomy: robotAutonomy(),
      },
    });
  });
  await page.route('**/api/robot/autonomy/recovery/start', async (route) => {
    robotState = { ...robotState, operatingMode: 'manual', moving: false };
    humanRecovery = {
      commandCount: 0,
      startedAt: '2026-08-25T00:00:00.000Z',
    };
    await route.fulfill({
      json: {
        accepted: true,
        state: robotState,
        graph: robotGraph(),
        autonomy: robotAutonomy(),
      },
    });
  });
  await page.route('**/api/robot/mapping/*', async (route) => {
    const action = route.request().url().split('/').at(-1);
    mappingStatus =
      action === 'pause'
        ? 'paused'
        : action === 'stop'
          ? 'inactive'
          : 'recording';
    await route.fulfill({ json: { accepted: true, map: robotMap() } });
  });
  await page.route('**/api/robot/actuators', async (route) => {
    const actuators = route
      .request()
      .postDataJSON() as typeof robotState.actuators;
    robotState = { ...robotState, armed: actuators.wheelsEnabled, actuators };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/arm', async (route) => {
    robotState = {
      ...robotState,
      armed: true,
      controlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/drive', async (route) => {
    const command = route.request().postDataJSON() as {
      direction: string;
      intensity: number;
      steering: number;
    };
    lastDriveDirection = command.direction;
    lastDriveIntensity = command.intensity;
    lastDriveSteering = command.steering;
    robotState = { ...robotState, moving: true };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/stop', async (route) => {
    robotState = {
      ...robotState,
      moving: false,
      controlExpiresAt: null,
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/halt', async (route) => {
    robotState = { ...robotState, moving: false };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/camera/look', async (route) => {
    const command = route.request().postDataJSON() as {
      pan: number;
      tilt: number;
    };
    lastCameraTilt = command.tilt;
    robotState = {
      ...robotState,
      cameraPose: { pan: command.pan, tilt: command.tilt },
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/power/*', async (route) => {
    const sleeping = route.request().url().endsWith('/sleep');
    robotState = {
      ...robotState,
      powerState: sleeping ? 'sleeping' : 'awake',
      available: !sleeping,
      cameraAvailable: !sleeping,
      armed: false,
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
      moving: false,
      operatingMode: 'manual',
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/camera/stream', async (route) =>
    route.fulfill({
      contentType: 'image/gif',
      body: Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        'base64',
      ),
    }),
  );

  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'Robot' })
    .click();

  const camera = page.getByRole('img', { name: 'Vue en direct du robot' });
  await expect(camera).toBeVisible();
  const cameraFrameBox = await page.locator('.robot-camera').boundingBox();
  expect(cameraFrameBox!.width / cameraFrameBox!.height).toBeCloseTo(4 / 3, 1);
  const recognition = page.getByRole('button', { name: 'Reco affichée' });
  await expect(recognition).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.robot-box', { hasText: 'Lit' })).toBeVisible();
  await recognition.click();
  await expect(
    page.getByRole('button', { name: 'Reco masquée' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.robot-box')).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', {
      name: /Objets|Personnes|Identités|Repères|Sécurité/,
    }),
  ).toHaveCount(0);
  await expect(page.getByText('SIMULATION', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Robot' })).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Mode du robot' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manuel' })).toBeEnabled();
  await expect(page.getByText(/Repères visuels · 1 lieux/u)).toBeVisible();
  await page.getByRole('button', { name: 'Repères' }).click();
  await expect(
    page.getByRole('heading', { name: 'La carte du robot' }),
  ).toBeVisible();
  await expect(page.getByText('Lampe bureau')).toBeVisible();
  await expect(page.getByText('Vue privée ou non conservée')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Mettre en veille' }).click();
  await expect(
    page.getByRole('heading', { name: 'Robot en veille réseau' }),
  ).toBeVisible();
  await expect(camera).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Repères' })).toBeEnabled();
  await page.getByRole('button', { name: 'Réveiller' }).click();
  await expect(camera).toBeVisible();
  const wheels = page.getByRole('switch', { name: 'Roues' });
  const cameraServos = page.getByRole('switch', { name: 'Caméra' });
  await expect(wheels).not.toBeChecked();
  await expect(cameraServos).not.toBeChecked();
  await cameraServos.click();
  await expect(cameraServos).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Caméra gauche' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Caméra centrer' }).click();
  await expect.poll(() => lastCameraTilt).toBe(0.2);
  await page.getByRole('button', { name: 'Caméra gauche' }).click();
  await page.getByRole('button', { name: 'Caméra centrer' }).click();
  await wheels.click();
  await expect(wheels).toBeChecked();
  await expect(page.getByRole('button', { name: 'Armer 60 s' })).toHaveCount(0);
  const power = page.getByRole('slider', { name: 'Puissance moteurs' });
  await expect(power).toHaveValue('20');
  await power.fill('35');
  await expect(power).toHaveValue('35');
  const joystick = page.getByRole('button', { name: 'Joystick locomotion' });
  await expect(joystick).toBeEnabled();
  const joystickBox = await joystick.boundingBox();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width - 10,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveIntensity).toBe(0.35);
  await expect.poll(() => lastDriveSteering).toBeGreaterThan(0.15);
  expect(lastDriveSteering).toBeLessThan(0.4);
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveSteering).toBe(0);
  await page.mouse.up();
  const trim = page.getByRole('slider', { name: 'Trim direction' });
  await expect(trim).toHaveValue('0');
  await trim.fill('-5');
  await expect(trim).toHaveValue('-5');
  await expect(page.getByText('-5', { exact: true })).toBeVisible();
  await expect.poll(() => steeringTrimPercent).toBe(-5);
  const panoramaPulse = page.getByLabel('Durée impulsion panorama 360 degrés');
  await expect(panoramaPulse).toHaveValue('220');
  await panoramaPulse.fill('340');
  await expect.poll(() => panoramaPulseMs).toBe(340);
  lastDriveDirection = null;
  lastDriveSteering = null;
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveSteering).toBe(-0.05);
  await page.mouse.up();
  lastDriveDirection = null;
  lastDriveSteering = null;
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width - 10,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await expect.poll(() => lastDriveDirection).toBe('right');
  await expect.poll(() => lastDriveSteering).toBe(0);
  await page.mouse.up();
  expect(
    await camera.evaluate((image) => getComputedStyle(image).opacity),
  ).toBe('1');
  await page.getByRole('button', { name: 'Autonome' }).click();
  await expect(page.getByRole('button', { name: 'Récup' })).toBeVisible();
  await page.getByRole('button', { name: 'Récup' }).click();
  await expect(
    page.getByRole('button', { name: 'Rendre la main' }),
  ).toBeVisible();
  await expect(page.getByText(/recovering/u)).toBeVisible();
  if (process.env.FRIDAY_VISUAL_CAPTURE === '1') {
    await page.screenshot({
      path: 'output/playwright/robot-compact-360.png',
      fullPage: true,
    });
  }
});

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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByText(title)).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('edit mode keeps delete visible and edits a task offline', async ({
  context,
  page,
}) => {
  const title = `Tâche à modifier ${crypto.randomUUID()}`;
  const updatedTitle = `Tâche modifiée ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByLabel('Nouvelle tâche').fill(title);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Supprimer ${title}` }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `Modifier ${title}` }).click();
  const dialog = page.getByRole('dialog', { name: `Modifier ${title}` });
  await dialog.getByLabel('Titre').fill(updatedTitle);
  await dialog.getByLabel('Date').fill('2026-08-21');
  await dialog.getByLabel('Heure').fill('09:15');
  await dialog.getByLabel('Durée').selectOption('30');
  await dialog.getByLabel('Note').fill('Modification hors ligne');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  const updatedTask = page
    .getByRole('listitem')
    .filter({ hasText: updatedTitle });
  await expect(updatedTask).toContainText('21 août 2026 à 09:15 · 30 min');
  await expect(updatedTask).toContainText('Modification hors ligne');
  await expect(updatedTask).toContainText('À synchroniser');
  await expect(
    page.getByRole('button', { name: `Supprimer ${updatedTitle}` }),
  ).toBeVisible();

  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(updatedTask).toContainText('Synchronisée avec le foyer');
  await page.getByRole('button', { name: `Supprimer ${updatedTitle}` }).click();
  await expect(page.getByText(updatedTitle)).toHaveCount(0);
});

test('a task can be finished and reopened online and offline without duplication', async ({
  context,
  page,
}) => {
  const title = `Tâche à terminer ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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

  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const agendaRegion = page.getByRole('region', {
    name: 'Agenda',
    exact: true,
  });
  await expect(agendaRegion).toBeVisible();
  await expect(
    agendaRegion.getByText('Planification', { exact: true }),
  ).toHaveCount(0);
  await expect(
    agendaRegion.getByRole('heading', { name: 'Agenda' }),
  ).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveAccessibleName('Ajouter rapidement');
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();

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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByText(title)).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: /Connecté|Hors ligne/u }).click();
  await expect(page.getByRole('button', { name: 'Connecté' })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

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
    navigation.getByRole('button', { name: 'Maison', exact: true }),
  ).toHaveCount(0);
  await navigation
    .getByRole('button', { name: 'Courses', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
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

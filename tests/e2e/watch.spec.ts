import { expect, test } from './fixtures';

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

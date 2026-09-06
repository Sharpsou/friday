import { expect, test } from './fixtures';

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
  await page.route('**/api/chat/conversations', (route) =>
    route.fulfill({ status: 503, json: { error: 'chat_disabled' } }),
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
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  const historicalDeleteDialog = page.getByRole('dialog', {
    name: 'Supprimer définitivement ?',
  });
  await expect(historicalDeleteDialog).toContainText(
    'Conversation historique sourcée',
  );
  await historicalDeleteDialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByLabel('Votre message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Envoyer' })).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveCount(0);

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
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

test('the active Chat creates, switches mode, renames and deletes from the mobile UI', async ({
  page,
}) => {
  const firstId = '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const secondId = '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const messageId = 'a1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const runId = 'b1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const now = '2026-08-31T12:00:00.000Z';
  const messages = new Map<string, Array<Record<string, unknown>>>();
  const createdModes: string[] = [];
  let runReads = 0;
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
        const { mode = 'friday' } = request.postDataJSON() as {
          mode?: string;
        };
        createdModes.push(mode);
        const created = {
          id: secondId,
          title: 'Nouvelle conversation',
          mode,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        conversations = [created, ...conversations];
        messages.set(created.id, []);
        return route.fulfill({ status: 201, json: created });
      }
      return route.fulfill({ json: { conversations } });
    }
    const id = url.pathname.split('/')[4];
    const conversation = conversations.find((item) => item.id === id);
    if (url.pathname.endsWith('/active-run'))
      return route.fulfill({ json: { run: null } });
    if (url.pathname.endsWith('/messages')) {
      if (request.method() === 'POST' && conversation) {
        const { content } = request.postDataJSON() as { content: string };
        conversation.title = content;
        messages.set(conversation.id, [
          {
            id: messageId,
            conversationId: conversation.id,
            role: 'user',
            content,
            answerStatus: null,
            route: null,
            sources: [],
            createdAt: now,
          },
        ]);
        return route.fulfill({ status: 202, json: { runId } });
      }
      return route.fulfill({
        json: {
          conversation,
          messages: messages.get(id ?? '') ?? [],
        },
      });
    }
    if (url.pathname === `/api/chat/runs/${runId}`) {
      runReads += 1;
      const completed = runReads >= 3;
      return route.fulfill({
        json: {
          id: runId,
          conversationId: secondId,
          status: completed ? 'completed' : 'running',
          stage: completed ? 'completed' : 'research',
          route: completed ? 'local_unverified' : null,
          requestedMode: 'friday',
          retrievalMode: 'none',
          errorCode: null,
          axisCount: 0,
          requiredAxisCount: 0,
          coveredAxisCount: 0,
          rejectedUnitCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
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
  await expect(page.getByText('Web · 450 restantes')).toBeVisible();
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
  await page.getByLabel('Votre message').fill('Quel est le rôle de Friday ?');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Friday travaille')).toBeVisible();
  await expect(page.getByText('Recherche', { exact: true })).toBeVisible();
  await expect(page.getByText('Friday travaille')).toHaveCount(0, {
    timeout: 5_000,
  });
  await expect(
    page
      .getByRole('navigation', { name: 'Nouvelles conversations' })
      .getByText('Quel est le rôle de Friday ?'),
  ).toBeVisible();
  await page.getByLabel('Actions pour Quel est le rôle de Friday ?').click();
  await page.getByRole('button', { name: 'Renommer' }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Renommer' });
  await renameDialog.getByLabel('Titre').fill('Conversation renommée');
  await renameDialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Conversation renommée')).toBeVisible();
  await page.getByLabel('Actions pour Conversation renommée').click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', {
    name: 'Supprimer définitivement ?',
  });
  await expect(deleteDialog).toContainText('Conversation renommée');
  await deleteDialog
    .getByRole('button', { name: 'Supprimer la conversation' })
    .click();
  await expect(page.getByText('Conversation renommée')).toHaveCount(0);

  await page.getByLabel('Actions pour Question déjà titrée').click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Supprimer définitivement ?' })
    .getByRole('button', { name: 'Supprimer la conversation' })
    .click();
  await expect(
    page.getByText('Choisissez un mode, puis écrivez votre premier message.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Nouvelle conversation' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Local' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Recherche Web' }).click();
  await expect(
    page.getByRole('button', { name: 'Recherche Web' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByLabel('Votre message')
    .fill('Recherche depuis une liste entièrement vide');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect.poll(() => createdModes.at(-1)).toBe('web');
  await expect(
    page.getByRole('button', { name: 'Recherche Web' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('an in-progress follow-up is restored and visible inside the conversation', async ({
  page,
}) => {
  const conversationId = '21bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const runId = '31bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const now = '2026-09-01T12:00:00.000Z';
  let runReads = 0;
  const run = (completed: boolean) => ({
    id: runId,
    conversationId,
    status: completed ? 'completed' : 'running',
    stage: completed ? 'completed' : 'auditing',
    route: completed ? 'web_verified' : null,
    requestedMode: 'web',
    retrievalMode: completed ? 'hybrid' : 'none',
    errorCode: null,
    axisCount: 2,
    requiredAxisCount: 2,
    coveredAxisCount: completed ? 2 : 0,
    rejectedUnitCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const conversation = {
    id: conversationId,
    title: 'Découvertes de Webb',
    mode: 'web',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const messages = () => [
    {
      id: '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId,
      role: 'user',
      content: 'Quelles sont les découvertes de Webb ?',
      answerStatus: null,
      route: null,
      sources: [],
      createdAt: now,
    },
    {
      id: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId,
      role: 'assistant',
      content: 'Première réponse.',
      answerStatus: 'verified',
      route: 'web_verified',
      sources: [],
      createdAt: now,
    },
    {
      id: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId,
      role: 'user',
      content: 'Et en 2026 ?',
      answerStatus: null,
      route: null,
      sources: [],
      createdAt: now,
    },
    ...(runReads >= 5
      ? [
          {
            id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
            conversationId,
            role: 'assistant',
            content: 'Réponse de suivi.',
            answerStatus: 'verified',
            route: 'web_verified',
            sources: [],
            createdAt: now,
          },
        ]
      : []),
  ];
  await page.route('**/api/chat/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/chat/web-usage')
      return route.fulfill({
        json: {
          month: '2026-09',
          creditsUsed: 10,
          remainingSearches: 470,
          source: 'tavily',
          hardLimit: 950,
        },
      });
    if (url.pathname === '/api/chat/conversations')
      return route.fulfill({ json: { conversations: [conversation] } });
    if (url.pathname.endsWith('/messages'))
      return route.fulfill({
        json: { conversation, messages: messages() },
      });
    if (url.pathname.endsWith('/active-run'))
      return route.fulfill({ json: { run: run(false) } });
    if (url.pathname === `/api/chat/runs/${runId}`) {
      runReads += 1;
      return route.fulfill({ json: run(runReads >= 5) });
    }
    return route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('Et en 2026 ?')).toBeVisible();
  const progress = page.getByRole('status').filter({
    hasText: 'Friday travaille',
  });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Vérification');
  await expect(progress).toBeInViewport();
  await expect(page.getByText('Réponse de suivi.')).toBeVisible({
    timeout: 8_000,
  });
});

test('a follow-up is shown immediately while the Hub accepts it', async ({
  page,
}) => {
  const conversationId = '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const runId = '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
  const now = '2026-09-01T13:00:00.000Z';
  let accepted = false;
  let completed = false;
  const conversation = {
    id: conversationId,
    title: 'Imprimantes 3D',
    mode: 'web',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const messages = () => [
    {
      id: 'a1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId,
      role: 'user',
      content: 'Compare des imprimantes 3D.',
      answerStatus: null,
      route: null,
      sources: [],
      createdAt: now,
    },
    {
      id: 'b1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId,
      role: 'assistant',
      content: 'Première réponse.',
      answerStatus: 'verified',
      route: 'web_verified',
      sources: [],
      createdAt: now,
    },
    ...(accepted
      ? [
          {
            id: 'c1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
            conversationId,
            role: 'user',
            content: 'Donne-moi des modèles précis.',
            answerStatus: null,
            route: null,
            sources: [],
            createdAt: now,
          },
        ]
      : []),
    ...(completed
      ? [
          {
            id: 'd1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
            conversationId,
            role: 'assistant',
            content: 'Voici des modèles précis.',
            answerStatus: 'verified',
            route: 'web_verified',
            sources: [],
            createdAt: now,
          },
        ]
      : []),
  ];

  await page.route('**/api/chat/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/chat/web-usage')
      return route.fulfill({
        json: {
          month: '2026-09',
          creditsUsed: 10,
          remainingSearches: 470,
          source: 'tavily',
          hardLimit: 950,
        },
      });
    if (url.pathname === '/api/chat/conversations')
      return route.fulfill({ json: { conversations: [conversation] } });
    if (url.pathname.endsWith('/active-run'))
      return route.fulfill({ json: { run: null } });
    if (url.pathname.endsWith('/messages')) {
      if (request.method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        accepted = true;
        return route.fulfill({ status: 202, json: { runId } });
      }
      return route.fulfill({
        json: { conversation, messages: messages() },
      });
    }
    if (url.pathname === `/api/chat/runs/${runId}`) {
      completed = true;
      return route.fulfill({
        json: {
          id: runId,
          conversationId,
          status: 'completed',
          stage: 'completed',
          route: 'web_verified',
          requestedMode: 'web',
          retrievalMode: 'hybrid',
          errorCode: null,
          axisCount: 2,
          requiredAxisCount: 2,
          coveredAxisCount: 2,
          rejectedUnitCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    return route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('Première réponse.')).toBeVisible();
  await page.getByLabel('Votre message').fill('Donne-moi des modèles précis.');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Vous · envoi en cours')).toBeVisible({
    timeout: 500,
  });
  await expect(page.getByText('Donne-moi des modèles précis.')).toBeVisible({
    timeout: 500,
  });
  await expect(page.getByText('Friday travaille')).toBeVisible({
    timeout: 500,
  });
  await expect(page.getByText('Voici des modèles précis.')).toBeVisible({
    timeout: 5_000,
  });
});

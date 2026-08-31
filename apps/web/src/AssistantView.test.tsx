import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatAnswerStatus } from './AssistantView.js';

describe('ChatAnswerStatus', () => {
  it.each([
    ['verified', 'Vérifié par des sources'],
    ['partial', 'Réponse partielle'],
    ['abstained', 'Abstention'],
    ['audit_error', 'Vérification impossible'],
    ['unverified', 'Non vérifié par des sources'],
  ] as const)('renders %s explicitly', (status, label) => {
    expect(
      renderToStaticMarkup(<ChatAnswerStatus status={status} />),
    ).toContain(label);
  });
});

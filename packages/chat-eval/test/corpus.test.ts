import { describe, expect, it } from 'vitest';

import { CorpusSchema } from '../src/contracts.js';

describe('frozen corpus contract', () => {
  it('refuses a draft or a validation corpus with the wrong split size', () => {
    expect(() =>
      CorpusSchema.parse({
        version: 'chat-foundation-v1',
        frozen: false,
        cases: [],
      }),
    ).toThrow();
  });
});

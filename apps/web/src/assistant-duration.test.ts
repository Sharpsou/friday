import { describe, expect, it } from 'vitest';

import type { AssistantMessage } from '@friday/contracts';

import {
  formatResponseDuration,
  responseDurations,
} from './assistant-duration.js';

function message(
  id: string,
  role: 'user' | 'assistant',
  createdAt: string,
): AssistantMessage {
  return {
    id,
    conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
    role,
    content: id,
    requestedMode: role === 'user' ? 'auto' : null,
    effectiveMode: role === 'assistant' ? 'web' : null,
    runId: null,
    sources: [],
    createdAt,
  };
}

describe('assistant response duration', () => {
  it('measures each complete exchange from user message to assistant answer', () => {
    const durations = responseDurations([
      message('user-1', 'user', '2026-08-10T07:11:50.000Z'),
      message('assistant-1', 'assistant', '2026-08-10T07:22:44.000Z'),
      message('user-2', 'user', '2026-08-10T08:00:00.000Z'),
      message('assistant-2', 'assistant', '2026-08-10T08:00:12.000Z'),
    ]);

    expect(formatResponseDuration(durations.get('assistant-1') ?? -1)).toBe(
      '10 min 54 s',
    );
    expect(formatResponseDuration(durations.get('assistant-2') ?? -1)).toBe(
      '12 s',
    );
  });

  it('does not assign a duration to an unanswered user message', () => {
    const durations = responseDurations([
      message('user-1', 'user', '2026-08-10T08:00:00.000Z'),
    ]);

    expect(durations.size).toBe(0);
    expect(formatResponseDuration(400)).toBe('< 1 s');
    expect(formatResponseDuration(3_725_000)).toBe('1 h 02 min');
  });
});

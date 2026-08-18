import { describe, expect, it } from 'vitest';

import type { AssistantMessage, AssistantRunEvent } from '@friday/contracts';

import {
  formatResponseDuration,
  processingDuration,
  processingOffsets,
  responseDurations,
} from './assistant-duration.js';

function runEvent(
  sequence: number,
  status: AssistantRunEvent['status'],
  createdAt: string,
): AssistantRunEvent {
  return {
    sequence,
    runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
    status,
    label: status,
    createdAt,
  };
}

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
    mode: role === 'assistant' ? 'web_light' : 'local',
    model: 'gemma4',
    thinkingPolicy: 'auto',
    thinkingUsed: false,
    researchOutcome: role === 'assistant' ? 'completed' : 'not_needed',
    creditsUsed: role === 'assistant' ? 1 : 0,
    runId: null,
    sources: [],
    progressEvents: [],
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

  it('excludes queueing and a pause before retry from effective processing time', () => {
    const events = [
      runEvent(1, 'queued', '2026-08-10T08:00:00.000Z'),
      runEvent(2, 'preparing', '2026-08-10T08:10:00.000Z'),
      runEvent(3, 'writing', '2026-08-10T08:11:00.000Z'),
      runEvent(4, 'cancelled', '2026-08-10T08:13:00.000Z'),
      runEvent(5, 'queued', '2026-08-10T09:00:00.000Z'),
      runEvent(6, 'preparing', '2026-08-10T09:05:00.000Z'),
      runEvent(7, 'completed', '2026-08-10T09:09:00.000Z'),
    ];

    expect(processingDuration(events)).toBe(7 * 60_000);
    expect(processingOffsets(events)).toEqual([
      0,
      0,
      60_000,
      3 * 60_000,
      3 * 60_000,
      3 * 60_000,
      7 * 60_000,
    ]);
  });

  it('uses persisted processing events for a completed response duration', () => {
    const user = message('user', 'user', '2026-08-10T08:00:00.000Z');
    const assistant = message(
      'assistant',
      'assistant',
      '2026-08-10T09:09:00.000Z',
    );
    assistant.progressEvents = [
      runEvent(1, 'queued', '2026-08-10T08:00:00.000Z'),
      runEvent(2, 'writing', '2026-08-10T09:00:00.000Z'),
      runEvent(3, 'completed', '2026-08-10T09:09:00.000Z'),
    ];

    expect(responseDurations([user, assistant]).get(assistant.id)).toBe(
      9 * 60_000,
    );
  });
});

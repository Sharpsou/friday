import type {
  AssistantMessage,
  AssistantRunEvent,
  AssistantRunStatus,
} from '@friday/contracts';

const PROCESSING_STATUSES = new Set<AssistantRunStatus>([
  'preparing',
  'searching',
  'reading',
  'verifying',
  'writing',
  'cancel_requested',
]);

export function processingOffsets(events: AssistantRunEvent[]): number[] {
  const offsets: number[] = [];
  let duration = 0;
  for (const [index, event] of events.entries()) {
    const previous = events[index - 1];
    if (previous && PROCESSING_STATUSES.has(previous.status)) {
      const elapsed =
        Date.parse(event.createdAt) - Date.parse(previous.createdAt);
      if (Number.isFinite(elapsed)) duration += Math.max(0, elapsed);
    }
    offsets.push(duration);
  }
  return offsets;
}

export function processingDuration(
  events: AssistantRunEvent[],
  now?: number,
): number {
  if (events.length === 0) return 0;
  const duration = processingOffsets(events).at(-1) ?? 0;
  const last = events.at(-1);
  if (!last || now === undefined || !PROCESSING_STATUSES.has(last.status))
    return duration;
  const activeElapsed = now - Date.parse(last.createdAt);
  return (
    duration + (Number.isFinite(activeElapsed) ? Math.max(0, activeElapsed) : 0)
  );
}

export function responseDurations(
  messages: AssistantMessage[],
): Map<string, number> {
  const durations = new Map<string, number>();
  let userStartedAt: number | null = null;

  for (const message of messages) {
    const createdAt = Date.parse(message.createdAt);
    if (!Number.isFinite(createdAt)) continue;
    if (message.role === 'user') {
      userStartedAt = createdAt;
    } else if (userStartedAt !== null) {
      durations.set(
        message.id,
        message.progressEvents.length > 0
          ? processingDuration(message.progressEvents)
          : Math.max(0, createdAt - userStartedAt),
      );
      userStartedAt = null;
    }
  }

  return durations;
}

export function formatResponseDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 1) return '< 1 s';
  if (totalSeconds < 60) return `${totalSeconds.toString()} s`;

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString()} h ${minutes.toString().padStart(2, '0')} min`;
  }
  return `${minutes.toString()} min ${seconds.toString().padStart(2, '0')} s`;
}

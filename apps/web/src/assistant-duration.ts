import type { AssistantMessage } from '@friday/contracts';

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
      durations.set(message.id, Math.max(0, createdAt - userStartedAt));
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

export function normalizeTaskTitle(input: string): string {
  return input.trim().replace(/\s+/gu, ' ').slice(0, 200);
}

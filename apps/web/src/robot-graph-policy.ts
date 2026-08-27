import type { RobotVisualGraph } from '@friday/contracts';

export function findVisualPath(
  graph: RobotVisualGraph,
  from: string,
  to: string,
  allowCandidates: boolean,
): string[] | null {
  if (from === to) return null;
  const completePlaces = new Set(
    graph.places
      .filter(
        (place) =>
          place.status === 'confirmed' && place.panoramaStatus === 'complete',
      )
      .map((place) => place.id),
  );
  if (!completePlaces.has(from) || !completePlaces.has(to)) return null;
  const allowed = new Set(
    allowCandidates ? ['candidate', 'confirmed'] : ['confirmed'],
  );
  const neighbors = new Map<string, string[]>();
  for (const transition of graph.transitions) {
    if (!allowed.has(transition.status)) continue;
    neighbors.set(transition.fromPlaceId, [
      ...(neighbors.get(transition.fromPlaceId) ?? []),
      transition.toPlaceId,
    ]);
  }
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (allowCandidates && path.length >= 4) continue;
    for (const next of neighbors.get(path.at(-1)!) ?? []) {
      if (!completePlaces.has(next) || seen.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) {
        const edgeCount = candidate.length - 1;
        return !allowCandidates || (edgeCount >= 2 && edgeCount <= 3)
          ? candidate
          : null;
      }
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

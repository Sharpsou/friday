import { describe, expect, it } from 'vitest';

import type { RobotVisualGraph } from '@friday/contracts';

import { findVisualPath } from './robot-graph-policy.js';

function graph(statuses: Array<'candidate' | 'confirmed'>): RobotVisualGraph {
  const ids = Array.from({ length: statuses.length + 1 }, () =>
    crypto.randomUUID(),
  );
  const now = new Date().toISOString();
  return {
    version: 1,
    currentPlaceId: ids[0]!,
    places: ids.map((id) => ({
      id,
      status: 'confirmed',
      label: null,
      confidence: 0.9,
      viewCount: 1,
      objectCount: 0,
      panoramaStatus: 'complete',
      canonicalSectorId: null,
      firstSeenAt: now,
      lastSeenAt: now,
    })),
    views: [],
    sectors: [],
    ports: [],
    transitions: statuses.map((status, index) => ({
      id: crypto.randomUUID(),
      fromPlaceId: ids[index]!,
      toPlaceId: ids[index + 1]!,
      direction: 'forward',
      status,
      confidence: 0.7,
      traversalCount: 1,
      successCount: 1,
      failureCount: 0,
      fromSectorId: null,
      toSectorId: null,
      expectedDurationMs: 1_000,
      lastTraversedAt: now,
    })),
    objects: [],
    storage: {
      imageBytes: 0,
      imageQuotaBytes: 1,
      descriptorBytes: 0,
      descriptorQuotaBytes: 1,
    },
  };
}

describe('findVisualPath', () => {
  it('offers a validation route only with one or two intermediate anchors', () => {
    const candidate = graph(['candidate', 'confirmed']);
    expect(
      findVisualPath(
        candidate,
        candidate.places[0]!.id,
        candidate.places[2]!.id,
        true,
      ),
    ).toHaveLength(3);
    const direct = graph(['candidate']);
    expect(
      findVisualPath(direct, direct.places[0]!.id, direct.places[1]!.id, true),
    ).toBeNull();
  });

  it('keeps candidate passages out of normal Va là', () => {
    const candidate = graph(['candidate', 'confirmed']);
    expect(
      findVisualPath(
        candidate,
        candidate.places[0]!.id,
        candidate.places[2]!.id,
        false,
      ),
    ).toBeNull();
  });
});

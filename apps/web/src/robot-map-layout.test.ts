import { describe, expect, it } from 'vitest';

import type { RobotMapSnapshot } from '@friday/contracts';

import {
  createMapProjection,
  layoutMapLabels,
  mapPathData,
  projectMapPoint,
} from './robot-map-layout.js';

const snapshot = {
  localization: { pose: { x: 0, y: 0 } },
  paths: [
    {
      points: [
        { x: -1, y: -1 },
        { x: 1, y: 1 },
      ],
    },
  ],
  objects: [],
} as unknown as RobotMapSnapshot;

describe('robot map layout', () => {
  it('projects the explored path inside the map viewport', () => {
    const projection = createMapProjection(snapshot);
    const first = projectMapPoint({ x: -1, y: -1 }, projection);
    const second = projectMapPoint({ x: 1, y: 1 }, projection);
    expect(first.x).toBeGreaterThan(0);
    expect(second.y).toBeGreaterThan(0);
    expect(mapPathData(snapshot.paths[0]!.points, projection)).toMatch(
      /^M\d+\.\d \d+\.\d L\d+\.\d \d+\.\d$/u,
    );
  });

  it('limits and separates object labels', () => {
    const objects = Array.from({ length: 30 }, (_, index) => ({
      id: crypto.randomUUID(),
      displayName: `Objet ${index.toString()}`,
      classLabel: 'objet',
      x: index * 0.2,
      y: index * 0.2,
      uncertainty: 0.2,
      confidence: 1 - index / 100,
      lastSeenAt: new Date().toISOString(),
    }));
    const labels = layoutMapLabels(
      objects,
      createMapProjection({ ...snapshot, objects } as RobotMapSnapshot),
      8,
    );
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(new Set(labels.map((label) => label.object.id)).size).toBe(
      labels.length,
    );
  });
});

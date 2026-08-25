import type { RobotMapObject, RobotMapSnapshot } from '@friday/contracts';

export const MAP_WIDTH = 1_000;
export const MAP_HEIGHT = 700;
const MAP_PADDING = 70;

export interface MapProjection {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapLabel {
  object: RobotMapObject;
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

export function createMapProjection(snapshot: RobotMapSnapshot): MapProjection {
  const world = [
    snapshot.localization.pose,
    ...snapshot.paths.flatMap((path) => path.points),
    ...snapshot.objects,
  ];
  const minX = Math.min(...world.map((point) => point.x));
  const maxX = Math.max(...world.map((point) => point.x));
  const minY = Math.min(...world.map((point) => point.y));
  const maxY = Math.max(...world.map((point) => point.y));
  const width = Math.max(maxX - minX, 1.5);
  const height = Math.max(maxY - minY, 1.1);
  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / width,
    (MAP_HEIGHT - MAP_PADDING * 2) / height,
  );
  return {
    scale,
    offsetX: MAP_WIDTH / 2 - ((minX + maxX) / 2) * scale,
    offsetY: MAP_HEIGHT / 2 + ((minY + maxY) / 2) * scale,
  };
}

export function projectMapPoint(
  point: { x: number; y: number },
  projection: MapProjection,
): { x: number; y: number } {
  return {
    x: point.x * projection.scale + projection.offsetX,
    y: -point.y * projection.scale + projection.offsetY,
  };
}

export function mapPathData(
  points: ReadonlyArray<{ x: number; y: number }>,
  projection: MapProjection,
): string {
  return points
    .map((point, index) => {
      const projected = projectMapPoint(point, projection);
      return `${index === 0 ? 'M' : 'L'}${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
    })
    .join(' ');
}

export function layoutMapLabels(
  objects: readonly RobotMapObject[],
  projection: MapProjection,
  limit: number,
): MapLabel[] {
  const labels: MapLabel[] = [];
  const boxes: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];
  for (const object of [...objects]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(limit * 2, limit))) {
    const point = projectMapPoint(object, projection);
    const width = Math.min(
      150,
      Math.max(54, object.displayName.length * 7 + 12),
    );
    const candidates = [
      { x: point.x + 10, y: point.y - 10, anchor: 'start' as const },
      { x: point.x - 10, y: point.y + 18, anchor: 'end' as const },
      { x: point.x + 10, y: point.y + 22, anchor: 'start' as const },
      { x: point.x - 10, y: point.y - 10, anchor: 'end' as const },
    ];
    const candidate = candidates.find(({ x, y, anchor }) => {
      const left = anchor === 'start' ? x : x - width;
      const box = { left, right: left + width, top: y - 14, bottom: y + 4 };
      return !boxes.some(
        (placed) =>
          box.left < placed.right &&
          box.right > placed.left &&
          box.top < placed.bottom &&
          box.bottom > placed.top,
      );
    });
    if (!candidate) continue;
    const left =
      candidate.anchor === 'start' ? candidate.x : candidate.x - width;
    boxes.push({
      left,
      right: left + width,
      top: candidate.y - 14,
      bottom: candidate.y + 4,
    });
    labels.push({ object, ...candidate });
    if (labels.length >= limit) break;
  }
  return labels;
}

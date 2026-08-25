import { useMemo, useRef, useState, type PointerEvent } from 'react';

import type { RobotMapSnapshot } from '@friday/contracts';

import {
  MAP_HEIGHT,
  MAP_WIDTH,
  createMapProjection,
  layoutMapLabels,
  mapPathData,
  projectMapPoint,
} from './robot-map-layout.js';
import { previewRobotMission } from './sync/robot-client.js';

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export default function RobotMapView({
  snapshot,
  isOwner,
  onClose,
  onError,
  onNavigate,
}: {
  snapshot: RobotMapSnapshot;
  isOwner: boolean;
  onClose: () => void;
  onError: (cause: unknown) => void;
  onNavigate: (targetPointId: string) => Promise<void>;
}) {
  const groupRef = useRef<SVGGElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const gestureRef = useRef<{ x: number; y: number; distance: number } | null>(
    null,
  );
  const [objectsVisible, setObjectsVisible] = useState(true);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [missionMessage, setMissionMessage] = useState<string | null>(null);
  const projection = useMemo(() => createMapProjection(snapshot), [snapshot]);
  const labels = useMemo(
    () => layoutMapLabels(snapshot.objects, projection, 18),
    [projection, snapshot.objects],
  );
  const robot = projectMapPoint(snapshot.localization.pose, projection);

  const applyTransform = (next: Transform) => {
    transformRef.current = next;
    groupRef.current?.setAttribute(
      'transform',
      `translate(${next.x.toFixed(2)} ${next.y.toFixed(2)}) scale(${next.scale.toFixed(3)})`,
    );
  };

  const updateGesture = () => {
    const pointers = [...pointersRef.current.values()];
    if (pointers.length === 0) {
      gestureRef.current = null;
      return;
    }
    if (pointers.length === 1) {
      gestureRef.current = { ...pointers[0]!, distance: 0 };
      return;
    }
    const [first, second] = pointers;
    gestureRef.current = {
      x: (first!.x + second!.x) / 2,
      y: (first!.y + second!.y) / 2,
      distance: Math.hypot(second!.x - first!.x, second!.y - first!.y),
    };
  };

  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    updateGesture();
  };

  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current)
      return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const pointers = [...pointersRef.current.values()];
    const previous = gestureRef.current;
    const transform = transformRef.current;
    if (pointers.length === 1) {
      const point = pointers[0]!;
      applyTransform({
        ...transform,
        x: transform.x + point.x - previous.x,
        y: transform.y + point.y - previous.y,
      });
    } else {
      const [first, second] = pointers;
      const x = (first!.x + second!.x) / 2;
      const y = (first!.y + second!.y) / 2;
      const distance = Math.hypot(second!.x - first!.x, second!.y - first!.y);
      const scale = Math.max(
        0.7,
        Math.min(
          6,
          transform.scale * (distance / Math.max(previous.distance, 1)),
        ),
      );
      applyTransform({
        x: transform.x + x - previous.x,
        y: transform.y + y - previous.y,
        scale,
      });
    }
    updateGesture();
  };

  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    updateGesture();
  };

  const previewMission = async () => {
    if (!selectedPointId) return;
    try {
      const preview = await previewRobotMission(selectedPointId);
      setMissionMessage(
        preview.allowed
          ? 'Destination acceptée, départ en cours.'
          : (preview.blockedReason ?? 'Trajet verrouillé.'),
      );
      if (preview.allowed) await onNavigate(selectedPointId);
    } catch (cause) {
      onError(cause);
    }
  };

  return (
    <section className="robot-map-modal" aria-label="Carte du robot">
      <header>
        <div>
          <strong>Carte de Friday</strong>
          <small>
            {snapshot.localization.status} · incertitude{' '}
            {snapshot.localization.pose.uncertainty.toFixed(1)} m
          </small>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer la carte">
          Fermer
        </button>
      </header>
      <div className="robot-map-canvas">
        <svg
          aria-label="Vue du dessus de la cartographie"
          role="img"
          viewBox={`0 0 ${MAP_WIDTH.toString()} ${MAP_HEIGHT.toString()}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onWheel={(event) => {
            event.preventDefault();
            const transform = transformRef.current;
            applyTransform({
              ...transform,
              scale: Math.max(
                0.7,
                Math.min(6, transform.scale * (event.deltaY > 0 ? 0.9 : 1.1)),
              ),
            });
          }}
        >
          <defs>
            <pattern
              id="robot-map-grid"
              width="50"
              height="50"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 50 0 L 0 0 0 50" className="robot-map-grid-line" />
            </pattern>
          </defs>
          <rect
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            fill="url(#robot-map-grid)"
          />
          <g ref={groupRef}>
            {snapshot.paths.map((path) => (
              <g key={path.id}>
                <path
                  className={`robot-map-path is-${path.status}`}
                  d={mapPathData(path.points, projection)}
                />
                {path.points
                  .filter(
                    (_, index) =>
                      index % 12 === 0 || index === path.points.length - 1,
                  )
                  .map((point) => {
                    const projected = projectMapPoint(point, projection);
                    return (
                      <circle
                        className={
                          selectedPointId === point.id ? 'is-selected' : ''
                        }
                        cx={projected.x}
                        cy={projected.y}
                        key={point.id}
                        r="7"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedPointId(point.id);
                          setMissionMessage(null);
                        }}
                      />
                    );
                  })}
              </g>
            ))}
            <circle
              className="robot-map-uncertainty"
              cx={robot.x}
              cy={robot.y}
              r={Math.max(
                10,
                snapshot.localization.pose.uncertainty * projection.scale,
              )}
            />
            <path
              className="robot-map-robot"
              d="M 0 -18 L 13 15 L 0 10 L -13 15 Z"
              transform={`translate(${robot.x.toFixed(1)} ${robot.y.toFixed(1)}) rotate(${((-snapshot.localization.pose.heading * 180) / Math.PI + 90).toFixed(1)})`}
            />
            {objectsVisible
              ? snapshot.objects.map((object) => {
                  const point = projectMapPoint(object, projection);
                  return (
                    <circle
                      className="robot-map-object"
                      cx={point.x}
                      cy={point.y}
                      key={object.id}
                      r="6"
                    />
                  );
                })
              : null}
            {objectsVisible
              ? labels.map((label) => (
                  <text
                    className="robot-map-label"
                    key={label.object.id}
                    textAnchor={label.anchor}
                    x={label.x}
                    y={label.y}
                  >
                    {label.object.displayName}
                  </text>
                ))
              : null}
          </g>
        </svg>
        <div className="robot-map-tools">
          <button
            type="button"
            onClick={() => applyTransform({ x: 0, y: 0, scale: 1 })}
          >
            Recentrer
          </button>
          <button
            type="button"
            onClick={() => setObjectsVisible((visible) => !visible)}
          >
            Objets {objectsVisible ? 'visibles' : 'masqués'}
          </button>
        </div>
      </div>
      <footer>
        <span>
          Pincez ou glissez · touchez un point du trajet pour choisir une
          destination.
        </span>
        <button
          type="button"
          disabled={!isOwner || !selectedPointId}
          onClick={() => void previewMission()}
        >
          Va là
        </button>
      </footer>
      {missionMessage ? (
        <p className="robot-map-blocked">{missionMessage}</p>
      ) : null}
      {!snapshot.autonomy.available ? (
        <p className="robot-map-blocked">{snapshot.autonomy.blockedReason}</p>
      ) : null}
    </section>
  );
}

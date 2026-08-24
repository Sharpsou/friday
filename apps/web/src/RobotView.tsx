import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type {
  RobotDetectionKind,
  RobotDirection,
  RobotOperatingMode,
  RobotState,
} from '@friday/contracts';

import {
  ROBOT_CAMERA_STREAM_URL,
  RobotClientError,
  armRobot,
  driveRobot,
  getRobotState,
  lookRobotCamera,
  setRobotMode,
  stopRobot,
  stopRobotOnPageExit,
} from './sync/robot-client.js';
import { nextCameraPose } from './robot-camera-controls.js';

type OverlayKey = 'objects' | 'people' | 'identity' | 'markers' | 'safety';

const OVERLAYS: Array<{ key: OverlayKey; label: string }> = [
  { key: 'objects', label: 'Objets' },
  { key: 'people', label: 'Personnes' },
  { key: 'identity', label: 'Identités' },
  { key: 'markers', label: 'Repères' },
  { key: 'safety', label: 'Sécurité' },
];

const MODE_LABELS: Record<RobotOperatingMode, string> = {
  manual: 'Manuel',
  calibration: 'Calibrage',
  line: 'Ligne',
  visual_tracking: 'Suivi visuel',
  markers: 'Balises',
  companion: 'Compagnon',
};

const KIND_OVERLAY: Record<RobotDetectionKind, OverlayKey> = {
  object: 'objects',
  person: 'people',
  identity: 'identity',
  marker: 'markers',
  safety: 'safety',
};

const PAN_NUDGE = 0.5;
const TILT_NUDGE = 0.05;

function stateLabel(state: RobotState | null): string {
  if (!state?.available) return 'Indisponible';
  if (!state.connected) return 'Déconnecté';
  if (state.moving) return 'En mouvement';
  if (state.armed) return 'Armé';
  return 'Connecté';
}

export default function RobotView({ isOwner }: { isOwner: boolean }) {
  const [state, setState] = useState<RobotState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    objects: true,
    people: true,
    identity: false,
    markers: true,
    safety: true,
  });
  const driveTimerRef = useRef<number | null>(null);
  const driveInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const updateState = useCallback((next: RobotState) => {
    if (mountedRef.current) {
      setState(next);
      setError(null);
    }
  }, []);

  const showError = useCallback((cause: unknown) => {
    if (!mountedRef.current) return;
    setError(
      cause instanceof RobotClientError
        ? cause.message
        : 'Le robot ne répond pas.',
    );
  }, []);

  const stopDriveLoop = useCallback(
    (sendStop = true) => {
      const wasDriving = driveTimerRef.current !== null;
      if (driveTimerRef.current !== null) {
        window.clearInterval(driveTimerRef.current);
        driveTimerRef.current = null;
      }
      driveInFlightRef.current = false;
      if (sendStop && wasDriving)
        void stopRobot().then(updateState).catch(showError);
    },
    [showError, updateState],
  );

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void getRobotState().then(updateState).catch(showError);
    };
    refresh();
    const timer = window.setInterval(refresh, 750);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopDriveLoop();
      } else {
        refresh();
      }
    };
    const onPointerRelease = () => stopDriveLoop();
    window.addEventListener('pointerup', onPointerRelease, { passive: true });
    window.addEventListener('pointercancel', onPointerRelease, {
      passive: true,
    });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('pointerup', onPointerRelease);
      window.removeEventListener('pointercancel', onPointerRelease);
      document.removeEventListener('visibilitychange', onVisibility);
      stopDriveLoop(false);
      stopRobotOnPageExit();
    };
  }, [showError, stopDriveLoop, updateState]);

  const sendDrivePulse = useCallback(
    (direction: RobotDirection) => {
      if (driveInFlightRef.current) return;
      driveInFlightRef.current = true;
      void driveRobot(direction)
        .then(updateState)
        .catch((cause: unknown) => {
          stopDriveLoop(false);
          showError(cause);
        })
        .finally(() => {
          driveInFlightRef.current = false;
        });
    },
    [showError, stopDriveLoop, updateState],
  );

  const beginDrive = useCallback(
    (
      direction: RobotDirection,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      stopDriveLoop(false);
      sendDrivePulse(direction);
      driveTimerRef.current = window.setInterval(
        () => sendDrivePulse(direction),
        180,
      );
    },
    [sendDrivePulse, stopDriveLoop],
  );

  const setMode = async (mode: RobotOperatingMode) => {
    setBusy(true);
    try {
      updateState(await setRobotMode(mode));
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const nudgeCamera = async (panDelta: number, tiltDelta: number) => {
    if (!state) return;
    setBusy(true);
    try {
      const target = nextCameraPose(state.cameraPose, panDelta, tiltDelta);
      updateState(await lookRobotCamera(target.pan, target.tilt));
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const visibleDetections = useMemo(() => {
    if (
      !state?.vision ||
      Date.parse(state.vision.expiresAt) <=
        Date.parse(state.lastSeenAt ?? state.vision.observedAt)
    )
      return [];
    return state.vision.detections.filter(
      (detection) => overlays[KIND_OVERLAY[detection.kind]],
    );
  }, [overlays, state]);

  const canDrive =
    isOwner &&
    state?.available === true &&
    state.connected &&
    state.armed &&
    ['manual', 'calibration'].includes(state.operatingMode);
  const canLook =
    isOwner && state?.capabilities.includes('camera_look') === true && !busy;

  return (
    <section className="screen robot-view" aria-labelledby="robot-title">
      <div className="section-heading robot-heading">
        <div>
          <span className="eyebrow">Corps physique</span>
          <h2 id="robot-title">Robot</h2>
        </div>
        <span
          className={`robot-state is-${state?.moving ? 'moving' : state?.armed ? 'armed' : state?.connected ? 'connected' : 'offline'}`}
          role="status"
        >
          {stateLabel(state)}
        </span>
      </div>

      {state?.warning ? <p className="robot-warning">{state.warning}</p> : null}
      {error ? (
        <p className="robot-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="robot-camera-panel" aria-label="Caméra du robot">
        <div
          className={`robot-camera ${state?.mode === 'simulated' ? 'is-simulated' : ''}`}
        >
          {state?.cameraAvailable ? (
            <img src={ROBOT_CAMERA_STREAM_URL} alt="Vue en direct du robot" />
          ) : (
            <div className="robot-camera-empty">Caméra indisponible</div>
          )}
          {state?.mode === 'simulated' ? (
            <span className="robot-simulation-label">SIMULATION</span>
          ) : null}
          <div className="robot-overlays" aria-hidden="true">
            {visibleDetections.map((detection) => (
              <span
                className={`robot-box is-${detection.kind}`}
                key={detection.id}
                style={{
                  left: `${(detection.x * 100).toString()}%`,
                  top: `${(detection.y * 100).toString()}%`,
                  width: `${(detection.width * 100).toString()}%`,
                  height: `${(detection.height * 100).toString()}%`,
                }}
              >
                <small>
                  {detection.label}
                  {detection.confidence === null
                    ? ''
                    : ` ${Math.round(detection.confidence * 100).toString()} %`}
                </small>
              </span>
            ))}
          </div>
        </div>
        <div className="robot-overlay-options" aria-label="Surimpressions">
          {OVERLAYS.map((overlay) => {
            const identityUnavailable =
              overlay.key === 'identity' &&
              !state?.capabilities.includes('vision_identity');
            return (
              <label key={overlay.key}>
                <input
                  checked={overlays[overlay.key]}
                  disabled={identityUnavailable}
                  type="checkbox"
                  onChange={(event) =>
                    setOverlays((current) => ({
                      ...current,
                      [overlay.key]: event.target.checked,
                    }))
                  }
                />
                {overlay.label}
              </label>
            );
          })}
        </div>
      </section>

      <div className="robot-control-layout">
        <section className="panel robot-control-panel" aria-label="Caméra">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Regard</span>
              <h3>Caméra</h3>
            </div>
            <small>
              {Math.round((state?.cameraPose.pan ?? 0) * 100).toString()} /{' '}
              {Math.round((state?.cameraPose.tilt ?? 0) * 100).toString()}
            </small>
          </div>
          <DirectionPad
            disabled={!canLook}
            kind="camera"
            onCenter={() =>
              state &&
              void nudgeCamera(-state.cameraPose.pan, -state.cameraPose.tilt)
            }
            onDown={() => void nudgeCamera(0, TILT_NUDGE)}
            onLeft={() => void nudgeCamera(PAN_NUDGE, 0)}
            onRight={() => void nudgeCamera(-PAN_NUDGE, 0)}
            onUp={() => void nudgeCamera(0, -TILT_NUDGE)}
          />
        </section>

        <section className="panel robot-control-panel" aria-label="Locomotion">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Déplacement</span>
              <h3>Locomotion</h3>
            </div>
            <select
              aria-label="Mode du robot"
              disabled={!isOwner || !state?.available || busy}
              value={state?.operatingMode ?? 'manual'}
              onChange={(event) =>
                void setMode(event.target.value as RobotOperatingMode)
              }
            >
              {Object.entries(MODE_LABELS).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="robot-stop"
            type="button"
            disabled={!state?.available}
            onClick={() => void stopRobot().then(updateState).catch(showError)}
          >
            ARRÊT
          </button>
          <button
            className="secondary-button robot-arm"
            type="button"
            disabled={!isOwner || !state?.available || busy || state.armed}
            onClick={() => void armRobot().then(updateState).catch(showError)}
          >
            {state?.armed ? 'Conduite armée' : 'Activer 60 s'}
          </button>
          <DirectionPad
            disabled={!canDrive}
            kind="drive"
            onDownPointer={(event) => beginDrive('backward', event)}
            onLeftPointer={(event) => beginDrive('left', event)}
            onRelease={() => stopDriveLoop()}
            onRightPointer={(event) => beginDrive('right', event)}
            onUpPointer={(event) => beginDrive('forward', event)}
          />
          {!isOwner ? (
            <small>Le propriétaire doit autoriser la conduite.</small>
          ) : null}
        </section>
      </div>

      <details className="panel robot-telemetry">
        <summary>Télémétrie et diagnostic</summary>
        <dl>
          <div>
            <dt>Température</dt>
            <dd>
              {state?.telemetry.temperatureC === null || !state
                ? '—'
                : `${state.telemetry.temperatureC.toFixed(1)} °C`}
            </dd>
          </div>
          <div>
            <dt>Alimentation</dt>
            <dd>
              {state?.telemetry.underVoltageActive
                ? 'Sous-tension active'
                : state?.telemetry.underVoltageOccurred
                  ? 'Sous-tension mémorisée'
                  : 'Normale'}
            </dd>
          </div>
          <div>
            <dt>IR avant</dt>
            <dd>
              {state
                ? `${state.telemetry.irLeftClear ? 'libre' : 'bloqué'} / ${state.telemetry.irRightClear ? 'libre' : 'bloqué'}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Caméra / vision</dt>
            <dd>
              {state?.telemetry.cameraFps?.toFixed(1) ?? '—'} FPS /{' '}
              {state?.vision?.processingMs.toFixed(0) ?? '—'} ms
            </dd>
          </div>
          <div>
            <dt>Latence commande</dt>
            <dd>{state?.telemetry.commandLatencyMs?.toFixed(0) ?? '—'} ms</dd>
          </div>
          <div>
            <dt>Capteurs de ligne</dt>
            <dd>{state?.telemetry.lineSensors.join(' · ') ?? '—'}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function DirectionPad({
  disabled,
  kind,
  onCenter,
  onDown,
  onDownPointer,
  onLeft,
  onLeftPointer,
  onRelease,
  onRight,
  onRightPointer,
  onUp,
  onUpPointer,
}: {
  disabled: boolean;
  kind: 'camera' | 'drive';
  onCenter?: () => void;
  onDown?: () => void;
  onDownPointer?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLeft?: () => void;
  onLeftPointer?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRelease?: () => void;
  onRight?: () => void;
  onRightPointer?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUp?: () => void;
  onUpPointer?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const prefix = kind === 'camera' ? 'Caméra' : 'Robot';
  const button = (
    name: 'haut' | 'bas' | 'gauche' | 'droite',
    symbol: string,
    onClick?: () => void,
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void,
  ) => (
    <button
      aria-label={`${prefix} ${name}`}
      className={`is-${name}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerCancel={onRelease}
      onPointerUp={onRelease}
    >
      {symbol}
    </button>
  );
  return (
    <div className={`robot-direction-pad is-${kind}`}>
      {button('haut', '↑', onUp, onUpPointer)}
      {button('gauche', '←', onLeft, onLeftPointer)}
      <button
        aria-label={`${prefix} centrer`}
        className="is-center"
        disabled={disabled || onCenter === undefined}
        type="button"
        onClick={onCenter}
      >
        •
      </button>
      {button('droite', '→', onRight, onRightPointer)}
      {button('bas', '↓', onDown, onDownPointer)}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type {
  RobotDirection,
  RobotAutonomyStatus,
  RobotCognitionJournalEntry,
  RobotMapSnapshot,
  RobotMemorySummary,
  RobotState,
} from '@friday/contracts';

import RobotMapView from './RobotMapView.js';
import {
  ROBOT_CAMERA_STREAM_URL,
  RobotClientError,
  armRobot,
  driveRobot,
  getRobotState,
  getRobotMemory,
  getRobotMap,
  getRobotAutonomy,
  getRobotCognitionJournal,
  haltRobot,
  lookRobotCamera,
  renameRobotMemoryEntity,
  setRobotMode,
  setRobotMapping,
  setRobotActuators,
  stopRobot,
  stopRobotOnPageExit,
  startRobotAutonomy,
  stopRobotAutonomy,
} from './sync/robot-client.js';
import {
  CAMERA_NEUTRAL_TILT,
  cameraCenterDelta,
  nextCameraPose,
} from './robot-camera-controls.js';
import {
  applySteeringTrim,
  joystickDriveCommand,
  shouldSendDriveCommand,
  type DriveCommand,
} from './robot-drive-controls.js';

const PAN_NUDGE = 0.5;
const TILT_NUDGE = 0.05;
const ROBOT_POWER_STORAGE_KEY = 'friday.robot.powerPercent';
const ROBOT_TRIM_STORAGE_KEY = 'friday.robot.steeringTrimPercent';

function initialRobotPower(): number {
  const stored = Number(window.localStorage.getItem(ROBOT_POWER_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= 10 && stored <= 35 ? stored : 20;
}

function initialSteeringTrim(): number {
  const stored = Number(window.localStorage.getItem(ROBOT_TRIM_STORAGE_KEY));
  return Number.isInteger(stored) && stored >= -10 && stored <= 10 ? stored : 0;
}

function steeringTrimLabel(trimPercent: number): string {
  if (trimPercent === 0) return '0';
  return `${trimPercent < 0 ? 'G' : 'D'} ${Math.abs(trimPercent).toString()}`;
}

function stateLabel(state: RobotState | null): string {
  if (!state?.available) return 'Indisponible';
  if (!state.connected) return 'Déconnecté';
  if (state.moving) return 'En mouvement';
  if (state.armed) return 'Armé';
  return 'Connecté';
}

export default function RobotView({ isOwner }: { isOwner: boolean }) {
  const [state, setState] = useState<RobotState | null>(null);
  const [memory, setMemory] = useState<RobotMemorySummary | null>(null);
  const [map, setMap] = useState<RobotMapSnapshot | null>(null);
  const [autonomy, setAutonomy] = useState<RobotAutonomyStatus | null>(null);
  const [cognition, setCognition] = useState<RobotCognitionJournalEntry[]>([]);
  const [mapVisible, setMapVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    document.visibilityState === 'visible',
  );
  const [powerPercent, setPowerPercent] = useState(initialRobotPower);
  const [steeringTrimPercent, setSteeringTrimPercent] =
    useState(initialSteeringTrim);
  const [recognitionVisible, setRecognitionVisible] = useState(true);
  const driveTimerRef = useRef<number | null>(null);
  const driveInFlightRef = useRef(false);
  const driveCommandRef = useRef<DriveCommand | null>(null);
  const powerPercentRef = useRef(powerPercent);
  const armInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const operatingModeRef = useRef<RobotState['operatingMode']>('manual');

  useEffect(() => {
    powerPercentRef.current = powerPercent;
    window.localStorage.setItem(
      ROBOT_POWER_STORAGE_KEY,
      powerPercent.toString(),
    );
  }, [powerPercent]);

  useEffect(() => {
    window.localStorage.setItem(
      ROBOT_TRIM_STORAGE_KEY,
      steeringTrimPercent.toString(),
    );
  }, [steeringTrimPercent]);

  const updateState = useCallback((next: RobotState) => {
    if (mountedRef.current) {
      operatingModeRef.current = next.operatingMode;
      setState(next);
      setError(null);
    }
  }, []);

  useEffect(() => {
    const refreshMap = () => {
      if (document.visibilityState === 'visible')
        void Promise.all([getRobotMap(), getRobotAutonomy()])
          .then(([nextMap, nextAutonomy]) => {
            if (mountedRef.current) {
              setMap(nextMap);
              setAutonomy(nextAutonomy);
            }
          })
          .catch(() => undefined);
    };
    refreshMap();
    const timer = window.setInterval(refreshMap, mapVisible ? 1_000 : 3_000);
    return () => window.clearInterval(timer);
  }, [mapVisible]);

  const showError = useCallback((cause: unknown) => {
    if (!mountedRef.current) return;
    setError(
      cause instanceof RobotClientError
        ? cause.message
        : 'Le robot ne répond pas.',
    );
  }, []);

  const renameMemoryEntity = useCallback(
    async (id: string, currentName: string) => {
      const nextName = window.prompt('Nom de cet objet', currentName)?.trim();
      if (!nextName || nextName === currentName) return;
      try {
        setMemory(await renameRobotMemoryEntity(id, nextName));
        setError(null);
      } catch (cause) {
        showError(cause);
      }
    },
    [showError],
  );

  const stopDriveLoop = useCallback(
    (sendStop = true, disarm = false) => {
      const wasDriving = driveTimerRef.current !== null;
      if (driveTimerRef.current !== null) {
        window.clearInterval(driveTimerRef.current);
        driveTimerRef.current = null;
      }
      driveInFlightRef.current = false;
      driveCommandRef.current = null;
      if (sendStop && wasDriving)
        void (disarm ? stopRobot() : haltRobot())
          .then(updateState)
          .catch(showError);
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
      setPageVisible(document.visibilityState === 'visible');
      if (document.visibilityState === 'hidden') {
        stopDriveLoop(operatingModeRef.current === 'manual', true);
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
      if (operatingModeRef.current === 'manual') stopRobotOnPageExit();
    };
  }, [showError, stopDriveLoop, updateState]);

  useEffect(() => {
    const refreshMemory = () => {
      if (document.visibilityState === 'visible')
        void getRobotMemory()
          .then((next) => {
            if (mountedRef.current) setMemory(next);
          })
          .catch(() => undefined);
    };
    refreshMemory();
    const timer = window.setInterval(refreshMemory, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void getRobotCognitionJournal()
          .then((entries) => {
            if (mountedRef.current) setCognition(entries);
          })
          .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const sendDrivePulse = useCallback(
    (command: DriveCommand) => {
      if (driveInFlightRef.current) return;
      driveInFlightRef.current = true;
      void driveRobot(
        command.direction,
        powerPercentRef.current / 100,
        command.steering,
      )
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

  const startDriveCommand = useCallback(
    (command: DriveCommand) => {
      driveCommandRef.current = command;
      if (driveTimerRef.current !== null) {
        sendDrivePulse(command);
        return;
      }
      stopDriveLoop(false);
      driveCommandRef.current = command;
      sendDrivePulse(command);
      driveTimerRef.current = window.setInterval(() => {
        if (driveCommandRef.current) sendDrivePulse(driveCommandRef.current);
      }, 180);
    },
    [sendDrivePulse, stopDriveLoop],
  );

  const renewWheelArm = useCallback(() => {
    if (armInFlightRef.current) return;
    armInFlightRef.current = true;
    void armRobot()
      .then(updateState)
      .catch(showError)
      .finally(() => {
        armInFlightRef.current = false;
      });
  }, [showError, updateState]);

  useEffect(() => {
    if (
      !isOwner ||
      !state?.available ||
      !state.connected ||
      !state.actuators.wheelsEnabled ||
      state.operatingMode !== 'manual' ||
      !pageVisible
    )
      return;
    if (!state.armed) renewWheelArm();
    const timer = window.setInterval(renewWheelArm, 45_000);
    return () => window.clearInterval(timer);
  }, [
    isOwner,
    pageVisible,
    renewWheelArm,
    state?.armed,
    state?.actuators.wheelsEnabled,
    state?.available,
    state?.connected,
    state?.operatingMode,
  ]);

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

  const changeMode = async (mode: 'manual' | 'autonomous') => {
    setBusy(true);
    try {
      if (mode === 'autonomous') {
        const response = await startRobotAutonomy(
          powerPercent,
          steeringTrimPercent,
        );
        updateState(response.state);
        setMap(response.map);
        setAutonomy(response.autonomy);
      } else if (autonomy?.status !== 'inactive') {
        const response = await stopRobotAutonomy();
        updateState(response.state);
        setMap(response.map);
        setAutonomy(response.autonomy);
      } else {
        updateState(await setRobotMode('manual'));
        setMap(await getRobotMap());
      }
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const changeMapping = async (
    action: 'pause' | 'resume' | 'start' | 'stop',
  ) => {
    if (!state) return;
    setBusy(true);
    try {
      if (
        (action === 'start' || action === 'resume') &&
        (Math.abs(state.cameraPose.pan) > 0.02 ||
          Math.abs(state.cameraPose.tilt - CAMERA_NEUTRAL_TILT) > 0.02)
      ) {
        updateState(await lookRobotCamera(0, CAMERA_NEUTRAL_TILT));
      }
      setMap(await setRobotMapping(action));
      setError(null);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const setActuator = async (
    actuator: 'wheelsEnabled' | 'cameraServosEnabled',
    enabled: boolean,
  ) => {
    if (!state) return;
    if (actuator === 'wheelsEnabled' && !enabled) stopDriveLoop();
    setBusy(true);
    try {
      const actuatorState = await setRobotActuators({
        ...state.actuators,
        [actuator]: enabled,
      });
      if (actuator === 'wheelsEnabled' && enabled) {
        updateState(
          actuatorState.operatingMode === 'manual'
            ? await armRobot()
            : actuatorState,
        );
      } else updateState(actuatorState);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const visibleDetections = useMemo(() => {
    if (
      !recognitionVisible ||
      !state?.vision ||
      Date.parse(state.vision.expiresAt) <=
        Date.parse(state.lastSeenAt ?? state.vision.observedAt)
    )
      return [];
    return state.vision.detections;
  }, [recognitionVisible, state]);

  const canDrive =
    isOwner &&
    state?.available === true &&
    state.connected &&
    state.actuators.wheelsEnabled &&
    state.operatingMode === 'manual' &&
    (map?.mapping.status !== 'recording' ||
      (Math.abs(state.cameraPose.pan) <= 0.02 &&
        Math.abs(state.cameraPose.tilt - CAMERA_NEUTRAL_TILT) <= 0.02));
  const canLook =
    isOwner &&
    state?.capabilities.includes('camera_look') === true &&
    state.actuators.cameraServosEnabled &&
    state.operatingMode === 'manual' &&
    !state.moving &&
    !busy;

  if (mapVisible && map)
    return (
      <RobotMapView
        snapshot={map}
        isOwner={isOwner}
        onClose={() => setMapVisible(false)}
        onError={showError}
        onNavigate={async (targetPointId) => {
          const response = await startRobotAutonomy(
            powerPercent,
            steeringTrimPercent,
            targetPointId,
          );
          updateState(response.state);
          setMap(response.map);
          setAutonomy(response.autonomy);
          setMapVisible(false);
        }}
      />
    );

  return (
    <section className="screen robot-view" aria-label="Robot">
      <div className="robot-topbar">
        <span
          className={`robot-state is-${state?.moving ? 'moving' : state?.armed ? 'armed' : state?.connected ? 'connected' : 'offline'}`}
          role="status"
        >
          {stateLabel(state)}
        </span>
        <div className="robot-actuator-switches" aria-label="Actionneurs">
          <ActuatorSwitch
            checked={state?.actuators.wheelsEnabled ?? false}
            disabled={
              !isOwner ||
              !state?.available ||
              !state.capabilities.includes('teleop') ||
              busy
            }
            label="Roues"
            onChange={(enabled) => void setActuator('wheelsEnabled', enabled)}
          />
          <ActuatorSwitch
            checked={state?.actuators.cameraServosEnabled ?? false}
            disabled={
              !isOwner ||
              !state?.available ||
              !state.capabilities.includes('camera_look') ||
              busy
            }
            label="Caméra"
            onChange={(enabled) =>
              void setActuator('cameraServosEnabled', enabled)
            }
          />
        </div>
      </div>

      {state?.warning ? <p className="robot-warning">{state.warning}</p> : null}
      {error ? (
        <p className="robot-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="robot-mode-controls" aria-label="Mode du robot">
        <button
          className={state?.operatingMode === 'manual' ? 'is-active' : ''}
          disabled={!isOwner || busy}
          type="button"
          onClick={() => void changeMode('manual')}
        >
          Manuel
        </button>
        <button
          className={state?.operatingMode === 'autonomous' ? 'is-active' : ''}
          disabled={!isOwner || busy || !map?.autonomy.available}
          title={map?.autonomy.blockedReason ?? undefined}
          type="button"
          onClick={() => void changeMode('autonomous')}
        >
          Autonome
        </button>
        <button
          type="button"
          onClick={() => setMapVisible(true)}
          disabled={!map}
        >
          Carte
        </button>
        {state?.operatingMode === 'manual' ? (
          <button
            className={
              map?.mapping.status === 'recording' ? 'is-recording' : ''
            }
            disabled={!isOwner || busy || !state.cameraAvailable}
            type="button"
            onClick={() =>
              void changeMapping(
                map?.mapping.status === 'recording'
                  ? 'pause'
                  : map?.mapping.status === 'paused'
                    ? 'resume'
                    : 'start',
              )
            }
          >
            {map?.mapping.status === 'recording'
              ? 'Carto active'
              : map?.mapping.status === 'paused'
                ? 'Reprendre Carto'
                : 'Carto'}
          </button>
        ) : null}
        {map?.mapping.status === 'recording' ||
        map?.mapping.status === 'paused' ? (
          <button
            disabled={!isOwner || busy}
            type="button"
            onClick={() => void changeMapping('stop')}
          >
            Terminer
          </button>
        ) : null}
      </div>
      <small className="robot-map-status">
        Mémoire · {memory?.entities.length.toString() ?? '0'} objet(s) · Carto{' '}
        {map?.mapping.status ?? 'indisponible'} ·{' '}
        {map
          ? `${Math.round(map.mapping.storageBytes / 1_024).toString()} Kio`
          : '—'}{' '}
        · images-clés {map?.visualMemory.keyframeCount.toString() ?? '0'} (
        {map
          ? `${Math.round(map.visualMemory.storageBytes / 1_024).toString()} Kio`
          : '—'}
        )
      </small>
      {autonomy && autonomy.status !== 'inactive' ? (
        <small className="robot-map-status" role="status">
          Autonomie · {autonomy.status} · {autonomy.goal ?? 'observation'} ·{' '}
          {autonomy.action ?? 'attente'} · confiance{' '}
          {Math.round(autonomy.confidence * 100).toString()} % ·{' '}
          {autonomy.episodeCount.toString()} expériences
        </small>
      ) : null}
      {cognition[0] ? (
        <small className="robot-map-status">
          Friday · {cognition[0].message}
        </small>
      ) : null}

      <section className="robot-camera-panel" aria-label="Caméra du robot">
        <div className="robot-camera">
          {state?.cameraAvailable ? (
            <img src={ROBOT_CAMERA_STREAM_URL} alt="Vue en direct du robot" />
          ) : (
            <div className="robot-camera-empty">Caméra indisponible</div>
          )}
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
          <label>
            <input
              checked={recognitionVisible}
              type="checkbox"
              onChange={(event) => setRecognitionVisible(event.target.checked)}
            />
            Reco
          </label>
        </div>
        <div className="robot-compact-controls">
          <div className="robot-camera-buttons" aria-label="Orientation caméra">
            <button
              aria-label="Caméra gauche"
              disabled={!canLook}
              type="button"
              onClick={() => void nudgeCamera(PAN_NUDGE, 0)}
            >
              ←
            </button>
            <button
              aria-label="Caméra haut"
              disabled={!canLook}
              type="button"
              onClick={() => void nudgeCamera(0, -TILT_NUDGE)}
            >
              ↑
            </button>
            <button
              aria-label="Caméra centrer"
              disabled={!canLook}
              type="button"
              onClick={() => {
                if (!state) return;
                const delta = cameraCenterDelta(state.cameraPose);
                void nudgeCamera(delta.pan, delta.tilt);
              }}
            >
              •
            </button>
            <button
              aria-label="Caméra bas"
              disabled={!canLook}
              type="button"
              onClick={() => void nudgeCamera(0, TILT_NUDGE)}
            >
              ↓
            </button>
            <button
              aria-label="Caméra droite"
              disabled={!canLook}
              type="button"
              onClick={() => void nudgeCamera(-PAN_NUDGE, 0)}
            >
              →
            </button>
            <small aria-label="Position caméra">
              {Math.round((state?.cameraPose.pan ?? 0) * 100).toString()} ·{' '}
              {Math.round((state?.cameraPose.tilt ?? 0) * 100).toString()}
            </small>
          </div>
        </div>
      </section>

      <div className="robot-motion-dock" aria-label="Locomotion">
        <div className="robot-drive-column">
          <JoystickControl
            disabled={!canDrive}
            onCommand={startDriveCommand}
            onRelease={() => stopDriveLoop()}
            powerPercent={powerPercent}
            steeringTrimPercent={steeringTrimPercent}
          />
          <label className="robot-power-control">
            <span>
              Puissance <strong>{powerPercent.toString()} %</strong>
            </span>
            <input
              aria-label="Puissance moteurs"
              disabled={!isOwner}
              max="35"
              min="10"
              step="1"
              type="range"
              value={powerPercent}
              onChange={(event) => setPowerPercent(event.target.valueAsNumber)}
            />
          </label>
          <label className="robot-power-control">
            <span>
              Trim direction{' '}
              <strong>{steeringTrimLabel(steeringTrimPercent)}</strong>
            </span>
            <input
              aria-label="Trim direction"
              disabled={!isOwner}
              max="10"
              min="-10"
              step="1"
              type="range"
              value={steeringTrimPercent}
              onChange={(event) =>
                setSteeringTrimPercent(event.target.valueAsNumber)
              }
            />
          </label>
        </div>
        <div className="robot-drive-actions">
          <button
            className="robot-stop"
            type="button"
            disabled={!state?.available}
            onClick={() => void setActuator('wheelsEnabled', false)}
          >
            ARRÊT
          </button>
        </div>
      </div>

      {!isOwner ? (
        <small>Le propriétaire doit autoriser les actionneurs.</small>
      ) : null}

      <details className="panel robot-memory">
        <summary>
          Mémoire visuelle · {memory?.entities.length.toString() ?? '0'}{' '}
          objet(s)
        </summary>
        {memory?.entities.length ? (
          <ul>
            {memory.entities.map((entity) => (
              <li key={entity.id}>
                <span>
                  <strong>{entity.displayName}</strong> · {entity.roomName} ·{' '}
                  {Math.round(entity.confidence * 100).toString()} % ·{' '}
                  {entity.sightingCount.toString()} vue(s)
                </span>
                {isOwner ? (
                  <button
                    type="button"
                    onClick={() =>
                      void renameMemoryEntity(entity.id, entity.displayName)
                    }
                  >
                    Renommer
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Aucun objet confirmé. Friday attend plusieurs vues fiables avant de
            mémoriser un emplacement.
          </p>
        )}
      </details>

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
                ? `Seuil Pi détecté${state.telemetry.throttledCode ? ` (${state.telemetry.throttledCode})` : ''} · informatif`
                : state?.telemetry.underVoltageOccurred
                  ? 'Seuil Pi mémorisé · informatif'
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
            <dt>Apprentissage</dt>
            <dd>
              {memory?.learning.mode === 'shadow'
                ? `Observateur · ${memory.learning.episodeCount.toString()} épisode(s)`
                : 'Désactivé'}
            </dd>
          </div>
          <div>
            <dt>Présence anonyme</dt>
            <dd>
              {memory?.anonymousPresence.active
                ? 'Détectée maintenant'
                : memory?.anonymousPresence.lastSeenAt
                  ? `Dernière vue ${new Date(memory.anonymousPresence.lastSeenAt).toLocaleTimeString('fr-FR')}`
                  : 'Aucune observation récente'}
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

function ActuatorSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="robot-actuator-switch">
      <span>{label}</span>
      <input
        checked={checked}
        role="switch"
        type="checkbox"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function JoystickControl({
  disabled,
  onCommand,
  onRelease,
  powerPercent,
  steeringTrimPercent,
}: {
  disabled: boolean;
  onCommand: (command: DriveCommand) => void;
  onRelease: () => void;
  powerPercent: number;
  steeringTrimPercent: number;
}) {
  const knobRef = useRef<HTMLSpanElement>(null);
  const directionRef = useRef<RobotDirection | null>(null);
  const steeringRef = useRef(0);

  const release = (target?: HTMLButtonElement, pointerId?: number) => {
    if (
      target &&
      pointerId !== undefined &&
      target.hasPointerCapture(pointerId)
    )
      target.releasePointerCapture(pointerId);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0, 0)';
    if (directionRef.current !== null) onRelease();
    directionRef.current = null;
    steeringRef.current = 0;
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      event.type === 'pointermove' &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawX = event.clientX - (bounds.left + bounds.width / 2);
    const rawY = event.clientY - (bounds.top + bounds.height / 2);
    const radiusX = bounds.width * 0.34;
    const radiusY = bounds.height * 0.28;
    const ellipticalDistance = Math.hypot(rawX / radiusX, rawY / radiusY);
    const scale = ellipticalDistance > 1 ? 1 / ellipticalDistance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    if (knobRef.current)
      knobRef.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

    const normalizedX = Math.max(-1, Math.min(1, x / radiusX));
    const normalizedY = Math.max(-1, Math.min(1, y / radiusY));
    const rawCommand = joystickDriveCommand(
      normalizedX,
      normalizedY,
      powerPercent / 100,
    );
    if (!rawCommand) {
      if (directionRef.current !== null) onRelease();
      directionRef.current = null;
      return;
    }
    const command = applySteeringTrim(rawCommand, steeringTrimPercent / 100);
    const previousCommand = directionRef.current
      ? { direction: directionRef.current, steering: steeringRef.current }
      : null;
    const returnedToTrimmedCenter =
      rawCommand.steering === 0 &&
      previousCommand?.steering !== command.steering;
    if (
      shouldSendDriveCommand(previousCommand, command, returnedToTrimmedCenter)
    ) {
      directionRef.current = command.direction;
      steeringRef.current = command.steering;
      onCommand(command);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const directions: Partial<Record<string, RobotDirection>> = {
      ArrowUp: 'forward',
      ArrowDown: 'backward',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    directionRef.current = direction;
    const command = applySteeringTrim(
      { direction, steering: 0 },
      steeringTrimPercent / 100,
    );
    steeringRef.current = command.steering;
    onCommand(command);
  };

  return (
    <button
      aria-label="Joystick locomotion"
      className="robot-joystick"
      disabled={disabled}
      type="button"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key.startsWith('Arrow')) release();
      }}
      onPointerCancel={(event) => release(event.currentTarget, event.pointerId)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={move}
      onPointerUp={(event) => release(event.currentTarget, event.pointerId)}
    >
      <span className="robot-joystick-axis" aria-hidden="true">
        <b>↑</b>
        <b>←</b>
        <b>→</b>
        <b>↓</b>
      </span>
      <span className="robot-joystick-knob" ref={knobRef} aria-hidden="true" />
    </button>
  );
}

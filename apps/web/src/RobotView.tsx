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
  RobotAutonomyStatus,
  RobotControlPreferences,
  RobotDirection,
  RobotDisplayPreferences,
  RobotPanoramaPreferences,
  RobotState,
  RobotVisualGraph,
} from '@friday/contracts';

import RobotGraphView from './RobotGraphView.js';
import { cameraCenterDelta, nextCameraPose } from './robot-camera-controls.js';
import {
  applySteeringTrim,
  joystickDriveCommand,
  shouldSendDriveCommand,
  type DriveCommand,
} from './robot-drive-controls.js';
import {
  ROBOT_CAMERA_STREAM_URL,
  RobotClientError,
  deleteRobotVisualObject,
  deleteRobotVisualPlace,
  driveRobot,
  finishRobotHumanRecovery,
  getRobotAutonomy,
  getRobotControlPreferences,
  getRobotDisplayPreferences,
  getRobotGraph,
  getRobotPanoramaPreferences,
  getRobotState,
  haltRobot,
  lookRobotCamera,
  mergeRobotVisualPlaces,
  renameRobotVisualObject,
  renameRobotVisualPlace,
  setRobotActuators,
  setRobotAutonomyPower,
  setRobotControlPreferences,
  setRobotDisplayPreferences,
  setRobotMode,
  setRobotPanoramaPreferences,
  sleepRobotNetwork,
  startRobotAutonomy,
  startRobotHumanRecovery,
  stopRobotOnPageExit,
  wakeRobotNetwork,
} from './sync/robot-client.js';
import { useRobotGamepad } from './use-robot-gamepad.js';

const PAN_NUDGE = 0.5;
const TILT_NUDGE = 0.08;
type RobotControlSettings = {
  panoramaPulseMs: number;
  steeringTrimPercent: number;
};
const POWER_KEY = 'friday.robot.powerPercent';
const LEGACY_TRIM_KEY = 'friday.robot.steeringTrimPercent';

function initialNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function readLegacySteeringTrim(): number | null {
  const stored = window.localStorage.getItem(LEGACY_TRIM_KEY);
  if (stored === null) return null;
  const value = Number(stored);
  return Number.isInteger(value) && value >= -10 && value <= 10 ? value : null;
}

function stateLabel(state: RobotState | null): string {
  if (state?.powerState === 'sleeping') return 'En veille';
  if (state?.powerState === 'transitioning') return 'Transition…';
  if (state?.powerState === 'degraded') return 'Veille dégradée';
  if (!state?.available) return 'Indisponible';
  if (!state.connected) return 'Déconnecté';
  if (state.moving) return 'En mouvement';
  if (state.actuators.wheelsEnabled) return 'Roues actives';
  return 'Connecté';
}

export default function RobotView({ isOwner }: { isOwner: boolean }) {
  const [state, setState] = useState<RobotState | null>(null);
  const [graph, setGraph] = useState<RobotVisualGraph | null>(null);
  const [autonomy, setAutonomy] = useState<RobotAutonomyStatus | null>(null);
  const [displayPreferences, setDisplayPreferences] =
    useState<RobotDisplayPreferences | null>(null);
  const [controlPreferences, setControlPreferences] =
    useState<RobotControlPreferences | null>(null);
  const [panoramaPreferences, setPanoramaPreferences] =
    useState<RobotPanoramaPreferences | null>(null);
  const [graphVisible, setGraphVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [powerPercent, setPowerPercent] = useState(() =>
    initialNumber(POWER_KEY, 20, 10, 35),
  );
  const steeringTrimPercent = controlPreferences?.steeringTrimPercent ?? 0;
  const panoramaPulseMs = panoramaPreferences?.panoramaPulseMs ?? 220;
  const powerState = state?.powerState ?? 'awake';
  const hasNetworkStandby =
    state?.capabilities.includes('network_standby') ?? false;
  const mounted = useRef(true);
  const stateRef = useRef<RobotState | null>(null);
  const mode = useRef<RobotState['operatingMode']>('manual');
  const driveTimer = useRef<number | null>(null);
  const driveInFlight = useRef(false);
  const driveCommand = useRef<DriveCommand | null>(null);
  const power = useRef(powerPercent);
  const autonomyPowerRevision = useRef(0);
  const autonomyPowerSaveTimer = useRef<number | null>(null);
  const busyRef = useRef(false);
  const cameraMoveInFlight = useRef(false);
  const touchDriveActive = useRef(false);
  const controlPreferencesDirty = useRef(false);
  const controlPreferencesRevision = useRef(0);
  const controlPreferencesPending = useRef<RobotControlSettings | null>(null);
  const controlPreferencesSaveTimer = useRef<number | null>(null);
  const controlPreferencesSaveChain = useRef<Promise<unknown>>(
    Promise.resolve(),
  );

  const showError = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    setError(
      cause instanceof RobotClientError
        ? cause.message
        : 'Le robot ne répond pas.',
    );
  }, []);

  const updateState = useCallback((next: RobotState) => {
    if (!mounted.current) return;
    stateRef.current = next;
    mode.current = next.operatingMode;
    setState(next);
    setError(null);
  }, []);

  useEffect(() => {
    power.current = powerPercent;
    window.localStorage.setItem(POWER_KEY, powerPercent.toString());
  }, [powerPercent]);
  const updatePowerPercent = useCallback(
    (nextPowerPercent: number) => {
      const next = Math.max(10, Math.min(35, Math.round(nextPowerPercent)));
      power.current = next;
      setPowerPercent(next);
      if (!['exploring', 'navigating'].includes(autonomy?.status ?? 'inactive'))
        return;
      const revision = ++autonomyPowerRevision.current;
      if (autonomyPowerSaveTimer.current !== null)
        window.clearTimeout(autonomyPowerSaveTimer.current);
      autonomyPowerSaveTimer.current = window.setTimeout(() => {
        autonomyPowerSaveTimer.current = null;
        void setRobotAutonomyPower(next)
          .then((saved) => {
            if (mounted.current && autonomyPowerRevision.current === revision)
              setAutonomy(saved);
          })
          .catch(showError);
      }, 200);
    },
    [autonomy?.status, showError],
  );

  useEffect(
    () => () => {
      if (autonomyPowerSaveTimer.current !== null)
        window.clearTimeout(autonomyPowerSaveTimer.current);
    },
    [],
  );
  const updateControlPreferences = useCallback(
    (preferences: RobotControlSettings) => {
      const nextPreferences = {
        steeringTrimPercent: Math.max(
          -10,
          Math.min(10, Math.round(preferences.steeringTrimPercent)),
        ),
        panoramaPulseMs: Math.max(
          120,
          Math.min(1_000, Math.round(preferences.panoramaPulseMs)),
        ),
      };
      const revision = ++controlPreferencesRevision.current;
      controlPreferencesDirty.current = true;
      controlPreferencesPending.current = nextPreferences;
      setControlPreferences((current) => ({
        steeringTrimPercent: nextPreferences.steeringTrimPercent,
        updatedAt: current?.updatedAt ?? null,
      }));
      setPanoramaPreferences((current) => ({
        panoramaPulseMs: nextPreferences.panoramaPulseMs,
        updatedAt: current?.updatedAt ?? null,
      }));
      if (controlPreferencesSaveTimer.current !== null)
        window.clearTimeout(controlPreferencesSaveTimer.current);
      controlPreferencesSaveTimer.current = window.setTimeout(() => {
        controlPreferencesSaveTimer.current = null;
        controlPreferencesPending.current = null;
        controlPreferencesSaveChain.current =
          controlPreferencesSaveChain.current
            .catch(() => undefined)
            .then(() =>
              Promise.all([
                setRobotControlPreferences(nextPreferences.steeringTrimPercent),
                setRobotPanoramaPreferences(nextPreferences.panoramaPulseMs),
              ]),
            )
            .then(([savedControlPreferences, savedPanoramaPreferences]) => {
              if (
                !mounted.current ||
                controlPreferencesRevision.current !== revision
              )
                return;
              controlPreferencesDirty.current = false;
              window.localStorage.removeItem(LEGACY_TRIM_KEY);
              setControlPreferences(savedControlPreferences);
              setPanoramaPreferences(savedPanoramaPreferences);
            })
            .catch((cause: unknown) => {
              if (
                !mounted.current ||
                controlPreferencesRevision.current !== revision
              )
                return;
              controlPreferencesDirty.current = false;
              showError(cause);
            });
      }, 250);
    },
    [showError],
  );

  useEffect(
    () => () => {
      if (controlPreferencesSaveTimer.current !== null)
        window.clearTimeout(controlPreferencesSaveTimer.current);
      if (controlPreferencesPending.current !== null) {
        const pendingPreferences = controlPreferencesPending.current;
        controlPreferencesPending.current = null;
        controlPreferencesSaveChain.current =
          controlPreferencesSaveChain.current
            .catch(() => undefined)
            .then(() =>
              Promise.all([
                setRobotControlPreferences(
                  pendingPreferences.steeringTrimPercent,
                ),
                setRobotPanoramaPreferences(pendingPreferences.panoramaPulseMs),
              ]),
            );
      }
    },
    [],
  );

  const stopDriveLoop = useCallback(
    (sendStop = true) => {
      const active = driveTimer.current !== null;
      if (driveTimer.current !== null) window.clearInterval(driveTimer.current);
      driveTimer.current = null;
      driveCommand.current = null;
      driveInFlight.current = false;
      if (active && sendStop)
        void haltRobot().then(updateState).catch(showError);
    },
    [showError, updateState],
  );

  const sendDrive = useCallback(
    (command: DriveCommand) => {
      if (driveInFlight.current) return;
      driveInFlight.current = true;
      void driveRobot(command.direction, power.current / 100, command.steering)
        .then(updateState)
        .catch((cause: unknown) => {
          stopDriveLoop(false);
          showError(cause);
        })
        .finally(() => {
          driveInFlight.current = false;
        });
    },
    [showError, stopDriveLoop, updateState],
  );

  const startDrive = useCallback(
    (command: DriveCommand) => {
      driveCommand.current = command;
      sendDrive(command);
      if (driveTimer.current === null)
        driveTimer.current = window.setInterval(() => {
          if (driveCommand.current) sendDrive(driveCommand.current);
        }, 180);
    },
    [sendDrive],
  );

  const canDrive =
    isOwner &&
    controlPreferences !== null &&
    state?.available === true &&
    state.connected &&
    state.actuators.wheelsEnabled &&
    state.operatingMode === 'manual';
  const canLook =
    isOwner &&
    state?.capabilities.includes('camera_look') === true &&
    state.actuators.cameraServosEnabled &&
    state.operatingMode === 'manual' &&
    !state.moving &&
    !busy;

  const moveCameraByDelta = useCallback(
    async (panDelta: number, tiltDelta: number) => {
      const current = stateRef.current;
      if (
        !isOwner ||
        !current ||
        current.operatingMode !== 'manual' ||
        current.moving ||
        !current.actuators.cameraServosEnabled ||
        !current.capabilities.includes('camera_look') ||
        busyRef.current ||
        cameraMoveInFlight.current
      )
        return;
      busyRef.current = true;
      cameraMoveInFlight.current = true;
      setBusy(true);
      try {
        const next = nextCameraPose(current.cameraPose, panDelta, tiltDelta);
        updateState(await lookRobotCamera(next.pan, next.tilt));
      } catch (cause) {
        showError(cause);
      } finally {
        cameraMoveInFlight.current = false;
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [isOwner, showError, updateState],
  );

  const {
    beginTouchDrive,
    endTouchDrive,
    status: gamepadStatus,
  } = useRobotGamepad({
    active: isOwner && state?.operatingMode === 'manual',
    canDrive,
    canLook,
    enabled: isOwner,
    onCameraGesture: moveCameraByDelta,
    onDrive: startDrive,
    onDriveRelease: stopDriveLoop,
    powerPercent,
    steeringTrimPercent,
  });

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void Promise.all([
        getRobotState(),
        getRobotGraph(),
        getRobotAutonomy(),
        getRobotDisplayPreferences(),
        getRobotControlPreferences(),
        getRobotPanoramaPreferences(),
      ])
        .then(
          ([
            nextState,
            nextGraph,
            nextAutonomy,
            nextDisplayPreferences,
            nextControlPreferences,
            nextPanoramaPreferences,
          ]) => {
            updateState(nextState);
            if (mounted.current) {
              setGraph(nextGraph);
              setAutonomy(nextAutonomy);
              setDisplayPreferences(nextDisplayPreferences);
              if (!controlPreferencesDirty.current) {
                const legacyTrim =
                  isOwner && nextControlPreferences.updatedAt === null
                    ? readLegacySteeringTrim()
                    : null;
                if (legacyTrim === null) {
                  if (nextControlPreferences.updatedAt !== null)
                    window.localStorage.removeItem(LEGACY_TRIM_KEY);
                  setControlPreferences(nextControlPreferences);
                  setPanoramaPreferences(nextPanoramaPreferences);
                } else
                  updateControlPreferences({
                    panoramaPulseMs: nextPanoramaPreferences.panoramaPulseMs,
                    steeringTrimPercent: legacyTrim,
                  });
              }
            }
          },
        )
        .catch(showError);
    };
    refresh();
    const timer = window.setInterval(refresh, graphVisible ? 1_000 : 750);
    const release = () => {
      if (!touchDriveActive.current) return;
      touchDriveActive.current = false;
      endTouchDrive();
      stopDriveLoop();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') stopDriveLoop(true);
      else refresh();
    };
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', visibility);
      touchDriveActive.current = false;
      endTouchDrive();
      stopDriveLoop(false);
      if (mode.current === 'manual') stopRobotOnPageExit();
    };
  }, [
    endTouchDrive,
    graphVisible,
    isOwner,
    showError,
    stopDriveLoop,
    updateState,
    updateControlPreferences,
  ]);

  const mutate = async (operation: () => Promise<void>) => {
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
      setError(null);
    } catch (cause) {
      showError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const setActuator = (
    key: keyof RobotState['actuators'],
    enabled: boolean,
  ) => {
    if (!state) return;
    if (key === 'wheelsEnabled' && !enabled) stopDriveLoop();
    void mutate(async () => {
      const next = await setRobotActuators({
        ...state.actuators,
        [key]: enabled,
      });
      updateState(next);
    });
  };

  const startAutonomy = (targetPlaceId?: string, allowCandidatePath = false) =>
    mutate(async () => {
      const response = await startRobotAutonomy(
        powerPercent,
        steeringTrimPercent,
        targetPlaceId,
        allowCandidatePath,
      );
      updateState(response.state);
      setGraph(response.graph);
      setAutonomy(response.autonomy);
      setGraphVisible(false);
    });

  const changeMode = (nextMode: 'manual' | 'autonomous') =>
    mutate(async () => {
      if (nextMode === 'autonomous') {
        if (autonomy?.status === 'recovering') {
          const response = await finishRobotHumanRecovery();
          updateState(response.state);
          setGraph(response.graph);
          setAutonomy(response.autonomy);
        } else await startAutonomy();
      } else {
        updateState(await setRobotMode('manual'));
        setAutonomy(await getRobotAutonomy());
      }
    });

  const toggleNetworkStandby = () =>
    mutate(async () => {
      if (powerState === 'awake') {
        if (
          autonomy &&
          autonomy.status !== 'inactive' &&
          !window.confirm(
            'L’autonomie ou une récupération est active. La mettre en veille et oublier ce run ?',
          )
        )
          return;
        stopDriveLoop();
        updateState(await sleepRobotNetwork());
        setAutonomy(await getRobotAutonomy());
      } else {
        updateState(await wakeRobotNetwork());
        setAutonomy(await getRobotAutonomy());
      }
    });

  const visibleDetections = useMemo(() => {
    if (displayPreferences?.recognitionVisible === false || !state?.vision)
      return [];
    return state.vision.detections;
  }, [displayPreferences?.recognitionVisible, state]);

  if (graphVisible && graph)
    return (
      <RobotGraphView
        graph={graph}
        busy={busy}
        error={error}
        isOwner={isOwner}
        onClose={() => setGraphVisible(false)}
        onDeleteObject={(id) =>
          void mutate(async () => setGraph(await deleteRobotVisualObject(id)))
        }
        onDeletePlace={(id) =>
          void mutate(async () => setGraph(await deleteRobotVisualPlace(id)))
        }
        onMergePlaces={(targetId, sourceId) =>
          void mutate(async () =>
            setGraph(await mergeRobotVisualPlaces(targetId, sourceId)),
          )
        }
        onNavigate={(placeId) => void startAutonomy(placeId)}
        onTestRoute={(placeId) => void startAutonomy(placeId, true)}
        onRename={(id, currentName) => {
          const name = window.prompt('Nom de cet objet', currentName)?.trim();
          if (!name || name === currentName) return;
          void mutate(async () =>
            setGraph(await renameRobotVisualObject(id, name)),
          );
        }}
        onRenamePlace={(id, currentName) => {
          const name = window
            .prompt('Nom de ce repère ou de cette pièce', currentName)
            ?.trim();
          if (!name || name === currentName) return;
          void mutate(async () =>
            setGraph(await renameRobotVisualPlace(id, name)),
          );
        }}
      />
    );

  return (
    <section className="screen robot-view" aria-label="Robot">
      <div className="robot-topbar">
        <span
          className={`robot-state is-${state?.moving ? 'moving' : state?.actuators.wheelsEnabled ? 'armed' : state?.connected ? 'connected' : 'offline'}`}
          role="status"
        >
          {stateLabel(state)}
        </span>
        <div className="robot-actuator-switches" aria-label="Actionneurs">
          <ActuatorSwitch
            label="Roues"
            checked={state?.actuators.wheelsEnabled ?? false}
            disabled={!isOwner || busy || !state?.available}
            onChange={(value) => setActuator('wheelsEnabled', value)}
          />
          <ActuatorSwitch
            label="Caméra"
            checked={state?.actuators.cameraServosEnabled ?? false}
            disabled={!isOwner || busy || !state?.available}
            onChange={(value) => setActuator('cameraServosEnabled', value)}
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
          disabled={!isOwner || busy || powerState !== 'awake'}
          onClick={() => void changeMode('manual')}
          type="button"
        >
          Manuel
        </button>
        <button
          className={state?.operatingMode === 'autonomous' ? 'is-active' : ''}
          disabled={
            !isOwner ||
            busy ||
            powerState !== 'awake' ||
            controlPreferences === null ||
            !state?.cameraAvailable ||
            !state.actuators.wheelsEnabled
          }
          onClick={() => void changeMode('autonomous')}
          type="button"
        >
          {autonomy?.status === 'recovering' ? 'Rendre la main' : 'Autonome'}
        </button>
        {autonomy && !['inactive', 'recovering'].includes(autonomy.status) ? (
          <button
            className="is-recovery"
            disabled={!isOwner || busy}
            type="button"
            onClick={() =>
              void mutate(async () => {
                const response = await startRobotHumanRecovery();
                updateState(response.state);
                setGraph(response.graph);
                setAutonomy(response.autonomy);
              })
            }
          >
            Récup
          </button>
        ) : null}
        {hasNetworkStandby ? (
          <button
            className="robot-power-button"
            disabled={!isOwner || busy || powerState === 'transitioning'}
            type="button"
            onClick={() => void toggleNetworkStandby()}
          >
            {powerState === 'awake' ? 'Mettre en veille' : 'Réveiller'}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!graph}
          onClick={() => setGraphVisible(true)}
        >
          Repères
        </button>
      </div>

      <small className="robot-map-status">
        Repères visuels · {graph?.places.length.toString() ?? '0'} lieux ·{' '}
        {graph?.objects.length.toString() ?? '0'} objets · apprentissage continu
        en Manuel et Autonome
      </small>
      {autonomy?.status !== 'inactive' ? (
        <small
          className={`robot-map-status${autonomy?.status === 'recovering' ? ' is-recovery' : ''}`}
          role="status"
        >
          {autonomy?.status} · {autonomy?.action ?? 'observation'} · confiance{' '}
          {Math.round((autonomy?.confidence ?? 0) * 100).toString()} % ·{' '}
          {autonomy?.reason ?? ''}
        </small>
      ) : null}

      {powerState !== 'awake' ? (
        <section className="panel robot-sleep-panel" aria-live="polite">
          <h2>Robot en veille réseau</h2>
          <p>
            Les moteurs, servos, la caméra et la reconnaissance sont arrêtés. La
            carte et les repères restent disponibles sur ce PC.
          </p>
        </section>
      ) : (
        <>
          <section className="robot-camera-panel" aria-label="Caméra du robot">
            <div className="robot-camera">
              {state?.cameraAvailable ? (
                <img
                  src={ROBOT_CAMERA_STREAM_URL}
                  alt="Vue en direct du robot"
                />
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
            <button
              aria-pressed={displayPreferences?.recognitionVisible !== false}
              className="robot-overlay-options"
              disabled={!isOwner || busy || displayPreferences === null}
              type="button"
              onClick={() =>
                void mutate(async () => {
                  setDisplayPreferences(
                    await setRobotDisplayPreferences(
                      displayPreferences?.recognitionVisible === false,
                    ),
                  );
                })
              }
            >
              Reco{' '}
              {displayPreferences?.recognitionVisible === false
                ? 'masquée'
                : 'affichée'}
            </button>
            <div
              className="robot-camera-buttons"
              aria-label="Orientation caméra"
            >
              {(
                [
                  ['←', 'Caméra gauche', PAN_NUDGE, 0],
                  ['↑', 'Caméra haut', 0, -TILT_NUDGE],
                  ['•', 'Caméra centrer', 0, 0],
                  ['↓', 'Caméra bas', 0, TILT_NUDGE],
                  ['→', 'Caméra droite', -PAN_NUDGE, 0],
                ] as const
              ).map(([label, accessibleLabel, pan, tilt]) => (
                <button
                  aria-label={accessibleLabel}
                  key={label}
                  disabled={!canLook}
                  type="button"
                  onClick={() =>
                    void moveCameraByDelta(
                      label === '•'
                        ? cameraCenterDelta(state!.cameraPose).pan
                        : pan,
                      label === '•'
                        ? cameraCenterDelta(state!.cameraPose).tilt
                        : tilt,
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <div className="robot-motion-dock" aria-label="Locomotion">
            <div className="robot-drive-column">
              {gamepadStatus ? (
                <small className="robot-gamepad-status" role="status">
                  {gamepadStatus === 'connected'
                    ? 'Manette connectée'
                    : 'Manette incompatible'}
                </small>
              ) : null}
              <JoystickControl
                disabled={!canDrive}
                onEngage={() => {
                  touchDriveActive.current = true;
                  beginTouchDrive();
                }}
                onCommand={startDrive}
                onRelease={() => {
                  touchDriveActive.current = false;
                  endTouchDrive();
                  stopDriveLoop();
                }}
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
                  min="10"
                  max="35"
                  type="range"
                  value={powerPercent}
                  onChange={(event) =>
                    updatePowerPercent(event.target.valueAsNumber)
                  }
                />
              </label>
              <label className="robot-power-control">
                <span>
                  Trim <strong>{steeringTrimPercent.toString()}</strong>
                </span>
                <input
                  aria-label="Trim direction"
                  disabled={!isOwner || controlPreferences === null}
                  min="-10"
                  max="10"
                  type="range"
                  value={steeringTrimPercent}
                  onChange={(event) =>
                    updateControlPreferences({
                      panoramaPulseMs,
                      steeringTrimPercent: event.target.valueAsNumber,
                    })
                  }
                />
              </label>
              <label className="robot-power-control">
                <span>
                  Impulsion 360°{' '}
                  <strong>{panoramaPulseMs.toString()} ms</strong>
                </span>
                <small>
                  Plus longue = rotation plus fluide et plus rapide.
                </small>
                <input
                  aria-label="Durée impulsion panorama 360 degrés"
                  disabled={!isOwner || panoramaPreferences === null}
                  min="120"
                  max="1000"
                  step="20"
                  type="range"
                  value={panoramaPulseMs}
                  onChange={(event) =>
                    updateControlPreferences({
                      panoramaPulseMs: event.target.valueAsNumber,
                      steeringTrimPercent,
                    })
                  }
                />
              </label>
            </div>
          </div>

          <details className="panel robot-telemetry">
            <summary>Télémétrie et diagnostic</summary>
            <dl>
              <div>
                <dt>Température</dt>
                <dd>{state?.telemetry.temperatureC?.toFixed(1) ?? '—'} °C</dd>
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
                  {autonomy?.learningStepCount.toString() ?? '0'} décisions ·{' '}
                  {autonomy?.blockReason
                    ? `état : ${autonomy.blockReason}`
                    : `mouvement : ${autonomy?.motionState ?? 'inconnu'}`}
                </dd>
              </div>
            </dl>
          </details>
        </>
      )}
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
  onEngage,
  onCommand,
  onRelease,
  powerPercent,
  steeringTrimPercent,
}: {
  disabled: boolean;
  onEngage: () => void;
  onCommand: (command: DriveCommand) => void;
  onRelease: () => void;
  powerPercent: number;
  steeringTrimPercent: number;
}) {
  const knob = useRef<HTMLSpanElement>(null);
  const previous = useRef<DriveCommand | null>(null);
  const release = (target?: HTMLButtonElement, pointerId?: number) => {
    if (
      target &&
      pointerId !== undefined &&
      target.hasPointerCapture(pointerId)
    )
      target.releasePointerCapture(pointerId);
    if (knob.current) knob.current.style.transform = 'translate(0, 0)';
    if (previous.current) onRelease();
    previous.current = null;
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      event.type === 'pointermove' &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const rx = box.width * 0.34,
      ry = box.height * 0.28;
    const rawX = event.clientX - box.left - box.width / 2;
    const rawY = event.clientY - box.top - box.height / 2;
    const scale = Math.min(
      1,
      1 / Math.max(1, Math.hypot(rawX / rx, rawY / ry)),
    );
    const x = rawX * scale,
      y = rawY * scale;
    if (knob.current)
      knob.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const base = joystickDriveCommand(x / rx, y / ry, powerPercent / 100);
    if (!base) {
      release();
      return;
    }
    const command = applySteeringTrim(base, steeringTrimPercent / 100);
    if (shouldSendDriveCommand(previous.current, command)) {
      previous.current = command;
      onCommand(command);
    }
  };
  const key = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = (
      {
        ArrowUp: 'forward',
        ArrowDown: 'backward',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      } as Partial<Record<string, RobotDirection>>
    )[event.key];
    if (!direction) return;
    event.preventDefault();
    const command = applySteeringTrim(
      { direction, steering: 0 },
      steeringTrimPercent / 100,
    );
    previous.current = command;
    onCommand(command);
  };
  return (
    <button
      aria-label="Joystick locomotion"
      className="robot-joystick"
      disabled={disabled}
      type="button"
      onKeyDown={key}
      onKeyUp={(event) => {
        if (event.key.startsWith('Arrow')) release();
      }}
      onPointerCancel={(event) => release(event.currentTarget, event.pointerId)}
      onPointerDown={(event) => {
        onEngage();
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
      <span className="robot-joystick-knob" ref={knob} aria-hidden="true" />
    </button>
  );
}

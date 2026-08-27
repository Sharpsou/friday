import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { DriveCommand } from './robot-drive-controls.js';
import {
  advanceRobotGamepadControl,
  claimTouchRobotDrive,
  initialRobotGamepadControlState,
  readRobotGamepadAxes,
  releaseTouchRobotDrive,
  resetRobotGamepadControl,
  selectStandardRobotGamepad,
  type RobotGamepadStatus,
} from './robot-gamepad-controls.js';

interface RobotGamepadOptions {
  active: boolean;
  canDrive: boolean;
  canLook: boolean;
  enabled: boolean;
  onCameraGesture: (panDelta: number, tiltDelta: number) => Promise<void>;
  onDrive: (command: DriveCommand) => void;
  onDriveRelease: (sendStop: boolean) => void;
  powerPercent: number;
  steeringTrimPercent: number;
}

export function useRobotGamepad(options: RobotGamepadOptions) {
  const latest = useRef(options);
  const control = useRef(initialRobotGamepadControlState());
  const selectedIndex = useRef<number | null>(null);
  const cameraRequestInFlight = useRef(false);
  const statusRef = useRef<RobotGamepadStatus>(null);
  const [status, setStatus] = useState<RobotGamepadStatus>(null);

  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);

  const publishStatus = useCallback((next: RobotGamepadStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  const releaseGamepad = useCallback((sendStop: boolean) => {
    const wasDriving = control.current.driveSource === 'gamepad';
    control.current = resetRobotGamepadControl(control.current);
    if (wasDriving) latest.current.onDriveRelease(sendStop);
  }, []);

  useEffect(() => {
    if (!options.enabled || typeof navigator.getGamepads !== 'function') {
      selectedIndex.current = null;
      publishStatus(null);
      releaseGamepad(true);
      return;
    }

    let animationFrame = 0;
    const readSelection = () => {
      const selection = selectStandardRobotGamepad(
        navigator.getGamepads(),
        selectedIndex.current,
      );
      const nextIndex = selection.gamepad?.index ?? null;
      if (nextIndex !== selectedIndex.current) {
        releaseGamepad(true);
        selectedIndex.current = nextIndex;
      }
      publishStatus(selection.status);
      return selection.gamepad;
    };
    const frame = () => {
      const gamepad = readSelection();
      if (gamepad) {
        const current = latest.current;
        const result = advanceRobotGamepadControl(
          control.current,
          readRobotGamepadAxes(gamepad),
          {
            active: current.active && document.visibilityState === 'visible',
            cameraInFlight: cameraRequestInFlight.current,
            canDrive: current.canDrive,
            canLook: current.canLook,
            powerPercent: current.powerPercent,
            steeringTrimPercent: current.steeringTrimPercent,
          },
        );
        control.current = result.state;
        if (result.releaseDrive) current.onDriveRelease(true);
        if (result.driveCommand) current.onDrive(result.driveCommand);
        if (result.cameraDelta) {
          cameraRequestInFlight.current = true;
          void current
            .onCameraGesture(result.cameraDelta.pan, result.cameraDelta.tilt)
            .finally(() => {
              cameraRequestInFlight.current = false;
            });
        }
      }
      animationFrame = window.requestAnimationFrame(frame);
    };
    const connectionChanged = () => {
      readSelection();
    };
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') return;
      releaseGamepad(true);
    };

    window.addEventListener('gamepadconnected', connectionChanged);
    window.addEventListener('gamepaddisconnected', connectionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    animationFrame = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('gamepadconnected', connectionChanged);
      window.removeEventListener('gamepaddisconnected', connectionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
      selectedIndex.current = null;
      releaseGamepad(false);
    };
  }, [options.enabled, publishStatus, releaseGamepad]);

  const beginTouchDrive = useCallback(() => {
    const claimed = claimTouchRobotDrive(control.current);
    control.current = claimed.state;
    if (claimed.releaseDrive) latest.current.onDriveRelease(false);
  }, []);

  const endTouchDrive = useCallback(() => {
    control.current = releaseTouchRobotDrive(control.current);
  }, []);

  return { beginTouchDrive, endTouchDrive, status };
}

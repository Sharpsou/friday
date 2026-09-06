import type { RobotDirection } from '@friday/contracts';
import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  applySteeringTrim,
  joystickDriveCommand,
  shouldSendDriveCommand,
  type DriveCommand,
} from '../robot-drive-controls.js';

export function ActuatorSwitch({
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

export function JoystickControl({
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

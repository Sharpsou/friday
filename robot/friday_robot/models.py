from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


MODES = {"manual", "calibration", "line", "visual_tracking", "markers", "companion"}
DIRECTIONS = {"forward", "backward", "left", "right"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z") if value else None


@dataclass
class Telemetry:
    temperature_c: float | None = None
    throttled_code: str | None = None
    under_voltage_active: bool = False
    under_voltage_occurred: bool = False
    ir_left_clear: bool | None = None
    ir_right_clear: bool | None = None
    line_sensors: list[int] = field(default_factory=lambda: [0] * 5)
    camera_fps: float | None = None
    command_latency_ms: float | None = None

    def json(self) -> dict[str, Any]:
        return {
            "temperatureC": self.temperature_c,
            "throttledCode": self.throttled_code,
            "underVoltageActive": self.under_voltage_active,
            "underVoltageOccurred": self.under_voltage_occurred,
            "irLeftClear": self.ir_left_clear,
            "irRightClear": self.ir_right_clear,
            "lineSensors": self.line_sensors,
            "cameraFps": self.camera_fps,
            "commandLatencyMs": self.command_latency_ms,
        }


@dataclass
class CameraPose:
    pan: float = 0.0
    tilt: float = 0.0


def parse_instant(value: object, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} doit être une date UTC.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field_name} est invalide.") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} doit inclure un fuseau.")
    return parsed.astimezone(timezone.utc)


def strict_object(value: object, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Corps JSON invalide ou champs inattendus.")
    return value

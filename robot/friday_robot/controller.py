from __future__ import annotations

import threading
import time
import uuid
from datetime import timedelta
from typing import Any

from .hardware import Hardware
from .models import CameraPose, DIRECTIONS, MODES, iso, parse_instant, strict_object, utc_now


class CommandRejected(ValueError):
    pass


class RobotController:
    def __init__(self, hardware: Hardware, mode: str) -> None:
        self._hardware = hardware
        self._mode = mode
        self._operating_mode = "manual"
        self._moving_until = None
        self._pose = CameraPose()
        self._wheels_enabled = False
        self._camera_servos_enabled = False
        self._closed = False
        self._lock = threading.RLock()
        self._watchdog_stop = threading.Event()
        self._watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
        self._hardware.set_camera_servos_enabled(False)
        self._watchdog.start()

    def arm(self, payload: object) -> dict[str, Any]:
        body = strict_object(payload, {"durationMs"})
        duration = body["durationMs"]
        if isinstance(duration, bool) or not isinstance(duration, int) or not 1000 <= duration <= 60_000:
            raise CommandRejected("Durée d'armement invalide.")
        with self._lock:
            self._assert_open()
            if not self._wheels_enabled:
                raise CommandRejected("Roues désactivées.")
            # Compatibilité avec les anciens clients : le switch Roues est
            # désormais l'unique autorisation persistante de locomotion.
            return self.state()

    def drive(self, payload: object) -> dict[str, Any]:
        body = strict_object(payload, {"commandId", "issuedAt", "expiresAt", "direction", "intensity", "steering", "maxDurationMs"})
        self._validate_command(body)
        direction, intensity, steering, duration = body["direction"], body["intensity"], body["steering"], body["maxDurationMs"]
        if direction not in DIRECTIONS:
            raise CommandRejected("Direction invalide.")
        if isinstance(intensity, bool) or not isinstance(intensity, (int, float)) or not 0.1 <= intensity <= 0.35:
            raise CommandRejected("Intensité invalide.")
        if isinstance(steering, bool) or not isinstance(steering, (int, float)) or not -1 <= steering <= 1:
            raise CommandRejected("Angle de direction invalide.")
        if isinstance(duration, bool) or not isinstance(duration, int) or not 100 <= duration <= 500:
            raise CommandRejected("Durée de mouvement invalide.")
        with self._lock:
            self._assert_open()
            if not self._wheels_enabled:
                raise CommandRejected("Roues désactivées.")
            now = utc_now()
            if self._operating_mode not in {"manual", "calibration", "autonomous"}:
                raise CommandRejected("Téléopération interdite dans ce mode.")
            try:
                self._hardware.drive(direction, float(intensity), float(steering))
            except Exception:
                self._safe_stop()
                raise
            expires = parse_instant(body["expiresAt"], "expiresAt")
            self._moving_until = min(expires, now + timedelta(milliseconds=duration))
            return self.state()

    def look(self, payload: object) -> dict[str, Any]:
        body = strict_object(payload, {"commandId", "issuedAt", "expiresAt", "pan", "tilt"})
        self._validate_command(body)
        pan, tilt = body["pan"], body["tilt"]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not -1 <= v <= 1 for v in (pan, tilt)):
            raise CommandRejected("Position caméra invalide.")
        pose = CameraPose(float(pan), float(tilt))
        with self._lock:
            self._assert_open()
            if not self._camera_servos_enabled:
                raise CommandRejected("Servos caméra désactivés.")
            self._hardware.look(pose)
            self._pose = pose
            return self.state()

    def set_actuators(self, payload: object) -> dict[str, Any]:
        body = strict_object(payload, {"wheelsEnabled", "cameraServosEnabled"})
        wheels_enabled = body["wheelsEnabled"]
        camera_servos_enabled = body["cameraServosEnabled"]
        if not isinstance(wheels_enabled, bool) or not isinstance(camera_servos_enabled, bool):
            raise CommandRejected("État des actionneurs invalide.")
        with self._lock:
            self._assert_open()
            if not wheels_enabled:
                self._safe_stop()
            self._hardware.set_camera_servos_enabled(camera_servos_enabled)
            self._wheels_enabled = wheels_enabled
            self._camera_servos_enabled = camera_servos_enabled
            return self.state()

    def set_mode(self, payload: object) -> dict[str, Any]:
        body = strict_object(payload, {"mode"})
        if body["mode"] not in MODES:
            raise CommandRejected("Mode invalide.")
        with self._lock:
            self._safe_stop()
            self._operating_mode = body["mode"]
            return self.state()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._safe_stop()
            return self.state()

    def halt(self) -> dict[str, Any]:
        with self._lock:
            self._safe_stop()
            return self.state()

    def state(self) -> dict[str, Any]:
        with self._lock:
            self._expire()
            now = utc_now()
            telemetry = self._hardware.telemetry()
            return {
                "available": not self._closed,
                "connected": not self._closed,
                "armed": self._wheels_enabled,
                "mode": self._mode,
                "cameraAvailable": "camera_stream" in self._hardware.capabilities,
                "actuators": {
                    "wheelsEnabled": self._wheels_enabled,
                    "cameraServosEnabled": self._camera_servos_enabled,
                },
                "moving": bool(self._moving_until and self._moving_until > now),
                "lastSeenAt": iso(now),
                "warning": None,
                "capabilities": self._hardware.capabilities,
                "operatingMode": self._operating_mode,
                "controlExpiresAt": None,
                "cameraPose": {"pan": self._pose.pan, "tilt": self._pose.tilt},
                "telemetry": telemetry.json(),
                "vision": None,
            }

    def open_camera(self, profile: str = "normal"):
        return self._hardware.open_camera(profile)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._safe_stop()
            self._closed = True
            self._watchdog_stop.set()
            self._hardware.close()

    def _validate_command(self, body: dict[str, Any]) -> None:
        try:
            uuid.UUID(str(body["commandId"]))
        except (ValueError, AttributeError) as error:
            raise CommandRejected("Identifiant de commande invalide.") from error
        issued = parse_instant(body["issuedAt"], "issuedAt")
        expires = parse_instant(body["expiresAt"], "expiresAt")
        now = utc_now()
        if issued > now + timedelta(seconds=2) or issued < now - timedelta(seconds=5):
            raise CommandRejected("Commande trop ancienne ou future.")
        if expires <= now or expires > now + timedelta(seconds=2):
            raise CommandRejected("Commande expirée ou trop longue.")

    def _watchdog_loop(self) -> None:
        while not self._watchdog_stop.wait(0.025):
            with self._lock:
                self._expire()

    def _expire(self) -> None:
        now = utc_now()
        if self._moving_until and self._moving_until <= now:
            self._safe_stop()

    def _safe_stop(self) -> None:
        try:
            self._hardware.stop()
        finally:
            self._moving_until = None

    def _assert_open(self) -> None:
        if self._closed:
            raise RuntimeError("Robot arrêté.")

"""Minimal authenticated network-standby agent for Friday's Raspberry Pi."""

from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol


class ServiceManager(Protocol):
    def sleep(self) -> None: ...
    def wake(self) -> None: ...
    def status(self, service: str) -> str: ...


class SystemdServiceManager:
    def sleep(self) -> None:
        subprocess.run(["sudo", "-n", "/usr/local/libexec/friday-services-sleep"], check=True, timeout=20)

    def wake(self) -> None:
        subprocess.run(["sudo", "-n", "/usr/local/libexec/friday-services-wake"], check=True, timeout=20)

    def status(self, service: str) -> str:
        result = subprocess.run(
            ["systemctl", "is-active", service], capture_output=True, text=True, timeout=2, check=False
        )
        value = result.stdout.strip()
        return value if value in {"active", "inactive", "failed"} else "unknown"


class WakeState:
    def __init__(self, state_file: Path, manager: ServiceManager):
        self.state_file = state_file
        self.manager = manager
        self.desired = self._read_desired()
        self.transitioning = False
        self.message: str | None = None
        self.lock = threading.RLock()

    def _read_desired(self) -> str:
        try:
            value = self.state_file.read_text(encoding="utf-8").strip()
            return value if value in {"awake", "sleeping"} else "awake"
        except FileNotFoundError:
            return "awake"

    def _write_desired(self, value: str) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_file.with_suffix(".tmp")
        temporary.write_text(value + "\n", encoding="utf-8")
        temporary.replace(self.state_file)
        self.desired = value

    def apply_desired(self) -> None:
        (self.manager.wake if self.desired == "awake" else self.manager.sleep)()

    def set_desired(self, value: str) -> None:
        with self.lock:
            if value == self.desired and self.power_state() == value:
                return
            self.transitioning = True
            self.message = None
            self._write_desired(value)
            try:
                (self.manager.wake if value == "awake" else self.manager.sleep)()
            except Exception as error:
                self.message = f"Transition incomplète: {error}"
                raise
            finally:
                self.transitioning = False

    def power_state(self) -> str:
        if self.transitioning:
            return "transitioning"
        robot = self.manager.status("friday-robot.service")
        camera = self.manager.status("friday-camera.service")
        if self.desired == "sleeping" and robot == camera == "inactive":
            return "sleeping"
        if self.desired == "awake" and robot == camera == "active":
            return "awake"
        return "degraded"

    def payload(self) -> dict[str, object]:
        with self.lock:
            return {
                "powerState": self.power_state(),
                "robotService": self.manager.status("friday-robot.service"),
                "cameraService": self.manager.status("friday-camera.service"),
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "message": self.message,
            }


def handler_factory(state: WakeState, token: str, allowed_ip: str | None = None):
    class WakeHandler(BaseHTTPRequestHandler):
        def _authorized(self) -> bool:
            if allowed_ip is not None and self.client_address[0] != allowed_ip:
                return False
            supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
            return hmac.compare_digest(supplied, token)

        def _send(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if not self._authorized():
                self._send(401, {"error": "unauthorized"})
            elif self.path == "/state":
                self._send(200, state.payload())
            else:
                self._send(404, {"error": "not_found"})

        def do_POST(self) -> None:
            if not self._authorized():
                self._send(401, {"error": "unauthorized"})
                return
            if self.path not in {"/sleep", "/wake"}:
                self._send(404, {"error": "not_found"})
                return
            try:
                state.set_desired("sleeping" if self.path == "/sleep" else "awake")
                self._send(200, state.payload())
            except Exception:
                self._send(503, state.payload())

        def log_message(self, format: str, *args: object) -> None:
            return

    return WakeHandler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("FRIDAY_WAKE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FRIDAY_WAKE_PORT", "8764")))
    parser.add_argument("--state-file", type=Path, default=Path(os.environ.get("FRIDAY_WAKE_STATE_FILE", "/var/lib/friday-wake/desired-state")))
    args = parser.parse_args()
    token = os.environ.get("FRIDAY_WAKE_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("FRIDAY_WAKE_TOKEN doit contenir au moins 32 caractères")
    allowed_ip = os.environ.get("FRIDAY_WAKE_ALLOWED_IP", "192.168.1.14")
    try:
        address = ipaddress.ip_address(allowed_ip)
        if address.version != 4 or not address.is_private:
            raise ValueError
    except ValueError:
        raise SystemExit("FRIDAY_WAKE_ALLOWED_IP doit être une adresse IPv4 privée") from None
    state = WakeState(args.state_file, SystemdServiceManager())
    try:
        state.apply_desired()
    except Exception as error:
        state.message = f"État désiré non appliqué au démarrage: {error}"
    ThreadingHTTPServer((args.host, args.port), handler_factory(state, token, allowed_ip)).serve_forever()


if __name__ == "__main__":
    main()

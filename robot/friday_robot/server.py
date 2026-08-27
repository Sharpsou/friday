from __future__ import annotations

import hmac
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, BinaryIO, Iterator
from urllib.parse import parse_qs, urlparse

from .controller import CommandRejected, RobotController


MAX_BODY = 8_192
LOGGER = logging.getLogger(__name__)


def iter_low_latency_chunks(
    stream: BinaryIO, chunk_size: int = 16 * 1024
) -> Iterator[bytes]:
    """Lit ce qui est disponible sans attendre le remplissage d'un gros tampon."""
    read1 = getattr(stream, "read1", None)
    reader = read1 if callable(read1) else stream.read
    while chunk := reader(chunk_size):
        yield chunk


def handler_factory(controller: RobotController, token: str):
    class RobotHandler(BaseHTTPRequestHandler):
        server_version = "FridayRobot/0.1"

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                return
            parsed = urlparse(self.path)
            if parsed.path == "/state":
                try:
                    self._json(200, controller.state())
                except Exception:
                    controller.stop()
                    self._json(503, {"error": "Télémétrie indisponible."})
            elif parsed.path == "/camera/stream":
                profile = parse_qs(parsed.query).get("profile", ["normal"])[0]
                if profile not in {"normal", "reduced"}:
                    self._json(400, {"error": "Profil caméra invalide."})
                    return
                self._camera(profile)
            else:
                self._json(404, {"error": "Route inconnue."})

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                return
            try:
                if self.path == "/stop":
                    result = controller.stop()
                elif self.path == "/halt":
                    result = controller.halt()
                else:
                    body = self._body()
                    routes = {
                        "/arm": controller.arm,
                        "/drive": controller.drive,
                        "/camera/look": controller.look,
                        "/actuators": controller.set_actuators,
                        "/mode": controller.set_mode,
                    }
                    action = routes.get(self.path)
                    if action is None:
                        self._json(404, {"error": "Route inconnue."})
                        return
                    result = action(body)
                self._json(200, {"accepted": True, "state": result})
            except (CommandRejected, ValueError, json.JSONDecodeError) as error:
                self._json(400, {"error": str(error)})
            except Exception:
                LOGGER.exception("Échec d'une commande matérielle sur %s", self.path)
                controller.stop()
                self._json(503, {"error": "Commande matérielle indisponible."})

        def _authorized(self) -> bool:
            supplied = self.headers.get("Authorization", "")
            expected = f"Bearer {token}"
            if not hmac.compare_digest(supplied.encode(), expected.encode()):
                self._json(401, {"error": "Authentification requise."})
                return False
            return True

        def _body(self) -> Any:
            content_type = self.headers.get_content_type()
            length_text = self.headers.get("Content-Length")
            if content_type != "application/json" or not length_text:
                raise ValueError("Corps JSON requis.")
            length = int(length_text)
            if length < 0 or length > MAX_BODY:
                raise ValueError("Corps trop volumineux.")
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def _json(self, status: int, payload: object) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _camera(self, profile: str) -> None:
            headers_sent = False
            try:
                stream, content_type = controller.open_camera(profile)
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                headers_sent = True
                try:
                    for chunk in iter_low_latency_chunks(stream):
                        self.wfile.write(chunk)
                        self.wfile.flush()
                finally:
                    stream.close()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                if not headers_sent and not self.wfile.closed:
                    self._json(503, {"error": "Caméra indisponible."})

        def log_message(self, format: str, *args: object) -> None:
            del format, args

    return RobotHandler


def create_server(bind: str, port: int, controller: RobotController, token: str) -> ThreadingHTTPServer:
    if len(token) < 32:
        raise ValueError("FRIDAY_ROBOT_TOKEN doit contenir au moins 32 caractères.")
    return ThreadingHTTPServer((bind, port), handler_factory(controller, token))

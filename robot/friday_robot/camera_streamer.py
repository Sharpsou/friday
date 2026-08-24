from __future__ import annotations

import os
import shutil
import signal
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import BinaryIO, Iterator


SOI = b"\xff\xd8"
EOI = b"\xff\xd9"
BOUNDARY = b"FRAME"
MAX_FRAME_BYTES = 4 * 1024 * 1024


def iter_jpeg_frames(stream: BinaryIO, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
    buffer = bytearray()
    while chunk := stream.read(chunk_size):
        buffer.extend(chunk)
        while True:
            start = buffer.find(SOI)
            if start < 0:
                if len(buffer) > 1:
                    del buffer[:-1]
                break
            if start:
                del buffer[:start]
            end = buffer.find(EOI, 2)
            if end < 0:
                if len(buffer) > MAX_FRAME_BYTES:
                    raise RuntimeError("Image caméra trop volumineuse.")
                break
            end += len(EOI)
            yield bytes(buffer[:end])
            del buffer[:end]


def camera_command() -> list[str]:
    executable = shutil.which("rpicam-vid")
    if not executable:
        raise RuntimeError("rpicam-vid est introuvable.")
    width = _bounded_int("FRIDAY_CAMERA_WIDTH", 640, 160, 1920)
    height = _bounded_int("FRIDAY_CAMERA_HEIGHT", 360, 120, 1080)
    fps = _bounded_int("FRIDAY_CAMERA_FPS", 10, 1, 30)
    quality = _bounded_int("FRIDAY_CAMERA_QUALITY", 70, 20, 95)
    return [
        executable,
        "--timeout", "0",
        "--nopreview",
        "--width", str(width),
        "--height", str(height),
        "--framerate", str(fps),
        "--codec", "mjpeg",
        "--quality", str(quality),
        "--output", "-",
    ]


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} doit être compris entre {minimum} et {maximum}.")
    return value


class CameraHandler(BaseHTTPRequestHandler):
    server_version = "FridayCamera/0.1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/stream":
            self.send_error(404)
            return
        process: subprocess.Popen[bytes] | None = None
        try:
            process = subprocess.Popen(  # noqa: S603
                camera_command(),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            if process.stdout is None:
                raise RuntimeError("Sortie caméra indisponible.")
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            for frame in iter_jpeg_frames(process.stdout):
                self.wfile.write(
                    b"--" + BOUNDARY + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                    + frame + b"\r\n"
                )
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            if not self.wfile.closed:
                try:
                    self.send_error(503)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


class CameraServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    server = CameraServer(("127.0.0.1", 8080), CameraHandler)

    def shutdown(*_: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

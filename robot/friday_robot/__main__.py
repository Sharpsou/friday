from __future__ import annotations

import argparse
import os
import signal
import threading

from .controller import RobotController
from .hardware import AlphaBot2Hardware, SimulatedHardware
from .server import create_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Service embarqué Friday Robot")
    parser.add_argument("--mode", choices=("simulated", "alphabot2"), default=os.environ.get("FRIDAY_ROBOT_MODE", "simulated"))
    args = parser.parse_args()
    bind = os.environ.get("FRIDAY_ROBOT_BIND", "127.0.0.1")
    port = int(os.environ.get("FRIDAY_ROBOT_PORT", "8765"))
    token = os.environ.get("FRIDAY_ROBOT_TOKEN", "")
    camera_url = os.environ.get("FRIDAY_ROBOT_CAMERA_URL")
    hardware = SimulatedHardware(camera_url) if args.mode == "simulated" else AlphaBot2Hardware(camera_url)
    controller = RobotController(hardware, args.mode)
    server = create_server(bind, port, controller, token)

    def shutdown(*_: object) -> None:
        controller.stop()
        # BaseServer.shutdown doit être appelé depuis un autre thread que
        # serve_forever, y compris lorsqu'un signal arrive sur le thread principal.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        controller.close()
        server.server_close()


if __name__ == "__main__":
    main()

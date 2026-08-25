from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from friday_robot.controller import RobotController
from friday_robot.hardware import SimulatedHardware
from friday_robot.server import create_server, iter_low_latency_chunks


TOKEN = "x" * 32


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.controller = RobotController(SimulatedHardware(), "simulated")
        self.server = create_server("127.0.0.1", 0, self.controller, TOKEN)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.controller.close()

    def request(self, path, method="GET", body=None, token=TOKEN):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Authorization": f"Bearer {token}", **({"Content-Type": "application/json"} if data else {})},
        )
        return urllib.request.urlopen(request, timeout=2)

    def test_requires_bearer_token(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("/state", token="wrong")
        self.assertEqual(context.exception.code, 401)
        context.exception.close()

    def test_state_and_arm(self):
        state = json.load(self.request("/state"))
        self.assertEqual(state["mode"], "simulated")
        self.assertFalse(state["actuators"]["wheelsEnabled"])
        enabled = json.load(self.request("/actuators", "POST", {
            "wheelsEnabled": True,
            "cameraServosEnabled": False,
        }))
        self.assertTrue(enabled["state"]["actuators"]["wheelsEnabled"])
        armed = json.load(self.request("/arm", "POST", {"durationMs": 1000}))
        self.assertTrue(armed["accepted"])
        self.assertTrue(armed["state"]["armed"])

    def test_rejects_non_json_and_large_token_configuration(self):
        with self.assertRaises(ValueError):
            create_server("127.0.0.1", 0, self.controller, "short")

    def test_camera_proxy_prefers_non_blocking_read1_chunks(self):
        class Stream:
            def __init__(self):
                self.chunks = iter((b"frame-1", b"frame-2", b""))

            def read1(self, size):
                self.asserted_size = size
                return next(self.chunks)

            def read(self, size):
                raise AssertionError(f"read({size}) ne doit pas être utilisé")

        stream = Stream()
        self.assertEqual(
            list(iter_low_latency_chunks(stream)),
            [b"frame-1", b"frame-2"],
        )
        self.assertEqual(stream.asserted_size, 16 * 1024)


if __name__ == "__main__":
    unittest.main()

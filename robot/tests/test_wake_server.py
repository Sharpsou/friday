import tempfile
import threading
import urllib.error
import urllib.request
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from friday_robot.wake_server import WakeState, handler_factory


class FakeServices:
    def __init__(self):
        self.robot = "active"
        self.camera = "active"
        self.sleep_calls = 0
        self.wake_calls = 0

    def sleep(self):
        self.sleep_calls += 1
        self.robot = self.camera = "inactive"

    def wake(self):
        self.wake_calls += 1
        self.camera = self.robot = "active"

    def status(self, service):
        return self.robot if "robot" in service else self.camera


class WakeStateTests(unittest.TestCase):
    def test_http_api_requires_the_distinct_bearer_token(self):
        with tempfile.TemporaryDirectory() as directory:
            services = FakeServices()
            state = WakeState(Path(directory) / "desired-state", services)
            server = ThreadingHTTPServer(
                ("127.0.0.1", 0), handler_factory(state, "x" * 32)
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}/state"
            try:
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    urllib.request.urlopen(url, timeout=2)
                self.assertEqual(rejected.exception.code, 401)
                rejected.exception.close()
                request = urllib.request.Request(
                    url, headers={"Authorization": f"Bearer {'x' * 32}"}
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 200)
            finally:
                server.shutdown()
                server.server_close()

    def test_sleep_and_wake_are_persisted_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            services = FakeServices()
            path = Path(directory) / "desired-state"
            state = WakeState(path, services)

            state.set_desired("sleeping")
            state.set_desired("sleeping")
            self.assertEqual(state.power_state(), "sleeping")
            self.assertEqual(services.sleep_calls, 1)
            self.assertEqual(path.read_text(encoding="utf-8"), "sleeping\n")

            state.set_desired("awake")
            self.assertEqual(state.power_state(), "awake")
            self.assertEqual(services.wake_calls, 1)

    def test_service_mismatch_is_degraded_not_sleeping(self):
        with tempfile.TemporaryDirectory() as directory:
            services = FakeServices()
            state = WakeState(Path(directory) / "desired-state", services)
            services.camera = "inactive"
            self.assertEqual(state.power_state(), "degraded")


if __name__ == "__main__":
    unittest.main()

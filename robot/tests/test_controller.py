from __future__ import annotations

import sys
import time
import unittest
import uuid
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from friday_robot.controller import CommandRejected, RobotController
from friday_robot.hardware import SimulatedHardware, differential_wheel_commands, validate_camera_url
from friday_robot.models import iso, utc_now


def command(**extra):
    now = utc_now()
    return {
        "commandId": str(uuid.uuid4()),
        "issuedAt": iso(now),
        "expiresAt": iso(now + timedelta(milliseconds=400)),
        **extra,
    }


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.hardware = SimulatedHardware()
        self.controller = RobotController(self.hardware, "simulated")

    def tearDown(self):
        self.controller.close()

    def test_drive_requires_arm_and_stops_after_ttl(self):
        payload = command(direction="forward", intensity=0.2, steering=0, maxDurationMs=100)
        with self.assertRaises(CommandRejected):
            self.controller.drive(payload)
        self.controller.set_actuators({
            "wheelsEnabled": True,
            "cameraServosEnabled": False,
        })
        self.controller.arm({"durationMs": 1000})
        self.assertTrue(self.controller.drive(payload)["moving"])
        halted = self.controller.halt()
        self.assertFalse(halted["moving"])
        self.assertTrue(halted["armed"])
        self.assertTrue(self.controller.drive(payload)["moving"])
        time.sleep(0.16)
        self.assertFalse(self.controller.state()["moving"])
        self.assertFalse(self.hardware.moving)

    def test_mode_change_stops_and_disarms(self):
        self.controller.set_actuators({
            "wheelsEnabled": True,
            "cameraServosEnabled": False,
        })
        self.controller.arm({"durationMs": 1000})
        self.controller.drive(command(direction="left", intensity=0.2, steering=0, maxDurationMs=300))
        state = self.controller.set_mode({"mode": "line"})
        self.assertFalse(state["moving"])
        self.assertFalse(state["armed"])

    def test_actuator_switches_default_off_and_cut_motion(self):
        self.assertEqual(self.controller.state()["actuators"], {
            "wheelsEnabled": False,
            "cameraServosEnabled": False,
        })
        enabled = self.controller.set_actuators({
            "wheelsEnabled": True,
            "cameraServosEnabled": True,
        })
        self.assertTrue(enabled["actuators"]["cameraServosEnabled"])
        self.controller.arm({"durationMs": 1000})
        self.controller.drive(command(direction="left", intensity=0.2, steering=0, maxDurationMs=300))
        disabled = self.controller.set_actuators({
            "wheelsEnabled": False,
            "cameraServosEnabled": False,
        })
        self.assertFalse(disabled["moving"])
        self.assertFalse(disabled["armed"])
        with self.assertRaises(CommandRejected):
            self.controller.look(command(pan=0.5, tilt=0))

    def test_rejects_unknown_fields_and_stale_command(self):
        with self.assertRaises(ValueError):
            self.controller.arm({"durationMs": 1000, "extra": True})
        old = utc_now() - timedelta(seconds=10)
        with self.assertRaises(CommandRejected):
            self.controller.drive({
                "commandId": str(uuid.uuid4()), "issuedAt": iso(old),
                "expiresAt": iso(old + timedelta(seconds=1)), "direction": "forward",
                "intensity": 0.2, "steering": 0, "maxDurationMs": 100,
            })

    def test_differential_drive_mixes_diagonal_and_spin_commands(self):
        left, right = differential_wheel_commands("forward", 0.3, 0.5)
        self.assertAlmostEqual(left, 0.3)
        self.assertAlmostEqual(right, 0.1)
        left, right = differential_wheel_commands("left", 0.2, 0)
        self.assertAlmostEqual(left, -0.2)
        self.assertAlmostEqual(right, 0.2)

    def test_camera_url_is_loopback_only(self):
        self.assertEqual(validate_camera_url("http://127.0.0.1:8080/stream"), "http://127.0.0.1:8080/stream")
        with self.assertRaises(ValueError):
            validate_camera_url("http://192.168.1.10:8080/stream")


if __name__ == "__main__":
    unittest.main()

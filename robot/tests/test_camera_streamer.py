from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

from friday_robot.camera_streamer import camera_command, iter_jpeg_frames
from friday_robot.hardware import (
    Pca9685PanTilt,
    SimulatedHardware,
    Tlc1543Tracker,
    normalized_pulse,
    camera_url_with_profile,
    step_toward,
    validate_camera_url,
)


class FakeGpio:
    OUT = "out"
    IN = "in"
    LOW = 0
    HIGH = 1
    PUD_UP = "up"

    def __init__(self) -> None:
        self.setups: list[tuple[object, ...]] = []
        self.outputs: list[tuple[int, int]] = []

    def setup(self, *args: object, **kwargs: object) -> None:
        self.setups.append((*args, kwargs))

    def output(self, pin: int, value: int) -> None:
        self.outputs.append((pin, value))

    def input(self, pin: int) -> int:
        del pin
        return 1


class FakeSmbus:
    def __init__(self, mode: int = 0) -> None:
        self.writes: list[tuple[int, int, int]] = []
        self.closed = False
        self.mode = mode

    def read_byte_data(self, address: int, register: int) -> int:
        del address
        return self.mode if register == Pca9685PanTilt.MODE1 else 0

    def write_byte_data(self, address: int, register: int, value: int) -> None:
        self.writes.append((address, register, value))

    def close(self) -> None:
        self.closed = True


class CameraStreamerTests(unittest.TestCase):
    def test_camera_defaults_to_full_four_by_three_frame(self) -> None:
        with patch.dict(os.environ, {}, clear=True), patch(
            "friday_robot.camera_streamer.shutil.which",
            return_value="/usr/bin/rpicam-vid",
        ):
            command = camera_command()

        self.assertEqual(command[command.index("--width") + 1], "640")
        self.assertEqual(command[command.index("--height") + 1], "480")
        self.assertEqual(command[command.index("--buffer-count") + 1], "2")
        self.assertIn("--flush", command)

    def test_reduced_profile_keeps_resolution_and_reduces_rate_and_quality(self) -> None:
        with patch.dict(os.environ, {"FRIDAY_CAMERA_FPS": "15"}, clear=True), patch(
            "friday_robot.camera_streamer.shutil.which",
            return_value="/usr/bin/rpicam-vid",
        ):
            command = camera_command("reduced")

        self.assertEqual(command[command.index("--width") + 1], "640")
        self.assertEqual(command[command.index("--height") + 1], "480")
        self.assertEqual(command[command.index("--framerate") + 1], "7")
        self.assertEqual(command[command.index("--quality") + 1], "55")

    def test_camera_profile_is_added_to_local_stream_url(self) -> None:
        self.assertEqual(
            camera_url_with_profile("http://127.0.0.1:8080/stream", "reduced"),
            "http://127.0.0.1:8080/stream?profile=reduced",
        )
        with self.assertRaises(ValueError):
            camera_url_with_profile("http://127.0.0.1:8080/stream", "unknown")

    def test_extracts_fragmented_jpeg_frames_and_ignores_noise(self) -> None:
        first = b"\xff\xd8one\xff\xd9"
        second = b"\xff\xd8two\xff\xd9"
        stream = io.BytesIO(b"noise" + first + b"gap" + second)

        self.assertEqual(list(iter_jpeg_frames(stream, chunk_size=3)), [first, second])

    def test_simulation_accepts_only_a_loopback_camera(self) -> None:
        hardware = SimulatedHardware("http://127.0.0.1:8080/stream")
        self.assertIsNotNone(hardware)
        with self.assertRaises(ValueError):
            validate_camera_url("http://192.168.1.22:8080/stream")

    def test_rejects_an_oversized_incomplete_frame(self) -> None:
        with patch("friday_robot.camera_streamer.MAX_FRAME_BYTES", 8):
            with self.assertRaises(RuntimeError):
                list(iter_jpeg_frames(io.BytesIO(b"\xff\xd8" + b"x" * 16), chunk_size=4))

    def test_tlc1543_returns_five_ten_bit_channels(self) -> None:
        gpio = FakeGpio()
        tracker = Tlc1543Tracker(gpio)
        self.assertEqual(tracker.read(), [1023, 1023, 1023, 1023, 1023])
        self.assertGreater(len(gpio.outputs), 100)

    def test_pan_tilt_stays_bounded_and_slows_horizontal_positioning(self) -> None:
        bus = FakeSmbus()
        delays: list[float] = []
        head = Pca9685PanTilt(bus=bus, sleep=delays.append)
        head.look(type("Pose", (), {"pan": -1.0, "tilt": 1.0})())
        head.close()

        self.assertEqual(normalized_pulse(-1, 700, 1500, 2000), 700)
        self.assertEqual(normalized_pulse(1, 700, 1500, 2000), 2000)
        self.assertEqual(
            normalized_pulse(
                -1,
                Pca9685PanTilt.PAN_MIN_US,
                Pca9685PanTilt.PAN_CENTER_US,
                Pca9685PanTilt.PAN_MAX_US,
            ),
            700,
        )
        self.assertEqual(
            normalized_pulse(
                1,
                Pca9685PanTilt.PAN_MIN_US,
                Pca9685PanTilt.PAN_CENTER_US,
                Pca9685PanTilt.PAN_MAX_US,
            ),
            2300,
        )
        self.assertEqual(step_toward(1500, 700, 20), 1480)
        self.assertGreater(delays.count(0.025), 20)
        self.assertIn(0.08, delays)
        self.assertTrue(bus.closed)

    def test_pan_tilt_wakes_a_controller_left_asleep(self) -> None:
        bus = FakeSmbus(mode=0x11)

        Pca9685PanTilt(bus=bus, sleep=lambda _: None)

        mode_writes = [value for _, register, value in bus.writes if register == 0x00]
        self.assertEqual(mode_writes, [0x11, 0x01, 0x81])
        self.assertEqual(mode_writes[-1] & 0x10, 0)

    def test_pan_tilt_keeps_pwm_during_a_nudge_then_releases_only_the_moving_axis(self) -> None:
        bus = FakeSmbus()
        head = Pca9685PanTilt(bus=bus, sleep=lambda _: None)

        head.look(type("Pose", (), {"pan": 0.0, "tilt": 0.05})())
        first_command_writes = list(bus.writes)
        head.look(type("Pose", (), {"pan": 0.0, "tilt": 0.1})())

        channel_zero_writes = [write for write in bus.writes if 0x06 <= write[1] <= 0x09]
        tilt_full_off_writes = [
            write for write in bus.writes if write[1] == 0x0D and write[2] == 0x10
        ]
        self.assertEqual(channel_zero_writes, [])
        self.assertEqual(len(tilt_full_off_writes), 2)
        self.assertGreater(len(bus.writes), len(first_command_writes))


if __name__ == "__main__":
    unittest.main()

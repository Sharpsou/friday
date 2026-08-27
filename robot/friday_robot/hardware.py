from __future__ import annotations

import os
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import BinaryIO, Callable, Protocol

from .models import CameraPose, Telemetry


class Hardware(Protocol):
    capabilities: list[str]

    def drive(self, direction: str, intensity: float, steering: float) -> None: ...
    def stop(self) -> None: ...
    def look(self, pose: CameraPose) -> None: ...
    def set_camera_servos_enabled(self, enabled: bool) -> None: ...
    def telemetry(self) -> Telemetry: ...
    def open_camera(self, profile: str = "normal") -> tuple[BinaryIO, str]: ...
    def close(self) -> None: ...


TINY_GIF = bytes.fromhex(
    "47494638396101000100800000000000ffffff2c00000000010001000002014c003b"
)


class MemoryCamera:
    def __init__(self, data: bytes):
        from io import BytesIO

        self._stream = BytesIO(data)

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)

    def close(self) -> None:
        self._stream.close()


@dataclass(frozen=True)
class TrackerPins:
    chip_select: int = 5
    clock: int = 25
    address: int = 24
    data_out: int = 23


class Tlc1543Tracker:
    """Lecture bit-bang du TLC1543 selon le pilote de référence Waveshare."""

    def __init__(self, gpio: object, pins: TrackerPins = TrackerPins()) -> None:
        self._gpio = gpio
        self._pins = pins
        gpio.setup(pins.clock, gpio.OUT, initial=gpio.LOW)
        gpio.setup(pins.address, gpio.OUT, initial=gpio.LOW)
        gpio.setup(pins.chip_select, gpio.OUT, initial=gpio.HIGH)
        gpio.setup(pins.data_out, gpio.IN, pull_up_down=gpio.PUD_UP)

    def read(self, sensor_count: int = 5) -> list[int]:
        if not 1 <= sensor_count <= 10:
            raise ValueError("Le nombre de voies TLC1543 doit être compris entre 1 et 10.")
        values = [0] * (sensor_count + 1)
        for channel in range(sensor_count + 1):
            self._gpio.output(self._pins.chip_select, self._gpio.LOW)
            for bit in range(8):
                address_bit = bit < 4 and bool((channel >> (3 - bit)) & 1)
                self._gpio.output(
                    self._pins.address,
                    self._gpio.HIGH if address_bit else self._gpio.LOW,
                )
                values[channel] = (values[channel] << 1) | int(
                    bool(self._gpio.input(self._pins.data_out))
                )
                self._pulse_clock()
            for _ in range(4):
                values[channel] = (values[channel] << 1) | int(
                    bool(self._gpio.input(self._pins.data_out))
                )
                self._pulse_clock()
            time.sleep(0.0001)
            self._gpio.output(self._pins.chip_select, self._gpio.HIGH)
        return [value >> 2 for value in values[1:]]

    def _pulse_clock(self) -> None:
        self._gpio.output(self._pins.clock, self._gpio.HIGH)
        self._gpio.output(self._pins.clock, self._gpio.LOW)


class ReadOnlySensorProbe:
    """Capteurs réels sans jamais configurer une broche moteur en sortie."""

    def __init__(self) -> None:
        try:
            import RPi.GPIO as gpio  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError("RPi.GPIO est absent de cette machine.") from error
        self._gpio = gpio
        gpio.setwarnings(False)
        gpio.setmode(gpio.BCM)
        gpio.setup(16, gpio.IN, pull_up_down=gpio.PUD_UP)
        gpio.setup(19, gpio.IN, pull_up_down=gpio.PUD_UP)
        self._tracker = Tlc1543Tracker(gpio)

    def telemetry(self) -> Telemetry:
        temperature, throttled_code, active, occurred = read_pi_health()
        return Telemetry(
            temperature_c=temperature,
            throttled_code=throttled_code,
            under_voltage_active=active,
            under_voltage_occurred=occurred,
            ir_left_clear=bool(self._gpio.input(16)),
            ir_right_clear=bool(self._gpio.input(19)),
            line_sensors=self._tracker.read(),
            camera_fps=float(os.environ.get("FRIDAY_CAMERA_FPS", "10")),
        )

    def close(self) -> None:
        pins = TrackerPins()
        self._gpio.cleanup([
            16, 19, pins.chip_select, pins.clock, pins.address, pins.data_out,
        ])


class Pca9685PanTilt:
    ADDRESS = 0x40
    MODE1 = 0x00
    PRESCALE = 0xFE
    LED0_ON_L = 0x06
    PAN_MIN_US = 700
    PAN_CENTER_US = 1500
    PAN_MAX_US = 2300

    def __init__(
        self,
        bus: object | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if bus is None:
            try:
                import smbus  # type: ignore[import-not-found]
            except ImportError as error:
                raise RuntimeError("smbus est absent de cette machine.") from error
            bus = smbus.SMBus(1)
        self._bus = bus
        self._sleep = sleep
        self._pan_us = 1500
        self._tilt_us = 1500
        self._lock = threading.RLock()
        self._set_frequency(50)

    def look(self, pose: CameraPose) -> None:
        target_pan = normalized_pulse(
            pose.pan,
            self.PAN_MIN_US,
            self.PAN_CENTER_US,
            self.PAN_MAX_US,
        )
        target_tilt = normalized_pulse(pose.tilt, 900, 1500, 2100)
        with self._lock:
            active_channels: list[int] = []
            if target_pan != self._pan_us:
                self._set_pulse(0, self._pan_us)
                active_channels.append(0)
            if target_tilt != self._tilt_us:
                self._set_pulse(1, self._tilt_us)
                active_channels.append(1)
            if not active_channels:
                return
            if 0 in active_channels:
                while (self._pan_us, self._tilt_us) != (target_pan, target_tilt):
                    next_pan = step_toward(self._pan_us, target_pan, 8)
                    next_tilt = step_toward(self._tilt_us, target_tilt, 8)
                    if next_pan != self._pan_us:
                        self._set_pulse(0, next_pan)
                        self._pan_us = next_pan
                    if next_tilt != self._tilt_us:
                        self._set_pulse(1, next_tilt)
                        self._tilt_us = next_tilt
                    self._sleep(0.025)
                self._sleep(0.08)
            else:
                self._set_pulse(1, target_tilt)
                self._tilt_us = target_tilt
                self._sleep(0.06)
            # PWM remains continuous throughout the move and is released only
            # once after the target is reached.
            for channel in active_channels:
                self._full_off(channel)

    def close(self) -> None:
        self.release()
        close = getattr(self._bus, "close", None)
        if callable(close):
            close()

    def release(self) -> None:
        with self._lock:
            self._full_off(0)
            self._full_off(1)

    def _set_frequency(self, frequency: int) -> None:
        prescale = round(25_000_000 / 4096 / frequency - 1)
        old_mode = self._bus.read_byte_data(self.ADDRESS, self.MODE1)
        # A previous clean shutdown can leave the PCA9685 asleep.  Restoring
        # old_mode verbatim would then keep SLEEP set and silently suppress all
        # servo PWM even though channel registers accept writes.
        awake_mode = old_mode & ~0x10
        self._bus.write_byte_data(self.ADDRESS, self.MODE1, (awake_mode & 0x7F) | 0x10)
        self._bus.write_byte_data(self.ADDRESS, self.PRESCALE, prescale)
        self._bus.write_byte_data(self.ADDRESS, self.MODE1, awake_mode)
        self._sleep(0.005)
        self._bus.write_byte_data(self.ADDRESS, self.MODE1, awake_mode | 0x80)

    def _set_pulse(self, channel: int, pulse_us: int) -> None:
        off = round(pulse_us * 4096 / 20_000)
        register = self.LED0_ON_L + 4 * channel
        for offset, value in enumerate((0, 0, off & 0xFF, off >> 8)):
            self._bus.write_byte_data(self.ADDRESS, register + offset, value)

    def _full_off(self, channel: int) -> None:
        register = self.LED0_ON_L + 4 * channel
        self._bus.write_byte_data(self.ADDRESS, register + 3, 0x10)


def normalized_pulse(value: float, low: int, center: int, high: int) -> int:
    bounded = max(-1.0, min(1.0, value))
    span = high - center if bounded >= 0 else center - low
    return round(center + bounded * span)


def step_toward(current: int, target: int, step: int) -> int:
    if current < target:
        return min(target, current + step)
    if current > target:
        return max(target, current - step)
    return current


class SimulatedHardware:
    capabilities = [
        "teleop", "camera_look", "camera_stream", "line_follow",
        "vision_objects", "vision_people", "vision_markers",
        "signal_buzzer", "signal_lights", "visual_topology",
        "topological_autonomy",
    ]

    def __init__(self, camera_url: str | None = None) -> None:
        self.moving = False
        self.pose = CameraPose()
        self.closed = False
        self._camera_url = validate_camera_url(camera_url) if camera_url else None
        self._sensor_probe = (
            ReadOnlySensorProbe()
            if os.environ.get("FRIDAY_ROBOT_READ_ONLY_SENSORS") == "YES"
            else None
        )
        self._pan_tilt = (
            Pca9685PanTilt()
            if os.environ.get("FRIDAY_ROBOT_REAL_CAMERA_SERVOS") == "YES"
            else None
        )

    def drive(self, direction: str, intensity: float, steering: float) -> None:
        del direction, intensity, steering
        if self.closed:
            raise RuntimeError("Matériel fermé.")
        self.moving = True

    def stop(self) -> None:
        self.moving = False

    def look(self, pose: CameraPose) -> None:
        if self._pan_tilt:
            self._pan_tilt.look(pose)
        self.pose = pose

    def set_camera_servos_enabled(self, enabled: bool) -> None:
        if not enabled and self._pan_tilt:
            self._pan_tilt.release()

    def telemetry(self) -> Telemetry:
        if self._sensor_probe:
            return self._sensor_probe.telemetry()
        return Telemetry(
            temperature_c=47.0,
            throttled_code="0x0",
            ir_left_clear=True,
            ir_right_clear=True,
            line_sensors=[560, 550, 920, 760, 730],
            camera_fps=10.0,
        )

    def open_camera(self, profile: str = "normal") -> tuple[BinaryIO, str]:
        if self._camera_url:
            return open_local_camera(camera_url_with_profile(self._camera_url, profile))
        return MemoryCamera(TINY_GIF), "image/gif"

    def close(self) -> None:
        self.stop()
        if self._sensor_probe:
            self._sensor_probe.close()
        if self._pan_tilt:
            self._pan_tilt.close()
        self.closed = True


@dataclass(frozen=True)
class MotorPins:
    ain1: int = 12
    ain2: int = 13
    ena: int = 6
    bin1: int = 20
    bin2: int = 21
    enb: int = 26


def differential_wheel_commands(
    direction: str, intensity: float, steering: float
) -> tuple[float, float]:
    """Mélange arcade : valeurs signées des roues gauche et droite."""
    linear = 1.0 if direction == "forward" else -1.0 if direction == "backward" else 0.0
    angular = (
        1.0 if direction == "right" else -1.0 if direction == "left" else steering
    )
    left = linear + angular
    right = linear - angular
    normalization = max(1.0, abs(left), abs(right))
    return left / normalization * intensity, right / normalization * intensity


class AlphaBot2Hardware:
    """Adaptateur GPIO chargé uniquement sur le Pi, après confirmation physique."""

    capabilities = [
        "teleop", "camera_look", "camera_stream", "line_follow",
        "signal_buzzer", "signal_lights", "visual_topology",
        "topological_autonomy",
    ]

    def __init__(self, camera_url: str | None = None) -> None:
        if os.environ.get("FRIDAY_ROBOT_HARDWARE_CONFIRMED") != "YES":
            raise RuntimeError("Activation GPIO refusée : confirmation physique absente.")
        try:
            import RPi.GPIO as gpio  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError("RPi.GPIO est absent de cette machine.") from error
        self._gpio = gpio
        self._pins = MotorPins()
        self._lock = threading.RLock()
        self._camera_url = validate_camera_url(camera_url) if camera_url else None
        self._left_inverted = os.environ.get("FRIDAY_ROBOT_LEFT_INVERTED", "0") == "1"
        self._right_inverted = os.environ.get("FRIDAY_ROBOT_RIGHT_INVERTED", "0") == "1"
        gpio.setwarnings(False)
        gpio.setmode(gpio.BCM)
        for pin in vars(self._pins).values():
            gpio.setup(pin, gpio.OUT, initial=gpio.LOW)
        gpio.setup(16, gpio.IN, pull_up_down=gpio.PUD_UP)
        gpio.setup(19, gpio.IN, pull_up_down=gpio.PUD_UP)
        self._tracker = Tlc1543Tracker(gpio)
        self._pwm_left = gpio.PWM(self._pins.ena, 500)
        self._pwm_right = gpio.PWM(self._pins.enb, 500)
        self._pwm_left.start(0)
        self._pwm_right.start(0)
        self._pose = CameraPose()
        self._pan_tilt = Pca9685PanTilt()

    def _motor(self, first: int, second: int, forward: bool) -> None:
        # Le pilote Waveshare définit l'avant par IN1=LOW, IN2=HIGH.
        self._gpio.output(first, self._gpio.LOW if forward else self._gpio.HIGH)
        self._gpio.output(second, self._gpio.HIGH if forward else self._gpio.LOW)

    def drive(self, direction: str, intensity: float, steering: float) -> None:
        with self._lock:
            if direction == "forward" and not (
                bool(self._gpio.input(16)) and bool(self._gpio.input(19))
            ):
                self.stop()
                raise RuntimeError("Obstacle détecté par les capteurs IR avant.")
            left_command, right_command = differential_wheel_commands(
                direction, intensity, steering
            )
            left_forward = left_command >= 0
            right_forward = right_command >= 0
            left_forward ^= self._left_inverted
            right_forward ^= self._right_inverted
            self._motor(self._pins.ain1, self._pins.ain2, left_forward)
            self._motor(self._pins.bin1, self._pins.bin2, right_forward)
            left_duty = max(0.0, min(35.0, abs(left_command) * 100.0))
            right_duty = max(0.0, min(35.0, abs(right_command) * 100.0))
            self._pwm_left.ChangeDutyCycle(left_duty)
            self._pwm_right.ChangeDutyCycle(right_duty)

    def stop(self) -> None:
        with self._lock:
            self._pwm_left.ChangeDutyCycle(0)
            self._pwm_right.ChangeDutyCycle(0)
            for pin in (self._pins.ain1, self._pins.ain2, self._pins.bin1, self._pins.bin2):
                self._gpio.output(pin, self._gpio.LOW)

    def look(self, pose: CameraPose) -> None:
        self._pan_tilt.look(pose)
        self._pose = pose

    def set_camera_servos_enabled(self, enabled: bool) -> None:
        if not enabled:
            self._pan_tilt.release()

    def telemetry(self) -> Telemetry:
        with self._lock:
            temperature, throttled_code, active, occurred = read_pi_health()
            return Telemetry(
                temperature_c=temperature,
                throttled_code=throttled_code,
                under_voltage_active=active,
                under_voltage_occurred=occurred,
                ir_left_clear=bool(self._gpio.input(16)),
                ir_right_clear=bool(self._gpio.input(19)),
                line_sensors=self._tracker.read(),
                camera_fps=float(os.environ.get("FRIDAY_CAMERA_FPS", "10")),
            )

    def open_camera(self, profile: str = "normal") -> tuple[BinaryIO, str]:
        if not self._camera_url:
            raise RuntimeError("Flux caméra local non configuré.")
        return open_local_camera(camera_url_with_profile(self._camera_url, profile))

    def close(self) -> None:
        try:
            self.stop()
            self._pwm_left.stop()
            self._pwm_right.stop()
            self._pan_tilt.close()
        finally:
            self._gpio.cleanup()


def validate_camera_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("La caméra doit être un flux HTTP strictement local au Pi.")
    if parsed.username or parsed.password or not parsed.port:
        raise ValueError("URL caméra invalide.")
    return value


def camera_url_with_profile(camera_url: str, profile: str) -> str:
    if profile not in {"normal", "reduced"}:
        raise ValueError("Profil caméra invalide.")
    parsed = urllib.parse.urlparse(camera_url)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    query["profile"] = [profile]
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))


def open_local_camera(camera_url: str) -> tuple[BinaryIO, str]:
    response = urllib.request.urlopen(camera_url, timeout=3)  # noqa: S310
    content_type = response.headers.get_content_type()
    if content_type not in {"multipart/x-mixed-replace", "image/jpeg", "image/gif"}:
        response.close()
        raise RuntimeError("Type de flux caméra refusé.")
    return response, response.headers.get("Content-Type", content_type)


def read_pi_health() -> tuple[float | None, str | None, bool, bool]:
    temperature: float | None = None
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", encoding="ascii") as source:
            temperature = round(int(source.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        pass

    throttled_code: str | None = None
    active = False
    occurred = False
    try:
        result = subprocess.run(  # noqa: S603
            ["vcgencmd", "get_throttled"],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        ).stdout.strip()
        value = int(result.split("=", 1)[1], 16)
        throttled_code = f"0x{value:x}"
        active = bool(value & 0x1)
        occurred = bool(value & 0x10000)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        pass
    return temperature, throttled_code, active, occurred

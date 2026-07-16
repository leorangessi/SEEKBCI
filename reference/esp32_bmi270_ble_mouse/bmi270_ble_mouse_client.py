"""
Connect to ESP32_BMI270_MOUSE over BLE and visualize BMI270 motion.

Install on Windows:
    py -m pip install bleak

Run:
    py bmi270_ble_mouse_client.py

Press Ctrl+C in the terminal to stop.
"""

import asyncio
import argparse
import ctypes
import math
import msvcrt
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk
from dataclasses import dataclass

from bleak import BleakClient, BleakScanner


DEVICE_NAME = "ESP32_BMI270_MOUSE"
SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
IMU_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

# Tune these values first.
SENSITIVITY = 42.0
DEADZONE_RAD_S = 0.045
SMOOTHING = 0.72  # 0.0 = raw, 0.8 = very smooth/slow
STATIONARY_GYRO_RAD_S = 0.095
STATIONARY_ACCEL_TOLERANCE = 1.8
BIAS_ADAPT_ALPHA = 0.006
STOP_DECAY = 0.45
ORIENTATION_GAIN = 3.0
ORIENTATION_LIMIT = 1.0
G_TO_MS2 = 9.80665

# Head mode uses gravity measured at calibration time, so the BMI270 does not
# need to be flat when worn. Flip signs here if the cursor direction is wrong.
HEAD_MODE = True
PITCH_REFERENCE_AXIS = "x"
INVERT_X = True
INVERT_Y = True

# Keep the sensor still during calibration to estimate gyro drift and gravity.
CALIBRATION_SAMPLES = 120
GESTURE_PREPARE_SECONDS = 1.0
GESTURE_RECORD_SECONDS = 1.4
GESTURE_MIN_MAGNITUDE = 0.28
GESTURE_MATCH_THRESHOLD = 0.78
GESTURE_COOLDOWN_SECONDS = 1.1
GESTURE_SEQUENCE = [
    ("left", "Turn / move LEFT and hold"),
    ("right", "Turn / move RIGHT and hold"),
    ("up", "Move / tilt UP and hold"),
    ("down", "Move / tilt DOWN and hold"),
    ("forward", "Nod / move FORWARD and hold"),
    ("backward", "Tilt / move BACKWARD and hold"),
]

INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001


class MouseInput(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class InputUnion(ctypes.Union):
    _fields_ = [("mi", MouseInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", InputUnion)]


def move_mouse_relative(dx: int, dy: int) -> None:
    extra = ctypes.c_ulong(0)
    mouse_input = MouseInput(dx, dy, 0, MOUSEEVENTF_MOVE, 0, ctypes.pointer(extra))
    command = Input(INPUT_MOUSE, InputUnion(mi=mouse_input))
    ctypes.windll.user32.SendInput(1, ctypes.byref(command), ctypes.sizeof(command))


def dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(v: tuple[float, float, float]) -> float:
    return math.sqrt(dot(v, v))


def normalize(v: tuple[float, float, float], fallback: tuple[float, float, float]) -> tuple[float, float, float]:
    length = norm(v)
    if length < 1e-6:
        return fallback
    return (v[0] / length, v[1] / length, v[2] / length)


def subtract_projection(
    vector: tuple[float, float, float],
    axis: tuple[float, float, float],
) -> tuple[float, float, float]:
    amount = dot(vector, axis)
    return (
        vector[0] - axis[0] * amount,
        vector[1] - axis[1] * amount,
        vector[2] - axis[2] * amount,
    )


def axis_vector(name: str) -> tuple[float, float, float]:
    return {
        "x": (1.0, 0.0, 0.0),
        "y": (0.0, 1.0, 0.0),
        "z": (0.0, 0.0, 1.0),
    }[name]


def cosine_similarity(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    numerator = sum(x * y for x, y in zip(a, b))
    a_norm = math.sqrt(sum(x * x for x in a))
    b_norm = math.sqrt(sum(y * y for y in b))
    if a_norm < 1e-6 or b_norm < 1e-6:
        return 0.0
    return numerator / (a_norm * b_norm)


def normalize_feature(feature: tuple[float, ...]) -> tuple[float, ...]:
    length = math.sqrt(sum(value * value for value in feature))
    if length < 1e-6:
        return feature
    return tuple(value / length for value in feature)


@dataclass
class ImuSample:
    ax: float
    ay: float
    az: float
    gx: float
    gy: float
    gz: float

    def gyro_axis(self, axis: str) -> float:
        return {"x": self.gx, "y": self.gy, "z": self.gz}[axis]


class MouseController:
    def __init__(self, sensitivity: float, mouse_enabled: bool = False, debug: bool = False) -> None:
        self.lock = threading.RLock()
        self.debug = debug
        self.sensitivity = sensitivity
        self.mouse_enabled = mouse_enabled
        self.bias_x = 0.0
        self.bias_y = 0.0
        self.last_time = time.perf_counter()
        self.last_debug_time = time.perf_counter()
        self.filtered_dx = 0.0
        self.filtered_dy = 0.0
        self.remainder_x = 0.0
        self.remainder_y = 0.0
        self.calibration_values: list[tuple[float, float]] = []
        self.calibration_samples: list[ImuSample] = []
        self.sample_count = 0
        self.move_count = 0
        self.last_sample: ImuSample | None = None
        self.last_move = (0, 0)
        self.last_raw_payload = ""
        self.last_error_payload = ""
        self.yaw_axis = (0.0, 0.0, 1.0)
        self.pitch_axis = (1.0, 0.0, 0.0)
        self.bias = (0.0, 0.0, 0.0)
        self.has_started = False
        self.is_calibrating = False
        self.connection_status = "Disconnected"
        self.orientation_x = 0.0
        self.orientation_y = 0.0
        self.rate_x = 0.0
        self.rate_y = 0.0
        self.is_stationary = False
        self.gesture_vectors: dict[str, tuple[float, ...]] = {}
        self.gesture_calibrating = False
        self.gesture_step_index = 0
        self.gesture_phase = "idle"
        self.gesture_phase_started = time.perf_counter()
        self.gesture_samples: list[tuple[float, ...]] = []
        self.gesture_prompt = "Gesture calibration not started"
        self.last_gesture = ""
        self.last_gesture_score = 0.0
        self.last_gesture_time = 0.0

    def start(self) -> None:
        with self.lock:
            self.has_started = True
        self.start_calibration()

    def start_calibration(self) -> None:
        with self.lock:
            self.has_started = True
            self.calibration_values.clear()
            self.calibration_samples.clear()
            self.filtered_dx = 0.0
            self.filtered_dy = 0.0
            self.remainder_x = 0.0
            self.remainder_y = 0.0
            self.orientation_x = 0.0
            self.orientation_y = 0.0
            self.rate_x = 0.0
            self.rate_y = 0.0
            self.is_calibrating = True
        print("Calibration started. Keep your head/module still in its normal wearing position.", flush=True)

    def start_gesture_calibration(self) -> None:
        with self.lock:
            if not self.has_started:
                needs_start = True
            else:
                needs_start = False

        if needs_start:
            print("Start/zero calibration is required before gesture calibration.", flush=True)
            self.start()
            return

        with self.lock:
            self.gesture_vectors.clear()
            self.gesture_samples.clear()
            self.gesture_calibrating = True
            self.gesture_step_index = 0
            self.gesture_phase = "prepare"
            self.gesture_phase_started = time.perf_counter()
            self.last_gesture = ""
            self.last_gesture_score = 0.0
            self.gesture_prompt = self.current_gesture_prompt()
        print("Gesture calibration started. Follow the dashboard prompts.", flush=True)

    def current_gesture_prompt(self) -> str:
        if not self.gesture_calibrating:
            return "Gesture calibration complete" if self.gesture_vectors else "Gesture calibration not started"
        _, prompt = GESTURE_SEQUENCE[self.gesture_step_index]
        if self.gesture_phase == "prepare":
            return f"Get ready: {prompt}"
        return f"Recording: {prompt}"

    def finish_gesture_calibration(self) -> None:
        self.gesture_calibrating = False
        self.gesture_phase = "idle"
        self.gesture_prompt = "Gesture calibration complete"
        print("Gesture calibration complete. Learned actions:", flush=True)
        for label, vector in self.gesture_vectors.items():
            vector_text = ", ".join(f"{value:+.2f}" for value in vector)
            print(f"  {label}: ({vector_text})", flush=True)

    def gesture_feature(
        self,
        sample: ImuSample,
        gyro: tuple[float, float, float],
    ) -> tuple[float, ...]:
        gravity = self.yaw_axis
        accel_delta = (
            sample.ax - gravity[0] * G_TO_MS2,
            sample.ay - gravity[1] * G_TO_MS2,
            sample.az - gravity[2] * G_TO_MS2,
        )
        # Gyro dominates head turns; accel delta helps distinguish forward/back
        # translation-like movements on a six-axis IMU.
        return (
            gyro[0],
            gyro[1],
            gyro[2],
            accel_delta[0] * 0.08,
            accel_delta[1] * 0.08,
            accel_delta[2] * 0.08,
        )

    def update_gesture_calibration(self, feature: tuple[float, ...], now: float) -> None:
        if not self.gesture_calibrating:
            return

        elapsed = now - self.gesture_phase_started
        if self.gesture_phase == "prepare":
            if elapsed >= GESTURE_PREPARE_SECONDS:
                self.gesture_phase = "record"
                self.gesture_phase_started = now
                self.gesture_samples.clear()
                self.gesture_prompt = self.current_gesture_prompt()
            return

        self.gesture_samples.append(feature)
        if elapsed < GESTURE_RECORD_SECONDS:
            return

        label, _ = GESTURE_SEQUENCE[self.gesture_step_index]
        if self.gesture_samples:
            avg = tuple(
                sum(sample[i] for sample in self.gesture_samples) / len(self.gesture_samples)
                for i in range(len(self.gesture_samples[0]))
            )
            self.gesture_vectors[label] = normalize_feature(avg)
            print(f"Recorded gesture '{label}'", flush=True)

        self.gesture_step_index += 1
        if self.gesture_step_index >= len(GESTURE_SEQUENCE):
            self.finish_gesture_calibration()
            return

        self.gesture_phase = "prepare"
        self.gesture_phase_started = now
        self.gesture_samples.clear()
        self.gesture_prompt = self.current_gesture_prompt()

    def classify_gesture(self, feature: tuple[float, ...], now: float) -> None:
        if self.gesture_calibrating or not self.gesture_vectors:
            return

        magnitude = math.sqrt(sum(value * value for value in feature))
        if magnitude < GESTURE_MIN_MAGNITUDE:
            return
        if now - self.last_gesture_time < GESTURE_COOLDOWN_SECONDS:
            return

        normalized = normalize_feature(feature)
        best_label = ""
        best_score = 0.0
        for label, learned in self.gesture_vectors.items():
            score = cosine_similarity(normalized, learned)
            if score > best_score:
                best_label = label
                best_score = score

        if best_label and best_score >= GESTURE_MATCH_THRESHOLD:
            self.last_gesture = best_label
            self.last_gesture_score = best_score
            self.last_gesture_time = now
            print(f"Gesture detected: {best_label} score={best_score:.2f}", flush=True)

    def finish_calibration(self) -> None:
        with self.lock:
            count = len(self.calibration_samples)
            avg_gx = sum(s.gx for s in self.calibration_samples) / count
            avg_gy = sum(s.gy for s in self.calibration_samples) / count
            avg_gz = sum(s.gz for s in self.calibration_samples) / count
            avg_ax = sum(s.ax for s in self.calibration_samples) / count
            avg_ay = sum(s.ay for s in self.calibration_samples) / count
            avg_az = sum(s.az for s in self.calibration_samples) / count

            self.bias = (avg_gx, avg_gy, avg_gz)
            self.yaw_axis = normalize((avg_ax, avg_ay, avg_az), (0.0, 0.0, 1.0))

            reference = axis_vector(PITCH_REFERENCE_AXIS)
            projected = subtract_projection(reference, self.yaw_axis)
            if norm(projected) < 0.2:
                projected = subtract_projection(axis_vector("y"), self.yaw_axis)
            self.pitch_axis = normalize(projected, (1.0, 0.0, 0.0))

            self.orientation_x = 0.0
            self.orientation_y = 0.0
            self.filtered_dx = 0.0
            self.filtered_dy = 0.0
            self.remainder_x = 0.0
            self.remainder_y = 0.0
            self.is_calibrating = False
            self.last_time = time.perf_counter()
        print(
            "Calibration complete. "
            f"gyro_bias=({avg_gx:.4f},{avg_gy:.4f},{avg_gz:.4f}), "
            f"yaw_axis=({self.yaw_axis[0]:.2f},{self.yaw_axis[1]:.2f},{self.yaw_axis[2]:.2f}), "
            f"pitch_axis=({self.pitch_axis[0]:.2f},{self.pitch_axis[1]:.2f},{self.pitch_axis[2]:.2f})",
            flush=True,
        )

    def on_sample(self, sample: ImuSample) -> None:
        with self.lock:
            self.sample_count += 1
            self.last_sample = sample

            if not self.has_started:
                return

            if self.is_calibrating:
                self.calibration_samples.append(sample)
                should_finish = len(self.calibration_samples) == CALIBRATION_SAMPLES
            else:
                should_finish = False

        if should_finish:
            self.finish_calibration()
            return
        if self.is_calibrating:
            return

        with self.lock:
            now = time.perf_counter()
            dt = max(0.001, min(now - self.last_time, 0.05))
            self.last_time = now

            raw_gyro = (sample.gx, sample.gy, sample.gz)
            gyro = (
                raw_gyro[0] - self.bias[0],
                raw_gyro[1] - self.bias[1],
                raw_gyro[2] - self.bias[2],
            )
            gesture_feature = self.gesture_feature(sample, gyro)
            self.update_gesture_calibration(gesture_feature, now)
            self.classify_gesture(gesture_feature, now)

            if HEAD_MODE:
                vx = dot(gyro, self.yaw_axis)
                vy = dot(gyro, self.pitch_axis)
            else:
                vx = sample.gz - self.bias[2]
                vy = sample.gx - self.bias[0]

            accel_mag = math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az)
            gyro_mag = norm(gyro)
            self.is_stationary = (
                gyro_mag < STATIONARY_GYRO_RAD_S
                and abs(accel_mag - G_TO_MS2) < STATIONARY_ACCEL_TOLERANCE
            )

            if self.is_stationary:
                self.bias = (
                    self.bias[0] * (1.0 - BIAS_ADAPT_ALPHA) + raw_gyro[0] * BIAS_ADAPT_ALPHA,
                    self.bias[1] * (1.0 - BIAS_ADAPT_ALPHA) + raw_gyro[1] * BIAS_ADAPT_ALPHA,
                    self.bias[2] * (1.0 - BIAS_ADAPT_ALPHA) + raw_gyro[2] * BIAS_ADAPT_ALPHA,
                )

            vx = 0.0 if abs(vx) < DEADZONE_RAD_S else vx
            vy = 0.0 if abs(vy) < DEADZONE_RAD_S else vy

            if INVERT_X:
                vx = -vx
            if INVERT_Y:
                vy = -vy

            self.rate_x = vx
            self.rate_y = vy
            self.orientation_x = max(-ORIENTATION_LIMIT, min(ORIENTATION_LIMIT, self.orientation_x + vx * dt * ORIENTATION_GAIN))
            self.orientation_y = max(-ORIENTATION_LIMIT, min(ORIENTATION_LIMIT, self.orientation_y + vy * dt * ORIENTATION_GAIN))

            dx = vx * self.sensitivity * dt * 60.0
            dy = vy * self.sensitivity * dt * 60.0

            self.filtered_dx = self.filtered_dx * SMOOTHING + dx * (1.0 - SMOOTHING)
            self.filtered_dy = self.filtered_dy * SMOOTHING + dy * (1.0 - SMOOTHING)

            if vx == 0.0 and vy == 0.0:
                self.filtered_dx *= STOP_DECAY
                self.filtered_dy *= STOP_DECAY
                if abs(self.filtered_dx) < 0.03:
                    self.filtered_dx = 0.0
                    self.remainder_x = 0.0
                if abs(self.filtered_dy) < 0.03:
                    self.filtered_dy = 0.0
                    self.remainder_y = 0.0

            self.remainder_x += self.filtered_dx
            self.remainder_y += self.filtered_dy
            move_x = int(self.remainder_x)
            move_y = int(self.remainder_y)
            self.remainder_x -= move_x
            self.remainder_y -= move_y

            if move_x or move_y:
                self.move_count += 1
                self.last_move = (move_x, move_y)

        if self.mouse_enabled and (move_x or move_y):
            move_mouse_relative(move_x, move_y)
        self.print_debug_if_needed()

    def adjust_sensitivity(self, factor: float) -> None:
        with self.lock:
            self.sensitivity = max(1.0, min(300.0, self.sensitivity * factor))
            value = self.sensitivity
        print(f"Sensitivity: {value:.1f}", flush=True)

    def set_status(self, status: str) -> None:
        with self.lock:
            self.connection_status = status

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            s = self.last_sample
            return {
                "status": self.connection_status,
                "sample_count": self.sample_count,
                "move_count": self.move_count,
                "sensitivity": self.sensitivity,
                "mouse_enabled": self.mouse_enabled,
                "has_started": self.has_started,
                "calibration_left": max(0, CALIBRATION_SAMPLES - len(self.calibration_samples)),
                "is_calibrating": self.is_calibrating,
                "is_stationary": self.is_stationary,
                "orientation_x": self.orientation_x,
                "orientation_y": self.orientation_y,
                "rate_x": self.rate_x,
                "rate_y": self.rate_y,
                "last_move": self.last_move,
                "last_raw_payload": self.last_raw_payload,
                "last_error_payload": self.last_error_payload,
                "gesture_prompt": self.gesture_prompt,
                "gesture_calibrating": self.gesture_calibrating,
                "gesture_step": self.gesture_step_index + 1 if self.gesture_calibrating else 0,
                "gesture_total": len(GESTURE_SEQUENCE),
                "learned_gestures": len(self.gesture_vectors),
                "last_gesture": self.last_gesture,
                "last_gesture_score": self.last_gesture_score,
                "gyro": (s.gx, s.gy, s.gz) if s else (0.0, 0.0, 0.0),
                "accel": (s.ax, s.ay, s.az) if s else (0.0, 0.0, 0.0),
            }

    def print_debug(self) -> None:
        if not self.debug:
            return

        if self.last_sample is None:
            if self.last_raw_payload:
                print(
                    f"debug: no valid IMU samples yet, last_raw='{self.last_raw_payload}'",
                    flush=True,
                )
            else:
                print("debug: no BLE notifications received yet", flush=True)
            return

        s = self.last_sample
        calibration_left = max(0, CALIBRATION_SAMPLES - len(self.calibration_samples))
        print(
            "debug: "
            f"samples={self.sample_count}, moves={self.move_count}, "
            f"sensitivity={self.sensitivity:.1f}, "
            f"calibration_left={calibration_left}, "
            f"gyro=({s.gx:.4f},{s.gy:.4f},{s.gz:.4f}) rad/s, "
            f"last_move={self.last_move}, raw='{self.last_raw_payload}'",
            flush=True,
        )

    def print_debug_if_needed(self) -> None:
        now = time.perf_counter()
        if now - self.last_debug_time >= 1.0:
            self.last_debug_time = now
            self.print_debug()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Receive BMI270 BLE notifications from ESP32 and visualize/classify motion."
    )
    parser.add_argument("--name", default=DEVICE_NAME, help="BLE device name to scan for.")
    parser.add_argument("--address", help="BLE address to connect to, if known.")
    parser.add_argument("--timeout", type=float, default=20.0, help="BLE scan timeout in seconds.")
    parser.add_argument("--list", action="store_true", help="List nearby BLE devices and exit.")
    parser.add_argument("--debug", action="store_true", help="Print received IMU and mouse movement status.")
    parser.add_argument("--sensitivity", type=float, default=SENSITIVITY, help="Cursor sensitivity.")
    parser.add_argument("--enable-mouse", action="store_true", help="Actually move the Windows cursor.")
    parser.add_argument("--no-gui", action="store_true", help="Run in console mode without the Tkinter dashboard.")
    return parser.parse_args()


def parse_sample(data: bytearray) -> ImuSample | None:
    try:
        parts = data.decode("utf-8").strip().split(",")
        values = [float(part) for part in parts]
    except ValueError:
        return None

    if len(values) != 6 or any(not math.isfinite(v) for v in values):
        return None

    return ImuSample(*values)


def decode_payload(data: bytearray) -> str:
    return data.decode("utf-8", errors="replace").strip()


async def list_devices(timeout: float) -> None:
    print(f"Scanning nearby BLE devices for {timeout:.0f} seconds ...")
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    if not devices:
        print("No BLE devices found. Check Bluetooth, permissions, and adapter state.")
        return

    for device, adv in devices.values():
        name = device.name or adv.local_name or "<no name>"
        uuids = ", ".join(adv.service_uuids or [])
        print(f"{name} | address={device.address} | RSSI={adv.rssi} | services={uuids}")


async def find_device_address(name: str, timeout: float) -> str:
    print(f"Scanning for {name} for {timeout:.0f} seconds ...")
    device = await BleakScanner.find_device_by_name(name, timeout=timeout)
    if device is None:
        raise RuntimeError(
            f"Could not find {name}. Run with --list to see scanned BLE devices. "
            "Also check the ESP32 Serial Monitor for 'BLE advertising as ESP32_BMI270_MOUSE'."
        )
    return device.address


async def run_ble(args: argparse.Namespace, controller: MouseController, stop_event: threading.Event) -> None:
    address = args.address
    if address is None:
        controller.set_status("Scanning")
        address = await find_device_address(args.name, args.timeout)

    controller.set_status(f"Connecting {address}")
    print(f"Connecting to {address} ...")
    async with BleakClient(address) as client:
        if not client.is_connected:
            raise RuntimeError("BLE connection failed.")

        controller.set_status("Connected")
        print("Connected. Keep the sensor/head still for calibration.")

        def handle_notification(_: int, data: bytearray) -> None:
            raw = decode_payload(data)
            with controller.lock:
                controller.last_raw_payload = raw
            if raw.startswith("ERR,"):
                with controller.lock:
                    controller.last_error_payload = raw
                if args.debug:
                    print(f"debug: device error '{raw}'", flush=True)
                return

            sample = parse_sample(data)
            if sample is not None:
                controller.on_sample(sample)
            elif args.debug:
                print(f"debug: unparsable notification raw='{raw}'", flush=True)

        await client.start_notify(IMU_CHAR_UUID, handle_notification)
        try:
            initial_value = await client.read_gatt_char(IMU_CHAR_UUID)
            print(f"Initial characteristic value: '{decode_payload(initial_value)}'", flush=True)
        except Exception as exc:
            print(f"Initial characteristic read failed: {exc}", flush=True)

        print("Receiving IMU data. Press S or click Start to begin first calibration.")
        print("Console controls: S starts, C zero-calibrates, G gesture-calibrates, +/- changes sensitivity, Q quits.")

        while not stop_event.is_set():
            await asyncio.sleep(0.05)
            if args.no_gui:
                while msvcrt.kbhit():
                    key = msvcrt.getwch().lower()
                    if key == "s":
                        controller.start()
                    elif key == "c":
                        controller.start_calibration()
                    elif key == "g":
                        controller.start_gesture_calibration()
                    elif key in ("+", "="):
                        controller.adjust_sensitivity(1.15)
                    elif key in ("-", "_"):
                        controller.adjust_sensitivity(1.0 / 1.15)
                    elif key == "q":
                        stop_event.set()
                        break
            controller.print_debug_if_needed()

        await client.stop_notify(IMU_CHAR_UUID)
        controller.set_status("Stopped")


class Dashboard:
    def __init__(self, controller: MouseController, stop_event: threading.Event) -> None:
        self.controller = controller
        self.stop_event = stop_event
        self.root = tk.Tk()
        self.root.title("ESP32 BMI270 IMU")
        self.root.resizable(False, False)

        self.canvas_size = 260
        self.ball_radius = 12

        frame = ttk.Frame(self.root, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")

        self.canvas = tk.Canvas(frame, width=self.canvas_size, height=self.canvas_size, bg="#111827", highlightthickness=0)
        self.canvas.grid(row=0, column=0, columnspan=4, pady=(0, 10))
        center = self.canvas_size // 2
        self.canvas.create_oval(center - 4, center - 4, center + 4, center + 4, fill="#9ca3af", outline="")
        self.canvas.create_line(center, 12, center, self.canvas_size - 12, fill="#374151")
        self.canvas.create_line(12, center, self.canvas_size - 12, center, fill="#374151")
        self.ball = self.canvas.create_oval(
            center - self.ball_radius,
            center - self.ball_radius,
            center + self.ball_radius,
            center + self.ball_radius,
            fill="#22c55e",
            outline="",
        )

        self.status_var = tk.StringVar(value="Starting")
        self.sample_var = tk.StringVar(value="Samples: 0")
        self.gyro_var = tk.StringVar(value="Gyro: 0, 0, 0")
        self.info_var = tk.StringVar(value="Click Start when ready")
        self.gesture_var = tk.StringVar(value="Gestures: not calibrated")
        self.detected_var = tk.StringVar(value="Last gesture: none")

        ttk.Label(frame, textvariable=self.status_var).grid(row=1, column=0, columnspan=4, sticky="w")
        ttk.Label(frame, textvariable=self.sample_var).grid(row=2, column=0, columnspan=4, sticky="w")
        ttk.Label(frame, textvariable=self.gyro_var).grid(row=3, column=0, columnspan=4, sticky="w")
        ttk.Label(frame, textvariable=self.info_var).grid(row=4, column=0, columnspan=4, sticky="w", pady=(0, 8))
        ttk.Label(frame, textvariable=self.gesture_var).grid(row=5, column=0, columnspan=4, sticky="w")
        ttk.Label(frame, textvariable=self.detected_var).grid(row=6, column=0, columnspan=4, sticky="w", pady=(0, 8))

        ttk.Button(frame, text="Start", command=self.controller.start).grid(row=7, column=0, padx=(0, 6), sticky="ew")
        ttk.Button(frame, text="Zero", command=self.controller.start_calibration).grid(row=7, column=1, padx=6, sticky="ew")
        ttk.Button(frame, text="Gestures", command=self.controller.start_gesture_calibration).grid(row=7, column=2, padx=6, sticky="ew")
        ttk.Button(frame, text="Exit", command=self.close).grid(row=7, column=3, padx=(6, 0), sticky="ew")
        ttk.Button(frame, text="-", command=lambda: self.controller.adjust_sensitivity(1.0 / 1.15)).grid(row=8, column=0, columnspan=2, pady=(8, 0), sticky="ew")
        ttk.Button(frame, text="+", command=lambda: self.controller.adjust_sensitivity(1.15)).grid(row=8, column=2, columnspan=2, pady=(8, 0), sticky="ew")

        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.after(50, self.update)

    def close(self) -> None:
        self.stop_event.set()
        self.root.destroy()

    def update(self) -> None:
        snap = self.controller.snapshot()
        status = snap["status"]
        sample_count = snap["sample_count"]
        move_count = snap["move_count"]
        sensitivity = snap["sensitivity"]
        mouse_enabled = snap["mouse_enabled"]
        has_started = snap["has_started"]
        calibration_left = snap["calibration_left"]
        is_calibrating = snap["is_calibrating"]
        is_stationary = snap["is_stationary"]
        gx, gy, gz = snap["gyro"]
        ox = float(snap["orientation_x"])
        oy = float(snap["orientation_y"])
        gesture_prompt = snap["gesture_prompt"]
        gesture_calibrating = snap["gesture_calibrating"]
        gesture_step = snap["gesture_step"]
        gesture_total = snap["gesture_total"]
        learned_gestures = snap["learned_gestures"]
        last_gesture = snap["last_gesture"]
        last_gesture_score = snap["last_gesture_score"]

        self.status_var.set(f"Status: {status}")
        mode = "Mouse ON" if mouse_enabled else "Mouse OFF"
        self.sample_var.set(f"Samples: {sample_count}    Moves: {move_count}    Sensitivity: {sensitivity:.1f}    {mode}")
        self.gyro_var.set(f"Gyro rad/s: {gx:+.3f}, {gy:+.3f}, {gz:+.3f}")
        if gesture_calibrating:
            self.gesture_var.set(f"Gesture {gesture_step}/{gesture_total}: {gesture_prompt}")
        else:
            self.gesture_var.set(f"Gestures learned: {learned_gestures}/{gesture_total}. {gesture_prompt}")
        if last_gesture:
            self.detected_var.set(f"Last gesture: {last_gesture} ({last_gesture_score:.2f})")
        else:
            self.detected_var.set("Last gesture: none")

        if not has_started:
            self.info_var.set("Ready. Wear the module, then click Start.")
            self.canvas.itemconfig(self.ball, fill="#9ca3af")
        elif is_calibrating:
            self.info_var.set(f"Calibrating... keep still, remaining samples: {calibration_left}")
            self.canvas.itemconfig(self.ball, fill="#f59e0b")
        elif is_stationary:
            self.info_var.set("Stationary: auto drift correction active")
            self.canvas.itemconfig(self.ball, fill="#22c55e")
        else:
            self.info_var.set("Moving")
            self.canvas.itemconfig(self.ball, fill="#38bdf8")

        center = self.canvas_size // 2
        scale = (self.canvas_size // 2) - 28
        x = center + max(-1.0, min(1.0, ox)) * scale
        y = center + max(-1.0, min(1.0, oy)) * scale
        self.canvas.coords(
            self.ball,
            x - self.ball_radius,
            y - self.ball_radius,
            x + self.ball_radius,
            y + self.ball_radius,
        )

        if not self.stop_event.is_set():
            self.root.after(50, self.update)

    def run(self) -> None:
        self.root.mainloop()


def run_worker(args: argparse.Namespace, controller: MouseController, stop_event: threading.Event) -> None:
    try:
        asyncio.run(run_ble(args, controller, stop_event))
    except Exception as exc:
        controller.set_status(f"Error: {exc}")
        print(f"BLE worker error: {exc}", flush=True)
        stop_event.set()


def main() -> None:
    if sys.platform != "win32":
        raise RuntimeError("This mouse-control example currently uses Windows SendInput.")

    args = parse_args()
    if args.list:
        asyncio.run(list_devices(args.timeout))
        return

    stop_event = threading.Event()
    controller = MouseController(
        sensitivity=args.sensitivity,
        mouse_enabled=args.enable_mouse,
        debug=args.debug,
    )
    worker = threading.Thread(target=run_worker, args=(args, controller, stop_event), daemon=True)
    worker.start()

    if args.no_gui:
        try:
            while not stop_event.is_set():
                time.sleep(0.2)
        except KeyboardInterrupt:
            stop_event.set()
            print("\nStopped.")
    else:
        Dashboard(controller, stop_event).run()

    stop_event.set()
    worker.join(timeout=2.0)


if __name__ == "__main__":
    main()

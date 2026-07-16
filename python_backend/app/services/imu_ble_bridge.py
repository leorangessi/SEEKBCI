"""
IMU BLE 桥接（与 reference/esp32_bmi270_ble_mouse 同一协议 seekbci_imu_v1）。

优先使用 bleak（与 bmi270_ble_mouse_client.py 一致），避免 Electron Web Bluetooth 在 Windows 上不稳定。
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set

try:
    from bleak import BleakClient, BleakScanner

    _BLEAK_OK = True
    _IMPORT_ERROR: Optional[str] = None
except ImportError as e:
    BleakClient = None  # type: ignore
    BleakScanner = None  # type: ignore
    _BLEAK_OK = False
    _IMPORT_ERROR = str(e)

DEVICE_NAME = "ESP32_BMI270_MOUSE"
SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"


def availability() -> tuple[bool, str]:
    if not _BLEAK_OK:
        return False, f"未安装 bleak: {_IMPORT_ERROR or 'unknown'}（请执行 pip install bleak）"
    return True, "就绪"


def decode_payload(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {"kind": "empty", "raw": ""}
    if text.startswith("ERR,"):
        return {"kind": "error", "raw": text, "code": text[4:]}
    parts = text.split(",")
    if len(parts) != 6:
        return {"kind": "invalid", "raw": text}
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return {"kind": "invalid", "raw": text}
    return {
        "kind": "sample",
        "raw": text,
        "ax": nums[0],
        "ay": nums[1],
        "az": nums[2],
        "gx": nums[3],
        "gy": nums[4],
        "gz": nums[5],
        "ts": time.time(),
    }


class ImuBleBridge:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._client: Any = None
        self._status = "disconnected"
        self._detail = ""
        self._device_name = DEVICE_NAME
        self._sample_count = 0
        self._last_raw = ""
        self._last_error = ""
        self._last_sample: Optional[Dict[str, Any]] = None
        self._listeners: Set[Callable[[Dict[str, Any]], None]] = set()
        self._connect_task: Optional[asyncio.Future] = None
        self._stop_event: Optional[asyncio.Event] = None

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop and self._thread and self._thread.is_alive():
                return self._loop

            loop = asyncio.new_event_loop()
            ready = threading.Event()

            def runner() -> None:
                asyncio.set_event_loop(loop)
                ready.set()
                loop.run_forever()

            thread = threading.Thread(target=runner, name="imu-ble-bridge", daemon=True)
            thread.start()
            ready.wait(timeout=5)
            self._loop = loop
            self._thread = thread
            return loop

    def _set_status(self, status: str, detail: str = "") -> None:
        with self._lock:
            self._status = status
            self._detail = detail
        self._emit({"type": "status", "status": status, "detail": detail})

    def _emit(self, message: Dict[str, Any]) -> None:
        with self._lock:
            listeners = list(self._listeners)
        for cb in listeners:
            try:
                cb(message)
            except Exception:
                pass

    def add_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            self._listeners.add(cb)

    def remove_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            self._listeners.discard(cb)

    def snapshot(self) -> Dict[str, Any]:
        ok, detail = availability()
        with self._lock:
            return {
                "success": True,
                "available": ok,
                "availability_detail": detail,
                "status": self._status,
                "detail": self._detail,
                "device_name": self._device_name,
                "sample_count": self._sample_count,
                "last_raw": self._last_raw,
                "last_error": self._last_error,
                "last_sample": self._last_sample,
                "protocol": "seekbci_imu_v1",
            }

    def connect(self, device_name: Optional[str] = None, timeout: float = 12.0) -> Dict[str, Any]:
        ok, detail = availability()
        if not ok:
            raise RuntimeError(detail)

        name = (device_name or DEVICE_NAME).strip() or DEVICE_NAME
        with self._lock:
            if self._status in ("connected", "connecting", "scanning"):
                return self.snapshot()
            self._device_name = name

        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._connect_async(name, timeout), loop)
        return fut.result(timeout=timeout + 8)

    def disconnect(self) -> Dict[str, Any]:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._disconnect_async(), loop)
        try:
            fut.result(timeout=8)
        except Exception as e:
            self._set_status("disconnected", f"断开异常: {e}")
        return self.snapshot()

    async def _connect_async(self, name: str, timeout: float) -> Dict[str, Any]:
        await self._disconnect_async(quiet=True)
        self._set_status("scanning", f"扫描 {name}…")

        device = await BleakScanner.find_device_by_name(name, timeout=timeout)
        if device is None:
            # 宽松匹配：名称前缀 / 广播名包含 BMI270
            self._set_status("scanning", "精确名未找到，扩大扫描…")
            found = await BleakScanner.discover(timeout=min(8.0, timeout))
            for d in found:
                dn = (d.name or "")
                if name in dn or "BMI270" in dn.upper() or "ESP32_BMI270" in dn.upper():
                    device = d
                    break
            if device is None:
                names = ", ".join(sorted({(d.name or "(无)") for d in found})) or "无"
                self._set_status("disconnected", f"未找到 {name}。附近设备: {names}")
                raise RuntimeError(self._detail)

        self._set_status("connecting", getattr(device, "name", None) or name)

        def on_disconnect(_client: Any) -> None:
            self._set_status("disconnected", "GATT 断开")

        client = BleakClient(device, disconnected_callback=on_disconnect)
        await client.connect(timeout=timeout)
        self._client = client

        def notification_handler(_sender: Any, data: bytearray) -> None:
            try:
                raw = bytes(data).decode("utf-8", errors="replace").strip()
            except Exception:
                raw = ""
            decoded = decode_payload(raw)
            with self._lock:
                if decoded.get("kind") == "sample":
                    self._sample_count += 1
                    self._last_raw = raw
                    self._last_sample = decoded
                elif decoded.get("kind") == "error":
                    self._last_error = raw
            payload = {"type": "imu", **decoded}
            self._emit(payload)

        await client.start_notify(NOTIFY_UUID, notification_handler)
        self._set_status("connected", getattr(device, "name", None) or name)
        return self.snapshot()

    async def _disconnect_async(self, quiet: bool = False) -> None:
        client = self._client
        self._client = None
        if client is not None:
            try:
                if client.is_connected:
                    try:
                        await client.stop_notify(NOTIFY_UUID)
                    except Exception:
                        pass
                    await client.disconnect()
            except Exception:
                pass
        if not quiet:
            self._set_status("disconnected", "已断开")


imu_ble_bridge = ImuBleBridge()

"""
SEEKBCI EEG+IMU BLE 桥接（协议 seekbci_eeg_v2）。

固件: reference/SEEKBCI/SEEKBCI.ino
扩展 Cyton 包 39 字节:
  0xA0 | sample | EEG 24B | IMU 12B (6×int16 BE) | 0xC1
IMU: accel = i16/1000 → m/s^2; gyro = i16/10000 → rad/s
仍兼容旧 33 字节包（footer 0xC0，无 IMU）。

电量状态包 6 字节（TX notify / RX 命令 'p'）:
  0xB0 | volt_mV_BE | percent | flags | 0xC2
  flags bit0 = low battery
"""
from __future__ import annotations

import asyncio
import threading
import time
from collections import deque
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import numpy as np

try:
    from bleak import BleakClient, BleakScanner

    _BLEAK_OK = True
    _IMPORT_ERROR: Optional[str] = None
except ImportError as e:
    BleakClient = None  # type: ignore
    BleakScanner = None  # type: ignore
    _BLEAK_OK = False
    _IMPORT_ERROR = str(e)

DEVICE_NAME = "SEEKBCI"
SERVICE_UUID = "7f520001-1b15-4a0b-9f7f-8f54f8d7a001"
RX_UUID = "7f520002-1b15-4a0b-9f7f-8f54f8d7a001"
TX_UUID = "7f520003-1b15-4a0b-9f7f-8f54f8d7a001"
OTA_UUID = "7f520004-1b15-4a0b-9f7f-8f54f8d7a001"
OTA_CHUNK_SIZE = 480

PACKET_SIZE_V1 = 33
PACKET_SIZE_V2 = 39
BATTERY_PACKET_SIZE = 6
BATTERY_HEADER = 0xB0
BATTERY_FOOTER = 0xC2
N_CHANNELS = 8
DEFAULT_SAMPLING_RATE = 250.0
DEFAULT_GAIN = 24.0
ADS1299_VREF = 4.5
IMU_ACCEL_SCALE = 1000.0
IMU_GYRO_SCALE = 10000.0


def _norm_uuid(u: Any) -> str:
    return str(u or "").lower().replace("-", "").strip()


_SERVICE_UUID_NORM = _norm_uuid(SERVICE_UUID)


def _adv_has_seekbci_service(adv: Any) -> bool:
    if adv is None:
        return False
    for u in list(getattr(adv, "service_uuids", None) or []):
        nu = _norm_uuid(u)
        if nu == _SERVICE_UUID_NORM or _SERVICE_UUID_NORM in nu:
            return True
    return False


def _device_display_name(device: Any, adv: Any = None) -> str:
    name = (getattr(device, "name", None) or "").strip()
    if name:
        return name
    if adv is not None:
        local = (getattr(adv, "local_name", None) or "").strip()
        if local:
            return local
    return ""


def _is_seekbci_candidate(name: str, adv: Any = None) -> tuple[bool, bool]:
    """返回 (列入结果, 是否强匹配 SEEKBCI)。"""
    upper = (name or "").upper()
    by_name = "SEEKBCI" in upper or name == DEVICE_NAME
    by_svc = _adv_has_seekbci_service(adv)
    if by_name or by_svc:
        return True, True
    if name and ("BCI" in upper or "CYTON" in upper or "OPENBCI" in upper):
        return True, False
    return False, False


def availability() -> Tuple[bool, str]:
    if not _BLEAK_OK:
        return False, f"未安装 bleak: {_IMPORT_ERROR or 'unknown'}（请执行 pip install bleak）"
    return True, "就绪"


def _make_bleak_client(address: str, on_disconnect: Callable[[Any], None], use_cached_services: bool) -> Any:
    """Windows 上优先关闭 GATT 服务缓存，避免扫得到却连不上。"""
    assert BleakClient is not None
    try:
        return BleakClient(
            address,
            disconnected_callback=on_disconnect,
            winrt={"use_cached_services": use_cached_services},
        )
    except TypeError:
        return BleakClient(address, disconnected_callback=on_disconnect)


async def _ble_connect_with_retries(
    address: str,
    on_disconnect: Callable[[Any], None],
    timeout: float,
) -> Any:
    last_err: Optional[BaseException] = None
    for use_cached in (False, True):
        client = None
        try:
            client = _make_bleak_client(address, on_disconnect, use_cached)
            await client.connect(timeout=timeout)
            return client
        except Exception as e:
            last_err = e
            if client is not None:
                try:
                    await client.disconnect()
                except Exception:
                    pass
            await asyncio.sleep(0.45)
    raise RuntimeError(f"GATT 连接失败（地址 {address}）: {last_err}")


def scale_factor_uv(gain: float = DEFAULT_GAIN) -> float:
    return ADS1299_VREF / float(gain) / (2**23 - 1) * 1e6


def int24_be_to_int(b0: int, b1: int, b2: int) -> int:
    n = (b0 << 16) | (b1 << 8) | b2
    if n & 0x800000:
        n -= 0x1000000
    return n


def int16_be(b0: int, b1: int) -> int:
    n = (b0 << 8) | b1
    if n & 0x8000:
        n -= 0x10000
    return n


def parse_eeg_channels(packet: bytes, scale_uv: float) -> np.ndarray:
    ch = np.empty(N_CHANNELS, dtype=np.float64)
    base = 2
    for i in range(N_CHANNELS):
        o = base + i * 3
        raw = int24_be_to_int(packet[o], packet[o + 1], packet[o + 2])
        ch[i] = raw * scale_uv
    return ch


def parse_imu_block(block: bytes) -> Dict[str, float]:
    vals = [int16_be(block[i], block[i + 1]) for i in range(0, 12, 2)]
    return {
        "ax": vals[0] / IMU_ACCEL_SCALE,
        "ay": vals[1] / IMU_ACCEL_SCALE,
        "az": vals[2] / IMU_ACCEL_SCALE,
        "gx": vals[3] / IMU_GYRO_SCALE,
        "gy": vals[4] / IMU_GYRO_SCALE,
        "gz": vals[5] / IMU_GYRO_SCALE,
        "ts": time.time(),
    }


def parse_battery_packet(packet: bytes) -> Optional[Dict[str, Any]]:
    """解析 0xB0…0xC2 电量包。"""
    if (
        not packet
        or len(packet) < BATTERY_PACKET_SIZE
        or packet[0] != BATTERY_HEADER
        or packet[BATTERY_PACKET_SIZE - 1] != BATTERY_FOOTER
    ):
        return None
    mv = (packet[1] << 8) | packet[2]
    pct = int(packet[3]) & 0xFF
    flags = int(packet[4]) & 0xFF
    return {
        "voltage_mv": int(mv),
        "voltage_v": round(mv / 1000.0, 3),
        "percent": min(100, max(0, pct)),
        "low": bool(flags & 0x01),
        "ts": time.time(),
    }


def parse_packet(
    packet: bytes, scale_uv: float
) -> Optional[Tuple[np.ndarray, Optional[Dict[str, float]], int]]:
    """返回 (eeg, imu|None, sample_number)。"""
    if not packet or packet[0] != 0xA0:
        return None
    sample_number = packet[1] & 0xFF
    if len(packet) == PACKET_SIZE_V2 and packet[38] == 0xC1:
        eeg = parse_eeg_channels(packet, scale_uv)
        imu = parse_imu_block(packet[26:38])
        return eeg, imu, sample_number
    if len(packet) == PACKET_SIZE_V1 and (packet[32] & 0xF0) == 0xC0:
        eeg = parse_eeg_channels(packet, scale_uv)
        return eeg, None, sample_number
    return None


class PacketSeqStats:
    """按头环 sample_number（uint8 回绕）统计丢包。"""

    def __init__(self) -> None:
        self.packets_received = 0
        self.packets_lost = 0
        self.packets_duplicate = 0
        self.last_seq: Optional[int] = None
        self.first_seq: Optional[int] = None

    def reset(self) -> None:
        self.packets_received = 0
        self.packets_lost = 0
        self.packets_duplicate = 0
        self.last_seq = None
        self.first_seq = None

    def note(self, seq: int) -> int:
        """记录一个序号，返回本次推断丢失的包数。"""
        seq = int(seq) & 0xFF
        lost_now = 0
        if self.last_seq is None:
            self.first_seq = seq
            self.last_seq = seq
            self.packets_received = 1
            return 0

        if seq == self.last_seq:
            self.packets_duplicate += 1
            return 0

        expected = (self.last_seq + 1) & 0xFF
        if seq != expected:
            # 前向缺口（考虑 uint8 回绕）
            lost_now = (seq - expected) & 0xFF
            # 若缺口过大接近一整圈，更可能是乱序/回退，不当作大量丢包
            if lost_now > 127:
                lost_now = 0
            self.packets_lost += lost_now

        self.last_seq = seq
        self.packets_received += 1
        return lost_now

    def as_dict(self) -> Dict[str, Any]:
        expected_total = self.packets_received + self.packets_lost
        loss_rate = (
            (100.0 * self.packets_lost / expected_total) if expected_total > 0 else 0.0
        )
        return {
            "packets_received": self.packets_received,
            "packets_lost": self.packets_lost,
            "packets_duplicate": self.packets_duplicate,
            "loss_rate_pct": round(loss_rate, 3),
            "last_seq": self.last_seq,
            "first_seq": self.first_seq,
        }


class CytonStreamParser:
    """切出 v1/v2 包 → EEG µV 行 + 可选 IMU；顺带解析电量包。"""

    def __init__(self, gain: float = DEFAULT_GAIN, maxlen: int = 5000) -> None:
        self._buf = bytearray()
        self._scale = scale_factor_uv(gain)
        self.samples: deque = deque(maxlen=maxlen)
        self.imu_samples: deque = deque(maxlen=maxlen)
        self.packets_ok = 0
        self.packets_bad = 0
        self.last_imu: Optional[Dict[str, float]] = None
        self.last_battery: Optional[Dict[str, Any]] = None
        self.seq_stats = PacketSeqStats()

    def feed(self, data: bytes) -> Tuple[int, List[Dict[str, float]]]:
        if not data:
            return 0, []
        self._buf.extend(data)
        eeg_added = 0
        imu_batch: List[Dict[str, float]] = []
        while True:
            i_a0 = self._buf.find(0xA0)
            i_b0 = self._buf.find(BATTERY_HEADER)
            if i_a0 < 0 and i_b0 < 0:
                # 保留尾部，避免半包被清掉
                if len(self._buf) > BATTERY_PACKET_SIZE - 1:
                    del self._buf[: -(BATTERY_PACKET_SIZE - 1)]
                break

            # 优先处理更靠前的帧头（电量与 EEG 交错）
            if i_b0 >= 0 and (i_a0 < 0 or i_b0 < i_a0):
                if i_b0 > 0:
                    del self._buf[:i_b0]
                if len(self._buf) < BATTERY_PACKET_SIZE:
                    break
                if self._buf[BATTERY_PACKET_SIZE - 1] == BATTERY_FOOTER:
                    bat = parse_battery_packet(bytes(self._buf[:BATTERY_PACKET_SIZE]))
                    del self._buf[:BATTERY_PACKET_SIZE]
                    if bat is not None:
                        self.last_battery = bat
                    continue
                del self._buf[0]
                self.packets_bad += 1
                continue

            start = i_a0
            if start > 0:
                del self._buf[:start]
            if len(self._buf) < PACKET_SIZE_V1:
                break

            pkt_len = None
            if len(self._buf) >= PACKET_SIZE_V2 and self._buf[38] == 0xC1:
                pkt_len = PACKET_SIZE_V2
            elif (self._buf[32] & 0xF0) == 0xC0:
                pkt_len = PACKET_SIZE_V1
            else:
                if len(self._buf) >= PACKET_SIZE_V2:
                    del self._buf[0]
                    self.packets_bad += 1
                    continue
                break

            if len(self._buf) < pkt_len:
                break

            pkt = bytes(self._buf[:pkt_len])
            parsed = parse_packet(pkt, self._scale)
            if parsed is None:
                del self._buf[0]
                self.packets_bad += 1
                continue
            del self._buf[:pkt_len]
            eeg, imu, sample_number = parsed
            self.seq_stats.note(sample_number)
            self.samples.append(eeg)
            self.packets_ok += 1
            eeg_added += 1
            if imu is not None:
                self.last_imu = imu
                self.imu_samples.append(imu)
                imu_batch.append(imu)
        return eeg_added, imu_batch

    def pop_array(self, n: int) -> Optional[np.ndarray]:
        if n <= 0 or not self.samples:
            return None
        take = min(n, len(self.samples))
        rows = [self.samples.popleft() for _ in range(take)]
        return np.vstack(rows)


class EegBleBridge:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._client: Any = None
        self._status = "disconnected"
        self._detail = ""
        self._device_name = DEVICE_NAME
        self._address: Optional[str] = None
        self._parser = CytonStreamParser()
        self._sample_count = 0
        self._imu_count = 0
        self._last_error = ""
        self._connected_at = 0.0
        self._battery: Optional[Dict[str, Any]] = None
        self._imu_listeners: Set[Callable[[Dict[str, Any]], None]] = set()

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

            thread = threading.Thread(target=runner, name="eeg-ble-bridge", daemon=True)
            thread.start()
            ready.wait(timeout=5)
            self._loop = loop
            self._thread = thread
            return loop

    def _set_status(self, status: str, detail: str = "") -> None:
        with self._lock:
            self._status = status
            self._detail = detail

    def add_imu_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            self._imu_listeners.add(cb)

    def remove_imu_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            self._imu_listeners.discard(cb)

    def _emit_imu(self, imu: Dict[str, float]) -> None:
        payload = {"type": "imu", "kind": "sample", **imu}
        with self._lock:
            listeners = list(self._imu_listeners)
        for cb in listeners:
            try:
                cb(payload)
            except Exception:
                pass

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
                "address": self._address,
                "sample_count": self._sample_count,
                "imu_count": self._imu_count,
                "packets_ok": self._parser.packets_ok,
                "packets_bad": self._parser.packets_bad,
                "packet_stats": self._parser.seq_stats.as_dict(),
                "buffer_len": len(self._parser.samples),
                "last_error": self._last_error,
                "last_imu": self._parser.last_imu,
                "battery": self._battery,
                "sampling_rate": DEFAULT_SAMPLING_RATE,
                "channel_count": N_CHANNELS,
                "protocol": "seekbci_eeg_v2",
            }

    def imu_snapshot(self) -> Dict[str, Any]:
        """供 /api/imu 复用：SEEKBCI 已连接时作为 IMU 源。"""
        with self._lock:
            connected = self._status == "connected"
            last = self._parser.last_imu
            return {
                "success": True,
                "available": True,
                "availability_detail": "SEEKBCI EEG+IMU",
                "status": "connected" if connected else self._status,
                "detail": self._detail if connected else "请先在设备管理连接 SEEKBCI BLE",
                "device_name": self._device_name,
                "sample_count": self._imu_count,
                "last_sample": (
                    {"kind": "sample", **last} if last else None
                ),
                "last_error": self._last_error,
                "protocol": "seekbci_eeg_v2",
                "source": "seekbci",
            }

    def scan(self, timeout: float = 6.0) -> List[Dict[str, Any]]:
        ok, detail = availability()
        if not ok:
            raise RuntimeError(detail)
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._scan_async(timeout), loop)
        return fut.result(timeout=timeout + 8)

    async def _scan_async(self, timeout: float) -> List[Dict[str, Any]]:
        # Windows 上本地名经常为空，必须结合 advertisement 的 service_uuids
        found = await BleakScanner.discover(timeout=timeout, return_adv=True)
        devices: List[Dict[str, Any]] = []
        seen = set()
        items = found.items() if isinstance(found, dict) else []
        for addr_key, pair in items:
            d, adv = pair
            name = _device_display_name(d, adv)
            addr = getattr(d, "address", None) or addr_key or ""
            if not name and not addr:
                continue
            key = addr or name
            if key in seen:
                continue
            listed, strong = _is_seekbci_candidate(name, adv)
            if not listed:
                continue
            seen.add(key)
            display = name or ("SEEKBCI" if strong else "(unnamed)")
            rssi = getattr(adv, "rssi", None)
            if rssi is None:
                rssi = getattr(d, "rssi", None)
            devices.append(
                {
                    "name": display,
                    "address": addr,
                    "rssi": rssi,
                    "match": bool(strong),
                    "by_service": _adv_has_seekbci_service(adv),
                }
            )
        devices.sort(key=lambda x: (not x.get("match"), x.get("name") or ""))
        return devices

    def connect(
        self,
        device_name: Optional[str] = None,
        address: Optional[str] = None,
        timeout: float = 15.0,
        start_stream: bool = True,
    ) -> Dict[str, Any]:
        ok, detail = availability()
        if not ok:
            raise RuntimeError(detail)

        name = (device_name or DEVICE_NAME).strip() or DEVICE_NAME
        if name.startswith("(") or name.lower() in ("unnamed", "(unnamed)", "unknown"):
            name = DEVICE_NAME
        with self._lock:
            # 仅在真正已连接时复用；connecting/scanning 常为上次失败残留，必须清掉再连
            if (
                self._status == "connected"
                and self._client is not None
                and getattr(self._client, "is_connected", False)
            ):
                # 复用连接时强制再发开流，避免「已连接但无数据」
                if start_stream:
                    loop = self._ensure_loop()
                    fut = asyncio.run_coroutine_threadsafe(self._ensure_stream_async(), loop)
                    try:
                        fut.result(timeout=5)
                    except Exception as e:
                        self._last_error = f"重启数据流失败: {e}"
                return self.snapshot()
            self._device_name = name
            self._parser = CytonStreamParser()
            self._sample_count = 0
            self._imu_count = 0

        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(
            self._connect_async(name, address, timeout, start_stream), loop
        )
        return fut.result(timeout=timeout + 20)

    def disconnect(self) -> Dict[str, Any]:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._disconnect_async(), loop)
        try:
            fut.result(timeout=10)
        except Exception as e:
            self._set_status("disconnected", f"断开异常: {e}")
        return self.snapshot()

    def pop_samples(self, n: int) -> Optional[np.ndarray]:
        with self._lock:
            if self._status != "connected":
                return None
            return self._parser.pop_array(n)

    def send_command(self, cmd: str) -> None:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._write_cmd_async(cmd), loop)
        fut.result(timeout=5)

    def request_battery(self) -> None:
        """向固件发送 'p'，请求一次电量 notify。"""
        self.send_command("p")

    def ota_update(
        self,
        firmware: bytes,
        device_name: Optional[str] = None,
        address: Optional[str] = None,
        timeout: float = 20.0,
        progress_cb: Optional[Callable[[int, str], None]] = None,
    ) -> Dict[str, Any]:
        ok, detail = availability()
        if not ok:
            raise RuntimeError(detail)
        if not firmware:
            raise RuntimeError("固件为空")
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(
            self._ota_update_async(firmware, device_name or DEVICE_NAME, address, timeout, progress_cb),
            loop,
        )
        return fut.result(timeout=max(60.0, timeout + len(firmware) / 1800.0 + 45.0))

    async def _ota_update_async(
        self,
        firmware: bytes,
        device_name: str,
        address: Optional[str],
        timeout: float,
        progress_cb: Optional[Callable[[int, str], None]],
    ) -> Dict[str, Any]:
        def progress(percent: int, message: str) -> None:
            if progress_cb:
                try:
                    progress_cb(percent, message)
                except Exception:
                    pass

        progress(0, "断开采集连接")
        await self._disconnect_async(quiet=True)
        await asyncio.sleep(1.2)

        name = (device_name or DEVICE_NAME).strip() or DEVICE_NAME
        progress(0, f"扫描 {name}")
        device = await self._find_device_async(name, address, timeout)
        addr = getattr(device, "address", None) or address
        if not addr:
            raise RuntimeError("设备无有效 BLE 地址")

        progress(0, f"连接 {getattr(device, 'name', None) or name}")

        def on_disconnect(_client: Any) -> None:
            self._set_status("disconnected", "OTA GATT 断开")

        client = await _ble_connect_with_retries(addr, on_disconnect, timeout)
        try:
            self._client = client
            with self._lock:
                self._address = addr
            self._set_status("ota", "固件升级中")

            ota_status: Dict[str, str] = {"kind": "", "detail": ""}

            def notification_handler(_sender: Any, data: bytearray) -> None:
                text = bytes(data).decode("utf-8", errors="ignore").strip()
                if not text.startswith("OTA:"):
                    return
                parts = text.split(":")
                ota_status["kind"] = parts[1] if len(parts) > 1 else ""
                ota_status["detail"] = ":".join(parts[2:]) if len(parts) > 2 else ""
                if ota_status["kind"] == "PROGRESS":
                    try:
                        progress(int(ota_status["detail"] or "0"), "设备写入中")
                    except ValueError:
                        progress(0, text)
                else:
                    progress(100 if ota_status["kind"] == "DONE" else 0, text)

            await client.start_notify(TX_UUID, notification_handler)
            await client.write_gatt_char(OTA_UUID, f"OTA:BEGIN:{len(firmware)}:".encode("utf-8"), response=True)
            await asyncio.sleep(0.35)
            if ota_status.get("kind") == "ERROR":
                raise RuntimeError(f"设备拒绝 OTA: {ota_status.get('detail')}")

            total = len(firmware)
            for offset in range(0, total, OTA_CHUNK_SIZE):
                chunk = firmware[offset : offset + OTA_CHUNK_SIZE]
                await client.write_gatt_char(OTA_UUID, chunk, response=True)
                percent = int(min(99, ((offset + len(chunk)) * 100) // total))
                progress(percent, f"发送固件 {percent}%")
                await asyncio.sleep(0.06)

            await client.write_gatt_char(OTA_UUID, b"OTA:END", response=True)
            deadline = time.time() + 12.0
            while time.time() < deadline:
                if ota_status.get("kind") == "DONE":
                    progress(100, "OTA 完成，设备正在重启")
                    return {"success": True, "message": "OTA 完成，设备正在重启", "bytes": total}
                if ota_status.get("kind") == "ERROR":
                    raise RuntimeError(f"设备 OTA 错误: {ota_status.get('detail')}")
                await asyncio.sleep(0.2)
            return {"success": True, "message": "固件已发送，等待设备重启", "bytes": total}
        finally:
            try:
                if client.is_connected:
                    try:
                        await client.stop_notify(TX_UUID)
                    except Exception:
                        pass
                    await client.disconnect()
            except Exception:
                pass
            self._client = None
            with self._lock:
                self._address = None
            self._set_status("disconnected", "OTA 结束")

    async def _write_cmd_async(self, cmd: str) -> None:
        client = self._client
        if client is None or not client.is_connected:
            raise RuntimeError("BLE 未连接")
        payload = cmd.encode("utf-8")
        await client.write_gatt_char(RX_UUID, payload, response=False)

    async def _ensure_stream_async(self) -> None:
        client = self._client
        if client is None or not getattr(client, "is_connected", False):
            raise RuntimeError("BLE 未连接")
        try:
            await client.write_gatt_char(RX_UUID, b"b", response=False)
        except Exception as e:
            self._last_error = f"发送启动命令失败: {e}"
            raise

    async def _find_device_async(
        self, name: str, address: Optional[str], timeout: float
    ) -> Any:
        if address:
            device = await BleakScanner.find_device_by_address(address, timeout=timeout)
            if device is not None:
                return device

        device = await BleakScanner.find_device_by_name(name, timeout=min(6.0, timeout))
        if device is not None:
            return device

        self._set_status("scanning", "按名称未找到，按服务 UUID / 扩大扫描…")
        found = await BleakScanner.discover(
            timeout=min(10.0, max(6.0, timeout)), return_adv=True
        )
        items = found.items() if isinstance(found, dict) else []
        by_svc = None
        by_name = None
        nearby: List[str] = []
        for _addr, pair in items:
            d, adv = pair
            dn = _device_display_name(d, adv)
            nearby.append(dn or getattr(d, "address", None) or "(无)")
            listed, strong = _is_seekbci_candidate(dn, adv)
            if not listed:
                continue
            if strong and _adv_has_seekbci_service(adv) and by_svc is None:
                by_svc = d
            if strong and by_name is None and dn and "SEEKBCI" in dn.upper():
                by_name = d
            if by_svc is None and strong:
                by_svc = d
        device = by_svc or by_name
        if device is None:
            names = ", ".join(sorted(set(nearby))) or "无"
            self._set_status("disconnected", f"未找到 {name}。附近设备: {names}")
            raise RuntimeError(self._detail)
        return device

    async def _connect_async(
        self,
        name: str,
        address: Optional[str],
        timeout: float,
        start_stream: bool,
    ) -> Dict[str, Any]:
        try:
            await self._disconnect_async(quiet=True)
            self._set_status("scanning", f"扫描 {name}…")

            device = await self._find_device_async(name, address, timeout)

            addr = getattr(device, "address", None) or address
            if not addr:
                self._set_status("disconnected", "设备无有效 BLE 地址")
                raise RuntimeError(self._detail)

            self._set_status("connecting", f"{getattr(device, 'name', None) or name} ({addr})")

            def on_disconnect(_client: Any) -> None:
                self._set_status("disconnected", "GATT 断开")

            # 用地址连接更稳；失败时切换 Windows GATT 缓存策略重试
            client = await _ble_connect_with_retries(addr, on_disconnect, timeout)
            try:
                if hasattr(client, "request_mtu"):
                    await client.request_mtu(185)
            except Exception:
                pass

            self._client = client
            with self._lock:
                self._address = addr

            def notification_handler(_sender: Any, data: bytearray) -> None:
                raw = bytes(data)
                if raw and raw[0] != 0xA0 and raw[0] != BATTERY_HEADER and (
                    b"SEEKBCI" in raw or b"OpenBCI" in raw
                ):
                    return
                with self._lock:
                    eeg_n, imu_batch = self._parser.feed(raw)
                    self._sample_count += eeg_n
                    self._imu_count += len(imu_batch)
                    if self._parser.last_battery is not None:
                        self._battery = dict(self._parser.last_battery)
                if imu_batch:
                    self._emit_imu(dict(imu_batch[-1]))

            await client.start_notify(TX_UUID, notification_handler)

            if start_stream:
                try:
                    await client.write_gatt_char(RX_UUID, b"b", response=False)
                except Exception as e:
                    self._last_error = f"发送启动命令失败: {e}"

            # 连接后主动要一次电量（固件 'p'）
            try:
                await asyncio.sleep(0.15)
                await client.write_gatt_char(RX_UUID, b"p", response=False)
            except Exception as e:
                self._last_error = f"请求电量失败: {e}"

            self._connected_at = time.time()
            self._set_status("connected", getattr(device, "name", None) or name)
            return self.snapshot()
        except Exception as e:
            try:
                await self._disconnect_async(quiet=True)
            except Exception:
                pass
            msg = str(e) or repr(e)
            self._set_status("disconnected", f"连接失败: {msg}")
            self._last_error = msg
            raise RuntimeError(self._detail) from e

    async def _disconnect_async(self, quiet: bool = False) -> None:
        client = self._client
        self._client = None
        if client is not None:
            try:
                if client.is_connected:
                    try:
                        await client.write_gatt_char(RX_UUID, b"s", response=False)
                    except Exception:
                        pass
                    try:
                        await client.stop_notify(TX_UUID)
                    except Exception:
                        pass
                    await client.disconnect()
            except Exception:
                pass
        with self._lock:
            self._address = None
            self._parser = CytonStreamParser()
            self._battery = None
        if not quiet:
            self._set_status("disconnected", "已断开")


eeg_ble_bridge = EegBleBridge()

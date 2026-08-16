"""
SEEKBCI 控制板 BLE 桥接模块（多连接版）。
支持同时连接多个 SEEKBCI_CTRL 设备，每个设备独立维护 BleakClient。
"""
from __future__ import annotations

import asyncio
import struct
import threading
import time
from collections import deque
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

try:
    from bleak import BleakClient, BleakScanner
    _BLEAK_OK = True
except ImportError:
    BleakClient = None
    BleakScanner = None
    _BLEAK_OK = False

CTRL_SERVICE_UUID = "7f530001-1b15-4a0b-9f7f-8f54f8d7a001"
CTRL_RX_UUID = "7f530002-1b15-4a0b-9f7f-8f54f8d7a001"
CTRL_TX_UUID = "7f530003-1b15-4a0b-9f7f-8f54f8d7a001"
CTRL_OTA_UUID = "7f530004-1b15-4a0b-9f7f-8f54f8d7a001"
CTRL_CONFIG_UUID = "7f530005-1b15-4a0b-9f7f-8f54f8d7a001"

CMD_HEADER = 0xC0
CMD_FOOTER = 0xC3
STATUS_HEADER = 0xD0
STATUS_FOOTER = 0xD3
CONFIG_HEADER = 0xE0
CONFIG_FOOTER = 0xE3


ACTION_GPIO_SET = 0x01
ACTION_GPIO_TOGGLE = 0x02
ACTION_DAC = 0x03
ACTION_PWM = 0x04
ACTION_PWM_TIMED = 0x05
ACTION_SERVO = 0x06

SIGNAL_GPIO = 0x01
SIGNAL_ADC = 0x02
SIGNAL_EOG = 0x10
SIGNAL_EMG = 0x11
SIGNAL_FOCUS = 0x12

TRIGGER_EDGE = 0x01
TRIGGER_THRESH = 0x02
TRIGGER_LINEAR = 0x03
CTRL_DEVICE_PREFIX = "SEEKBCI_CTRL"
NVS_CMD_SAVE_AND_RESTART = bytes([0xEE, 0x01])
NVS_CMD_CLEAR_AND_RESTART = bytes([0xEE, 0x02])

ROLE_INPUT = 0x01
ROLE_OUTPUT = 0x02


def _norm_uuid(u: Any) -> str:
    return str(u or "").lower().replace("-", "").strip()

_CTRL_SERVICE_NORM = _norm_uuid(CTRL_SERVICE_UUID)

def _adv_has_ctrl_service(adv: Any) -> bool:
    if adv is None:
        return False
    for u in list(getattr(adv, "service_uuids", None) or []):
        if _CTRL_SERVICE_NORM in _norm_uuid(u):
            return True
    return False

def _is_ctrl_device(name: str, adv: Any = None) -> bool:
    upper = (name or "").upper()
    if CTRL_DEVICE_PREFIX.upper() in upper:
        return True
    return _adv_has_ctrl_service(adv)

def availability() -> Tuple[bool, str]:
    if not _BLEAK_OK:
        return False, "bleak not installed"
    return True, "ready"

def build_command_packet(action_type: int, pin: int, param1: int = 0, param2: int = 0) -> bytes:
    return struct.pack("<BBBHHB", CMD_HEADER, action_type, pin, param1, param2, CMD_FOOTER)

def parse_status_packet(data: bytes) -> Optional[Dict[str, Any]]:
    if len(data) < 6:
        return None
    if data[0] != STATUS_HEADER or data[5] != STATUS_FOOTER:
        return None
    return {"channel": data[1], "signal_type": data[2],
            "value": struct.unpack_from("<H", data, 3)[0], "ts": time.time()}

def parse_mfg_data(mfg_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not mfg_bytes or len(mfg_bytes) < 4:
        return None
    role, caps = mfg_bytes[0], mfg_bytes[1]
    device_id = struct.unpack_from("<H", mfg_bytes, 2)[0]
    return {
        "role": role,
        "role_name": "INPUT" if role == ROLE_INPUT else "OUTPUT" if role == ROLE_OUTPUT else "UNKNOWN",
        "capabilities": caps, "device_id": device_id,
    }

def build_rule_bytes(rule: Dict[str, Any]) -> bytes:
    mac_str = rule.get("target_mac", "00:00:00:00:00:00")
    mac_bytes = bytes(int(x, 16) for x in mac_str.split(":"))
    if len(mac_bytes) != 6:
        mac_bytes = b'\x00' * 6
    return struct.pack(
        "<BBBBhhBBHH6s", 0x01,
        rule.get("signal_type", 0x01), rule.get("source_channel", 0),
        rule.get("trigger_mode", 0x01), rule.get("threshold_low", 0),
        rule.get("threshold_high", 4095), rule.get("action_type", 0x01),
        rule.get("target_pin", 2), rule.get("action_param1", 1),
        rule.get("action_param2", 0), mac_bytes)

def build_algo_params_bytes(params: Dict[str, Any]) -> bytes:
    return struct.pack(
        "<fIfffffBBH8s",
        params.get("eog_threshold_uv", 45.0), params.get("eog_refractory_ms", 350),
        params.get("eog_baseline_tau", 1.5), params.get("emg_threshold_uv", 60.0),
        params.get("emg_window_sec", 1.0), params.get("emg_min_bin_fraction", 0.4),
        params.get("focus_threshold", 70), params.get("focus_metric", 0),
        params.get("focus_fft_size", 128), b'\x00' * 8)



class DeviceConnection:
    """单个设备的连接状态。"""
    def __init__(self, address: str):
        self.address = address
        self.client: Any = None
        self.connected_at = 0.0
        self.name = address

    @property
    def is_connected(self) -> bool:
        return self.client is not None and getattr(self.client, "is_connected", False)


class CtrlBleBridge:
    """多连接 BLE 控制板管理器。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._connections: Dict[str, DeviceConnection] = {}
        self._last_error = ""
        self._signal_history: deque = deque(maxlen=500)
        self._signal_listeners: Set[Callable] = set()
        self._active_rules: List[Dict[str, Any]] = []

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop and self._thread and self._thread.is_alive():
                return self._loop
            loop = asyncio.new_event_loop()
            ready = threading.Event()
            def runner():
                asyncio.set_event_loop(loop)
                ready.set()
                loop.run_forever()
            t = threading.Thread(target=runner, name="ctrl-ble-multi", daemon=True)
            t.start()
            ready.wait(timeout=5)
            self._loop = loop
            self._thread = t
            return loop

    def snapshot(self) -> Dict[str, Any]:
        ok, det = availability()
        with self._lock:
            conns = {}
            for addr, dc in self._connections.items():
                conns[addr] = {
                    "address": addr, "name": dc.name,
                    "connected": dc.is_connected,
                    "connected_at": dc.connected_at,
                }
            return {
                "available": ok, "availability_detail": det,
                "connections": conns,
                "connected_count": sum(1 for dc in self._connections.values() if dc.is_connected),
                "last_error": self._last_error,
                "signal_count": len(self._signal_history),
            }

    def device_status(self, address: str) -> Dict[str, Any]:
        with self._lock:
            dc = self._connections.get(address)
            if not dc:
                return {"address": address, "connected": False}
            return {"address": address, "name": dc.name,
                    "connected": dc.is_connected, "connected_at": dc.connected_at}

    def add_signal_listener(self, cb: Callable) -> None:
        with self._lock:
            self._signal_listeners.add(cb)

    def remove_signal_listener(self, cb: Callable) -> None:
        with self._lock:
            self._signal_listeners.discard(cb)

    def _emit_signal(self, address: str, sig: Dict[str, Any], route: bool = True) -> None:
        sig["address"] = address
        with self._lock:
            self._signal_history.append(sig)
            listeners = list(self._signal_listeners)
        for cb in listeners:
            try:
                cb(sig)
            except Exception:
                pass
        if route:
            self._route_signal(address, sig)

    def get_signals(self, count: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._signal_history)[-count:]

    # --- public sync API ---


    # --- Runtime rule engine ---

    def apply_runtime_rules(self, rules: List[Dict[str, Any]]) -> None:
        """
        Activate rules for real-time signal forwarding.
        Each rule: {from_addr, from_pin, from_type, to_addr, to_pin, to_action, to_param1, to_param2}
        """
        with self._lock:
            self._active_rules = list(rules)
        print(f"[rule-engine] {len(rules)} rules activated")

    def clear_runtime_rules(self) -> None:
        with self._lock:
            self._active_rules = []
        from app.services.logic_rule_engine import logic_rule_engine
        logic_rule_engine.clear()
        print("[rule-engine] rules cleared")

    def get_runtime_rules(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._active_rules)

    def _route_signal(self, source_addr: str, signal: Dict[str, Any]) -> None:
        """Evaluate logic graph or linear rules and forward to target devices."""
        from app.services.logic_rule_engine import logic_rule_engine

        sig_channel = signal.get("channel", 0)
        sig_type = signal.get("signal_type", 0)
        sig_value = signal.get("value", 0)

        if logic_rule_engine.active:
            actions = logic_rule_engine.on_signal(
                source_addr, int(sig_channel), int(sig_type), int(sig_value))
            for act in actions:
                try:
                    asyncio.get_running_loop().create_task(
                        self._forward_action(
                            act["to_addr"], act["to_action"],
                            act["to_pin"], act["to_param1"], act.get("to_param2", 0)))
                except RuntimeError:
                    loop = self._ensure_loop()
                    asyncio.run_coroutine_threadsafe(
                        self._forward_action(
                            act["to_addr"], act["to_action"],
                            act["to_pin"], act["to_param1"], act.get("to_param2", 0)), loop)
            return

        with self._lock:
            rules = list(self._active_rules)
        if not rules:
            return

        for rule in rules:
            if rule.get("from_addr") != source_addr:
                continue
            if rule.get("from_pin") != sig_channel:
                continue

            if rule.get("from_type", sig_type) != sig_type:
                continue
            to_addr = rule.get("to_addr")
            to_action = rule.get("to_action", 1)
            to_pin = rule.get("to_pin", 2)
            to_param1 = rule.get("to_param1")
            to_param2 = rule.get("to_param2", 0)

            if to_param1 is None:
                to_param1 = 1 if sig_value > 0 else 0

            try:
                print(f"[rule-engine] FORWARD: {source_addr}:pin{sig_channel} val={sig_value} -> {to_addr}:pin{to_pin} action={to_action} p1={to_param1}")
                loop = self._ensure_loop()
                asyncio.run_coroutine_threadsafe(
                    self._forward_action(to_addr, to_action, to_pin, to_param1, to_param2), loop)
            except Exception as e:
                print(f"[rule-engine] forward failed: {e}")

    async def _forward_action(
        self, address: str, action_type: int, pin: int, param1: int, param2: int
    ) -> None:
        try:
            await self._write_rx(
                address, build_command_packet(action_type, pin, param1, param2)
            )
            self._emit_action_confirmation(address, action_type, pin, param1)
        except Exception as e:
            self._last_error = str(e)
            print(f"[rule-engine] forward failed: {e}")

    def _emit_action_confirmation(
        self, address: str, action_type: int, pin: int, value: int
    ) -> None:
        signal_type = {
            ACTION_GPIO_SET: 0x21,
            ACTION_GPIO_TOGGLE: 0x21,
            ACTION_DAC: 0x22,
            ACTION_PWM: 0x23,
            ACTION_PWM_TIMED: 0x23,
            ACTION_SERVO: 0x24,
        }.get(action_type)
        if signal_type is None:
            return
        if action_type == ACTION_SERVO:
            value = min(value, 180)
        self._emit_signal(
            address,
            {"channel": pin, "signal_type": signal_type, "value": value,
             "ts": time.time(), "confirmed": True},
            route=False,
        )

    def scan(self, timeout: float = 4.0) -> List[Dict[str, Any]]:
        ok, msg = availability()
        if not ok:
            raise RuntimeError(msg)
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._scan_async(timeout), loop)
        return fut.result(timeout=timeout + 8)

    def connect(self, address: str, timeout: float = 10.0) -> Dict[str, Any]:
        ok, msg = availability()
        if not ok:
            raise RuntimeError(msg)
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._connect_async(address, timeout), loop)
        return fut.result(timeout=timeout + 15)

    def disconnect(self, address: str) -> Dict[str, Any]:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._disconnect_async(address), loop)
        try:
            fut.result(timeout=10)
        except Exception:
            pass
        return self.device_status(address)

    def disconnect_all(self) -> None:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._disconnect_all_async(), loop)
        try:
            fut.result(timeout=15)
        except Exception:
            pass

    def send_action(self, address: str, action_type: int, pin: int, param1: int = 0, param2: int = 0) -> bool:
        pkt = build_command_packet(action_type, pin, param1, param2)
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._write_rx(address, pkt), loop)
        try:
            fut.result(timeout=5)
            self._emit_action_confirmation(address, action_type, pin, param1)
            return True
        except Exception as e:
            self._last_error = str(e)
            return False

    def write_rules(self, address: str, rules: List[Dict], algo_params: Optional[Dict] = None) -> bool:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._write_rules_async(address, rules, algo_params), loop)
        return fut.result(timeout=15)

    def trigger_standalone(self, address: str, rules: List[Dict], algo_params: Optional[Dict] = None) -> bool:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._trigger_standalone_async(address, rules, algo_params), loop)
        return fut.result(timeout=15)

    def clear_rules(self, address: str) -> bool:
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(self._clear_rules_async(address), loop)
        return fut.result(timeout=10)

    # --- async internals ---

    async def _scan_async(self, timeout: float):
        detected = {}
        def on_detection(device, adv):
            name = (getattr(device, "name", None) or "").strip()
            if not name:
                name = (getattr(adv, "local_name", None) or "").strip()
            addr = getattr(device, "address", None) or ""
            if not _is_ctrl_device(name, adv):
                return
            rssi = getattr(adv, "rssi", None) or getattr(device, "rssi", None)
            mfg = None
            mfg_map = getattr(adv, "manufacturer_data", None)
            if mfg_map and isinstance(mfg_map, dict):
                for _cid, raw in mfg_map.items():
                    mfg = parse_mfg_data(bytes(raw))
                    break
            detected[addr] = {
                "name": name or CTRL_DEVICE_PREFIX,
                "address": addr, "rssi": rssi,
                "mfg_info": mfg,
                "role_name": mfg["role_name"] if mfg else None,
            }
        scanner = BleakScanner(detection_callback=on_detection)
        await scanner.start()
        await asyncio.sleep(min(timeout, 4.0))
        await scanner.stop()
        devices = list(detected.values())
        with self._lock:
            for d in devices:
                dc = self._connections.get(d["address"])
                d["connected"] = dc.is_connected if dc else False
        devices.sort(key=lambda x: x.get("name") or "")
        return devices

    async def _connect_async(self, address: str, timeout: float) -> Dict[str, Any]:
        with self._lock:
            dc = self._connections.get(address)
            if dc and dc.is_connected:
                return self.device_status(address)

        def on_disconnect(_c):
            with self._lock:
                dc2 = self._connections.get(address)
                if dc2:
                    dc2.client = None

        client = BleakClient(address, disconnected_callback=on_disconnect)
        await client.connect(timeout=timeout)

        dc = DeviceConnection(address)
        dc.client = client
        dc.connected_at = time.time()

        try:
            await client.start_notify(CTRL_TX_UUID, lambda s, d: self._on_tx_notify(address, s, d))
            print(f"[ble] {address}: TX notify subscribed OK")
        except Exception as e:
            print(f"[ble] {address}: TX notify FAILED: {e}")

        with self._lock:
            self._connections[address] = dc

        return self.device_status(address)

    async def _disconnect_async(self, address: str) -> None:
        with self._lock:
            dc = self._connections.pop(address, None)
        if dc and dc.client:
            try:
                if dc.client.is_connected:
                    await dc.client.disconnect()
            except Exception:
                pass

    async def _disconnect_all_async(self) -> None:
        with self._lock:
            addrs = list(self._connections.keys())
        for addr in addrs:
            await self._disconnect_async(addr)

    def _on_tx_notify(self, address: str, _sender: Any, data: bytearray) -> None:
        if not data:
            return
        print(f"[ble-rx] {address}: {list(data)}")
        parsed = parse_status_packet(bytes(data))
        if parsed:
            print(f"[ble-rx] parsed: pin={parsed.get('channel')} type={parsed.get('signal_type')} val={parsed.get('value')}")
            self._emit_signal(address, parsed)

    async def _write_rx(self, address: str, data: bytes) -> None:
        with self._lock:
            dc = self._connections.get(address)
        if not dc or not dc.is_connected:
            raise RuntimeError(f"device {address} not connected")
        await dc.client.write_gatt_char(CTRL_RX_UUID, data, response=False)

    async def _write_config(self, address: str, data: bytes) -> None:
        with self._lock:
            dc = self._connections.get(address)
        if not dc or not dc.is_connected:
            raise RuntimeError(f"device {address} not connected")
        await dc.client.write_gatt_char(CTRL_CONFIG_UUID, data, response=True)

    def configure_pins(self, address: str, din_pins: list, adc_pins: list) -> bool:
        """Push DIN/ADC pin monitoring config via CONFIG characteristic."""
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(
            self._configure_pins_async(address, din_pins, adc_pins), loop)
        return fut.result(timeout=10)

    async def _configure_pins_async(self, address: str, din_pins: list, adc_pins: list) -> bool:
        await self._write_config(address, bytes([CONFIG_HEADER, 0x10, CONFIG_FOOTER]))
        await asyncio.sleep(0.08)
        din = [int(p) for p in din_pins][:8]
        adc = [int(p) for p in adc_pins][:6]
        if din:
            await self._write_config(
                address, bytes([CONFIG_HEADER, 0x01, len(din)] + din + [CONFIG_FOOTER]))
            await asyncio.sleep(0.08)
        if adc:
            await self._write_config(
                address, bytes([CONFIG_HEADER, 0x02, len(adc)] + adc + [CONFIG_FOOTER]))
            await asyncio.sleep(0.08)
            for pin in adc:
                await self._write_rx(
                    address, build_command_packet(0x12, pin, 0, 0))
                await asyncio.sleep(0.05)
        print(f"[config] sent to {address} via CONFIG: DIN={din} ADC={adc}")
        return True


    async def _write_rules_async(self, address: str, rules: List[Dict], algo_params) -> bool:
        for rule in rules:
            await self._write_config(address, build_rule_bytes(rule))
            await asyncio.sleep(0.1)
        if algo_params:
            await self._write_config(address, build_algo_params_bytes(algo_params))
            await asyncio.sleep(0.1)
        return True

    async def _trigger_standalone_async(self, address: str, rules: List[Dict], algo_params) -> bool:
        await self._write_rules_async(address, rules, algo_params)
        await asyncio.sleep(0.2)
        await self._write_config(address, NVS_CMD_SAVE_AND_RESTART)
        with self._lock:
            self._connections.pop(address, None)
        return True

    async def _clear_rules_async(self, address: str) -> bool:
        await self._write_config(address, NVS_CMD_CLEAR_AND_RESTART)
        with self._lock:
            self._connections.pop(address, None)
        return True


ctrl_ble_bridge = CtrlBleBridge()

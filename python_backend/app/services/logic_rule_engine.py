"""
逻辑规则图引擎 — 在 IN 设备与 OUT 设备之间执行 Grasshopper 式逻辑块。
"""
from __future__ import annotations

import ast
import math
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from app.services.ctrl_ble_bridge import (
    ACTION_DAC,
    ACTION_GPIO_SET,
    ACTION_PWM,
    ACTION_SERVO,
    SIGNAL_ADC,
    SIGNAL_GPIO,
)

SIGNAL_DIGITAL = 1
SIGNAL_ANALOG = 2


def _as_digital(value: Any) -> int:
    if isinstance(value, dict):
        value = value.get("value", 0)
    try:
        return 1 if float(value) > 0.5 else 0
    except (TypeError, ValueError):
        return 0


def _as_analog(value: Any) -> float:
    if isinstance(value, dict):
        value = value.get("value", 0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class LogicRuleEngine:
    """Evaluate a connection graph with logic blocks on each signal update."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._active = False
        self._logic_nodes: Dict[str, Dict[str, Any]] = {}
        self._connections: List[Dict[str, str]] = []
        self._sources: Dict[str, Tuple[float, int]] = {}
        self._last_outputs: Dict[str, Tuple[int, int]] = {}
        self._timers: Dict[str, Dict[str, float]] = {}
        self._counters: Dict[str, Dict[str, float]] = {}
        self._edge_prev: Dict[str, float] = {}
        self._pid_state: Dict[str, Dict[str, float]] = {}
        self._script_ns: Dict[str, Any] = {"__builtins__": {}}

    def clear(self) -> None:
        with self._lock:
            self._active = False
            self._logic_nodes.clear()
            self._connections.clear()
            self._sources.clear()
            self._last_outputs.clear()
            self._pid_state.clear()
            self._timers.clear()
            self._counters.clear()
            self._edge_prev.clear()

    def load_graph(self, graph: Dict[str, Any]) -> None:
        with self._lock:
            self._logic_nodes = {
                n["id"]: n for n in (graph.get("logic_nodes") or []) if n.get("id")
            }
            self._connections = list(graph.get("connections") or [])
            self._sources.clear()
            self._last_outputs.clear()
            self._pid_state.clear()
            self._timers.clear()
            self._counters.clear()
            self._edge_prev.clear()
            self._active = True

    @property
    def active(self) -> bool:
        return self._active

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "active": self._active,
                "logic_block_count": len(self._logic_nodes),
                "connection_count": len(self._connections),
            }

    def on_signal(self, address: str, channel: int, signal_type: int, value: int) -> List[Dict[str, Any]]:
        """Update source cache and return device output actions to execute."""
        if not self._active:
            return []

        source_key = self._find_source_key(address, channel, signal_type)
        if not source_key:
            return []

        with self._lock:
            self._sources[source_key] = (float(value), int(signal_type))
            actions: List[Dict[str, Any]] = []
            sinks = self._device_sink_ports()
            for sink_id in sinks:
                result = self._eval_port(sink_id)
                if result is None:
                    continue
                out_val, out_kind = result
                prev = self._last_outputs.get(sink_id)
                new_state = (int(round(out_val)), out_kind)
                if prev == new_state:
                    continue
                self._last_outputs[sink_id] = new_state
                action = self._sink_to_action(sink_id, new_state[0], new_state[1])
                if action:
                    actions.append(action)
            return actions

    def _find_source_key(self, address: str, channel: int, signal_type: int) -> Optional[str]:
        suffix = "adc" if signal_type == SIGNAL_ADC else "din"
        if signal_type not in (SIGNAL_GPIO, SIGNAL_ADC):
            suffix = "din"
        candidates = [
            f"{address}:{suffix}{channel}",
            f"{address}:din{channel}",
            f"{address}:adc{channel}",
        ]
        for c in candidates:
            if self._port_exists(c):
                return c
        return candidates[0]

    def _port_exists(self, port_id: str) -> bool:
        if port_id in self._sources:
            return True
        for conn in self._connections:
            if conn.get("from") == port_id or conn.get("to") == port_id:
                return True
        return port_id.rsplit(":", 1)[0] in self._logic_nodes or ":" in port_id

    def _device_sink_ports(self) -> List[str]:
        sinks: Set[str] = set()
        for conn in self._connections:
            to_id = conn.get("to") or ""
            if self._is_device_sink(to_id):
                sinks.add(to_id)
        return sorted(sinks)

    def _is_device_sink(self, port_id: str) -> bool:
        if not port_id or port_id.startswith("logic-"):
            return False
        _, pin_part = self._split_port(port_id)
        return pin_part.startswith(("dout", "pwm", "dac", "servo"))

    def _split_port(self, port_id: str) -> Tuple[str, str]:
        idx = port_id.rfind(":")
        if idx < 0:
            return port_id, ""
        return port_id[:idx], port_id[idx + 1:]

    def _eval_port(self, port_id: str, _stack: Optional[Set[str]] = None) -> Optional[Tuple[float, int]]:
        stack = _stack or set()
        if port_id in stack:
            return None
        stack.add(port_id)

        node_id, pin_part = self._split_port(port_id)

        if node_id in self._logic_nodes:
            block = self._logic_nodes[node_id]
            return self._eval_logic_block(node_id, block, pin_part, stack)

        if port_id in self._sources:
            val, sig_t = self._sources[port_id]
            kind = SIGNAL_DIGITAL if sig_t == SIGNAL_GPIO else SIGNAL_ANALOG
            return val, kind

        upstream = self._upstream(port_id)
        if not upstream:
            return None
        return self._eval_port(upstream, stack)

    def _upstream(self, port_id: str) -> Optional[str]:
        for conn in self._connections:
            if conn.get("to") == port_id:
                return conn.get("from")
        return None

    def _block_inputs(self, block_id: str) -> Dict[str, Tuple[float, int]]:
        inputs: Dict[str, Tuple[float, int]] = {}
        for conn in self._connections:
            if not conn.get("to", "").startswith(block_id + ":"):
                continue
            in_name = conn["to"].split(":", 1)[1]
            val = self._eval_port(conn["from"], set())
            if val is not None:
                inputs[in_name] = val
        return inputs

    def _eval_logic_block(
        self, block_id: str, block: Dict[str, Any], out_pin: str, stack: Set[str]
    ) -> Optional[Tuple[float, int]]:
        if out_pin != "out":
            return None
        btype = block.get("blockType") or block.get("type") or "passthrough"
        params = block.get("params") or {}
        inputs = self._block_inputs(block_id)

        if btype == "invert":
            v = _as_digital(inputs.get("in0", (0, SIGNAL_DIGITAL))[0])
            return float(1 - v), SIGNAL_DIGITAL

        if btype == "and":
            vals = [_as_digital(inputs[k][0]) for k in sorted(inputs) if k.startswith("in")]
            if len(vals) < 2:
                return None
            return float(1 if all(vals) else 0), SIGNAL_DIGITAL

        if btype == "or":
            vals = [_as_digital(inputs[k][0]) for k in sorted(inputs) if k.startswith("in")]
            if len(vals) < 2:
                return None
            return float(1 if any(vals) else 0), SIGNAL_DIGITAL

        if btype == "xor":
            vals = [_as_digital(inputs[k][0]) for k in sorted(inputs) if k.startswith("in")]
            if len(vals) < 2:
                return None
            return float(sum(vals) % 2), SIGNAL_DIGITAL

        if btype == "nand":
            vals = [_as_digital(inputs[k][0]) for k in sorted(inputs) if k.startswith("in")]
            if len(vals) < 2:
                return None
            return float(0 if all(vals) else 1), SIGNAL_DIGITAL

        if btype == "nor":
            vals = [_as_digital(inputs[k][0]) for k in sorted(inputs) if k.startswith("in")]
            if len(vals) < 2:
                return None
            return float(0 if any(vals) else 1), SIGNAL_DIGITAL

        if btype == "threshold":
            raw = inputs.get("in0")
            if raw is None:
                return None
            val = _as_analog(raw[0])
            threshold = float(params.get("threshold", 2048))
            mode = str(params.get("mode", "gt")).lower()
            if mode == "lt":
                hit = val < threshold
            else:
                hit = val >= threshold
            return float(1 if hit else 0), SIGNAL_DIGITAL

        if btype == "hysteresis":
            raw = inputs.get("in0")
            if raw is None:
                return None
            val = _as_analog(raw[0])
            low = float(params.get("low", 1800))
            high = float(params.get("high", 2200))
            state_key = block_id + ":hyst"
            prev = self._pid_state.get(state_key, {}).get("out", 0.0)
            if val >= high:
                out = 1.0
            elif val <= low:
                out = 0.0
            else:
                out = prev
            self._pid_state.setdefault(state_key, {})["out"] = out
            return out, SIGNAL_DIGITAL

        if btype == "scale":
            raw = inputs.get("in0")
            if raw is None:
                return None
            val = _as_analog(raw[0])
            in_min = float(params.get("inMin", 0))
            in_max = float(params.get("inMax", 4095))
            out_min = float(params.get("outMin", 0))
            out_max = float(params.get("outMax", 255))
            if in_max <= in_min:
                return out_min, SIGNAL_ANALOG
            norm = max(0.0, min(1.0, (val - in_min) / (in_max - in_min)))
            return out_min + norm * (out_max - out_min), SIGNAL_ANALOG

        if btype == "pid":
            raw = inputs.get("in0")
            if raw is None:
                return None
            pv = _as_analog(raw[0])
            sp = float(params.get("setpoint", 2048))
            kp = float(params.get("kp", 0.05))
            ki = float(params.get("ki", 0.001))
            kd = float(params.get("kd", 0.01))
            out_min = float(params.get("outMin", 0))
            out_max = float(params.get("outMax", 255))
            now = time.time()
            st = self._pid_state.setdefault(block_id, {"integral": 0.0, "last_pv": pv, "last_t": now})
            dt = max(0.001, now - st.get("last_t", now))
            err = sp - pv
            st["integral"] = max(-10000, min(10000, st.get("integral", 0) + err * dt))
            deriv = (pv - st.get("last_pv", pv)) / dt
            out = kp * err + ki * st["integral"] - kd * deriv
            out = max(out_min, min(out_max, out))
            st["last_pv"] = pv
            st["last_t"] = now
            return out, SIGNAL_ANALOG

        if btype == "debounce":
            raw = inputs.get("in0")
            if raw is None:
                return None
            value = float(_as_digital(raw[0]))
            now = time.time()
            state = self._timers.setdefault(block_id, {"candidate": value, "since": now, "out": value})
            if value != state["candidate"]:
                state["candidate"] = value
                state["since"] = now
            if (now - state["since"]) * 1000 >= float(params.get("ms", 50)):
                state["out"] = value
            return state["out"], SIGNAL_DIGITAL

        if btype == "edge":
            raw = inputs.get("in0")
            if raw is None:
                return None
            value = float(_as_digital(raw[0]))
            previous = self._edge_prev.get(block_id, value)
            self._edge_prev[block_id] = value
            mode = str(params.get("mode", "rise"))
            rising = previous == 0 and value == 1
            falling = previous == 1 and value == 0
            hit = (mode in ("rise", "both") and rising) or (mode in ("fall", "both") and falling)
            return float(1 if hit else 0), SIGNAL_DIGITAL

        if btype == "delay":
            raw = inputs.get("in0")
            if raw is None:
                return None
            value = float(_as_digital(raw[0]))
            now = time.time()
            state = self._timers.setdefault(block_id, {"value": value, "since": now, "out": 0})
            if value != state["value"]:
                state["value"] = value
                state["since"] = now
            if (now - state["since"]) * 1000 >= float(params.get("ms", 200)):
                state["out"] = value
            return float(state["out"]), SIGNAL_DIGITAL

        if btype == "latch":
            set_value = _as_digital(inputs.get("set", (0, SIGNAL_DIGITAL))[0])
            reset_value = _as_digital(inputs.get("reset", (0, SIGNAL_DIGITAL))[0])
            state = self._timers.setdefault(block_id, {"out": 0})
            if str(params.get("resetDominant", "1")) == "1":
                if reset_value:
                    state["out"] = 0
                elif set_value:
                    state["out"] = 1
            elif set_value:
                state["out"] = 1
            elif reset_value:
                state["out"] = 0
            return float(state["out"]), SIGNAL_DIGITAL

        if btype == "counter":
            raw = inputs.get("in0")
            if raw is None:
                return None
            value = float(_as_digital(raw[0]))
            state = self._counters.setdefault(block_id, {"previous": value, "count": 0})
            if value == 1 and state["previous"] == 0:
                state["count"] += 1
            state["previous"] = value
            reset_at = float(params.get("resetAt", 0))
            if reset_at > 0 and state["count"] >= reset_at:
                state["count"] = 0
            return state["count"], SIGNAL_ANALOG

        if btype == "script":
            return self._eval_script_block(block_id, inputs, params)

        if btype == "passthrough":
            raw = inputs.get("in0")
            if raw is None:
                return None
            return raw[0], raw[1]

        return None

    def _eval_script_block(
        self, block_id: str, inputs: Dict[str, Tuple[float, int]], params: Dict[str, Any]
    ) -> Optional[Tuple[float, int]]:
        code = str(params.get("code") or "").strip()
        if not code:
            return None
        env: Dict[str, Any] = {"inputs": {}, "in0": 0.0, "in1": 0.0, "result": 0.0, "math": math}
        for k, (v, kind) in inputs.items():
            env["inputs"][k] = v
            if k == "in0":
                env["in0"] = v
            if k == "in1":
                env["in1"] = v
        try:
            tree = ast.parse(code, mode="exec")
            for node in tree.body:
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    raise ValueError("脚本块不允许 import")
            exec(compile(tree, f"<logic-{block_id}>", "exec"), {"__builtins__": {}}, env)
            result = float(env.get("result", 0))
            out_kind = int(params.get("outKind", SIGNAL_DIGITAL))
            return result, out_kind
        except Exception as exc:
            print(f"[logic-engine] script block {block_id} error: {exc}")
            return None

    def _sink_to_action(self, sink_id: str, value: int, kind: int) -> Optional[Dict[str, Any]]:
        addr, pin_part = self._split_port(sink_id)
        pin_num = 0
        action = ACTION_GPIO_SET
        param1 = value if kind == SIGNAL_DIGITAL else value
        param2 = 0

        if pin_part.startswith("dout"):
            pin_num = int("".join(c for c in pin_part[4:] if c.isdigit()) or pin_part.replace("dout", "") or "0")
            action = ACTION_GPIO_SET
            param1 = 1 if value > 0 else 0
        elif pin_part.startswith("pwm"):
            pin_num = int("".join(c for c in pin_part[3:] if c.isdigit()) or "0")
            action = ACTION_PWM
            param1 = max(0, min(255, int(value)))
        elif pin_part.startswith("dac"):
            pin_num = int("".join(c for c in pin_part[3:] if c.isdigit()) or "0")
            action = ACTION_DAC
            param1 = max(0, min(255, int(value)))
        elif pin_part.startswith("servo"):
            pin_num = int("".join(c for c in pin_part[5:] if c.isdigit()) or "0")
            action = ACTION_SERVO
            param1 = max(0, min(180, int(value)))
        else:
            return None

        return {
            "to_addr": addr,
            "to_pin": pin_num,
            "to_action": action,
            "to_param1": param1,
            "to_param2": param2,
        }


logic_rule_engine = LogicRuleEngine()

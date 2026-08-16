"""
PC 端控制路由引擎。

当头环和被控板都连接到 PC 时，由本模块负责：
1. 监听头环信号（EOG/EMG/Focus）
2. 根据配置的映射规则判定是否触发
3. 向被控板发送对应动作指令

这是 PC 模式下的"桥梁"——替代独立模式中 MCU 本地运行的规则引擎。
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional

from app.services.ctrl_ble_bridge import (
    ctrl_ble_bridge,
    build_command_packet,
    ACTION_GPIO_SET, ACTION_GPIO_TOGGLE, ACTION_DAC,
    ACTION_PWM, ACTION_PWM_TIMED, ACTION_SERVO,
    SIGNAL_GPIO, SIGNAL_ADC, SIGNAL_EOG, SIGNAL_EMG, SIGNAL_FOCUS,
    TRIGGER_EDGE, TRIGGER_THRESH, TRIGGER_LINEAR,
)


class ControlRouter:
    """PC 端规则引擎：监听信号源，根据规则触发被控板动作。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rules: List[Dict[str, Any]] = []
        self._enabled = False
        self._last_trigger_times: Dict[int, float] = {}
        self._refractory_sec = 0.3
        self._listeners: List[Callable[[Dict[str, Any]], None]] = []

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def rule_count(self) -> int:
        with self._lock:
            return len(self._rules)

    def set_rules(self, rules: List[Dict[str, Any]]) -> None:
        with self._lock:
            self._rules = list(rules)
            self._last_trigger_times.clear()

    def clear_rules(self) -> None:
        with self._lock:
            self._rules.clear()
            self._last_trigger_times.clear()

    def start(self) -> None:
        self._enabled = True

    def stop(self) -> None:
        self._enabled = False

    def add_event_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        self._listeners.append(cb)

    def remove_event_listener(self, cb: Callable[[Dict[str, Any]], None]) -> None:
        try:
            self._listeners.remove(cb)
        except ValueError:
            pass

    def _emit_event(self, event: Dict[str, Any]) -> None:
        for cb in self._listeners:
            try:
                cb(event)
            except Exception:
                pass

    def on_eog_trigger(self) -> None:
        """由平台 EOG 检测器调用：发生一次眨眼事件。"""
        if not self._enabled:
            return
        self._process_signal(SIGNAL_EOG, 0, 1)

    def on_emg_trigger(self, strength: float = 1.0) -> None:
        """由平台 EMG 检测器调用：发生一次肌电触发。"""
        if not self._enabled:
            return
        value = int(min(4095, max(0, strength * 4095)))
        self._process_signal(SIGNAL_EMG, 0, value)

    def on_focus_update(self, focus_value: float) -> None:
        """由平台专注度监测器调用：更新专注度值 (0-100)。"""
        if not self._enabled:
            return
        value = int(min(100, max(0, focus_value)))
        self._process_signal(SIGNAL_FOCUS, 0, value)

    def on_gpio_input(self, channel: int, value: int) -> None:
        """由控制板信号监听调用：GPIO 输入变化。"""
        if not self._enabled:
            return
        self._process_signal(SIGNAL_GPIO, channel, value)

    def on_adc_input(self, channel: int, value: int) -> None:
        """由控制板信号监听调用：ADC 输入变化。"""
        if not self._enabled:
            return
        self._process_signal(SIGNAL_ADC, channel, value)

    def _process_signal(self, signal_type: int, channel: int, value: int) -> None:
        now = time.time()
        with self._lock:
            rules = list(self._rules)

        for i, rule in enumerate(rules):
            if rule.get("signal_type") != signal_type:
                continue
            if rule.get("source_channel", 0) != channel:
                if signal_type in (SIGNAL_GPIO, SIGNAL_ADC):
                    continue

            should_fire = False
            output_value = value
            trigger_mode = rule.get("trigger_mode", TRIGGER_EDGE)

            if trigger_mode == TRIGGER_EDGE:
                should_fire = True
            elif trigger_mode == TRIGGER_THRESH:
                low = rule.get("threshold_low", 0)
                high = rule.get("threshold_high", 4095)
                should_fire = (low <= value <= high)
            elif trigger_mode == TRIGGER_LINEAR:
                low = rule.get("threshold_low", 0)
                high = rule.get("threshold_high", 4095)
                in_range = high - low
                if in_range > 0:
                    norm = max(0.0, min(1.0, (value - low) / in_range))
                    output_value = int(norm * rule.get("action_param1", 255))
                should_fire = True

            if not should_fire:
                continue

            last_t = self._last_trigger_times.get(i, 0)
            if now - last_t < self._refractory_sec:
                continue
            self._last_trigger_times[i] = now

            self._execute_rule(rule, output_value)

    def _execute_rule(self, rule: Dict[str, Any], value: int) -> None:
        action_type = rule.get("action_type", ACTION_GPIO_SET)
        pin = rule.get("target_pin", 2)
        param1 = rule.get("action_param1", 1)
        param2 = rule.get("action_param2", 0)

        trigger_mode = rule.get("trigger_mode", TRIGGER_EDGE)
        if trigger_mode == TRIGGER_LINEAR:
            param1 = value

        ok = ctrl_ble_bridge.send_action(action_type, pin, param1, param2)

        event = {
            "type": "rule_fired",
            "ts": time.time(),
            "rule": rule,
            "value": value,
            "action_sent": ok,
            "action_type": action_type,
            "pin": pin,
            "param1": param1,
            "param2": param2,
        }
        self._emit_event(event)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "enabled": self._enabled,
                "rule_count": len(self._rules),
                "rules": list(self._rules),
            }


control_router = ControlRouter()

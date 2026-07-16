"""
本机鼠标模拟（pynput）。与 keyboard_bridge 相同环境；仅供 localhost 可信场景。
双击后恢复光标原位置；全局节流避免过于密集导致系统卡顿（过密时自动等待间隔，不再报错拒绝）。
"""
from __future__ import annotations

import threading
import time
from typing import Optional, Tuple

try:
    from pynput.mouse import Button, Controller

    _PYNPUT_OK = True
    _IMPORT_ERROR: Optional[str] = None
except ImportError as e:
    Button = None  # type: ignore
    Controller = None  # type: ignore
    _PYNPUT_OK = False
    _IMPORT_ERROR = str(e)

_controller: Optional["Controller"] = None
_lock = threading.Lock()
_last_double_click_end: float = 0.0
_last_click_end: float = 0.0
_last_move_end: float = 0.0

# 两次完整「双击+回位」之间的最短间隔（秒），防止连续触发占死鼠标
MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC = 1.25
MIN_INTERVAL_BETWEEN_CLICKS_SEC = 0.35
# 相对移动：允许较密，但仍做极短节流，避免 GUI 线程被刷爆
MIN_INTERVAL_BETWEEN_MOVES_SEC = 0.004


def availability() -> Tuple[bool, str]:
    if not _PYNPUT_OK:
        return False, f"未安装或未加载 pynput: {_IMPORT_ERROR or 'unknown'}（请在后端环境执行 pip install pynput）"
    return True, "就绪"


def _controller_get() -> "Controller":
    global _controller
    if _controller is None:
        assert Controller is not None
        _controller = Controller()
    return _controller


def double_click_at(screen_x: int, screen_y: int) -> None:
    """在屏幕坐标处左键双击，结束后将鼠标移回原位置。带全局节流。"""
    if not _PYNPUT_OK or Button is None:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    x = max(0, int(round(screen_x)))
    y = max(0, int(round(screen_y)))

    global _last_double_click_end
    with _lock:
        now = time.time()
        gap = now - _last_double_click_end
        if gap < MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC:
            time.sleep(MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC - gap)

        mouse = _controller_get()
        prev = mouse.position
        try:
            mouse.position = (x, y)
            time.sleep(0.05)
            mouse.click(Button.left, 2)
            time.sleep(0.04)
        finally:
            try:
                mouse.position = prev
            except Exception:
                pass
            _last_double_click_end = time.time()


def click_at(screen_x: int, screen_y: int) -> None:
    """在屏幕坐标处左键单击，结束后将鼠标移回原位置。带全局节流。"""
    if not _PYNPUT_OK or Button is None:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    x = max(0, int(round(screen_x)))
    y = max(0, int(round(screen_y)))

    global _last_click_end
    with _lock:
        now = time.time()
        gap = now - _last_click_end
        if gap < MIN_INTERVAL_BETWEEN_CLICKS_SEC:
            time.sleep(MIN_INTERVAL_BETWEEN_CLICKS_SEC - gap)

        mouse = _controller_get()
        prev = mouse.position
        try:
            mouse.position = (x, y)
            time.sleep(0.03)
            mouse.click(Button.left, 1)
            time.sleep(0.02)
        finally:
            try:
                mouse.position = prev
            except Exception:
                pass
            _last_click_end = time.time()


def move_relative(dx: int, dy: int) -> None:
    """相对移动系统光标（像素）。用于 IMU → 光标测试。"""
    if not _PYNPUT_OK:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    mx = int(dx)
    my = int(dy)
    if mx == 0 and my == 0:
        return

    global _last_move_end
    with _lock:
        now = time.time()
        gap = now - _last_move_end
        if gap < MIN_INTERVAL_BETWEEN_MOVES_SEC:
            time.sleep(MIN_INTERVAL_BETWEEN_MOVES_SEC - gap)

        mouse = _controller_get()
        x, y = mouse.position
        mouse.position = (x + mx, y + my)
        _last_move_end = time.time()


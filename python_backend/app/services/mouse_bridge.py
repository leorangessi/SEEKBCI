"""
本机鼠标模拟（pynput）。与 keyboard_bridge 相同环境；仅供 localhost 可信场景。
双击后恢复光标原位置；全局节流避免过于密集导致系统卡顿（过密时自动等待间隔，不再报错拒绝）。
"""
from __future__ import annotations

import ctypes
import os
import sys
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
_left_button_held: bool = False

# 两次完整「双击+回位」之间的最短间隔（秒），防止连续触发占死鼠标
MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC = 1.25
MIN_INTERVAL_BETWEEN_CLICKS_SEC = 0.35
# 相对移动：允许较密，但仍做极短节流，避免 GUI 线程被刷爆
MIN_INTERVAL_BETWEEN_MOVES_SEC = 0.004


def _is_admin() -> bool:
    """Check if running with administrator privileges on Windows."""
    if sys.platform != 'win32':
        return os.geteuid() == 0  # type: ignore[attr-defined]
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())  # type: ignore[attr-defined]
    except Exception:
        return False


def availability() -> Tuple[bool, str]:
    if not _PYNPUT_OK:
        return False, f"未安装或未加载 pynput: {_IMPORT_ERROR or 'unknown'}（请在后端环境执行 pip install pynput）"
    if not _is_admin():
        return True, "就绪（非管理员模式：对以管理员运行的游戏/程序可能无法注入鼠标事件，建议以管理员身份启动）"
    return True, "就绪（管理员权限）"


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


def click_current(clicks: int = 1) -> None:
    """在当前光标位置左键单击/双击（不移动、不回位）。用于 IMU 光标点击。"""
    click_current_button("left", clicks)


def click_current_button(button: str = "left", clicks: int = 1) -> None:
    """在当前光标位置点击左键或右键。"""
    if not _PYNPUT_OK or Button is None:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    btn = Button.right if str(button).lower() in ("right", "r", "2") else Button.left
    n = 2 if int(clicks) >= 2 else 1
    global _last_click_end, _last_double_click_end
    with _lock:
        now = time.time()
        if n >= 2:
            gap = now - _last_double_click_end
            if gap < MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC:
                time.sleep(MIN_INTERVAL_BETWEEN_DOUBLE_CLICKS_SEC - gap)
        else:
            gap = now - _last_click_end
            if gap < MIN_INTERVAL_BETWEEN_CLICKS_SEC:
                time.sleep(MIN_INTERVAL_BETWEEN_CLICKS_SEC - gap)

        mouse = _controller_get()
        mouse.click(btn, n)
        if n >= 2:
            _last_double_click_end = time.time()
        else:
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


def _primary_screen_size() -> Tuple[int, int]:
    """主屏宽高（CSS/逻辑像素近似）。Windows 用 GetSystemMetrics；其它平台回退。"""
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        w = int(user32.GetSystemMetrics(0))
        h = int(user32.GetSystemMetrics(1))
        if w > 0 and h > 0:
            return w, h
    except Exception:
        pass
    return 1920, 1080


def move_to_screen_center() -> Tuple[int, int]:
    """将光标移到主屏正中央。返回目标坐标。"""
    if not _PYNPUT_OK:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    w, h = _primary_screen_size()
    x = max(0, w // 2)
    y = max(0, h // 2)
    with _lock:
        mouse = _controller_get()
        mouse.position = (x, y)
    return x, y


def sync_left_button_held(pressed: bool) -> bool:
    """
    同步左键按住状态（差分 press/release）。
    用于肌电等多模态：能量超阈保持按下，低于阈值松开。
    """
    if not _PYNPUT_OK or Button is None:
        raise RuntimeError(f"pynput 不可用: {_IMPORT_ERROR}")

    global _left_button_held
    want = bool(pressed)
    with _lock:
        if want == _left_button_held:
            return _left_button_held
        mouse = _controller_get()
        if want:
            mouse.press(Button.left)
            _left_button_held = True
        else:
            try:
                mouse.release(Button.left)
            finally:
                _left_button_held = False
        return _left_button_held


def release_left_button() -> None:
    """松开由 sync_left_button_held 按下的左键（刺激停止时调用）。"""
    if not _PYNPUT_OK or Button is None:
        return
    global _left_button_held
    with _lock:
        if not _left_button_held:
            return
        try:
            _controller_get().release(Button.left)
        except Exception:
            pass
        _left_button_held = False


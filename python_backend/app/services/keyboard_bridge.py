"""
本机键盘模拟（通过 pynput）。仅供 localhost 可信环境使用。
将前端 keyboard-binding 的 chord 结构转为按键序列。
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from pynput.keyboard import Controller, Key

    _PYNPUT_OK = True
    _IMPORT_ERROR: Optional[str] = None
except ImportError as e:
    Controller = None  # type: ignore
    Key = None  # type: ignore
    _PYNPUT_OK = False
    _IMPORT_ERROR = str(e)

_controller: Optional["Controller"] = None


def availability() -> Tuple[bool, str]:
    if not _PYNPUT_OK:
        return False, f"未安装或未加载 pynput: {_IMPORT_ERROR or 'unknown'}（请在后端环境执行 pip install pynput）"
    return True, "就绪"


def _get_controller() -> "Controller":
    global _controller
    if _controller is None:
        _controller = Controller()
    return _controller


def _mod_keys_map():
    assert Key is not None
    return {
        "ctrl": Key.ctrl_l,
        "shift": Key.shift_l,
        "alt": Key.alt_l,
        "meta": Key.cmd,
    }


def _resolve_dom_code(code: str) -> Union[str, Any]:
    """将 KeyboardEvent.code 转为 pynput 可 press 的对象（Key 或单字符 str）。"""
    assert Key is not None
    if not code:
        raise ValueError("空的 code")

    if len(code) == 4 and code.startswith("Key"):
        return code[3].lower()

    if len(code) == 6 and code.startswith("Digit"):
        return code[5]

    if code.startswith("Numpad"):
        tail = code[6:]
        if tail.isdigit():
            return tail
        np = {
            "Decimal": ".",
            "Add": "+",
            "Subtract": "-",
            "Multiply": "*",
            "Divide": "/",
            "Enter": Key.enter,
            "Equal": "=",
        }
        if tail in np:
            v = np[tail]
            return v

    if len(code) >= 2 and code[0] == "F" and code[1:].isdigit():
        n = int(code[1:])
        if 1 <= n <= 24:
            return getattr(Key, f"f{n}")

    special = {
        "Space": Key.space,
        "Enter": Key.enter,
        "Tab": Key.tab,
        "Backspace": Key.backspace,
        "CapsLock": Key.caps_lock,
        "Delete": Key.delete,
        "Escape": Key.esc,
        "ArrowUp": Key.up,
        "ArrowDown": Key.down,
        "ArrowLeft": Key.left,
        "ArrowRight": Key.right,
        "Home": Key.home,
        "End": Key.end,
        "PageUp": Key.page_up,
        "PageDown": Key.page_down,
        "Insert": Key.insert,
        "ContextMenu": Key.menu,
        "Minus": "-",
        "Equal": "=",
        "BracketLeft": "[",
        "BracketRight": "]",
        "Backslash": "\\",
        "Semicolon": ";",
        "Quote": "'",
        "Comma": ",",
        "Period": ".",
        "Slash": "/",
        "IntlBackslash": "\\",
    }
    if code in special:
        return special[code]

    raise ValueError(f"暂不支持的键码: {code}")


def _tap_chord(chord: Dict[str, Any]) -> None:
    mods = chord.get("mods") or []
    code = chord.get("code") or ""
    if isinstance(mods, str):
        mods = [mods]
    main = _resolve_dom_code(code)

    c = _get_controller()
    mod_map = _mod_keys_map()
    held = []
    try:
        for name in ("ctrl", "shift", "alt", "meta"):
            if name in mods:
                k = mod_map[name]
                c.press(k)
                held.append(k)
        c.press(main)
        c.release(main)
    finally:
        for k in reversed(held):
            c.release(k)


def send_chords(chords: List[Dict[str, Any]], pause_between: float = 0.06) -> None:
    """依次执行多段组合键（如 VS Code 双段快捷键）。"""
    ok, msg = availability()
    if not ok:
        raise RuntimeError(msg)

    if not chords:
        raise ValueError("chords 为空")

    for i, ch in enumerate(chords):
        if not isinstance(ch, dict):
            raise ValueError("chord 必须是对象")
        _tap_chord(ch)
        if i < len(chords) - 1:
            time.sleep(pause_between)

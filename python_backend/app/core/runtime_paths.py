"""打包/桌面运行时路径解析。"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[2]


def resolve_frontend_dir() -> Path:
    bundled = bundle_root() / "web_frontend"
    if bundled.is_dir():
        return bundled
    dev = Path(__file__).resolve().parents[2].parent / "web_frontend"
    return dev


def resolve_user_data_root() -> Path:
    env = os.environ.get("SEEKBCi_DATA_DIR")
    if env:
        return Path(env)
    if is_frozen():
        appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
        return Path(appdata) / "SEEKBCI"
    return Path(__file__).resolve().parents[2]


def resolve_app_data_dir() -> Path:
    return resolve_user_data_root() / "data"

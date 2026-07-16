"""
SEEKBCI 桌面版 API 入口（PyInstaller / 开发环境通用）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _bootstrap_paths() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        base = Path(__file__).resolve().parent
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    os.chdir(base)
    return base


def _ensure_data_dir() -> None:
    if os.environ.get("SEEKBCi_DATA_DIR"):
        return
    if getattr(sys, "frozen", False):
        appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
        os.environ["SEEKBCi_DATA_DIR"] = str(Path(appdata) / "SEEKBCI")


def main() -> None:
    _bootstrap_paths()
    _ensure_data_dir()
    from app.core.config import settings

    host = os.environ.get("SEEKBCi_API_HOST", settings.API_HOST)
    port = int(os.environ.get("SEEKBCi_API_PORT", str(settings.API_PORT)))
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        log_level=os.environ.get("SEEKBCi_LOG_LEVEL", "info"),
        access_log=False,
    )


if __name__ == "__main__":
    main()

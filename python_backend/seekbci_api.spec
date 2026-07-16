# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec：SEEKBCI API 桌面子进程（one-folder）。"""
from pathlib import Path

ROOT = Path(SPECPATH)
FRONTEND = ROOT.parent / "web_frontend"

block_cipher = None

datas = [
    (str(FRONTEND), "web_frontend"),
]

hiddenimports = [
    "app.main",
    "app.api.devices",
    "app.api.ssvep",
    "app.api.system",
    "app.api.plaza",
    "app.services.plaza_store",
    "app.services.fbcca_classify",
    "app.services.device_manager",
    "app.services.signal_processor",
    "app.services.python_executor",
    "app.services.keyboard_bridge",
    "app.services.mouse_bridge",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "email_validator",
    "sklearn.utils._cython_blas",
    "sklearn.neighbors._partition_nodes",
    "scipy.special._cdflib",
    "scipy.linalg.cython_blas",
    "scipy.linalg.cython_lapack",
]

a = Analysis(
    ["run_seekbci_api.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["matplotlib", "tkinter", "PyQt5", "psychopy", "mne", "brainflow", "sqlalchemy", "psycopg2"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="seekbci-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="seekbci-api",
)

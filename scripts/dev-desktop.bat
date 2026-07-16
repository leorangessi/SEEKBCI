@echo off
chcp 65001 >nul
title SEEKBCI 桌面版（开发调试）
setlocal

REM 日常调试请用本脚本，不要用 start_seekbci.bat（那个会打开浏览器）
set "ROOT=%~dp0.."
set "ELECTRON=%ROOT%\electron-shell"
set "BACKEND=%ROOT%\python_backend"

set "NPM=d:\nodejs\npm.cmd"
if not exist "%NPM%" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [错误] 未找到 npm。请安装 Node.js 或修改本脚本中的 NPM 路径。
        pause
        exit /b 1
    )
    set "NPM=npm"
)

REM 与 start_seekbci.bat 一致：固定 Python 3.9
set "PY="
if exist "%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python39\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
if not defined PY (
    where py >nul 2>&1 && set "PY=py -3.9"
)
if not defined PY (
    echo [错误] 未找到 Python 3.9。请安装 Python 3.9 并加入 PATH，或安装 py 启动器。
    pause
    exit /b 1
)
set "SEEKBCi_PYTHON=%PY%"

if not exist "%ELECTRON%\node_modules\electron\dist\electron.exe" (
    echo 首次运行，安装 Electron 依赖...
    cd /d "%ELECTRON%"
    call "%NPM%" install
    if errorlevel 1 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
)

cd /d "%BACKEND%"
echo 检查 Python 3.9 后端依赖...
if exist "%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe" -c "import pydantic_settings" 2>nul
    if errorlevel 1 (
        echo 正在安装 requirements-desktop.txt ...
        "%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe" -m pip install -r requirements-desktop.txt
    )
) else if "%PY%"=="py -3.9" (
    py -3.9 -c "import pydantic_settings" 2>nul
    if errorlevel 1 (
        echo 正在安装 requirements-desktop.txt ...
        py -3.9 -m pip install -r requirements-desktop.txt
    )
) else (
    "%PY%" -c "import pydantic_settings" 2>nul
    if errorlevel 1 (
        echo 正在安装 requirements-desktop.txt ...
        "%PY%" -m pip install -r requirements-desktop.txt
    )
)

cd /d "%ELECTRON%"
echo.
echo ========================================
echo   SEEKBCI PLAT 桌面版（Electron）
echo ========================================
echo Python: %SEEKBCi_PYTHON%
echo 命令:   %NPM% start
echo.
echo   - 自动用 Python 3.9 启动 API（不用系统默认 python）
echo   - 关闭 Electron 窗口或 Ctrl+C 结束
echo.

call "%NPM%" start

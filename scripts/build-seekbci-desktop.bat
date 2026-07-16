@echo off
chcp 65001 >nul
title SEEKBCI 桌面版打包
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo ========================================
echo   SEEKBCI PLAT - 完整桌面打包
echo ========================================
echo.
echo [1/3] 构建内置 API (PyInstaller)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\build-seekbci-api.ps1"
if errorlevel 1 (
    echo [错误] API 打包失败
    pause
    exit /b 1
)

echo.
echo [2/3] 安装 Electron 依赖...
cd /d "%ROOT%\electron-shell"
if not exist node_modules (
    call npm install
) else (
    call npm install electron-builder --save-dev
)

echo.
echo [3/3] electron-builder 打包...
call npm run dist
if errorlevel 1 (
    echo [错误] Electron 打包失败
    pause
    exit /b 1
)

echo.
echo 完成。安装包见: electron-shell\dist\
explorer "%ROOT%\electron-shell\dist"
pause

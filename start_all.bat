@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 一键启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 启动后端服务...
start "SSVEP Backend" cmd /k "cd python_backend && start_backend_simple.bat"

echo 等待后端启动...
timeout /t 3 /nobreak >nul

echo.
echo [2/2] 启动前端页面...

REM 启动主页
start "" "web_frontend\index.html"

REM 等待1秒
timeout /t 1 /nobreak >nul

REM 启动设备管理页面
start "" "web_frontend\device-manager.html"

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 已打开的页面:
echo   1. 主页 (index.html)
echo   2. 设备管理 (device-manager.html)
echo.
echo 后端服务:
echo   📡 API地址: http://localhost:8000
echo   📚 API文档: http://localhost:8000/docs
echo.
echo 提示:
echo   - 后端服务在单独的窗口运行
echo   - 关闭后端窗口即可停止服务
echo   - 前端页面已在浏览器中打开
echo.
echo ========================================

pause

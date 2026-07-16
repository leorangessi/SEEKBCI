@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 完整启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 启动后端服务...
start "SSVEP Backend" cmd /k "cd python_backend && echo 后端服务启动中... && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo 等待后端启动...
timeout /t 5 /nobreak >nul

echo.
echo [2/3] 测试后端连接...
curl http://localhost:8000/health >nul 2>&1
if errorlevel 1 (
    echo ⚠️  后端可能还在启动中，请稍等...
) else (
    echo ✅ 后端服务正常
)

echo.
echo [3/3] 打开前端页面...

REM 打开主页
start "" "web_frontend\index.html"
timeout /t 1 /nobreak >nul

REM 打开设备管理页面
start "" "web_frontend\device-manager.html"

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 📡 后端服务: http://localhost:8000
echo 📚 API文档: http://localhost:8000/docs
echo.
echo 🌐 前端页面已在浏览器中打开:
echo    - 主页 (index.html)
echo    - 设备管理 (device-manager.html)
echo.
echo 💡 提示:
echo    - 后端运行在单独的窗口中
echo    - 关闭后端窗口即可停止服务
echo    - 前端页面可随时刷新
echo.
echo ========================================

pause

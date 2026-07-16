@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 完整启动
echo   (后端 + 前端服务器)
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 启动后端服务 (端口 8000)...
start "SSVEP Backend" cmd /k "cd python_backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo 等待后端启动...
timeout /t 3 /nobreak >nul

echo.
echo [2/3] 启动前端服务器 (端口 8080)...
start "SSVEP Frontend" cmd /k "cd python_backend && python serve_frontend.py"

echo 等待前端服务器启动...
timeout /t 2 /nobreak >nul

echo.
echo [3/3] 打开浏览器...
start http://localhost:8080/device-manager.html

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 📡 后端 API: http://localhost:8000
echo 📚 API 文档: http://localhost:8000/docs
echo.
echo 🌐 前端服务: http://localhost:8080
echo 🏠 主页: http://localhost:8080/index.html
echo 🔌 设备管理: http://localhost:8080/device-manager.html
echo 🧪 SSVEP测试: http://localhost:8080/ssvep-test.html
echo.
echo 💡 提示:
echo    - 后端和前端运行在两个独立窗口
echo    - 关闭窗口即可停止对应服务
echo    - 现在可以正常使用设备连接功能了！
echo.
echo ========================================

pause

@echo off
echo ========================================
echo SSVEP Platform - 启动完整应用
echo ========================================
echo.

echo [1/2] 启动后端服务器...
cd python_backend
start "SSVEP Backend" cmd /k "conda activate ssvep_platform && set PYTHONPATH=%cd% && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo.
echo [2/2] 等待服务器启动...
timeout /t 3 /nobreak >nul

echo.
echo [3/3] 打开前端页面...
start "" "%cd%\..\web_frontend\index.html"

echo.
echo ========================================
echo 应用已启动！
echo ========================================
echo.
echo 后端服务器: http://localhost:8000
echo API文档: http://localhost:8000/docs
echo 前端页面: 已在浏览器中打开
echo.
echo 按任意键关闭此窗口...
pause >nul

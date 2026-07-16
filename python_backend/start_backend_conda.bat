@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 启动后端服务
echo   (使用Conda环境)
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 激活Conda环境...
call conda activate ssvep_platform
if errorlevel 1 (
    echo ❌ 错误: 无法激活环境 ssvep_platform
    echo.
    echo 请先运行 setup_conda_env.bat 创建环境
    pause
    exit /b 1
)

echo ✅ 环境已激活
echo.

echo [2/2] 启动服务...
echo.
echo ✅ 后端服务启动中...
echo 📡 API地址: http://localhost:8000
echo 📚 API文档: http://localhost:8000/docs
echo 📊 健康检查: http://localhost:8000/health
echo.
echo 按 Ctrl+C 停止服务
echo.

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

pause

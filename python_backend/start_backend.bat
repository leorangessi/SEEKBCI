@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 启动后端服务
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到Python
    echo 请先安装Python 3.8+
    pause
    exit /b 1
)

echo [2/3] 检查依赖...
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo ⚠️  警告: 依赖未安装
    echo 正在安装依赖...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
)

echo [3/3] 启动服务...
echo.
echo ✅ 后端服务启动中...
echo 📡 API地址: http://localhost:8000
echo 📚 API文档: http://localhost:8000/docs
echo.
echo 按 Ctrl+C 停止服务
echo.

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

pause

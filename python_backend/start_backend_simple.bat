@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 启动后端服务
echo   (使用系统Python 3.9)
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查Python环境...
python --version
if errorlevel 1 (
    echo ❌ 错误: 未找到Python
    pause
    exit /b 1
)

echo.
echo [2/3] 检查/安装依赖...
echo 正在检查必要的依赖包...

REM 检查FastAPI
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo 安装 FastAPI...
    pip install fastapi uvicorn[standard] python-multipart -i https://pypi.tuna.tsinghua.edu.cn/simple
)

REM 检查numpy
python -c "import numpy" >nul 2>&1
if errorlevel 1 (
    echo 安装 NumPy...
    pip install numpy -i https://pypi.tuna.tsinghua.edu.cn/simple
)

REM 检查pylsl
python -c "import pylsl" >nul 2>&1
if errorlevel 1 (
    echo 安装 PyLSL...
    pip install pylsl -i https://pypi.tuna.tsinghua.edu.cn/simple
)

REM 检查pyserial
python -c "import serial" >nul 2>&1
if errorlevel 1 (
    echo 安装 PySerial...
    pip install pyserial -i https://pypi.tuna.tsinghua.edu.cn/simple
)

REM 检查websockets
python -c "import websockets" >nul 2>&1
if errorlevel 1 (
    echo 安装 WebSockets...
    pip install websockets -i https://pypi.tuna.tsinghua.edu.cn/simple
)

REM 检查pydantic
python -c "import pydantic" >nul 2>&1
if errorlevel 1 (
    echo 安装 Pydantic...
    pip install pydantic pydantic-settings -i https://pypi.tuna.tsinghua.edu.cn/simple
)

echo ✅ 依赖检查完成
echo.

echo [3/3] 启动服务...
echo.
echo ========================================
echo   后端服务信息
echo ========================================
echo 📡 API地址: http://localhost:8000
echo 📚 API文档: http://localhost:8000/docs
echo 📊 健康检查: http://localhost:8000/health
echo.
echo 按 Ctrl+C 停止服务
echo ========================================
echo.

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

pause

@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 创建Conda环境
echo ========================================
echo.

cd /d "%~dp0"

echo [1/4] 检查Conda...
call conda --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到Conda
    echo 请先安装Anaconda或Miniconda
    pause
    exit /b 1
)

echo ✅ Conda已安装
echo.

echo [2/4] 创建Python环境...
echo 环境名称: ssvep_platform
echo Python版本: 3.10
echo.

call conda create -n ssvep_platform python=3.10 -y
if errorlevel 1 (
    echo ❌ 创建环境失败
    pause
    exit /b 1
)

echo ✅ 环境创建成功
echo.

echo [3/4] 激活环境并安装依赖...
call conda activate ssvep_platform
if errorlevel 1 (
    echo ❌ 激活环境失败
    pause
    exit /b 1
)

echo 正在安装依赖包...
pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo ✅ 依赖安装成功
echo.

echo [4/4] 环境配置完成！
echo.
echo ========================================
echo   环境信息
echo ========================================
echo 环境名称: ssvep_platform
echo Python版本: 3.10
echo.
echo 使用方法:
echo   1. 激活环境: conda activate ssvep_platform
echo   2. 启动服务: python -m uvicorn app.main:app --reload
echo   或直接运行: start_backend_conda.bat
echo.
echo ========================================

pause

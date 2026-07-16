@echo off
chcp 65001 >nul
echo ========================================
echo   SSVEP Platform - 一键启动
echo   (使用Conda环境)
echo ========================================
echo.

REM 检查Conda环境
echo [1/6] 检查Conda环境...
call conda env list | findstr ssvep_platform >nul 2>&1
if %errorlevel% neq 0 (
    echo [✗] Conda环境 ssvep_platform 不存在
    echo.
    echo 请先创建环境:
    echo   cd python_backend
    echo   setup_conda_env.bat
    echo.
    pause
    exit /b 1
)
echo [✓] Conda环境已存在

REM 检查是否已经运行
echo.
echo [2/6] 检查现有服务...
netstat -ano | findstr :8000 >nul
if %errorlevel% equ 0 (
    echo [警告] 后端服务已在运行 (端口 8000)
) else (
    echo [启动] 后端服务 (使用Conda环境)...
    start "SSVEP Backend" cmd /k "cd /d %~dp0python_backend && call conda activate ssvep_platform && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
    timeout /t 3 /nobreak >nul
)

netstat -ano | findstr :8080 >nul
if %errorlevel% equ 0 (
    echo [警告] 前端服务已在运行 (端口 8080)
) else (
    echo [启动] 前端服务...
    start "SSVEP Frontend" cmd /k "cd /d %~dp0 && C:\ProgramData\Anaconda3\python.exe python_backend\serve_frontend.py"
    timeout /t 2 /nobreak >nul
)

echo.
echo [3/6] 等待服务启动...
timeout /t 5 /nobreak >nul

echo.
echo [4/6] 测试服务连接...
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [✓] 后端服务正常 (http://localhost:8000)
) else (
    echo [✗] 后端服务启动失败
    echo.
    echo 可能的原因:
    echo   1. Conda环境依赖未安装完整
    echo   2. 端口被占用
    echo   3. 配置文件错误
    echo.
    echo 请查看后端命令行窗口的错误信息
)

curl -s http://localhost:8080 >nul 2>&1
if %errorlevel% equ 0 (
    echo [✓] 前端服务正常 (http://localhost:8080)
) else (
    echo [✗] 前端服务启动失败
    echo.
    echo 请查看前端命令行窗口的错误信息
)

echo.
echo [5/6] 打开浏览器...
timeout /t 2 /nobreak >nul
start http://localhost:8080

echo.
echo [6/6] 启动完成！
echo.
echo ========================================
echo   服务已启动！
echo ========================================
echo.
echo   前端地址: http://localhost:8080
echo   后端地址: http://localhost:8000
echo   API文档:  http://localhost:8000/docs
echo.
echo   快速访问:
echo   - 主页: http://localhost:8080/index.html
echo   - 设备管理: http://localhost:8080/device-manager.html
echo   - SSVEP测试: http://localhost:8080/ssvep-test.html
echo.
echo   [提示] 请勿关闭后端和前端的命令行窗口
echo   [提示] 如果服务启动失败，请查看对应窗口的错误信息
echo   [提示] 按任意键退出此窗口（服务继续运行）
echo ========================================
pause >nul

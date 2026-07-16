@echo off
echo ========================================
echo SSVEP Platform - 启动开发服务器
echo ========================================
echo.

echo 激活Conda环境...
call conda activate ssvep_platform

echo.
echo 设置Python路径...
set PYTHONPATH=%cd%

echo.
echo 启动FastAPI服务器...
echo.
echo 服务器地址: http://localhost:8000
echo API文档: http://localhost:8000/docs
echo.
echo 按 Ctrl+C 停止服务器
echo.

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

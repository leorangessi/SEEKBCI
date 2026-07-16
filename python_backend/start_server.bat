@echo off
echo ========================================
echo SSVEP Platform - 启动开发服务器
echo ========================================
echo.

echo 激活Conda环境...
call conda activate ssvep_platform

echo.
echo 启动FastAPI服务器...
echo 访问 http://localhost:8000/docs 查看API文档
echo 按 Ctrl+C 停止服务器
echo.

python app/main.py

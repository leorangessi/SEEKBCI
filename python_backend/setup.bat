@echo off
echo ========================================
echo SSVEP Platform - Python Backend Setup
echo ========================================
echo.

echo [1/5] 创建Conda环境...
call conda create -n ssvep_platform python=3.9 -y
if %errorlevel% neq 0 (
    echo 错误: Conda环境创建失败
    pause
    exit /b 1
)

echo.
echo [2/5] 激活Conda环境...
call conda activate ssvep_platform

echo.
echo [3/5] 安装Python依赖...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo 错误: 依赖安装失败
    pause
    exit /b 1
)

echo.
echo [4/5] 复制环境变量配置...
if not exist .env (
    copy env.example .env
    echo 已创建.env文件，请根据需要修改配置
) else (
    echo .env文件已存在，跳过
)

echo.
echo [5/5] 创建必要的目录...
if not exist logs mkdir logs
if not exist uploads mkdir uploads

echo.
echo ========================================
echo 安装完成！
echo ========================================
echo.
echo 下一步操作：
echo 1. 编辑 .env 文件配置数据库连接
echo 2. 确保PostgreSQL和Redis服务已启动
echo 3. 运行 python scripts/init_db.py 初始化数据库
echo 4. 运行 python app/main.py 启动服务
echo.
echo 或者直接运行 start_server.bat 启动服务
echo.
pause

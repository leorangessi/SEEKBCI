@echo off

chcp 65001 >nul

title SEEKBCI PLAT 启动器

setlocal



set "ROOT=%~dp0.."

set "BACKEND=%ROOT%\python_backend"

set "PORT=28765"

set "UI=http://127.0.0.1:%PORT%/ui/index.html"



REM 优先使用本机 Python 3.9（与项目文档一致）

set "PY="

if exist "%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python39\py3.9.exe"

if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python39\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python39\python.exe"

if not defined PY (

    where py >nul 2>&1 && set "PY=py -3.9"

)

if not defined PY (

    where python >nul 2>&1 && set "PY=python"

)



if not defined PY (

    echo [错误] 未找到 Python。请安装 Python 3.9 或将其加入 PATH。

    echo 正式版将内嵌 Python，无需用户自行安装（见 PENDING_TODO.md）。

    pause

    exit /b 1

)



echo ========================================

echo   SEEKBCI PLAT - 探索脑机平台

echo ========================================

echo 使用解释器: %PY%

echo 后端目录: %BACKEND%

echo API 端口: %PORT% （若被占用请设置环境变量 SEEKBCi_API_PORT）

echo.



cd /d "%BACKEND%"



REM 检查依赖（仅提示，不阻断）

%PY% -c "import fastapi, uvicorn" 2>nul

if errorlevel 1 (

    echo [提示] 正在安装后端依赖（首次可能较慢）...

    %PY% -m pip install -r requirements.txt

)



set "SEEKBCi_API_PORT=%PORT%"

echo 正在启动 API 服务 (127.0.0.1:%PORT%)...

start "SEEKBCI-API" /min cmd /c "set SEEKBCi_API_PORT=%PORT%&& %PY% -m uvicorn app.main:app --host 127.0.0.1 --port %PORT%"



echo 等待服务就绪...

timeout /t 3 /nobreak >nul



echo 打开主页: %UI%

start "" "%UI%"



echo.

echo 若页面显示后端离线，请稍等几秒后刷新。

echo 关闭本窗口不会停止 API（API 在最小化窗口中运行）。

echo 桌面安装包打包方案见 PENDING_TODO.md（暂缓）。

pause


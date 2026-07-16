# 构建 SEEKBCI 内置 API（PyInstaller one-folder）
# 用法: powershell -File scripts/build-seekbci-api.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "python_backend"
$Frontend = Join-Path $Root "web_frontend"
$Dist = Join-Path $Backend "dist\seekbci-api"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SEEKBCI API 桌面打包 (PyInstaller)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $Frontend)) {
    throw "未找到 web_frontend: $Frontend"
}

$Py = $env:SEEKBCi_PYTHON
if (-not $Py) {
    foreach ($c in @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python39\python.exe",
        "python"
    )) {
        if ($c -eq "python") { $Py = "python"; break }
        if (Test-Path $c) { $Py = $c; break }
    }
}

Write-Host "Python: $Py"
Set-Location $Backend

& $Py -m pip install --upgrade pip wheel | Out-Null
Write-Host "安装桌面依赖 (requirements-desktop.txt)..."
& $Py -m pip install -r requirements-desktop.txt
Write-Host "安装 PyInstaller..."
& $Py -m pip install "pyinstaller>=6.0"

Write-Host "清理旧产物..."
if (Test-Path "dist\seekbci-api") { Remove-Item -Recurse -Force "dist\seekbci-api" }
if (Test-Path "build\seekbci-api") { Remove-Item -Recurse -Force "build\seekbci-api" }

Write-Host "运行 PyInstaller..."
& $Py -m PyInstaller seekbci_api.spec --noconfirm

if (-not (Test-Path (Join-Path $Dist "seekbci-api.exe"))) {
    throw "打包失败：未生成 dist\seekbci-api\seekbci-api.exe"
}

Write-Host ""
Write-Host "完成: $Dist" -ForegroundColor Green
Write-Host "下一步: cd electron-shell && npm run dist"

# SEEKBCI Electron 桌面壳

**日常开发调试请用桌面版，不要再用浏览器打开 `/ui`。**

## 一键启动（推荐）

```bat
scripts\dev-desktop.bat
```

或在 `electron-shell` 目录：

```bat
d:\nodejs\npm.cmd start
```

（若 Node 在 PATH 里，也可直接 `npm start`。）

首次需安装依赖：

```bat
cd electron-shell
d:\nodejs\npm.cmd install
```

### 启动后会发生什么

1. Electron 自动拉起 Python API（开发期用本机 `python -m uvicorn`，无需先开 bat）
2. 从 **28765** 起扫描空闲端口（例如 `http://127.0.0.1:28766`）
3. 桌面窗口加载 `/ui/index.html`（不是浏览器标签页）
4. 关闭窗口或终端 `Ctrl+C` 会一并结束后端子进程

### 其他入口

```bat
d:\nodejs\npm.cmd run start:home      # 主页（同 start）
d:\nodejs\npm.cmd run start:editor    # 项目编辑器
d:\nodejs\npm.cmd run start:stimulus  # 刺激页（透明置顶）
```

---

用户**无需安装 Python**（正式安装包目标）：安装包内嵌 `seekbci-api` 子进程。

## 开发者：打出安装包

**一键（推荐）**

```bat
scripts\build-seekbci-desktop.bat
```

**分步**

```powershell
# 1. PyInstaller 打 API（含 web_frontend + 依赖，约数分钟）
powershell -File scripts/build-seekbci-api.ps1

# 2. Electron 安装依赖
cd electron-shell
npm install

# 3. 打 win 安装包 + 便携 exe
npm run dist
```

产物目录：`electron-shell/dist/`

| 文件 | 说明 |
|------|------|
| `SEEKBCI PLAT Setup x.x.x.exe` | NSIS 安装程序 |
| `SEEKBCI-PLAT-x.x.x-portable.exe` | 免安装便携版 |

## 架构

```
Electron 主进程 (main.js)
  ├─ 启动 seekbci-api.exe（extraResources/seekbci-api/）
  ├─ 等待 GET /health
  └─ BrowserWindow → http://127.0.0.1:8000/ui/index.html
       └─ 刺激页仍可用透明置顶 + preload IPC
```

- 用户数据：`SEEKBCi_DATA_DIR` → `%APPDATA%/SEEKBCI`（广场、配置等）
- 前端与 API 同端口，避免 `file://` 与 CORS 问题

## 目录

```
SSVEP_PLAT/
├── web_frontend/           # H5 单一真相（打进 API 包）
├── python_backend/
│   ├── run_seekbci_api.py  # PyInstaller 入口
│   ├── seekbci_api.spec
│   └── dist/seekbci-api/   # 构建产物（gitignore）
└── electron-shell/         # 本目录
    ├── src/main.js
    ├── src/api-launcher.js
    └── dist/               # 安装包（gitignore）
```

## 环境变量（高级）

| 变量 | 说明 |
|------|------|
| `SEEKBCi_PYTHON` | 开发回退时指定 Python 路径 |
| `SEEKBCi_DATA_DIR` | 覆盖用户数据目录（Electron 自动设置） |
| `SEEKBCi_API_PORT` | API 端口，默认 8000 |

## 后续

- Linux AppImage / macOS dmg
- 安装包图标与代码签名
- 可选：BrainFlow 等重型设备库按需分包

# SEEKBCI 待办 backlog

记录已讨论但**暂缓实施**的事项，避免与当前迭代混淆。

---

## 暂缓：Electron 桌面安装包

**状态：** 代码骨架已就绪，**等产品功能差不多再打包发布**。

**目标：** 用户无需安装 Python / 配环境，双击 exe 即可使用。

**已有准备（无需现在执行）：**

| 路径 | 说明 |
|------|------|
| `electron-shell/` | Electron 主进程、API 子进程拉起 |
| `electron-shell/src/api-launcher.js` | 启动/停止内置 API |
| `python_backend/run_seekbci_api.py` | PyInstaller 入口 |
| `python_backend/seekbci_api.spec` | API 打包 spec |
| `python_backend/requirements-desktop.txt` | 桌面版精简依赖 |
| `scripts/build-seekbci-api.ps1` | 仅打 API |
| `scripts/build-seekbci-desktop.bat` | 一键 API + Electron |
| `scripts/start_seekbci_desktop.bat` | 开发期桌面启动 |

**正式打包时步骤（备忘）：**

1. `scripts\build-seekbci-desktop.bat`
2. 产物：`electron-shell\dist\` 下 NSIS 安装包 + 便携 exe
3. 验收：新机器无 Python 可打开主页、设备、实验、广场

**暂不做的原因：** 先完善实验参数同步、端口策略、核心功能；打包体积大（scipy 等），需稳定后再发版。

---

## 暂缓：云端部署

见 `DEVELOPMENT_PLAN.md` 阶段 A5 / `python_backend/deploy/`。

---

## 暂缓：Android / Linux 客户端

见 `DEVELOPMENT_PLAN.md` 阶段 A2。

---

*最后更新：2026-06-06*

# SEEKBCI PLAT 开发计划（2026-06）

本文档汇总产品建议、已确认决策与分阶段实施路线。当前迭代目标：**完成阶段 A（1–5）与 B/C 项 6–10（物理世界控制除外，已占位）**。

---

## 一、已确认的产品决策

| 主题 | 决策 |
|------|------|
| 品牌 | **SEEKBCI PLAT · 探索脑机平台** |
| 分发形态 | 用户**不应自行安装 Python**；最终 **exe / 一键 bat**，并规划 **Android、Linux**（弱化纯 Web 部署） |
| 云端 | **需要**云端备份、点赞持久化；需考虑**每用户项目数上限**；部署代码预留 `python_backend/deploy/` |
| 账号 | **邮箱验证** + 注册时**密码输入两遍**；积分换会员（先占位） |
| 广场治理 | 举报 / 管理员下架、项目标签、知识产权说明（导入不可二次发布） |
| 刺激页 | Debug 信息**默认折叠**，按钮开关；Python 调度记录**简化** |
| 实验 | 「测试功能」→ **「实验测试」**；在实验中找参数再应用到项目；运行参数与实验参数需对齐（持续迭代） |
| 契约 | 项目 JSON **Schema** 约束前后端与导入导出 |
| 测试 | 算法/API **契约测试** + FBCCA 回归（见阶段 C） |
| 物理世界 | 后续接入（无人机、串口设备等），先完善平台本体 |
| 隐私 | 注册/广场页展示脑电不上传、分享内容说明 |

---

## 二、阶段 A（当前迭代，优先完成 1–5）

### A1. 一键启动（bat / 未来 exe）

**现状**

- 后端：`python_backend` + uvicorn，默认 `http://127.0.0.1:28765/ui/`（可通过 `SEEKBCi_API_PORT` 修改；自动探测仍兼容旧 8000）
- 桌面壳：`electron-shell/`（Chromium + 可选无边框刺激窗）
- 启动脚本：`scripts/start_seekbci.bat`（本迭代新增）

**路线**

1. **短期（已完成脚本）**：`scripts/start_seekbci.bat` 启动后端并打开主页。
2. **中期（暂缓，见 `PENDING_TODO.md`）**：Electron + PyInstaller 内嵌 API，用户无需安装 Python
3. **Android**：Flutter/Kotlin 壳 + WebView 或原生 UI；**LSL/蓝牙 EEG** 需 JNI/插件；FBCCA 可 Python 侧（Chaquopy）或移植核心到 Kotlin/C++（工作量大，单独立项）。
4. **Linux**：与 Windows 类似，AppImage / deb + 内嵌 Python；注意串口权限与 LSL。

**注意**：跨平台时 API 地址统一为 `127.0.0.1`，由壳注入 `window.SSVEP_API_ORIGIN`。

### A2. 跨平台（标记，本迭代不实现）

- [ ] Android 技术选型评审（WebView vs Flutter）
- [ ] Linux 打包 PoC
- [ ] 设备层抽象（LSL/串口）平台差异文档

### A3. 主页与文案

- [x] 移除「Week x 开发中」等过时文案
- [x] 功能卡片与真实能力对齐
- [x] 快捷入口含：**实验测试**、项目广场、新手引导

### A4. 新手引导

- [x] 首次打开 `index.html` 自动展示引导（localStorage `seekbci_onboarding_done`）
- [x] 主页可随时点击「新手引导」重复查看
- 路径：导入示例 → 运行（可无 EEG）→ 设备管理 → 实验测试调参 → 分享广场

### A5. 云端（标记 + 占位，本迭代不部署服务器）

**预留目录**：`python_backend/deploy/`

| 文件 | 用途 |
|------|------|
| `README.md` | 部署说明（Docker / 云主机） |
| `cloud_api_stub.py` | 云端 API 接口占位（备份/同步/点赞） |
| `.env.example` | 数据库、SMTP、管理员密钥 |

**规划接口（未实现）**

- `POST /api/cloud/projects/sync` — 上传/合并本地项目
- `GET /api/cloud/projects` — 列表（限额：免费用户 N 个，会员 M 个）
- 点赞、广场数据已在本机 `plaza.json`，迁云后改 PostgreSQL + Redis

**限额建议（待云部署时启用）**

| 等级 | 云端项目数 | 广场发布数 |
|------|------------|------------|
| 免费 | 10 | 5 |
| 会员 | 100 | 50 |

---

## 三、阶段 B（本迭代部分落地）

### B6. 注册与安全

- [x] 密码双输入、哈希存储（SHA-256 + salt，生产可换 bcrypt）
- [x] 邮箱验证码（开发模式 API 返回 `dev_code`；生产接 SMTP）
- [x] 未验证邮箱不可分享/点赞

### B7. 项目广场治理

- [x] 标签：`keyboard` / `drone` / `multimodal` / `teaching`
- [x] 举报接口 + 管理员下架（`X-Admin-Key`）
- [x] 发布时知识产权勾选；导入项目默认 `import_only_no_republish`
- [x] 广场展示 IP 说明文案

### B8. 积分与会员（占位）

- [x] 用户字段：`points`、`membership_tier`（`free` / `member`）
- [ ] 积分规则、兑换会员流程（产品+合规评审后实现）

### B9. 刺激页 Debug

- [x] 控制面板「Debug」折叠区：Top3 概率、未触发原因、Python 简版日志
- [x] Python 完整代码默认不展示，仅对象名 + 成败 + 首行输出

### B10. 实验测试

- [x] 侧栏与主页改名为「实验测试」
- [x] 说明：在实验中找到合适参数后写入项目运行配置
- [x] 「识别速度测试」→ 同步到项目 `runConfig`（`js/experiment-config.js` + ssvep-test 页）
- [x] 刺激参数测试 → 同步闪烁参数到 `runConfig`（test-stimulus 页）
- [x] 运动通道测试 → 同步到 `settings.experimentEmg`（emg-test 页）

### B11. 隐私说明

- [x] 注册页、广场页底部说明（脑电不上传、分享范围、邮箱用途）

---

## 四、阶段 C（测试与契约，细化建议）

### C12. 测试金字塔

1. **单元**：`plaza_store`、`fbcca_classify` 固定输入输出
2. **API**：`TestClient` 覆盖 `/api/plaza/*`、`/api/ssvep/fbcca/*`
3. **契约**：`schemas/ssvep-project.schema.json` + 编辑器/项目管理器校验
4. **E2E（选手动）**：新手引导路径、分享→导入→运行

### C13. JSON Schema 契约

- 文件：`web_frontend/schemas/ssvep-project.schema.json`
- 前端：`js/project-contract.js` — `validateSeekbciProject()`、`assertValidProject()`
- 校验时机：分享到广场、广场导入、编辑器保存时写入 `contractVersion`
- 后端：`app/schemas/project_contract.py` — 发布/同步前校验
- 版本字段：`contractVersion: 1`

### C14. 存储演进

`plaza.json` → SQLite（单机/边缘）→ PostgreSQL（云端），迁移脚本保留 `owner_id`、点赞表、举报表。

### C15. 无独立 Web 版

交付以 **桌面 exe / bat** 为主；Linux AppImage；Android 独立 App。开发期仍用 `uvicorn /ui` 热更新。

---

## 五、阶段 D（后续）

- 个人 SSVEP 校准（被试阈值、窗长预设）
- 物理世界控制（无人机、GPIO、串口）— 占位页 `web_frontend/physical-world.html`，统一「设备动作」层
- 评论、关注、版本 diff
- 正式 SMTP、OAuth、会员支付与合规文案

---

## 六、本迭代文件清单

| 路径 | 说明 |
|------|------|
| `DEVELOPMENT_PLAN.md` | 本文档 |
| `scripts/start_seekbci.bat` | Windows 一键启动 |
| `web_frontend/js/onboarding.js` | 新手引导 |
| `web_frontend/schemas/ssvep-project.schema.json` | 项目契约 |
| `web_frontend/js/project-contract.js` | 前端校验 |
| `python_backend/app/schemas/project_contract.py` | 后端校验 |
| `python_backend/deploy/*` | 云端部署占位 |
| `web_frontend/index.html` | 主页改版 |
| `web_frontend/js/experiment-config.js` | 实验参数 ↔ 项目同步 |
| `web_frontend/physical-world.html` | 物理世界控制占位页 |
| `python_backend/app/services/plaza_store.py` | 注册/标签/举报/会员字段 |

---

## 七、验收清单（阶段 A）

- [ ] 双击 `scripts/dev-desktop.bat` 或 `electron-shell` 下 `npm start` 打开桌面版（**不要用浏览器 /ui**）
- [x] 首次访问出现新手引导；可再次打开
- [x] 主页无过时 Week 文案；有实验测试入口
- [x] `deploy/README.md` 存在且说明云端后续步骤
- [x] 注册需邮箱验证码 + 双密码；广场标签与举报可用

---

## 八、迭代 6–10 验收（2026-06）

| # | 项 | 状态 |
|---|-----|------|
| 6 | 注册（双密码+邮箱验证+登录）+ JSON Schema 契约 | ✅ |
| 7 | 广场标签 / 举报 / 管理员下架 / IP 说明 | ✅ |
| 8 | 刺激页 Debug 折叠 + Python 日志简化 | ✅ |
| 9 | 实验测试三页参数同步到项目 | ✅ |
| 10 | 物理世界控制 | ⏸ 占位（`physical-world.html`） |

---

*最后更新：2026-06-04（阶段 A + B/C 6–9 落地，10 占位）*

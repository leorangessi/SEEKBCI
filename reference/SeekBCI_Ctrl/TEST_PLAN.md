# SEEKBCI 控制板联调测试方案

## 概述

本方案采用"固件始终联网"策略：`test_ctrl.ino` 始终启动 BLE 广播，平台可直接扫描连接并发送指令驱动测试，Serial Monitor 同步打印验证结果。

**核心思路：不再分离地做"纯固件测试"和"纯 API 测试"——所有测试都从平台发起，固件 + 后端 + 前端三方同时参与验证。**

---

## 测试环境

### 硬件

| 设备 | 数量 | 用途 |
|------|------|------|
| ESP32-WROOM-32D DevKit | 1 (必须) / 2 (独立模式测试) | 烧录 test_ctrl.ino |
| 按钮 | 1 | GPIO4 → GND |
| 电位器 10K | 1 | 中脚→GPIO34，两端→3.3V/GND |
| LED + 220Ω | 1 | GPIO5 → LED → GND (PWM 观察) |
| 舵机 SG90 | 1 | 信号→GPIO18，红→5V外供，棕→GND |
| 万用表 | 1 | 测量 DAC(GPIO25) 电压 |

### 接线图

```
         ESP32-WROOM-32D
         ┌─────────────────┐
    GND ─┤GND          3V3├─ 电位器一端
    BTN ─┤GPIO4        GND├─ 电位器另一端
         │             G34├─ 电位器中间脚
         │              G2├─ 板载LED (已有)
         │             G25├─ 万用表探头 (DAC)
    GND ─┤GND           G5├─ LED+220Ω→GND (PWM)
  5Vext ─┤5V(或外供)   G18├─ 舵机信号(橙)
         └─────────────────┘
```

### 软件

- Arduino IDE 2.x + ESP32 Board Package + NimBLE-Arduino
- Python 3.10+ (`pip install bleak fastapi uvicorn`)
- Chrome/Edge 浏览器

---

## 测试执行步骤

### 第一步：烧录固件

1. 在 Arduino IDE 中打开 `reference/SeekBCI_Ctrl/examples/TestCtrl/test_ctrl.ino`
2. Board 选 "ESP32 Dev Module"，115200 波特率
3. 编译上传，打开 Serial Monitor
4. 应看到启动 banner 和 "等待平台连接..."

### 第二步：启动后端

```bash
cd python_backend
python -m uvicorn app.main:app --reload --port 28765
```

### 第三步：打开前端

浏览器打开 `http://127.0.0.1:28765/ui/physical-world.html`

---

## 测试用例（按面板顺序执行）

### Phase A：扫描与连接

| # | 操作 | 平台预期 | Serial 预期 |
|---|------|----------|-------------|
| A1 | 点击"扫描控制板" | 设备列表出现 SEEKBCI_CTRL_TEST | - |
| A2 | 点击设备卡片连接 | 状态变"已连接" | 打印 "[PLAT] 平台已连接 ✓" |
| A3 | 点击"断开" | 状态变"已断开" | 打印 "[PLAT] 平台已断开" |
| A4 | 再次点击设备卡片 | 重新连接成功 | 再次打印连接成功 |
| A5 | 关闭 ESP32 电源后扫描 | 设备列表为空 | - |

### Phase B：动作测试（输出验证）

连接成功后切到"动作测试"面板：

| # | 点击按钮 | 物理观察 | Serial 预期 |
|---|----------|----------|-------------|
| B1 | LED 亮 | GPIO2 板载LED 亮 | `[CMD] act=0x01 pin=2 p1=1 → HIGH(亮)` |
| B2 | LED 灭 | GPIO2 LED 灭 | `[CMD] act=0x01 pin=2 p1=0 → LOW(灭)` |
| B3 | LED 翻转 | LED 切换 | `[CMD] act=0x02 pin=2 → TOGGLE` |
| B4 | 舵机 0° | 舵机转到最左 | `[CMD] act=0x06 pin=18 p1=0 → 0°` |
| B5 | 舵机 90° | 舵机转到中间 | `[CMD] act=0x06 pin=18 p1=90 → 90°` |
| B6 | 舵机 180° | 舵机转到最右 | `[CMD] act=0x06 pin=18 p1=180 → 180°` |
| B7 | DAC 50% | 万用表测 GPIO25 ≈ 1.65V | `[CMD] act=0x03 pin=25 p1=128 → 1.65V` |
| B8 | PWM 1秒 | GPIO5 LED 亮 1 秒后熄 | `[CMD] act=0x05 pin=5 p1=200 p2=1000` |
| B9 | 自定义: type=4 pin=5 p1=64 p2=0 | GPIO5 LED 25% 亮度 | `[CMD] act=0x04 pin=5 p1=64` |

### Phase C：信号监听（输入验证）

保持连接状态，物理操作 ESP32 板上外设：

| # | 物理操作 | 平台"信号"面板预期 | Serial 预期 |
|---|----------|-------------------|-------------|
| C1 | 按下按钮 (GPIO4) | 收到 signal: ch=0, value=0 | `[INPUT] channel=0 value=0 (按钮按下)` |
| C2 | 松开按钮 | 收到 signal: ch=0, value=1 | `[INPUT] channel=0 value=1 (松开)` |
| C3 | 快速连按 (<50ms) | 只收到 1 个事件 | 只打印 1 次（去抖） |
| C4 | 转动电位器到中间 | 收到 signal: ch=1, value≈2048 | `[INPUT] channel=1 value=2048 (1.65V)` |
| C5 | 电位器转到最大 | value≈4095 | `[INPUT] channel=1 value=4095 (3.3V)` |
| C6 | 电位器转到最小 | value≈0 | `[INPUT] channel=1 value=0 (0V)` |

### Phase D：映射规则

切到"映射规则"面板：

| # | 操作 | 预期 |
|---|------|------|
| D1 | 切到"设备配置"，角色=OUTPUT，选 GPIO2+GPIO5+GPIO25+GPIO18 | 引脚高亮 |
| D2 | 保存配置，切到映射面板 | 右侧出现输出目标节点 |
| D3 | 点击左侧"👁 眼电触发" → 右侧"GPIO2 开关" | 规则列表出现一条 |
| D4 | 点击左侧"🧠 专注度" → 右侧"GPIO18 舵机" | 规则列表出现两条 |
| D5 | 点击规则右侧 ✕ | 该条规则删除 |
| D6 | 点击"写入设备" | 平台显示"已写入"，Serial 无重启 |
| D7 | 点击"写入并独立运行" → 确认 | 平台显示设备断开，Serial 打印重启 |

### Phase E：NVS 与独立模式

| # | 操作 | 预期 |
|---|------|------|
| E1 | D7 完成后观察 Serial | 打印 "Mode: STANDALONE" |
| E2 | 观察 LED | 快闪（搜索被控板中） |
| E3 | 长按 BOOT 键 3 秒 | LED 快闪 10 次，重启回配对模式 |
| E4 | 重启后平台重新扫描 | SEEKBCI_CTRL_TEST 再次出现 |
| E5 | 连接后点"清除设备规则" | Serial 打印规则已清除 |

### Phase F：独立模式两板联调（需要第二块 ESP32）

准备：板 B 烧录 `examples/BasicOutput/BasicOutput.ino`

| # | 操作 | 预期 |
|---|------|------|
| F1 | 平台连接板 A (test_ctrl) | 已连接 |
| F2 | 映射规则: GPIO4(按钮)→GPIO2(开关)，写入并独立运行 | 板 A 重启 |
| F3 | 板 B 上电 | 板 A LED 从快闪变常亮（配对成功） |
| F4 | 按板 A 的按钮 | 板 B 的 LED 翻转 |
| F5 | 板 B 断电 | 板 A LED 变双闪（连接丢失） |
| F6 | 板 B 重新上电 | 板 A 自动重连，LED 恢复常亮 |
| F7 | 板 A 长按 BOOT 3 秒 | 退出独立模式，回配对 |

### Phase G：API 直接测试（可选，用 curl 或 Postman）

```bash
# 扫描
curl http://127.0.0.1:28765/api/ctrl/scan

# 连接（替换为实际 MAC）
curl -X POST http://127.0.0.1:28765/api/ctrl/connect \
  -H "Content-Type: application/json" \
  -d '{"address":"AA:BB:CC:DD:EE:FF"}'

# 点灯
curl -X POST "http://127.0.0.1:28765/api/ctrl/action/gpio_set?pin=2&level=1"

# 舵机
curl -X POST "http://127.0.0.1:28765/api/ctrl/action/servo?pin=18&angle=90"

# 信号轮询
curl http://127.0.0.1:28765/api/ctrl/signals

# 状态
curl http://127.0.0.1:28765/api/ctrl/status

# 断开
curl -X POST http://127.0.0.1:28765/api/ctrl/disconnect
```

---

## 通过标准

| 阶段 | 通过条件 |
|------|----------|
| A (扫描连接) | 5/5 用例通过 |
| B (动作测试) | 9/9 用例通过（无舵机可跳过 B4-B6） |
| C (信号监听) | 6/6 用例通过（无电位器可跳过 C4-C6） |
| D (映射规则) | 7/7 用例通过 |
| E (NVS) | 5/5 用例通过 |
| F (独立模式) | 需要第二块板，7/7 用例通过 |
| G (API) | 与 B/C 等价，通过即可 |

全部 Phase A-E 通过即可视为**单板联调测试通过**。Phase F 需要双板验证独立模式。

---

## 故障排查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| 扫描不到设备 | 蓝牙适配器问题 / 固件未启动 BLE | 检查 Serial 是否有 "广播已启动" |
| 连接超时 | Windows BLE 缓存 / 距离太远 | 重启蓝牙适配器，设备靠近 |
| 动作无响应 | 指令包格式不匹配 | 检查 Serial 是否打印 [CMD] |
| 信号面板无数据 | TX Notify 未订阅成功 | 检查 ctrl_ble_bridge 日志 |
| 独立模式不重启 | NVS 写入失败 | Serial 检查 "saveRulesToNvs" 返回值 |
| DAC 电压不准 | GPIO25 有负载 | 高阻抗万用表直接测 |

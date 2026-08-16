# SEEKBCI 控制板设计文档

## 1. 概述

SEEKBCI 控制板是 SEEKBCI PLAT 平台的物理世界扩展模块，基于 ESP32，通过 BLE 与平台或头环通信。控制板可配置为**控制端（INPUT）**或**被控端（OUTPUT）**，支持两种使用方式：

1. **Arduino 库方式**：开发者通过 `SeekBCI_Ctrl` 库 API 编程，实现自定义逻辑
2. **平台手动配置方式**：非编程用户通过 SEEKBCI_PLAT 前端 UI 可视化配置引脚和映射规则

## 2. 角色定义

| 角色 | 标识色 | BLE 模式 | 职责 |
|------|--------|----------|------|
| 头环 (SEEKBCI) | 蓝色 #00D9FF | Peripheral / 独立模式变 Central | 采集 EEG/EOG/EMG；独立模式运行轻量算法并控制被控板 |
| 控制板 (CTRL_INPUT) | 橙色 #FF9800 | Peripheral / 独立模式变 Central | 读取 GPIO/ADC 信号；独立模式直连被控板 |
| 被控板 (CTRL_OUTPUT) | 绿色 #4CAF50 | Peripheral（始终被连接） | 接收指令并执行 GPIO/DAC/PWM/舵机动作 |

## 3. 通信架构

### 3.1 PC 模式（平台在线）

```
PC (Central) ─── BLE ──→ 头环 (Peripheral)     [采集数据]
PC (Central) ─── BLE ──→ 控制板 (Peripheral)   [读取输入]
PC (Central) ─── BLE ──→ 被控板 (Peripheral)   [发送指令]

数据流: 头环/控制板 → PC算法处理 → 规则判定 → PC下发指令 → 被控板执行
```

### 3.2 独立模式（脱离 PC）

```
头环 (Central) ─── BLE ──→ 被控板 (Peripheral)
或
控制板 (Central) ─── BLE ──→ 被控板 (Peripheral)

数据流: 头环本地算法/控制板本地IO → 规则判定 → 直接发指令 → 被控板执行
```

### 3.3 一对一配对

当前设计为严格一对一：一个控制端只配对一个被控端。被控板始终为 Peripheral，不主动发起连接。

## 4. 输入信号定义

| 信号源 | 来源设备 | 数据类型 | 触发方式 |
|--------|----------|----------|----------|
| GPIO 开关量 | 控制板 | HIGH/LOW | 上升沿 / 下降沿 / 双边沿 |
| ADC 模拟量 | 控制板 | 0–4095 (12bit) | 阈值触发 / 线性映射 |
| 眼电 (EOG) | 头环 | 事件脉冲 | PC: eog-pulse-detector 算法；MCU: 简化 pulse 检测 |
| 肌电 (EMG) | 头环 | 事件脉冲 | PC: emg-peak-trigger 算法；MCU: RMS 包络 + 阈值 |
| 专注度 (Focus) | 头环 | 连续值 0–100 | PC: focus_monitor TBR；MCU: 128点FFT Alpha/Beta比 |

## 5. 输出动作定义

### 5.1 平台可配置的标准动作

| 动作类型 | 说明 | 参数 |
|----------|------|------|
| GPIO 开关 | 输出高/低电平 | pin, level(HIGH/LOW) |
| GPIO 翻转 | 每次触发翻转一次 | pin |
| DAC 输出 | 模拟电压输出 (ESP32: GPIO25/26, 8bit) | pin, value(0–255) |
| PWM 持续 | 持续输出指定占空比 | pin, duty, freq |
| PWM 定时 | 输出一段时间后停止 | pin, duty, freq, duration_ms |
| 舵机角度 | 50Hz PWM + 脉宽映射 (0–180°) | pin, angle |

### 5.2 复杂逻辑（仅 Arduino IDE）

超出标准动作的复杂需求，用户需在 Arduino IDE 中使用 `SeekBCI_Ctrl` 库的 `onBleCommand` 回调自行实现。平台不提供可视化编程环境。

## 6. BLE 协议定义

### 6.1 Service UUID

```
CTRL_SERVICE:  7f530001-1b15-4a0b-9f7f-8f54f8d7a001
CTRL_RX:       7f530002-1b15-4a0b-9f7f-8f54f8d7a001  (PC/Central 写入)
CTRL_TX:       7f530003-1b15-4a0b-9f7f-8f54f8d7a001  (设备 Notify)
CTRL_OTA:      7f530004-1b15-4a0b-9f7f-8f54f8d7a001  (OTA 数据写入)
CTRL_CONFIG:   7f530005-1b15-4a0b-9f7f-8f54f8d7a001  (规则配置读写)
```

### 6.2 Advertising 数据

Manufacturer Specific Data (2 bytes company ID + payload):

```
byte[0]: device_role     0x01=INPUT, 0x02=OUTPUT
byte[1]: capabilities    bit0=GPIO_IN, bit1=ADC_IN, bit2=GPIO_OUT, bit3=PWM_OUT, bit4=DAC_OUT, bit5=SERVO
byte[2-3]: device_id     uint16 (NVS 持久化)
```

设备名格式: `SEEKBCI_CTRL_xxxx`（xxxx 为 device_id 十六进制）

### 6.3 指令包格式（Central → 被控板）

```
| byte | 含义 |
|------|------|
| 0    | 0xC0 (指令包头) |
| 1    | action_type: 0x01=GPIO_SET, 0x02=GPIO_TOGGLE, 0x03=DAC, 0x04=PWM, 0x05=PWM_TIMED, 0x06=SERVO |
| 2    | target_pin |
| 3-4  | param1 (uint16 LE): duty/value/angle |
| 5-6  | param2 (uint16 LE): freq(PWM) 或 duration_ms(PWM_TIMED) |
| 7    | 0xC3 (指令包尾) |
```

### 6.4 状态上报包格式（控制板 → PC）

```
| byte | 含义 |
|------|------|
| 0    | 0xD0 (状态包头) |
| 1    | channel_index |
| 2    | signal_type: 0x01=GPIO, 0x02=ADC |
| 3-4  | value (uint16 LE) |
| 5    | 0xD3 (状态包尾) |
```

## 7. NVS 规则存储格式

```c
typedef struct {
    uint8_t  valid;           // 0xFF=空, 0x01=有效
    uint8_t  signal_type;     // 0x01=GPIO, 0x02=ADC, 0x10=EOG, 0x11=EMG, 0x12=FOCUS
    uint8_t  source_channel;  // GPIO pin号 / ADC channel
    uint8_t  trigger_mode;    // 0x01=边沿, 0x02=阈值, 0x03=线性映射
    int16_t  threshold_low;   // 阈值下限 / 边沿类型(1=上升,2=下降,3=双边)
    int16_t  threshold_high;  // 阈值上限
    uint8_t  action_type;     // 同指令包 action_type
    uint8_t  target_pin;
    uint16_t action_param1;   // duty/value/angle
    uint16_t action_param2;   // freq/duration_ms
    uint8_t  target_mac[6];   // 被控板 MAC 地址
    uint8_t  reserved[2];     // 对齐填充
} __attribute__((packed)) ctrl_rule_t;  // 20 bytes

#define MAX_RULES 8
// NVS key: "ctrl_rules" → 160 bytes (8 × 20)
```

## 8. 算法参数包（独立模式写入 NVS）

```c
typedef struct {
    // EOG 参数
    float    eog_threshold_uv;     // 默认 45.0
    uint32_t eog_refractory_ms;    // 默认 350
    float    eog_baseline_tau;     // 默认 1.5

    // EMG 参数
    float    emg_threshold_uv;     // 默认 60.0
    float    emg_window_sec;       // 默认 1.0
    float    emg_min_bin_fraction; // 默认 0.4

    // Focus 参数
    uint8_t  focus_threshold;      // 默认 70 (0–100)
    uint8_t  focus_metric;         // 0=TBR(theta/beta), 1=engagement(beta/(alpha+theta))
    uint16_t focus_fft_size;       // 默认 128

    uint8_t  reserved[8];
} __attribute__((packed)) algo_params_t;  // NVS key: "algo_params"
```

## 9. LED 指示灯规则

| 状态 | LED 行为 | 含义 |
|------|----------|------|
| 配对模式（等待 PC） | 慢闪 1Hz | 可被平台发现 |
| PC 已连接 | 常亮 | 正常工作中 |
| 独立模式 - 搜索被控板 | 快闪 3Hz | 正在扫描配对 |
| 独立模式 - 已配对 | 常亮 | 独立运行中 |
| 独立模式 - 连接丢失 | 双闪（闪两下停一下） | 需要重新配对 |
| OTA 升级中 | 呼吸灯渐变 | 固件更新中 |

## 10. 工作模式切换

### 10.1 模式判定逻辑（上电时）

```
上电 → 读取 NVS "ctrl_rules"
  ├─ 有有效规则 → 进入独立模式（Central，主动连被控板）
  └─ 无有效规则 → 进入配对模式（Peripheral，等待 PC 连接）
```

### 10.2 退出独立模式

- 长按 BOOT 键 3 秒 → 清除 NVS 规则 → 重启回到配对模式
- 或 PC 重新连接后通过 CTRL_CONFIG 特征值覆写

### 10.3 独立运行启动流程（平台触发）

```
用户点击"写入设备并独立运行"
  → 平台组装规则包 + 算法参数包
  → 通过 BLE CTRL_CONFIG 写入设备 NVS
  → 写入成功确认
  → 设备自动重启
  → 读取 NVS 有规则 → 进入独立模式
  → LED 快闪 → 扫描被控板 MAC
  → 连接成功 → LED 常亮 → 开始运行
```

## 11. Arduino 库使用方式

### 11.1 安装

**方式一（开发阶段）**: 下载 ZIP → Arduino IDE「项目 → 加载库 → 添加 .ZIP 库」

**方式二（正式发布后）**: Arduino IDE 库管理器搜索 `SeekBCI_Ctrl` 安装

### 11.2 示例：控制板（输入端）

```cpp
#include <SeekBCI_Ctrl.h>

SeekBCI_Ctrl ctrl;

void setup() {
    ctrl.begin("MyInput_01");
    ctrl.setRole(SEEKBCI_ROLE_INPUT);
    ctrl.addDigitalInput(GPIO_NUM_4, GPIO_PULLUP, EDGE_RISING);
    ctrl.addAnalogInput(GPIO_NUM_34);
}

void loop() {
    ctrl.update();
}
```

### 11.3 示例：被控板（输出端）

```cpp
#include <SeekBCI_Ctrl.h>

SeekBCI_Ctrl ctrl;

void onCmd(ctrl_command_t cmd) {
    // 用户自定义复杂逻辑
    if (cmd.action == ACTION_GPIO_SET && cmd.pin == 2) {
        // 额外逻辑...
    }
}

void setup() {
    ctrl.begin("MyOutput_01");
    ctrl.setRole(SEEKBCI_ROLE_OUTPUT);
    ctrl.addDigitalOutput(GPIO_NUM_2);
    ctrl.addPwmOutput(GPIO_NUM_5, 5000, 8);
    ctrl.addServoOutput(GPIO_NUM_18);
    ctrl.onBleCommand(onCmd);
}

void loop() {
    ctrl.update();
}
```

## 12. 平台手动配置流程

### 12.1 配置控制板（输入端）

1. 打开 physical-world.html → 扫描发现控制板
2. 点击设备卡片 → 选择「配置为控制端」
3. 勾选输入引脚 + 设置触发方式 + 命名信号
4. 保存配置（写入设备或仅保存到平台）

### 12.2 配置被控板（输出端）

1. 扫描发现被控板 → 选择「配置为被控端」
2. 勾选输出引脚 + 选择动作类型 + 设置参数
3. 为每个输出口定义动作名称

### 12.3 映射连线

1. 左侧列出所有信号源（头环 EOG/EMG/Focus + 控制板 GPIO/ADC）
2. 右侧列出所有输出动作（被控板的已配置动作）
3. 拖拽建立连线 + 设置触发规则
4. 连线动画：信号激活时粒子流动效果

### 12.4 导出集成

- 导入「物理设备实验测试」→ 信号可选择回调动作触发
- 导入「项目设计」→ 作为 event source 绑定到项目逻辑

## 13. 开发计划

| 阶段 | 内容 | 预计周期 |
|------|------|----------|
| Phase 1 | 固件 + Arduino 库骨架 | 1–2 周 |
| Phase 2 | 头环独立模式 + MCU 算法 | 1 周 |
| Phase 3 | 后端 API + BLE Bridge | 1 周 |
| Phase 4 | 前端 UI（配置 + 映射动画） | 1–2 周 |
| Phase 5 | 联调 + 稳定性测试 | 1 周 |

## 14. 文件结构

```
reference/SeekBCI_Ctrl/
├── CTRL_BOARD_DESIGN.md          ← 本文档
├── library.properties
├── keywords.txt
├── src/
│   ├── SeekBCI_Ctrl.h            ← 主头文件（API）
│   ├── SeekBCI_Ctrl.cpp          ← 核心实现
│   ├── seekbci_ota.h             ← OTA 模块
│   ├── seekbci_ota.cpp
│   ├── seekbci_led.h             ← LED 状态驱动
│   ├── seekbci_led.cpp
│   ├── eog_mcu.h                 ← MCU 眼电检测
│   ├── emg_mcu.h                 ← MCU 肌电检测
│   └── focus_mcu.h               ← MCU 专注度估计
├── examples/
│   ├── BasicInput/
│   │   └── BasicInput.ino
│   ├── BasicOutput/
│   │   └── BasicOutput.ino
│   └── FactoryFirmware/
│       └── FactoryFirmware.ino   ← 预烧固件
└── README.md
```

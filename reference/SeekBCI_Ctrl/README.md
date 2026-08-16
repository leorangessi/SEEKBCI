# SeekBCI_Ctrl

ESP32 BCI 控制板 Arduino 库，配合 SEEKBCI PLAT 平台使用。

## 功能

- 将 ESP32 配置为 **控制板（INPUT）** 或 **被控板（OUTPUT）**
- 通过 BLE 与 SEEKBCI PLAT 平台通信
- 支持 GPIO 开关量、ADC 模拟量输入
- 支持 GPIO 输出、DAC 模拟输出、PWM、舵机控制
- 支持独立模式：配置写入 Flash 后脱离 PC 运行
- 内置 OTA 固件升级
- 内置 MCU 端 EOG/EMG/Focus 算法（独立模式下使用）

## 安装

### 方式一：ZIP 安装（开发阶段）

1. 下载本仓库 ZIP
2. Arduino IDE → 项目 → 加载库 → 添加 .ZIP 库

### 方式二：手动安装

将本目录复制到 `~/Arduino/libraries/SeekBCI_Ctrl/`

### 依赖

- [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino)（通过库管理器安装）

## 快速开始

### 控制板（输入端）

```cpp
#include <SeekBCI_Ctrl.h>

SeekBCI_Ctrl ctrl;

void setup() {
    ctrl.setRole(SEEKBCI_ROLE_INPUT);
    ctrl.addDigitalInput(4, GPIO_PULLUP, EDGE_RISING);
    ctrl.addAnalogInput(34);
    ctrl.begin("MyInput_01");
}

void loop() {
    ctrl.update();
}
```

### 被控板（输出端）

```cpp
#include <SeekBCI_Ctrl.h>

SeekBCI_Ctrl ctrl;

void setup() {
    ctrl.setRole(SEEKBCI_ROLE_OUTPUT);
    ctrl.addDigitalOutput(2);
    ctrl.addServoOutput(18);
    ctrl.addDacOutput(25);
    ctrl.begin("MyOutput_01");
}

void loop() {
    ctrl.update();
}
```

## 输出动作类型

| 类型 | 方法 | 说明 |
|------|------|------|
| GPIO 开关 | `executeGpioSet(pin, level)` | 输出高/低电平 |
| GPIO 翻转 | `executeGpioToggle(pin)` | 每次调用翻转 |
| DAC | `executeDac(pin, value)` | 模拟电压 0–3.3V (8bit) |
| PWM | `executePwm(pin, duty)` | 持续 PWM |
| PWM 定时 | `executePwmTimed(pin, duty, ms)` | 输出一段时间后停止 |
| 舵机 | `executeServo(pin, angle)` | 0–180° |

## LED 指示灯

| 状态 | LED 行为 |
|------|----------|
| 配对模式 | 慢闪 1Hz |
| 已连接平台 | 常亮 |
| 独立模式搜索中 | 快闪 3Hz |
| 独立模式已配对 | 常亮 |
| 连接丢失 | 双闪 |

## 独立模式

1. 通过平台配置映射规则
2. 平台写入规则到设备 NVS
3. 设备重启后自动进入独立模式
4. 长按 BOOT 键 3 秒退出独立模式

## 文件结构

```
src/
├── SeekBCI_Ctrl.h      主 API
├── SeekBCI_Ctrl.cpp    核心实现
├── seekbci_ota.h/cpp   OTA 模块
├── seekbci_led.h       LED 驱动
├── eog_mcu.h           眼电检测
├── emg_mcu.h           肌电检测
└── focus_mcu.h         专注度估计
```

## 协议

MIT License

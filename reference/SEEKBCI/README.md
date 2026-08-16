# SEEKBCI — ESP32 + ADS1299 + BMI270 BLE

由经典蓝牙版改写：EEG 为 OpenBCI Cyton 风格二进制包，并扩展嵌入 BMI270 IMU。

## 硬件

| 模块 | 引脚 |
|------|------|
| ADS1299 SPI | 见 `SEEKBCI.ino`（当前 DRDY=21 等） |
| BMI270 I2C | **SDA=IO25，SCL=IO33** |
| 电池 / LED | BAT_DET、LED_PWR 见固件 |

Arduino 库：ESP32 BLE + **SparkFun BMI270 Arduino Library**

## BLE

| 项 | 值 |
|----|-----|
| 广播名 | `SEEKBCI` |
| Service | `7f520001-1b15-4a0b-9f7f-8f54f8d7a001` |
| RX（Write） | `7f520002-…` |
| TX（Notify） | `7f520003-…` |

### 扩展包 seekbci_eeg_v2（39 字节）

```
0xA0 | sample# | EEG 24B (8×24bit BE) | IMU 12B (6×int16 BE) | 0xC1
```

IMU 缩放（与平台一致）：

- accel：`int16 / 1000` → m/s²  
- gyro：`int16 / 10000` → rad/s  

命令：`b` 开始流、`s` 停止、`v` 版本等。

## 上位机

设备管理仅 **SEEKBCI BLE**。连接后：

- EEG → SSVEP / EMG（µV）
- IMU → `/api/imu/stream`（可与独立 BMI270 板回退共存）

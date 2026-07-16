# ESP32 BMI270 BLE Mouse / IMU（seekbci_imu_v1）

平台协议 ID：`seekbci_imu_v1`（见 `web_frontend/js/imu-protocol.js`）。

## 角色

| 类型 | 设备 | 说明 |
|------|------|------|
| 控制设备 | ESP32 + BMI270 | 输出姿态运动报文 |
| 被控设备 | 光标 / 地球预览 / 小车等 | 由映射层驱动 |

## BLE

| 项 | 值 |
|----|-----|
| 广播名 | `ESP32_BMI270_MOUSE` |
| Service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| Notify TX | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

## 载荷（UTF-8 ASCII）

- 正常：`ax,ay,az,gx,gy,gz`
  - 加速度：m/s²
  - 陀螺：rad/s
- 异常：`ERR,BMI270_NOT_READY`
- 目标采样：约 250 Hz（`SAMPLE_INTERVAL_MS=4`）

## 交互约定（光标）

与 `bmi270_ble_mouse_client.py` 对齐：

1. 连接后静止校准（默认 120 样本）→ 陀螺零偏 + 重力 yaw 轴 + pitch 轴
2. HEAD_MODE：`vx = gyro·yaw`，`vy = gyro·pitch`
3. 死区 / 平滑 / 静止自适应零偏 → 相对像素位移
4. 可选：平台 `POST /api/system/mouse/move` 驱动系统光标

## 固件 / 参考客户端

- `esp32_bmi270_ble_mouse.ino` — Arduino 固件
- `bmi270_ble_mouse_client.py` — PC 端可视化与鼠标参考实现

平台测试页：`web_frontend/imu-test.html`（二维光标 + 三维地球）。

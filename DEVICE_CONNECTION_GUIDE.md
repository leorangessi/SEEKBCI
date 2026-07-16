# 设备连接功能使用指南

## 📋 概述

SSVEP Platform 现已支持真实设备连接，包括：
- **LSL (Lab Streaming Layer)** - 网络数据流协议
- **串口 (Serial Port)** - USB串口设备
- **WiFi** - TCP/UDP网络连接

---

## 🚀 快速开始

### 1. 启动后端服务

```bash
cd python_backend
start_backend.bat
```

后端服务将在 `http://localhost:8000` 启动

### 2. 打开前端页面

在浏览器中打开：
```
web_frontend/device-manager.html
```

或从主页进入设备管理。

---

## 📡 LSL 连接

### 前置条件
- 安装 `pylsl`: `pip install pylsl`
- 设备运行LSL服务（如 OpenBCI GUI）

### 连接步骤
1. 点击 **LSL** 标签
2. 输入流名称（如：`OpenBCI_EEG`）
3. 选择流类型（默认：`EEG`）
4. 点击 **扫描LSL设备**
5. 选择设备
6. 点击 **连接设备**

### 测试 LSL 连接

```bash
cd python_backend
python test_device_connection.py
```

### 常见问题

**Q: 扫描不到设备？**
- 确保设备和电脑在同一网络
- 检查防火墙设置
- 确保LSL服务正在运行

**Q: 支持哪些设备？**
- OpenBCI Cyton/Daisy
- Muse EEG
- Emotiv EPOC
- 所有支持LSL的设备

---

## 🔌 串口连接

### 前置条件
- 安装 `pyserial`: `pip install pyserial`
- 安装USB驱动（FTDI/CH340等）

### 连接步骤
1. 点击 **串口** 标签
2. 点击 **扫描串口**
3. 选择串口（如：`COM3`）
4. 选择波特率（默认：`115200`）
5. 点击 **连接设备**

### 数据格式

串口数据应为CSV格式，每行8个通道值：
```
ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8
```

示例：
```
123.45,234.56,345.67,456.78,567.89,678.90,789.01,890.12
```

### 常见问题

**Q: 串口被占用？**
- 关闭其他串口程序（Arduino IDE、串口助手等）
- 重新插拔USB设备

**Q: 找不到串口？**
- 检查设备管理器
- 安装驱动程序
- 尝试其他USB口

---

## 📶 WiFi 连接

### 前置条件
- 设备和电脑在同一网络
- 知道设备IP和端口

### 连接步骤
1. 点击 **WiFi** 标签
2. 输入IP地址（如：`192.168.4.1`）
3. 输入端口（如：`12345`）
4. 选择协议（TCP/UDP）
5. 点击 **测试连接**（可选）
6. 点击 **连接设备**

### 数据格式

支持两种格式：

**JSON格式**（推荐）：
```json
{"channels": [ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8]}
```

**CSV格式**：
```
ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8
```

### 常见问题

**Q: 连接超时？**
- 检查IP地址是否正确
- 检查端口是否正确
- 确保设备在线
- 检查防火墙

**Q: TCP vs UDP？**
- TCP: 可靠连接，适合稳定网络
- UDP: 低延迟，适合实时数据

---

## 🔧 API 接口

### 扫描设备

**LSL扫描**
```
GET /api/devices/scan/lsl
```

**串口扫描**
```
GET /api/devices/scan/serial
```

### 连接设备

**LSL连接**
```
POST /api/devices/connect/lsl
Body: {
  "stream_name": "OpenBCI_EEG",
  "stream_type": "EEG"
}
```

**串口连接**
```
POST /api/devices/connect/serial
Body: {
  "port": "COM3",
  "baudrate": 115200
}
```

**WiFi连接**
```
POST /api/devices/connect/wifi
Body: {
  "ip": "192.168.4.1",
  "port": 12345,
  "protocol": "tcp"
}
```

### 断开设备

```
POST /api/devices/disconnect
```

### 获取状态

```
GET /api/devices/status
```

### WebSocket 实时数据流

```
WS /api/devices/stream
```

消息格式：
```json
{
  "type": "data",
  "data": [[ch1, ch2, ..., ch8], ...],
  "timestamp": 1234567890.123,
  "sampling_rate": 250,
  "channel_count": 8
}
```

---

## 📊 实时数据显示

连接成功后，界面将显示：

### 连接状态
- 设备类型
- 采样率
- 数据包计数

### 8通道显示
- PO7, PO3, O1, POz, Oz, PO4, O2, PO8
- 实时数值（μV）
- 通道状态指示

### 信号波形
- 8通道实时波形
- 5秒时间窗口
- 颜色编码

---

## 🧪 测试设备连接

### 方法1: Python测试脚本

```bash
cd python_backend
python test_device_connection.py
```

### 方法2: API文档测试

1. 启动后端服务
2. 访问 `http://localhost:8000/docs`
3. 测试各个API接口

### 方法3: 前端界面测试

1. 打开 `device-manager.html`
2. 按照界面提示操作
3. 查看实时数据

---

## 🔍 故障排查

### 后端无法启动

**检查Python版本**
```bash
python --version  # 需要 3.8+
```

**安装依赖**
```bash
pip install -r requirements.txt
```

**检查端口占用**
```bash
netstat -ano | findstr :8000
```

### 前端无法连接后端

**检查CORS设置**
- 确保后端允许前端域名
- 检查 `app/core/config.py` 中的 `CORS_ORIGINS`

**检查网络**
- 确保后端服务正在运行
- 尝试访问 `http://localhost:8000/health`

### 设备连接失败

**LSL**
- 检查 pylsl 是否安装
- 确保LSL服务运行
- 检查防火墙

**串口**
- 检查 pyserial 是否安装
- 确保驱动已安装
- 检查串口未被占用

**WiFi**
- 检查网络连接
- 确认IP和端口
- 测试连接

---

## 📝 开发说明

### 添加新的设备类型

1. 在 `device_manager.py` 中添加连接方法
2. 在 `devices.py` 中添加API路由
3. 在前端添加UI和连接逻辑

### 自定义数据格式

修改 `device_manager.py` 中的数据读取方法：
- `read_lsl_data()`
- `read_serial_data()`
- `read_wifi_data()`

### WebSocket 优化

调整 `devices.py` 中的数据发送频率：
```python
data = device_manager.read_data(duration=0.1)  # 100ms
await asyncio.sleep(0.05)  # 50ms延迟
```

---

## 📚 参考资料

- [LSL 文档](https://labstreaminglayer.readthedocs.io/)
- [PySerial 文档](https://pyserial.readthedocs.io/)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [WebSocket 文档](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

## 🎉 下一步

设备连接功能已完成！现在可以：

1. **测试实际设备** - 连接你的EEG设备
2. **采集数据** - 记录实时脑电信号
3. **SSVEP识别** - 实现FBCCA算法
4. **信号分析** - 频谱分析、质量监控

---

**版本**: v1.0  
**更新日期**: 2026-02-13  
**作者**: SSVEP Platform Team

# 设备连接功能 - 实机测试指南

## ✅ 已完成的工作

### 后端实现
- ✅ 设备管理器 (`device_manager.py`)
  - LSL连接和数据读取
  - 串口连接和数据读取
  - WiFi连接和数据读取
  - 统一的设备管理接口

- ✅ API路由 (`devices.py`)
  - `/api/devices/scan/lsl` - LSL设备扫描
  - `/api/devices/scan/serial` - 串口扫描
  - `/api/devices/connect/lsl` - LSL连接
  - `/api/devices/connect/serial` - 串口连接
  - `/api/devices/connect/wifi` - WiFi连接
  - `/api/devices/disconnect` - 断开连接
  - `/api/devices/status` - 获取状态
  - `/api/devices/stream` - WebSocket实时数据流

### 前端实现
- ✅ 更新 `device-manager.js`
  - 连接到后端API
  - LSL/串口/WiFi扫描和连接
  - WebSocket实时数据接收
  - 实时波形绘制
  - 8通道数据显示

### 依赖安装
- ✅ `pylsl` - LSL支持
- ✅ `pyserial` - 串口支持
- ✅ `fastapi` - Web框架
- ✅ `websockets` - WebSocket支持

---

## 🚀 测试步骤

### 1. 启动后端服务

后端服务应该已经启动，如果没有，请运行：

```bash
cd python_backend
start_backend.bat
```

验证服务运行：
- 访问 http://localhost:8000
- 访问 http://localhost:8000/docs （API文档）
- 访问 http://localhost:8000/health （健康检查）

### 2. 打开设备管理页面

在浏览器中打开：
```
file:///d:/Projects/SSVEP_PLAT/web_frontend/device-manager.html
```

或从主页进入：
```
file:///d:/Projects/SSVEP_PLAT/web_frontend/index.html
```
点击"设备管理" → "连接设备"

### 3. 测试 LSL 连接

#### 准备工作
如果你有 OpenBCI 或其他支持 LSL 的设备：

1. **安装 OpenBCI GUI**（如果还没有）
   - 下载：https://openbci.com/downloads
   - 启动 OpenBCI GUI
   - 连接你的设备
   - 开始数据流

2. **或使用 LSL 测试工具**
   ```bash
   pip install pylsl
   # 运行 LSL 示例程序
   ```

#### 测试步骤
1. 在设备管理页面点击 **LSL** 标签
2. 输入流名称（如：`OpenBCI_EEG`）
3. 点击 **扫描LSL设备**
4. 如果找到设备，点击设备卡片选择
5. 点击 **连接设备**
6. 查看实时数据显示

#### 预期结果
- ✅ 扫描到设备列表
- ✅ 连接成功提示
- ✅ 显示8通道实时数值
- ✅ 显示实时波形
- ✅ 数据包计数增加

### 4. 测试串口连接

#### 准备工作
如果你有串口设备（如 OpenBCI Cyton）：

1. 连接设备到USB口
2. 确保驱动已安装
3. 关闭其他占用串口的程序

#### 测试步骤
1. 在设备管理页面点击 **串口** 标签
2. 点击 **扫描串口**
3. 查看找到的串口列表
4. 选择正确的串口（如：COM3）
5. 选择波特率（通常是 115200）
6. 点击 **连接设备**
7. 查看实时数据显示

#### 预期结果
- ✅ 扫描到串口列表
- ✅ 连接成功提示
- ✅ 显示实时数据

### 5. 测试 WiFi 连接

#### 准备工作
如果你有WiFi设备（如 OpenBCI WiFi Shield）：

1. 确保设备和电脑在同一网络
2. 记录设备IP地址和端口

#### 测试步骤
1. 在设备管理页面点击 **WiFi** 标签
2. 输入IP地址（如：192.168.4.1）
3. 输入端口（如：12345）
4. 选择协议（TCP或UDP）
5. 点击 **测试连接**（可选）
6. 点击 **连接设备**
7. 查看实时数据显示

#### 预期结果
- ✅ 测试连接成功
- ✅ 连接成功提示
- ✅ 显示实时数据

---

## 🧪 无设备测试

如果你暂时没有实际设备，可以：

### 1. 测试API接口

访问 http://localhost:8000/docs

测试以下接口：
- `GET /api/devices/scan/lsl` - 查看LSL扫描（可能为空）
- `GET /api/devices/scan/serial` - 查看串口列表
- `GET /api/devices/status` - 查看设备状态

### 2. 使用模拟数据

前端会自动回退到模拟数据模式：
- 如果WebSocket连接失败
- 如果没有实际设备连接
- 仍然可以看到界面和数据流动画

### 3. 运行Python测试脚本

```bash
cd python_backend
python test_device_connection.py
```

这会测试：
- LSL设备扫描
- 串口设备扫描
- 显示可用设备列表

---

## 📊 验证清单

### 后端服务
- [ ] 后端服务成功启动
- [ ] 访问 http://localhost:8000 显示欢迎信息
- [ ] 访问 http://localhost:8000/docs 显示API文档
- [ ] 访问 http://localhost:8000/health 返回 healthy

### LSL功能
- [ ] 扫描LSL设备（有设备时）
- [ ] 连接LSL设备
- [ ] 接收实时数据
- [ ] WebSocket数据流正常

### 串口功能
- [ ] 扫描串口列表
- [ ] 显示串口信息
- [ ] 连接串口设备（有设备时）
- [ ] 接收串口数据

### WiFi功能
- [ ] 测试WiFi连接
- [ ] 连接WiFi设备（有设备时）
- [ ] 接收网络数据

### 前端界面
- [ ] 设备管理页面正常显示
- [ ] 标签切换正常
- [ ] 扫描按钮工作
- [ ] 连接按钮工作
- [ ] 实时数据显示正常
- [ ] 波形绘制正常
- [ ] 断开连接正常

---

## 🐛 常见问题

### 后端启动失败

**问题**: 依赖未安装
```bash
pip install -r requirements.txt
```

**问题**: 端口被占用
```bash
# 查找占用8000端口的进程
netstat -ano | findstr :8000
# 结束进程
taskkill /PID <进程ID> /F
```

### 前端无法连接后端

**问题**: CORS错误
- 检查后端CORS配置
- 确保允许 `file://` 协议

**问题**: 后端未启动
- 检查后端服务是否运行
- 查看后端控制台错误信息

### LSL扫描不到设备

**问题**: pylsl未安装
```bash
pip install pylsl
```

**问题**: 设备未运行LSL服务
- 启动 OpenBCI GUI
- 或运行其他LSL源程序

**问题**: 防火墙阻止
- 允许Python通过防火墙
- 允许LSL端口（通常是动态端口）

### 串口连接失败

**问题**: 串口被占用
- 关闭Arduino IDE
- 关闭串口助手
- 关闭其他串口程序

**问题**: 驱动未安装
- 安装FTDI驱动
- 安装CH340驱动
- 检查设备管理器

### WebSocket连接失败

**问题**: 后端不支持WebSocket
- 确保使用 `uvicorn` 启动
- 检查 `websockets` 包已安装

**问题**: 浏览器不支持
- 使用现代浏览器（Chrome/Firefox/Edge）
- 检查浏览器控制台错误

---

## 📝 数据格式说明

### LSL数据
- 自动处理，无需配置
- 支持任意通道数
- 自动获取采样率

### 串口数据
期望格式（CSV）：
```
ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8
```

示例：
```
123.45,234.56,345.67,456.78,567.89,678.90,789.01,890.12
```

### WiFi数据
支持两种格式：

**JSON格式**（推荐）：
```json
{"channels": [ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8]}
```

**CSV格式**：
```
ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8
```

---

## 🎯 下一步

设备连接功能已经完成！现在你可以：

1. **连接实际设备** - 测试LSL/串口/WiFi连接
2. **采集数据** - 记录实时脑电信号
3. **实现FBCCA** - 添加SSVEP识别算法
4. **信号分析** - 频谱分析、质量监控
5. **完整测试** - 运行SSVEP准确度测试

---

## 📚 相关文档

- `DEVICE_CONNECTION_GUIDE.md` - 详细使用指南
- `WEEK7-8_SUMMARY.md` - Week 7-8 开发总结
- `python_backend/app/services/device_manager.py` - 设备管理器源码
- `python_backend/app/api/devices.py` - API路由源码
- `web_frontend/device-manager.js` - 前端逻辑源码

---

**准备好了吗？开始测试你的设备连接吧！** 🚀

如果遇到问题，请查看：
1. 后端控制台输出
2. 浏览器控制台（F12）
3. API文档 (http://localhost:8000/docs)

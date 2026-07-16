# 设备管理功能改进

## 📋 改进内容

### 1. ✅ 添加 BrainFlow 支持
- 支持 OpenBCI Cyton/Daisy/Ganglion
- 支持 Synthetic Board（测试用）
- 自动启动设备数据流
- 自动获取采样率和通道信息

### 2. ✅ 信号预处理
- **去趋势处理**：移除信号漂移
- **带通滤波**：5-50 Hz，去除噪声
- **实时处理**：自动应用于所有数据流
- **可配置**：可以启用/禁用信号处理

### 3. 🚧 波形显示（前端待实现）
- 实时波形绘制
- 8 通道同时显示
- 滚动显示最近 5 秒数据

### 4. 🚧 全局设备状态（待实现）
- 跨页面保持连接
- 全局状态管理
- 自动重连机制

### 5. 🚧 设备状态监控页面（待实现）
- 实时连接状态
- 信号质量指标
- 数据统计信息

---

## 🔧 技术实现

### 信号处理模块 (`signal_processor.py`)

```python
class SignalProcessor:
    - detrend_signal()      # 去趋势
    - bandpass_filter()     # 5-50Hz 带通滤波
    - process()             # 完整处理流程
    - calculate_psd()       # 功率谱密度
    - extract_frequency_power()  # 提取特定频率功率
```

### 设备管理器更新

**新增功能**：
- `list_brainflow_boards()` - 列出支持的设备
- `connect_brainflow()` - 连接 BrainFlow 设备
- `read_brainflow_data()` - 读取 BrainFlow 数据
- 自动信号处理集成

**改进**：
- `read_data()` - 自动应用信号处理
- `disconnect()` - 支持 BrainFlow 断开

### API 路由更新

**新增接口**：
- `GET /api/devices/boards/brainflow` - 获取 BrainFlow 设备列表
- `POST /api/devices/connect/brainflow` - 连接 BrainFlow 设备

---

## 📊 使用示例

### 1. 连接 BrainFlow 设备

```python
# 获取设备列表
GET /api/devices/boards/brainflow

# 连接 OpenBCI Cyton
POST /api/devices/connect/brainflow
{
    "board_id": 0,  # CYTON_BOARD
    "serial_port": "COM5"
}
```

### 2. 读取处理后的数据

```python
# 数据自动经过：
# 1. 去趋势处理
# 2. 5-50Hz 带通滤波
# 3. 返回处理后的数据

GET /api/devices/data?duration=1.0
```

### 3. WebSocket 实时数据流

```javascript
// 连接 WebSocket
ws = new WebSocket('ws://localhost:8000/api/devices/stream');

// 接收处理后的数据
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // data.data 已经过信号处理
};
```

---

## 🎯 下一步工作

### 前端改进

1. **添加 BrainFlow 连接选项**
   - 在设备管理页面添加 BrainFlow 标签
   - 显示支持的设备列表
   - 串口选择和连接

2. **改进波形显示**
   - 使用 Canvas 绘制实时波形
   - 显示处理前后对比
   - 添加频谱显示

3. **全局状态管理**
   - 使用 localStorage 保存连接状态
   - 跨页面共享设备连接
   - 自动恢复连接

4. **设备状态页面**
   - 实时连接状态
   - 信号质量监控
   - 数据统计图表

---

## 🔍 测试步骤

### 测试 BrainFlow 连接

1. **获取设备列表**
```bash
curl http://localhost:8000/api/devices/boards/brainflow
```

2. **连接 Synthetic Board（测试）**
```bash
curl -X POST http://localhost:8000/api/devices/connect/brainflow \
  -H "Content-Type: application/json" \
  -d '{"board_id": -1}'
```

3. **连接 OpenBCI Cyton**
```bash
curl -X POST http://localhost:8000/api/devices/connect/brainflow \
  -H "Content-Type: application/json" \
  -d '{"board_id": 0, "serial_port": "COM5"}'
```

4. **读取数据**
```bash
curl http://localhost:8000/api/devices/data?duration=1.0
```

### 测试信号处理

1. **连接设备**（任意方式）
2. **读取数据** - 自动应用信号处理
3. **查看数据** - 应该看到去趋势和滤波后的数据

---

## 📝 配置说明

### 信号处理参数

在 `signal_processor.py` 中可以调整：

```python
self.lowcut = 5.0      # 低频截止 (Hz)
self.highcut = 50.0    # 高频截止 (Hz)
self.filter_order = 4  # 滤波器阶数
```

### 启用/禁用信号处理

```python
# 在设备管理器中
device_manager.enable_signal_processing = True   # 启用
device_manager.enable_signal_processing = False  # 禁用
```

---

## 🐛 已知问题

1. **滤波器需要足够的数据**
   - 至少需要 3 * filter_order 个样本
   - 数据太少时会跳过滤波

2. **实时处理延迟**
   - 滤波会引入轻微延迟
   - 对于实时应用可以调整参数

3. **BrainFlow 依赖**
   - 需要安装 brainflow 包
   - 某些设备需要特定驱动

---

## 📚 参考资料

- [BrainFlow 文档](https://brainflow.readthedocs.io/)
- [SciPy 信号处理](https://docs.scipy.org/doc/scipy/reference/signal.html)
- [OpenBCI 文档](https://docs.openbci.com/)

---

**版本**: v2.0  
**更新日期**: 2026-02-13  
**状态**: 后端完成，前端待实现

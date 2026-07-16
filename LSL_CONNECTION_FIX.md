# LSL 连接问题修复指南

## 🐛 问题描述
前端显示 "连接失败、请确保设备正在运行LSL服务"，但设备实际上正在运行。

## ✅ 问题已解决

### 根本原因
1. **后端服务停止** - 后端进程意外终止
2. **设备名称不匹配** - 前端默认填写 `OpenBCI_EEG`，但实际设备名称是 `obci_eeg1`

### 已修复内容
1. ✅ 重新启动后端服务
2. ✅ 确认 LSL 设备可以被检测到
3. ✅ 更新前端代码，扫描后自动填充设备名称
4. ✅ 移除默认的错误设备名称

---

## 🚀 现在如何连接

### 方法 1: 使用扫描功能（推荐）

1. 刷新页面 http://localhost:8080/device-manager.html
2. 点击 "LSL" 标签
3. 点击 "🔍 扫描LSL设备" 按钮
4. 你应该看到：
   ```
   obci_eeg1
   类型: EEG | 通道: 8 | 采样率: 250 Hz
   ```
5. **点击这个设备卡片** - 会自动填充设备名称
6. 点击 "🔗 连接设备"
7. 成功！

### 方法 2: 手动输入

1. 在 "流名称" 输入框输入: `obci_eeg1`
2. 流类型选择: `EEG`
3. 点击 "🔗 连接设备"

---

## 🔍 诊断信息

### 你的 LSL 设备信息
```
设备名称: obci_eeg1
设备类型: EEG
通道数: 8
采样率: 250 Hz
主机名: DESKTOP-GIMV481
源 ID: openbcigui
```

### 后端状态
```
✅ 后端服务: 运行中 (http://localhost:8000)
✅ LSL 扫描: 正常
✅ 设备连接: 已连接
```

---

## 🛠️ 如果还有问题

### 检查清单

1. **刷新浏览器页面**
   - 按 Ctrl+F5 强制刷新
   - 清除浏览器缓存

2. **检查后端服务**
   ```bash
   curl http://localhost:8000/health
   ```
   应该返回: `{"status":"healthy"}`

3. **检查设备状态**
   ```bash
   curl http://localhost:8000/api/devices/status
   ```

4. **重新扫描 LSL 设备**
   ```bash
   cd d:\Projects\SSVEP_PLAT\python_backend
   python test_lsl_connection.py
   ```

5. **查看浏览器控制台**
   - 按 F12 打开开发者工具
   - 查看 Console 标签是否有错误
   - 查看 Network 标签检查 API 请求

---

## 📊 测试连接

### 使用命令行测试（验证后端正常）

```powershell
# 1. 检查健康状态
curl http://localhost:8000/health

# 2. 扫描 LSL 设备
curl http://localhost:8000/api/devices/scan/lsl

# 3. 连接设备（PowerShell）
$body = @{stream_name='obci_eeg1'; stream_type='EEG'} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:8000/api/devices/connect/lsl' -Method Post -Body $body -ContentType 'application/json'

# 4. 检查连接状态
curl http://localhost:8000/api/devices/status
```

---

## 🎯 预防措施

### 保持后端运行
后端服务可能因为以下原因停止：
- 手动关闭了命令行窗口
- 系统休眠/重启
- Python 进程崩溃

**建议**：
1. 不要关闭后端的命令行窗口
2. 如果需要重启，使用启动脚本：
   ```bash
   cd d:\Projects\SSVEP_PLAT\python_backend
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

### 使用正确的设备名称
- 不同的 LSL 软件使用不同的设备名称
- OpenBCI GUI 默认使用 `obci_eeg1`
- 其他软件可能使用不同名称
- **始终先扫描，再连接**

---

## 📝 常见 LSL 设备名称

| 软件/设备 | 默认流名称 |
|-----------|-----------|
| OpenBCI GUI | `obci_eeg1` |
| Lab Recorder | `EEG` |
| BioSemi | `BioSemi` |
| ActiChamp | `ActiChamp` |
| g.tec | `g.USBamp` |

---

## ✅ 验证成功

连接成功后，你应该看到：
- ✅ 连接状态指示器变绿
- ✅ 显示 "已连接"
- ✅ 采样率显示 "250 Hz"
- ✅ 8 个通道显示实时电压值
- ✅ 波形图显示实时信号
- ✅ 数据包计数持续增加

---

**问题已解决！现在可以正常连接 LSL 设备了。**

如果还有其他问题，请提供：
1. 浏览器控制台的错误信息
2. 后端命令行窗口的输出
3. 具体的操作步骤

# 测试新功能指南

## 更新内容

### 1. 通道电压值刷新优化
- 通道状态卡片中的电压值现在每0.5秒更新一次（之前是实时更新，太快了）
- 波形显示仍然保持实时更新

### 2. 波形自动量程显示
- 每个通道独立计算和显示量程
- 可用量程：10μV、20μV、50μV、100μV、200μV、1000μV、5000μV
- 基于过去1秒数据自动选择合适量程
- 波形显示高度增加到通道高度的45%（原40%）
- 在波形右侧显示量程上下限（如 +20μV / -20μV）

## 测试步骤

### 步骤1：清除浏览器缓存
**重要：必须清除缓存才能看到新功能！**

在浏览器中按 `Ctrl + Shift + Delete`，选择：
- 缓存的图片和文件
- 时间范围：全部时间
- 点击"清除数据"

或者使用硬刷新：
- 在设备管理页面按 `Ctrl + F5` 强制刷新

### 步骤2：访问设备管理页面
```
http://localhost:8080/device-manager.html
```

### 步骤3：连接设备
1. 如果弹出"恢复连接"对话框，点击"取消"清除旧状态
2. 切换到"BrainFlow"标签
3. 选择 COM5 端口
4. 点击"连接设备"

### 步骤4：验证新功能

#### 验证1：通道电压值刷新频率
观察通道状态卡片中的电压值：
- ✅ 应该每0.5秒更新一次（不再快速闪烁）
- ✅ 数值变化应该平滑可读

#### 验证2：波形自动量程
观察信号波形显示：
- ✅ 每个通道右侧应该显示量程标签（如 +20μV / -20μV）
- ✅ 小幅值信号的波形应该更清晰可见（高度增加）
- ✅ 量程会根据信号幅度自动调整
- ✅ 不同通道可能显示不同的量程

### 预期效果对比

**之前：**
- 通道电压值快速闪烁，难以阅读
- 小幅值波形几乎看不见
- 所有通道使用相同的固定量程
- 没有量程标签

**现在：**
- 通道电压值每0.5秒更新，清晰可读
- 小幅值波形清晰可见（高度增加45%）
- 每个通道独立自动调整量程
- 右侧显示当前量程范围

## 调试提示

### 如果看不到新功能：

1. **确认缓存已清除**
   - 按 `F12` 打开开发者工具
   - 切换到 Network 标签
   - 勾选 "Disable cache"
   - 刷新页面

2. **检查JS文件版本**
   - 在开发者工具的 Network 标签中
   - 查找 `waveform-display.js?v=2.1`
   - 确认请求的是新版本（带 v=2.1 参数）

3. **查看控制台错误**
   - 按 `F12` 打开开发者工具
   - 切换到 Console 标签
   - 查看是否有JavaScript错误

4. **验证代码更新**
   - 在控制台输入：
   ```javascript
   console.log(waveformDisplay.channelScales);
   console.log(waveformDisplay.availableScales);
   ```
   - 应该看到数组输出，说明新代码已加载

## 技术细节

### 通道值更新节流
```javascript
let lastChannelUpdateTime = 0;
const CHANNEL_UPDATE_INTERVAL = 500; // 0.5秒

if (currentTime - lastChannelUpdateTime >= CHANNEL_UPDATE_INTERVAL) {
    // 更新通道值
    lastChannelUpdateTime = currentTime;
}
```

### 自动量程算法
```javascript
// 使用最近1秒数据
const recentSamples = samplingRate; // 250个样本
const min = Math.min(...channelData);
const max = Math.max(...channelData);
const range = Math.max(Math.abs(min), Math.abs(max));

// 选择合适量程（留20%余量）
const targetScale = range * 1.2;

// 从 [10, 20, 50, 100, 200, 1000, 5000] 中选择
```

### 波形绘制增强
```javascript
// 使用45%的通道高度（原40%）
const yScaleFactor = (this.channelHeight * 0.45) / scale;

// 限制值在量程范围内
const clampedValue = Math.max(-scale, Math.min(scale, value));
const y = centerY - clampedValue * yScaleFactor;
```

## 下一步优化建议

1. 添加手动量程调整按钮
2. 添加波形滚动速度控制
3. 添加通道显示/隐藏切换
4. 添加波形导出功能
5. 添加信号质量指示器

---

**更新时间：** 2026-02-21
**版本：** v2.1

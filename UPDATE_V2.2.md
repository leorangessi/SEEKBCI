# 更新说明 v2.2

## 更新时间
2026-02-21

## 更新内容

### 1. 波形显示优化 ✅

**问题：** 信号波形中每个通道的幅值标签都挤在右下角

**解决方案：**
- 最大幅值（+XXμV）显示在通道顶部
- 最小幅值（-XXμV）显示在通道底部
- 使用 `textBaseline` 属性精确控制文本对齐

**修改文件：**
- `web_frontend/js/waveform-display.js`

**效果：**
```
通道1 ┌─────────────────────┐ +20μV
      │   ～～～～～～～～   │
      │                     │
      └─────────────────────┘ -20μV
```

---

### 2. 项目编辑器 - 删除页面功能 ✅

**问题：** 项目编辑器只能新增页面，无法删除

**解决方案：**
- 在每个页面标签上添加删除按钮（×）
- 点击删除按钮弹出确认对话框
- 至少保留一个页面（防止全部删除）
- 删除当前页面时自动切换到第一页
- 删除后自动保存到 localStorage

**修改文件：**
- `web_frontend/editor.js` - 添加 `deletePage()` 函数
- `web_frontend/editor.html` - 添加删除按钮样式

**使用方法：**
1. 鼠标悬停在页面标签上
2. 点击右侧的 × 按钮
3. 确认删除

---

### 3. 统一术语：方块 → 对象 ✅

**问题：** 所有形状（矩形、圆形、三角形）都显示为"方块X"

**解决方案：**
- 将所有"方块"改名为"对象"
- 更新所有相关文本和提示
- 新创建的对象显示为"对象1"、"对象2"等

**修改文件：**
- `web_frontend/editor.js` - 所有函数注释和变量
- `web_frontend/editor.html` - 所有UI文本

**修改位置：**
- 工具栏标题：📐 添加对象
- 属性面板：⚙️ 对象属性
- 删除按钮：🗑️ 删除对象
- 提示文本：点击画布中的对象
- 使用说明：添加对象、拖拽对象、点击对象
- 确认对话框：确定要删除这个对象吗？
- 清空画布：所有对象将被删除
- 预览提示：请先添加对象再预览

---

### 4. 对象点击触发功能 ✅

**问题：** 刺激预览时无法点击对象触发动作

**解决方案：**
- 为所有对象添加点击事件监听
- 点击时执行对象配置的动作
- 添加视觉反馈（缩放动画）
- 支持三种动作类型：
  1. **Python代码** - 显示代码内容（需后端支持）
  2. **键盘快捷键** - 显示快捷键（需系统权限）
  3. **页面跳转** - 自动切换到目标页面

**修改文件：**
- `web_frontend/stimulus.js` - 添加点击处理逻辑
- `web_frontend/stimulus.html` - 添加悬停和点击样式

**新增函数：**
```javascript
handleBlockClick(block)      // 处理对象点击
executeAction(action)         // 执行动作
switchToPage(pageIndex)       // 切换页面
```

**视觉效果：**
- 鼠标悬停：亮度增加 20%
- 点击时：缩放到 95%
- 点击后：恢复到 100%

**页面跳转功能：**
- 自动停止当前刺激
- 加载目标页面的对象
- 如果之前在运行，0.5秒后自动开始新页面

---

## 测试步骤

### 测试1：波形幅值显示

1. 访问 `http://localhost:8080/device-manager.html`
2. 按 `Ctrl + F5` 强制刷新（清除缓存）
3. 连接设备并开始采集
4. 观察波形显示区域
5. ✅ 每个通道顶部显示 +XXμV
6. ✅ 每个通道底部显示 -XXμV

### 测试2：删除页面

1. 访问 `http://localhost:8080/editor.html`
2. 点击"+ 添加页面"创建多个页面
3. 鼠标悬停在页面标签上
4. 点击 × 按钮
5. ✅ 弹出确认对话框
6. ✅ 确认后页面被删除
7. ✅ 最后一个页面无法删除

### 测试3：对象命名

1. 在编辑器中点击"矩形"、"圆形"、"三角形"
2. ✅ 新对象显示为"对象1"、"对象2"等
3. ✅ 属性面板标题为"对象属性"
4. ✅ 删除按钮显示"删除对象"

### 测试4：对象点击触发

1. 在编辑器中创建对象
2. 选择对象，设置动作类型为"页面跳转"
3. 选择目标页面
4. 点击"预览刺激"
5. 点击"开始刺激"
6. 点击对象
7. ✅ 对象有缩放动画
8. ✅ 自动跳转到目标页面
9. ✅ 新页面自动开始刺激

**测试其他动作类型：**
- Python代码：显示代码内容弹窗
- 键盘快捷键：显示快捷键弹窗

---

## 技术细节

### 波形幅值标签定位

```javascript
// 顶部标签
this.ctx.textBaseline = 'top';
this.ctx.fillText(`+${scale}μV`, this.width - 5, topY);

// 底部标签
this.ctx.textBaseline = 'bottom';
this.ctx.fillText(`-${scale}μV`, this.width - 5, bottomY + 12);
```

### 删除页面逻辑

```javascript
// 防止删除最后一个页面
if (pages.length <= 1) {
    alert('至少需要保留一个页面！');
    return;
}

// 删除当前页面时切换到第一页
if (pageIndex === currentPage) {
    currentPage = 0;
    blocks = pages[0].blocks || [];
    // 重新渲染
}
```

### 对象点击处理

```javascript
// 添加点击事件
blockEl.addEventListener('click', () => {
    handleBlockClick(block);
});

// 视觉反馈
blockEl.style.transform = 'scale(0.95)';
setTimeout(() => {
    blockEl.style.transform = 'scale(1)';
}, 100);
```

### 页面跳转逻辑

```javascript
// 停止当前刺激
const wasRunning = isRunning;
if (isRunning) stopStimulus();

// 切换页面
currentPage = pageIndex;
createStimulusBlocks(blocks);

// 自动恢复运行
if (wasRunning) {
    setTimeout(() => startStimulus(), 500);
}
```

---

## 已知问题

### 1. Python代码执行
- 当前只显示代码内容
- 实际执行需要后端API支持
- 计划在后续版本实现

### 2. 键盘快捷键触发
- 当前只显示快捷键
- 实际触发需要系统权限
- 可能需要浏览器扩展支持

### 3. 浏览器缓存
- 如果看不到更新，请按 `Ctrl + F5` 强制刷新
- 或在开发者工具中勾选"Disable cache"

---

## 下一步计划

### 短期优化
1. 添加对象复制/粘贴功能
2. 添加对象对齐辅助线
3. 添加撤销/重做功能
4. 添加键盘快捷键（Ctrl+C/V/Z）

### 中期功能
1. 实现Python代码后端执行
2. 添加对象分组功能
3. 添加动画效果配置
4. 添加对象锁定功能

### 长期规划
1. 多人协作编辑
2. 云端项目存储
3. 项目模板库
4. 社区分享功能

---

## 文件清单

### 修改的文件
- `web_frontend/js/waveform-display.js` - 波形幅值标签位置
- `web_frontend/editor.js` - 删除页面、对象命名
- `web_frontend/editor.html` - 删除按钮样式、对象命名
- `web_frontend/stimulus.js` - 对象点击触发
- `web_frontend/stimulus.html` - 点击样式
- `web_frontend/device-manager.html` - 版本号更新

### 新增的文件
- `UPDATE_V2.2.md` - 本文档

---

**版本：** v2.2  
**更新日期：** 2026-02-21  
**状态：** ✅ 已完成并测试

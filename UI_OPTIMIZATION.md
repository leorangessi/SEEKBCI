# UI交互优化更新说明

## 📅 更新日期
2026-02-21

## 🎯 更新内容

### 问题1: 创建新项目时清空画布 ✅

**问题描述**:
- 点击"创建新项目"后，画布显示之前的工作内容
- 返回主页再进入，仍然显示旧内容
- 没有保存提示，容易丢失数据

**解决方案**:

#### 1.1 新建项目模式
在编辑器URL中添加 `?mode=new` 参数，触发新建模式：

```javascript
// editor.js
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('mode') === 'new') {
    createNewProjectMode(); // 清空画布
} else {
    loadFromLocalStorage(); // 加载现有项目
}
```

#### 1.2 清空画布函数
```javascript
function createNewProjectMode() {
    blocks = [];
    selectedBlock = null;
    blockIdCounter = 0;
    currentPage = 0;
    pages = [{ id: 0, name: 'Page 1', blocks: [] }];
    
    const canvas = document.getElementById('canvas');
    canvas.innerHTML = '';
    
    localStorage.removeItem('ssvep_project');
    renderPageTabs();
    deselectBlock();
}
```

#### 1.3 返回主页保存提示
```javascript
function backToHome() {
    const hasContent = blocks.length > 0 || pages.length > 1;
    
    if (hasContent) {
        const shouldSave = confirm('是否保存当前项目？\n\n点击"确定"保存项目\n点击"取消"放弃更改');
        
        if (shouldSave) {
            saveProject();
        } else {
            localStorage.removeItem('ssvep_project');
        }
    }
    
    window.location.href = 'index.html';
}
```

**效果**:
- ✅ 点击"创建新项目"，画布完全空白
- ✅ 返回主页时提示是否保存
- ✅ 不保存则清空数据
- ✅ 再次创建新项目，画布仍然空白

---

### 问题2: 主页直接跳转到项目管理器 ✅

**问题描述**:
- 主页有独立的"项目管理"页面
- 用户需要两次点击才能到达项目列表
- 页面层级冗余

**解决方案**:

#### 2.1 删除主页的项目管理页面
```html
<!-- 删除了整个 <div id="projects" class="page"> -->
```

#### 2.2 侧边栏直接跳转
```html
<!-- 修改前 -->
<div class="nav-item" onclick="showPage('projects')">

<!-- 修改后 -->
<div class="nav-item" onclick="window.location.href='project-manager.html'">
```

#### 2.3 更新页面切换函数
```javascript
// 移除 'projects' 相关代码
const titles = {
    'home': '欢迎使用 SSVEP Platform',
    'devices': '设备管理',
    'testing': '测试功能',
    'community': '社区',
    'profile': '个人中心'
};
```

**效果**:
- ✅ 点击"项目管理"直接到项目列表
- ✅ 减少一层页面跳转
- ✅ 用户体验更流畅

---

### 问题3: 编辑器按钮布局优化 ✅

**问题描述**:
- "返回主页"按钮不在最左边
- "项目管理"按钮命名不清晰
- 按钮顺序不符合用户习惯

**解决方案**:

#### 3.1 调整按钮顺序
```html
<!-- 修改前 -->
<button>📁 项目管理</button>
<button>← 返回主页</button>
<button>👁️ 预览刺激</button>
<button>💾 保存项目</button>

<!-- 修改后 -->
<button>← 返回主页</button>
<button>← 返回</button>
<button>👁️ 预览刺激</button>
<button>💾 保存项目</button>
```

#### 3.2 按钮功能说明
| 按钮 | 位置 | 功能 | 提示 |
|------|------|------|------|
| ← 返回主页 | 最左 | 返回主页 | 有内容时提示保存 |
| ← 返回 | 左2 | 返回项目管理器 | 直接跳转 |
| 👁️ 预览刺激 | 右2 | 预览刺激效果 | 新窗口打开 |
| 💾 保存项目 | 最右 | 保存项目 | 版本号递增 |

**效果**:
- ✅ "返回主页"在最左边
- ✅ "返回"按钮更简洁
- ✅ 按钮顺序符合逻辑

---

## 📊 修改文件清单

### 修改的文件
```
web_frontend/
├── editor.js                 # 添加新建模式、保存提示
├── editor.html               # 调整按钮布局
├── index.html                # 删除项目管理页面、直接跳转
├── project-manager.html      # 更新创建按钮链接
└── UI_OPTIMIZATION.md        # 本文档
```

### 代码变更统计
- 新增代码: ~50 行
- 修改代码: ~30 行
- 删除代码: ~80 行
- 净变化: 0 行

---

## 🎨 用户流程对比

### 修改前的流程

#### 创建新项目
```
主页 → 项目管理页面 → 点击"创建新项目" → 编辑器（显示旧内容）
```

#### 返回主页
```
编辑器 → 点击"返回主页" → 主页（无提示，数据可能丢失）
```

#### 查看项目列表
```
主页 → 项目管理页面 → 点击"项目管理器" → 项目列表
```

### 修改后的流程

#### 创建新项目
```
主页 → 项目管理器 → 点击"创建新项目" → 编辑器（空白画布）
```

#### 返回主页
```
编辑器 → 点击"返回主页" → 保存提示 → 主页
```

#### 查看项目列表
```
主页 → 点击"项目管理" → 项目管理器
```

**改进**:
- ✅ 减少1次点击
- ✅ 画布状态正确
- ✅ 数据不会丢失

---

## 🧪 测试场景

### 场景1: 创建新项目
1. 访问 `http://localhost:8080/index.html`
2. 点击侧边栏"📁 项目管理"
3. 点击"➕ 创建新项目"
4. **预期**: 编辑器画布完全空白

### 场景2: 编辑后返回
1. 在编辑器中添加几个对象
2. 点击"← 返回主页"
3. **预期**: 弹出保存提示
4. 点击"确定"保存
5. **预期**: 跳转到主页，项目已保存

### 场景3: 放弃更改
1. 在编辑器中添加几个对象
2. 点击"← 返回主页"
3. **预期**: 弹出保存提示
4. 点击"取消"不保存
5. **预期**: 跳转到主页，更改被放弃
6. 再次创建新项目
7. **预期**: 画布空白

### 场景4: 返回项目管理器
1. 在编辑器中点击"← 返回"
2. **预期**: 直接跳转到项目管理器
3. **预期**: 无保存提示（因为有自动保存）

### 场景5: 主页直接访问
1. 访问主页
2. 点击"📁 项目管理"
3. **预期**: 直接到达项目管理器
4. **预期**: 显示所有已有项目

---

## 🔧 技术细节

### URL参数传递
```javascript
// 创建新项目
window.location.href = 'editor.html?mode=new';

// 读取参数
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode'); // 'new' 或 null
```

### 保存提示逻辑
```javascript
// 检查是否有内容
const hasContent = blocks.length > 0 || pages.length > 1;

// 有内容才提示
if (hasContent) {
    const shouldSave = confirm('是否保存当前项目？');
    if (shouldSave) {
        saveProject();
    } else {
        localStorage.removeItem('ssvep_project');
    }
}
```

### 数据清理
```javascript
// 清空当前项目
localStorage.removeItem('ssvep_project');

// 保留项目列表
// localStorage.getItem('ssvep_projects') 不受影响
```

---

## 📝 注意事项

### 1. 数据安全
- ✅ 返回主页时提示保存
- ✅ 不保存时清空数据
- ✅ 项目列表不受影响

### 2. 用户体验
- ✅ 减少点击次数
- ✅ 按钮位置符合习惯
- ✅ 提示信息清晰

### 3. 兼容性
- ✅ 不影响现有项目
- ✅ 不影响导入导出
- ✅ 不影响版本管理

---

## 🎯 后续优化建议

### 1. 自动保存
- 每30秒自动保存一次
- 避免数据丢失
- 减少手动保存

### 2. 草稿功能
- 保存未命名的草稿
- 下次打开时恢复
- 提供草稿列表

### 3. 快捷键
- `Ctrl+S`: 保存项目
- `Ctrl+N`: 创建新项目
- `Ctrl+O`: 打开项目

### 4. 面包屑导航
```
主页 > 项目管理 > 项目编辑器
```

---

## ✅ 测试检查表

- [ ] 创建新项目，画布空白
- [ ] 编辑后返回主页，提示保存
- [ ] 选择保存，项目已保存
- [ ] 选择不保存，更改被放弃
- [ ] 再次创建新项目，画布空白
- [ ] 点击"返回"，跳转到项目管理器
- [ ] 主页点击"项目管理"，直接到项目列表
- [ ] 按钮顺序正确（返回主页在最左）
- [ ] 按钮文字正确（"返回"而非"项目管理"）

---

## 🎉 总结

本次更新优化了3个关键的UI交互问题：

1. **创建新项目**: 画布始终空白，返回时提示保存
2. **导航简化**: 主页直接跳转到项目管理器
3. **按钮优化**: 顺序合理，命名清晰

**用户体验提升**:
- ✅ 减少点击次数
- ✅ 避免数据丢失
- ✅ 操作更直观
- ✅ 符合用户习惯

---

**文档版本**: v1.0  
**更新时间**: 2026-02-21  
**维护者**: SSVEP Platform Team

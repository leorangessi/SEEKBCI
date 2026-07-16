# SSVEP Platform

<div align="center">

![SSVEP Platform](https://img.shields.io/badge/SSVEP-Platform-blue)
![Flutter](https://img.shields.io/badge/Flutter-3.16+-02569B?logo=flutter)
![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python)
![License](https://img.shields.io/badge/License-MIT-green)

**跨平台稳态视觉诱发电位脑机接口开发平台**

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [文档](#-文档) • [贡献](#-贡献)

</div>

---

## 📖 项目简介

SSVEP Platform 是一个强大的跨平台脑机接口开发工具，让用户能够通过可视化界面轻松创建、管理和运行基于稳态视觉诱发电位（SSVEP）的脑机接口应用。

### 什么是SSVEP？

稳态视觉诱发电位（Steady-State Visual Evoked Potential）是一种脑机接口技术，通过检测大脑对特定频率视觉刺激的响应来实现人机交互。用户只需注视不同频率闪烁的方块，系统即可识别用户意图并执行相应操作。

### 应用场景

- 🚁 **无人机控制**：通过脑电波控制无人机飞行
- ♿ **辅助设备**：帮助残障人士控制轮椅、假肢等
- 💻 **计算机交互**：免手操作电脑、打字输入
- 🎮 **游戏娱乐**：脑控游戏、VR交互
- 🏥 **康复训练**：神经反馈训练、认知康复

---

## ✨ 功能特性

### 🎨 可视化项目编辑器
- 拖拽式界面设计
- 支持矩形、圆形、三角形三种刺激形状
- 实时预览刺激效果
- 多页面管理
- 网格对齐与吸附

### 🔧 灵活的动作绑定
- **Python API调用**：集成自定义Python代码（如无人机控制API）
- **键盘快捷键**：模拟键盘操作（如Ctrl+C复制）
- **页面跳转**：创建多级菜单系统

### 📡 多种设备连接方式
- **LSL (Lab Streaming Layer)**：网络数据流
- **串口连接**：支持OpenBCI Cyton等设备
- **WiFi连接**：无线EEG设备

### 🧪 专业测试工具
- **SSVEP准确度测试**：评估识别准确率
- **信号质量监控**：实时波形显示、通道质量检测
- **频谱分析**：FFT频谱图、功率谱密度

### 🌐 社区生态
- 项目分享与下载
- 评论、点赞、收藏
- 用户关注与私信
- 项目分类与搜索

### 📦 项目管理
- 版本控制
- 导出为独立exe/apk
- 项目模板库
- 离线模式支持

---

## 🚀 快速开始

### 环境要求

- **Flutter SDK**: 3.16 或更高版本
- **Python**: 3.9 或更高版本
- **PostgreSQL**: 14 或更高版本（仅服务端）
- **Redis**: 7 或更高版本（仅服务端）

### 安装步骤

#### 1. 克隆仓库

```bash
git clone https://github.com/your-org/ssvep-platform.git
cd ssvep-platform
```

#### 2. 后端设置

```bash
cd python_backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入数据库配置

# 初始化数据库
alembic upgrade head

# 启动后端服务
uvicorn app.main:app --reload
```

#### 3. 前端设置

```bash
cd flutter_app

# 安装依赖
flutter pub get

# 运行应用
# Windows桌面
flutter run -d windows

# Android
flutter run -d android

# macOS
flutter run -d macos

# Linux
flutter run -d linux
```

### Docker部署（推荐）

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

---

## 📚 文档

- [项目计划](./PROJECT_PLAN.md) - 详细的开发路线图和里程碑
- [项目结构](./PROJECT_STRUCTURE.md) - 完整的目录结构和模块说明
- [API文档](./docs/API.md) - RESTful API接口文档
- [用户指南](./docs/USER_GUIDE.md) - 使用教程和最佳实践
- [开发者文档](./docs/DEVELOPER.md) - 开发指南和贡献规范
- [部署文档](./docs/DEPLOYMENT.md) - 生产环境部署指南

---

## 🎯 使用示例

### 创建一个简单的无人机控制项目

1. **打开项目编辑器**
   - 点击"新建项目"
   - 输入项目名称："无人机控制"

2. **添加控制方块**
   - 拖拽方块到画布
   - 设置频率：8 Hz
   - 设置形状：矩形
   - 设置标签："起飞"

3. **绑定动作**
   - 选择动作类型：Python API
   - 输入代码：
     ```python
     tello.takeoff()
     ```

4. **重复步骤2-3**，添加其他控制方块（前进、后退、左转、右转、降落等）

5. **连接设备**
   - 进入"设备管理"
   - 选择连接方式（LSL/串口/WiFi）
   - 点击"连接"

6. **运行项目**
   - 点击"开始"按钮
   - 注视目标方块
   - 系统自动识别并执行动作

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────┐
│         Flutter 前端应用                 │
│  (Windows/Mac/Linux/Android/iOS)        │
└─────────────────────────────────────────┘
              ↕ HTTP/WebSocket
┌─────────────────────────────────────────┐
│       Python FastAPI 后端                │
│  (用户认证/项目管理/社区/信号处理)       │
└─────────────────────────────────────────┘
              ↕
┌─────────────────────────────────────────┐
│    PostgreSQL + Redis + MinIO           │
└─────────────────────────────────────────┘
              ↕
┌─────────────────────────────────────────┐
│    EEG设备 (LSL/Serial/WiFi)            │
└─────────────────────────────────────────┘
```

### 核心技术

- **前端**: Flutter + Dart
- **后端**: FastAPI + Python
- **数据库**: PostgreSQL + Redis
- **信号处理**: NumPy + SciPy + MNE
- **设备通信**: LSL + BrainFlow
- **刺激渲染**: PsychoPy (桌面) / Flutter Canvas (移动)
- **算法**: FBCCA (Filter Bank Canonical Correlation Analysis)

---

## 🗺️ 开发路线图

### ✅ Phase 1: MVP核心功能 (Week 1-6)
- [x] 项目编辑器基础框架
- [x] 刺激渲染引擎
- [x] FBCCA算法集成
- [ ] 基础设备连接

### 🚧 Phase 2: 设备与测试 (Week 7-10)
- [ ] 完整设备管理
- [ ] SSVEP准确度测试
- [ ] 信号质量分析

### 📅 Phase 3: 项目管理 (Week 11-12)
- [ ] 项目CRUD
- [ ] 版本管理
- [ ] 导出功能

### 📅 Phase 4: 用户系统 (Week 13-14)
- [ ] 注册/登录
- [ ] 个人中心

### 📅 Phase 5: 社区功能 (Week 15-18)
- [ ] 项目分享
- [ ] 评论系统
- [ ] 私信功能

### 📅 Phase 6: 移动端适配 (Week 19-21)
- [ ] Android优化
- [ ] iOS支持

### 📅 Phase 7: 优化与发布 (Week 22-24)
- [ ] 性能优化
- [ ] 文档完善
- [ ] 正式发布

---

## 🤝 贡献

我们欢迎所有形式的贡献！

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 贡献指南

- 遵循代码风格规范
- 编写清晰的提交信息
- 添加必要的测试
- 更新相关文档

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](./LICENSE) 文件

---

## 👥 团队

- **项目负责人**: [@your-name](https://github.com/your-name)
- **核心开发者**: 
  - [@developer1](https://github.com/developer1)
  - [@developer2](https://github.com/developer2)

---

## 🙏 致谢

- [PsychoPy](https://www.psychopy.org/) - 视觉刺激库
- [BrainFlow](https://brainflow.org/) - 脑电设备接口
- [LSL](https://labstreaminglayer.readthedocs.io/) - 数据流协议
- [Flutter](https://flutter.dev/) - 跨平台UI框架
- [FastAPI](https://fastapi.tiangolo.com/) - 现代Python Web框架

---

## 📞 联系我们

- **Email**: support@ssvep-platform.com
- **Discord**: [加入我们的Discord](https://discord.gg/ssvep-platform)
- **论坛**: [社区论坛](https://forum.ssvep-platform.com)
- **问题反馈**: [GitHub Issues](https://github.com/your-org/ssvep-platform/issues)

---

## 📊 项目状态

![GitHub stars](https://img.shields.io/github/stars/your-org/ssvep-platform?style=social)
![GitHub forks](https://img.shields.io/github/forks/your-org/ssvep-platform?style=social)
![GitHub issues](https://img.shields.io/github/issues/your-org/ssvep-platform)
![GitHub pull requests](https://img.shields.io/github/issues-pr/your-org/ssvep-platform)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给我们一个Star！⭐**

Made with ❤️ by SSVEP Platform Team

</div>

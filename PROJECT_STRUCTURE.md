# SSVEP Platform - 项目结构文档

## 📁 完整目录结构

```
SSVEP_PLAT/
│
├── flutter_app/                              # Flutter主应用
│   ├── lib/
│   │   ├── main.dart                         # 应用入口
│   │   │
│   │   ├── pages/                            # 页面
│   │   │   ├── home_page.dart                # 主页
│   │   │   ├── project_editor_page.dart      # 项目编辑器
│   │   │   ├── project_manager_page.dart     # 项目管理
│   │   │   ├── device_config_page.dart       # 设备配置
│   │   │   ├── testing/                      # 测试功能
│   │   │   │   ├── testing_page.dart         # 测试主页
│   │   │   │   ├── ssvep_accuracy_test.dart  # 准确度测试
│   │   │   │   └── signal_quality_test.dart  # 信号质量测试
│   │   │   ├── community/                    # 社区功能
│   │   │   │   ├── community_page.dart       # 社区主页
│   │   │   │   ├── project_detail_page.dart  # 项目详情
│   │   │   │   └── user_profile_page.dart    # 用户主页
│   │   │   └── auth/                         # 认证
│   │   │       ├── login_page.dart           # 登录
│   │   │       ├── register_page.dart        # 注册
│   │   │       └── forgot_password_page.dart # 忘记密码
│   │   │
│   │   ├── widgets/                          # 组件
│   │   │   ├── block_editor/                 # 方块编辑器
│   │   │   │   ├── draggable_block.dart      # 可拖拽方块
│   │   │   │   ├── block_properties_panel.dart # 属性面板
│   │   │   │   ├── canvas_editor.dart        # 画布编辑器
│   │   │   │   ├── shape_selector.dart       # 形状选择器
│   │   │   │   └── grid_background.dart      # 网格背景
│   │   │   │
│   │   │   ├── frequency_selector.dart       # 频率选择器
│   │   │   ├── action_binder/                # 动作绑定器
│   │   │   │   ├── action_binder.dart        # 主组件
│   │   │   │   ├── python_code_editor.dart   # Python代码编辑器
│   │   │   │   ├── keyboard_recorder.dart    # 快捷键录制器
│   │   │   │   └── page_link_selector.dart   # 页面链接选择器
│   │   │   │
│   │   │   ├── signal_visualizer/            # 信号可视化
│   │   │   │   ├── waveform_chart.dart       # 波形图
│   │   │   │   ├── spectrum_chart.dart       # 频谱图
│   │   │   │   ├── channel_map.dart          # 通道位置图
│   │   │   │   └── signal_quality_indicator.dart # 信号质量指示器
│   │   │   │
│   │   │   ├── project_card.dart             # 项目卡片
│   │   │   ├── comment_widget.dart           # 评论组件
│   │   │   └── custom_button.dart            # 自定义按钮
│   │   │
│   │   ├── services/                         # 服务层
│   │   │   ├── api_service.dart              # API服务
│   │   │   ├── websocket_service.dart        # WebSocket服务
│   │   │   ├── project_service.dart          # 项目服务
│   │   │   ├── device_service.dart           # 设备服务
│   │   │   ├── lsl_service.dart              # LSL服务
│   │   │   ├── auth_service.dart             # 认证服务
│   │   │   ├── community_service.dart        # 社区服务
│   │   │   └── python_bridge.dart            # Python桥接
│   │   │
│   │   ├── models/                           # 数据模型
│   │   │   ├── project_model.dart            # 项目模型
│   │   │   ├── block_model.dart              # 方块模型
│   │   │   ├── page_model.dart               # 页面模型
│   │   │   ├── action_model.dart             # 动作模型
│   │   │   ├── user_model.dart               # 用户模型
│   │   │   ├── device_model.dart             # 设备模型
│   │   │   ├── comment_model.dart            # 评论模型
│   │   │   └── message_model.dart            # 消息模型
│   │   │
│   │   ├── providers/                        # 状态管理
│   │   │   ├── project_provider.dart         # 项目状态
│   │   │   ├── device_provider.dart          # 设备状态
│   │   │   ├── auth_provider.dart            # 认证状态
│   │   │   ├── community_provider.dart       # 社区状态
│   │   │   └── theme_provider.dart           # 主题状态
│   │   │
│   │   ├── utils/                            # 工具类
│   │   │   ├── stimulus_renderer.dart        # 刺激渲染器
│   │   │   ├── signal_processor.dart         # 信号处理器
│   │   │   ├── keyboard_simulator.dart       # 键盘模拟器
│   │   │   ├── file_helper.dart              # 文件助手
│   │   │   ├── validators.dart               # 验证器
│   │   │   └── logger.dart                   # 日志工具
│   │   │
│   │   └── constants/                        # 常量
│   │       ├── frequencies.dart              # 频率常量
│   │       ├── colors.dart                   # 颜色常量
│   │       ├── themes.dart                   # 主题常量
│   │       ├── api_constants.dart            # API常量
│   │       └── channel_labels.dart           # 通道标签
│   │
│   ├── android/                              # Android特定代码
│   │   ├── app/
│   │   │   ├── src/main/
│   │   │   │   ├── kotlin/com/ssvep/platform/
│   │   │   │   │   ├── MainActivity.kt       # 主Activity
│   │   │   │   │   ├── GLStimulusRenderer.kt # OpenGL渲染器
│   │   │   │   │   ├── LSLNativeModule.kt    # LSL原生模块
│   │   │   │   │   └── KeyboardSimulator.kt  # 键盘模拟器
│   │   │   │   └── AndroidManifest.xml       # 清单文件
│   │   │   └── build.gradle                  # 构建配置
│   │   └── build.gradle                      # 项目构建配置
│   │
│   ├── windows/                              # Windows特定代码
│   ├── macos/                                # macOS特定代码
│   ├── linux/                                # Linux特定代码
│   ├── ios/                                  # iOS特定代码（可选）
│   │
│   ├── assets/                               # 资源文件
│   │   ├── images/                           # 图片
│   │   ├── fonts/                            # 字体
│   │   └── templates/                        # 项目模板
│   │
│   ├── test/                                 # 测试文件
│   │   ├── unit/                             # 单元测试
│   │   ├── widget/                           # 组件测试
│   │   └── integration/                      # 集成测试
│   │
│   ├── pubspec.yaml                          # Flutter依赖配置
│   └── README.md                             # Flutter应用说明
│
├── python_backend/                           # Python后端
│   ├── app/
│   │   ├── main.py                           # FastAPI入口
│   │   │
│   │   ├── api/                              # API路由
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                       # 认证API
│   │   │   ├── users.py                      # 用户API
│   │   │   ├── projects.py                   # 项目API
│   │   │   ├── community.py                  # 社区API
│   │   │   ├── comments.py                   # 评论API
│   │   │   ├── messages.py                   # 消息API
│   │   │   ├── likes.py                      # 点赞API
│   │   │   ├── follows.py                    # 关注API
│   │   │   └── devices.py                    # 设备API
│   │   │
│   │   ├── core/                             # 核心功能
│   │   │   ├── __init__.py
│   │   │   ├── config.py                     # 配置
│   │   │   ├── security.py                   # 安全相关
│   │   │   ├── fbcca.py                      # FBCCA算法
│   │   │   ├── lsl_handler.py                # LSL处理
│   │   │   ├── signal_processing.py          # 信号处理
│   │   │   ├── psychopy_renderer.py          # PsychoPy渲染
│   │   │   └── brainflow_adapter.py          # BrainFlow适配器
│   │   │
│   │   ├── models/                           # 数据库模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py                       # 用户模型
│   │   │   ├── project.py                    # 项目模型
│   │   │   ├── comment.py                    # 评论模型
│   │   │   ├── message.py                    # 消息模型
│   │   │   ├── like.py                       # 点赞模型
│   │   │   ├── follow.py                     # 关注模型
│   │   │   └── tag.py                        # 标签模型
│   │   │
│   │   ├── schemas/                          # Pydantic模式
│   │   │   ├── __init__.py
│   │   │   ├── user.py                       # 用户模式
│   │   │   ├── project.py                    # 项目模式
│   │   │   ├── comment.py                    # 评论模式
│   │   │   ├── message.py                    # 消息模式
│   │   │   └── auth.py                       # 认证模式
│   │   │
│   │   ├── services/                         # 业务逻辑
│   │   │   ├── __init__.py
│   │   │   ├── auth_service.py               # 认证服务
│   │   │   ├── user_service.py               # 用户服务
│   │   │   ├── project_service.py            # 项目服务
│   │   │   ├── community_service.py          # 社区服务
│   │   │   ├── file_service.py               # 文件服务
│   │   │   └── notification_service.py       # 通知服务
│   │   │
│   │   ├── db/                               # 数据库
│   │   │   ├── __init__.py
│   │   │   ├── database.py                   # 数据库连接
│   │   │   ├── redis.py                      # Redis连接
│   │   │   └── session.py                    # 会话管理
│   │   │
│   │   └── utils/                            # 工具函数
│   │       ├── __init__.py
│   │       ├── validators.py                 # 验证器
│   │       ├── helpers.py                    # 助手函数
│   │       └── logger.py                     # 日志工具
│   │
│   ├── scripts/                              # 独立脚本
│   │   ├── psychopy_renderer.py              # PsychoPy渲染脚本
│   │   ├── brainflow_lsl.py                  # BrainFlow LSL脚本
│   │   └── init_db.py                        # 数据库初始化
│   │
│   ├── tests/                                # 测试
│   │   ├── __init__.py
│   │   ├── test_api/                         # API测试
│   │   ├── test_core/                        # 核心功能测试
│   │   └── test_services/                    # 服务测试
│   │
│   ├── alembic/                              # 数据库迁移
│   │   ├── versions/                         # 迁移版本
│   │   └── env.py                            # 迁移环境
│   │
│   ├── requirements.txt                      # Python依赖
│   ├── requirements-dev.txt                  # 开发依赖
│   ├── Dockerfile                            # Docker配置
│   └── README.md                             # 后端说明
│
├── database/                                 # 数据库相关
│   ├── migrations/                           # SQL迁移脚本
│   ├── init.sql                              # 初始化SQL
│   └── schema.sql                            # 数据库架构
│
├── docs/                                     # 文档
│   ├── API.md                                # API文档
│   ├── USER_GUIDE.md                         # 用户指南
│   ├── DEVELOPER.md                          # 开发者文档
│   ├── DEPLOYMENT.md                         # 部署文档
│   └── ARCHITECTURE.md                       # 架构文档
│
├── scripts/                                  # 构建脚本
│   ├── build_windows.bat                     # Windows打包
│   ├── build_android.sh                      # Android打包
│   ├── build_macos.sh                        # macOS打包
│   ├── build_linux.sh                        # Linux打包
│   └── deploy.sh                             # 部署脚本
│
├── .github/                                  # GitHub配置
│   └── workflows/                            # CI/CD工作流
│       ├── flutter_ci.yml                    # Flutter CI
│       └── python_ci.yml                     # Python CI
│
├── docker-compose.yml                        # Docker Compose配置
├── .gitignore                                # Git忽略文件
├── LICENSE                                   # 许可证
├── README.md                                 # 项目说明
├── PROJECT_PLAN.md                           # 项目计划（本文档）
└── PROJECT_STRUCTURE.md                      # 项目结构（本文档）
```

---

## 📦 核心模块说明

### 1. Flutter App (flutter_app/)

#### 页面层 (pages/)
负责UI展示和用户交互，每个页面对应一个功能模块。

#### 组件层 (widgets/)
可复用的UI组件，包括编辑器、图表、表单等。

#### 服务层 (services/)
处理业务逻辑和外部通信，包括API调用、设备连接、数据处理等。

#### 模型层 (models/)
数据结构定义，与后端API和本地存储交互。

#### 状态管理 (providers/)
使用Provider模式管理应用状态，实现响应式更新。

#### 工具类 (utils/)
通用工具函数，如文件操作、验证、日志等。

### 2. Python Backend (python_backend/)

#### API层 (api/)
RESTful API端点定义，处理HTTP请求。

#### 核心层 (core/)
核心算法和功能实现，包括FBCCA、信号处理、设备连接等。

#### 模型层 (models/)
SQLAlchemy ORM模型，定义数据库表结构。

#### 模式层 (schemas/)
Pydantic模式，用于请求/响应数据验证。

#### 服务层 (services/)
业务逻辑实现，被API层调用。

#### 数据库层 (db/)
数据库连接和会话管理。

---

## 🔧 技术栈详细说明

### Flutter依赖 (pubspec.yaml)

```yaml
dependencies:
  flutter:
    sdk: flutter
  
  # 状态管理
  provider: ^6.1.0
  
  # 本地存储
  hive: ^2.2.3
  hive_flutter: ^1.1.0
  path_provider: ^2.1.0
  
  # 网络请求
  dio: ^5.3.3
  web_socket_channel: ^2.4.0
  
  # UI组件
  fl_chart: ^0.64.0
  flutter_colorpicker: ^1.0.3
  file_picker: ^6.0.0
  
  # 拖拽
  flutter_draggable_gridview: ^0.1.3
  
  # Python桥接（桌面端）
  flutter_python: ^0.1.0
  
  # 设备通信
  flutter_libserialport: ^0.3.0
  
  # 工具
  uuid: ^4.1.0
  intl: ^0.18.1
  logger: ^2.0.2
  
  # 分享
  share_plus: ^7.2.0
  
  # 权限
  permission_handler: ^11.0.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
  build_runner: ^2.4.6
  hive_generator: ^2.0.1
```

### Python依赖 (requirements.txt)

```txt
# Web框架
fastapi==0.104.1
uvicorn[standard]==0.24.0
python-multipart==0.0.6

# 数据库
sqlalchemy==2.0.23
alembic==1.12.1
psycopg2-binary==2.9.9
redis==5.0.1

# 认证
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.6

# 数据验证
pydantic==2.5.0
pydantic-settings==2.1.0
email-validator==2.1.0

# 科学计算
numpy==1.26.2
scipy==1.11.4
pandas==2.1.3

# 信号处理
mne==1.5.1
pylsl==1.16.2
brainflow==5.10.1

# 视觉刺激
psychopy==2023.2.3

# 工具
python-dotenv==1.0.0
aiofiles==23.2.1
```

---

## 🗄️ 数据库设计

### 用户表 (users)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(255),
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 项目表 (projects)
```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    version VARCHAR(20),
    thumbnail_url VARCHAR(255),
    content JSONB NOT NULL,
    is_public BOOLEAN DEFAULT FALSE,
    downloads INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 评论表 (comments)
```sql
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 点赞表 (likes)
```sql
CREATE TABLE likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, project_id)
);
```

### 关注表 (follows)
```sql
CREATE TABLE follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id)
);
```

### 消息表 (messages)
```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 标签表 (tags)
```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE project_tags (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
);
```

---

## 🚀 快速开始

### 环境要求
- Flutter SDK 3.16+
- Python 3.9+
- PostgreSQL 14+
- Redis 7+
- Node.js 18+ (可选，用于工具)

### 安装步骤

#### 1. 克隆项目
```bash
git clone https://github.com/your-org/ssvep-platform.git
cd ssvep-platform
```

#### 2. 后端设置
```bash
cd python_backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

#### 3. 数据库初始化
```bash
# 创建数据库
createdb ssvep_platform

# 运行迁移
alembic upgrade head
```

#### 4. 启动后端
```bash
uvicorn app.main:app --reload
```

#### 5. Flutter设置
```bash
cd flutter_app
flutter pub get
```

#### 6. 运行Flutter应用
```bash
# 桌面端
flutter run -d windows  # 或 macos / linux

# 移动端
flutter run -d android
```

---

## 📝 开发规范

### 代码风格
- Flutter: 遵循 [Effective Dart](https://dart.dev/guides/language/effective-dart)
- Python: 遵循 [PEP 8](https://pep8.org/)

### Git提交规范
```
feat: 新功能
fix: 修复bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
test: 测试相关
chore: 构建/工具相关
```

### 分支策略
- `main`: 生产环境
- `develop`: 开发环境
- `feature/*`: 功能分支
- `bugfix/*`: 修复分支
- `release/*`: 发布分支

---

**文档版本**: v1.0  
**最后更新**: 2026-02-11  
**维护者**: SSVEP Platform Team

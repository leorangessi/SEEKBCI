# SSVEP Platform Flutter App

## 快速开始

### 前置要求

1. 安装 Flutter SDK (3.16+)
   - 下载地址: https://flutter.dev/docs/get-started/install
   - 配置环境变量

2. 安装开发工具
   - Android Studio (Android开发)
   - Visual Studio (Windows桌面开发)
   - Xcode (macOS/iOS开发，仅Mac)

### 安装步骤

```bash
# 1. 进入项目目录
cd flutter_app

# 2. 获取依赖
flutter pub get

# 3. 检查环境
flutter doctor

# 4. 运行应用
# Windows桌面
flutter run -d windows

# Android
flutter run -d android

# macOS
flutter run -d macos

# Linux
flutter run -d linux
```

## 项目结构

```
lib/
├── main.dart              # 应用入口
├── pages/                 # 页面
│   └── home_page.dart     # 主页
├── widgets/               # 组件
├── models/                # 数据模型
├── services/              # 服务层
├── providers/             # 状态管理
│   └── theme_provider.dart
├── utils/                 # 工具类
└── constants/             # 常量
    ├── themes.dart        # 主题配置
    ├── frequencies.dart   # 频率常量
    └── channel_labels.dart # 通道标签
```

## 当前进度

### ✅ 已完成
- [x] 项目基础结构
- [x] 主题配置（黑灰色现代风格）
- [x] 主页框架（侧边导航栏）
- [x] 常量定义（频率、通道标签）
- [x] 状态管理基础（Provider）

### 🚧 进行中
- [ ] 项目编辑器
- [ ] 设备管理
- [ ] 测试功能
- [ ] 社区功能
- [ ] 用户系统

## 开发指南

### 添加新页面

1. 在 `lib/pages/` 创建新文件
2. 在 `home_page.dart` 中注册路由
3. 添加导航项

### 添加新组件

1. 在 `lib/widgets/` 创建新文件
2. 遵循 Material Design 3 规范
3. 使用主题颜色

### 状态管理

使用 Provider 模式：

```dart
// 1. 创建Provider
class MyProvider extends ChangeNotifier {
  // 状态和方法
}

// 2. 注册Provider
MultiProvider(
  providers: [
    ChangeNotifierProvider(create: (_) => MyProvider()),
  ],
)

// 3. 使用Provider
Consumer<MyProvider>(
  builder: (context, provider, child) {
    return Widget();
  },
)
```

## 注意事项

1. 遵循 Dart 代码规范
2. 使用 `flutter analyze` 检查代码
3. 使用 `flutter format` 格式化代码
4. 添加必要的注释

## 下一步

- [ ] 实现项目编辑器拖拽功能
- [ ] 集成后端API
- [ ] 添加本地存储（Hive）
- [ ] 实现刺激渲染引擎

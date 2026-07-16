# Flutter 安装指南 (Windows)

## 📥 下载 Flutter SDK

### 方法1: 官方下载（推荐）

1. 访问 Flutter 官网: https://flutter.dev/docs/get-started/install/windows
2. 下载最新稳定版 Flutter SDK (约 1GB)
3. 解压到 `C:\src\flutter` (或其他位置)

### 方法2: 使用 Git 克隆

```bash
cd C:\src
git clone https://github.com/flutter/flutter.git -b stable
```

## 🔧 配置环境变量

### 1. 添加 Flutter 到 PATH

1. 右键点击"此电脑" → "属性"
2. 点击"高级系统设置"
3. 点击"环境变量"
4. 在"系统变量"中找到 `Path`，点击"编辑"
5. 点击"新建"，添加: `C:\src\flutter\bin`
6. 点击"确定"保存

### 2. 验证安装

打开新的命令提示符窗口：

```bash
flutter --version
flutter doctor
```

## 📦 安装依赖

### 1. 安装 Visual Studio (Windows 桌面开发)

下载地址: https://visualstudio.microsoft.com/downloads/

安装时选择：
- ✅ 使用 C++ 的桌面开发
- ✅ Windows 10 SDK

### 2. 安装 Android Studio (Android 开发，可选)

下载地址: https://developer.android.com/studio

安装后在 Android Studio 中：
1. 打开 SDK Manager
2. 安装 Android SDK
3. 安装 Android SDK Command-line Tools

### 3. 运行 Flutter Doctor

```bash
flutter doctor
```

检查所有依赖是否安装完成。

## 🚀 运行 SSVEP Platform 前端

### 1. 进入项目目录

```bash
cd d:\Projects\SSVEP_PLAT\flutter_app
```

### 2. 获取依赖

```bash
flutter pub get
```

### 3. 运行应用

```bash
# Windows 桌面
flutter run -d windows

# 如果有多个设备，先查看可用设备
flutter devices

# 然后选择设备运行
flutter run -d <device-id>
```

## ⚡ 快速启动脚本

我已经为你创建了启动脚本：

```bash
cd d:\Projects\SSVEP_PLAT\flutter_app
start_flutter.bat
```

## 🔍 常见问题

### 问题1: flutter 命令未找到

**解决方案**: 
- 确认已添加到 PATH
- 重启命令提示符
- 重启电脑

### 问题2: Visual Studio 未找到

**解决方案**:
```bash
flutter doctor
```
按照提示安装 Visual Studio

### 问题3: Android licenses 未接受

**解决方案**:
```bash
flutter doctor --android-licenses
```
输入 `y` 接受所有许可

## 📝 预计安装时间

- Flutter SDK 下载: 10-30分钟（取决于网速）
- Visual Studio 安装: 30-60分钟
- 总计: 约 1-2 小时

## 🎯 安装完成后

运行以下命令验证：

```bash
flutter doctor -v
```

应该看到类似输出：
```
[✓] Flutter (Channel stable, 3.16.0, on Microsoft Windows)
[✓] Windows Version (Installed version of Windows is version 10 or higher)
[✓] Visual Studio - develop for Windows (Visual Studio Community 2022)
[✓] Connected device (1 available)
```

## 💡 临时方案：Web 版前端

在安装 Flutter 之前，你可以先使用我创建的 Web 版前端：

打开浏览器访问:
- `file:///d:/Projects/SSVEP_PLAT/web_frontend/index.html`

这是一个纯 HTML/CSS/JavaScript 实现的临时前端，可以让你立即看到效果！

---

**需要帮助？** 
- Flutter 官方文档: https://flutter.dev/docs
- Flutter 中文网: https://flutter.cn

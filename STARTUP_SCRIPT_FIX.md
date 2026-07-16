# 启动脚本问题修复

## 🐛 问题描述
运行 `start_all_services.bat` 时后端服务启动失败。

## 🔍 问题原因
启动脚本使用的是系统 Python，而不是 Conda 环境中的 Python。

项目使用的是 Conda 环境 `ssvep_platform`，需要在该环境中启动后端服务。

## ✅ 解决方案

### 1. 更新启动脚本
已更新 `start_all_services.bat`，现在会：
- ✅ 检查 Conda 环境是否存在
- ✅ 使用 `conda activate ssvep_platform` 激活环境
- ✅ 在 Conda 环境中启动后端
- ✅ 使用系统 Python 启动前端（前端不需要特殊依赖）

### 2. 启动命令对比

**之前（错误）**:
```batch
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**现在（正确）**:
```batch
call conda activate ssvep_platform && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 🚀 使用方法

### 方式 1: 使用一键启动脚本（推荐）
```bash
# 双击运行
start_all_services.bat

# 或命令行运行
cd d:\Projects\SSVEP_PLAT
start_all_services.bat
```

### 方式 2: 手动启动

**启动后端（使用 Conda 环境）**:
```bash
cd d:\Projects\SSVEP_PLAT\python_backend
conda activate ssvep_platform
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**启动前端**:
```bash
cd d:\Projects\SSVEP_PLAT
python python_backend\serve_frontend.py
```

---

## ✅ 验证服务状态

### 检查后端
```bash
curl http://localhost:8000/health
# 应该返回: {"status":"healthy"}
```

### 检查前端
```bash
curl http://localhost:8080
# 应该返回: HTML 内容
```

### 检查端口占用
```bash
netstat -ano | findstr :8000
netstat -ano | findstr :8080
```

---

## 🔧 Conda 环境管理

### 查看所有环境
```bash
conda env list
```

### 激活环境
```bash
conda activate ssvep_platform
```

### 退出环境
```bash
conda deactivate
```

### 重新创建环境（如果需要）
```bash
cd python_backend
setup_conda_env.bat
```

---

## 📊 当前环境状态

### Conda 环境
- ✅ 环境名称: `ssvep_platform`
- ✅ 位置: `C:\ProgramData\Anaconda3\envs\ssvep_platform`
- ✅ Python 版本: 3.9.12

### 已安装的关键依赖
- FastAPI 0.104.1
- Uvicorn 0.24.0
- NumPy 1.26.2
- SciPy 1.11.4
- pylsl 1.16.2
- brainflow 5.10.1
- pyserial 3.5

---

## 🐛 常见问题

### Q: 提示 "Conda环境不存在"
**A**: 运行以下命令创建环境：
```bash
cd python_backend
setup_conda_env.bat
```

### Q: 后端启动失败
**A**: 检查：
1. Conda 环境是否激活
2. 依赖是否安装完整
3. 端口 8000 是否被占用
4. 查看后端命令行窗口的错误信息

### Q: 前端启动失败
**A**: 检查：
1. Python 是否安装
2. 端口 8080 是否被占用
3. web_frontend 目录是否存在

### Q: 如何停止服务
**A**: 
- 关闭对应的命令行窗口
- 或在窗口中按 Ctrl+C

---

## 📝 启动脚本功能

新的 `start_all_services.bat` 包含：

1. ✅ **环境检查** - 验证 Conda 环境是否存在
2. ✅ **服务检查** - 检查端口是否已被占用
3. ✅ **后端启动** - 使用 Conda 环境启动
4. ✅ **前端启动** - 使用系统 Python 启动
5. ✅ **健康检查** - 测试服务是否正常
6. ✅ **浏览器打开** - 自动打开主页

---

## 🎉 测试结果

### 后端服务
```
✅ 启动成功
✅ 健康检查通过
✅ API 可访问
```

### 前端服务
```
✅ 启动成功
✅ 页面可访问
✅ CORS 配置正确
```

---

## 📚 相关文档

- `QUICK_START.md` - 快速开始指南
- `FINAL_FIXES_COMPLETE.md` - 功能修复报告
- `python_backend/setup_conda_env.bat` - Conda 环境创建脚本
- `python_backend/start_backend_conda.bat` - 后端单独启动脚本

---

**修复完成时间**: 2026-02-19  
**版本**: v3.1  
**状态**: ✅ 已修复并测试通过

现在可以正常使用 `start_all_services.bat` 启动所有服务了！

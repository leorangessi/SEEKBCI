# Conda 环境配置指南

## 📋 环境信息

- **环境名称**: `ssvep_platform`
- **Python版本**: 3.10
- **用途**: SSVEP Platform 后端服务

---

## 🚀 快速开始

### 1. 创建环境（首次使用）

```bash
cd python_backend
setup_conda_env.bat
```

这将：
- 创建名为 `ssvep_platform` 的 conda 环境
- 安装 Python 3.10
- 安装所有依赖包（从 requirements.txt）

### 2. 启动后端服务

```bash
cd python_backend
start_backend_conda.bat
```

或手动启动：
```bash
conda activate ssvep_platform
cd python_backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📦 已安装的包

### Web框架
- `fastapi` - 现代Web框架
- `uvicorn` - ASGI服务器
- `python-multipart` - 文件上传支持

### 数据库
- `sqlalchemy` - ORM
- `alembic` - 数据库迁移
- `psycopg2-binary` - PostgreSQL驱动
- `redis` - Redis客户端

### 认证
- `python-jose` - JWT支持
- `passlib` - 密码哈希

### 数据验证
- `pydantic` - 数据验证
- `email-validator` - 邮箱验证

### 科学计算
- `numpy` - 数值计算
- `scipy` - 科学计算
- `pandas` - 数据分析

### 信号处理
- `mne` - 脑电信号处理
- `pylsl` - LSL支持
- `brainflow` - 多设备支持

### 设备连接
- `pyserial` - 串口通信

### 工具
- `python-dotenv` - 环境变量
- `aiofiles` - 异步文件操作
- `websockets` - WebSocket支持

---

## 🔧 常用命令

### 激活环境
```bash
conda activate ssvep_platform
```

### 退出环境
```bash
conda deactivate
```

### 查看已安装的包
```bash
conda activate ssvep_platform
pip list
```

### 更新依赖
```bash
conda activate ssvep_platform
pip install -r requirements.txt --upgrade
```

### 添加新包
```bash
conda activate ssvep_platform
pip install <package_name>
# 然后更新 requirements.txt
pip freeze > requirements.txt
```

### 删除环境
```bash
conda deactivate
conda env remove -n ssvep_platform
```

---

## 🧪 测试环境

### 1. 测试Python版本
```bash
conda activate ssvep_platform
python --version
```
应该显示: `Python 3.10.x`

### 2. 测试依赖安装
```bash
conda activate ssvep_platform
python -c "import fastapi; print('FastAPI:', fastapi.__version__)"
python -c "import pylsl; print('PyLSL:', pylsl.__version__)"
python -c "import serial; print('PySerial:', serial.__version__)"
```

### 3. 测试后端启动
```bash
conda activate ssvep_platform
cd python_backend
python -m uvicorn app.main:app --reload
```

访问: http://localhost:8000

---

## 🐛 故障排查

### 问题1: conda 命令不存在

**原因**: Anaconda/Miniconda 未安装或未添加到PATH

**解决方案**:
1. 下载并安装 Anaconda: https://www.anaconda.com/download
2. 或安装 Miniconda: https://docs.conda.io/en/latest/miniconda.html
3. 重启命令行

### 问题2: 创建环境失败

**原因**: 网络问题或权限不足

**解决方案**:
```bash
# 使用国内镜像源
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free/
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main/
conda config --set show_channel_urls yes

# 重新创建环境
conda create -n ssvep_platform python=3.10 -y
```

### 问题3: pip 安装依赖失败

**原因**: 网络问题或包冲突

**解决方案**:
```bash
# 使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 或分步安装
pip install fastapi uvicorn
pip install numpy scipy pandas
pip install pylsl pyserial
```

### 问题4: 激活环境失败

**原因**: conda 初始化问题

**解决方案**:
```bash
# 初始化 conda
conda init cmd.exe
conda init powershell

# 重启命令行后再试
conda activate ssvep_platform
```

### 问题5: 端口被占用

**原因**: 8000端口已被其他程序使用

**解决方案**:
```bash
# 查找占用端口的进程
netstat -ano | findstr :8000

# 结束进程
taskkill /PID <进程ID> /F

# 或使用其他端口
python -m uvicorn app.main:app --reload --port 8001
```

---

## 📝 环境变量配置

创建 `.env` 文件（在 `python_backend` 目录）：

```env
# 应用配置
APP_NAME=SSVEP Platform
APP_VERSION=1.0.0
DEBUG=True

# CORS配置
CORS_ORIGINS=["http://localhost:3000", "http://localhost:8080", "file://"]

# 数据库配置（可选）
DATABASE_URL=postgresql://user:password@localhost/ssvep_db

# Redis配置（可选）
REDIS_URL=redis://localhost:6379/0

# JWT配置（可选）
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

---

## 🎯 验证清单

安装完成后，请验证：

- [ ] conda 环境创建成功
- [ ] Python 版本为 3.10.x
- [ ] 所有依赖包安装成功
- [ ] 后端服务可以启动
- [ ] 访问 http://localhost:8000 显示欢迎信息
- [ ] 访问 http://localhost:8000/docs 显示API文档
- [ ] 访问 http://localhost:8000/health 返回 healthy

---

## 📚 相关文档

- `DEVICE_CONNECTION_GUIDE.md` - 设备连接使用指南
- `DEVICE_TEST_GUIDE.md` - 设备测试指南
- `requirements.txt` - Python依赖列表
- `setup_conda_env.bat` - 环境创建脚本
- `start_backend_conda.bat` - 服务启动脚本

---

## 🔄 更新日志

### v1.0 (2026-02-13)
- 初始版本
- 创建 conda 环境
- 安装所有依赖
- 支持设备连接功能

---

**环境配置完成后，就可以开始测试设备连接了！** 🚀

下一步：
1. 等待环境创建完成
2. 运行 `start_backend_conda.bat` 启动服务
3. 打开 `device-manager.html` 测试设备连接

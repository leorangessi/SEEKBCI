# SSVEP Platform Python Backend

## 快速开始

### 1. 创建Conda环境

```bash
# 创建conda环境
conda create -n ssvep_platform python=3.9 -y

# 激活环境
conda activate ssvep_platform
```

### 2. 安装依赖

```bash
# 安装基础依赖
pip install -r requirements.txt

# 安装开发依赖（可选）
pip install -r requirements-dev.txt
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
cp env.example .env

# 编辑.env文件，配置数据库连接等信息
```

### 4. 初始化数据库

```bash
# 使用SQLAlchemy创建表
python scripts/init_db.py

# 或使用PostgreSQL直接执行SQL
psql -U postgres -f ../database/init.sql
```

### 5. 启动服务

```bash
# 开发模式（自动重载）
python app/main.py

# 或使用uvicorn
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 6. 访问API文档

打开浏览器访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 项目结构

```
python_backend/
├── app/
│   ├── api/              # API路由
│   ├── core/             # 核心配置
│   ├── db/               # 数据库连接
│   ├── models/           # 数据库模型
│   ├── schemas/          # Pydantic模式
│   ├── services/         # 业务逻辑
│   ├── utils/            # 工具函数
│   └── main.py           # 应用入口
├── scripts/              # 脚本
├── tests/                # 测试
├── requirements.txt      # 依赖
└── env.example           # 环境变量模板
```

## API端点

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 用户
- `GET /api/users/me` - 获取当前用户
- `GET /api/users/{user_id}` - 获取用户信息
- `PUT /api/users/me` - 更新用户信息

### 项目
- `POST /api/projects/` - 创建项目
- `GET /api/projects/` - 获取项目列表
- `GET /api/projects/{project_id}` - 获取项目详情
- `PUT /api/projects/{project_id}` - 更新项目
- `DELETE /api/projects/{project_id}` - 删除项目

## 开发指南

### 运行测试

```bash
pytest
```

### 代码格式化

```bash
black app/
```

### 类型检查

```bash
mypy app/
```

## 注意事项

1. 确保PostgreSQL和Redis服务已启动
2. 修改.env文件中的SECRET_KEY为随机字符串
3. 生产环境请设置DEBUG=False
4. 定期备份数据库

## 下一步

- [ ] 实现JWT认证中间件
- [ ] 添加文件上传功能
- [ ] 集成FBCCA算法
- [ ] 添加WebSocket支持
- [ ] 完善单元测试

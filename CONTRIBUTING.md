# 贡献指南

感谢你对 SSVEP Platform 项目的关注！我们欢迎所有形式的贡献。

## 🤝 如何贡献

### 报告Bug

如果你发现了bug，请通过 [GitHub Issues](https://github.com/your-org/ssvep-platform/issues) 提交，并包含以下信息：

- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 系统环境（操作系统、Flutter版本、Python版本等）
- 截图或日志（如果适用）

### 提出新功能

如果你有新功能的想法，请先创建一个 Issue 讨论：

- 功能描述
- 使用场景
- 预期效果
- 可能的实现方案

### 提交代码

1. **Fork 仓库**
   ```bash
   # 在GitHub上点击Fork按钮
   ```

2. **克隆到本地**
   ```bash
   git clone https://github.com/your-username/ssvep-platform.git
   cd ssvep-platform
   ```

3. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b bugfix/your-bugfix-name
   ```

4. **进行修改**
   - 遵循代码风格规范
   - 添加必要的测试
   - 更新相关文档

5. **提交更改**
   ```bash
   git add .
   git commit -m "feat: add some feature"
   ```

6. **推送到远程**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **创建 Pull Request**
   - 在GitHub上创建PR
   - 填写PR模板
   - 等待代码审查

## 📝 代码规范

### Flutter/Dart

遵循 [Effective Dart](https://dart.dev/guides/language/effective-dart) 规范：

```dart
// 好的命名
class ProjectEditor extends StatefulWidget { }
void saveProject() { }
final String projectName;

// 使用驼峰命名
const int maxBlockCount = 100;

// 使用有意义的变量名
final List<Block> blocks = [];

// 添加注释
/// 保存项目到本地存储
/// 
/// [project] 要保存的项目对象
/// 返回保存是否成功
Future<bool> saveProject(Project project) async {
  // 实现代码
}
```

### Python

遵循 [PEP 8](https://pep8.org/) 规范：

```python
# 好的命名
class ProjectService:
    pass

def get_user_projects(user_id: str) -> List[Project]:
    pass

# 使用类型提示
def process_signal(data: np.ndarray, sampling_rate: int) -> np.ndarray:
    """
    处理EEG信号
    
    Args:
        data: 原始EEG数据
        sampling_rate: 采样率
        
    Returns:
        处理后的数据
    """
    pass

# 使用有意义的变量名
user_projects = get_user_projects(user_id)

# 常量使用大写
MAX_FREQUENCY = 15.0
MIN_FREQUENCY = 8.0
```

## 📋 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

- `feat`: 新功能
- `fix`: 修复bug
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构（既不是新功能也不是修复bug）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具相关
- `ci`: CI/CD相关

### 示例

```bash
feat(editor): add triangle shape support

- Add triangle shape option to shape selector
- Implement triangle rendering in canvas
- Update project model to support triangle shape

Closes #123
```

```bash
fix(device): resolve LSL connection timeout issue

The LSL connection would timeout after 5 seconds.
Increased timeout to 15 seconds and added retry logic.

Fixes #456
```

## 🧪 测试

### Flutter测试

```bash
cd flutter_app

# 运行所有测试
flutter test

# 运行特定测试
flutter test test/widgets/block_editor_test.dart

# 生成覆盖率报告
flutter test --coverage
```

### Python测试

```bash
cd python_backend

# 运行所有测试
pytest

# 运行特定测试
pytest tests/test_api/test_projects.py

# 生成覆盖率报告
pytest --cov=app --cov-report=html
```

## 📖 文档

如果你的更改涉及用户可见的功能，请更新相关文档：

- `README.md`: 项目概述
- `docs/USER_GUIDE.md`: 用户指南
- `docs/API.md`: API文档
- `docs/DEVELOPER.md`: 开发者文档

## 🔍 代码审查

所有PR都需要经过代码审查才能合并。审查者会关注：

- 代码质量
- 测试覆盖率
- 文档完整性
- 性能影响
- 安全问题

## 🎯 开发流程

1. **选择Issue**：从 [Issues](https://github.com/your-org/ssvep-platform/issues) 中选择一个任务
2. **讨论方案**：在Issue中讨论实现方案
3. **开发功能**：在本地开发并测试
4. **提交PR**：创建Pull Request
5. **代码审查**：等待审查和反馈
6. **合并代码**：审查通过后合并

## 💬 交流渠道

- **GitHub Issues**: 问题讨论和功能建议
- **Discord**: [加入我们的Discord](https://discord.gg/ssvep-platform)
- **Email**: dev@ssvep-platform.com

## 📜 行为准则

请遵守我们的 [行为准则](CODE_OF_CONDUCT.md)，保持友好和尊重。

## 🙏 感谢

感谢所有贡献者的付出！你的贡献让这个项目变得更好。

---

**再次感谢你的贡献！** 🎉

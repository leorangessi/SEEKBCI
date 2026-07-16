"""
执行用户项目中的 Python 动作代码（本地可信环境）。
全局代码（import + 初始化）在会话内只执行一次，动作片段共享同一命名空间。
编译检查仅做语法与静态分析，不执行全局代码（避免 connect 等副作用）。
"""
from __future__ import annotations

import ast
import io
import sys
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

_SHARED_NAMESPACE: Optional[Dict[str, Any]] = None
_LAST_GLOBAL_CODE: str = ""
_EXECUTION_LOG: List[Dict[str, Any]] = []
_MAX_EXECUTION_LOG = 50

_BUILTIN_NAMES = frozenset(
    {
        "True",
        "False",
        "None",
        "Ellipsis",
        "NotImplemented",
        "__debug__",
    }
)

_LABEL_GLOBAL = "Python 全局编辑器"


def _builtin_name_set() -> frozenset:
    b = __builtins__
    if isinstance(b, dict):
        return frozenset(b.keys()) | _BUILTIN_NAMES
    return frozenset(dir(b)) | _BUILTIN_NAMES


def reset_python_session() -> None:
    """重置运行时命名空间（测试或新刺激会话时可调用）。"""
    global _SHARED_NAMESPACE, _LAST_GLOBAL_CODE
    _SHARED_NAMESPACE = None
    _LAST_GLOBAL_CODE = ""


def append_execution_log(entry: Dict[str, Any]) -> Dict[str, Any]:
    global _EXECUTION_LOG
    row = {**entry, "ts": entry.get("ts") or __import__("time").time()}
    _EXECUTION_LOG.insert(0, row)
    if len(_EXECUTION_LOG) > _MAX_EXECUTION_LOG:
        _EXECUTION_LOG = _EXECUTION_LOG[:_MAX_EXECUTION_LOG]
    return row


def get_execution_logs(limit: int = 20) -> List[Dict[str, Any]]:
    n = max(1, min(int(limit or 20), _MAX_EXECUTION_LOG))
    return list(_EXECUTION_LOG[:n])


def _ensure_namespace() -> Dict[str, Any]:
    global _SHARED_NAMESPACE
    if _SHARED_NAMESPACE is None:
        _SHARED_NAMESPACE = {"__builtins__": __builtins__}
    return _SHARED_NAMESPACE


def _exec_with_capture(code: str, namespace: Dict[str, Any]) -> Tuple[bool, str]:
    buf = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout = buf
    sys.stderr = buf
    try:
        exec(code or "", namespace, namespace)
        output = buf.getvalue().strip()
        return True, output
    except Exception as e:
        output = buf.getvalue().strip()
        err = f"{type(e).__name__}: {e}"
        if output:
            return False, f"{output}\n{err}"
        return False, err
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr


def _sync_global_code(global_code: str, namespace: Dict[str, Any]) -> Tuple[bool, str]:
    global _LAST_GLOBAL_CODE
    gc = (global_code or "").strip()
    if gc == _LAST_GLOBAL_CODE:
        return True, ""
    namespace.clear()
    namespace["__builtins__"] = __builtins__
    _LAST_GLOBAL_CODE = gc
    if not gc:
        return True, ""
    return _exec_with_capture(gc, namespace)


def _imports_to_global_code(imports: Optional[List[str]]) -> str:
    lines = []
    for line in imports or []:
        stmt = (line or "").strip()
        if stmt and not stmt.startswith("#"):
            lines.append(stmt)
    return "\n".join(lines)


def execute_python_code(
    code: str,
    global_code: str = "",
    imports: Optional[List[str]] = None,
) -> Tuple[bool, str, Dict[str, Any]]:
    import time

    snippet = (code or "").strip()
    meta: Dict[str, Any] = {
        "global_executed": False,
        "global_cached": False,
        "snippet": snippet,
        "duration_ms": 0,
    }
    t0 = time.perf_counter()

    if not snippet:
        meta["duration_ms"] = int((time.perf_counter() - t0) * 1000)
        return False, "Python 代码为空", meta

    gc = (global_code or "").strip()
    if not gc and imports:
        gc = _imports_to_global_code(imports)

    namespace = _ensure_namespace()
    gc_cached = gc == _LAST_GLOBAL_CODE and bool(gc)
    meta["global_cached"] = gc_cached

    ok, global_err = _sync_global_code(gc, namespace)
    meta["global_executed"] = bool(gc) and not gc_cached
    if not ok:
        meta["duration_ms"] = int((time.perf_counter() - t0) * 1000)
        return False, f"全局代码执行失败:\n{global_err}", meta

    ok, snippet_out = _exec_with_capture(snippet, namespace)
    meta["duration_ms"] = int((time.perf_counter() - t0) * 1000)
    if not ok:
        return False, snippet_out, meta

    out = snippet_out or "执行成功（无输出）"
    out = _append_tello_diagnostics(snippet, namespace, out)
    return True, out, meta


def _append_tello_diagnostics(snippet: str, namespace: Dict[str, Any], output: str) -> str:
    """takeoff/land 等指令执行后附加高度等诊断信息，便于确认是否真的起飞。"""
    tello = namespace.get("tello")
    if tello is None:
        return output
    low = (snippet or "").lower()
    try:
        if "takeoff" in low:
            h = tello.get_height()
            return f"{output}\n[诊断] takeoff 后高度: {h} cm（>20 表示已离地）"
        if "land" in low:
            return f"{output}\n[诊断] 已发送降落指令"
        if any(k in low for k in ("move_up", "move_down", "move_forward", "move_back", "move_left", "move_right")):
            h = tello.get_height()
            return f"{output}\n[诊断] 移动后高度: {h} cm（若≈0 可能尚未 takeoff）"
    except Exception as e:
        return f"{output}\n[诊断] 无法读取 Tello 状态: {type(e).__name__}: {e}"
    return output


def _syntax_issues(label: str, code: str) -> List[Dict[str, str]]:
    src = code or ""
    if not src.strip():
        return []
    try:
        compile(src, label, "exec")
    except SyntaxError as e:
        msg = e.msg or str(e)
        if e.lineno:
            msg = f"第 {e.lineno} 行: {msg}"
        return [{"severity": "error", "label": label, "message": msg}]
    return []


def _names_from_target(target: ast.AST) -> Set[str]:
    if isinstance(target, ast.Name):
        return {target.id}
    if isinstance(target, (ast.Tuple, ast.List)):
        names: Set[str] = set()
        for elt in target.elts:
            names.update(_names_from_target(elt))
        return names
    if isinstance(target, ast.Starred):
        return _names_from_target(target.value)
    if isinstance(target, ast.Subscript):
        return _names_from_target(target.value)
    return set()


def _collect_defined_from_stmt(node: ast.AST, defined: Set[str]) -> None:
    if isinstance(node, ast.Import):
        for alias in node.names:
            defined.add(alias.asname or alias.name.split(".")[0])
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            if alias.name == "*":
                continue
            defined.add(alias.asname or alias.name)
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            defined.update(_names_from_target(target))
    elif isinstance(node, ast.AnnAssign) and node.target is not None:
        defined.update(_names_from_target(node.target))
    elif isinstance(node, ast.AugAssign):
        defined.update(_names_from_target(node.target))
    elif isinstance(node, ast.FunctionDef):
        defined.add(node.name)
    elif isinstance(node, ast.AsyncFunctionDef):
        defined.add(node.name)
    elif isinstance(node, ast.ClassDef):
        defined.add(node.name)
    elif isinstance(node, ast.For) and isinstance(node.target, ast.Name):
        defined.add(node.target.id)
    elif isinstance(node, ast.With):
        for item in node.items:
            if item.optional_vars is not None:
                defined.update(_names_from_target(item.optional_vars))
    elif isinstance(node, ast.ExceptHandler) and node.name:
        defined.add(node.name)


def _import_availability_issues(tree: ast.AST) -> List[Dict[str, str]]:
    """仅检测 import 的模块是否可导入，不执行用户代码。"""
    issues: List[Dict[str, str]] = []
    seen: Set[str] = set()
    for node in ast.walk(tree):
        module = None
        if isinstance(node, ast.Import):
            for alias in node.names:
                module = alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.module:
            module = node.module.split(".")[0]
        if not module or module in seen:
            continue
        seen.add(module)
        try:
            __import__(module)
        except ImportError as e:
            issues.append(
                {
                    "severity": "warning",
                    "label": _LABEL_GLOBAL,
                    "message": f"依赖包可能未安装: {module} ({e})",
                }
            )
    return issues


def _static_defined_names(global_code: str) -> Tuple[FrozenSet[str], List[Dict[str, str]]]:
    """静态分析全局代码中会被定义的名称（不执行 connect 等副作用语句）。"""
    gc = (global_code or "").strip()
    if not gc:
        return frozenset(), []

    try:
        tree = ast.parse(gc)
    except SyntaxError:
        return frozenset(), []

    issues = _import_availability_issues(tree)
    defined: Set[str] = set()
    for node in tree.body:
        _collect_defined_from_stmt(node, defined)

    return frozenset(defined), issues


def _undefined_names_in_snippet(code: str, defined: FrozenSet[str]) -> List[str]:
    try:
        tree = ast.parse(code or "")
    except SyntaxError:
        return []
    used: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            used.add(node.id)
    allowed = defined | _builtin_name_set()
    return sorted(n for n in used if n not in allowed and not n.startswith("_"))


def _hint_for_undefined(name: str, global_code: str) -> str:
    hints = []
    gc = global_code or ""
    if name == "tello" and "Tello" in gc and "tello =" not in gc and "tello=" not in gc:
        hints.append("需在全局编辑器添加 tello = Tello()；connect() 等连机操作仅在运行时执行，编译不会连无人机")
    if name == "np" and "numpy" in gc.lower() and "as np" not in gc:
        hints.append("建议：import numpy as np")
    if name == "pd" and "pandas" in gc.lower() and "as pd" not in gc:
        hints.append("建议：import pandas as pd")
    return " ".join(hints)


def compile_project_python(
    global_code: str,
    snippets: Optional[List[Dict[str, str]]] = None,
) -> List[Dict[str, str]]:
    """语法检查 + 全局代码静态分析 + 各片段未定义名称检测（不执行任何用户代码）。"""
    issues: List[Dict[str, str]] = []
    gc = global_code or ""

    issues.extend(_syntax_issues(_LABEL_GLOBAL, gc))

    for item in snippets or []:
        label = str(item.get("label") or "动作片段")
        code = str(item.get("code") or "")
        issues.extend(_syntax_issues(label, code))

    if any(i["severity"] == "error" for i in issues):
        return issues

    defined, static_issues = _static_defined_names(gc)
    issues.extend(static_issues)

    for item in snippets or []:
        label = str(item.get("label") or "动作片段")
        code = str(item.get("code") or "").strip()
        if not code:
            continue
        undefined = _undefined_names_in_snippet(code, defined)
        for name in undefined:
            hint = _hint_for_undefined(name, gc)
            msg = f"未定义的名称: {name}"
            if hint:
                msg += f"。{hint}"
            issues.append({"severity": "error", "label": label, "message": msg})

    return issues

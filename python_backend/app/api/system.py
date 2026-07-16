"""
系统级辅助接口（本机键盘模拟等）。仅应在可信本地网络使用。
"""
import asyncio
import os
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services import keyboard_bridge, mouse_bridge

router = APIRouter()


@router.get("/info")
async def system_info() -> Dict[str, Any]:
    """客户端发现 API 地址与版本（用于 file:// 或端口探测）。"""
    host = os.environ.get("SEEKBCi_API_HOST", settings.API_HOST)
    port = int(os.environ.get("SEEKBCi_API_PORT", str(settings.API_PORT)))
    return {
        "success": True,
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "host": host,
        "port": port,
        "api_origin": f"http://{host}:{port}",
    }


class KeyboardSendRequest(BaseModel):
    chords: List[Dict[str, Any]] = Field(
        ...,
        description="与前端 keyboard-binding 一致：[{ mods: ['ctrl'], code: 'KeyC' }, ...]",
    )


class MouseDoubleClickRequest(BaseModel):
    x: float = Field(..., description="屏幕坐标 X（CSS 像素，与浏览器估算一致）")
    y: float = Field(..., description="屏幕坐标 Y")


class MouseClickRequest(BaseModel):
    x: float = Field(..., description="屏幕坐标 X（CSS 像素，与浏览器估算一致）")
    y: float = Field(..., description="屏幕坐标 Y")


class MouseMoveRequest(BaseModel):
    dx: int = Field(..., description="相对位移 X（像素，可负）")
    dy: int = Field(..., description="相对位移 Y（像素，可负）")


class PythonExecuteRequest(BaseModel):
    code: str = Field(..., description="动作 Python 代码片段")
    global_code: str = Field(
        default="",
        description="项目 Python 全局代码（import 与初始化，先于片段执行）",
    )
    imports: List[str] = Field(
        default_factory=list,
        description="兼容旧版：仅 import 行；global_code 为空时使用",
    )
    source_label: str = Field(default="", description="触发来源（方块标签等，用于日志）")


class PythonSnippetCompile(BaseModel):
    code: str = Field(default="", description="动作 Python 片段")
    label: str = Field(default="", description="片段标签（用于报告）")


class PythonCompileRequest(BaseModel):
    global_code: str = Field(default="", description="Python 全局编辑器内容")
    snippets: List[PythonSnippetCompile] = Field(default_factory=list)


@router.get("/keyboard/status")
async def keyboard_status():
    ok, detail = keyboard_bridge.availability()
    return {"success": True, "available": ok, "detail": detail}


@router.post("/keyboard/send")
async def keyboard_send(body: KeyboardSendRequest):
    ok, detail = keyboard_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)

    try:
        keyboard_bridge.send_chords(body.chords)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"按键模拟失败: {e}") from e

    return {"success": True}


@router.post("/mouse/double-click")
async def mouse_double_click(body: MouseDoubleClickRequest):
    """在指定屏幕坐标发送左键双击（用于 SSVEP 方块「鼠标双击」动作）。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)

    try:
        mouse_bridge.double_click_at(body.x, body.y)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"鼠标模拟失败: {e}") from e

    return {"success": True}


@router.post("/mouse/click")
async def mouse_click(body: MouseClickRequest):
    """在指定屏幕坐标发送左键单击（用于 SSVEP 方块「鼠标单击」动作）。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)

    try:
        mouse_bridge.click_at(body.x, body.y)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"鼠标模拟失败: {e}") from e

    return {"success": True}


@router.post("/mouse/move")
async def mouse_move(body: MouseMoveRequest):
    """相对移动系统光标（IMU → 光标测试）。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)

    try:
        mouse_bridge.move_relative(body.dx, body.dy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"鼠标移动失败: {e}") from e

    return {"success": True}


@router.post("/python/execute")
async def python_execute(body: PythonExecuteRequest):
    """执行 SSVEP 项目动作中的 Python 代码（先 import 后执行）。"""
    from app.services import python_executor

    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Python 代码为空")

    ok, detail, meta = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: python_executor.execute_python_code(
            code, global_code=body.global_code, imports=body.imports
        ),
    )
    log_row = python_executor.append_execution_log(
        {
            "success": ok,
            "source_label": body.source_label or "",
            "snippet": code,
            "output": detail if ok else "",
            "error": "" if ok else detail,
            "global_executed": meta.get("global_executed"),
            "global_cached": meta.get("global_cached"),
            "duration_ms": meta.get("duration_ms"),
        }
    )
    if not ok:
        raise HTTPException(status_code=400, detail=detail)
    return {
        "success": True,
        "output": detail,
        "global_executed": meta.get("global_executed"),
        "global_cached": meta.get("global_cached"),
        "duration_ms": meta.get("duration_ms"),
        "log_id": log_row.get("ts"),
    }


@router.get("/python/logs")
async def python_logs(limit: int = 20):
    """最近 Python 动作执行记录（后端侧）。"""
    from app.services import python_executor

    return {"success": True, "logs": python_executor.get_execution_logs(limit)}


@router.post("/python/compile")
async def python_compile(body: PythonCompileRequest):
    """编译检查：语法、全局代码试跑、动作片段未定义名称检测。"""
    from app.services import python_executor

    snippets = [{"code": s.code, "label": s.label} for s in body.snippets]
    issues = python_executor.compile_project_python(body.global_code, snippets)
    return {"success": True, "issues": issues}


@router.post("/python/reset-session")
async def python_reset_session():
    """重置 Python 运行时命名空间（新刺激会话可选调用）。"""
    from app.services import python_executor

    python_executor.reset_python_session()
    return {"success": True}

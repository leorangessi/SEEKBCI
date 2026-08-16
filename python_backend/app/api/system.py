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


class KeyboardHoldSyncRequest(BaseModel):
    held: Dict[str, bool] = Field(
        ...,
        description="DOM KeyboardEvent.code → 是否按住，如 { KeyW: true, KeyA: false }",
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


class MouseClickCurrentRequest(BaseModel):
    clicks: int = Field(default=1, ge=1, le=2, description="1=单击，2=双击（当前光标位置）")
    button: str = Field(default="left", description="left 或 right")


class MouseButtonHoldSyncRequest(BaseModel):
    pressed: bool = Field(..., description="True=按住左键，False=松开")


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


@router.post("/keyboard/hold-sync")
async def keyboard_hold_sync(body: KeyboardHoldSyncRequest):
    """同步按住状态（IMU 倾斜 → WASD）。"""
    ok, detail = keyboard_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        active = keyboard_bridge.sync_held_keys(body.held)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"按键同步失败: {e}") from e
    return {"success": True, "held": active}


@router.post("/keyboard/hold-release-all")
async def keyboard_hold_release_all():
    """松开所有 hold-sync 按下的键。"""
    ok, detail = keyboard_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        keyboard_bridge.release_all_held_keys()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"松开按键失败: {e}") from e
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


@router.post("/mouse/click-current")
async def mouse_click_current(body: MouseClickCurrentRequest = MouseClickCurrentRequest()):
    """在当前系统光标位置点击（左/右键；IMU 映射光标后的点击方式）。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        mouse_bridge.click_current_button(body.button, body.clicks)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"鼠标点击失败: {e}") from e
    return {"success": True, "button": body.button, "clicks": body.clicks}


@router.post("/mouse/move-center")
async def mouse_move_center():
    """将系统光标移到主屏正中央。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        x, y = mouse_bridge.move_to_screen_center()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"光标回中失败: {e}") from e
    return {"success": True, "x": x, "y": y}


@router.post("/mouse/button-hold-sync")
async def mouse_button_hold_sync(body: MouseButtonHoldSyncRequest):
    """同步左键按住（肌电能量超阈按住 / 低于阈值松开）。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        held = mouse_bridge.sync_left_button_held(body.pressed)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"鼠标按住同步失败: {e}") from e
    return {"success": True, "pressed": held}


@router.post("/mouse/button-release-all")
async def mouse_button_release_all():
    """松开由 button-hold-sync 按下的左键。"""
    ok, detail = mouse_bridge.availability()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    try:
        mouse_bridge.release_left_button()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"松开鼠标失败: {e}") from e
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

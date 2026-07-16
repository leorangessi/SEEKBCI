"""
IMU（控制设备）BLE API — seekbci_imu_v1
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.services.imu_ble_bridge import imu_ble_bridge

router = APIRouter()


class ImuConnectRequest(BaseModel):
    device_name: Optional[str] = Field(
        default=None,
        description="BLE 广播名，默认 ESP32_BMI270_MOUSE",
    )
    timeout: float = Field(default=12.0, ge=3.0, le=30.0)


@router.get("/status")
async def imu_status() -> Dict[str, Any]:
    return imu_ble_bridge.snapshot()


@router.post("/connect")
async def imu_connect(body: ImuConnectRequest) -> Dict[str, Any]:
    try:
        # bleak 阻塞扫描放到线程，避免卡住事件循环
        snap = await asyncio.to_thread(
            imu_ble_bridge.connect,
            body.device_name,
            body.timeout,
        )
        return snap
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IMU 连接失败: {e}") from e


@router.post("/disconnect")
async def imu_disconnect() -> Dict[str, Any]:
    try:
        snap = await asyncio.to_thread(imu_ble_bridge.disconnect)
        return snap
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IMU 断开失败: {e}") from e


@router.websocket("/stream")
async def imu_stream(ws: WebSocket) -> None:
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    loop = asyncio.get_running_loop()

    def on_message(msg: Dict[str, Any]) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, msg)
        except Exception:
            pass

    imu_ble_bridge.add_listener(on_message)
    try:
        await ws.send_json({"type": "hello", **imu_ble_bridge.snapshot()})
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=20.0)
                await ws.send_text(json.dumps(msg, ensure_ascii=False))
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping", **imu_ble_bridge.snapshot()})
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
    finally:
        imu_ble_bridge.remove_listener(on_message)

"""
IMU（控制设备）API

优先使用已连接的 SEEKBCI BLE（EEG+IMU 同包 seekbci_eeg_v2）；
否则回退独立 BMI270 板（seekbci_imu_v1 / ESP32_BMI270_MOUSE）。
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.services.eeg_ble_bridge import eeg_ble_bridge
from app.services.imu_ble_bridge import imu_ble_bridge

router = APIRouter()


class ImuConnectRequest(BaseModel):
    device_name: Optional[str] = Field(
        default=None,
        description="SEEKBCI 或 ESP32_BMI270_MOUSE；默认优先复用已连接的 SEEKBCI",
    )
    timeout: float = Field(default=12.0, ge=3.0, le=30.0)
    address: Optional[str] = None


def _active_imu_snapshot() -> Dict[str, Any]:
    eeg = eeg_ble_bridge.snapshot()
    if eeg.get("status") == "connected":
        return eeg_ble_bridge.imu_snapshot()
    return imu_ble_bridge.snapshot()


@router.get("/status")
async def imu_status() -> Dict[str, Any]:
    return _active_imu_snapshot()


@router.post("/connect")
async def imu_connect(body: ImuConnectRequest) -> Dict[str, Any]:
    name = (body.device_name or "").strip()
    try:
        # 已连接 SEEKBCI → 直接复用
        if eeg_ble_bridge.snapshot().get("status") == "connected" and (
            not name or "SEEKBCI" in name.upper()
        ):
            return eeg_ble_bridge.imu_snapshot()

        errors: list[str] = []

        # 显式 / 默认优先连 SEEKBCI（与设备管理同一桥）
        want_seek = not name or "SEEKBCI" in name.upper()
        want_bmi = bool(name) and (
            "BMI270" in name.upper() or "ESP32" in name.upper() or name.upper() == "IMU"
        )

        if want_seek and not want_bmi:
            snap = await asyncio.to_thread(
                eeg_ble_bridge.connect,
                name or "SEEKBCI",
                body.address,
                body.timeout,
                True,
            )
            if snap.get("status") == "connected":
                return eeg_ble_bridge.imu_snapshot()
            errors.append(snap.get("detail") or "SEEKBCI 连接失败")
            # 默认路径：SEEKBCI 失败则自动回退独立 IMU 板
            if not name:
                snap2 = await asyncio.to_thread(
                    imu_ble_bridge.connect,
                    "ESP32_BMI270_MOUSE",
                    body.timeout,
                )
                if snap2.get("status") == "connected":
                    return {
                        **snap2,
                        "detail": (snap2.get("detail") or "已连接独立 IMU")
                        + f"（SEEKBCI 未找到：{errors[-1]}）",
                    }
                errors.append(snap2.get("detail") or "独立 IMU 连接失败")
                raise RuntimeError("；".join(errors))
            raise RuntimeError(errors[-1])

        # 独立 IMU 板（或显式 BMI270 名称）
        snap = await asyncio.to_thread(
            imu_ble_bridge.connect,
            name if name and not want_seek else "ESP32_BMI270_MOUSE",
            body.timeout,
        )
        if snap.get("status") == "connected":
            return snap
        raise RuntimeError(snap.get("detail") or "独立 IMU 连接失败")
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IMU 连接失败: {e}") from e


@router.post("/disconnect")
async def imu_disconnect() -> Dict[str, Any]:
    try:
        # IMU 测试页断开时：若当前源是 SEEKBCI，一并断开 EEG 桥，否则会卡在「已连接无数据」
        if eeg_ble_bridge.snapshot().get("status") == "connected":
            snap = await asyncio.to_thread(eeg_ble_bridge.disconnect)
            return {
                **eeg_ble_bridge.imu_snapshot(),
                "detail": snap.get("detail") or "已断开 SEEKBCI",
                "status": "disconnected",
            }
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

    eeg_ble_bridge.add_imu_listener(on_message)
    imu_ble_bridge.add_listener(on_message)
    try:
        await ws.send_json({"type": "hello", **_active_imu_snapshot()})
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=20.0)
                await ws.send_text(json.dumps(msg, ensure_ascii=False))
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping", **_active_imu_snapshot()})
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
    finally:
        eeg_ble_bridge.remove_imu_listener(on_message)
        imu_ble_bridge.remove_listener(on_message)

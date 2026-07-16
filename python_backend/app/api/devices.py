"""
设备管理API
提供设备扫描、连接、数据读取等功能
"""
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List, Dict
import asyncio
import json

import numpy as np

from app.services.device_manager import device_manager, SERIAL_AVAILABLE
from app.services.signal_processor import signal_processor

router = APIRouter()


# ==================== 请求模型 ====================

class LSLConnectRequest(BaseModel):
    stream_name: str
    stream_type: str = 'EEG'


class SerialConnectRequest(BaseModel):
    port: str
    baudrate: int = 115200


class WiFiConnectRequest(BaseModel):
    ip: str
    port: int
    protocol: str = 'tcp'


class BrainFlowConnectRequest(BaseModel):
    board_id: int
    serial_port: Optional[str] = None


# ==================== 设备扫描 ====================

@router.get("/scan/lsl")
async def scan_lsl_devices():
    """扫描LSL设备"""
    try:
        devices = device_manager.scan_lsl_devices()
        return {
            "success": True,
            "devices": devices,
            "count": len(devices)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扫描LSL设备失败: {str(e)}")


@router.get("/scan/serial")
async def scan_serial_ports():
    """扫描串口设备"""
    try:
        devices = device_manager.scan_serial_ports()
        return {
            "success": True,
            "devices": devices,
            "count": len(devices),
            "serial_module_available": SERIAL_AVAILABLE,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扫描串口失败: {str(e)}")


@router.get("/boards/brainflow")
async def list_brainflow_boards():
    """列出支持的BrainFlow设备"""
    try:
        boards = device_manager.list_brainflow_boards()
        return {
            "success": True,
            "boards": boards,
            "count": len(boards)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取BrainFlow设备列表失败: {str(e)}")


# ==================== 设备连接 ====================

@router.post("/connect/lsl")
async def connect_lsl(request: LSLConnectRequest):
    """连接LSL设备"""
    try:
        success = device_manager.connect_lsl(
            stream_name=request.stream_name,
            stream_type=request.stream_type
        )
        
        if success:
            return {
                "success": True,
                "message": "LSL设备连接成功",
                "device_info": device_manager.device_info
            }
        else:
            raise HTTPException(status_code=400, detail="LSL设备连接失败")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"连接LSL设备失败: {str(e)}")


@router.post("/connect/serial")
async def connect_serial(request: SerialConnectRequest):
    """连接串口设备"""
    try:
        success = device_manager.connect_serial(
            port=request.port,
            baudrate=request.baudrate
        )
        
        if success:
            return {
                "success": True,
                "message": "串口设备连接成功",
                "device_info": device_manager.device_info
            }
        else:
            raise HTTPException(status_code=400, detail="串口设备连接失败")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"连接串口设备失败: {str(e)}")


@router.post("/connect/wifi")
async def connect_wifi(request: WiFiConnectRequest):
    """连接WiFi设备"""
    try:
        success = device_manager.connect_wifi(
            ip=request.ip,
            port=request.port,
            protocol=request.protocol
        )
        
        if success:
            return {
                "success": True,
                "message": "WiFi设备连接成功",
                "device_info": device_manager.device_info
            }
        else:
            raise HTTPException(status_code=400, detail="WiFi设备连接失败")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"连接WiFi设备失败: {str(e)}")


@router.post("/connect/brainflow")
async def connect_brainflow(request: BrainFlowConnectRequest):
    """连接BrainFlow设备"""
    try:
        success = device_manager.connect_brainflow(
            board_id=request.board_id,
            serial_port=request.serial_port
        )
        
        if success:
            return {
                "success": True,
                "message": "BrainFlow设备连接成功",
                "device_info": device_manager.device_info
            }
        else:
            raise HTTPException(status_code=400, detail="BrainFlow设备连接失败")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"连接BrainFlow设备失败: {str(e)}")


# ==================== 设备断开 ====================

@router.post("/trial_segment/start")
async def trial_segment_start():
    """
    SSVEP 试次开始（对齐 Psychopy queue.put(\"start-1\")）。
    之后由设备读循环写入的原始采样会追加到试次缓冲，直至 trial_segment/stop 或 classify_captured。
    """
    try:
        if not device_manager.is_connected:
            raise HTTPException(status_code=400, detail="设备未连接")
        device_manager.trial_segment_start()
        return {"success": True, "message": "试次切段已开始"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/trial_segment/cancel")
async def trial_segment_cancel():
    """中止当前试次切段（丢弃已缓冲样本）。"""
    try:
        device_manager.trial_segment_cancel()
        return {"success": True, "message": "试次切段已取消"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/disconnect")
async def disconnect_device():
    """断开设备连接"""
    try:
        device_manager.disconnect()
        return {
            "success": True,
            "message": "设备已断开"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"断开设备失败: {str(e)}")


# ==================== 设备状态 ====================

@router.get("/status")
async def get_device_status():
    """获取设备状态"""
    try:
        status = device_manager.get_status()
        return {
            "success": True,
            "status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取设备状态失败: {str(e)}")


# ==================== 数据读取 ====================

@router.get("/data")
async def read_device_data(duration: float = 1.0, for_display: bool = False):
    """读取设备数据。默认原始采样；for_display=true 时返回经带通/去趋势后的副本（供波形调试）。"""
    try:
        if not device_manager.is_connected:
            raise HTTPException(status_code=400, detail="设备未连接")
        
        data = device_manager.read_data(duration)
        if data is None:
            raise HTTPException(status_code=500, detail="读取数据失败")

        out = np.asarray(data)
        if for_display and device_manager.enable_signal_processing:
            try:
                out = signal_processor.append_and_process_display(np.array(data, copy=True))
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"显示用滤波失败: {e}") from e

        return {
            "success": True,
            "data": out.tolist(),
            "shape": out.shape,
            "sampling_rate": device_manager.sampling_rate,
            "for_display": bool(for_display),
        }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取数据失败: {str(e)}")


# ==================== WebSocket实时数据流 ====================

class ConnectionManager:
    """WebSocket连接管理器"""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active_connections.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()

# 多页面/多 WebSocket 时串行读设备，避免 LSL inlet 被并发 pull 抢空
_device_read_lock = asyncio.Lock()


def _build_stream_payload(data: np.ndarray) -> dict:
    payload = {
        "type": "data",
        "data": data.tolist(),
        "timestamp": asyncio.get_event_loop().time(),
        "sampling_rate": device_manager.sampling_rate,
        "channel_count": device_manager.channel_count,
    }
    if device_manager.enable_signal_processing:
        try:
            disp = signal_processor.append_and_process_display(np.array(data, copy=True))
            payload["data_display"] = disp.tolist()
        except Exception as e:
            print(f"[WS] 波形用滤波失败: {e}")
            payload["data_display"] = None
    else:
        payload["data_display"] = None
    return payload


@router.websocket("/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket实时数据流（每连接独立读循环；LSL 须在事件循环线程内 pull，不可用线程池）"""
    await manager.connect(websocket)

    try:
        await websocket.send_json({"type": "connected", "message": "WebSocket连接成功"})

        while True:
            if device_manager.is_connected:
                data = None
                async with _device_read_lock:
                    if device_manager.is_connected:
                        data = device_manager.read_data(duration=0.1)

                if data is not None:
                    await websocket.send_json(_build_stream_payload(data))

                if not device_manager.is_connected:
                    await websocket.send_json(
                        {
                            "type": "status",
                            "connected": False,
                            "device_info": {},
                            "last_error": device_manager.last_error or "",
                            "message": device_manager.last_error or "设备已断开",
                        }
                    )

                await asyncio.sleep(0.05)
            else:
                await websocket.send_json(
                    {
                        "type": "status",
                        "connected": False,
                        "message": "设备未连接",
                    }
                )
                await asyncio.sleep(1.0)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("WebSocket客户端断开连接")
    except Exception as e:
        print(f"WebSocket错误: {e}")
        manager.disconnect(websocket)


# ==================== 测试连接 ====================

@router.post("/test/wifi")
async def test_wifi_connection(request: WiFiConnectRequest):
    """测试WiFi连接"""
    try:
        import socket
        
        # 创建socket
        if request.protocol.lower() == 'tcp':
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5.0)
            result = sock.connect_ex((request.ip, request.port))
            sock.close()
            
            if result == 0:
                return {
                    "success": True,
                    "message": "连接测试成功",
                    "reachable": True
                }
            else:
                return {
                    "success": False,
                    "message": "连接测试失败",
                    "reachable": False
                }
        else:
            # UDP测试
            return {
                "success": True,
                "message": "UDP协议无法直接测试连接",
                "reachable": True
            }
            
    except Exception as e:
        return {
            "success": False,
            "message": f"连接测试失败: {str(e)}",
            "reachable": False
        }

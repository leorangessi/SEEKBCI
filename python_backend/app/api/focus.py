"""专注度监测 API。"""
from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.device_manager import device_manager
from app.services.focus_monitor import focus_monitor_session

router = APIRouter()


class FocusAnalyzeRequest(BaseModel):
    """前端上传窗口数据，或留空由后端从已连接设备拉取。"""

    samples: Optional[List[List[float]]] = Field(
        None, description="形状 (N, C) 的 µV 采样；为空则读设备缓冲"
    )
    channel_indices: List[int] = Field(
        default_factory=list, description="参与分析的物理通道索引（额区/眼电电极）"
    )
    eog_reference_indices: Optional[List[int]] = Field(
        None, description="用于估计 VEOG 并回归剔除的眼电参考通道；默认同 channel_indices"
    )
    ssvep_reference_indices: Optional[List[int]] = Field(
        None, description="SSVEP 枕区通道，分析前减去其均值以去共模"
    )
    remove_eog: bool = Field(True, description="是否做眼电回归剔除")
    sampling_rate: Optional[float] = None
    window_sec: float = Field(2.0, ge=0.5, le=10.0, description="从设备读取时长（无 samples 时）")
    nperseg: Optional[int] = Field(None, description="Welch 窗长样本数")


@router.get("/status")
async def focus_status():
    last = focus_monitor_session.last()
    return {
        "success": True,
        "device_connected": bool(device_manager.is_connected),
        "last": last,
    }


@router.post("/reset")
async def focus_reset():
    focus_monitor_session.reset()
    return {"success": True, "message": "专注度会话已重置"}


@router.post("/analyze")
async def focus_analyze(req: FocusAnalyzeRequest):
    idxs = [int(i) for i in (req.channel_indices or []) if i is not None and int(i) >= 0]
    if not idxs:
        raise HTTPException(status_code=400, detail="请至少指定一个眼电/分析通道 channel_indices")

    sr = float(req.sampling_rate or 0) or float(device_manager.sampling_rate or 250)

    if req.samples and len(req.samples) > 0:
        data = np.asarray(req.samples, dtype=np.float64)
        if data.ndim != 2:
            raise HTTPException(status_code=400, detail="samples 须为二维数组 (N, C)")
    else:
        if not device_manager.is_connected:
            raise HTTPException(status_code=400, detail="设备未连接，且未提供 samples")
        raw = device_manager.read_data(duration=float(req.window_sec))
        if raw is None or len(raw) == 0:
            raise HTTPException(status_code=500, detail="读取设备数据失败")
        data = np.asarray(raw, dtype=np.float64)
        if data.ndim == 1:
            data = data.reshape(-1, 1)
        sr = float(device_manager.sampling_rate or sr)

    try:
        eog_ref = req.eog_reference_indices
        ssvep_ref = req.ssvep_reference_indices
        result = focus_monitor_session.update(
            data,
            idxs,
            sampling_rate=sr,
            nperseg=req.nperseg,
            eog_reference_indices=eog_ref,
            ssvep_reference_indices=ssvep_ref,
            remove_eog=req.remove_eog,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"专注度分析失败: {e}") from e

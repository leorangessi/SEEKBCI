"""
SSVEP / FBCCA HTTP API（与 ssevp 工程 fbcca.py 逻辑一致）
"""
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.fbcca_classify import (
    FBCCA_N_CHANNELS_USE,
    classify_from_trial_samples_detailed,
    decode_window_fbcca,
    fbcca_channel_expansion_plan,
    decode_window_fbcca_dual,
    scores_to_bar_heights,
)
from app.services.device_manager import device_manager

router = APIRouter()

# 在线 decode_window 允许的最大候选目标数（40 键键盘 + 余量）
FBCCA_MAX_DECODE_TARGETS = 48

# 四圆球刺激：用户仅从预设中选一套，频率间隔足够大，低频 / 高频 band 互斥
FOUR_TARGET_PRESETS_LOW: list[list[float]] = [
    [8.0, 10.0, 12.0, 14.0],
    [8.8, 10.8, 12.8, 14.8],
    [9.2, 11.2, 13.2, 15.0],
]
FOUR_TARGET_PRESETS_HIGH: list[list[float]] = [
    [16.0, 19.0, 22.0, 25.0],
    [17.0, 20.0, 23.0, 26.0],
    [18.0, 21.0, 24.0, 27.0],
]


class FBCCAClassifyRequest(BaseModel):
    """时间 × 通道，与设备 WebSocket `data` 字段一致。"""

    samples: List[List[float]] = Field(..., description="shape: (n_samples, n_channels)")
    sampling_rate: float = Field(250.0, gt=0, description="名义采样率 Hz")
    channel_indices: Optional[List[int]] = Field(
        None,
        description="SSVEP 通道 0-based 下标；不足 8 路时循环复制为 8 路（与设备管理配置一致）",
    )


class ClassifyCapturedRequest(BaseModel):
    channel_indices: Optional[List[int]] = Field(
        None,
        description="SSVEP 通道 0-based 下标；与设备管理 / decode_window 一致",
    )


class DecodeWindowRequest(BaseModel):
    """短窗 FBCCA：四目标预设 **或** 自定义 frequencies_hz（项目编辑器运行页）。"""

    samples: List[List[float]] = Field(..., description="最近 window_sec 对应的 (n_samples, n_channels)")
    sampling_rate: float = Field(250.0, gt=0)
    band: Optional[str] = Field(None, description="low/high，与 preset_index 联用；若提供 frequencies_hz 则忽略")
    preset_index: int = Field(0, ge=0, description="该 band 下的方案序号")
    # 上限放宽：与 ssevp/9_cca_withoutvideo.py 取末 4 s×250 Hz 再重采样至 1000 点对齐
    window_sec: float = Field(0.8, gt=0.1, le=5.0)
    frequencies_hz: Optional[List[float]] = Field(
        None,
        description=f"自定义候选频率（2～{FBCCA_MAX_DECODE_TARGETS} 个），顺序须与 UI 目标一致",
    )
    phases: Optional[List[float]] = Field(
        None,
        description="各目标相位（0～1 周期，与 frequencies_hz 等长）；联合频率-相位 FBCCA",
    )
    channel_indices: Optional[List[int]] = Field(
        None,
        description="参与 SSVEP 的设备通道 0-based 下标；不足 8 路时循环复制为 8 路再 FBCCA（BCIduino 同款）。空则使用前 8 列/按列数复制",
    )


@router.get("/fbcca/capabilities")
async def fbcca_capabilities():
    return {
        "max_decode_targets": FBCCA_MAX_DECODE_TARGETS,
        "phase_decode": True,
        "channel_replicate": True,
        "channel_select": True,
        "fbcca_channels": 8,
        "api_revision": "20260523",
    }


@router.post("/fbcca/classify")
async def fbcca_classify_endpoint(body: FBCCAClassifyRequest):
    try:
        arr = np.asarray(body.samples, dtype=np.float64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 samples: {e}") from e

    if arr.ndim != 2:
        raise HTTPException(status_code=400, detail="samples 必须为二维数组 (n_samples, n_channels)")
    if arr.shape[0] < 50:
        raise HTTPException(status_code=400, detail="样本点数过少，至少需要约数十个点")

    ch_idx: Optional[List[int]] = None
    if body.channel_indices is not None and len(body.channel_indices) > 0:
        ch_idx = [int(x) for x in body.channel_indices]
        if any(i < 0 for i in ch_idx):
            raise HTTPException(status_code=400, detail="channel_indices 须为非负整数")

    try:
        pred, _prepared, scores, meta = classify_from_trial_samples_detailed(
            arr, body.sampling_rate, channel_indices=ch_idx
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FBCCA 失败: {e}") from e

    targets_hz = [8, 9, 10, 11, 12, 13, 14, 15]
    freq = targets_hz[pred - 1]
    return {
        "success": True,
        "predicted_class": pred,
        "predicted_index": pred - 1,
        "predicted_frequency_hz": float(freq),
        "fbcca_scores": scores.tolist(),
        "analysis_fs_hz": meta["analysis_fs_hz"],
        "segment_duration_sec": meta["segment_duration_sec"],
        "trial_sample_count": meta["trial_sample_count"],
        "ssvep_channel_count": meta.get("ssvep_channel_count"),
        "fbcca_channel_expansion": meta.get("fbcca_channel_expansion"),
        "fbcca_fusion": meta.get("fbcca_fusion"),
    }


@router.post("/fbcca/classify_captured")
async def fbcca_classify_captured(
    sampling_rate: Optional[float] = Query(None, gt=0, description="覆盖名义采样率；默认取当前连接设备"),
    body: Optional[ClassifyCapturedRequest] = Body(default=None),
):
    """
    结束「试次切段」缓冲并对齐 lsl_received_data：pull 累积止于 queue.put(\"end\") 之后的整段做 FBCCA。
    与浏览器配合：刺激开始时 POST /api/devices/trial_segment/start，结束时调本接口。
    """
    rows = device_manager.trial_segment_stop()
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="无试次数据：请先调用 /api/devices/trial_segment/start 且设备正在通过 WebSocket 读循环推流",
        )

    arr = np.asarray(rows, dtype=np.float64)
    if arr.ndim != 2:
        raise HTTPException(status_code=400, detail="试次数据形状异常")
    fs = float(sampling_rate) if sampling_rate is not None else float(device_manager.sampling_rate or 250.0)
    if arr.shape[0] < 50:
        raise HTTPException(status_code=400, detail=f"试次样本过少 (n={arr.shape[0]})")

    ch_idx: Optional[List[int]] = None
    if body is not None and body.channel_indices is not None and len(body.channel_indices) > 0:
        ch_idx = [int(x) for x in body.channel_indices]
        if any(i < 0 for i in ch_idx):
            raise HTTPException(status_code=400, detail="channel_indices 须为非负整数")

    try:
        pred, _prepared, scores, meta = classify_from_trial_samples_detailed(
            arr, fs, channel_indices=ch_idx
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FBCCA 失败: {e}") from e

    targets_hz = [8, 9, 10, 11, 12, 13, 14, 15]
    freq = targets_hz[pred - 1]
    return {
        "success": True,
        "predicted_class": pred,
        "predicted_index": pred - 1,
        "predicted_frequency_hz": float(freq),
        "fbcca_scores": scores.tolist(),
        "captured_sample_count": int(arr.shape[0]),
        "sampling_rate_used": fs,
        "analysis_fs_hz": meta["analysis_fs_hz"],
        "segment_duration_sec": meta["segment_duration_sec"],
        "ssvep_channel_count": meta.get("ssvep_channel_count"),
        "fbcca_channel_expansion": meta.get("fbcca_channel_expansion"),
        "fbcca_fusion": meta.get("fbcca_fusion"),
    }


@router.post("/fbcca/decode_window")
async def fbcca_decode_window(body: DecodeWindowRequest):
    """
    按预设的 4 个频率 **或** 自定义 frequencies_hz 做 FBCCA；返回 softmax、得分与 chart_bar_heights。
    """
    freqs: list[float]
    band_out: Optional[str] = None
    preset_out: Optional[int] = None

    if body.frequencies_hz is not None and len(body.frequencies_hz) > 0:
        raw = [float(x) for x in body.frequencies_hz]
        if len(raw) < 2:
            raise HTTPException(status_code=400, detail="frequencies_hz 至少需要 2 个频率")
        if len(raw) > FBCCA_MAX_DECODE_TARGETS:
            raise HTTPException(
                status_code=400,
                detail=f"frequencies_hz 最多 {FBCCA_MAX_DECODE_TARGETS} 个频率（请重启后端若仍提示 16）",
            )
        freqs = raw
    else:
        band = (body.band or "").strip().lower()
        if band not in ("low", "high"):
            raise HTTPException(
                status_code=400,
                detail="需提供 band（low/high）与 preset_index，或提供 frequencies_hz",
            )

        presets = FOUR_TARGET_PRESETS_LOW if band == "low" else FOUR_TARGET_PRESETS_HIGH
        if body.preset_index < 0 or body.preset_index >= len(presets):
            raise HTTPException(
                status_code=400,
                detail=f"preset_index 超出范围 0..{len(presets) - 1}",
            )
        freqs = presets[body.preset_index]
        band_out = band
        preset_out = int(body.preset_index)

    try:
        arr = np.asarray(body.samples, dtype=np.float64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 samples: {e}") from e

    if arr.ndim != 2:
        raise HTTPException(status_code=400, detail="samples 必须为二维数组")

    n_device_ch = int(arr.shape[1]) if arr.ndim == 2 else 0
    ch_idx: Optional[List[int]] = None
    if body.channel_indices is not None and len(body.channel_indices) > 0:
        ch_idx = [int(x) for x in body.channel_indices]
        if any(i < 0 for i in ch_idx):
            raise HTTPException(status_code=400, detail="channel_indices 须为非负整数")
    phases_norm: Optional[List[float]] = None
    if body.phases is not None and len(body.phases) > 0:
        if len(body.phases) != len(freqs):
            raise HTTPException(
                status_code=400,
                detail="phases 长度须与 frequencies_hz 一致",
            )
        phases_norm = [float(x) for x in body.phases]

    try:
        pred_idx, scores, probs, _prep, ch_meta = decode_window_fbcca_dual(
            arr,
            float(body.sampling_rate),
            freqs,
            channel_indices=ch_idx,
            phases=phases_norm,
            window_sec=float(body.window_sec),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"decode_window 失败: {e}") from e

    expansion_plan = ch_meta.get("fbcca_channel_expansion")
    ssvep_src_count = ch_meta.get("ssvep_channel_count")
    fbcca_fusion = ch_meta.get("fbcca_fusion")

    phase_out = phases_norm if phases_norm is not None else [0.0] * len(freqs)
    rows = [
        {
            "index": int(i),
            "frequency_hz": float(f),
            "phase": float(ph),
            "score": float(s),
            "probability": float(p),
        }
        for i, (f, ph, s, p) in enumerate(
            zip(freqs, phase_out, scores.tolist(), probs.tolist())
        )
    ]
    rows_by_prob = sorted(rows, key=lambda x: -x["probability"])
    chart_heights = scores_to_bar_heights(scores)

    out: dict = {
        "success": True,
        "frequencies_hz": [float(x) for x in freqs],
        "phases": phase_out,
        "window_sec": float(body.window_sec),
        "ssvep_channel_count": int(ssvep_src_count) if ssvep_src_count is not None else None,
        "fbcca_channel_expansion": [int(x) for x in expansion_plan] if expansion_plan else None,
        "fbcca_input_channels": [int(x) + 1 for x in expansion_plan] if expansion_plan else None,
        "fbcca_fusion": fbcca_fusion,
        "predicted_index": int(pred_idx),
        "predicted_frequency_hz": float(freqs[pred_idx]),
        "predicted_phase": float(phase_out[pred_idx]),
        "scores": scores.tolist(),
        "probabilities": probs.tolist(),
        "chart_bar_heights": chart_heights.tolist(),
        "ranked_by_probability": rows_by_prob,
        "max_decode_targets": FBCCA_MAX_DECODE_TARGETS,
    }
    if band_out is not None:
        out["band"] = band_out
        out["preset_index"] = preset_out
    return out

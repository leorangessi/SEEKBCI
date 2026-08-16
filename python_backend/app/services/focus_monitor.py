"""
专注度（Attention / Focus）监测。

通道：设备管理中标记为「眼电」的额区/眶周电极（可多路）；分析前须**滤除眼电伪迹**。
预处理：
  1. 5–50 Hz 带通 + 50/60 Hz 陷波（与显示链一致）
  2. 可选：减去 SSVEP（枕区）通道均值，去共模漂移
  3. 眼电回归：用眼电参考通道估计 VEOG，各分析通道最小二乘回归剔除
  4. 眨眼窗检测：VEOG 峰峰值过大时降权/标记 artifact

算法参考：额区 TBR、Engagement = β/(α+θ) 等。
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy import signal as sp_signal

from app.services.signal_processor import SignalProcessor

# 经典频段（Hz）— 分析在 5–50 Hz 滤波后进行，delta 仅保留定义完整性
BANDS = {
    "delta": (1.0, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}

# VEOG 峰峰值超过此值（µV）视为眨眼污染较重
BLINK_PTP_UV = 120.0


def _band_power_1d(x: np.ndarray, sr: float, f_lo: float, f_hi: float, nperseg: int) -> float:
    if x.size < 16:
        return 0.0
    nper = int(min(nperseg, max(16, x.size // 2)))
    freqs, psd = sp_signal.welch(x, fs=sr, nperseg=nper, noverlap=nper // 2)
    mask = (freqs >= f_lo) & (freqs < f_hi)
    if not np.any(mask):
        return 0.0
    df = float(freqs[1] - freqs[0]) if len(freqs) > 1 else 1.0
    return float(np.sum(psd[mask]) * df)


def band_powers_for_channel(x: np.ndarray, sr: float, nperseg: int = 256) -> Dict[str, float]:
    x = np.asarray(x, dtype=np.float64).ravel()
    x = x - np.mean(x)
    out = {}
    for name, (lo, hi) in BANDS.items():
        out[name] = _band_power_1d(x, sr, lo, hi, nperseg)
    return out


def average_band_powers(
    data: np.ndarray, channel_indices: Sequence[int], sr: float, nperseg: int = 256
) -> Dict[str, float]:
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    if arr.ndim != 2 or arr.shape[0] < 16:
        return {k: 0.0 for k in BANDS}
    n_ch = arr.shape[1]
    idxs = [int(i) for i in channel_indices if 0 <= int(i) < n_ch]
    if not idxs:
        idxs = list(range(min(n_ch, 1)))
    acc = {k: 0.0 for k in BANDS}
    for i in idxs:
        bp = band_powers_for_channel(arr[:, i], sr, nperseg=nperseg)
        for k in BANDS:
            acc[k] += bp[k]
    n = float(len(idxs))
    return {k: acc[k] / n for k in BANDS}


def compute_raw_metrics(bands: Dict[str, float]) -> Dict[str, float]:
    eps = 1e-12
    theta = max(bands.get("theta", 0.0), 0.0)
    alpha = max(bands.get("alpha", 0.0), 0.0)
    beta = max(bands.get("beta", 0.0), 0.0)
    delta = max(bands.get("delta", 0.0), 0.0)
    gamma = max(bands.get("gamma", 0.0), 0.0)
    total = theta + alpha + beta + delta + gamma + eps

    engagement = beta / (alpha + theta + eps)
    beta_theta = beta / (theta + eps)
    tbr = theta / (beta + eps)
    rel = {
        "delta_rel": delta / total,
        "theta_rel": theta / total,
        "alpha_rel": alpha / total,
        "beta_rel": beta / total,
        "gamma_rel": gamma / total,
    }
    composite = 0.65 * engagement + 0.35 * math.log1p(beta_theta)
    return {
        "engagement": engagement,
        "beta_theta": beta_theta,
        "theta_beta_ratio": tbr,
        "composite_raw": composite,
        **rel,
    }


def _valid_indices(idxs: Optional[Sequence[int]], n_ch: int) -> List[int]:
    if not idxs:
        return []
    out = []
    for i in idxs:
        j = int(i)
        if 0 <= j < n_ch:
            out.append(j)
    return out


def subtract_ssvep_reference(
    data: np.ndarray,
    focus_indices: Sequence[int],
    ssvep_indices: Sequence[int],
) -> np.ndarray:
    """各分析通道减去 SSVEP 通道均值（去共模 / 枕区参考）。"""
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    ssvep = _valid_indices(ssvep_indices, arr.shape[1])
    focus = _valid_indices(focus_indices, arr.shape[1])
    if not ssvep or not focus:
        return arr
    ref = np.mean(arr[:, ssvep], axis=1)
    out = arr.copy()
    for ch in focus:
        out[:, ch] = arr[:, ch] - ref
    return out


def remove_eog_regression(
    data: np.ndarray,
    focus_indices: Sequence[int],
    eog_reference_indices: Sequence[int],
) -> Tuple[np.ndarray, Dict[str, float]]:
    """
    用眼电参考通道估计垂直眼电 VEOG，对各分析通道做最小二乘回归剔除。
    参考：Gratton-Coles / 简单线性 EOG 回归思路。
    """
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    n_ch = arr.shape[1]
    focus = _valid_indices(focus_indices, n_ch)
    eog_ref = _valid_indices(eog_reference_indices, n_ch)
    if not focus:
        return arr, {"veog_ptp_uv": 0.0, "eog_regress_r2": 0.0}
    if not eog_ref:
        eog_ref = focus[:]

    veog = np.mean(arr[:, eog_ref], axis=1)
    veog = veog - np.mean(veog)
    veog_ptp = float(np.max(veog) - np.min(veog)) if veog.size else 0.0
    denom = float(np.dot(veog, veog)) + 1e-12

    out = arr.copy()
    r2_sum = 0.0
    for ch in focus:
        x = arr[:, ch] - np.mean(arr[:, ch])
        alpha = float(np.dot(x, veog) / denom)
        out[:, ch] = arr[:, ch] - alpha * veog
        if np.var(x) > 1e-12:
            pred = alpha * veog
            r2_sum += float(1.0 - np.var(x - pred) / np.var(x))
    r2_avg = r2_sum / max(1, len(focus))
    return out, {"veog_ptp_uv": veog_ptp, "eog_regress_r2": r2_avg}


def preprocess_for_focus(
    data: np.ndarray,
    channel_indices: Sequence[int],
    sampling_rate: float,
    eog_reference_indices: Optional[Sequence[int]] = None,
    ssvep_reference_indices: Optional[Sequence[int]] = None,
    remove_eog: bool = True,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """带通 + 参考去共模 + 眼电回归。"""
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    sr = float(sampling_rate) if sampling_rate and sampling_rate > 0 else 250.0
    meta: Dict[str, Any] = {
        "filtered": False,
        "eog_removed": False,
        "ssvep_ref_subtracted": False,
        "blink_heavy": False,
    }

    if arr.shape[0] < 16:
        return arr, meta

    focus = _valid_indices(channel_indices, arr.shape[1])
    eog_ref = _valid_indices(eog_reference_indices, arr.shape[1])
    if not eog_ref:
        eog_ref = focus
    # 眨眼多为低频大幅瞬态，须在带通前检测
    raw_veog_ptp = 0.0
    if eog_ref:
        raw_veog = np.mean(arr[:, eog_ref], axis=1)
        raw_veog = raw_veog - np.mean(raw_veog)
        raw_veog_ptp = float(np.max(raw_veog) - np.min(raw_veog)) if raw_veog.size else 0.0

    proc = SignalProcessor(sampling_rate=sr)
    filtered = proc.openbci_display_filter(arr)
    meta["filtered"] = True

    ssvep = _valid_indices(ssvep_reference_indices, filtered.shape[1])
    if ssvep:
        filtered = subtract_ssvep_reference(filtered, focus, ssvep)
        meta["ssvep_ref_subtracted"] = True
        meta["ssvep_ref_channels"] = ssvep

    eog_stats: Dict[str, float] = {"veog_ptp_uv": raw_veog_ptp, "eog_regress_r2": 0.0}
    if remove_eog:
        if not eog_ref:
            eog_ref = focus
        filtered, reg_stats = remove_eog_regression(filtered, focus, eog_ref)
        eog_stats["eog_regress_r2"] = reg_stats.get("eog_regress_r2", 0.0)
        meta["eog_removed"] = True
        meta["eog_ref_channels"] = eog_ref

    meta.update(eog_stats)
    meta["blink_heavy"] = raw_veog_ptp > BLINK_PTP_UV
    return filtered, meta


class FocusMonitorSession:
    """会话级自适应：用近期 composite_raw 分位数把分数映射到 0–100。"""

    def __init__(self, history_sec: float = 90.0, ema_tau_sec: float = 1.2) -> None:
        self._lock = threading.RLock()
        self.history_sec = history_sec
        self.ema_tau_sec = ema_tau_sec
        self._raw_hist: Deque[Tuple[float, float]] = deque()
        self._ema: Optional[float] = None
        self._last_t = 0.0
        self._last_result: Optional[Dict[str, Any]] = None

    def reset(self) -> None:
        with self._lock:
            self._raw_hist.clear()
            self._ema = None
            self._last_t = 0.0
            self._last_result = None

    def _adaptive_score(self, raw: float, now: float) -> float:
        cutoff = now - self.history_sec
        while self._raw_hist and self._raw_hist[0][0] < cutoff:
            self._raw_hist.popleft()
        self._raw_hist.append((now, raw))
        vals = [v for _, v in self._raw_hist]
        if len(vals) < 8:
            return float(np.clip(25.0 * math.log1p(max(0.0, raw) * 4.0), 0.0, 100.0))
        lo = float(np.percentile(vals, 10))
        hi = float(np.percentile(vals, 90))
        if hi - lo < 1e-6:
            return 50.0
        z = (raw - lo) / (hi - lo)
        return float(np.clip(z * 100.0, 0.0, 100.0))

    def update(
        self,
        data: np.ndarray,
        channel_indices: Sequence[int],
        sampling_rate: float,
        nperseg: Optional[int] = None,
        eog_reference_indices: Optional[Sequence[int]] = None,
        ssvep_reference_indices: Optional[Sequence[int]] = None,
        remove_eog: bool = True,
    ) -> Dict[str, Any]:
        sr = float(sampling_rate) if sampling_rate and sampling_rate > 0 else 250.0
        nps = int(nperseg) if nperseg else max(64, int(sr * 1.0))

        cleaned, prep_meta = preprocess_for_focus(
            data,
            channel_indices,
            sr,
            eog_reference_indices=eog_reference_indices,
            ssvep_reference_indices=ssvep_reference_indices,
            remove_eog=remove_eog,
        )

        bands = average_band_powers(cleaned, channel_indices, sr, nperseg=nps)
        metrics = compute_raw_metrics(bands)
        now = time.time()

        with self._lock:
            score_inst = self._adaptive_score(metrics["composite_raw"], now)
            # 眨眼污染重：瞬时分数向当前 EMA 收敛，避免飙高/飙低
            if prep_meta.get("blink_heavy") and self._ema is not None:
                score_inst = 0.35 * score_inst + 0.65 * self._ema

            dt = (now - self._last_t) if self._last_t > 0 else 0.2
            self._last_t = now
            alpha = 1.0 - math.exp(-max(0.05, dt) / max(0.2, self.ema_tau_sec))
            if self._ema is None:
                self._ema = score_inst
            else:
                self._ema = self._ema + alpha * (score_inst - self._ema)
            score = float(np.clip(self._ema, 0.0, 100.0))
            level = (
                "高专注"
                if score >= 70
                else "中等"
                if score >= 40
                else "偏低"
                if score >= 20
                else "放松/走神"
            )
            if prep_meta.get("blink_heavy"):
                level = f"{level}（眨眼干扰）"

            result = {
                "success": True,
                "focus_score": round(score, 1),
                "focus_instant": round(score_inst, 1),
                "level": level,
                "bands": {k: round(v, 6) for k, v in bands.items()},
                "metrics": {k: round(float(v), 6) for k, v in metrics.items()},
                "preprocess": prep_meta,
                "channels": [int(i) for i in channel_indices],
                "sampling_rate": sr,
                "n_samples": int(np.asarray(data).shape[0]),
                "algorithm": {
                    "name": "engagement_beta_theta_v2_eog_clean",
                    "notes": [
                        "5–50 Hz + 陷波 → SSVEP 参考去共模 → 眼电 VEOG 回归剔除",
                        "engagement = beta/(alpha+theta)",
                        "score = 会话分位自适应(10–90%) + EMA",
                    ],
                },
                "ts": now,
            }
            self._last_result = result
            return result

    def last(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self._last_result) if self._last_result else None


focus_monitor_session = FocusMonitorSession()

"""
FBCCA 分类（与 E:\\Interesting\\ssevp\\fbcca.py 算法一致）。
输入 EEG 形状：channels × time_points。
"""
from __future__ import annotations

import math
from typing import List, Sequence, Tuple

import numpy as np
from scipy import signal
from sklearn.cross_decomposition import CCA

# 与原始脚本一致：分析窗口对应 250 Hz × 4 s → 1000 点
DEFAULT_FS = 250
DEFAULT_NUM_SAMPLES = 1000
FBCCA_N_CHANNELS_USE = 8


def resolve_ssvep_phys_indices(
    channel_indices: Sequence[int] | None,
    n_in: int,
) -> List[int]:
    """设备矩阵中参与 SSVEP 的 0-based 列下标（去重、保序）。"""
    valid: List[int] = []
    if channel_indices is not None and len(channel_indices) > 0:
        for i in channel_indices:
            j = int(i)
            if 0 <= j < int(n_in) and j not in valid:
                valid.append(j)
    if not valid:
        valid = list(range(min(int(n_in), FBCCA_N_CHANNELS_USE)))
    return valid


def apply_ssvep_car(samples_st: np.ndarray, phys_indices: Sequence[int]) -> np.ndarray:
    """
    共同平均参考（CAR）。少通道枕区 SSVEP 各电极往往同相，CAR 会把 SSVEP 成分减掉，故默认关闭。
    """
    del phys_indices
    return np.asarray(samples_st, dtype=np.float64)


def fbcca_channel_expansion_plan(
    channel_indices: Sequence[int] | None,
    *,
    n_in: int | None = None,
    n_out: int = FBCCA_N_CHANNELS_USE,
) -> List[int]:
    """
    生成 FBCCA 固定 n_out 路输入时，每一路对应的设备列 0-based 下标。

    采用 BCIduino 常用的**块状复制**：每路电极各占连续若干槽位（1 路→8 份相同；
    2 路→各 4 份），比交替循环更利于 CCA 稳定。
    """
    ncol = int(n_in) if n_in is not None and n_in > 0 else n_out
    valid = resolve_ssvep_phys_indices(channel_indices, ncol)
    k = len(valid)
    if k >= n_out:
        return valid[: int(n_out)]
    base = int(n_out) // k
    extra = int(n_out) % k
    plan: List[int] = []
    for i, idx in enumerate(valid):
        copies = base + (1 if i < extra else 0)
        plan.extend([idx] * copies)
    return plan[: int(n_out)]


def select_samples_channels(
    samples_st: np.ndarray,
    channel_indices: Sequence[int] | None,
) -> np.ndarray:
    """
    按 channel_indices（0-based）选取参与 SSVEP 的设备通道列，不补零、不循环复制。
    None 或空则原样返回。
    """
    if channel_indices is None or len(channel_indices) == 0:
        return samples_st
    x = np.asarray(samples_st, dtype=np.float64)
    if x.ndim != 2:
        raise ValueError("samples_st 必须为 (n_samples, n_channels)")
    n_t, n_in = x.shape
    valid = [int(i) for i in channel_indices if 0 <= int(i) < n_in]
    if not valid:
        return samples_st
    return x[:, valid].copy()


def expand_samples_channel_replicate(
    samples_st: np.ndarray,
    channel_indices: Sequence[int] | None,
    *,
    n_out: int = FBCCA_N_CHANNELS_USE,
) -> np.ndarray:
    """
    将时间×通道矩阵按 expansion plan 循环复制为 n_out 路（供 FBCCA 固定 8 通道输入）。
    channel_indices 为设备 0-based 下标；None 或空则按矩阵现有列 0..n-1 循环复制。
    """
    x = np.asarray(samples_st, dtype=np.float64)
    if x.ndim != 2:
        raise ValueError("samples_st 必须为 (n_samples, n_channels)")
    n_t, n_cols = x.shape
    plan = fbcca_channel_expansion_plan(channel_indices, n_in=n_cols, n_out=n_out)
    if plan == list(range(n_out)) and n_cols >= n_out:
        return x[:, :n_out].copy()
    out = np.zeros((n_t, n_out), dtype=np.float64)
    for k, src in enumerate(plan):
        out[:, k] = x[:, src]
    return out


def prepare_samples_for_fbcca_decode(
    samples_st: np.ndarray,
    channel_indices: Sequence[int] | None,
    *,
    n_out: int = FBCCA_N_CHANNELS_USE,
) -> np.ndarray:
    """在线 decode：按块状 plan 复制为 n_out 路（BCIduino 同款，不做 CAR）。"""
    return expand_samples_channel_replicate(samples_st, channel_indices, n_out=n_out)


def _low_channel_ensemble_weight(n_phys: int, *, online: bool = False) -> float:
    """少通道试次分类：提高「仅用真实 K 路」分支权重。在线短窗不用融合。"""
    if online:
        return 0.0
    if n_phys <= 1:
        return 0.4
    if n_phys == 2:
        return 0.72
    if n_phys == 3:
        return 0.45
    return 0.0


def _fuse_fbcca_scores(scores_a: np.ndarray, scores_b: np.ndarray, weight_b: float) -> np.ndarray:
    a = np.asarray(scores_a, dtype=np.float64)
    b = np.asarray(scores_b, dtype=np.float64)
    if a.shape != b.shape:
        raise ValueError("融合得分维度不一致")
    w = float(np.clip(weight_b, 0.0, 1.0))
    return (1.0 - w) * a + w * b


def prepare_like_reference(data_tc: np.ndarray, fs: float) -> Tuple[np.ndarray, float]:
    """
    对齐 9_cca_withoutvideo.py：取每个 trial 末尾至多 4 s，再沿时间轴重采样为 1000 点。

    返回 ``(prepared, segment_duration_sec)``：后者为**重采样前**所选片段的物理时长（秒）。
    试次短于 4 s 时片段不足 4 s，但仍输出 1000 点；调用方须用
    ``fs_analysis = prepared.shape[1] / segment_duration_sec`` 做 FBCCA，
    否则仍按 250 Hz×4 s 建参考会导致频率模板与 EEG 错位、准确度下降。
    """
    if data_tc.ndim != 2:
        raise ValueError("data_tc 必须为二维 (channels, times)")
    n_ch, n_t = data_tc.shape
    max_samples = max(1, int(round(float(fs) * 4)))
    seg = data_tc[:, -max_samples:] if n_t >= max_samples else data_tc
    n_seg = int(seg.shape[1])
    segment_duration_sec = n_seg / float(fs)
    out = np.zeros((n_ch, DEFAULT_NUM_SAMPLES), dtype=np.float64)
    for i in range(n_ch):
        out[i] = signal.resample(seg[i], DEFAULT_NUM_SAMPLES)
    return out, segment_duration_sec


def _filtfilt_band(B: np.ndarray, A: np.ndarray, eeg: np.ndarray, *, short_window: bool) -> np.ndarray:
    n_t = eeg.shape[1]
    padlen = 3 * (max(len(B), len(A)) - 1)
    if short_window:
        padlen = min(padlen, max(8, n_t // 3))
    padlen = min(padlen, max(1, n_t - 1))
    return signal.filtfilt(B, A, eeg, padlen=padlen).copy()


def filter_bank(eeg: np.ndarray, fs: float = DEFAULT_FS, *, short_window: bool = False) -> np.ndarray:
    Nm = 3
    result = np.zeros((Nm, eeg.shape[0], eeg.shape[1]))
    nyq = fs / 2
    passband = [6, 14, 22, 30, 38, 46, 54, 62, 70, 78]
    stopband = [4, 10, 16, 24, 32, 40, 48, 56, 64, 72]
    highcut_pass, highcut_stop = 80, 90
    gpass, gstop, Rp = 3, 40, 0.5

    for i in range(Nm):
        Wp = [passband[i] / nyq, highcut_pass / nyq]
        Ws = [stopband[i] / nyq, highcut_stop / nyq]
        N, Wn = signal.cheb1ord(Wp, Ws, gpass, gstop)
        B, A = signal.cheby1(N, Rp, Wn, "bandpass")
        result[i, :, :] = _filtfilt_band(B, A, eeg, short_window=short_window)

    return result


def get_reference_signal(
    num_samples: int, fs: float = DEFAULT_FS, num_harmonics: int = 4
) -> np.ndarray:
    targets = [8, 9, 10, 11, 12, 13, 14, 15]
    return get_reference_signal_for_freqs(num_samples, fs, targets, num_harmonics=num_harmonics)


def get_reference_signal_for_freqs(
    num_samples: int,
    fs: float,
    frequencies: Sequence[float],
    *,
    num_harmonics: int = 4,
    phases_rad: Sequence[float] | None = None,
) -> np.ndarray:
    """
    形状 (K, 2*num_harmonics, num_samples)，K=len(frequencies)。
    phases_rad: 各目标初相位（弧度），与 frequencies 等长；用于联合频率-相位编码 (JFPM)。
    """
    t = np.arange(num_samples, dtype=np.float64) / float(fs)
    freqs = [float(x) for x in frequencies]
    k = len(freqs)
    if phases_rad is None:
        ph_list = [0.0] * k
    else:
        ph_list = [float(x) for x in phases_rad]
        if len(ph_list) != k:
            raise ValueError("phases_rad 长度须与 frequencies 一致")
    reference_signals: List[List[np.ndarray]] = []
    for f, phi in zip(freqs, ph_list):
        reference_f: List[np.ndarray] = []
        fv = float(f)
        for h in range(1, num_harmonics + 1):
            reference_f.append(np.sin(2 * np.pi * h * fv * t + phi))
            reference_f.append(np.cos(2 * np.pi * h * fv * t + phi))
        reference_signals.append(reference_f)
    return np.asarray(reference_signals, dtype=np.float64)


def _cca_fit_transform():
    """与旧版 sklearn 行为对齐：旧代码 CCA(1) 等价于 n_components=1 且无标准化。"""
    try:
        return CCA(n_components=1, scale=False, max_iter=2000, tol=1e-5)
    except TypeError:
        return CCA(n_components=1)


def find_correlation(X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    num_freq = Y.shape[0]
    result = np.zeros(num_freq)
    for freq_idx in range(num_freq):
        matched_X = X
        cca = _cca_fit_transform()
        cca.fit(matched_X.T, Y[freq_idx].T)
        x_a, y_b = cca.transform(matched_X.T, Y[freq_idx].T)
        corr = np.corrcoef(x_a[:, 0], y_b[:, 0])[0, 1]
        if np.isnan(corr):
            corr = 0.0
        result[freq_idx] = np.max([corr])
    return result


def fbcca_classify_multi(
    data: np.ndarray,
    fs: float,
    frequencies: Sequence[float],
    *,
    phases: Sequence[float] | None = None,
) -> Tuple[int, np.ndarray]:
    """
    Args:
        data: channels × time_points（已与参考模板长度、采样率一致）
        frequencies: K 个刺激频率，顺序与 UI 目标一致。
        phases: 可选，各目标相位（0～1 周期归一化），与 frequencies 等长；JFPM 参考 sin/cos(2πft+φ)。

    Returns:
        (argmax 索引 0..K-1, 长度 K 的融合得分)
    """
    if data.ndim != 2:
        raise ValueError("data 必须为二维")
    freqs = [float(x) for x in frequencies]
    k = len(freqs)
    if k < 2:
        raise ValueError("至少需要 2 个候选频率")
    if phases is None:
        phases_rad = None
    else:
        phases_rad = [float(p) * 2.0 * math.pi for p in phases]
    reference_signals = get_reference_signal_for_freqs(
        data.shape[1], fs, freqs, phases_rad=phases_rad
    )
    filtered = filter_bank(data, fs, short_window=data.shape[1] < 280)
    Nm = 3
    fb_coefs = [math.pow(i, -1.25) + 0.25 for i in range(1, Nm + 1)]
    result = np.zeros(k, dtype=np.float64)
    for fb_i in range(Nm):
        x = filtered[fb_i, :, :]
        y = reference_signals
        w = fb_coefs[fb_i]
        result += w * (find_correlation(x, y) ** 2)
    predicted = int(np.argmax(result))
    return predicted, result.astype(float)


def fbcca_scores_to_probabilities(scores: np.ndarray) -> np.ndarray:
    """将非负融合得分转为归一化「置信度」（softmax）。"""
    z = np.asarray(scores, dtype=np.float64)
    z = z - np.max(z)
    expz = np.exp(np.clip(z, -50, 50))
    s = float(np.sum(expz))
    if s <= 1e-15:
        return np.ones_like(z) / len(z)
    return expz / s


def scores_to_bar_heights(
    scores: np.ndarray,
    *,
    gamma: float = 2.6,
    floor: float = 0.07,
) -> np.ndarray:
    """
    柱状图高度（0～1）：在得分接近时仍拉开视觉差距。
    对归一化得分做幂次映射 + 非零下限，再缩放到 max=1；与 argmax 一致。
    说明：softmax 在 logits 接近时常退化为≈均匀分布，不宜单独用作柱高。
    """
    s = np.asarray(scores, dtype=np.float64)
    s = np.maximum(s, 0.0)
    mx = float(np.max(s))
    if mx <= 1e-15:
        return np.ones(len(s), dtype=np.float64) / max(len(s), 1)
    r = s / mx
    h = floor + (1.0 - floor) * np.power(r, float(gamma))
    h = h / float(np.max(h))
    return h.astype(np.float64)


def prepare_fixed_duration(
    data_tc: np.ndarray,
    fs: float,
    duration_sec: float,
    target_points: int,
) -> np.ndarray:
    """
    取最后一小段物理时长 duration_sec（秒），沿时间维重采样为 target_points。
    data_tc: (n_channels, n_times)
    """
    if data_tc.ndim != 2:
        raise ValueError("data_tc 必须为二维")
    n_ch, n_t = data_tc.shape
    want = max(1, int(round(float(fs) * float(duration_sec))))
    seg = data_tc[:, -want:] if n_t >= want else data_tc
    out = np.zeros((n_ch, target_points), dtype=np.float64)
    for i in range(n_ch):
        out[i] = signal.resample(seg[i], target_points)
    return out


def decode_window_fbcca(
    samples_st: np.ndarray,
    sampling_rate: float,
    frequencies: Sequence[float],
    *,
    phases: Sequence[float] | None = None,
    window_sec: float = 0.8,
    n_channels_use: int = 8,
    internal_fs: float = DEFAULT_FS,
) -> Tuple[int, np.ndarray, np.ndarray, np.ndarray]:
    """
    短窗在线解码：samples_st 为最近约 window_sec 的 (n_samples, n_channels)。
    内部重采样到 internal_fs、长度 round(internal_fs * window_sec)，再 FBCCA。

    Returns:
        predicted_index, scores, probabilities, prepared (channels × target_points)
    """
    if samples_st.ndim != 2:
        raise ValueError("samples_st 必须为 (n_samples, n_channels)")
    fs_in = float(sampling_rate)
    if fs_in <= 0:
        raise ValueError("采样率无效")
    want_n = max(1, int(round(fs_in * float(window_sec))))
    if samples_st.shape[0] < max(32, want_n // 4):
        raise ValueError(f"样本过少: {samples_st.shape[0]}")

    x = np.asarray(samples_st, dtype=np.float64)
    x = x[-want_n:, :] if x.shape[0] > want_n else x

    data_ct = x.T
    if data_ct.shape[0] < n_channels_use:
        pad = np.zeros((n_channels_use - data_ct.shape[0], data_ct.shape[1]))
        data_ct = np.vstack([data_ct, pad])
    else:
        data_ct = data_ct[:n_channels_use, :]

    target_pts = max(64, int(round(float(internal_fs) * float(window_sec))))
    prepared = prepare_fixed_duration(
        data_ct, fs_in, float(window_sec), target_pts
    )

    pred_idx, scores = fbcca_classify_multi(
        prepared, internal_fs, frequencies, phases=phases
    )
    probs = fbcca_scores_to_probabilities(scores)
    return pred_idx, scores, probs, prepared


def decode_window_fbcca_dual(
    samples_st: np.ndarray,
    sampling_rate: float,
    frequencies: Sequence[float],
    *,
    channel_indices: Sequence[int] | None = None,
    phases: Sequence[float] | None = None,
    window_sec: float = 0.8,
    n_channels_use: int = FBCCA_N_CHANNELS_USE,
    internal_fs: float = DEFAULT_FS,
) -> Tuple[int, np.ndarray, np.ndarray, np.ndarray, dict]:
    """
    短窗在线解码（刺激运行页）：仅块状复制为 8 路后 FBCCA，不做 CAR、不做多分支融合。
    融合与 CAR 会破坏短窗 softmax，且 2 路枕区 CAR 会抵消 SSVEP。
    """
    x = np.asarray(samples_st, dtype=np.float64)
    if x.ndim != 2:
        raise ValueError("samples_st 必须为 (n_samples, n_channels)")
    n_in = int(x.shape[1])
    phys = resolve_ssvep_phys_indices(channel_indices, n_in)
    plan = fbcca_channel_expansion_plan(channel_indices, n_in=n_in, n_out=n_channels_use)
    x8 = prepare_samples_for_fbcca_decode(x, channel_indices, n_out=n_channels_use)

    pred, scores, probs, prepared = decode_window_fbcca(
        x8,
        sampling_rate,
        frequencies,
        phases=phases,
        window_sec=window_sec,
        n_channels_use=n_channels_use,
        internal_fs=internal_fs,
    )
    meta = {
        "fbcca_channel_expansion": plan,
        "ssvep_channel_count": len(phys),
        "fbcca_fusion": "block8_online",
    }
    return pred, scores, probs, prepared, meta


def fbcca_classify(data: np.ndarray, fs: float = DEFAULT_FS) -> Tuple[int, np.ndarray]:
    """
    Args:
        data: channels × time_points（常为 8×1000）
        fs: 时间轴采样率，须与 ``data`` 的**物理时长**一致：
            ``fs = n_times / T``（例如整段 4 s×250 Hz→250；整段 3 s 重采样到 1000 点→1000/3）。

    Returns:
        (类别编号 1～8, 融合后长度 8 的得分向量，供调试)
    """
    if data.ndim != 2:
        raise ValueError("data 必须为二维")
    reference_signals = get_reference_signal(data.shape[1], fs)
    filtered = filter_bank(data, fs, short_window=data.shape[1] < 280)
    Nm = 3
    fb_coefs = [math.pow(i, -1.25) + 0.25 for i in range(1, Nm + 1)]
    result = np.zeros(8)
    for fb_i in range(Nm):
        x = filtered[fb_i, :, :]
        y = reference_signals
        w = fb_coefs[fb_i]
        result += w * (find_correlation(x, y) ** 2)

    predicted = int(np.argmax(result) + 1)
    return predicted, result.astype(float)


def classify_from_trial_samples_detailed(
    samples_st: np.ndarray,
    sampling_rate: float,
    *,
    channel_indices: Sequence[int] | None = None,
    n_channels_use: int = FBCCA_N_CHANNELS_USE,
    trim_head_sec: float = 0.0,
) -> tuple[int, np.ndarray, np.ndarray, dict]:
    """
    与 :func:`classify_from_trial_samples` 相同分类结果，另返回分析元数据（供 API / 调试）。

    元数据含 ``analysis_fs_hz``：试次短于 4 s 时按实际片段时长调整等效采样率，使正弦参考与
    重采样后的 1000 点物理时长一致。

    channel_indices: 设备管理里勾选的 SSVEP 通道；不足 8 路时循环复制为 8 路（与 decode_window 一致）。
    """
    if samples_st.ndim != 2:
        raise ValueError("samples_st 必须为 (n_samples, n_channels)")
    if trim_head_sec > 0 and samples_st.shape[0] > int(sampling_rate * (trim_head_sec + 2.0)):
        k = int(round(float(sampling_rate) * float(trim_head_sec)))
        samples_st = np.asarray(samples_st, dtype=np.float64)[k:, :]
    n_samples_in = int(samples_st.shape[0])
    n_device_ch = int(samples_st.shape[1])
    raw = np.asarray(samples_st, dtype=np.float64)
    phys = resolve_ssvep_phys_indices(channel_indices, n_device_ch)
    expansion_plan = fbcca_channel_expansion_plan(channel_indices, n_in=n_device_ch, n_out=n_channels_use)

    samples_8 = expand_samples_channel_replicate(raw, channel_indices, n_out=n_channels_use)
    data_8 = samples_8.T.astype(np.float64)
    prepared, segment_duration_sec = prepare_like_reference(data_8, sampling_rate)
    n_t = int(prepared.shape[1])
    fs_analysis = float(n_t) / max(segment_duration_sec, 1e-9)
    pred, scores = fbcca_classify(prepared, fs=fs_analysis)
    fusion = "block8_trial"

    n_phys = len(phys)
    w = _low_channel_ensemble_weight(n_phys, online=False)
    if w > 0 and n_phys < n_channels_use:
        samples_k = select_samples_channels(raw, phys)
        data_k = samples_k.T.astype(np.float64)
        prepared_k, _ = prepare_like_reference(data_k, sampling_rate)
        _pred_k, scores_k = fbcca_classify(prepared_k, fs=fs_analysis)
        scores = _fuse_fbcca_scores(scores, scores_k, w)
        pred = int(np.argmax(scores) + 1)
        fusion = f"block8+unique{n_phys}(w={w:.2f})"

    if n_phys == 2:
        samples_k = select_samples_channels(raw, phys)
        mono = np.mean(samples_k, axis=1, keepdims=True)
        samples_mono8 = expand_samples_channel_replicate(mono, [0], n_out=n_channels_use)
        data_m = samples_mono8.T.astype(np.float64)
        prepared_m, _ = prepare_like_reference(data_m, sampling_rate)
        _pred_m, scores_m = fbcca_classify(prepared_m, fs=fs_analysis)
        scores = _fuse_fbcca_scores(scores, scores_m, 0.28)
        pred = int(np.argmax(scores) + 1)
        fusion = fusion + "+mono2"

    max_seg_sec = float(max(1, int(round(float(sampling_rate) * 4))) / float(sampling_rate))
    meta = {
        "segment_duration_sec": float(segment_duration_sec),
        "analysis_fs_hz": float(fs_analysis),
        "resampled_num_samples": n_t,
        "trial_sample_count": n_samples_in,
        "max_segment_sec_cap": max_seg_sec,
        "fbcca_channel_expansion": expansion_plan,
        "ssvep_channel_count": n_phys,
        "fbcca_fusion": fusion,
    }
    return pred, prepared, scores, meta


def classify_from_trial_samples(
    samples_st: np.ndarray,
    sampling_rate: float,
    *,
    channel_indices: Sequence[int] | None = None,
    n_channels_use: int = FBCCA_N_CHANNELS_USE,
    trim_head_sec: float = 0.0,
) -> tuple[int, np.ndarray, np.ndarray]:
    """
    samples_st: (n_samples, n_channels) 时间 × 通道（与 WebSocket data 一致）
    trim_head_sec: 可选丢弃试次最前几秒；9_cca_withoutvideo.py 取 CSV 末尾 4s 前不做头部裁剪，默认 0 对齐参考。
    """
    pred, prepared, scores, _ = classify_from_trial_samples_detailed(
        samples_st,
        sampling_rate,
        channel_indices=channel_indices,
        n_channels_use=n_channels_use,
        trim_head_sec=trim_head_sec,
    )
    return pred, prepared, scores

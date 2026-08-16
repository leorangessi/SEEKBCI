"""专注度频段、眼电剔除与分数单元测试。"""
import numpy as np

from app.services.focus_monitor import (
    FocusMonitorSession,
    average_band_powers,
    compute_raw_metrics,
    preprocess_for_focus,
    remove_eog_regression,
)


def _synth(sr=250, sec=3.0, freqs_amps=None):
    t = np.arange(0, sec, 1 / sr)
    x = np.zeros_like(t)
    for f, a in freqs_amps or [(20.0, 1.0)]:
        x += a * np.sin(2 * np.pi * f * t)
    return np.column_stack([x, x * 0.9])


def test_beta_rich_has_higher_engagement_than_theta_rich():
    sr = 250
    beta_data = _synth(sr, 3.0, [(20.0, 1.2), (6.0, 0.2)])
    theta_data = _synth(sr, 3.0, [(6.0, 1.2), (20.0, 0.2)])
    b_beta = average_band_powers(beta_data, [0, 1], sr)
    b_theta = average_band_powers(theta_data, [0, 1], sr)
    m_beta = compute_raw_metrics(b_beta)
    m_theta = compute_raw_metrics(b_theta)
    assert m_beta["engagement"] > m_theta["engagement"]
    assert m_beta["beta_theta"] > m_theta["beta_theta"]


def test_session_score_range():
    sess = FocusMonitorSession(history_sec=30, ema_tau_sec=0.5)
    sr = 250
    data = _synth(sr, 2.5, [(18.0, 1.0), (10.0, 0.3)])
    for _ in range(12):
        out = sess.update(data, [0], sr)
    assert 0 <= out["focus_score"] <= 100
    assert out["level"]
    assert "beta" in out["bands"]
    assert out["preprocess"]["eog_removed"] is True


def test_eog_regression_reduces_correlated_blink():
    sr = 250
    sec = 3.0
    t = np.arange(0, sec, 1 / sr)
    # 模拟眨眼：低频大幅 VEOG
    veog = 80.0 * np.sin(2 * np.pi * 0.5 * t)
    eeg = 0.5 * np.sin(2 * np.pi * 18.0 * t)
    ch0 = eeg + veog
    ch1 = eeg * 0.8 + veog * 0.95
    data = np.column_stack([ch0, ch1])

    cleaned, stats = remove_eog_regression(data, [0, 1], [0, 1])
    assert stats["eog_regress_r2"] > 0.5
    # 剔除后 θ 相对功率应低于未处理
    raw_bands = average_band_powers(data, [0, 1], sr)
    clean_bands = average_band_powers(cleaned, [0, 1], sr)
    raw_m = compute_raw_metrics(raw_bands)
    clean_m = compute_raw_metrics(clean_bands)
    assert clean_m["theta_rel"] < raw_m["theta_rel"]


def test_preprocess_pipeline_marks_blink():
    sr = 250
    t = np.arange(0, 2.5, 1 / sr)
    blink = 200.0 * np.exp(-((t - 1.0) ** 2) / 0.002)
    data = np.column_stack([blink, blink * 0.9, 0.1 * np.sin(2 * np.pi * 10 * t)])
    _, meta = preprocess_for_focus(
        data,
        channel_indices=[0, 1],
        sampling_rate=sr,
        eog_reference_indices=[0, 1],
        ssvep_reference_indices=[2],
        remove_eog=True,
    )
    assert meta["filtered"] is True
    assert meta["eog_removed"] is True
    assert meta["ssvep_ref_subtracted"] is True
    assert meta["blink_heavy"] is True

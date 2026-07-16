# -*- coding: utf-8 -*-
"""FBCCA 试次时长与 analysis_fs 对齐（短试次不误用 250 Hz×4 s 参考轴）。"""
import numpy as np

import pytest

from app.services.fbcca_classify import (
    DEFAULT_NUM_SAMPLES,
    FBCCA_N_CHANNELS_USE,
    apply_ssvep_car,
    classify_from_trial_samples_detailed,
    expand_samples_channel_replicate,
    fbcca_channel_expansion_plan,
    prepare_samples_for_fbcca_decode,
    select_samples_channels,
)


def test_three_second_trial_uses_analysis_fs_over_250hz():
    fs = 250.0
    n = 750  # 3 s × 250 Hz
    rng = np.random.default_rng(42)
    samples_st = rng.standard_normal((n, 8))
    _pred, _prep, _scores, meta = classify_from_trial_samples_detailed(samples_st, fs)
    assert abs(meta["segment_duration_sec"] - 3.0) < 1e-9
    expect_fs = float(DEFAULT_NUM_SAMPLES) / 3.0
    assert abs(meta["analysis_fs_hz"] - expect_fs) < 1e-6
    assert meta["trial_sample_count"] == 750


def test_classify_trial_two_ssvep_channels_replicates():
    fs = 250.0
    n = 1000
    t = np.arange(n, dtype=np.float64) / fs
    ch0 = np.sin(2 * np.pi * 10.0 * t)
    ch1 = np.sin(2 * np.pi * 10.0 * t + 0.3)
    noise = np.random.default_rng(3).standard_normal((n, 6)) * 0.05
    samples_st = np.column_stack([ch0, ch1, noise])
    pred, _prep, _scores, meta = classify_from_trial_samples_detailed(
        samples_st, fs, channel_indices=[0, 1]
    )
    assert pred == 3  # 10 Hz -> class 3 (1-based index in 8..15 Hz targets)
    assert meta["fbcca_channel_expansion"] == [0, 0, 0, 0, 1, 1, 1, 1]
    assert "unique2" in meta.get("fbcca_fusion", "") or "mono2" in meta.get("fbcca_fusion", "")


def test_four_second_trial_matches_classic_250hz():
    fs = 250.0
    n = 1000
    rng = np.random.default_rng(1)
    samples_st = rng.standard_normal((n, 8))
    _pred, _prep, _scores, meta = classify_from_trial_samples_detailed(samples_st, fs)
    assert abs(meta["segment_duration_sec"] - 4.0) < 1e-9
    assert abs(meta["analysis_fs_hz"] - 250.0) < 1e-6


def test_long_trial_uses_last_four_seconds_only():
    fs = 250.0
    n = 1500  # 6 s
    rng = np.random.default_rng(2)
    samples_st = rng.standard_normal((n, 8))
    _pred, _prep, _scores, meta = classify_from_trial_samples_detailed(samples_st, fs)
    assert abs(meta["segment_duration_sec"] - 4.0) < 1e-9
    assert abs(meta["analysis_fs_hz"] - 250.0) < 1e-6


def test_select_samples_channels_four():
    x = np.arange(20, dtype=np.float64).reshape(5, 4)
    out = select_samples_channels(x, [0, 2, 3])
    assert out.shape == (5, 3)
    np.testing.assert_array_equal(out[:, 0], x[:, 0])
    np.testing.assert_array_equal(out[:, 1], x[:, 2])
    np.testing.assert_array_equal(out[:, 2], x[:, 3])


def test_prepare_samples_one_ssvep_channel_replicates_to_eight():
    x = np.random.default_rng(0).standard_normal((10, 8))
    out = prepare_samples_for_fbcca_decode(x, [2])
    assert out.shape == (10, 8)
    for k in range(8):
        np.testing.assert_array_equal(out[:, k], x[:, 2])


def test_block_expansion_two_channels():
    plan = fbcca_channel_expansion_plan([0, 1], n_in=8)
    assert plan == [0, 0, 0, 0, 1, 1, 1, 1]


def test_prepare_samples_two_channels_replicate():
    x = np.arange(40, dtype=np.float64).reshape(10, 4)
    plan = fbcca_channel_expansion_plan([0, 1], n_in=4)
    out = prepare_samples_for_fbcca_decode(x, [0, 1])
    assert out.shape == (10, 8)
    for col, src in enumerate(plan):
        np.testing.assert_array_equal(out[:, col], x[:, src])


@pytest.mark.parametrize("k", [1, 2, 3, 4, 5, 6, 7])
def test_prepare_samples_k_ssvep_channels_replicate_to_eight(k: int):
    rng = np.random.default_rng(k + 10)
    x = rng.standard_normal((12, 8))
    idx = list(range(k))
    plan = fbcca_channel_expansion_plan(idx, n_in=8, n_out=FBCCA_N_CHANNELS_USE)
    assert len(plan) == FBCCA_N_CHANNELS_USE
    out = prepare_samples_for_fbcca_decode(x, idx)
    assert out.shape == (12, FBCCA_N_CHANNELS_USE)
    for col, src in enumerate(plan):
        np.testing.assert_array_equal(out[:, col], x[:, src])


def test_prepare_samples_non_contiguous_three_channels():
    x = np.arange(80, dtype=np.float64).reshape(10, 8)
    idx = [1, 3, 6]
    plan = fbcca_channel_expansion_plan(idx, n_in=8)
    assert plan == [1, 1, 1, 3, 3, 3, 6, 6]
    out = prepare_samples_for_fbcca_decode(x, idx)
    for col, src in enumerate(plan):
        np.testing.assert_array_equal(out[:, col], x[:, src])


def test_expand_samples_channel_replicate_two_to_eight():
    x = np.arange(20, dtype=np.float64).reshape(5, 4)
    plan = fbcca_channel_expansion_plan([0, 1], n_in=4)
    out = expand_samples_channel_replicate(x, [0, 1])
    assert out.shape == (5, 8)
    for col, src in enumerate(plan):
        np.testing.assert_array_equal(out[:, col], x[:, src])

"""Cyton 扩展包（EEG+IMU）解析单元测试。"""
import numpy as np

from app.services.eeg_ble_bridge import (
    CytonStreamParser,
    PACKET_SIZE_V1,
    PACKET_SIZE_V2,
    parse_packet,
    scale_factor_uv,
)


def _make_v2(sample_number: int = 0, raw_counts=None, imu_i16=None) -> bytes:
    if raw_counts is None:
        raw_counts = [0] * 8
    if imu_i16 is None:
        imu_i16 = [0, 0, 1000, 0, 0, 0]  # az ≈ 1 m/s^2
    buf = bytearray(PACKET_SIZE_V2)
    buf[0] = 0xA0
    buf[1] = sample_number & 0xFF
    for i, c in enumerate(raw_counts):
        n = int(c) & 0xFFFFFF
        o = 2 + i * 3
        buf[o] = (n >> 16) & 0xFF
        buf[o + 1] = (n >> 8) & 0xFF
        buf[o + 2] = n & 0xFF
    for i, v in enumerate(imu_i16):
        x = int(v) & 0xFFFF
        o = 26 + i * 2
        buf[o] = (x >> 8) & 0xFF
        buf[o + 1] = x & 0xFF
    buf[38] = 0xC1
    return bytes(buf)


def _make_v1(sample_number: int = 0) -> bytes:
    buf = bytearray(PACKET_SIZE_V1)
    buf[0] = 0xA0
    buf[1] = sample_number & 0xFF
    buf[32] = 0xC0
    return bytes(buf)


def test_parse_v2_imu():
    pkt = _make_v2(1, [1000] + [0] * 7, [0, 0, 9807, 0, 0, 0])
    eeg, imu, sn = parse_packet(pkt, scale_factor_uv(24))
    assert eeg is not None and imu is not None and sn == 1
    assert abs(eeg[0] - 1000 * scale_factor_uv(24)) < 1e-9
    assert abs(imu["az"] - 9.807) < 1e-6


def test_parse_v1_compat():
    pkt = _make_v1(2)
    eeg, imu, sn = parse_packet(pkt, scale_factor_uv(24))
    assert eeg is not None and imu is None and sn == 2
    assert eeg.shape == (8,)


def test_stream_v2_reassembly():
    parser = CytonStreamParser(gain=24)
    blob = _make_v2(0) + _make_v2(1, imu_i16=[1000, 0, 0, 0, 0, 0])
    n, imus = parser.feed(blob[:20])
    assert n == 0
    n, imus = parser.feed(blob[20:])
    assert n == 2
    assert len(imus) == 2
    assert abs(imus[1]["ax"] - 1.0) < 1e-9
    arr = parser.pop_array(10)
    assert arr is not None and arr.shape == (2, 8)
    assert parser.seq_stats.packets_received == 2
    assert parser.seq_stats.packets_lost == 0


def test_battery_packet_interleaved():
    from app.services.eeg_ble_bridge import parse_battery_packet, BATTERY_PACKET_SIZE

    bat = bytes([0xB0, 0x0E, 0x74, 75, 0x00, 0xC2])  # 3700 mV, 75%
    info = parse_battery_packet(bat)
    assert info is not None
    assert info["voltage_mv"] == 3700
    assert info["percent"] == 75
    assert info["low"] is False

    parser = CytonStreamParser(gain=24)
    # 半包电量 + EEG + 电量完整，交错
    half = bat[:3]
    rest = bat[3:]
    n, _ = parser.feed(half + _make_v2(1)[:10])
    assert n == 0
    n, _ = parser.feed(_make_v2(1)[10:] + rest + bat)
    assert n == 1
    assert parser.last_battery is not None
    assert parser.last_battery["percent"] == 75
    assert parser.packets_ok == 1


def test_seq_loss_and_wrap():
    parser = CytonStreamParser(gain=24)
    parser.feed(_make_v2(10))
    parser.feed(_make_v2(12))  # 丢了 11
    assert parser.seq_stats.packets_received == 2
    assert parser.seq_stats.packets_lost == 1
    parser.feed(_make_v2(255))
    parser.feed(_make_v2(0))  # wrap，不丢
    # 从 12→255 丢了很多；255→0 正常
    assert parser.seq_stats.packets_lost >= 1
    # 直接造缺口：254 后接 1 → 丢 255,0（2 个）之前已有状态，另测干净实例
    p2 = CytonStreamParser(gain=24)
    p2.feed(_make_v2(254))
    p2.feed(_make_v2(1))
    assert p2.seq_stats.packets_lost == 2  # 255, 0
    assert p2.seq_stats.as_dict()["loss_rate_pct"] > 0

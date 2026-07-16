# -*- coding: utf-8 -*-
"""
测试后端改进功能
"""
import requests
import json
import sys
import io

# 设置输出编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE_URL = "http://localhost:8000/api/devices"

print("=" * 60)
print("Test Backend Device Management")
print("=" * 60)

# 1. 测试健康检查
print("\n[1] Test Health Check...")
try:
    response = requests.get("http://localhost:8000/health")
    print(f"[OK] Health: {response.json()}")
except Exception as e:
    print(f"[FAIL] Health check failed: {e}")

# 2. 测试串口扫描
print("\n[2] Test Serial Port Scan...")
try:
    response = requests.get(f"{BASE_URL}/scan/serial")
    data = response.json()
    print(f"[OK] Found {data['count']} serial ports")
    for device in data['devices']:
        print(f"   - {device['port']}: {device['description']}")
except Exception as e:
    print(f"[FAIL] Serial scan failed: {e}")

# 3. 测试 BrainFlow 设备列表
print("\n[3] Test BrainFlow Boards...")
try:
    response = requests.get(f"{BASE_URL}/boards/brainflow")
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Found {data['count']} BrainFlow boards")
        for board in data['boards']:
            print(f"   - {board['name']} (ID: {board['id']}, {board['channels']} channels)")
    else:
        print(f"[FAIL] BrainFlow API not found (status: {response.status_code})")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"[FAIL] BrainFlow test failed: {e}")

# 4. 测试设备状态
print("\n[4] Test Device Status...")
try:
    response = requests.get(f"{BASE_URL}/status")
    data = response.json()
    print(f"[OK] Device status: {data['status']}")
except Exception as e:
    print(f"[FAIL] Device status failed: {e}")

# 5. 测试信号处理模块
print("\n[5] Test Signal Processing...")
try:
    import sys
    sys.path.append('.')
    from app.services.signal_processor import signal_processor
    import numpy as np
    
    # 生成测试数据
    test_data = np.random.randn(1000, 8)
    
    # 测试去趋势
    detrended = signal_processor.detrend_signal(test_data)
    print(f"[OK] Detrend: {detrended.shape}")
    
    # 测试滤波
    filtered = signal_processor.bandpass_filter(test_data)
    print(f"[OK] Bandpass filter: {filtered.shape}")
    
    # 测试完整处理
    processed = signal_processor.process(test_data)
    print(f"[OK] Full processing: {processed.shape}")
    
except Exception as e:
    print(f"[FAIL] Signal processing test failed: {e}")

print("\n" + "=" * 60)
print("Test Complete!")
print("=" * 60)

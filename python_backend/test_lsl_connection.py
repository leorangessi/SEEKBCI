# -*- coding: utf-8 -*-
"""
LSL 连接诊断工具
"""
import sys
import io

# 设置输出编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 60)
print("LSL Connection Diagnostic Tool")
print("=" * 60)

# 1. 检查 pylsl 是否安装
print("\n[1] Checking pylsl installation...")
try:
    import pylsl
    print(f"[OK] pylsl version: {pylsl.__version__}")
except ImportError as e:
    print(f"[FAIL] pylsl not installed: {e}")
    print("Install with: pip install pylsl")
    sys.exit(1)

# 2. 扫描 LSL 流
print("\n[2] Scanning for LSL streams...")
print("Waiting 5 seconds for streams to appear...")

try:
    streams = pylsl.resolve_streams(wait_time=5.0)
    
    if len(streams) > 0:
        print(f"[OK] Found {len(streams)} LSL stream(s):")
        for i, stream in enumerate(streams):
            print(f"\n  Stream {i+1}:")
            print(f"    Name: {stream.name()}")
            print(f"    Type: {stream.type()}")
            print(f"    Channel Count: {stream.channel_count()}")
            print(f"    Sampling Rate: {stream.nominal_srate()} Hz")
            print(f"    Hostname: {stream.hostname()}")
            print(f"    Source ID: {stream.source_id()}")
    else:
        print("[WARN] No LSL streams found")
        print("\nPossible reasons:")
        print("  1. LSL device/software is not running")
        print("  2. Firewall is blocking LSL multicast")
        print("  3. Device is on a different network")
        print("  4. LSL service hasn't started yet")
        
except Exception as e:
    print(f"[FAIL] Error scanning streams: {e}")
    import traceback
    traceback.print_exc()

# 3. 尝试按名称解析
print("\n[3] Trying to resolve by name...")
common_names = ['OpenBCI_EEG', 'obci_eeg1', 'BioSemi', 'ActiChamp', 'EEG']

for name in common_names:
    try:
        print(f"  Searching for '{name}'...", end=" ")
        streams = pylsl.resolve_byprop('name', name, timeout=1.0)
        if streams:
            print(f"[FOUND] {len(streams)} stream(s)")
        else:
            print("[NOT FOUND]")
    except Exception as e:
        print(f"[ERROR] {e}")

# 4. 尝试按类型解析
print("\n[4] Trying to resolve by type...")
common_types = ['EEG', 'EMG', 'ECG', 'Markers']

for stream_type in common_types:
    try:
        print(f"  Searching for type '{stream_type}'...", end=" ")
        streams = pylsl.resolve_byprop('type', stream_type, timeout=1.0)
        if streams:
            print(f"[FOUND] {len(streams)} stream(s)")
        else:
            print("[NOT FOUND]")
    except Exception as e:
        print(f"[ERROR] {e}")

# 5. 网络信息
print("\n[5] Network information...")
try:
    import socket
    hostname = socket.gethostname()
    ip = socket.gethostbyname(hostname)
    print(f"  Hostname: {hostname}")
    print(f"  IP Address: {ip}")
except Exception as e:
    print(f"[ERROR] {e}")

print("\n" + "=" * 60)
print("Diagnostic Complete")
print("=" * 60)

print("\n[TIPS]")
print("If no streams found:")
print("  1. Make sure your LSL device/software is running")
print("  2. Check Windows Firewall settings")
print("  3. Try running this script as Administrator")
print("  4. Verify device and computer are on same network")
print("  5. Try restarting the LSL device/software")

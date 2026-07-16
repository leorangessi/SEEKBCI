"""
设备连接测试脚本
用于测试LSL、串口、WiFi连接功能
"""
import asyncio
import sys
sys.path.append('.')

from app.services.device_manager import device_manager


async def test_lsl():
    """测试LSL连接"""
    print("\n" + "="*50)
    print("测试 LSL 连接")
    print("="*50)
    
    # 扫描设备
    print("\n[1] 扫描LSL设备...")
    devices = device_manager.scan_lsl_devices()
    
    if devices:
        print(f"✅ 找到 {len(devices)} 个设备:")
        for device in devices:
            print(f"  - {device['name']} ({device['type']}, {device['channel_count']}通道, {device['sampling_rate']}Hz)")
        
        # 尝试连接第一个设备
        print(f"\n[2] 尝试连接: {devices[0]['name']}")
        success = device_manager.connect_lsl(devices[0]['name'])
        
        if success:
            print("✅ 连接成功!")
            print(f"设备信息: {device_manager.device_info}")
            
            # 读取数据
            print("\n[3] 读取1秒数据...")
            data = device_manager.read_data(duration=1.0)
            
            if data is not None:
                print(f"✅ 读取成功! 数据形状: {data.shape}")
                print(f"数据范围: {data.min():.2f} ~ {data.max():.2f}")
            else:
                print("❌ 读取数据失败")
            
            # 断开连接
            device_manager.disconnect()
            print("\n✅ 已断开连接")
        else:
            print("❌ 连接失败")
    else:
        print("❌ 未找到LSL设备")
        print("\n提示:")
        print("  1. 确保设备已开启")
        print("  2. 确保LSL服务正在运行")
        print("  3. 尝试运行 OpenBCI GUI 或其他LSL源")


async def test_serial():
    """测试串口连接"""
    print("\n" + "="*50)
    print("测试 串口 连接")
    print("="*50)
    
    # 扫描串口
    print("\n[1] 扫描串口...")
    devices = device_manager.scan_serial_ports()
    
    if devices:
        print(f"✅ 找到 {len(devices)} 个串口:")
        for device in devices:
            print(f"  - {device['port']}: {device['description']} ({device['manufacturer']})")
        
        # 提示用户选择
        print("\n提示: 请手动测试串口连接")
        print(f"示例: device_manager.connect_serial('{devices[0]['port']}', 115200)")
    else:
        print("❌ 未找到串口设备")
        print("\n提示:")
        print("  1. 确保设备已连接USB")
        print("  2. 确保驱动已安装")
        print("  3. 检查设备管理器")


async def test_wifi():
    """测试WiFi连接"""
    print("\n" + "="*50)
    print("测试 WiFi 连接")
    print("="*50)
    
    print("\n提示: WiFi连接需要设备IP和端口")
    print("示例: device_manager.connect_wifi('192.168.4.1', 12345, 'tcp')")


async def main():
    """主测试函数"""
    print("\n" + "="*60)
    print("  SSVEP Platform - 设备连接测试")
    print("="*60)
    
    # 测试LSL
    await test_lsl()
    
    # 测试串口
    await test_serial()
    
    # 测试WiFi
    await test_wifi()
    
    print("\n" + "="*60)
    print("测试完成!")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())

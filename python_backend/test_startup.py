# -*- coding: utf-8 -*-
import sys
import os
import io

# 设置输出编码为UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 60)
print("Test Backend Startup")
print("=" * 60)

# 测试导入
print("\n[1/5] Testing imports...")
try:
    import fastapi
    print("[OK] FastAPI:", fastapi.__version__)
except Exception as e:
    print("[FAIL] FastAPI import failed:", e)
    sys.exit(1)

try:
    import uvicorn
    print("[OK] Uvicorn:", uvicorn.__version__)
except Exception as e:
    print("[FAIL] Uvicorn import failed:", e)
    sys.exit(1)

try:
    from pydantic_settings import BaseSettings
    print("[OK] Pydantic Settings")
except Exception as e:
    print("[FAIL] Pydantic Settings import failed:", e)
    sys.exit(1)

print("\n[2/5] Testing config...")
try:
    from app.core.config import settings
    print("[OK] Config loaded")
    print("   APP_NAME:", settings.APP_NAME)
    print("   DEBUG:", settings.DEBUG)
except Exception as e:
    print("[FAIL] Config load failed:", e)
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n[3/5] Testing device manager...")
try:
    from app.services.device_manager import device_manager
    print("[OK] Device manager loaded")
except Exception as e:
    print("[FAIL] Device manager load failed:", e)
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n[4/5] Testing API routes...")
try:
    from app.api import devices
    print("[OK] API routes loaded")
except Exception as e:
    print("[FAIL] API routes load failed:", e)
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n[5/5] Testing main app...")
try:
    from app.main import app
    print("[OK] Main app loaded")
except Exception as e:
    print("[FAIL] Main app load failed:", e)
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 60)
print("[SUCCESS] All tests passed!")
print("=" * 60)
print("\nNow you can start the service:")
print("python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000")

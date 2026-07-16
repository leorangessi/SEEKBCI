from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
# 暂时注释掉API路由，先测试基础框架
# from app.api import auth, users, projects
from app.api import devices, ssvep, system, plaza, imu
from app.services.plaza_store import seed_demo_plaza_if_empty

# 创建FastAPI应用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="SSVEP Platform - 跨平台稳态视觉诱发电位脑机接口开发平台",
    debug=settings.DEBUG
)

# 配置 CORS：本地 DEBUG 放行所有来源（含 file://、127.0.0.1 与 localhost 任意端口）
# 若仅依赖 .env 白名单，从 127.0.0.1:8080 打开或双击 HTML 易导致浏览器报 Failed to fetch
if settings.DEBUG:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 注册路由
app.include_router(devices.router, prefix="/api/devices", tags=["设备管理"])
app.include_router(system.router, prefix="/api/system", tags=["系统"])
app.include_router(ssvep.router, prefix="/api/ssvep", tags=["SSVEP"])
app.include_router(imu.router, prefix="/api/imu", tags=["IMU"])
# 注册路由（暂时注释，等数据库配置好后再启用）
# app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
# app.include_router(users.router, prefix="/api/users", tags=["用户"])
app.include_router(plaza.router, prefix="/api/plaza", tags=["项目广场"])


@app.on_event("startup")
async def startup_seed_plaza_demo():
    try:
        n = seed_demo_plaza_if_empty()
        if n:
            print(f"[plaza] 已写入 {n} 个演示项目到项目广场")
    except Exception as e:
        print(f"[plaza] 演示数据初始化跳过: {e}")


from app.core.runtime_paths import resolve_frontend_dir


class DevNoCacheStaticFiles(StaticFiles):
    """开发时给前端静态资源加 no-store，避免 Electron 吃旧 HTML/JS。"""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if settings.DEBUG:
            response.headers["Cache-Control"] = "no-store, max-age=0"
        return response


# 与 API 同端口提供前端静态页（避免只开 uvicorn 时误以为 8000 能打开 HTML）
_FRONTEND_DIR = resolve_frontend_dir()
if _FRONTEND_DIR.is_dir():
    app.mount(
        "/ui",
        DevNoCacheStaticFiles(directory=str(_FRONTEND_DIR), html=True),
        name="frontend",
    )


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "Welcome to SSVEP Platform API",
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "project_manager": "/ui/project-manager.html",
        "project_plaza": "/ui/plaza.html",
        "profile": "/ui/profile.html",
        "note": "浏览器请打开 /ui/ 下页面；仅访问 / 为 JSON API。",
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import os
    import uvicorn
    from app.core.config import settings

    host = os.environ.get("SEEKBCi_API_HOST", settings.API_HOST)
    port = int(os.environ.get("SEEKBCi_API_PORT", str(settings.API_PORT)))
    uvicorn.run(app, host=host, port=port, reload=settings.DEBUG)

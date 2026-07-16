from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """应用配置"""
    
    # 应用信息
    APP_NAME: str = "SEEKBCI PLAT"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # 本地 API 绑定（默认 28765，避免占用常见 8000）
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 28765
    
    # 数据库配置
    DATABASE_URL: str = "postgresql://ssvep_user:ssvep_password@localhost:5432/ssvep_platform"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # JWT配置
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS配置
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost",
        "http://127.0.0.1",
        "*",  # 允许所有来源（开发环境）
    ]
    
    # 文件上传配置
    MAX_UPLOAD_SIZE: int = 10485760  # 10MB
    UPLOAD_DIR: str = "./uploads"
    
    # MinIO配置（可选）
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "ssvep-projects"
    
    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "./logs/app.log"

    # 项目广场管理员（下架）；生产环境务必修改
    SEEKBCi_ADMIN_KEY: str = "seekbci-admin-dev"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

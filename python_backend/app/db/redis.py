import redis
from app.core.config import settings

# 创建Redis连接池
redis_client = redis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True
)


def get_redis():
    """获取Redis客户端"""
    return redis_client

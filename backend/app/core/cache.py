# app/core/cache.py
import redis.asyncio as redis
import json
import logging
from typing import Any, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class CacheService:
    """Redis缓存服务类"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.connected = False
    
    async def connect(self):
        """连接到Redis服务器"""
        try:
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )
            # 测试连接
            await self.redis_client.ping()
            self.connected = True
            logger.info("Redis cache connected successfully")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.connected = False
    
    async def disconnect(self):
        """断开Redis连接"""
        if self.redis_client:
            await self.redis_client.close()
            self.connected = False
            logger.info("Redis cache disconnected")
    
    async def get(self, key: str) -> Any:
        """获取缓存值"""
        if not self.connected or not self.redis_client:
            return None
            
        try:
            value = await self.redis_client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: Any, expire: int = 3600):
        """设置缓存值"""
        if not self.connected or not self.redis_client:
            return False
            
        try:
            serialized_value = json.dumps(value, default=str)
            await self.redis_client.setex(key, expire, serialized_value)
            return True
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False
    
    async def delete(self, key: str):
        """删除缓存"""
        if not self.connected or not self.redis_client:
            return False
            
        try:
            await self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False
    
    async def exists(self, key: str) -> bool:
        """检查键是否存在"""
        if not self.connected or not self.redis_client:
            return False
            
        try:
            return bool(await self.redis_client.exists(key))
        except Exception as e:
            logger.error(f"Cache exists check error for key {key}: {e}")
            return False

# 全局缓存实例
cache_service = CacheService()
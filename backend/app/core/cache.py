# app/core/cache.py
import redis.asyncio as redis
import json
import logging
import pickle
from typing import Any, Optional, Dict
from datetime import datetime, timedelta
import hashlib
from functools import wraps
from app.core.config import settings

logger = logging.getLogger(__name__)

class EnhancedCacheService:
    """增强的Redis缓存服务类 - 类似Metabase的缓存策略"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.connected = False
        self.default_ttl = 3600  # 1小时默认过期时间
        
    async def connect(self):
        """连接到Redis服务器"""
        try:
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=False  # 使用bytes模式以支持pickle
            )
            # 测试连接
            await self.redis_client.ping()
            self.connected = True
            logger.info("Enhanced Redis cache connected successfully")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.connected = False
    
    async def disconnect(self):
        """断开Redis连接"""
        if self.redis_client:
            await self.redis_client.close()
            self.connected = False
            logger.info("Enhanced Redis cache disconnected")
    
    def generate_cache_key(self, query_hash: str, processing_steps: list = None) -> str:
        """生成缓存键，基于查询和处理步骤"""
        if processing_steps:
            steps_str = json.dumps(processing_steps, sort_keys=True)
            combined_hash = hashlib.md5(f"{query_hash}{steps_str}".encode()).hexdigest()
            return f"dataset:processed:{combined_hash}"
        return f"dataset:query:{query_hash}"
    
    async def get_cached_dataset(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """获取缓存的数据集"""
        if not self.connected or not self.redis_client:
            return None
            
        try:
            cached_data = await self.redis_client.get(cache_key)
            if cached_data:
                # 反序列化数据
                dataset_dict = pickle.loads(cached_data)
                
                # 检查是否过期
                if 'expires_at' in dataset_dict:
                    expires_at = datetime.fromisoformat(dataset_dict['expires_at'])
                    if datetime.now() > expires_at:
                        await self.delete(cache_key)
                        return None
                
                logger.info(f"Cache hit for key: {cache_key}")
                return dataset_dict
            return None
        except Exception as e:
            logger.warning(f"Failed to get cached dataset {cache_key}: {e}")
            return None
    
    async def cache_dataset(
        self, 
        cache_key: str, 
        dataset_data: Dict[str, Any], 
        ttl: int = None
    ) -> bool:
        """缓存数据集"""
        if not self.connected or not self.redis_client:
            return False
            
        try:
            # 设置过期时间
            expires_at = datetime.now() + timedelta(seconds=ttl or self.default_ttl)
            dataset_data['expires_at'] = expires_at.isoformat()
            dataset_data['cached_at'] = datetime.now().isoformat()
            
            # 序列化数据
            serialized_data = pickle.dumps(dataset_data)
            
            # 存储到Redis
            await self.redis_client.setex(
                cache_key, 
                ttl or self.default_ttl, 
                serialized_data
            )
            
            logger.info(f"Dataset cached successfully with key: {cache_key}")
            return True
        except Exception as e:
            logger.error(f"Failed to cache dataset {cache_key}: {e}")
            return False
    
    async def get(self, key: str) -> Any:
        """获取缓存值（保持向后兼容）"""
        if not self.connected or not self.redis_client:
            return None
            
        try:
            value = await self.redis_client.get(key)
            if value:
                return json.loads(value.decode('utf-8'))
            return None
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: Any, expire: int = 3600):
        """设置缓存值（保持向后兼容）"""
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
    
    async def get_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        if not self.connected or not self.redis_client:
            return {"enabled": False}
            
        try:
            info = await self.redis_client.info()
            keyspace = await self.redis_client.execute_command('INFO', 'keyspace')
            
            return {
                "enabled": True,
                "used_memory": info.get('used_memory_human', 'N/A'),
                "connected_clients": info.get('connected_clients', 0),
                "total_commands_processed": info.get('total_commands_processed', 0),
                "keyspace": str(keyspace) if keyspace else "N/A"
            }
        except Exception as e:
            logger.error(f"Failed to get cache stats: {e}")
            return {"enabled": True, "error": str(e)}

def cached_dataset(ttl: int = 3600):
    """装饰器：自动缓存数据集处理结果"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存键
            query_hash = hashlib.md5(
                f"{str(args)}{str(kwargs)}".encode()
            ).hexdigest()
            
            cache_key = cache_service.generate_cache_key(query_hash)
            
            # 尝试从缓存获取
            cached_result = await cache_service.get_cached_dataset(cache_key)
            if cached_result:
                return cached_result
            
            # 执行原始函数
            result = await func(*args, **kwargs)
            
            # 缓存结果
            if result:
                await cache_service.cache_dataset(cache_key, result, ttl)
            
            return result
        return wrapper
    return decorator

# 全局缓存实例
cache_service = EnhancedCacheService()
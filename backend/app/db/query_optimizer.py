# app/db/query_optimizer.py
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import logging
from typing import List, Dict, Any, Optional
from app.core.cache import cache_service

logger = logging.getLogger(__name__)

class QueryOptimizer:
    """数据库查询优化器"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def execute_with_cache(self, query: str, params: Dict = None, 
                               cache_key: str = None, expire: int = 300) -> List[Dict]:
        """带缓存的查询执行"""
        # 如果提供了缓存键，先尝试从缓存获取
        if cache_key:
            cached_result = await cache_service.get(cache_key)
            if cached_result is not None:
                logger.info(f"Cache hit for key: {cache_key}")
                return cached_result
        
        # 执行数据库查询
        try:
            result = await self.session.execute(text(query), params or {})
            columns = result.keys()
            rows = result.fetchall()
            
            # 转换为字典列表
            data = [dict(zip(columns, row)) for row in rows]
            
            # 如果有缓存键，将结果存入缓存
            if cache_key:
                await cache_service.set(cache_key, data, expire)
                logger.info(f"Cached result for key: {cache_key}")
            
            return data
            
        except Exception as e:
            logger.error(f"Query execution error: {e}")
            raise
    
    async def paginated_query(self, query: str, params: Dict = None, 
                            page: int = 1, page_size: int = 50) -> Dict[str, Any]:
        """分页查询优化"""
        offset = (page - 1) * page_size
        
        # 构造分页查询
        paginated_query = f"{query} LIMIT {page_size} OFFSET {offset}"
        
        try:
            # 执行分页查询
            result = await self.session.execute(text(paginated_query), params or {})
            columns = result.keys()
            rows = result.fetchall()
            
            # 获取总记录数
            count_query = f"SELECT COUNT(*) as total FROM ({query}) as count_table"
            count_result = await self.session.execute(text(count_query), params or {})
            total = count_result.scalar()
            
            return {
                "data": [dict(zip(columns, row)) for row in rows],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size
                }
            }
            
        except Exception as e:
            logger.error(f"Paginated query error: {e}")
            raise

# 使用示例装饰器
def cached_query(expire: int = 300, key_prefix: str = ""):
    """查询缓存装饰器"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            # 生成缓存键
            cache_key = f"{key_prefix}:{func.__name__}:{hash(str(args) + str(kwargs))}"
            
            # 尝试从缓存获取
            cached_result = await cache_service.get(cache_key)
            if cached_result is not None:
                return cached_result
            
            # 执行原函数
            result = await func(*args, **kwargs)
            
            # 存入缓存
            await cache_service.set(cache_key, result, expire)
            
            return result
        return wrapper
    return decorator
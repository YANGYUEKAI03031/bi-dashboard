
### 2. 后端API服务

# 新建文件：app/services/visualization_service.py
import json
import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
import aiomysql
import asyncpg

from app.models.visualization import VisualizationCard, DataSource
from app.core.cache import redis_client
from app.core.config import settings

class VisualizationService:
    def __init__(self, db_session: Session):
        self.db = db_session
        
    async def execute_query(self, data_source: DataSource, query: str, params: Dict = None) -> Dict[str, Any]:
        """执行数据查询"""
        try:
            if data_source.type == "mysql":
                return await self._execute_mysql_query(data_source, query, params)
            elif data_source.type == "postgresql":
                return await self._execute_postgresql_query(data_source, query, params)
            else:
                raise ValueError(f"不支持的数据源类型: {data_source.type}")
        except Exception as e:
            raise Exception(f"查询执行失败: {str(e)}")
    
    async def _execute_mysql_query(self, data_source: DataSource, query: str, params: Dict = None) -> Dict[str, Any]:
        """执行MySQL查询"""
        config = data_source.connection_config
        pool = await aiomysql.create_pool(
            host=config['host'],
            port=config.get('port', 3306),
            user=config['username'],
            password=config['password'],
            db=config['database'],
            charset='utf8mb4'
        )
        
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(query, params or {})
                columns = [desc[0] for desc in cursor.description]
                rows = await cursor.fetchall()
                
                return {
                    "columns": columns,
                    "rows": [dict(row) for row in rows],
                    "row_count": len(rows)
                }
    
    async def get_card_data(self, card_id: int) -> Dict[str, Any]:
        """获取卡片数据（带缓存）"""
        card = self.db.query(VisualizationCard).filter(VisualizationCard.id == card_id).first()
        if not card:
            raise ValueError("卡片不存在")
            
        cache_key = f"card_data:{card_id}"
        
        # 检查缓存
        if card.cache_enabled:
            cached_data = await redis_client.get(cache_key)
            if cached_data:
                return json.loads(cached_data)
        
        # 执行查询
        data_source = self.db.query(DataSource).filter(DataSource.id == card.data_source_id).first()
        raw_data = await self.execute_query(data_source, card.query_sql, card.query_params)
        
        # 缓存结果
        if card.cache_enabled:
            await redis_client.setex(
                cache_key, 
                card.cache_duration, 
                json.dumps(raw_data)
            )
            # 更新缓存时间戳
            card.last_cached_at = datetime.utcnow()
            self.db.commit()
        
        return raw_data
    
    def create_card(self, card_data: Dict[str, Any], user_id: int) -> VisualizationCard:
        """创建新的可视化卡片"""
        card = VisualizationCard(
            name=card_data['name'],
            description=card_data.get('description'),
            chart_type=card_data['chart_type'],
            config=card_data['config'],
            data_source_id=card_data['data_source_id'],
            query_sql=card_data['query_sql'],
            query_params=card_data.get('query_params'),
            cache_enabled=card_data.get('cache_enabled', True),
            cache_duration=card_data.get('cache_duration', 3600),
            created_by=user_id,
            is_public=card_data.get('is_public', False),
            tags=card_data.get('tags')
        )
        
        self.db.add(card)
        self.db.commit()
        self.db.refresh(card)
        return card
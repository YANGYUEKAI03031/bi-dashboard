# backend/app/services/chart_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, text
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging
from sqlalchemy.ext.asyncio import create_async_engine

from app.models.visualization import VisualizationCard, Database
from app.schemas.chart import ChartCreate, ChartUpdate
from app.core.security import get_current_user_id

logger = logging.getLogger(__name__)

class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_chart(self, chart_data: ChartCreate, user_id: int) -> VisualizationCard:
        """创建新图表 - 适配现有表结构"""
        try:
            # 安全地提取SQL查询语句和表名
            query_sql = ""
            table_name = None
            try:
                # 处理dataset_query可能是字典的情况
                dataset_dict = chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query
                
                if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                    native_config = dataset_dict['native']
                    if isinstance(native_config, dict) and 'query' in native_config:
                        query_sql = native_config['query'] or ""
                        
                        # 提取表名（从SQL中解析）
                        import re
                        from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', query_sql, re.IGNORECASE)
                        if from_clause:
                            table_name = from_clause.group(1)
            except Exception as e:
                logger.warning(f"提取SQL查询时出错: {e}")
                query_sql = ""
            
            # 为所有必填字段提供默认值
            chart = VisualizationCard(
                name=chart_data.name,
                description=chart_data.description or '',
                chart_type=chart_data.chart_type,
                dataset_query=json.dumps(chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query),
                visualization_settings=json.dumps(chart_data.visualization_settings.dict() if hasattr(chart_data.visualization_settings, 'dict') else chart_data.visualization_settings),
                config={},  # 为config字段提供默认值
                query_sql=query_sql,  # 安全提取的SQL语句
                table_name=table_name,  # 新增：表名信息
                data_source_id=chart_data.database_id,
                created_by=user_id,
                is_public=chart_data.is_public if hasattr(chart_data, 'is_public') else False,
                archived=False,
                public_uuid=None,
                cache_enabled=chart_data.cache_enabled if hasattr(chart_data, 'cache_enabled') else True,
                cache_duration=chart_data.cache_duration if hasattr(chart_data, 'cache_duration') else 3600,
                last_cached_at=None
            )
            
            self.db.add(chart)
            await self.db.commit()
            await self.db.refresh(chart)
            
            logger.info(f"图表创建成功: {chart.name} (ID: {chart.id})")
            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建图表失败: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"创建图表时发生未预期错误: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
    
    async def get_chart(self, chart_id: int, user_id: int) -> Optional[VisualizationCard]:
        """获取单个图表"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.created_by == user_id,
                VisualizationCard.archived == False
            )
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()
        except SQLAlchemyError as e:
            logger.error(f"获取图表失败: {str(e)}")
            raise Exception(f"获取图表失败: {str(e)}")
    
    async def get_user_charts(self, user_id: int, skip: int = 0, limit: int = 100) -> List[VisualizationCard]:
        """获取用户的所有图表"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.created_by == user_id,
                VisualizationCard.archived == False
            ).offset(skip).limit(limit)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except SQLAlchemyError as e:
            logger.error(f"获取用户图表列表失败: {str(e)}")
            raise Exception(f"获取用户图表列表失败: {str(e)}")
    
    async def update_chart(self, chart_id: int, update_data: ChartUpdate, user_id: int) -> Optional[VisualizationCard]:
        """更新图表"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return None
            
            # 更新字段
            update_fields = {}
            if update_data.name is not None:
                update_fields[VisualizationCard.name] = update_data.name
            if update_data.description is not None:
                update_fields[VisualizationCard.description] = update_data.description
            if update_data.chart_type is not None:
                update_fields[VisualizationCard.chart_type] = update_data.chart_type
            if update_data.dataset_query is not None:
                update_fields[VisualizationCard.dataset_query] = json.dumps(update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query)
                # 安全地提取并更新query_sql字段和table_name
                try:
                    dataset_dict = update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query
                    if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                        native_config = dataset_dict['native']
                        if isinstance(native_config, dict) and 'query' in native_config:
                            update_fields[VisualizationCard.query_sql] = native_config['query'] or ""
                            
                            # 提取表名（从SQL中解析）
                            import re
                            from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', native_config['query'], re.IGNORECASE)
                            if from_clause:
                                update_fields[VisualizationCard.table_name] = from_clause.group(1)
                            else:
                                update_fields[VisualizationCard.table_name] = None
                except Exception as e:
                    logger.warning(f"更新时提取SQL查询时出错: {e}")
            if update_data.visualization_settings is not None:
                update_fields[VisualizationCard.visualization_settings] = json.dumps(update_data.visualization_settings.dict() if hasattr(update_data.visualization_settings, 'dict') else update_data.visualization_settings)
            if update_data.database_id is not None:
                update_fields[VisualizationCard.data_source_id] = update_data.database_id
            if hasattr(update_data, 'is_public') and update_data.is_public is not None:
                update_fields[VisualizationCard.is_public] = update_data.is_public
            if hasattr(update_data, 'cache_enabled') and update_data.cache_enabled is not None:
                update_fields[VisualizationCard.cache_enabled] = update_data.cache_enabled
            if hasattr(update_data, 'cache_duration') and update_data.cache_duration is not None:
                update_fields[VisualizationCard.cache_duration] = update_data.cache_duration
            
            # 更新时间戳
            update_fields[VisualizationCard.updated_at] = datetime.utcnow()
            
            if update_fields:
                stmt = update(VisualizationCard).where(
                    VisualizationCard.id == chart_id,
                    VisualizationCard.created_by == user_id
                ).values(**{col.name: val for col, val in update_fields.items()})
                
                await self.db.execute(stmt)
                await self.db.commit()
                await self.db.refresh(chart)
                
                logger.info(f"图表更新成功: {chart.name} (ID: {chart.id})")
            
            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新图表失败: {str(e)}")
            raise Exception(f"更新图表失败: {str(e)}")
    
    async def delete_chart(self, chart_id: int, user_id: int) -> bool:
        """删除图表（软删除）"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return False
            
            # 软删除：标记为已归档
            stmt = update(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.created_by == user_id
            ).values(
                archived=True,
                updated_at=datetime.utcnow()
            )
            
            await self.db.execute(stmt)
            await self.db.commit()
            
            logger.info(f"图表软删除成功: {chart.name} (ID: {chart.id})")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除图表失败: {str(e)}")
            raise Exception(f"删除图表失败: {str(e)}")
    
    async def execute_chart_query(self, chart: VisualizationCard) -> List[Dict]:
        """执行图表的SQL查询"""
        try:
            # 解析dataset_query获取SQL
            dataset_query = chart.dataset_query
            if isinstance(dataset_query, str):
                dataset_query = json.loads(dataset_query)
            
            sql_query = dataset_query.get('native', {}).get('query', '')
            if not sql_query:
                return []
            
            # 获取数据源连接信息
            db_model = await self.db.get(Database, chart.data_source_id)
            if not db_model:
                raise Exception("数据源不存在")
            
            # 构建数据库连接URL
            db_url = f"mysql+aiomysql://{db_model.username}:{db_model.password}@{db_model.host}:{db_model.port}/{db_model.database_name}"
            
            # 创建临时连接执行查询
            temp_engine = create_async_engine(db_url)
            try:
                async with temp_engine.connect() as conn:
                    result = await conn.execute(text(sql_query))
                    rows = result.fetchall()
                    
                    # 转换为字典列表
                    columns = result.keys()
                    data = [dict(zip(columns, row)) for row in rows]
                    
                    return data
            finally:
                await temp_engine.dispose()
                
        except Exception as e:
            logger.error(f"执行查询失败: {str(e)}")
            raise Exception(f"查询执行失败: {str(e)}")
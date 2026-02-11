from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging

from app.models.visualization import VisualizationCard, Database
from app.schemas.chart import ChartCreate, ChartUpdate
from app.core.security import get_current_user_id

logger = logging.getLogger(__name__)

class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_chart(self, chart_data: ChartCreate, user_id: int) -> VisualizationCard:
        """创建新图表"""
        try:
            chart = VisualizationCard(
                name=chart_data.name,
                description=chart_data.description,
                chart_type=chart_data.chart_type,
                dataset_query=json.dumps(chart_data.dataset_query.dict()),
                visualization_settings=json.dumps(chart_data.visualization_settings.dict()),
                database_id=chart_data.database_id,
                creator_id=user_id,
                is_public=chart_data.is_public,
                cache_enabled=chart_data.cache_enabled,
                cache_duration=chart_data.cache_duration
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
    
    async def get_chart(self, chart_id: int, user_id: int) -> Optional[VisualizationCard]:
        """获取图表详情"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.creator_id == user_id
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
                VisualizationCard.creator_id == user_id,
                VisualizationCard.archived == False
            ).offset(skip).limit(limit)
            
            result = await self.db.execute(stmt)
            return result.scalars().all()
            
        except SQLAlchemyError as e:
            logger.error(f"获取图表列表失败: {str(e)}")
            raise Exception(f"获取图表列表失败: {str(e)}")
    
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
                update_fields[VisualizationCard.dataset_query] = json.dumps(update_data.dataset_query.dict())
            if update_data.visualization_settings is not None:
                update_fields[VisualizationCard.visualization_settings] = json.dumps(update_data.visualization_settings.dict())
            if update_data.database_id is not None:
                update_fields[VisualizationCard.database_id] = update_data.database_id
            if update_data.is_public is not None:
                update_fields[VisualizationCard.is_public] = update_data.is_public
            if update_data.cache_enabled is not None:
                update_fields[VisualizationCard.cache_enabled] = update_data.cache_enabled
            if update_data.cache_duration is not None:
                update_fields[VisualizationCard.cache_duration] = update_data.cache_duration
            
            # 更新时间戳
            update_fields[VisualizationCard.updated_at] = datetime.utcnow()
            
            if update_fields:
                stmt = update(VisualizationCard).where(
                    VisualizationCard.id == chart_id,
                    VisualizationCard.creator_id == user_id
                ).values(**update_fields)
                
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
        """删除图表"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return False
            
            await self.db.delete(chart)
            await self.db.commit()
            
            logger.info(f"图表删除成功: {chart.name} (ID: {chart.id})")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除图表失败: {str(e)}")
            raise Exception(f"删除图表失败: {str(e)}")
    
    async def archive_chart(self, chart_id: int, user_id: int) -> Optional[VisualizationCard]:
        """归档图表"""
        try:
            stmt = update(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.creator_id == user_id
            ).values(
                archived=True,
                updated_at=datetime.utcnow()
            )
            
            result = await self.db.execute(stmt)
            await self.db.commit()
            
            if result.rowcount > 0:
                # 获取更新后的图表
                updated_chart = await self.get_chart(chart_id, user_id)
                logger.info(f"图表归档成功: ID {chart_id}")
                return updated_chart
                
            return None
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"归档图表失败: {str(e)}")
            raise Exception(f"归档图表失败: {str(e)}")
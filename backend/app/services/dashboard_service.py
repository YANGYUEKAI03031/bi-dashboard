# backend/app/services/dashboard_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging

from app.models.dashboard import Dashboard, DashboardCard, DashboardTab
from app.models.visualization import VisualizationCard
from app.schemas.dashboard import (
    DashboardCreate, DashboardUpdate, 
    DashboardCardCreate, DashboardCardUpdate
)

logger = logging.getLogger(__name__)

class DashboardService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_dashboard(self, dashboard_data: DashboardCreate, user_id: int) -> Dashboard:
        """创建新仪表板"""
        try:
            dashboard = Dashboard(
                name=dashboard_data.name,
                description=dashboard_data.description,
                layout=json.dumps(dashboard_data.layout) if dashboard_data.layout else None,
                settings=json.dumps(dashboard_data.settings) if dashboard_data.settings else None,
                creator_id=user_id,
                is_public=dashboard_data.is_public
            )
            
            self.db.add(dashboard)
            await self.db.commit()
            await self.db.refresh(dashboard)
            
            logger.info(f"仪表板创建成功: {dashboard.name} (ID: {dashboard.id})")
            return dashboard
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建仪表板失败: {str(e)}")
            raise Exception(f"创建仪表板失败: {str(e)}")
    
    async def get_dashboard(self, dashboard_id: int, user_id: int) -> Optional[Dashboard]:
        """获取仪表板详情（包含卡片和图表信息）"""
        try:
            # 使用selectinload预加载关联数据
            stmt = select(Dashboard).options(
                selectinload(Dashboard.dashboard_cards).selectinload(DashboardCard.chart)
            ).where(
                Dashboard.id == dashboard_id,
                Dashboard.creator_id == user_id
            )
            
            result = await self.db.execute(stmt)
            dashboard = result.scalar_one_or_none()
            
            if dashboard:
                # 确保cards属性存在并包含关联的图表数据
                if not hasattr(dashboard, 'cards') or dashboard.cards is None:
                    dashboard.cards = dashboard.dashboard_cards
                    
                # 确保每个卡片都有chart数据
                for card in dashboard.cards:
                    if not hasattr(card, 'chart') or card.chart is None:
                        # 如果关联数据没有正确加载，手动查询
                        chart_stmt = select(VisualizationCard).where(
                            VisualizationCard.id == card.chart_id
                        )
                        chart_result = await self.db.execute(chart_stmt)
                        card.chart = chart_result.scalar_one_or_none()
            
            return dashboard
            
        except SQLAlchemyError as e:
            logger.error(f"获取仪表板失败: {str(e)}")
            raise Exception(f"获取仪表板失败: {str(e)}")
    
    async def get_user_dashboards(self, user_id: int, skip: int = 0, limit: int = 100) -> List[Dashboard]:
        """获取用户的所有仪表板（包含完整关联数据）"""
        try:
            # 使用selectinload预加载所有关联数据
            stmt = select(Dashboard).options(
                selectinload(Dashboard.dashboard_cards).selectinload(DashboardCard.chart)
            ).where(
                Dashboard.creator_id == user_id,
                Dashboard.archived == False
            ).offset(skip).limit(limit)
            
            result = await self.db.execute(stmt)
            dashboards = result.scalars().all()
            
            # 确保每个仪表板的cards属性被正确设置
            for dashboard in dashboards:
                if not hasattr(dashboard, 'cards') or dashboard.cards is None:
                    dashboard.cards = dashboard.dashboard_cards
                    
                # 确保每个卡片都有chart数据
                for card in dashboard.cards:
                    if not hasattr(card, 'chart') or card.chart is None:
                        # 如果关联数据没有正确加载，手动查询
                        chart_stmt = select(VisualizationCard).where(
                            VisualizationCard.id == card.chart_id
                        )
                        chart_result = await self.db.execute(chart_stmt)
                        card.chart = chart_result.scalar_one_or_none()
            
            return dashboards
            
        except SQLAlchemyError as e:
            logger.error(f"获取仪表板列表失败: {str(e)}")
            raise Exception(f"获取仪表板列表失败: {str(e)}")
    
    async def add_chart_to_dashboard(self, dashboard_id: int, card_data: DashboardCardCreate, user_id: int) -> DashboardCard:
        """向仪表板添加图表"""
        try:
            # 验证仪表板属于用户
            dashboard = await self.get_dashboard(dashboard_id, user_id)
            if not dashboard:
                raise Exception("仪表板不存在或无权限访问")
            
            # 验证图表存在且属于用户
            chart_stmt = select(VisualizationCard).where(
                VisualizationCard.id == card_data.chart_id,
                VisualizationCard.created_by == user_id
            )
            chart_result = await self.db.execute(chart_stmt)
            chart = chart_result.scalar_one_or_none()
            if not chart:
                raise Exception("图表不存在或无权限访问")
            
            # 创建仪表板卡片
            dashboard_card = DashboardCard(
                dashboard_id=dashboard_id,
                chart_id=card_data.chart_id,
                card_row=card_data.card_row,
                card_col=card_data.card_col,
                size_x=card_data.size_x,
                size_y=card_data.size_y,
                visualization_settings=json.dumps(card_data.visualization_settings) if card_data.visualization_settings else None,
                parameter_mappings=json.dumps(card_data.parameter_mappings) if card_data.parameter_mappings else None
            )
            
            self.db.add(dashboard_card)
            await self.db.commit()
            await self.db.refresh(dashboard_card)
            
            # 手动加载关联的图表数据
            dashboard_card.chart = chart
            
            logger.info(f"图表添加到仪表板成功: 仪表板ID {dashboard_id}, 图表ID {card_data.chart_id}")
            return dashboard_card
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"添加图表到仪表板失败: {str(e)}")
            raise Exception(f"添加图表到仪表板失败: {str(e)}")
    
    async def update_dashboard_card(self, card_id: int, update_data: DashboardCardUpdate, user_id: int) -> Optional[DashboardCard]:
        """更新仪表板卡片位置和设置"""
        try:
            # 验证卡片属于用户的仪表板
            card_stmt = select(DashboardCard).join(Dashboard).where(
                DashboardCard.id == card_id,
                Dashboard.creator_id == user_id
            )
            card_result = await self.db.execute(card_stmt)
            card = card_result.scalar_one_or_none()
            
            if not card:
                return None
            
            # 更新字段
            # 注意：SQLAlchemy 的 values(**kwargs) 要求 kwargs 的 key 必须是字符串
            # 之前使用 Column 作为 key 会触发 TypeError: keywords must be strings
            update_fields: Dict[str, Any] = {}
            if update_data.card_row is not None:
                update_fields["card_row"] = update_data.card_row
            if update_data.card_col is not None:
                update_fields["card_col"] = update_data.card_col
            if update_data.size_x is not None:
                update_fields["size_x"] = update_data.size_x
            if update_data.size_y is not None:
                update_fields["size_y"] = update_data.size_y
            if update_data.visualization_settings is not None:
                # 模型字段类型是 JSON，直接存 dict 即可
                update_fields["visualization_settings"] = update_data.visualization_settings
            if update_data.parameter_mappings is not None:
                update_fields["parameter_mappings"] = update_data.parameter_mappings
            
            # 更新时间戳
            update_fields["updated_at"] = datetime.utcnow()
            
            if update_fields:
                stmt = update(DashboardCard).where(
                    DashboardCard.id == card_id
                ).values(update_fields)
                
                await self.db.execute(stmt)
                await self.db.commit()
                await self.db.refresh(card)
                
                logger.info(f"仪表板卡片更新成功: ID {card_id}")
            
            return card
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新仪表板卡片失败: {str(e)}")
            raise Exception(f"更新仪表板卡片失败: {str(e)}")
    
    async def remove_chart_from_dashboard(self, card_id: int, user_id: int) -> bool:
        """从仪表板移除图表"""
        try:
            # 验证卡片属于用户的仪表板
            card_stmt = select(DashboardCard).join(Dashboard).where(
                DashboardCard.id == card_id,
                Dashboard.creator_id == user_id
            )
            card_result = await self.db.execute(card_stmt)
            card = card_result.scalar_one_or_none()
            
            if not card:
                return False
            
            await self.db.delete(card)
            await self.db.commit()
            
            logger.info(f"图表从仪表板移除成功: 卡片ID {card_id}")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"移除图表失败: {str(e)}")
            raise Exception(f"移除图表失败: {str(e)}")
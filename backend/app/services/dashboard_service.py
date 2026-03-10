# backend/app/services/dashboard_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging

from app.models.dashboard import Dashboard, DashboardCard, DashboardTab, DashboardFilter, DashboardFilterBinding
from app.models.visualization import VisualizationCard
from app.models.report_page import ReportPageDashboard
from app.schemas.dashboard import (
    DashboardCreate, DashboardUpdate, 
    DashboardCardCreate, DashboardCardUpdate,
    DashboardFilterCreate, DashboardFilterUpdate, DashboardFilterBindingCreate
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
                # 模型字段类型是 JSON，直接存 dict/list 即可（不要 json.dumps）
                layout=dashboard_data.layout if dashboard_data.layout else None,
                settings=dashboard_data.settings if dashboard_data.settings else None,
                creator_id=user_id,
                is_public=dashboard_data.is_public
            )
            
            self.db.add(dashboard)
            await self.db.commit()
            await self.db.refresh(dashboard)

            # 用 selectinload 重新查询，确保所有关系都已预加载（避免序列化时触发懒加载）
            stmt = select(Dashboard).options(
                selectinload(Dashboard.dashboard_cards).selectinload(DashboardCard.chart),
                selectinload(Dashboard.filters).selectinload(DashboardFilter.bindings),
            ).where(Dashboard.id == dashboard.id)
            result = await self.db.execute(stmt)
            dashboard = result.scalar_one()
            
            # 记录创建操作
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="dashboard",
                resource_id=dashboard.id,
                resource_name=dashboard.name,
                action="create",
                changes={"new": {"name": dashboard.name}}
            )
            
            logger.info(f"仪表板创建成功: {dashboard.name} (ID: {dashboard.id})")
            return dashboard
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建仪表板失败: {str(e)}")
            raise Exception(f"创建仪表板失败: {str(e)}")

    async def update_dashboard(
        self,
        dashboard_id: int,
        dashboard_data: DashboardUpdate,
        user_id: int
    ) -> Optional[Dashboard]:
        """更新仪表板基本信息/布局/设置"""
        try:
            stmt = select(Dashboard).where(
                Dashboard.id == dashboard_id
            )
            result = await self.db.execute(stmt)
            dashboard = result.scalar_one_or_none()

            if not dashboard:
                return None

            # 权限检查：仅创建者或管理员可以编辑
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            if not await perm_service.can_edit_dashboard(user_id, dashboard.creator_id):
                raise PermissionError("无权限编辑此仪表盘，只有创建者或管理员可以编辑")

            # 记录修改前的数据
            old_data = {
                "name": dashboard.name,
                "description": dashboard.description,
            }

            update_fields: Dict[str, Any] = {}
            if dashboard_data.name is not None:
                update_fields["name"] = dashboard_data.name
            if dashboard_data.description is not None:
                update_fields["description"] = dashboard_data.description
            if dashboard_data.layout is not None:
                update_fields["layout"] = dashboard_data.layout
            if dashboard_data.settings is not None:
                update_fields["settings"] = dashboard_data.settings
            if dashboard_data.is_public is not None:
                update_fields["is_public"] = dashboard_data.is_public

            update_fields["updated_at"] = datetime.utcnow()

            if update_fields:
                upd = update(Dashboard).where(
                    Dashboard.id == dashboard_id
                ).values(update_fields)
                await self.db.execute(upd)
                await self.db.commit()

            # 记录修改操作
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="dashboard",
                resource_id=dashboard_id,
                resource_name=dashboard.name,
                action="update",
                changes={"old": old_data, "new": update_fields}
            )

            return await self.get_dashboard(dashboard_id, user_id)

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新仪表板失败: {str(e)}")
            raise Exception(f"更新仪表板失败: {str(e)}")
    
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
                # 模型字段类型是 JSON，直接存 dict/list 即可（不要 json.dumps）
                visualization_settings=card_data.visualization_settings if card_data.visualization_settings else None,
                parameter_mappings=card_data.parameter_mappings if card_data.parameter_mappings else None
            )
            
            self.db.add(dashboard_card)
            await self.db.commit()
            await self.db.refresh(dashboard_card)
            
            # 手动加载关联的图表数据
            dashboard_card.chart = chart
            
            # 自动绑定到已有的筛选器
            await self.bind_filter_to_new_card(dashboard_card.id, dashboard_id)
            
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
            card_stmt = select(DashboardCard).options(
                # 预加载 chart，避免在路由层访问 card.chart 时触发异步懒加载（MissingGreenlet）
                selectinload(DashboardCard.chart)
            ).join(Dashboard).where(
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

                # 重新查询并预加载 chart，保证返回对象不会在序列化阶段触发懒加载
                refreshed_result = await self.db.execute(card_stmt)
                card = refreshed_result.scalar_one_or_none()
                
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
            
            delete_stmt = delete(DashboardCard).where(DashboardCard.id == card_id)
            await self.db.execute(delete_stmt)
            await self.db.commit()
            
            logger.info(f"图表从仪表板移除成功: 卡片ID {card_id}")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"移除图表失败: {str(e)}")
            raise Exception(f"移除图表失败: {str(e)}")
    
    async def delete_dashboard(self, dashboard_id: int, user_id: int) -> bool:
        """删除仪表板（软删除：标记为已归档，同时删除报表页关联记录）"""
        try:
            # 验证仪表板属于用户
            dashboard_stmt = select(Dashboard).where(
                Dashboard.id == dashboard_id
            )
            dashboard_result = await self.db.execute(dashboard_stmt)
            dashboard = dashboard_result.scalar_one_or_none()
            
            if not dashboard:
                return False
            
            # 权限检查：仅创建者或管理员可以删除
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            if not await perm_service.can_delete_dashboard(user_id, dashboard.creator_id):
                raise PermissionError("无权限删除此仪表盘，只有创建者或管理员可以删除")
            
            # 删除报表页与仪表盘的关联记录
            delete_rpd_stmt = delete(ReportPageDashboard).where(
                ReportPageDashboard.dashboard_id == dashboard_id
            )
            await self.db.execute(delete_rpd_stmt)
            logger.info(f"已删除仪表盘 {dashboard_id} 的所有报表页关联记录")
            
            # 软删除：标记为已归档
            stmt = update(Dashboard).where(
                Dashboard.id == dashboard_id
            ).values(
                archived=True,
                updated_at=datetime.utcnow()
            )
            
            await self.db.execute(stmt)
            await self.db.commit()
            
            # 记录删除操作
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="dashboard",
                resource_id=dashboard_id,
                resource_name=dashboard.name,
                action="delete",
                changes={"old": {"name": dashboard.name, "archived": dashboard.archived}}
            )
            
            logger.info(f"仪表板软删除成功: {dashboard.name} (ID: {dashboard_id})")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除仪表板失败: {str(e)}")
            raise Exception(f"删除仪表板失败: {str(e)}")

    # ============ 筛选器相关方法 ============

    async def create_filter(self, dashboard_id: int, filter_data: DashboardFilterCreate, user_id: int) -> DashboardFilter:
        """创建筛选器"""
        try:
            # 验证仪表板属于用户
            dashboard_stmt = select(Dashboard).where(
                Dashboard.id == dashboard_id,
                Dashboard.creator_id == user_id
            )
            dashboard_result = await self.db.execute(dashboard_stmt)
            dashboard = dashboard_result.scalar_one_or_none()
            
            if not dashboard:
                raise Exception("仪表板不存在或无权限访问")
            
            # 创建筛选器
            filter_obj = DashboardFilter(
                dashboard_id=dashboard_id,
                dashboard_tab_id=filter_data.dashboard_tab_id,
                name=filter_data.name,
                filter_type=filter_data.filter_type,
                field_name=filter_data.field_name,
                field_label=filter_data.field_label,
                data_source_id=filter_data.data_source_id,
                options_table=filter_data.options_table,
                options_field=filter_data.options_field,
                options_sql=filter_data.options_sql,
                default_value=filter_data.default_value,
                position=filter_data.position
            )
            
            self.db.add(filter_obj)
            await self.db.commit()
            await self.db.refresh(filter_obj)
            
            # 自动绑定相关图表
            await self._auto_bind_filter_to_charts(filter_obj, dashboard_id)
            
            logger.info(f"筛选器创建成功: {filter_obj.name} (ID: {filter_obj.id})")
            return filter_obj
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建筛选器失败: {str(e)}")
            raise Exception(f"创建筛选器失败: {str(e)}")

    async def _auto_bind_filter_to_charts(self, filter_obj: DashboardFilter, dashboard_id: int):
        """自动根据 SQL 中的字段名，将筛选器绑定到相关图表卡片。"""
        try:
            cards_stmt = select(DashboardCard).where(
                DashboardCard.dashboard_id == dashboard_id
            )
            cards_result = await self.db.execute(cards_stmt)
            cards = cards_result.scalars().all()

            filter_field = (filter_obj.field_name or "").lower()
            if not filter_field:
                return

            import re

            for card in cards:
                chart_stmt = select(VisualizationCard).where(
                    VisualizationCard.id == card.chart_id
                )
                chart_result = await self.db.execute(chart_stmt)
                chart = chart_result.scalar_one_or_none()

                if not chart:
                    continue

                # 优先使用已解析好的 query_sql；如果没有，则从 dataset_query 中尝试提取
                sql_query = getattr(chart, "query_sql", None) or ""
                if not sql_query and chart.dataset_query:
                    try:
                        sql_data = chart.dataset_query
                        if isinstance(sql_data, str):
                            import json
                            sql_data = json.loads(sql_data)
                        if isinstance(sql_data, dict):
                            sql_query = sql_data.get("native", {}).get("query", "") or ""
                    except Exception:
                        sql_query = ""

                sql_lower = sql_query.lower()
                if not sql_lower:
                    continue

                where_pos = sql_lower.find("where")
                if where_pos != -1:
                    where_clause = sql_lower[where_pos:]
                else:
                    where_clause = sql_lower

                pattern = r"(?:^|[\s\(\[\{,]|\b)" + re.escape(filter_field) + r"(?:[\s\)\]\}\.,]|$)"
                if not re.search(pattern, where_clause):
                    continue

                existing_binding_stmt = select(DashboardFilterBinding).where(
                    DashboardFilterBinding.filter_id == filter_obj.id,
                    DashboardFilterBinding.card_id == card.id
                )
                existing_result = await self.db.execute(existing_binding_stmt)
                existing_binding = existing_result.scalar_one_or_none()

                if not existing_binding:
                    binding = DashboardFilterBinding(
                        filter_id=filter_obj.id,
                        card_id=card.id,
                        param_name=filter_obj.field_name,
                    )
                    self.db.add(binding)

            await self.db.commit()
            logger.info(f"筛选器自动绑定完成: 筛选器ID {filter_obj.id}")

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"自动绑定筛选器失败: {str(e)}")
            raise Exception(f"自动绑定筛选器失败: {str(e)}")

    async def get_filters(self, dashboard_id: int, user_id: int) -> List[DashboardFilter]:
        """获取仪表板的所有筛选器"""
        try:
            # 验证仪表板属于用户
            dashboard_stmt = select(Dashboard).where(
                Dashboard.id == dashboard_id,
                Dashboard.creator_id == user_id
            )
            dashboard_result = await self.db.execute(dashboard_stmt)
            dashboard = dashboard_result.scalar_one_or_none()
            
            if not dashboard:
                raise Exception("仪表板不存在或无权限访问")
            
            # 获取筛选器及其绑定关系
            stmt = select(DashboardFilter).options(
                selectinload(DashboardFilter.bindings)
            ).where(
                DashboardFilter.dashboard_id == dashboard_id
            ).order_by(DashboardFilter.position)
            
            result = await self.db.execute(stmt)
            filters = result.scalars().all()
            
            return filters
            
        except SQLAlchemyError as e:
            logger.error(f"获取筛选器失败: {str(e)}")
            raise Exception(f"获取筛选器失败: {str(e)}")

    async def get_filter(self, filter_id: int, user_id: int) -> Optional[DashboardFilter]:
        """获取单个筛选器详情"""
        try:
            stmt = select(DashboardFilter).options(
                selectinload(DashboardFilter.bindings)
            ).join(Dashboard).where(
                DashboardFilter.id == filter_id,
                Dashboard.creator_id == user_id
            )
            
            result = await self.db.execute(stmt)
            filter_obj = result.scalar_one_or_none()
            
            return filter_obj
            
        except SQLAlchemyError as e:
            logger.error(f"获取筛选器失败: {str(e)}")
            raise Exception(f"获取筛选器失败: {str(e)}")

    async def update_filter(self, filter_id: int, filter_data: DashboardFilterUpdate, user_id: int) -> Optional[DashboardFilter]:
        """更新筛选器"""
        try:
            filter_obj = await self.get_filter(filter_id, user_id)
            if not filter_obj:
                return None
            
            # 更新字段
            update_fields: Dict[str, Any] = {}
            if filter_data.name is not None:
                update_fields["name"] = filter_data.name
            if filter_data.filter_type is not None:
                update_fields["filter_type"] = filter_data.filter_type
            if filter_data.field_name is not None:
                update_fields["field_name"] = filter_data.field_name
            if filter_data.field_label is not None:
                update_fields["field_label"] = filter_data.field_label
            if filter_data.dashboard_tab_id is not None:
                update_fields["dashboard_tab_id"] = filter_data.dashboard_tab_id
            if filter_data.data_source_id is not None:
                update_fields["data_source_id"] = filter_data.data_source_id
            if filter_data.options_table is not None:
                update_fields["options_table"] = filter_data.options_table
            if filter_data.options_field is not None:
                update_fields["options_field"] = filter_data.options_field
            if filter_data.options_sql is not None:
                update_fields["options_sql"] = filter_data.options_sql
            if filter_data.default_value is not None:
                update_fields["default_value"] = filter_data.default_value
            if filter_data.position is not None:
                update_fields["position"] = filter_data.position
            
            update_fields["updated_at"] = datetime.utcnow()
            
            if update_fields:
                stmt = update(DashboardFilter).where(
                    DashboardFilter.id == filter_id
                ).values(update_fields)
                
                await self.db.execute(stmt)
                await self.db.commit()
                
                # 重新获取更新后的筛选器
                filter_obj = await self.get_filter(filter_id, user_id)
                
                logger.info(f"筛选器更新成功: ID {filter_id}")
            
            return filter_obj
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新筛选器失败: {str(e)}")
            raise Exception(f"更新筛选器失败: {str(e)}")

    async def delete_filter(self, filter_id: int, user_id: int) -> bool:
        """删除筛选器"""
        try:
            filter_obj = await self.get_filter(filter_id, user_id)
            if not filter_obj:
                return False
            
            # 删除筛选器（级联删除绑定关系）
            delete_stmt = delete(DashboardFilter).where(DashboardFilter.id == filter_id)
            await self.db.execute(delete_stmt)
            await self.db.commit()
            
            logger.info(f"筛选器删除成功: ID {filter_id}")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除筛选器失败: {str(e)}")
            raise Exception(f"删除筛选器失败: {str(e)}")

    async def bind_filter_to_card(self, filter_id: int, binding_data: DashboardFilterBindingCreate, user_id: int) -> Optional[DashboardFilterBinding]:
        """手动绑定筛选器到图表卡片"""
        try:
            # 验证筛选器属于用户的仪表板
            filter_obj = await self.get_filter(filter_id, user_id)
            if not filter_obj:
                raise Exception("筛选器不存在或无权限访问")
            
            # 验证卡片属于用户的仪表板
            card_stmt = select(DashboardCard).join(Dashboard).where(
                DashboardCard.id == binding_data.card_id,
                Dashboard.creator_id == user_id
            )
            card_result = await self.db.execute(card_stmt)
            card = card_result.scalar_one_or_none()
            
            if not card:
                raise Exception("图表卡片不存在或无权限访问")
            
            # 检查是否已存在绑定
            existing_stmt = select(DashboardFilterBinding).where(
                DashboardFilterBinding.filter_id == filter_id,
                DashboardFilterBinding.card_id == binding_data.card_id
            )
            existing_result = await self.db.execute(existing_stmt)
            existing_binding = existing_result.scalar_one_or_none()
            
            if existing_binding:
                # 更新已存在的绑定
                existing_binding.param_name = binding_data.param_name
                await self.db.commit()
                await self.db.refresh(existing_binding)
                return existing_binding
            else:
                # 创建新绑定
                binding = DashboardFilterBinding(
                    filter_id=filter_id,
                    card_id=binding_data.card_id,
                    param_name=binding_data.param_name
                )
                self.db.add(binding)
                await self.db.commit()
                await self.db.refresh(binding)
                return binding
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"绑定筛选器失败: {str(e)}")
            raise Exception(f"绑定筛选器失败: {str(e)}")

    async def unbind_filter_from_card(self, filter_id: int, card_id: int, user_id: int) -> bool:
        """解除筛选器与图表卡片的绑定"""
        try:
            # 验证筛选器属于用户的仪表板
            filter_obj = await self.get_filter(filter_id, user_id)
            if not filter_obj:
                raise Exception("筛选器不存在或无权限访问")
            
            # 删除绑定
            delete_stmt = delete(DashboardFilterBinding).where(
                DashboardFilterBinding.filter_id == filter_id,
                DashboardFilterBinding.card_id == card_id
            )
            await self.db.execute(delete_stmt)
            await self.db.commit()
            
            logger.info(f"解除筛选器绑定成功: 筛选器ID {filter_id}, 卡片ID {card_id}")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"解除绑定失败: {str(e)}")
            raise Exception(f"解除绑定失败: {str(e)}")

    async def bind_filter_to_new_card(self, card_id: int, dashboard_id: int):
        """当图表添加到仪表盘时，基于 SQL 自动绑定到当前仪表盘下的筛选器。"""
        try:
            filters_stmt = select(DashboardFilter).where(
                DashboardFilter.dashboard_id == dashboard_id
            )
            filters_result = await self.db.execute(filters_stmt)
            filters = filters_result.scalars().all()

            # 先找到这张卡片对应的图表
            card_stmt = select(DashboardCard).where(DashboardCard.id == card_id)
            card_result = await self.db.execute(card_stmt)
            card = card_result.scalar_one_or_none()
            if not card:
                return

            chart_stmt = select(VisualizationCard).where(
                VisualizationCard.id == card.chart_id
            )
            chart_result = await self.db.execute(chart_stmt)
            chart = chart_result.scalar_one_or_none()

            if not chart:
                return

            # 同样优先使用 query_sql，其次从 dataset_query 里提取
            sql_query = getattr(chart, "query_sql", None) or ""
            if not sql_query and chart.dataset_query:
                try:
                    sql_data = chart.dataset_query
                    if isinstance(sql_data, str):
                        import json
                        sql_data = json.loads(sql_data)
                    if isinstance(sql_data, dict):
                        sql_query = sql_data.get("native", {}).get("query", "") or ""
                except Exception:
                    sql_query = ""

            sql_lower = sql_query.lower()
            if not sql_lower:
                return

            for filter_obj in filters:
                filter_field = (filter_obj.field_name or "").lower()
                if not filter_field:
                    continue

                if filter_field not in sql_lower:
                    continue

                existing_stmt = select(DashboardFilterBinding).where(
                    DashboardFilterBinding.filter_id == filter_obj.id,
                    DashboardFilterBinding.card_id == card_id
                )
                existing_result = await self.db.execute(existing_stmt)
                existing_binding = existing_result.scalar_one_or_none()

                if not existing_binding:
                    binding = DashboardFilterBinding(
                        filter_id=filter_obj.id,
                        card_id=card_id,
                        param_name=filter_obj.field_name,
                    )
                    self.db.add(binding)

            await self.db.commit()
            logger.info(f"新卡片自动绑定筛选器完成: 卡片ID {card_id}")

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"新卡片绑定筛选器失败: {str(e)}")
            raise Exception(f"新卡片绑定筛选器失败: {str(e)}")
# backend/app/services/report_page_service.py
import logging

from sqlalchemy import delete, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.time_utils import utc_now
from app.models.report_page import ReportPage, ReportPageDashboard
from app.schemas.report_page import (
    ReportPageCreate,
    ReportPageDashboardCreate,
    ReportPageDashboardUpdate,
    ReportPageUpdate,
)

logger = logging.getLogger(__name__)


class ReportPageService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_report_page(self, page_data: ReportPageCreate, user_id: int) -> ReportPage:
        """创建新报表页"""
        try:
            report_page = ReportPage(
                name=page_data.name,
                description=page_data.description,
                icon=page_data.icon,
                order_index=page_data.order_index,
                creator_id=user_id,
            )

            self.db.add(report_page)
            await self.db.commit()
            await self.db.refresh(report_page)

            # 记录创建操作
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="report_page",
                resource_id=report_page.id,
                resource_name=report_page.name,
                action="create",
                changes={"new": {"name": report_page.name}},
            )

            # 重新查询并预加载关系（即使为空），避免序列化时触发懒加载
            return await self.get_report_page(report_page.id, user_id)

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建报表页失败: {str(e)}")
            raise Exception(f"创建报表页失败: {str(e)}")

    async def update_report_page(self, page_id: int, page_data: ReportPageUpdate, user_id: int) -> ReportPage | None:
        """更新报表页"""
        try:
            # 先查询报表
            stmt = select(ReportPage).where(ReportPage.id == page_id)
            result = await self.db.execute(stmt)
            report_page = result.scalar_one_or_none()

            if not report_page:
                return None

            # 权限检查：仅创建者或管理员可以编辑
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)
            if not await perm_service.is_admin(user_id) and report_page.creator_id != user_id:
                raise PermissionError("无权限编辑此报表，只有创建者或管理员可以编辑")

            # 记录修改前的数据
            old_data = {
                "name": report_page.name,
                "description": report_page.description,
            }

            update_fields = {}
            if page_data.name is not None:
                update_fields["name"] = page_data.name
            if page_data.description is not None:
                update_fields["description"] = page_data.description
            if page_data.icon is not None:
                update_fields["icon"] = page_data.icon
            if page_data.order_index is not None:
                update_fields["order_index"] = page_data.order_index
            if page_data.is_active is not None:
                update_fields["is_active"] = page_data.is_active

            update_fields["updated_at"] = utc_now()

            if update_fields:
                upd = update(ReportPage).where(ReportPage.id == page_id).values(update_fields)
                await self.db.execute(upd)
                await self.db.commit()

                # 记录修改操作
                await perm_service.log_modification(
                    user_id=user_id,
                    resource_type="report_page",
                    resource_id=page_id,
                    resource_name=report_page.name,
                    action="update",
                    changes={"old": old_data, "new": update_fields},
                )

            return await self.get_report_page(page_id, user_id)

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新报表页失败: {str(e)}")
            raise Exception(f"更新报表页失败: {str(e)}")

    async def get_report_page(self, page_id: int, user_id: int) -> ReportPage | None:
        """获取报表页详情（包含仪表盘信息）- 支持权限检查"""
        try:
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)

            # 先查询报表
            stmt = (
                select(ReportPage)
                .options(selectinload(ReportPage.report_page_dashboards).selectinload(ReportPageDashboard.dashboard))
                .where(ReportPage.id == page_id)
            )
            result = await self.db.execute(stmt)
            report_page = result.scalar_one_or_none()

            if not report_page:
                return None

            # 权限检查：是否可以看到此报表
            if not await perm_service.can_view_report_page(user_id, report_page.creator_id, page_id):
                raise PermissionError("无权限查看此报表")

            return report_page

        except PermissionError:
            raise
        except SQLAlchemyError as e:
            logger.error(f"获取报表页失败: {str(e)}")
            raise Exception(f"获取报表页失败: {str(e)}")

    async def get_user_report_pages(self, user_id: int, skip: int = 0, limit: int = 100) -> list[ReportPage]:
        """获取用户可见的报表页列表（按 order_index 排序）- 支持权限过滤"""
        try:
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)

            # 获取用户可见的报表ID列表
            visible_ids = await perm_service.get_user_visible_report_pages(user_id)

            if not visible_ids:
                return []

            stmt = (
                select(ReportPage)
                .options(selectinload(ReportPage.report_page_dashboards).selectinload(ReportPageDashboard.dashboard))
                .where(ReportPage.id.in_(visible_ids), ReportPage.is_active == True)
                .order_by(ReportPage.order_index.asc())
                .offset(skip)
                .limit(limit)
            )

            result = await self.db.execute(stmt)
            return result.scalars().all()

        except SQLAlchemyError as e:
            logger.error(f"获取报表页列表失败: {str(e)}")
            raise Exception(f"获取报表页列表失败: {str(e)}")

    async def add_dashboard_to_report_page(
        self, page_id: int, dashboard_data: ReportPageDashboardCreate, user_id: int
    ) -> ReportPageDashboard:
        """向报表页添加仪表盘"""
        try:
            # 验证报表页存在且当前用户有权限（创建者、管理员、或报表可编辑）
            page = await self.get_report_page(page_id, user_id)
            if not page:
                raise Exception("报表页不存在或无权限访问")

            # 验证仪表盘存在且当前用户可访问（创建者、管理员、或通过报表授权可查看）
            from app.services.dashboard_service import DashboardService

            dashboard_service = DashboardService(self.db)
            dashboard = await dashboard_service.get_dashboard(dashboard_data.dashboard_id, user_id)
            if not dashboard:
                raise Exception("仪表盘不存在或无权限访问")

            # 检查是否已经存在关联
            existing_stmt = select(ReportPageDashboard).where(
                ReportPageDashboard.report_page_id == page_id,
                ReportPageDashboard.dashboard_id == dashboard_data.dashboard_id,
            )
            existing_result = await self.db.execute(existing_stmt)
            existing = existing_result.scalar_one_or_none()
            if existing:
                raise Exception("该仪表盘已添加到报表页")

            # 创建关联
            report_page_dashboard = ReportPageDashboard(
                report_page_id=page_id, dashboard_id=dashboard_data.dashboard_id, order_index=dashboard_data.order_index
            )

            self.db.add(report_page_dashboard)
            await self.db.commit()
            await self.db.refresh(report_page_dashboard)

            # 手动加载关联的仪表盘数据
            report_page_dashboard.dashboard = dashboard

            logger.info(f"仪表盘添加到报表页成功: 报表页ID {page_id}, 仪表盘ID {dashboard_data.dashboard_id}")
            return report_page_dashboard

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"添加仪表盘到报表页失败: {str(e)}")
            raise Exception(f"添加仪表盘到报表页失败: {str(e)}")

    async def update_report_page_dashboard(
        self, rpd_id: int, update_data: ReportPageDashboardUpdate, user_id: int
    ) -> ReportPageDashboard | None:
        """更新报表页中的仪表盘排序。创建者、管理员、或报表可编辑权限的用户可操作。"""
        try:
            rpd_stmt = (
                select(ReportPageDashboard)
                .options(selectinload(ReportPageDashboard.report_page))
                .where(ReportPageDashboard.id == rpd_id)
            )
            rpd_result = await self.db.execute(rpd_stmt)
            rpd = rpd_result.scalar_one_or_none()
            if not rpd or not rpd.report_page:
                return None
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)
            page = rpd.report_page
            if (
                page.creator_id != user_id
                and not await perm_service.is_admin(user_id)
                and not await perm_service.can_edit_report_page(user_id, page.creator_id, page.id)
            ):
                return None

            # 更新排序
            stmt = (
                update(ReportPageDashboard)
                .where(ReportPageDashboard.id == rpd_id)
                .values(order_index=update_data.order_index)
            )

            await self.db.execute(stmt)
            await self.db.commit()

            # 重新查询
            refreshed_stmt = (
                select(ReportPageDashboard)
                .options(selectinload(ReportPageDashboard.dashboard))
                .where(ReportPageDashboard.id == rpd_id)
            )
            refreshed_result = await self.db.execute(refreshed_stmt)
            return refreshed_result.scalar_one_or_none()

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新报表页仪表盘失败: {str(e)}")
            raise Exception(f"更新报表页仪表盘失败: {str(e)}")

    async def remove_dashboard_from_report_page(self, rpd_id: int, user_id: int) -> bool:
        """从报表页移除仪表盘。创建者、管理员、或报表可编辑权限的用户可操作。"""
        try:
            rpd_stmt = (
                select(ReportPageDashboard)
                .options(selectinload(ReportPageDashboard.report_page))
                .where(ReportPageDashboard.id == rpd_id)
            )
            rpd_result = await self.db.execute(rpd_stmt)
            rpd = rpd_result.scalar_one_or_none()
            if not rpd or not rpd.report_page:
                return False
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)
            page = rpd.report_page
            if (
                page.creator_id != user_id
                and not await perm_service.is_admin(user_id)
                and not await perm_service.can_edit_report_page(user_id, page.creator_id, page.id)
            ):
                return False
            delete_stmt = delete(ReportPageDashboard).where(ReportPageDashboard.id == rpd_id)
            await self.db.execute(delete_stmt)
            await self.db.commit()

            logger.info(f"仪表盘从报表页移除成功: 关联ID {rpd_id}")
            return True

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"移除仪表盘失败: {str(e)}")
            raise Exception(f"移除仪表盘失败: {str(e)}")

    async def delete_report_page(self, page_id: int, user_id: int) -> bool:
        """删除报表页（软删除：标记为不激活）"""
        try:
            # 查询报表
            page_stmt = select(ReportPage).where(ReportPage.id == page_id)
            page_result = await self.db.execute(page_stmt)
            page = page_result.scalar_one_or_none()

            if not page:
                return False

            # 权限检查：仅创建者或管理员可以删除
            from app.services.permission_service import PermissionService

            perm_service = PermissionService(self.db)
            if not await perm_service.is_admin(user_id) and page.creator_id != user_id:
                raise PermissionError("无权限删除此报表，只有创建者或管理员可以删除")

            # 软删除：标记为不激活
            stmt = update(ReportPage).where(ReportPage.id == page_id).values(is_active=False, updated_at=utc_now())

            await self.db.execute(stmt)
            await self.db.commit()

            # 记录删除操作
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="report_page",
                resource_id=page_id,
                resource_name=page.name,
                action="delete",
                changes={"old": {"name": page.name, "is_active": page.is_active}},
            )

            logger.info(f"报表页软删除成功: {page.name} (ID: {page_id})")
            return True

        except PermissionError:
            raise
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除报表页失败: {str(e)}")
            raise Exception(f"删除报表页失败: {str(e)}")

# app/services/permission_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from app.core.time_utils import utc_now
import json
import logging

from app.models.permission import UserRole, ReportPagePermission, ModificationLog, RoleEnum, ResourceTypeEnum
from app.models.user import User
from app.core.security import get_password_hash
from app.exceptions import ValidationException, ResourceExistsException

logger = logging.getLogger(__name__)


class PermissionService:
    """权限管理服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============ 用户角色管理 ============

    async def get_user_role(self, user_id: int) -> str:
        """获取用户角色"""
        stmt = select(UserRole).where(UserRole.user_id == user_id)
        result = await self.db.execute(stmt)
        user_role = result.scalar_one_or_none()
        return user_role.role if user_role else RoleEnum.USER.value

    async def is_admin(self, user_id: int) -> bool:
        """判断是否为管理员"""
        role = await self.get_user_role(user_id)
        return role == RoleEnum.ADMIN.value

    async def set_user_role(self, user_id: int, role: str) -> UserRole:
        """设置用户角色"""
        stmt = select(UserRole).where(UserRole.user_id == user_id)
        result = await self.db.execute(stmt)
        user_role = result.scalar_one_or_none()

        if user_role:
            user_role.role = role
            user_role.updated_at = utc_now()
        else:
            user_role = UserRole(user_id=user_id, role=role)
            self.db.add(user_role)

        await self.db.commit()
        await self.db.refresh(user_role)
        logger.info(f"用户 {user_id} 角色已设置为 {role}")
        return user_role

    async def get_all_users_with_roles(self) -> List[Dict[str, Any]]:
        """获取所有用户及其角色"""
        stmt = select(User)
        result = await self.db.execute(stmt)
        users = result.scalars().all()

        user_list = []
        for user in users:
            role = await self.get_user_role(user.userID)
            user_list.append({
                "user_id": user.userID,
                "accountname": user.accountname,
                "role": role,
                "state": user.state,
            })
        return user_list

    async def create_user(
        self,
        accountname: str,
        password: str,
        state: int = 1,
        role: str = RoleEnum.USER.value,
    ) -> Dict[str, Any]:
        """创建新用户（由管理员调用）"""
        accountname = (accountname or "").strip()
        if not accountname:
            raise ValidationException("accountname", "用户名不能为空")
        if password is None or str(password) == "":
            raise ValidationException("password", "密码不能为空")

        # 用户名唯一性检查
        stmt = select(User).where(User.accountname == accountname)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            raise ResourceExistsException("用户", accountname)

        # 创建用户（userID 由数据库 AUTO_INCREMENT 自动生成）
        user = User(
            accountname=accountname,
            password_hash=get_password_hash(password),
            state=1 if int(state) == 1 else 0,
        )
        self.db.add(user)
        await self.db.flush()  # 获取 user.userID

        # 角色处理（可选）
        if role not in [r.value for r in RoleEnum]:
            raise ValidationException("role", f"无效的角色: {role}")
        if role == RoleEnum.ADMIN.value:
            self.db.add(UserRole(user_id=user.userID, role=RoleEnum.ADMIN.value))

        await self.db.commit()
        await self.db.refresh(user)

        return {
            "user_id": user.userID,
            "accountname": user.accountname,
            "state": user.state,
            "role": role,
        }

    # ============ 资源权限检查 ============

    async def can_edit_chart(self, user_id: int, chart_creator_id: int, chart_id: int = None) -> bool:
        """检查用户是否可以编辑图表（自身创建的、或管理员、或通过报表授权的）"""
        if await self.is_admin(user_id):
            return True
        if user_id == chart_creator_id:
            return True
        # 检查是否通过报表授权获得编辑权限
        if chart_id:
            return await self._can_edit_via_report_page(user_id, chart_id=chart_id)
        return False

    async def can_edit_dashboard(self, user_id: int, dashboard_creator_id: int, dashboard_id: int = None) -> bool:
        """检查用户是否可以编辑仪表盘（自身创建的、或管理员、或通过报表授权的）"""
        if await self.is_admin(user_id):
            return True
        if user_id == dashboard_creator_id:
            return True
        # 检查是否通过报表授权获得编辑权限
        if dashboard_id:
            return await self._can_edit_via_report_page(user_id, dashboard_id=dashboard_id)
        return False

    async def _can_edit_via_report_page(self, user_id: int, chart_id: int = None, dashboard_id: int = None) -> bool:
        """检查用户是否通过报表授权获得图表/仪表盘的编辑权限"""
        from app.models.report_page import ReportPageDashboard
        from app.models.visualization import VisualizationCard
        
        report_page_ids = []
        
        if chart_id:
            # 查找图表关联的报表（通过 DashboardCard -> Dashboard -> ReportPageDashboard）
            # 先找哪些仪表盘用了这个图表
            from app.models.dashboard import DashboardCard
            stmt = select(DashboardCard).where(DashboardCard.chart_id == chart_id)
            result = await self.db.execute(stmt)
            cards = result.scalars().all()
            dashboard_ids = [card.dashboard_id for card in cards]
            
            # 再找这些仪表盘关联的报表
            if dashboard_ids:
                stmt = select(ReportPageDashboard).where(
                    ReportPageDashboard.dashboard_id.in_(dashboard_ids)
                )
                result = await self.db.execute(stmt)
                links = result.scalars().all()
                report_page_ids = [link.report_page_id for link in links]
        
        if dashboard_id:
            # 查找仪表盘关联的报表
            stmt = select(ReportPageDashboard).where(
                ReportPageDashboard.dashboard_id == dashboard_id
            )
            result = await self.db.execute(stmt)
            links = result.scalars().all()
            report_page_ids.extend([link.report_page_id for link in links])
        
        if not report_page_ids:
            return False
        
        # 检查用户是否有这些报表的编辑权限
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id.in_(report_page_ids),
            ReportPagePermission.user_id == user_id,
            ReportPagePermission.can_edit == True
        )
        result = await self.db.execute(stmt)
        permissions = result.scalars().all()
        return len(permissions) > 0

    async def can_view_dashboard_via_report_page(self, user_id: int, dashboard_id: int) -> bool:
        """检查用户是否通过报表授权（可读或可编辑）可查看该仪表盘"""
        from app.models.report_page import ReportPageDashboard
        stmt = select(ReportPageDashboard).where(
            ReportPageDashboard.dashboard_id == dashboard_id
        )
        result = await self.db.execute(stmt)
        links = result.scalars().all()
        report_page_ids = [link.report_page_id for link in links]
        if not report_page_ids:
            return False
        # 有可读或可编辑任一权限即可查看仪表盘
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id.in_(report_page_ids),
            ReportPagePermission.user_id == user_id,
            or_(ReportPagePermission.can_view == True, ReportPagePermission.can_edit == True)
        )
        result = await self.db.execute(stmt)
        permissions = result.scalars().all()
        return len(permissions) > 0

    async def can_view_chart_via_report_page(self, user_id: int, chart_id: int) -> bool:
        """检查用户是否通过报表授权（可读或可编辑）可查看该图表"""
        from app.models.report_page import ReportPageDashboard
        from app.models.dashboard import DashboardCard
        stmt = select(DashboardCard).where(DashboardCard.chart_id == chart_id)
        result = await self.db.execute(stmt)
        cards = result.scalars().all()
        dashboard_ids = [c.dashboard_id for c in cards]
        if not dashboard_ids:
            return False
        stmt = select(ReportPageDashboard).where(
            ReportPageDashboard.dashboard_id.in_(dashboard_ids)
        )
        result = await self.db.execute(stmt)
        links = result.scalars().all()
        report_page_ids = [link.report_page_id for link in links]
        if not report_page_ids:
            return False
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id.in_(report_page_ids),
            ReportPagePermission.user_id == user_id,
            or_(ReportPagePermission.can_view == True, ReportPagePermission.can_edit == True)
        )
        result = await self.db.execute(stmt)
        permissions = result.scalars().all()
        return len(permissions) > 0

    async def can_delete_chart(self, user_id: int, chart_creator_id: int, chart_id: int = None) -> bool:
        """检查用户是否可以删除图表"""
        if await self.is_admin(user_id):
            return True
        if user_id == chart_creator_id:
            return True
        # 检查是否通过报表授权获得编辑权限
        if chart_id:
            return await self._can_edit_via_report_page(user_id, chart_id=chart_id)
        return False

    async def can_delete_dashboard(self, user_id: int, dashboard_creator_id: int, dashboard_id: int = None) -> bool:
        """检查用户是否可以删除仪表盘"""
        if await self.is_admin(user_id):
            return True
        if user_id == dashboard_creator_id:
            return True
        # 检查是否通过报表授权获得编辑权限
        if dashboard_id:
            return await self._can_edit_via_report_page(user_id, dashboard_id=dashboard_id)
        return False

    # ============ 报表查看权限 ============

    async def can_view_report_page(self, user_id: int, report_page_creator_id: int, report_page_id: int) -> bool:
        """检查用户是否可以查看报表"""
        # 管理员可以查看所有
        if await self.is_admin(user_id):
            return True
        # 创建者可以查看自己的报表
        if user_id == report_page_creator_id:
            return True
        # 检查是否有授权权限
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id == report_page_id,
            ReportPagePermission.user_id == user_id,
            ReportPagePermission.can_view == True
        )
        result = await self.db.execute(stmt)
        permission = result.scalar_one_or_none()
        return permission is not None

    async def can_edit_report_page(self, user_id: int, report_page_creator_id: int, report_page_id: int) -> bool:
        """检查用户是否可以编辑报表（包括关联的图表、仪表盘）"""
        # 管理员可以编辑所有
        if await self.is_admin(user_id):
            return True
        # 创建者可以编辑自己的报表
        if user_id == report_page_creator_id:
            return True
        # 检查是否有编辑授权权限
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id == report_page_id,
            ReportPagePermission.user_id == user_id,
            ReportPagePermission.can_edit == True
        )
        result = await self.db.execute(stmt)
        permission = result.scalar_one_or_none()
        return permission is not None

    async def grant_report_page_view(
        self,
        report_page_id: int,
        user_id: int,
        can_edit: bool = False
    ) -> ReportPagePermission:
        """授权用户查看/编辑报表
        - can_edit=True 时，同时授权该报表关联的所有仪表盘和图表的编辑权限
        """
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id == report_page_id,
            ReportPagePermission.user_id == user_id
        )
        result = await self.db.execute(stmt)
        permission = result.scalar_one_or_none()

        if permission:
            permission.can_view = True
            permission.can_edit = can_edit
        else:
            permission = ReportPagePermission(
                report_page_id=report_page_id,
                user_id=user_id,
                can_view=True,
                can_edit=can_edit
            )
            self.db.add(permission)

        # 如果授予编辑权限，同时处理关联的仪表盘和图表
        if can_edit:
            await self._grant_edit_for_linked_dashboards_and_charts(report_page_id, user_id)

        await self.db.commit()
        await self.db.refresh(permission)
        logger.info(f"已授权用户 {user_id} {'编辑' if can_edit else '查看'}报表 {report_page_id}")
        return permission

    async def _grant_edit_for_linked_dashboards_and_charts(self, report_page_id: int, user_id: int):
        """授予用户对报表关联的所有仪表盘和图表的编辑权限"""
        # 查询报表关联的所有仪表盘
        from app.models.report_page import ReportPageDashboard
        stmt = select(ReportPageDashboard).where(ReportPageDashboard.report_page_id == report_page_id)
        result = await self.db.execute(stmt)
        linked_dashboards = result.scalars().all()

        # 对每个仪表盘，检查/授予用户对其的编辑权限
        from app.models.dashboard import Dashboard
        for link in linked_dashboards:
            stmt = select(Dashboard).where(Dashboard.id == link.dashboard_id)
            result = await self.db.execute(stmt)
            dashboard = result.scalar_one_or_none()
            if dashboard:
                # 记录用户可以编辑这个仪表盘（通过 modification_log 或单独的处理）
                # 这里我们只需要确保在检查权限时能识别出用户有权限即可
                # 权限检查逻辑在 can_edit_dashboard 中处理
                logger.info(f"已授权用户 {user_id} 编辑仪表盘 {dashboard.id}（通过报表 {report_page_id} 的可编辑权限）")

    async def revoke_report_page_view(self, report_page_id: int, user_id: int) -> bool:
        """撤销用户查看报表的权限"""
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id == report_page_id,
            ReportPagePermission.user_id == user_id
        )
        result = await self.db.execute(stmt)
        permission = result.scalar_one_or_none()

        if permission:
            await self.db.delete(permission)
            await self.db.commit()
            logger.info(f"已撤销用户 {user_id} 对报表 {report_page_id} 的查看权限")
            return True
        return False

    async def get_report_page_permissions(self, report_page_id: int) -> List[Dict[str, Any]]:
        """获取报表的权限列表"""
        stmt = select(ReportPagePermission, User).join(
            User, User.userID == ReportPagePermission.user_id
        ).where(ReportPagePermission.report_page_id == report_page_id)
        
        result = await self.db.execute(stmt)
        rows = result.all()

        permissions = []
        for perm, user in rows:
            permissions.append({
                "id": perm.id,
                "user_id": user.userID,
                "accountname": user.accountname,
                "can_view": perm.can_view,
                "can_edit": perm.can_edit,
                "created_at": perm.created_at.isoformat() if perm.created_at else None
            })
        return permissions

    async def get_user_visible_report_pages(self, user_id: int) -> List[int]:
        """获取用户可见的报表ID列表"""
        # 管理员可见所有
        if await self.is_admin(user_id):
            from app.models.report_page import ReportPage
            stmt = select(ReportPage.id)
            result = await self.db.execute(stmt)
            return [row[0] for row in result.all()]

        # 非管理员：自己创建的 + 被授权的
        from app.models.report_page import ReportPage
        created_stmt = select(ReportPage.id).where(ReportPage.creator_id == user_id)
        result = await self.db.execute(created_stmt)
        created_ids = [row[0] for row in result.all()]

        perm_stmt = select(ReportPagePermission.report_page_id).where(
            ReportPagePermission.user_id == user_id,
            or_(ReportPagePermission.can_view == True, ReportPagePermission.can_edit == True)
        )
        result = await self.db.execute(perm_stmt)
        granted_ids = [row[0] for row in result.all()]

        return list(set(created_ids + granted_ids))

    async def get_user_accessible_dashboard_ids(self, user_id: int) -> List[int]:
        """获取用户可访问的仪表盘 ID 列表（自己创建的 + 通过报表授权的）。管理员返回空列表表示不限制。"""
        if await self.is_admin(user_id):
            return []  # 调用方用“空表示全部”
        from app.models.dashboard import Dashboard
        from app.models.report_page import ReportPageDashboard
        created_stmt = select(Dashboard.id).where(Dashboard.creator_id == user_id)
        result = await self.db.execute(created_stmt)
        created_ids = [row[0] for row in result.all()]
        visible_report_ids = await self.get_user_visible_report_pages(user_id)
        if not visible_report_ids:
            return created_ids
        link_stmt = select(ReportPageDashboard.dashboard_id).where(
            ReportPageDashboard.report_page_id.in_(visible_report_ids)
        )
        result = await self.db.execute(link_stmt)
        report_dashboard_ids = list(set(row[0] for row in result.all()))
        return list(set(created_ids + report_dashboard_ids))

    async def get_user_accessible_chart_ids(self, user_id: int) -> List[int]:
        """获取用户可访问的图表 ID 列表（自己创建的 + 通过报表授权可见的）。管理员返回空列表表示不限制。"""
        if await self.is_admin(user_id):
            return []
        from app.models.dashboard import DashboardCard
        from app.models.visualization import VisualizationCard
        created_stmt = select(VisualizationCard.id).where(
            VisualizationCard.created_by == user_id,
            VisualizationCard.archived == False
        )
        result = await self.db.execute(created_stmt)
        created_ids = [row[0] for row in result.all()]
        dashboard_ids = await self.get_user_accessible_dashboard_ids(user_id)
        if not dashboard_ids:
            return created_ids
        card_stmt = select(DashboardCard.chart_id).where(
            DashboardCard.dashboard_id.in_(dashboard_ids)
        )
        result = await self.db.execute(card_stmt)
        chart_ids = list(set(row[0] for row in result.all() if row[0]))
        return list(set(created_ids + chart_ids))

    # ============ 修改记录 ============

    async def log_modification(
        self,
        user_id: int,
        resource_type: str,
        resource_id: int,
        resource_name: str,
        action: str,
        changes: Optional[Dict[str, Any]] = None
    ) -> ModificationLog:
        """记录修改"""
        log = ModificationLog(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=resource_name,
            action=action,
            # 允许 datetime、Enum 等不可 JSON 序列化类型安全落库
            changes=json.dumps(changes, default=str) if changes else None
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        logger.info(f"记录修改: 用户 {user_id} 对 {resource_type}:{resource_id} 执行了 {action}")
        return log

    async def get_modification_logs(
        self,
        resource_type: Optional[str] = None,
        resource_id: Optional[int] = None,
        user_id: Optional[int] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取修改记录"""
        stmt = select(ModificationLog, User).join(
            User, User.userID == ModificationLog.user_id
        )

        if resource_type:
            stmt = stmt.where(ModificationLog.resource_type == resource_type)
        if resource_id:
            stmt = stmt.where(ModificationLog.resource_id == resource_id)
        if user_id:
            stmt = stmt.where(ModificationLog.user_id == user_id)

        stmt = stmt.order_by(ModificationLog.created_at.desc()).offset(offset).limit(limit)
        
        result = await self.db.execute(stmt)
        rows = result.all()

        logs = []
        for log, user in rows:
            logs.append({
                "id": log.id,
                "user_id": user.userID,
                "accountname": user.accountname,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "resource_name": log.resource_name,
                "action": log.action,
                "changes": json.loads(log.changes) if log.changes else None,
                "created_at": log.created_at.isoformat() if log.created_at else None
            })
        return logs

    async def get_resource_logs(self, resource_type: str, resource_id: int) -> List[Dict[str, Any]]:
        """获取某个资源的修改记录"""
        return await self.get_modification_logs(resource_type=resource_type, resource_id=resource_id)

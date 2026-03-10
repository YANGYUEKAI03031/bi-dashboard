# app/services/permission_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging

from app.models.permission import UserRole, ReportPagePermission, ModificationLog, RoleEnum, ResourceTypeEnum
from app.models.user import User

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
            user_role.updated_at = datetime.utcnow()
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
            raise ValueError("用户名不能为空")
        if password is None or str(password) == "":
            raise ValueError("密码不能为空")

        # 用户名唯一性检查
        stmt = select(User).where(User.accountname == accountname)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError("用户名已存在")

        # 手动生成下一个 userID（因为当前表未设置 AUTO_INCREMENT）
        stmt = select(User.userID).order_by(User.userID.desc()).limit(1)
        result = await self.db.execute(stmt)
        last_id = result.scalar_one_or_none() or 0
        new_id = last_id + 1

        # 创建用户（当前项目登录逻辑是明文比对，这里保持一致）
        user = User(
            userID=new_id,
            accountname=accountname,
            password=password,
            state=1 if int(state) == 1 else 0,
        )
        self.db.add(user)
        await self.db.flush()  # 获取 user.userID

        # 角色处理（可选）
        if role not in [r.value for r in RoleEnum]:
            raise ValueError(f"无效的角色: {role}")
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

    async def can_edit_chart(self, user_id: int, chart_creator_id: int) -> bool:
        """检查用户是否可以编辑图表（自身创建的或管理员）"""
        if await self.is_admin(user_id):
            return True
        return user_id == chart_creator_id

    async def can_edit_dashboard(self, user_id: int, dashboard_creator_id: int) -> bool:
        """检查用户是否可以编辑仪表盘（自身创建的或管理员）"""
        if await self.is_admin(user_id):
            return True
        return user_id == dashboard_creator_id

    async def can_delete_chart(self, user_id: int, chart_creator_id: int) -> bool:
        """检查用户是否可以删除图表"""
        if await self.is_admin(user_id):
            return True
        return user_id == chart_creator_id

    async def can_delete_dashboard(self, user_id: int, dashboard_creator_id: int) -> bool:
        """检查用户是否可以删除仪表盘"""
        if await self.is_admin(user_id):
            return True
        return user_id == dashboard_creator_id

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

    async def grant_report_page_view(self, report_page_id: int, user_id: int) -> ReportPagePermission:
        """授权用户查看报表"""
        stmt = select(ReportPagePermission).where(
            ReportPagePermission.report_page_id == report_page_id,
            ReportPagePermission.user_id == user_id
        )
        result = await self.db.execute(stmt)
        permission = result.scalar_one_or_none()

        if permission:
            permission.can_view = True
        else:
            permission = ReportPagePermission(
                report_page_id=report_page_id,
                user_id=user_id,
                can_view=True
            )
            self.db.add(permission)

        await self.db.commit()
        await self.db.refresh(permission)
        logger.info(f"已授权用户 {user_id} 查看报表 {report_page_id}")
        return permission

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
            ReportPagePermission.can_view == True
        )
        result = await self.db.execute(perm_stmt)
        granted_ids = [row[0] for row in result.all()]

        return list(set(created_ids + granted_ids))

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

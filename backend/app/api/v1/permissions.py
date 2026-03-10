# app/api/v1/permissions.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import logging

from app.db.session import get_db
from app.services.permission_service import PermissionService
from app.core.security import get_current_user_id
from app.models.permission import RoleEnum
from app.schemas.user import CreateUserRequest, CreateUserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("/users")
async def list_users_with_roles(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取所有用户及其角色（仅管理员可访问）"""
    try:
        service = PermissionService(db)
        
        # 检查是否为管理员
        if not await service.is_admin(user_id):
            raise HTTPException(status_code=403, detail="只有管理员可以查看用户列表")
        
        users = await service.get_all_users_with_roles()
        return users
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户列表错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users", response_model=CreateUserResponse)
async def create_user(
    payload: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建新账号（仅管理员可访问）"""
    try:
        service = PermissionService(db)
        if not await service.is_admin(user_id):
            raise HTTPException(status_code=403, detail="只有管理员可以创建用户")

        created = await service.create_user(
            accountname=payload.accountname,
            password=payload.password,
            state=payload.state or 1,
            role=payload.role or RoleEnum.USER.value,
        )
        return CreateUserResponse(**created)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"创建用户错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{target_user_id}/role")
async def set_user_role(
    target_user_id: int,
    role: str,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """设置用户角色（仅管理员可访问）"""
    try:
        service = PermissionService(db)
        
        # 检查是否为管理员
        if not await service.is_admin(user_id):
            raise HTTPException(status_code=403, detail="只有管理员可以设置用户角色")
        
        # 验证角色值
        if role not in [r.value for r in RoleEnum]:
            raise HTTPException(status_code=400, detail=f"无效的角色: {role}")

        await service.set_user_role(target_user_id, role)
        return {"message": f"用户 {target_user_id} 角色已设置为 {role}"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"设置用户角色错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/my-role")
async def get_my_role(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取当前用户角色"""
    service = PermissionService(db)
    role = await service.get_user_role(user_id)
    return {"user_id": user_id, "role": role, "is_admin": await service.is_admin(user_id)}


@router.get("/my-permissions")
async def get_my_permissions(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取当前用户的权限信息"""
    service = PermissionService(db)
    return {
        "user_id": user_id,
        "role": await service.get_user_role(user_id),
        "is_admin": await service.is_admin(user_id),
        "visible_report_pages": await service.get_user_visible_report_pages(user_id)
    }


# ============ 报表权限管理 API ============

@router.post("/report-pages/{report_page_id}/grant")
async def grant_report_page_view(
    report_page_id: int,
    target_user_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """授权用户查看报表（仅管理员或报表创建者可访问）"""
    try:
        service = PermissionService(db)
        
        # 获取报表信息
        from app.services.report_page_service import ReportPageService
        report_service = ReportPageService(db)
        report = await report_service.get_report_page(report_page_id)
        
        if not report:
            raise HTTPException(status_code=404, detail="报表不存在")
        
        # 权限检查：仅管理员或报表创建者可以授权
        if not await service.is_admin(user_id) and report.creator_id != user_id:
            raise HTTPException(status_code=403, detail="无权限授权此报表")
        
        await service.grant_report_page_view(report_page_id, target_user_id)
        return {"message": f"已授权用户 {target_user_id} 查看报表 {report_page_id}"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"授权报表权限错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/report-pages/{report_page_id}/revoke/{target_user_id}")
async def revoke_report_page_view(
    report_page_id: int,
    target_user_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """撤销用户查看报表的权限（仅管理员或报表创建者可访问）"""
    try:
        service = PermissionService(db)
        
        # 获取报表信息
        from app.services.report_page_service import ReportPageService
        report_service = ReportPageService(db)
        report = await report_service.get_report_page(report_page_id)
        
        if not report:
            raise HTTPException(status_code=404, detail="报表不存在")
        
        # 权限检查
        if not await service.is_admin(user_id) and report.creator_id != user_id:
            raise HTTPException(status_code=403, detail="无权限撤销此报表的授权")
        
        success = await service.revoke_report_page_view(report_page_id, target_user_id)
        if success:
            return {"message": f"已撤销用户 {target_user_id} 对报表 {report_page_id} 的查看权限"}
        else:
            raise HTTPException(status_code=404, detail="权限记录不存在")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"撤销报表权限错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/report-pages/{report_page_id}/permissions")
async def get_report_page_permissions(
    report_page_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取报表的权限列表（仅管理员或报表创建者可访问）"""
    try:
        service = PermissionService(db)
        
        # 获取报表信息
        from app.services.report_page_service import ReportPageService
        report_service = ReportPageService(db)
        report = await report_service.get_report_page(report_page_id)
        
        if not report:
            raise HTTPException(status_code=404, detail="报表不存在")
        
        # 权限检查
        if not await service.is_admin(user_id) and report.creator_id != user_id:
            raise HTTPException(status_code=403, detail="无权限查看此报表的权限列表")
        
        permissions = await service.get_report_page_permissions(report_page_id)
        return permissions
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取报表权限列表错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ 修改记录 API ============

@router.get("/logs")
async def get_modification_logs(
    resource_type: Optional[str] = Query(None, description="资源类型: chart, dashboard, report_page"),
    resource_id: Optional[int] = Query(None, description="资源ID"),
    user_id: Optional[int] = Query(None, description="用户ID"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """获取修改记录（仅管理员可访问）"""
    try:
        service = PermissionService(db)
        
        # 检查是否为管理员
        if not await service.is_admin(current_user_id):
            raise HTTPException(status_code=403, detail="只有管理员可以查看修改记录")
        
        logs = await service.get_modification_logs(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            limit=limit,
            offset=offset
        )
        return logs
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取修改记录错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs/resource/{resource_type}/{resource_id}")
async def get_resource_logs(
    resource_type: str,
    resource_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取某个资源的修改记录（管理员或资源创建者可访问）"""
    try:
        service = PermissionService(db)
        
        # 获取资源信息
        resource_creator_id = None
        if resource_type == "chart":
            from app.models.visualization import VisualizationCard
            from sqlalchemy import select
            stmt = select(VisualizationCard).where(VisualizationCard.id == resource_id)
            result = await db.execute(stmt)
            chart = result.scalar_one_or_none()
            if chart:
                resource_creator_id = chart.created_by
        elif resource_type == "dashboard":
            from app.models.dashboard import Dashboard
            from sqlalchemy import select
            stmt = select(Dashboard).where(Dashboard.id == resource_id)
            result = await db.execute(stmt)
            dashboard = result.scalar_one_or_none()
            if dashboard:
                resource_creator_id = dashboard.creator_id
        elif resource_type == "report_page":
            from app.models.report_page import ReportPage
            from sqlalchemy import select
            stmt = select(ReportPage).where(ReportPage.id == resource_id)
            result = await db.execute(stmt)
            report = result.scalar_one_or_none()
            if report:
                resource_creator_id = report.creator_id
        
        # 权限检查：管理员或资源创建者
        if not await service.is_admin(user_id) and resource_creator_id != user_id:
            raise HTTPException(status_code=403, detail="无权限查看此资源的修改记录")
        
        logs = await service.get_resource_logs(resource_type, resource_id)
        return logs
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取资源修改记录错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

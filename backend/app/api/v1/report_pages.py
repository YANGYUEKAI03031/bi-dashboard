# backend/app/api/v1/report_pages.py
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.inspection import inspect

from app.core.security import get_current_user_id
from app.db.session import get_db
from app.exceptions import (
    AppException,
    DatabaseException,
    PermissionDeniedException,
    ResourceNotFoundException,
)
from app.schemas.report_page import (
    ReportPageCreate,
    ReportPageDashboardCreate,
    ReportPageDashboardUpdate,
    ReportPageResponse,
    ReportPageUpdate,
)
from app.services.report_page_service import ReportPageService

router = APIRouter(prefix="/report-pages", tags=["report-pages"])
logger = logging.getLogger(__name__)


def _serialize_dashboard(dashboard):
    """序列化仪表盘"""
    return {
        "id": dashboard.id,
        "name": dashboard.name,
        "description": dashboard.description,
        "layout": dashboard.layout,
        "settings": dashboard.settings,
        "creator_id": dashboard.creator_id,
        "is_public": dashboard.is_public,
        "archived": dashboard.archived,
        "created_at": dashboard.created_at,
        "updated_at": dashboard.updated_at,
    }


def _serialize_report_page_dashboard(rpd):
    """序列化报表页仪表盘关联"""
    data = {
        "id": rpd.id,
        "report_page_id": rpd.report_page_id,
        "dashboard_id": rpd.dashboard_id,
        "order_index": rpd.order_index,
        "created_at": rpd.created_at,
        "dashboard": None,
    }

    if hasattr(rpd, "dashboard") and rpd.dashboard:
        data["dashboard"] = _serialize_dashboard(rpd.dashboard)

    return data


def _serialize_report_page(page):
    """序列化报表页"""
    data = {
        "id": page.id,
        "name": page.name,
        "description": page.description,
        "icon": page.icon,
        "order_index": page.order_index,
        "creator_id": page.creator_id,
        "is_active": page.is_active,
        "created_at": page.created_at,
        "updated_at": page.updated_at,
        "dashboards": [],
    }

    # 安全地访问关系，避免触发懒加载
    # 如果关系未加载，直接返回空列表（避免 greenlet_spawn 错误）
    try:
        # 检查关系是否已加载
        state = inspect(page)
        if hasattr(state, "attrs") and "report_page_dashboards" in state.attrs:
            attr_state = state.attrs["report_page_dashboards"]
            # 如果关系已加载，loaded_value 不为 None
            # 如果未加载，尝试访问会触发懒加载，我们捕获异常
            if attr_state.loaded_value is not None:
                rpds = attr_state.loaded_value
            else:
                # 关系未加载，返回空列表（避免触发懒加载）
                rpds = []
        else:
            # 尝试访问属性，如果触发懒加载则捕获异常
            rpds = getattr(page, "report_page_dashboards", [])
    except (AttributeError, RuntimeError):
        # 如果访问失败（可能触发懒加载），返回空列表
        rpds = []

    # 按 order_index 排序
    if rpds:
        sorted_rpds = sorted(rpds, key=lambda x: x.order_index)
        for rpd in sorted_rpds:
            data["dashboards"].append(_serialize_report_page_dashboard(rpd))

    return data


@router.post("/", response_model=ReportPageResponse)
async def create_report_page(
    page_data: ReportPageCreate, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """创建新报表页"""
    try:
        service = ReportPageService(db)
        page = await service.create_report_page(page_data, user_id)
        return _serialize_report_page(page)

    except Exception as e:
        logger.error(f"创建报表页API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{page_id}")
async def get_report_page(
    page_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """获取报表页详情"""
    try:
        service = ReportPageService(db)
        page = await service.get_report_page(page_id, user_id)

        if not page:
            raise ResourceNotFoundException("报表页", page_id)

        return _serialize_report_page(page)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取报表页API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/")
async def list_report_pages(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """获取用户报表页列表"""
    try:
        service = ReportPageService(db)
        pages = await service.get_user_report_pages(user_id, skip, limit)

        return [_serialize_report_page(p) for p in pages]

    except Exception as e:
        logger.error(f"获取报表页列表API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.put("/{page_id}")
async def update_report_page(
    page_id: int,
    page_data: ReportPageUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """更新报表页"""
    try:
        service = ReportPageService(db)
        page = await service.update_report_page(page_id, page_data, user_id)

        if not page:
            raise ResourceNotFoundException("报表页", page_id)

        return _serialize_report_page(page)

    except PermissionError as e:
        raise PermissionDeniedException(str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"更新报表页API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.post("/{page_id}/dashboards")
async def add_dashboard_to_report_page(
    page_id: int,
    dashboard_data: ReportPageDashboardCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """向报表页添加仪表盘"""
    try:
        service = ReportPageService(db)
        rpd = await service.add_dashboard_to_report_page(page_id, dashboard_data, user_id)

        return _serialize_report_page_dashboard(rpd)

    except Exception as e:
        logger.error(f"添加仪表盘到报表页API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.put("/dashboards/{rpd_id}")
async def update_report_page_dashboard(
    rpd_id: int,
    update_data: ReportPageDashboardUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """更新报表页中的仪表盘排序"""
    try:
        service = ReportPageService(db)
        rpd = await service.update_report_page_dashboard(rpd_id, update_data, user_id)

        if not rpd:
            raise ResourceNotFoundException("关联")

        return _serialize_report_page_dashboard(rpd)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"更新报表页仪表盘API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.delete("/dashboards/{rpd_id}")
async def remove_dashboard_from_report_page(
    rpd_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """从报表页移除仪表盘"""
    try:
        service = ReportPageService(db)
        success = await service.remove_dashboard_from_report_page(rpd_id, user_id)

        if not success:
            raise ResourceNotFoundException("关联")

        return {"message": "仪表盘移除成功"}

    except AppException:
        raise
    except Exception as e:
        logger.error(f"移除仪表盘API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.delete("/{page_id}")
async def delete_report_page(
    page_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """删除报表页"""
    try:
        service = ReportPageService(db)
        success = await service.delete_report_page(page_id, user_id)

        if not success:
            raise ResourceNotFoundException("报表页", page_id)

        return {"message": "报表页删除成功"}

    except PermissionError as e:
        raise PermissionDeniedException(str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"删除报表页API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)

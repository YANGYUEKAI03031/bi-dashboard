# backend/app/api/v1/dashboards.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
import logging
import json

from app.db.session import get_db
from app.services.dashboard_service import DashboardService
from app.schemas.dashboard import (
    DashboardCreate, DashboardUpdate, DashboardResponse,
    DashboardCardCreate, DashboardCardUpdate, DashboardCardResponse,
    DashboardFilterCreate, DashboardFilterUpdate, DashboardFilterResponse,
    DashboardFilterBindingCreate, DashboardFilterBindingResponse
)
from app.core.security import get_current_user_id

router = APIRouter(prefix="/dashboards", tags=["dashboards"])
logger = logging.getLogger(__name__)

def _maybe_json_loads(value):
    """兼容历史数据：JSON 字段如果被错误地存成了 str，这里尽量解析回 dict/list。"""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value

def _serialize_dashboard_card(card):
    return {
        "id": card.id,
        "dashboard_id": card.dashboard_id,
        "chart_id": card.chart_id,
        "card_row": card.card_row,
        "card_col": card.card_col,
        "size_x": card.size_x,
        "size_y": card.size_y,
        "visualization_settings": _maybe_json_loads(getattr(card, "visualization_settings", None)),
        "parameter_mappings": _maybe_json_loads(getattr(card, "parameter_mappings", None)),
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "chart": None,
    }

def _serialize_chart(chart):
    return {
        "id": chart.id,
        "name": chart.name,
        "description": chart.description,
        "chart_type": chart.chart_type,
        "dataset_query": chart.dataset_query,
        "visualization_settings": chart.visualization_settings,
        "data_source_id": chart.data_source_id,
        "created_by": chart.created_by,
        "is_public": chart.is_public,
        "archived": chart.archived,
        "cache_enabled": chart.cache_enabled,
        "cache_duration": chart.cache_duration,
        "created_at": chart.created_at,
        "updated_at": chart.updated_at,
    }

def _serialize_dashboard(dashboard):
    response_data = {
        "id": dashboard.id,
        "name": dashboard.name,
        "description": dashboard.description,
        "layout": _maybe_json_loads(getattr(dashboard, "layout", None)),
        "settings": _maybe_json_loads(getattr(dashboard, "settings", None)),
        "creator_id": dashboard.creator_id,
        "is_public": dashboard.is_public,
        "archived": dashboard.archived,
        "created_at": dashboard.created_at,
        "updated_at": dashboard.updated_at,
        "cards": [],
    }

    cards = getattr(dashboard, "cards", []) or getattr(dashboard, "dashboard_cards", [])
    for card in cards:
        card_data = _serialize_dashboard_card(card)
        if hasattr(card, "chart") and card.chart:
            card_data["chart"] = _serialize_chart(card.chart)
        response_data["cards"].append(card_data)

    return response_data

@router.post("/", response_model=DashboardResponse)
async def create_dashboard(
    dashboard_data: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建新仪表板"""
    try:
        service = DashboardService(db)
        dashboard = await service.create_dashboard(dashboard_data, user_id)
        return DashboardResponse.model_validate(dashboard)
        
    except Exception as e:
        logger.error(f"创建仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{dashboard_id}")
async def get_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取仪表板详情（返回完整数据结构）"""
    try:
        service = DashboardService(db)
        dashboard = await service.get_dashboard(dashboard_id, user_id)
        
        if not dashboard:
            raise HTTPException(status_code=404, detail="仪表板不存在")
        
        return _serialize_dashboard(dashboard)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/")
async def list_dashboards(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取用户仪表板列表（返回完整数据结构）"""
    try:
        service = DashboardService(db)
        dashboards = await service.get_user_dashboards(user_id, skip, limit)
        
        return [_serialize_dashboard(d) for d in dashboards]
        
    except Exception as e:
        logger.error(f"获取仪表板列表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{dashboard_id}")
async def update_dashboard(
    dashboard_id: int,
    dashboard_data: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新仪表板（名称/描述/layout/settings/is_public）"""
    try:
        service = DashboardService(db)
        dashboard = await service.update_dashboard(dashboard_id, dashboard_data, user_id)

        if not dashboard:
            raise HTTPException(status_code=404, detail="仪表板不存在")

        return _serialize_dashboard(dashboard)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{dashboard_id}/cards")
async def add_chart_to_dashboard(
    dashboard_id: int,
    card_data: DashboardCardCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """向仪表板添加图表"""
    try:
        service = DashboardService(db)
        card = await service.add_chart_to_dashboard(dashboard_id, card_data, user_id)
        
        # 构建完整的响应数据
        response_data = {
            "id": card.id,
            "dashboard_id": card.dashboard_id,
            "chart_id": card.chart_id,
            "card_row": card.card_row,
            "card_col": card.card_col,
            "size_x": card.size_x,
            "size_y": card.size_y,
            "visualization_settings": card.visualization_settings,
            "parameter_mappings": card.parameter_mappings,
            "created_at": card.created_at,
            "updated_at": card.updated_at,
            "chart": None
        }
        
        # 添加关联的图表数据
        if hasattr(card, 'chart') and card.chart:
            chart = card.chart
            response_data["chart"] = {
                "id": chart.id,
                "name": chart.name,
                "description": chart.description,
                "chart_type": chart.chart_type,
                "dataset_query": chart.dataset_query,
                "visualization_settings": chart.visualization_settings,
                "data_source_id": chart.data_source_id,
                "created_by": chart.created_by,
                "is_public": chart.is_public,
                "archived": chart.archived,
                "cache_enabled": chart.cache_enabled,
                "cache_duration": chart.cache_duration,
                "created_at": chart.created_at,
                "updated_at": chart.updated_at
            }
        
        return response_data
        
    except Exception as e:
        logger.error(f"添加图表到仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/cards/{card_id}")
async def update_dashboard_card(
    card_id: int,
    update_data: DashboardCardUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新仪表板卡片"""
    try:
        service = DashboardService(db)
        card = await service.update_dashboard_card(card_id, update_data, user_id)
        
        if not card:
            raise HTTPException(status_code=404, detail="卡片不存在")
        
        # 构建完整的响应数据
        response_data = {
            "id": card.id,
            "dashboard_id": card.dashboard_id,
            "chart_id": card.chart_id,
            "card_row": card.card_row,
            "card_col": card.card_col,
            "size_x": card.size_x,
            "size_y": card.size_y,
            "visualization_settings": card.visualization_settings,
            "parameter_mappings": card.parameter_mappings,
            "created_at": card.created_at,
            "updated_at": card.updated_at,
            "chart": None
        }
        
        # 添加关联的图表数据（如果存在）
        if hasattr(card, 'chart') and card.chart:
            chart = card.chart
            response_data["chart"] = {
                "id": chart.id,
                "name": chart.name,
                "description": chart.description,
                "chart_type": chart.chart_type,
                "dataset_query": chart.dataset_query,
                "visualization_settings": chart.visualization_settings,
                "data_source_id": chart.data_source_id,
                "created_by": chart.created_by,
                "is_public": chart.is_public,
                "archived": chart.archived,
                "cache_enabled": chart.cache_enabled,
                "cache_duration": chart.cache_duration,
                "created_at": chart.created_at,
                "updated_at": chart.updated_at
            }
        
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新仪表板卡片API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/cards/{card_id}")
async def remove_chart_from_dashboard(
    card_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """从仪表板移除图表"""
    try:
        service = DashboardService(db)
        success = await service.remove_chart_from_dashboard(card_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="卡片不存在")
            
        return {"message": "卡片移除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"移除卡片API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{dashboard_id}")
async def delete_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """删除仪表板（同时删除所有关联的卡片）"""
    try:
        service = DashboardService(db)
        success = await service.delete_dashboard(dashboard_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="仪表板不存在或无权限访问")
            
        return {"message": "仪表板删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ 筛选器相关 API ============

@router.get("/{dashboard_id}/filters")
async def get_dashboard_filters(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取仪表板的所有筛选器"""
    try:
        service = DashboardService(db)
        filters = await service.get_filters(dashboard_id, user_id)
        
        # 序列化筛选器
        result = []
        for f in filters:
            filter_data = {
                "id": f.id,
                "dashboard_id": f.dashboard_id,
                "dashboard_tab_id": f.dashboard_tab_id,
                "name": f.name,
                "filter_type": f.filter_type,
                "field_name": f.field_name,
                "field_label": f.field_label,
                "data_source_id": f.data_source_id,
                "options_table": f.options_table,
                "options_field": f.options_field,
                "options_sql": f.options_sql,
                "default_value": f.default_value,
                "position": f.position,
                "created_at": f.created_at,
                "updated_at": f.updated_at,
                "bindings": []
            }
            for binding in f.bindings:
                filter_data["bindings"].append({
                    "id": binding.id,
                    "filter_id": binding.filter_id,
                    "card_id": binding.card_id,
                    "param_name": binding.param_name,
                    "created_at": binding.created_at
                })
            result.append(filter_data)
        
        return result
        
    except Exception as e:
        logger.error(f"获取筛选器API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{dashboard_id}/filters")
async def create_filter(
    dashboard_id: int,
    filter_data: DashboardFilterCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建筛选器"""
    try:
        service = DashboardService(db)
        filter_obj = await service.create_filter(dashboard_id, filter_data, user_id)
        
        # 序列化响应
        result = {
            "id": filter_obj.id,
            "dashboard_id": filter_obj.dashboard_id,
            "dashboard_tab_id": filter_obj.dashboard_tab_id,
            "name": filter_obj.name,
            "filter_type": filter_obj.filter_type,
            "field_name": filter_obj.field_name,
            "field_label": filter_obj.field_label,
            "data_source_id": filter_obj.data_source_id,
            "options_table": filter_obj.options_table,
            "options_field": filter_obj.options_field,
            "options_sql": filter_obj.options_sql,
            "default_value": filter_obj.default_value,
            "position": filter_obj.position,
            "created_at": filter_obj.created_at,
            "updated_at": filter_obj.updated_at,
            "bindings": []
        }
        
        return result
        
    except Exception as e:
        logger.error(f"创建筛选器API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/filters/{filter_id}")
async def update_filter(
    filter_id: int,
    filter_data: DashboardFilterUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新筛选器"""
    try:
        service = DashboardService(db)
        filter_obj = await service.update_filter(filter_id, filter_data, user_id)
        
        if not filter_obj:
            raise HTTPException(status_code=404, detail="筛选器不存在")
        
        result = {
            "id": filter_obj.id,
            "dashboard_id": filter_obj.dashboard_id,
            "dashboard_tab_id": filter_obj.dashboard_tab_id,
            "name": filter_obj.name,
            "filter_type": filter_obj.filter_type,
            "field_name": filter_obj.field_name,
            "field_label": filter_obj.field_label,
            "data_source_id": filter_obj.data_source_id,
            "options_table": filter_obj.options_table,
            "options_field": filter_obj.options_field,
            "options_sql": filter_obj.options_sql,
            "default_value": filter_obj.default_value,
            "position": filter_obj.position,
            "created_at": filter_obj.created_at,
            "updated_at": filter_obj.updated_at,
            "bindings": [{"id": b.id, "filter_id": b.filter_id, "card_id": b.card_id, "param_name": b.param_name, "created_at": b.created_at} for b in filter_obj.bindings]
        }
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新筛选器API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/filters/{filter_id}")
async def delete_filter(
    filter_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """删除筛选器"""
    try:
        service = DashboardService(db)
        success = await service.delete_filter(filter_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="筛选器不存在")
        
        return {"message": "筛选器删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除筛选器API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/filters/{filter_id}/bindings")
async def bind_filter_to_card(
    filter_id: int,
    binding_data: DashboardFilterBindingCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """绑定筛选器到图表卡片"""
    try:
        service = DashboardService(db)
        binding = await service.bind_filter_to_card(filter_id, binding_data, user_id)
        
        return {
            "id": binding.id,
            "filter_id": binding.filter_id,
            "card_id": binding.card_id,
            "param_name": binding.param_name,
            "created_at": binding.created_at
        }
        
    except Exception as e:
        logger.error(f"绑定筛选器API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/filters/{filter_id}/bindings/{card_id}")
async def unbind_filter_from_card(
    filter_id: int,
    card_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """解除筛选器与图表卡片的绑定"""
    try:
        service = DashboardService(db)
        success = await service.unbind_filter_from_card(filter_id, card_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="绑定关系不存在")
        
        return {"message": "解除绑定成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"解除绑定API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
# backend/app/api/v1/dashboards.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
import logging

from app.db.session import get_db
from app.services.dashboard_service import DashboardService
from app.schemas.dashboard import (
    DashboardCreate, DashboardUpdate, DashboardResponse,
    DashboardCardCreate, DashboardCardUpdate, DashboardCardResponse
)
from app.core.security import get_current_user_id

router = APIRouter(prefix="/dashboards", tags=["dashboards"])
logger = logging.getLogger(__name__)

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
        
        # 构建完整的响应数据
        response_data = {
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
            "cards": []
        }
        
        # 处理卡片数据
        cards = getattr(dashboard, 'cards', []) or getattr(dashboard, 'dashboard_cards', [])
        for card in cards:
            card_data = {
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
                card_data["chart"] = {
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
            
            response_data["cards"].append(card_data)
        
        return response_data
        
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
        
        # 构建完整的响应数据列表
        response_list = []
        
        for dashboard in dashboards:
            dashboard_data = {
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
                "cards": []
            }
            
            # 处理卡片数据
            cards = getattr(dashboard, 'cards', []) or getattr(dashboard, 'dashboard_cards', [])
            for card in cards:
                card_data = {
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
                    card_data["chart"] = {
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
                
                dashboard_data["cards"].append(card_data)
            
            response_list.append(dashboard_data)
        
        return response_list
        
    except Exception as e:
        logger.error(f"获取仪表板列表API错误: {str(e)}")
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
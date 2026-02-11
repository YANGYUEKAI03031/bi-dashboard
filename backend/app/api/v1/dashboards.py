# backend/app/api/v1/dashboards.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
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

@router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取仪表板详情"""
    try:
        service = DashboardService(db)
        dashboard = await service.get_dashboard(dashboard_id, user_id)
        
        if not dashboard:
            raise HTTPException(status_code=404, detail="仪表板不存在")
            
        return DashboardResponse.model_validate(dashboard)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[DashboardResponse])
async def list_dashboards(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取用户仪表板列表"""
    try:
        service = DashboardService(db)
        dashboards = await service.get_user_dashboards(user_id, skip, limit)
        return [DashboardResponse.model_validate(dashboard) for dashboard in dashboards]
        
    except Exception as e:
        logger.error(f"获取仪表板列表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{dashboard_id}/cards", response_model=DashboardCardResponse)
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
        return DashboardCardResponse.model_validate(card)
        
    except Exception as e:
        logger.error(f"添加图表到仪表板API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/cards/{card_id}", response_model=DashboardCardResponse)
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
            
        return DashboardCardResponse.model_validate(card)
        
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
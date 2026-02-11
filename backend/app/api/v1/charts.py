# backend/app/api/v1/charts.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import logging

from app.db.session import get_db
from app.services.chart_service import ChartService
from app.schemas.chart import ChartCreate, ChartUpdate, ChartResponse
from app.core.security import get_current_user_id

router = APIRouter(prefix="/charts", tags=["charts"])
logger = logging.getLogger(__name__)

@router.post("/", response_model=ChartResponse)
async def create_chart(
    chart_data: ChartCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建新图表"""
    try:
        service = ChartService(db)
        chart = await service.create_chart(chart_data, user_id)
        
        # 转换为响应模型
        return ChartResponse.model_validate(chart)
        
    except Exception as e:
        logger.error(f"创建图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{chart_id}", response_model=ChartResponse)
async def get_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取图表详情"""
    try:
        service = ChartService(db)
        chart = await service.get_chart(chart_id, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
            
        return ChartResponse.model_validate(chart)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[ChartResponse])
async def list_charts(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取用户图表列表"""
    try:
        service = ChartService(db)
        charts = await service.get_user_charts(user_id, skip, limit)
        
        return [ChartResponse.model_validate(chart) for chart in charts]
        
    except Exception as e:
        logger.error(f"获取图表列表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{chart_id}", response_model=ChartResponse)
async def update_chart(
    chart_id: int,
    update_data: ChartUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新图表"""
    try:
        service = ChartService(db)
        chart = await service.update_chart(chart_id, update_data, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
            
        return ChartResponse.model_validate(chart)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{chart_id}")
async def delete_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """删除图表"""
    try:
        service = ChartService(db)
        success = await service.delete_chart(chart_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="图表不存在")
            
        return {"message": "图表删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{chart_id}/archive")
async def archive_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """归档图表"""
    try:
        service = ChartService(db)
        chart = await service.archive_chart(chart_id, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
            
        return {"message": "图表归档成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"归档图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
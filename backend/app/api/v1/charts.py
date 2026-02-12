# backend/app/api/v1/charts.py
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
        
        # 转换为响应模型 - 处理字段名映射
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,  # 字段名映射
            "creator_id": chart.created_by,  # 字段名映射
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)
        
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
            
        # 转换为响应模型
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,
            "creator_id": chart.created_by,
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[ChartResponse])
async def get_user_charts(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取用户的所有图表"""
    try:
        service = ChartService(db)
        charts = await service.get_user_charts(user_id, skip, limit)
        
        # 转换为响应模型列表
        response_list = []
        for chart in charts:
            response_data = {
                "id": chart.id,
                "name": chart.name,
                "description": chart.description,
                "chart_type": chart.chart_type,
                "dataset_query": chart.dataset_query,
                "visualization_settings": chart.visualization_settings,
                "database_id": chart.data_source_id,
                "creator_id": chart.created_by,
                "is_public": chart.is_public,
                "archived": chart.archived,
                "cache_enabled": chart.cache_enabled,
                "cache_duration": chart.cache_duration,
                "created_at": chart.created_at,
                "updated_at": chart.updated_at
            }
            response_list.append(ChartResponse(**response_data))
        
        return response_list
        
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
        
        # 转换为响应模型
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,
            "creator_id": chart.created_by,
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)
        
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

@router.post("/{chart_id}/query", response_model=dict)
async def execute_chart_query(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """执行图表查询并返回数据"""
    try:
        service = ChartService(db)
        chart = await service.get_chart(chart_id, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
        
        # 执行查询
        query_result = await service.execute_chart_query(chart)
        
        return {
            "data": query_result,
            "columns": list(query_result[0].keys()) if query_result else [],
            "row_count": len(query_result)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"执行图表查询API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
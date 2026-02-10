from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from app.db.session import get_db
from app.services.chart_service import ChartService
from app.schemas.chart import ChartCreate, ChartUpdate, ChartDatabaseResponse
import logging

router = APIRouter(prefix="/charts", tags=["charts"])
logger = logging.getLogger(__name__)

@router.get("/", response_model=List[ChartDatabaseResponse])
async def get_charts(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db)
):
    """获取图表列表"""
    try:
        logger.info("请求图表列表")
        chart_service = ChartService(db)
        charts = chart_service.get_charts(skip=skip, limit=limit)
        return charts
    except Exception as e:
        logger.error(f"获取图表列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{chart_id}", response_model=ChartDatabaseResponse)
async def get_chart(
    chart_id: int, 
    db: Session = Depends(get_db)
):
    """获取单个图表"""
    try:
        logger.info(f"请求图表 {chart_id}")
        chart_service = ChartService(db)
        chart = chart_service.get_chart(chart_id)
        if not chart:
            raise HTTPException(status_code=404, detail="图表未找到")
        return chart
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取图表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=ChartDatabaseResponse)
async def create_chart(
    chart: ChartCreate, 
    db: Session = Depends(get_db)
):
    """创建新图表"""
    try:
        logger.info(f"创建图表: {chart.name}")
        chart_service = ChartService(db)
        db_chart = chart_service.create_chart(chart, user_id=1)
        return db_chart
    except Exception as e:
        logger.error(f"创建图表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{chart_id}", response_model=ChartDatabaseResponse)
async def update_chart(
    chart_id: int, 
    chart_update: ChartUpdate, 
    db: Session = Depends(get_db)
):
    """更新图表"""
    try:
        logger.info(f"更新图表 {chart_id}")
        chart_service = ChartService(db)
        db_chart = chart_service.update_chart(chart_id, chart_update)
        if not db_chart:
            raise HTTPException(status_code=404, detail="图表未找到")
        return db_chart
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新图表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{chart_id}")
async def delete_chart(
    chart_id: int, 
    db: Session = Depends(get_db)
):
    """删除图表"""
    try:
        logger.info(f"删除图表 {chart_id}")
        chart_service = ChartService(db)
        success = chart_service.delete_chart(chart_id)
        if not success:
            raise HTTPException(status_code=404, detail="图表未找到")
        return {"message": "图表删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除图表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
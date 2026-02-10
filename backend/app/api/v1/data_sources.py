from fastapi import APIRouter, HTTPException
from typing import List
from app.schemas.data_source import DataSource, TableInfo, ColumnInfo, QueryRequest, QueryResponse
from app.services.data_source_service import DataSourceService

router = APIRouter(prefix="/data-sources", tags=["data-sources"])

# 创建数据源服务实例
data_source_service = DataSourceService()

@router.get("/", response_model=List[DataSource])
async def get_data_sources():
    """获取所有数据源"""
    try:
        return data_source_service.get_data_sources()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
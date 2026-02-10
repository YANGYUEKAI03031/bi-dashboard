# backend/app/api/v1/data_storage.py
"""
数据存储API路由
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.services.data_storage import data_storage_service

router = APIRouter(prefix="/data-storage", tags=["data-storage"])

class SaveDataRequest(BaseModel):
    original_table: str
    processed_data: List[Dict]
    operations: List[Dict]
    user_id: Optional[str] = None

class SaveDataResponse(BaseModel):
    success: bool
    dataset_id: str
    message: str

@router.post("/save", response_model=SaveDataResponse)
async def save_processed_data(request: SaveDataRequest):
    """保存处理后的数据"""
    try:
        dataset_id = await data_storage_service.save_processed_data(
            original_table=request.original_table,
            processed_data=request.processed_data,
            operations=request.operations,
            user_id=request.user_id
        )
        
        return SaveDataResponse(
            success=True,
            dataset_id=dataset_id,
            message="数据保存成功"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存失败: {str(e)}")

@router.get("/datasets")
async def list_datasets(user_id: Optional[str] = None):
    """列出保存的数据集"""
    try:
        datasets = await data_storage_service.list_saved_datasets(user_id)
        return {
            "success": True,
            "datasets": datasets
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取数据集列表失败: {str(e)}")

@router.get("/dataset/{dataset_id}")
async def get_dataset(dataset_id: str):
    """获取指定数据集"""
    try:
        dataset = await data_storage_service.get_saved_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="数据集未找到")
        
        return {
            "success": True,
            "dataset": dataset
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取数据集失败: {str(e)}")
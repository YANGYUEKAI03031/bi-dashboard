# backend/app/schemas/dashboard.py
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime

class DashboardCardCreate(BaseModel):
    """创建仪表板卡片"""
    chart_id: int
    card_row: int = 0
    card_col: int = 0
    size_x: int = 6
    size_y: int = 4
    visualization_settings: Optional[Dict[str, Any]] = None
    parameter_mappings: Optional[Dict[str, Any]] = None

class DashboardCardUpdate(BaseModel):
    """更新仪表板卡片"""
    card_row: Optional[int] = None
    card_col: Optional[int] = None
    size_x: Optional[int] = None
    size_y: Optional[int] = None
    visualization_settings: Optional[Dict[str, Any]] = None
    parameter_mappings: Optional[Dict[str, Any]] = None

class DashboardCreate(BaseModel):
    """创建仪表板"""
    name: str
    description: Optional[str] = None
    layout: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    is_public: bool = False

class DashboardUpdate(BaseModel):
    """更新仪表板"""
    name: Optional[str] = None
    description: Optional[str] = None
    layout: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None

class DashboardCardResponse(BaseModel):
    """仪表板卡片响应"""
    id: int
    dashboard_id: int
    chart_id: int
    card_row: int
    card_col: int
    size_x: int
    size_y: int
    visualization_settings: Optional[Dict[str, Any]]
    parameter_mappings: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class DashboardResponse(BaseModel):
    """仪表板响应"""
    id: int
    name: str
    description: Optional[str]
    layout: Optional[Dict[str, Any]]
    settings: Optional[Dict[str, Any]]
    creator_id: int
    is_public: bool
    archived: bool
    created_at: datetime
    updated_at: datetime
    cards: List[DashboardCardResponse] = []
    
    class Config:
        from_attributes = True
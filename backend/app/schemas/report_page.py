# backend/app/schemas/report_page.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ReportPageCreate(BaseModel):
    """创建报表页"""
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    order_index: int = 0

class ReportPageUpdate(BaseModel):
    """更新报表页"""
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None

class ReportPageDashboardCreate(BaseModel):
    """添加仪表盘到报表页"""
    dashboard_id: int
    order_index: int = 0

class ReportPageDashboardUpdate(BaseModel):
    """更新报表页中的仪表盘排序"""
    order_index: int

class ReportPageDashboardResponse(BaseModel):
    """报表页仪表盘关联响应"""
    id: int
    report_page_id: int
    dashboard_id: int
    order_index: int
    created_at: datetime
    dashboard: Optional[dict] = None  # 仪表盘详情
    
    class Config:
        from_attributes = True

class ReportPageResponse(BaseModel):
    """报表页响应"""
    id: int
    name: str
    description: Optional[str]
    icon: Optional[str]
    order_index: int
    creator_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    dashboards: List[ReportPageDashboardResponse] = []
    
    class Config:
        from_attributes = True

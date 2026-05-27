# backend/app/schemas/report_page.py
from datetime import datetime

from pydantic import BaseModel


class ReportPageCreate(BaseModel):
    """创建报表页"""

    name: str
    description: str | None = None
    icon: str | None = None
    order_index: int = 0


class ReportPageUpdate(BaseModel):
    """更新报表页"""

    name: str | None = None
    description: str | None = None
    icon: str | None = None
    order_index: int | None = None
    is_active: bool | None = None


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
    dashboard: dict | None = None  # 仪表盘详情

    class Config:
        from_attributes = True


class ReportPageResponse(BaseModel):
    """报表页响应"""

    id: int
    name: str
    description: str | None
    icon: str | None
    order_index: int
    creator_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    dashboards: list[ReportPageDashboardResponse] = []

    class Config:
        from_attributes = True

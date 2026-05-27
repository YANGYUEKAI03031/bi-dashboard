# backend/app/schemas/dashboard.py
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DashboardCardCreate(BaseModel):
    """创建仪表板卡片"""

    chart_id: int
    card_row: int = 0
    card_col: int = 0
    size_x: int = 6
    size_y: int = 4
    visualization_settings: dict[str, Any] | None = None
    parameter_mappings: dict[str, Any] | None = None


class DashboardCardUpdate(BaseModel):
    """更新仪表板卡片"""

    card_row: int | None = None
    card_col: int | None = None
    size_x: int | None = None
    size_y: int | None = None
    visualization_settings: dict[str, Any] | None = None
    parameter_mappings: dict[str, Any] | None = None


class DashboardCreate(BaseModel):
    """创建仪表板"""

    name: str
    description: str | None = None
    layout: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None
    is_public: bool = False


class DashboardUpdate(BaseModel):
    """更新仪表板"""

    name: str | None = None
    description: str | None = None
    layout: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None
    is_public: bool | None = None


class DashboardCardResponse(BaseModel):
    """仪表板卡片响应"""

    id: int
    dashboard_id: int
    chart_id: int
    card_row: int
    card_col: int
    size_x: int
    size_y: int
    visualization_settings: dict[str, Any] | None
    parameter_mappings: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============ 筛选器相关 Schema ============


class DashboardFilterCreate(BaseModel):
    """创建筛选器"""

    name: str
    filter_type: str  # date_range, date_relative, select, multi_select, input
    field_name: str
    field_label: str | None = None
    dashboard_tab_id: int | None = None
    data_source_id: int | None = None
    options_table: str | None = None
    options_field: str | None = None
    options_sql: str | None = None
    default_value: dict[str, Any] | None = None
    position: int = 0


class DashboardFilterUpdate(BaseModel):
    """更新筛选器"""

    name: str | None = None
    filter_type: str | None = None
    field_name: str | None = None
    field_label: str | None = None
    dashboard_tab_id: int | None = None
    data_source_id: int | None = None
    options_table: str | None = None
    options_field: str | None = None
    options_sql: str | None = None
    default_value: dict[str, Any] | None = None
    position: int | None = None


class DashboardFilterBindingCreate(BaseModel):
    """创建筛选器绑定"""

    card_id: int
    param_name: str


class DashboardFilterBindingResponse(BaseModel):
    """筛选器绑定响应"""

    id: int
    filter_id: int
    card_id: int
    param_name: str
    created_at: datetime

    class Config:
        from_attributes = True


class DashboardFilterResponse(BaseModel):
    """筛选器响应"""

    id: int
    dashboard_id: int
    dashboard_tab_id: int | None
    name: str
    filter_type: str
    field_name: str
    field_label: str | None
    data_source_id: int | None
    options_table: str | None
    options_field: str | None
    options_sql: str | None
    default_value: dict[str, Any] | None
    position: int
    created_at: datetime
    updated_at: datetime
    bindings: list[DashboardFilterBindingResponse] = []

    class Config:
        from_attributes = True


class DashboardResponse(BaseModel):
    """仪表板响应"""

    id: int
    name: str
    description: str | None
    layout: dict[str, Any] | None
    settings: dict[str, Any] | None
    creator_id: int
    is_public: bool
    archived: bool
    created_at: datetime
    updated_at: datetime
    cards: list[DashboardCardResponse] = []
    filters: list[DashboardFilterResponse] = []

    class Config:
        from_attributes = True

# backend/app/schemas/chart.py
import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, validator


class DatasetQuery(BaseModel):
    """数据集查询配置 - 对应Metabase的dataset_query"""

    type: str  # native, query, etc.
    database: int | None = None
    native: dict[str, Any] | None = None  # 原生SQL查询
    query: dict[str, Any] | None = None  # 查询构建器查询


class VisualizationSettings(BaseModel):
    """可视化设置 - 对应Metabase的visualization_settings"""

    # 基础设置
    graph_dimensions: list[str] | None = Field(None, alias="graph.dimensions")
    graph_metrics: list[str] | None = Field(None, alias="graph.metrics")

    # 轴设置
    x_axis_title: str | None = Field(None, alias="graph.x_axis.title")
    y_axis_title: str | None = Field(None, alias="graph.y_axis.title")
    y_axis_min: float | None = Field(None, alias="graph.y_axis.min")
    y_axis_max: float | None = Field(None, alias="graph.y_axis.max")

    # 样式设置
    graph_colors: list[str] | None = Field(None, alias="graph.colors")
    show_legend: bool | None = Field(True, alias="graph.show_legend")
    legend_position: str | None = Field("right", alias="graph.legend_position")

    # 交互设置
    tooltip_enabled: bool | None = Field(True, alias="graph.tooltip.enabled")
    animation_enabled: bool | None = Field(True, alias="graph.animation.enabled")

    # 排序设置
    sort_by: str | None = Field(None, alias="graph.sort_by")
    sort_order: str | None = Field(None, alias="graph.sort_order")

    # 聚合设置（前端新增）
    # Y 轴聚合方式：count / sum / avg / mode / median
    y_agg_method: str | None = None
    # 是否按 X 轴聚合（group by）
    x_group_by_enabled: bool | None = None

    class Config:
        populate_by_name = True


class ChartCreate(BaseModel):
    """创建图表请求"""

    name: str
    description: str | None = None
    chart_type: str
    dataset_query: DatasetQuery
    visualization_settings: VisualizationSettings
    database_id: int
    table_name: str | None = None  # 新增：表名字段
    is_public: bool = False
    cache_enabled: bool = True
    cache_duration: int = 3600


class ChartUpdate(BaseModel):
    """更新图表请求"""

    name: str | None = None
    description: str | None = None
    chart_type: str | None = None
    dataset_query: DatasetQuery | None = None
    visualization_settings: VisualizationSettings | None = None
    database_id: int | None = None
    table_name: str | None = None  # 新增：表名字段
    pipeline_id: int | None = None
    focus_node_id: str | None = None
    is_public: bool | None = None
    cache_enabled: bool | None = None
    cache_duration: int | None = None


class ChartResponse(BaseModel):
    """图表响应 - 适配现有数据库结构"""

    id: int
    name: str
    description: str | None
    chart_type: str
    dataset_query: dict[str, Any]  # 从JSON字符串转换
    visualization_settings: dict[str, Any]  # 从JSON字符串转换
    # 使用数据库中的实际字段名
    data_source_id: int  # 对应 database_id
    created_by: int  # 对应 creator_id
    table_name: str | None = None  # 新增：表名字段
    # 管道同步图表：用于前端解析源表名与预览
    pipeline_id: int | None = None
    focus_node_id: str | None = None
    is_public: bool
    archived: bool
    cache_enabled: bool
    cache_duration: int
    created_at: datetime
    updated_at: datetime

    # 验证器：将JSON字符串转换为字典
    @validator("dataset_query", pre=True)
    def parse_dataset_query(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {}
        return v

    @validator("visualization_settings", pre=True)
    def parse_visualization_settings(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {}
        return v

    class Config:
        from_attributes = True
        # 字段别名映射
        alias_generator = lambda x: {"data_source_id": "database_id", "created_by": "creator_id"}.get(x, x)

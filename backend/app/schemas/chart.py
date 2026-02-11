# backend/app/schemas/chart.py
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime

class DatasetQuery(BaseModel):
    """数据集查询配置 - 对应Metabase的dataset_query"""
    type: str  # native, query, etc.
    database: Optional[int] = None
    native: Optional[Dict[str, Any]] = None  # 原生SQL查询
    query: Optional[Dict[str, Any]] = None   # 查询构建器查询

class VisualizationSettings(BaseModel):
    """可视化设置 - 对应Metabase的visualization_settings"""
    # 基础设置
    graph_dimensions: Optional[List[str]] = Field(None, alias="graph.dimensions")
    graph_metrics: Optional[List[str]] = Field(None, alias="graph.metrics")
    
    # 轴设置
    x_axis_title: Optional[str] = Field(None, alias="graph.x_axis.title")
    y_axis_title: Optional[str] = Field(None, alias="graph.y_axis.title")
    y_axis_min: Optional[float] = Field(None, alias="graph.y_axis.min")
    y_axis_max: Optional[float] = Field(None, alias="graph.y_axis.max")
    
    # 样式设置
    graph_colors: Optional[List[str]] = Field(None, alias="graph.colors")
    show_legend: Optional[bool] = Field(True, alias="graph.show_legend")
    legend_position: Optional[str] = Field("right", alias="graph.legend_position")
    
    # 交互设置
    tooltip_enabled: Optional[bool] = Field(True, alias="graph.tooltip.enabled")
    animation_enabled: Optional[bool] = Field(True, alias="graph.animation.enabled")
    
    class Config:
        populate_by_name = True

class ChartCreate(BaseModel):
    """创建图表请求"""
    name: str
    description: Optional[str] = None
    chart_type: str
    dataset_query: DatasetQuery
    visualization_settings: VisualizationSettings
    database_id: int
    is_public: bool = False
    cache_enabled: bool = True
    cache_duration: int = 3600

class ChartUpdate(BaseModel):
    """更新图表请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    chart_type: Optional[str] = None
    dataset_query: Optional[DatasetQuery] = None
    visualization_settings: Optional[VisualizationSettings] = None
    database_id: Optional[int] = None
    is_public: Optional[bool] = None
    cache_enabled: Optional[bool] = None
    cache_duration: Optional[int] = None

class ChartResponse(BaseModel):
    """图表响应"""
    id: int
    name: str
    description: Optional[str]
    chart_type: str
    dataset_query: Dict[str, Any]
    visualization_settings: Dict[str, Any]
    database_id: int
    creator_id: int
    is_public: bool
    archived: bool
    cache_enabled: bool
    cache_duration: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
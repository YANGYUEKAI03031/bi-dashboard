# backend/app/schemas/pipeline_chart.py
"""管道图表节点同步 Schema"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class ChartNodeData(BaseModel):
    """单个 chart 节点的数据结构（来自 pipeline nodes 中的 config）"""
    chartType: Optional[str] = Field(None, alias="chartType")
    xField: Optional[str] = Field(None, alias="xField")
    yFields: Optional[List[str]] = Field(None, alias="yFields")
    graphDimensions: Optional[List[str]] = Field(None, alias="graphDimensions")
    graphMetrics: Optional[List[str]] = Field(None, alias="graphMetrics")
    yAggMethod: Optional[str] = Field(None, alias="yAggMethod")
    xGroupByEnabled: Optional[bool] = Field(None, alias="xGroupByEnabled")
    xAxisTitle: Optional[str] = Field(None, alias="xAxisTitle")
    yAxisTitle: Optional[str] = Field(None, alias="yAxisTitle")
    showLegend: Optional[bool] = Field(None, alias="showLegend")
    showTooltip: Optional[bool] = Field(None, alias="showTooltip")
    sortBy: Optional[str] = Field(None, alias="sortBy")
    sortOrder: Optional[str] = Field(None, alias="sortOrder")
    metricMode: Optional[str] = Field(None, alias="metricMode")
    metricUnit: Optional[str] = Field(None, alias="metricUnit")
    metricDecimals: Optional[int] = Field(None, alias="metricDecimals")
    metricLabel: Optional[str] = Field(None, alias="metricLabel")

    class Config:
        populate_by_name = True


class PipelineChartSyncRequest(BaseModel):
    """同步管道图表节点请求"""
    pipeline_id: int
    nodes: List[Dict[str, Any]]  # pipeline nodes JSON


class PipelineChartSyncResponse(BaseModel):
    """同步结果"""
    synced_count: int = 0
    charts: List[Dict[str, Any]] = []

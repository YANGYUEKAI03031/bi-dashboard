# backend/app/schemas/pipeline_chart.py
"""管道图表节点同步 Schema"""

from typing import Any

from pydantic import BaseModel, Field


class ChartNodeData(BaseModel):
    """单个 chart 节点的数据结构（来自 pipeline nodes 中的 config）"""

    chartType: str | None = Field(None, alias="chartType")
    xField: str | None = Field(None, alias="xField")
    yFields: list[str] | None = Field(None, alias="yFields")
    graphDimensions: list[str] | None = Field(None, alias="graphDimensions")
    graphMetrics: list[str] | None = Field(None, alias="graphMetrics")
    yAggMethod: str | None = Field(None, alias="yAggMethod")
    xGroupByEnabled: bool | None = Field(None, alias="xGroupByEnabled")
    xAxisTitle: str | None = Field(None, alias="xAxisTitle")
    yAxisTitle: str | None = Field(None, alias="yAxisTitle")
    showLegend: bool | None = Field(None, alias="showLegend")
    showTooltip: bool | None = Field(None, alias="showTooltip")
    sortBy: str | None = Field(None, alias="sortBy")
    sortOrder: str | None = Field(None, alias="sortOrder")
    metricMode: str | None = Field(None, alias="metricMode")
    metricUnit: str | None = Field(None, alias="metricUnit")
    metricDecimals: int | None = Field(None, alias="metricDecimals")
    metricLabel: str | None = Field(None, alias="metricLabel")

    class Config:
        populate_by_name = True


class PipelineChartSyncRequest(BaseModel):
    """同步管道图表节点请求"""

    pipeline_id: int
    nodes: list[dict[str, Any]]  # pipeline nodes JSON


class PipelineChartSyncResponse(BaseModel):
    """同步结果"""

    synced_count: int = 0
    charts: list[dict[str, Any]] = []

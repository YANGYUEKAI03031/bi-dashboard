# backend/app/services/pipeline_chart_sync_service.py
"""
将管道中的 chart 节点配置同步到 visualization_cards 表。

同步策略：
- 根据 pipeline_id + focus_node_id 查找 visualization_cards：
  - 存在则更新，不存在则新建。
- visualization_settings 字段保存图表可视化配置（来自 chart 节点的 config）。
- dataset_query.native.query 使用占位符，chart service 查询时会动态解析到最新 execution 的结果表。
- synced_at 记录最近一次同步时间。
"""
import json
import logging
import re
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.visualization import VisualizationCard
from app.models.pipeline import DataPipeline

logger = logging.getLogger(__name__)

# 查询占位符：chart service 识别此标记后动态替换为最新 execution 的结果表
QUERY_PLACEHOLDER = "__PIPELINE_EXECUTION_QUERY__"


def _chart_type_to_standard(chart_type: Optional[str]) -> str:
    """将 pipeline chart 图表类型映射为 visualization_cards 标准类型。"""
    if not chart_type:
        return "bar"
    ct = chart_type.lower()
    mapping = {
        "bar": "bar",
        "horizontal_bar": "horizontal_bar",
        "line": "line",
        "pie": "pie",
        "scatter": "scatter",
        "area": "area",
        "radar": "radar",
        "funnel": "funnel",
        "metric": "metric",
        "table": "table",
        "gauge": "gauge",
        "number": "metric",
    }
    return mapping.get(ct, "bar")


def _build_visualization_settings(node_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    从 chart 节点的 config 构建 visualization_settings。
    映射 pipeline ChartNodeConfig -> visualization_settings 格式。
    """
    cfg = node_config or {}

    # 直接字段
    chart_type = cfg.get("chartType", "bar")

    # 坐标轴
    viz = {
        "chartType": chart_type,
        "y_agg_method": cfg.get("yAggMethod", "count"),
        "x_group_by_enabled": cfg.get("xGroupByEnabled", True),
        "x_axis_title": cfg.get("xAxisTitle", ""),
        "y_axis_title": cfg.get("yAxisTitle", ""),
        "show_legend": cfg.get("showLegend", True),
        "show_tooltip": cfg.get("showTooltip", True),
        "sort_by": cfg.get("sortBy", ""),
        "sort_order": cfg.get("sortOrder", "asc"),
        # 指标卡专用
        "metric_mode": cfg.get("metricMode", "value"),
        "metric_unit": cfg.get("metricUnit", ""),
        "metric_decimals": cfg.get("metricDecimals", 0),
        "metric_label": cfg.get("metricLabel", ""),
    }

    # xField / graphDimensions -> graph_dimensions
    x_field = cfg.get("xField")
    graph_dims = cfg.get("graphDimensions")
    if graph_dims and isinstance(graph_dims, list):
        viz["graph_dimensions"] = graph_dims
    elif x_field:
        viz["graph_dimensions"] = [x_field]

    # yFields / graphMetrics -> graph_metrics
    y_fields = cfg.get("yFields")
    graph_mets = cfg.get("graphMetrics")
    if graph_mets and isinstance(graph_mets, list):
        viz["graph_metrics"] = graph_mets
    elif y_fields:
        viz["graph_metrics"] = y_fields if isinstance(y_fields, list) else [y_fields]

    # 折线图 Y 轴字段（双轴）
    line_y_fields = cfg.get("lineYFields")
    if line_y_fields:
        viz["line_y_fields"] = line_y_fields

    return viz


def _build_dataset_query(
    pipeline_id: int,
    node_id: str,
    data_source_id: int,
    upstream_step_table: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建 dataset_query（类 Metabase 格式）。

    如果有具体的上游表名（如 output 节点的目标表），直接使用；
    否则使用占位符，chart service 执行时动态解析。
    """
    if upstream_step_table:
        # 直接引用业务表的完整 SQL
        query_sql = f"SELECT * FROM `{upstream_step_table}`"
    else:
        # 占位符：执行时动态替换为最新 execution 的结果表
        query_sql = QUERY_PLACEHOLDER

    return {
        "type": "native",
        "database": data_source_id,
        "native": {
            "query": query_sql
        }
    }


def _extract_output_table_from_pipeline(
    nodes: List[Dict[str, Any]],
    chart_node_id: str,
) -> Optional[str]:
    """
    从 chart 节点向上追溯，如果存在 output 上游节点，返回其目标表名。
    否则返回 None（使用占位符）。
    """
    node_map: Dict[str, Dict[str, Any]] = {n.get("id", ""): n for n in nodes}
    visited = set()

    def find_output(node_id: str) -> Optional[str]:
        if node_id in visited:
            return None
        visited.add(node_id)
        node = node_map.get(node_id)
        if not node:
            return None
        if node.get("type") == "output":
            cfg = node.get("config") or {}
            target = cfg.get("targetTable", "").strip()
            return target if target else None
        for up_id in (node.get("upstream") or []):
            result = find_output(up_id)
            if result:
                return result
        return None

    chart_node = node_map.get(chart_node_id)
    if not chart_node:
        return None
    return find_output(chart_node_id)


class PipelineChartSyncService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def sync_pipeline_charts(
        self,
        pipeline_id: int,
        nodes: List[Dict[str, Any]],
        user_id: Optional[int] = None,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """
        将管道中的所有 chart 节点同步到 visualization_cards。

        Returns:
            (synced_count, list_of_synced_chart_summaries)
        """
        # 获取管道信息（用于 data_source_id 和 created_by）
        pipeline = await self.db.get(DataPipeline, pipeline_id)
        if not pipeline:
            logger.warning(f"管道 {pipeline_id} 不存在，跳过图表同步")
            return 0, []

        data_source_id = pipeline.source_data_source_id
        # 如果没有显式传入 user_id，使用管道的创建者
        chart_creator = user_id if user_id else pipeline.created_by

        synced = []
        for node in nodes:
            if node.get("type") != "chart":
                continue

            node_id = node.get("id", "")
            node_name = node.get("name", f"Chart {node_id}")
            node_config = node.get("config") or {}

            # 构建 visualization_settings
            viz_settings = _build_visualization_settings(node_config)

            # 构建 dataset_query
            # 优先查找 output 节点目标表
            output_table = _extract_output_table_from_pipeline(nodes, node_id)
            dataset_query = _build_dataset_query(
                pipeline_id=pipeline_id,
                node_id=node_id,
                data_source_id=data_source_id,
                upstream_step_table=output_table,
            )

            # 查询或创建
            existing = await self._find_existing(pipeline_id, node_id)
            if existing:
                chart = await self._update_existing(
                    existing,
                    name=node_name,
                    viz_settings=viz_settings,
                    dataset_query=dataset_query,
                    chart_type=_chart_type_to_standard(viz_settings.get("chartType")),
                )
                action = "updated"
            else:
                chart = await self._create_new(
                    name=node_name,
                    chart_type=_chart_type_to_standard(viz_settings.get("chartType")),
                    viz_settings=viz_settings,
                    dataset_query=dataset_query,
                    data_source_id=data_source_id,
                    creator_id=chart_creator,
                    pipeline_id=pipeline_id,
                    focus_node_id=node_id,
                )
                action = "created"

            logger.info(
                f"图表同步: [{action}] '{node_name}' "
                f"(viz_id={chart.id}, pipeline_id={pipeline_id}, node={node_id})"
            )
            synced.append({
                "id": chart.id,
                "name": chart.name,
                "node_id": node_id,
                "action": action,
            })

        return len(synced), synced

    async def _find_existing(self, pipeline_id: int, focus_node_id: str) -> Optional[VisualizationCard]:
        """根据 pipeline_id + focus_node_id 查找已存在的 chart。"""
        stmt = select(VisualizationCard).where(
            and_(
                VisualizationCard.pipeline_id == pipeline_id,
                VisualizationCard.focus_node_id == focus_node_id,
                VisualizationCard.archived == False,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _update_existing(
        self,
        chart: VisualizationCard,
        name: str,
        viz_settings: Dict[str, Any],
        dataset_query: Dict[str, Any],
        chart_type: str,
    ) -> VisualizationCard:
        """更新已存在的 chart 记录。"""
        chart.name = name
        chart.chart_type = chart_type
        chart.visualization_settings = json.dumps(viz_settings, ensure_ascii=False)
        chart.dataset_query = json.dumps(dataset_query, ensure_ascii=False)
        chart.query_sql = dataset_query.get("native", {}).get("query", "")
        chart.updated_at = datetime.utcnow()
        chart.synced_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(chart)
        return chart

    async def _create_new(
        self,
        name: str,
        chart_type: str,
        viz_settings: Dict[str, Any],
        dataset_query: Dict[str, Any],
        data_source_id: int,
        creator_id: int,
        pipeline_id: int,
        focus_node_id: str,
    ) -> VisualizationCard:
        """创建新的 chart 记录。"""
        chart = VisualizationCard(
            name=name,
            chart_type=chart_type,
            visualization_settings=json.dumps(viz_settings, ensure_ascii=False),
            dataset_query=json.dumps(dataset_query, ensure_ascii=False),
            query_sql=dataset_query.get("native", {}).get("query", ""),
            config={},
            data_source_id=data_source_id,
            created_by=creator_id,
            pipeline_id=pipeline_id,
            focus_node_id=focus_node_id,
            synced_at=datetime.utcnow(),
            archived=False,
            is_public=False,
            cache_enabled=True,
            cache_duration=3600,
        )
        self.db.add(chart)
        await self.db.commit()
        await self.db.refresh(chart)
        return chart

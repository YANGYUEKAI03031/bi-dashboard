# backend/app/services/pipeline_chart_sync_service.py
"""
将管道中的 chart 节点配置同步到 visualization_cards 表（pipeline → chart），
以及将图表编辑器的设置同步回管道节点（chart → pipeline）。

同步策略（pipeline → chart）：
- 根据 pipeline_id + focus_node_id 查找 visualization_cards：
  - 存在则更新，不存在则新建。
- visualization_settings 字段保存图表可视化配置（来自 chart 节点的 config）。
- dataset_query.native.query 使用占位符，chart service 查询时会动态解析到最新 execution 的结果表。
- synced_at 记录最近一次同步时间。

反向同步策略（chart → pipeline）：
- 根据 chart 的 pipeline_id + focus_node_id 定位对应管道的节点。
- 将图表编辑器格式的 visualization_settings 映射回 pipeline chart 节点的 config 格式。
- 只更新节点的 config，nodes 数组中的其他节点不受影响。
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
    ct = chart_type.strip().lower()
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
        "boxplot": "boxplot",
        "箱线图": "boxplot",
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
            std_type = _chart_type_to_standard(viz_settings.get("chartType"))
            logger.debug(
                f"[sync] node={node_id} raw.chartType={node_config.get('chartType')} "
                f"viz.chartType={viz_settings.get('chartType')} mapped={std_type}"
            )

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
                f"(viz_id={chart.id}, viz_chart_type={chart.chart_type}, "
                f"node_config.chartType={node_config.get('chartType')}, "
                f"pipeline_id={pipeline_id}, node={node_id})"
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

    # ================================================================
    # 反向同步：图表编辑器 → 管道节点（chart → pipeline）
    # ================================================================

    def _visualization_settings_to_node_config(
        viz_settings: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        将图表编辑器的 visualization_settings 格式映射回 pipeline chart 节点的 config 格式。

        映射关系（反向）：
        - graph_dimensions / x_field -> xField / graphDimensions
        - graph_metrics / y_fields -> yFields / graphMetrics
        - y_agg_method -> yAggMethod
        - x_group_by_enabled -> xGroupByEnabled
        - x_axis_title -> xAxisTitle
        - y_axis_title -> yAxisTitle
        - show_legend -> showLegend
        - show_tooltip -> showTooltip
        - sort_by -> sortBy
        - sort_order -> sortOrder
        - chartType -> chartType
        """
        cfg: Dict[str, Any] = {}

        # chartType
        chart_type = viz_settings.get("chartType")
        if not chart_type:
            chart_type = viz_settings.get("chart_type")
        if chart_type:
            cfg["chartType"] = chart_type

        # X 轴字段
        dims = viz_settings.get("graph_dimensions") or viz_settings.get("graphDimensions", [])
        if dims:
            cfg["graphDimensions"] = dims
            if isinstance(dims, list) and dims:
                cfg["xField"] = dims[0]

        # Y 轴字段
        mets = viz_settings.get("graph_metrics") or viz_settings.get("graphMetrics", [])
        if mets:
            cfg["graphMetrics"] = mets
            if isinstance(mets, list):
                cfg["yFields"] = mets

        # Y 轴聚合方式
        y_agg = viz_settings.get("y_agg_method")
        if y_agg:
            cfg["yAggMethod"] = y_agg

        # X 轴聚合开关
        x_group = viz_settings.get("x_group_by_enabled")
        if x_group is not None:
            cfg["xGroupByEnabled"] = x_group

        # 轴标题
        x_title = viz_settings.get("x_axis_title")
        if x_title:
            cfg["xAxisTitle"] = x_title

        y_title = viz_settings.get("y_axis_title")
        if y_title:
            cfg["yAxisTitle"] = y_title

        # 显示选项
        show_legend = viz_settings.get("show_legend")
        if show_legend is not None:
            cfg["showLegend"] = show_legend

        show_tooltip = viz_settings.get("show_tooltip")
        if show_tooltip is not None:
            cfg["showTooltip"] = show_tooltip

        # 排序
        sort_by = viz_settings.get("sort_by")
        if sort_by:
            cfg["sortBy"] = sort_by

        sort_order = viz_settings.get("sort_order")
        if sort_order:
            cfg["sortOrder"] = sort_order

        # 指标卡专用
        metric_mode = viz_settings.get("metric_mode")
        if metric_mode:
            cfg["metricMode"] = metric_mode

        metric_unit = viz_settings.get("metric_unit")
        if metric_unit:
            cfg["metricUnit"] = metric_unit

        metric_decimals = viz_settings.get("metric_decimals")
        if metric_decimals is not None:
            cfg["metricDecimals"] = metric_decimals

        metric_label = viz_settings.get("metric_label")
        if metric_label:
            cfg["metricLabel"] = metric_label

        # 折线图 Y 轴字段（双轴）
        line_y_fields = viz_settings.get("line_y_fields")
        if line_y_fields:
            cfg["lineYFields"] = line_y_fields

        return cfg

    async def sync_chart_to_pipeline(
        self,
        chart: VisualizationCard,
    ) -> Tuple[bool, str]:
        """
        将图表编辑器的配置反向同步到关联的管道节点。

        Args:
            chart: VisualizationCard 对象（应有 pipeline_id + focus_node_id）

        Returns:
            (success, message)
        """
        pipeline_id = getattr(chart, "pipeline_id", None)
        focus_node_id = getattr(chart, "focus_node_id", None)

        if not pipeline_id or not focus_node_id:
            logger.info(
                f"图表 {chart.id} 无 pipeline_id 或 focus_node_id，跳过反向同步"
            )
            return False, "图表未关联到管道节点"

        # 解析 visualization_settings
        viz_settings_raw = getattr(chart, "visualization_settings", "{}") or "{}"
        if isinstance(viz_settings_raw, str):
            try:
                viz_settings = json.loads(viz_settings_raw)
            except json.JSONDecodeError:
                viz_settings = {}
        else:
            viz_settings = viz_settings_raw or {}

        # 构建节点 config
        node_config = self._visualization_settings_to_node_config(viz_settings)
        if not node_config:
            logger.info(f"图表 {chart.id} 可视化设置为空，跳过反向同步")
            return False, "可视化设置为空"

        # 查找管道
        pipeline = await self.db.get(DataPipeline, pipeline_id)
        if not pipeline:
            logger.warning(f"图表 {chart.id} 关联的管道 {pipeline_id} 不存在")
            return False, f"管道 {pipeline_id} 不存在"

        # 解析管道的 nodes JSON
        pipeline_nodes = getattr(pipeline, "nodes", []) or []
        if isinstance(pipeline_nodes, str):
            try:
                pipeline_nodes = json.loads(pipeline_nodes)
            except json.JSONDecodeError:
                pipeline_nodes = []

        # 找到对应的 chart 节点
        target_idx = -1
        for i, node in enumerate(pipeline_nodes):
            if str(node.get("id", "")) == str(focus_node_id) and node.get("type") == "chart":
                target_idx = i
                break

        if target_idx < 0:
            logger.warning(
                f"管道 {pipeline_id} 中未找到 chart 节点 {focus_node_id}"
            )
            return False, f"管道中未找到对应的图表节点 {focus_node_id}"

        # 更新节点的 config（只更新 config，不改变其他字段）
        old_config = pipeline_nodes[target_idx].get("config", {}) or {}
        pipeline_nodes[target_idx]["config"] = {
            **old_config,
            **node_config,
        }

        # 写回数据库
        pipeline.nodes = pipeline_nodes
        pipeline.updated_at = datetime.utcnow()
        await self.db.commit()

        logger.info(
            f"图表 {chart.id} 反向同步到管道 {pipeline_id} 节点 {focus_node_id} 完成"
        )
        return True, "同步成功"


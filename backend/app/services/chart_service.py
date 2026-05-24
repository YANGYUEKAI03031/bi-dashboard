# backend/app/services/chart_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, text
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timedelta
import json
import logging
from sqlalchemy.ext.asyncio import create_async_engine
import re
from contextlib import asynccontextmanager

from app.core.crypto import decrypt_password
from app.core.config import settings


# 缓存数据源引擎，避免每次查询都创建新引擎
_data_source_engines: Dict[str, Any] = {}
_ENGINE_EXPIRE_SECONDS = settings.CACHE_TTL  # 使用配置项


# 相对时间预设（与前端 date_relative 选项一致）
RELATIVE_DATE_KEYS = {
    'today', 'yesterday',
    'last_7_days', 'last_30_days',
    'this_month', 'last_month',
}
# 前端可能传首字母大写的值，统一转小写再匹配
RELATIVE_DATE_KEYS_LOWER = {k.lower() for k in RELATIVE_DATE_KEYS}


def _resolve_relative_date(value: str) -> Optional[Dict[str, str]]:
    """将相对时间字符串解析为 {start, end} 日期范围，用于 SQL 筛选。"""
    if not value or not isinstance(value, str):
        return None
    key = value.strip().lower()
    if key not in RELATIVE_DATE_KEYS_LOWER:
        return None
    today = date.today()
    if key == 'today':
        s = e = today
    elif key == 'yesterday':
        s = e = today - timedelta(days=1)
    elif key == 'last_7_days':
        s = today - timedelta(days=6)
        e = today
    elif key == 'last_30_days':
        s = today - timedelta(days=29)
        e = today
    elif key == 'this_month':
        s = today.replace(day=1)
        # 本月最后一天
        next_month = s.replace(day=28) + timedelta(days=4)
        e = next_month - timedelta(days=next_month.day)
    elif key == 'last_month':
        first_this = today.replace(day=1)
        s = (first_this - timedelta(days=1)).replace(day=1)
        next_month = s.replace(day=28) + timedelta(days=4)
        e = next_month - timedelta(days=next_month.day)
    else:
        return None
    return {
        'start': s.isoformat(),
        'end': e.isoformat(),
    }

from app.models.visualization import VisualizationCard, Database
from app.schemas.chart import ChartCreate, ChartUpdate
from app.core.security import get_current_user_id
import time

logger = logging.getLogger(__name__)


async def _get_db_engine(db_model) -> Any:
    """获取或创建缓存的数据源引擎（复用连接池，避免频繁建连）"""
    global _data_source_engines
    # 解密密码（支持双轨：加密和明文）
    decrypted_password = decrypt_password(db_model.password)
    db_url = f"mysql+aiomysql://{db_model.username}:{decrypted_password}@{db_model.host}:{db_model.port}/{db_model.database_name}"

    # 检查缓存是否存在且未过期
    if db_url in _data_source_engines:
        engine, created_at = _data_source_engines[db_url]
        if time.time() - created_at < _ENGINE_EXPIRE_SECONDS:
            return engine
        # 过期了，释放旧引擎
        try:
            await engine.dispose()
        except Exception:
            pass
        del _data_source_engines[db_url]

    # 创建新引擎（使用连接池）
    engine = create_async_engine(
        db_url,
        pool_size=5,
        max_overflow=10,
        pool_recycle=3600,
        pool_pre_ping=True,
    )
    _data_source_engines[db_url] = (engine, time.time())
    return engine


async def _resolve_pipeline_execution_query(
    db: AsyncSession, chart: "VisualizationCard"
) -> Optional[str]:
    """
    解析管道图表的占位符查询，返回实际可执行的 SELECT SQL。

    策略：
    1. 在应用库中查找该管道最新一次成功的 execution。
    2. 从 execution.completed_steps 中定位 focus_node_id 对应 step（或回退到最后一步）。
    3. 在 chart.data_source_id 指向的业务库中解析 tmp_pipeline_{exec_id}_* 表名并读取列。
    4. 返回可在业务库执行的 SELECT（列式持久表，见 temp_table_manager）。

    若临时表已被执行结束时的清理删掉，则尝试从管道节点解析 output 目标表并 SELECT *。
    若仍无法解析，返回 None。
    """
    pipeline_id = getattr(chart, "pipeline_id", None)
    focus_node_id = getattr(chart, "focus_node_id", None)
    if not pipeline_id or not focus_node_id:
        return None

    try:
        from app.models.pipeline import DataPipeline, PipelineExecution
        from sqlalchemy import select, desc

        from app.services.pipeline_chart_sync_service import (
            _extract_output_table_from_pipeline,
        )

        # 获取该管道最新一次成功的执行
        stmt = (
            select(PipelineExecution)
            .where(
                PipelineExecution.pipeline_id == pipeline_id,
                PipelineExecution.status == "completed",
            )
            .order_by(desc(PipelineExecution.completed_at))
            .limit(1)
        )
        result = await db.execute(stmt)
        execution: Optional[PipelineExecution] = result.scalar_one_or_none()
        if not execution:
            logger.info(
                f"管道图表 {chart.id}: pipeline={pipeline_id} 尚无成功执行记录"
            )
            return None

        completed_steps: list = execution.completed_steps or []

        # 找到 focus_node_id 对应的 step
        target_step: Optional[dict] = None
        for step in completed_steps:
            if step.get("node_id") == focus_node_id:
                target_step = step
                break

        if not target_step:
            # 图表节点不是输出节点，只透传，可能不在 completed_steps 中
            # 退而取最后一个 step（最下游）
            if completed_steps:
                target_step = completed_steps[-1]
                logger.info(
                    f"图表节点 {focus_node_id} 未直接出现在步骤中，"
                    f"使用最后一个步骤 {target_step.get('step_id')}"
                )
            else:
                return None

        step_id = target_step.get("step_id")
        if not step_id:
            return None

        # 列式结果表命名：tmp_pipeline_{exec_id}_<idx>（在业务数据源库中创建，见 temp_table_manager）
        # step_id 格式: step_0, step_1, ...
        suffix = step_id.replace("step_", "")
        struct_table = f"tmp_pipeline_{execution.id}_{suffix}"

        # 必须在 chart 对应的数据源库上查 information_schema。
        # 此前误用应用元数据库会话，DATABASE() 指向元库，永远找不到 tmp_pipeline_*。
        ds_model = await db.get(Database, chart.data_source_id)
        if not ds_model:
            logger.warning(
                f"管道图表 {chart.id}: 数据源 id={chart.data_source_id} 不存在，无法解析临时表"
            )
            return None

        temp_engine = await _get_db_engine(ds_model)
        from sqlalchemy import text

        columns: List[str] = []
        async with temp_engine.connect() as conn:
            col_result = await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = :tbl "
                    "ORDER BY ordinal_position"
                ),
                {"tbl": struct_table},
            )
            columns = [r[0] for r in col_result.fetchall()]

        if not columns:
            # 管道跑完后引擎会 cleanup_temp_table() 删掉 tmp_pipeline_*，占位符依赖的表随之消失。
            # 回退：若管道图中有 output 节点，则直接查其写入的业务表（与 sync 时无占位符分支一致）。
            pipeline_row = await db.get(DataPipeline, pipeline_id)
            nodes_list = (
                pipeline_row.nodes
                if pipeline_row and isinstance(pipeline_row.nodes, list)
                else []
            )
            output_table = _extract_output_table_from_pipeline(
                nodes_list, focus_node_id or ""
            )
            if output_table:
                safe_tbl = output_table.replace("`", "``")
                logger.info(
                    f"图表 {chart.id}: 临时表 {struct_table} 已不存在，"
                    f"回退为 output 目标表 `{safe_tbl}`"
                )
                return f"SELECT * FROM `{safe_tbl}`"

            logger.warning(
                f"临时表 {struct_table} 在数据源 {ds_model.name} 中不存在或无列，"
                f"且无 output 目标表可回退，图表 {chart.id} 无法查询"
            )
            return None

        quoted_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in columns)
        return f"SELECT {quoted_cols} FROM `{struct_table}`"

    except Exception as e:
        logger.warning(f"解析管道图表 execution 查询失败: {e}")
        return None


def _sql_has_limit(sql: str) -> bool:
    if not sql:
        return False
    return bool(re.search(r"\bLIMIT\b", sql or "", re.IGNORECASE))


def _apply_default_limit(sql: str, limit_rows: int) -> str:
    """
    给无 LIMIT 的查询加一个默认 LIMIT，避免一次性返回几十万行导致后端/前端崩溃。
    只做最小侵入：如果原 SQL 已含 LIMIT 则不改；否则在末尾（分号前）追加 LIMIT。
    """
    if not sql:
        return sql
    if _sql_has_limit(sql):
        return sql
    safe_limit = int(limit_rows) if limit_rows and int(limit_rows) > 0 else settings.CHART_QUERY_LIMIT
    stripped = sql.rstrip()
    if stripped.endswith(";"):
        stripped = stripped[:-1].rstrip()
    return f"{stripped} LIMIT {safe_limit}"


def _parse_chart_viz_settings(chart: VisualizationCard) -> Dict[str, Any]:
    """从 chart.visualization_settings 中提取聚合相关配置（兼容字符串/字典）。"""
    raw = getattr(chart, "visualization_settings", None)
    if raw is None:
        return {}
    try:
        if isinstance(raw, str):
            return json.loads(raw) if raw.strip() else {}
        if isinstance(raw, dict):
            return raw
    except Exception:
        return {}
    return {}


def _sql_escape_sql_string(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace("'", "''")


def _quote_sql_identifier(name: str) -> str:
    col = (name or "").strip().replace("`", "``")
    if not col:
        return "`"
    return f"`{col}`"


def _metric_filter_rule_dict_sql(item: Dict[str, Any]) -> Optional[str]:
    """单条指标筛选规则 -> SQL 片段；无有效字段时返回 None。"""
    field = str(item.get("field") or "").strip()
    if not field:
        return None
    op = str(item.get("op") or "eq").strip().lower()
    val = item.get("value")
    val_str = "" if val is None else str(val)
    qf = _quote_sql_identifier(field)

    if op in ("is_null", "isnull"):
        return f"({qf} IS NULL OR CAST({qf} AS CHAR) = '')"
    if op in ("is_not_null", "isnotnull"):
        return f"({qf} IS NOT NULL AND CAST({qf} AS CHAR) <> '')"

    esc = _sql_escape_sql_string(val_str)

    if op == "eq":
        return f"{qf} = '{esc}'"
    if op == "neq":
        return f"{qf} <> '{esc}'"
    if op == "gt":
        return f"{qf} > '{esc}'"
    if op == "gte":
        return f"{qf} >= '{esc}'"
    if op == "lt":
        return f"{qf} < '{esc}'"
    if op == "lte":
        return f"{qf} <= '{esc}'"
    if op == "contains":
        return f"LOCATE('{esc}', CAST({qf} AS CHAR)) > 0"
    if op == "not_contains":
        return f"(LOCATE('{esc}', CAST({qf} AS CHAR)) = 0 OR {qf} IS NULL)"
    if op == "starts_with":
        return (
            f"(CHAR_LENGTH('{esc}') = 0 OR LEFT(CAST({qf} AS CHAR), CHAR_LENGTH('{esc}')) = '{esc}')"
        )
    if op == "ends_with":
        return (
            f"(CHAR_LENGTH('{esc}') = 0 OR RIGHT(CAST({qf} AS CHAR), CHAR_LENGTH('{esc}')) = '{esc}')"
        )
    return f"{qf} = '{esc}'"


def _metric_filter_expr_sql(node: Any) -> Optional[str]:
    """递归解析 metric_filter_expr（type: group | rule）。"""
    if not isinstance(node, dict):
        return None
    ntype = str(node.get("type") or "").lower()
    if ntype == "rule":
        return _metric_filter_rule_dict_sql(node)
    if ntype == "group":
        logic = str(node.get("logic") or "and").lower()
        joiner = " OR " if logic == "or" else " AND "
        children = node.get("children")
        if not isinstance(children, list):
            return None
        parts: List[str] = []
        for ch in children:
            frag = _metric_filter_expr_sql(ch)
            if frag:
                parts.append(f"({frag})")
        if not parts:
            return None
        return joiner.join(parts)
    return None


def _metric_filter_sql_clauses(viz: Dict[str, Any]) -> List[str]:
    """
    指标图固定条件拼入 WHERE。
    优先使用 visualization_settings.metric_filter_expr（嵌套 且/或）；
    否则使用 metric_filters 平铺列表（全部 AND）。
    """
    expr = viz.get("metric_filter_expr")
    if isinstance(expr, dict) and str(expr.get("type") or "").lower() == "group":
        combined = _metric_filter_expr_sql(expr)
        return [combined] if combined else []

    raw = viz.get("metric_filters")
    if not isinstance(raw, list):
        return []
    clauses: List[str] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        frag = _metric_filter_rule_dict_sql(item)
        if frag:
            clauses.append(frag)
    return clauses


def _quote_result_column(name: str) -> str:
    """
    Quote a column name in the *result set* (subquery output).
    We intentionally do not support expressions here; only plain column names.
    """
    col = (name or "").strip()
    if not col:
        raise ValueError("column name is empty")
    # If caller passed something like `t.col` or `schema.col`, only keep the last segment.
    # In our wrapping query we always reference columns from subquery alias `t`.
    if "." in col:
        col = col.split(".")[-1].strip()
    col = col.replace("`", "``")
    return f"`{col}`"


def _build_group_by_sql(original_sql: str, x_field: str, y_fields: List[str], method: str) -> str:
    """
    Wrap original SQL and aggregate in MySQL:
      SELECT x, AGG(y1) AS y1, AGG(y2) AS y2
      FROM (original_sql) t
      GROUP BY x
    """
    if not original_sql:
        return original_sql
    agg = (method or "").lower().strip()
    if agg not in {"count", "sum", "avg"}:
        # mode/median 等复杂聚合不在 SQL 层做，避免实现不一致
        return original_sql

    qx = _quote_result_column(x_field)
    select_parts = [f"t.{qx} AS {qx}"]
    for yf in (y_fields or []):
        qy = _quote_result_column(yf)
        if agg == "count":
            # 计数：对每个分组返回行数
            expr = "COUNT(*)"
        elif agg == "sum":
            expr = f"SUM(t.{qy})"
        else:  # avg
            expr = f"AVG(t.{qy})"
        select_parts.append(f"{expr} AS {qy}")

    inner = (original_sql or "").rstrip()
    if inner.endswith(";"):
        inner = inner[:-1].rstrip()
    return (
        "SELECT " + ", ".join(select_parts) + "\n"
        "FROM (\n" + inner + "\n) t\n"
        f"GROUP BY t.{qx}"
    )


def _normalize_identifier_part(part: str) -> str:
    p = (part or "").strip()
    if p.startswith("`") and p.endswith("`") and len(p) >= 2:
        p = p[1:-1]
    return p

def _quote_mysql_identifier(identifier: str) -> str:
    """
    Quote MySQL identifiers safely.
    Supports schema-qualified names like db.table by quoting each segment: `db`.`table`.
    """
    raw = (identifier or "").strip()
    if not raw:
        raise ValueError("identifier is empty")

    parts = [p for p in re.split(r"\s*\.\s*", raw) if p]
    normalized = [_normalize_identifier_part(p) for p in parts]
    escaped = [p.replace("`", "``") for p in normalized]
    return ".".join(f"`{p}`" for p in escaped)

class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_chart(self, chart_data: ChartCreate, user_id: int) -> VisualizationCard:
        """创建新图表 - 适配现有表结构"""
        try:
            # 安全地提取SQL查询语句和表名
            query_sql = ""
            table_name = None
            try:
                # 处理dataset_query可能是字典的情况
                dataset_dict = chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query
                
                if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                    native_config = dataset_dict['native']
                    if isinstance(native_config, dict) and 'query' in native_config:
                        query_sql = native_config['query'] or ""
                        
                        # 提取表名（从SQL中解析）
                        import re
                        from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', query_sql, re.IGNORECASE)
                        if from_clause:
                            table_name = from_clause.group(1)
            except Exception as e:
                logger.warning(f"提取SQL查询时出错: {e}")
                query_sql = ""
            
            # 为所有必填字段提供默认值
            chart = VisualizationCard(
                name=chart_data.name,
                description=chart_data.description or '',
                chart_type=chart_data.chart_type,
                dataset_query=json.dumps(chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query),
                visualization_settings=json.dumps(chart_data.visualization_settings.dict() if hasattr(chart_data.visualization_settings, 'dict') else chart_data.visualization_settings),
                config={},  # 为config字段提供默认值
                query_sql=query_sql,  # 安全提取的SQL语句
                table_name=table_name,  # 新增：表名信息
                data_source_id=chart_data.database_id,
                created_by=user_id,
                is_public=chart_data.is_public if hasattr(chart_data, 'is_public') else False,
                archived=False,
                public_uuid=None,
                cache_enabled=chart_data.cache_enabled if hasattr(chart_data, 'cache_enabled') else True,
                cache_duration=chart_data.cache_duration if hasattr(chart_data, 'cache_duration') else 3600,
                last_cached_at=None
            )
            
            self.db.add(chart)
            await self.db.commit()
            await self.db.refresh(chart)
            
            # 记录创建操作
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="chart",
                resource_id=chart.id,
                resource_name=chart.name,
                action="create",
                changes={"new": {"name": chart.name, "chart_type": chart.chart_type}}
            )
            
            logger.info(f"图表创建成功: {chart.name} (ID: {chart.id})")
            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建图表失败: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"创建图表时发生未预期错误: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
    
    async def get_chart(self, chart_id: int, user_id: int) -> Optional[VisualizationCard]:
        """获取单个图表。创建者、管理员、或通过报表授权可查看的用户均可访问。"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.archived == False
            )
            result = await self.db.execute(stmt)
            chart = result.scalar_one_or_none()
            if not chart:
                return None
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            if chart.created_by == user_id:
                return chart
            if await perm_service.is_admin(user_id):
                return chart
            if await perm_service.can_view_chart_via_report_page(user_id, chart_id):
                return chart
            return None
        except SQLAlchemyError as e:
            logger.error(f"获取图表失败: {str(e)}")
            raise Exception(f"获取图表失败: {str(e)}")
    
    async def get_user_charts(self, user_id: int, skip: int = 0, limit: int = 100) -> List[VisualizationCard]:
        """获取用户可访问的图表列表（自己创建的 + 管理员全部 + 通过报表授权可见的）"""
        try:
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            accessible_ids = await perm_service.get_user_accessible_chart_ids(user_id)
            
            stmt = select(VisualizationCard).where(VisualizationCard.archived == False)
            if accessible_ids:
                stmt = stmt.where(VisualizationCard.id.in_(accessible_ids))
            stmt = stmt.offset(skip).limit(limit)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except SQLAlchemyError as e:
            logger.error(f"获取用户图表列表失败: {str(e)}")
            raise Exception(f"获取用户图表列表失败: {str(e)}")
    
    async def update_chart(self, chart_id: int, update_data: ChartUpdate, user_id: int) -> Optional[VisualizationCard]:
        """更新图表"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return None
            
            # 权限检查：仅创建者或管理员可以编辑
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            if not await perm_service.can_edit_chart(user_id, chart.created_by, chart_id=chart.id):
                raise PermissionError("无权限编辑此图表，只有创建者或管理员可以编辑")
            
            # 记录修改前的数据（用于日志）
            old_data = {
                "name": chart.name,
                "description": chart.description,
                "chart_type": chart.chart_type,
            }
            
            # 更新字段
            update_fields = {}
            if update_data.name is not None:
                update_fields[VisualizationCard.name] = update_data.name
            if update_data.description is not None:
                update_fields[VisualizationCard.description] = update_data.description
            if update_data.chart_type is not None:
                update_fields[VisualizationCard.chart_type] = update_data.chart_type
            if update_data.dataset_query is not None:
                update_fields[VisualizationCard.dataset_query] = json.dumps(update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query)
                # 安全地提取并更新query_sql字段和table_name
                try:
                    dataset_dict = update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query
                    if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                        native_config = dataset_dict['native']
                        if isinstance(native_config, dict) and 'query' in native_config:
                            update_fields[VisualizationCard.query_sql] = native_config['query'] or ""
                            
                            # 提取表名（从SQL中解析）
                            import re
                            from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', native_config['query'], re.IGNORECASE)
                            if from_clause:
                                update_fields[VisualizationCard.table_name] = from_clause.group(1)
                            else:
                                update_fields[VisualizationCard.table_name] = None
                except Exception as e:
                    logger.warning(f"更新时提取SQL查询时出错: {e}")
            if update_data.visualization_settings is not None:
                update_fields[VisualizationCard.visualization_settings] = json.dumps(update_data.visualization_settings.dict() if hasattr(update_data.visualization_settings, 'dict') else update_data.visualization_settings)
            if update_data.database_id is not None:
                update_fields[VisualizationCard.data_source_id] = update_data.database_id
            if hasattr(update_data, 'is_public') and update_data.is_public is not None:
                update_fields[VisualizationCard.is_public] = update_data.is_public
            if hasattr(update_data, 'cache_enabled') and update_data.cache_enabled is not None:
                update_fields[VisualizationCard.cache_enabled] = update_data.cache_enabled
            if hasattr(update_data, 'cache_duration') and update_data.cache_duration is not None:
                update_fields[VisualizationCard.cache_duration] = update_data.cache_duration

            raw_update = (
                update_data.model_dump(exclude_unset=True)
                if hasattr(update_data, "model_dump")
                else update_data.dict(exclude_unset=True)
            )
            if "pipeline_id" in raw_update:
                update_fields[VisualizationCard.pipeline_id] = raw_update["pipeline_id"]
            if "focus_node_id" in raw_update:
                update_fields[VisualizationCard.focus_node_id] = raw_update["focus_node_id"]
            if "table_name" in raw_update:
                update_fields[VisualizationCard.table_name] = raw_update["table_name"]
            
            # 更新时间戳
            update_fields[VisualizationCard.updated_at] = utc_now()
            
            if update_fields:
                # 仅按 chart_id 更新，权限已在上面 can_edit_chart 中校验（创建者/管理员/报表可编辑）
                stmt = update(VisualizationCard).where(
                    VisualizationCard.id == chart_id
                ).values(**{col.name: val for col, val in update_fields.items()})
                
                await self.db.execute(stmt)
                await self.db.commit()
                await self.db.refresh(chart)
                
                # 记录修改操作
                from app.services.permission_service import PermissionService
                perm_service = PermissionService(self.db)
                # update_fields 的 key 是 InstrumentedAttribute（如 VisualizationCard.name），不能直接进 JSON
                new_data = {}
                for col, val in update_fields.items():
                    key = getattr(col, "name", str(col))
                    if isinstance(val, datetime):
                        new_data[key] = val.isoformat()
                    else:
                        new_data[key] = val
                await perm_service.log_modification(
                    user_id=user_id,
                    resource_type="chart",
                    resource_id=chart_id,
                    resource_name=chart.name,
                    action="update",
                    changes={"old": old_data, "new": new_data}
                )
                
                logger.info(f"图表更新成功: {chart.name} (ID: {chart.id})")

            # 反向同步到管道节点（如果有 pipeline_id 和 focus_node_id）
            if getattr(chart, "pipeline_id", None) and getattr(chart, "focus_node_id", None):
                try:
                    from app.services.pipeline_chart_sync_service import PipelineChartSyncService
                    sync_service = PipelineChartSyncService(self.db)
                    success, msg = await sync_service.sync_chart_to_pipeline(chart)
                    if success:
                        logger.info(f"图表 {chart_id} 已同步到管道节点: {msg}")
                except Exception as sync_err:
                    logger.warning(f"图表 {chart_id} 反向同步到管道失败（不影响图表更新）: {sync_err}")

            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新图表失败: {str(e)}")
            raise Exception(f"更新图表失败: {str(e)}")
    
    async def delete_chart(self, chart_id: int, user_id: int) -> bool:
        """删除图表（软删除）"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return False
            
            # 权限检查：仅创建者或管理员可以删除
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            if not await perm_service.can_delete_chart(user_id, chart.created_by, chart_id=chart.id):
                raise PermissionError("无权限删除此图表，只有创建者或管理员可以删除")
            
            # 先移除仪表盘中对该图表的引用（删除 dashboard_cards 及关联的 filter_bindings），报表通过仪表盘展示，无需单独表
            from app.models.dashboard import DashboardCard, DashboardFilterBinding
            card_ids_stmt = select(DashboardCard.id).where(DashboardCard.chart_id == chart_id)
            card_ids_result = await self.db.execute(card_ids_stmt)
            card_ids = [r[0] for r in card_ids_result.all()]
            if card_ids:
                await self.db.execute(delete(DashboardFilterBinding).where(DashboardFilterBinding.card_id.in_(card_ids)))
                await self.db.execute(delete(DashboardCard).where(DashboardCard.chart_id == chart_id))
            
            # 软删除：标记为已归档（权限已在上面 can_delete_chart 中校验）
            stmt = update(VisualizationCard).where(
                VisualizationCard.id == chart_id
            ).values(
                archived=True,
                updated_at=utc_now()
            )
            
            await self.db.execute(stmt)
            await self.db.commit()
            
            # 记录删除操作
            from app.services.permission_service import PermissionService
            perm_service = PermissionService(self.db)
            await perm_service.log_modification(
                user_id=user_id,
                resource_type="chart",
                resource_id=chart_id,
                resource_name=chart.name,
                action="delete",
                changes={"old": {"name": chart.name, "archived": chart.archived}}
            )
            
            logger.info(f"图表软删除成功: {chart.name} (ID: {chart.id})")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除图表失败: {str(e)}")
            raise Exception(f"删除图表失败: {str(e)}")

    async def archive_charts_by_pipeline(self, pipeline_id: int) -> int:
        """
        归档指定 pipeline 关联的所有图表（软删除）。
        
        Args:
            pipeline_id: 管道 ID
            
        Returns:
            被归档的图表数量
        """
        try:
            # 查找该 pipeline 关联的所有未归档图表
            stmt = select(VisualizationCard).where(
                VisualizationCard.pipeline_id == pipeline_id,
                VisualizationCard.archived == False
            )
            result = await self.db.execute(stmt)
            charts = list(result.scalars().all())
            
            if not charts:
                logger.info(f"管道 {pipeline_id} 没有关联的图表需要归档")
                return 0
            
            archived_count = 0
            now = utc_now()
            
            for chart in charts:
                # 移除仪表盘中对该图表的引用
                from app.models.dashboard import DashboardCard, DashboardFilterBinding
                card_ids_stmt = select(DashboardCard.id).where(DashboardCard.chart_id == chart.id)
                card_ids_result = await self.db.execute(card_ids_stmt)
                card_ids = [r[0] for r in card_ids_result.all()]
                if card_ids:
                    await self.db.execute(delete(DashboardFilterBinding).where(DashboardFilterBinding.card_id.in_(card_ids)))
                    await self.db.execute(delete(DashboardCard).where(DashboardCard.chart_id == chart.id))
                
                # 软删除：标记为已归档
                chart.archived = True
                chart.updated_at = now
                archived_count += 1
                
                logger.info(f"归档管道图表: chart_id={chart.id}, chart_name={chart.name}, pipeline_id={pipeline_id}")
            
            await self.db.commit()
            logger.info(f"管道 {pipeline_id} 的图表归档完成: {archived_count} 条")
            return archived_count
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"归档管道图表失败: {str(e)}")
            raise Exception(f"归档管道图表失败: {str(e)}")

    async def archive_chart_by_node(self, pipeline_id: int, focus_node_id: str) -> int:
        """
        归档指定节点关联的图表（用于节点删除时归档对应图表）。
        
        Args:
            pipeline_id: 管道 ID
            focus_node_id: 节点 ID
            
        Returns:
            被归档的图表数量（通常为 0 或 1）
        """
        try:
            # 查找该节点关联的图表
            stmt = select(VisualizationCard).where(
                VisualizationCard.pipeline_id == pipeline_id,
                VisualizationCard.focus_node_id == focus_node_id,
                VisualizationCard.archived == False
            )
            result = await self.db.execute(stmt)
            chart = result.scalar_one_or_none()
            
            if not chart:
                logger.info(f"节点 {focus_node_id} 没有关联的图表需要归档")
                return 0
            
            # 移除仪表盘中对该图表的引用
            from app.models.dashboard import DashboardCard, DashboardFilterBinding
            card_ids_stmt = select(DashboardCard.id).where(DashboardCard.chart_id == chart.id)
            card_ids_result = await self.db.execute(card_ids_stmt)
            card_ids = [r[0] for r in card_ids_result.all()]
            if card_ids:
                await self.db.execute(delete(DashboardFilterBinding).where(DashboardFilterBinding.card_id.in_(card_ids)))
                await self.db.execute(delete(DashboardCard).where(DashboardCard.chart_id == chart.id))
            
            # 软删除：标记为已归档
            chart.archived = True
            chart.updated_at = utc_now()
            await self.db.commit()
            
            logger.info(f"归档节点图表: chart_id={chart.id}, chart_name={chart.name}, node_id={focus_node_id}")
            return 1
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"归档节点图表失败: {str(e)}")
            raise Exception(f"归档节点图表失败: {str(e)}")
    
    async def execute_chart_query(self, chart: VisualizationCard, filter_params: Dict[str, Any] = None) -> List[Dict]:
        """执行图表的SQL查询（支持筛选器参数 - 自动生成WHERE条件）"""
        try:
            filter_params = filter_params or {}
            viz = _parse_chart_viz_settings(chart)
            chart_type_raw = getattr(chart, "chart_type", None)
            is_metric_chart = isinstance(chart_type_raw, str) and chart_type_raw.lower() == "metric"

            # 解析dataset_query获取SQL
            dataset_query = chart.dataset_query
            if isinstance(dataset_query, str):
                dataset_query = json.loads(dataset_query)

            sql_query = dataset_query.get('native', {}).get('query', '')
            if not sql_query:
                return []

            # 管道图表占位符：动态解析为最新 execution 的结果表
            PIPELINE_PLACEHOLDER = "__PIPELINE_EXECUTION_QUERY__"
            if sql_query == PIPELINE_PLACEHOLDER:
                resolved_sql = await _resolve_pipeline_execution_query(self.db, chart)
                if not resolved_sql:
                    logger.warning(
                        f"图表 {chart.id} 为管道图表，但无法解析 execution 查询"
                    )
                    return []
                sql_query = resolved_sql
                logger.info(
                    f"图表 {chart.id} 执行查询已解析为: {sql_query[:80]}..."
                )
            
            # ========== 方案2: 自动生成 WHERE 条件 ==========
            # 非指标图：应用仪表盘/报表筛选器参数；指标图：忽略筛选器，仅使用 visualization_settings.metric_filters
            where_conditions = []

            if not is_metric_chart:
                for param_name, param_value in filter_params.items():
                    if param_value is None or param_value == '':
                        continue

                    # 处理 filterId_fieldName 格式的key，提取真正的字段名
                    # 例如: "1_支付日期" -> "支付日期"
                    actual_field_name = param_name
                    if '_' in param_name:
                        # 检查是否是数字开头（filterId）
                        parts = param_name.split('_', 1)
                        if parts[0].isdigit() and len(parts) == 2:
                            actual_field_name = parts[1]

                    # 相对时间（如 last_month）转为日期范围后再按日期处理
                    if isinstance(param_value, str):
                        resolved = _resolve_relative_date(param_value)
                        if resolved:
                            param_value = resolved

                    # 处理日期范围 {start: '...', end: '...'}
                    if isinstance(param_value, dict) and 'start' in param_value and 'end' in param_value:
                        start_value = param_value.get('start')
                        end_value = param_value.get('end')
                        if start_value and end_value:
                            # 日期范围: BETWEEN（使用转义函数）
                            esc_start = _sql_escape_sql_string(str(start_value))
                            esc_end = _sql_escape_sql_string(str(end_value))
                            condition = f"{_quote_sql_identifier(actual_field_name)} BETWEEN '{esc_start}' AND '{esc_end}'"
                            where_conditions.append(condition)
                        elif start_value:
                            esc_start = _sql_escape_sql_string(str(start_value))
                            condition = f"{_quote_sql_identifier(actual_field_name)} >= '{esc_start}'"
                            where_conditions.append(condition)
                        elif end_value:
                            esc_end = _sql_escape_sql_string(str(end_value))
                            condition = f"{_quote_sql_identifier(actual_field_name)} <= '{esc_end}'"
                            where_conditions.append(condition)
                    # 处理多值列表 ['广东', '浙江']
                    elif isinstance(param_value, list) and len(param_value) > 0:
                        esc_values = ", ".join(f"'{_sql_escape_sql_string(str(v))}'" for v in param_value)
                        condition = f"{_quote_sql_identifier(actual_field_name)} IN ({esc_values})"
                        where_conditions.append(condition)
                    # 处理单值 '广东' 或无法解析的字符串
                    else:
                        esc_val = _sql_escape_sql_string(str(param_value))
                        condition = f"{_quote_sql_identifier(actual_field_name)} = '{esc_val}'"
                        where_conditions.append(condition)

            if is_metric_chart:
                where_conditions.extend(_metric_filter_sql_clauses(viz))
            
            # 将生成的WHERE条件拼接到SQL中
            if where_conditions:
                where_clause = " AND ".join(where_conditions)
                
                # 检查SQL是否已包含WHERE子句
                sql_upper = sql_query.upper().strip()
                if 'WHERE' in sql_upper:
                    # 已有WHERE子句，追加AND条件
                    # 找到WHERE关键字的位置，在其后面添加条件
                    import re
                    # 使用正则找到WHERE后面的位置
                    match = re.search(r'\bWHERE\b', sql_query, re.IGNORECASE)
                    if match:
                        insert_pos = match.end()
                        sql_query = sql_query[:insert_pos] + " " + where_clause + " AND" + sql_query[insert_pos:]
                else:
                    # 没有WHERE子句，需要正确插入位置
                    # SQL正确顺序: SELECT ... FROM ... [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ...]
                    # 需要找到 LIMIT/ORDER BY/GROUP BY 的位置，在它们之前插入 WHERE
                    import re
                    
                    # 查找各个子句的位置
                    limit_match = re.search(r'\bLIMIT\b', sql_query, re.IGNORECASE)
                    order_match = re.search(r'\bORDER\s+BY\b', sql_query, re.IGNORECASE)
                    group_match = re.search(r'\bGROUP\s+BY\b', sql_query, re.IGNORECASE)
                    
                    # 找到最早出现的位置
                    positions = []
                    if limit_match:
                        positions.append(limit_match.start())
                    if order_match:
                        positions.append(order_match.start())
                    if group_match:
                        positions.append(group_match.start())
                    
                    if positions:
                        # 在最早的关键字之前插入 WHERE
                        insert_pos = min(positions)
                        sql_query = sql_query[:insert_pos] + " WHERE " + where_clause + " " + sql_query[insert_pos:]
                    else:
                        # 没有找到任何关键字，直接在末尾添加（但要在;之前）
                        sql_query = sql_query.rstrip().rstrip(';') + " WHERE " + where_clause
            
            # ========== 方案2 结束 ==========

            # 兜底保护：没有 LIMIT 的情况下，默认最多返回 10000 行，避免大数据量把后端/前端拖死
            # 注意：如果前端“按 X 聚合”是在前端做的，那么原 SQL 可能是明细查询，会导致 fetchall 拉爆内存。
            # 这里优先尝试把聚合前移到数据库层（wrap subquery + GROUP BY），从根源减少返回行数。
            # 指标图在前端做聚合，不在 SQL 层 GROUP BY。
            x_field = viz.get("graph_dimensions")
            if isinstance(x_field, list) and x_field:
                x_field = x_field[0]
            y_fields = viz.get("graph_metrics") or viz.get("y_fields")
            if not isinstance(y_fields, list):
                y_fields = []
            y_agg_method = viz.get("y_agg_method") or viz.get("graph.y_agg_method")
            x_group_by_enabled = viz.get("x_group_by_enabled")
            if (
                not is_metric_chart
                and isinstance(x_field, str)
                and x_field
                and y_fields
                and y_agg_method
                and x_group_by_enabled is not False
            ):
                # 仅对 count/sum/avg 做 SQL 聚合，其它方法保持原样（仍会受默认 LIMIT 保护）
                sql_query = _build_group_by_sql(sql_query, x_field, y_fields, str(y_agg_method))

            # 对“明细大结果”做兜底保护：无 LIMIT 才追加 LIMIT
            #（如果上面已经做了 GROUP BY，一般结果会很小且需要完整返回，所以不要强行 LIMIT）
            if "GROUP BY" not in (sql_query or "").upper():
                sql_query = _apply_default_limit(sql_query, settings.CHART_QUERY_LIMIT)

            # 获取数据源连接信息
            db_model = await self.db.get(Database, chart.data_source_id)
            if not db_model:
                raise Exception("数据源不存在")

            # 使用缓存的引擎执行查询
            temp_engine = await _get_db_engine(db_model)
            try:
                async with temp_engine.connect() as conn:
                    result = await conn.execute(text(sql_query))
                    rows = result.fetchall()

                    # 转换为字典列表
                    columns = result.keys()
                    data = []
                    for row in rows:
                        item = dict(zip(columns, row))
                        # JSON 序列化友好：date/datetime 统一转 ISO 字符串
                        for k, v in list(item.items()):
                            if isinstance(v, (datetime, date)):
                                item[k] = v.isoformat()
                        data.append(item)

                    return data
            except Exception as query_error:
                error_msg = str(query_error)
                logger.warning(f"查询失败: {error_msg}，尝试检查字段有效性...")

                # 如果有筛选条件且失败，尝试获取表字段并重新生成筛选条件
                if where_conditions and db_model:
                    try:
                        # 获取表的字段列表
                        table_match = re.search(r'FROM\s+`?(\w+)`?', sql_query, re.IGNORECASE)
                        if table_match:
                            table_name = table_match.group(1)
                            # 复用已有引擎获取字段
                            temp_engine2 = await _get_db_engine(db_model)
                            try:
                                async with temp_engine2.connect() as conn2:
                                    result = await conn2.execute(text(f"DESCRIBE `{table_name}`"))
                                    table_fields = set()
                                    for row in result.fetchall():
                                        table_fields.add(row[0].lower())
                                    logger.info(f"表 '{table_name}' 字段: {table_fields}")
                            finally:
                                # 引擎是缓存复用的，不要 dispose()
                                pass

                            # 重新生成有效的筛选条件
                            valid_conditions = []
                            for param_name, param_value in filter_params.items():
                                if param_value is None or param_value == '':
                                    continue

                                actual_field_name = param_name
                                if '_' in param_name:
                                    parts = param_name.split('_', 1)
                                    if parts[0].isdigit() and len(parts) == 2:
                                        actual_field_name = parts[1]

                                # 相对时间转日期范围
                                if isinstance(param_value, str):
                                    resolved = _resolve_relative_date(param_value)
                                    if resolved:
                                        param_value = resolved

                                # 只保留表中存在的字段
                                if actual_field_name.lower() in table_fields:
                                    # 重新生成条件（使用转义函数）
                                    if isinstance(param_value, dict) and 'start' in param_value and 'end' in param_value:
                                        start_value = param_value.get('start')
                                        end_value = param_value.get('end')
                                        if start_value and end_value:
                                            esc_start = _sql_escape_sql_string(str(start_value))
                                            esc_end = _sql_escape_sql_string(str(end_value))
                                            condition = f"{_quote_sql_identifier(actual_field_name)} BETWEEN '{esc_start}' AND '{esc_end}'"
                                            valid_conditions.append(condition)
                                        elif start_value:
                                            esc_start = _sql_escape_sql_string(str(start_value))
                                            condition = f"{_quote_sql_identifier(actual_field_name)} >= '{esc_start}'"
                                            valid_conditions.append(condition)
                                        elif end_value:
                                            esc_end = _sql_escape_sql_string(str(end_value))
                                            condition = f"{_quote_sql_identifier(actual_field_name)} <= '{esc_end}'"
                                            valid_conditions.append(condition)
                                    elif isinstance(param_value, list) and len(param_value) > 0:
                                        esc_values = ", ".join(f"'{_sql_escape_sql_string(str(v))}'" for v in param_value)
                                        condition = f"{_quote_sql_identifier(actual_field_name)} IN ({esc_values})"
                                        valid_conditions.append(condition)
                                    else:
                                        esc_val = _sql_escape_sql_string(str(param_value))
                                        condition = f"{_quote_sql_identifier(actual_field_name)} = '{esc_val}'"
                                        valid_conditions.append(condition)

                            # 如果有有效条件，重新生成SQL
                            if valid_conditions:
                                sql_query = dataset_query.get('native', {}).get('query', '')
                                where_clause = " AND ".join(valid_conditions)

                                # 重新插入WHERE条件
                                if 'WHERE' in sql_query.upper():
                                    match = re.search(r'\bWHERE\b', sql_query, re.IGNORECASE)
                                    if match:
                                        insert_pos = match.end()
                                        sql_query = sql_query[:insert_pos] + " " + where_clause + " AND" + sql_query[insert_pos:]
                                else:
                                    limit_match = re.search(r'\bLIMIT\b', sql_query, re.IGNORECASE)
                                    order_match = re.search(r'\bORDER\s+BY\b', sql_query, re.IGNORECASE)
                                    group_match = re.search(r'\bGROUP\s+BY\b', sql_query, re.IGNORECASE)
                                    positions = []
                                    if limit_match: positions.append(limit_match.start())
                                    if order_match: positions.append(order_match.start())
                                    if group_match: positions.append(group_match.start())
                                    if positions:
                                        insert_pos = min(positions)
                                        sql_query = sql_query[:insert_pos] + " WHERE " + where_clause + " " + sql_query[insert_pos:]
                                    else:
                                        sql_query = sql_query.rstrip().rstrip(';') + " WHERE " + where_clause

                                sql_query = _apply_default_limit(sql_query, settings.CHART_QUERY_LIMIT)
                                async with temp_engine.connect() as conn:
                                    result = await conn.execute(text(sql_query))
                                    rows = result.fetchall()
                                    columns = result.keys()
                                    data = []
                                    for row in rows:
                                        item = dict(zip(columns, row))
                                        for k, v in list(item.items()):
                                            if isinstance(v, (datetime, date)):
                                                item[k] = v.isoformat()
                                        data.append(item)
                                    return data
                    except Exception as retry_error:
                        logger.error(f"重试查询也失败: {retry_error}")
                        # 重试失败，抛出原始错误
                        raise query_error
            finally:
                # 引擎是全局缓存复用的，这里不要 dispose()，否则会导致频繁建连/断连，引发崩溃与性能抖动
                pass
                
        except Exception as e:
            logger.error(f"执行查询失败: {str(e)}")
            raise Exception(f"查询执行失败: {str(e)}")

    async def get_filter_options(
        self,
        data_source_id: int,
        table_name: str,
        field_name: str,
        limit: int = 100,
        filter_conditions: Dict[str, Any] = None,
    ) -> List[Any]:
        """获取筛选器的选项列表（从数据库查询唯一值），支持级联条件过滤"""
        try:
            db_model = await self.db.get(Database, data_source_id)
            if not db_model:
                raise Exception("数据源不存在")

            # 解密密码（支持双轨：加密和明文）
            decrypted_password = decrypt_password(db_model.password)
            db_url = f"mysql+aiomysql://{db_model.username}:{decrypted_password}@{db_model.host}:{db_model.port}/{db_model.database_name}"

            # 注意：这里是单表取唯一值；如果 field_name 带别名/前缀（如 t.col），只取最后一段 col
            base_field_name = (field_name or "").strip()
            if "." in base_field_name:
                base_field_name = base_field_name.split(".")[-1].strip()
            if not base_field_name:
                raise Exception("字段名为空")

            quoted_table = _quote_mysql_identifier(table_name)
            quoted_field = _quote_mysql_identifier(base_field_name)
            safe_limit = int(limit) if limit is not None else 100
            if safe_limit < 1:
                safe_limit = 1

            def _build_cascade_parts(conditions: Dict[str, Any]) -> List[str]:
                """把前端传来的 filter_conditions 转换为 WHERE 子句片段"""
                parts = []
                for param_name, param_value in (conditions or {}).items():
                    if param_value is None or param_value == "":
                        continue
                    # 兼容 filterId_fieldName 格式
                    actual_field = param_name
                    if "_" in param_name:
                        split_parts = param_name.split("_", 1)
                        if split_parts[0].isdigit() and len(split_parts) == 2:
                            actual_field = split_parts[1]
                    if not actual_field:
                        continue
                    qf = f"`{actual_field.replace('`', '``')}`"
                    if isinstance(param_value, dict) and ("start" in param_value or "end" in param_value):
                        s = param_value.get("start")
                        e = param_value.get("end")
                        if s and e:
                            parts.append(f"{qf} BETWEEN '{s}' AND '{e}'")
                        elif s:
                            parts.append(f"{qf} >= '{s}'")
                        elif e:
                            parts.append(f"{qf} <= '{e}'")
                    elif isinstance(param_value, list) and param_value:
                        vals = "', '".join(str(v) for v in param_value)
                        parts.append(f"{qf} IN ('{vals}')")
                    else:
                        parts.append(f"{qf} = '{param_value}'")
                return parts

            cascade_parts = _build_cascade_parts(filter_conditions)

            def _make_sql(extra_parts: List[str]) -> str:
                where_parts = [f"{quoted_field} IS NOT NULL"] + extra_parts
                where_clause = " AND ".join(where_parts)
                return (
                    f"SELECT DISTINCT {quoted_field} AS value "
                    f"FROM {quoted_table} "
                    f"WHERE {where_clause} "
                    f"ORDER BY {quoted_field} "
                    f"LIMIT {safe_limit}"
                )

            # 使用缓存的引擎
            temp_engine = await _get_db_engine(db_model)
            try:
                async with temp_engine.connect() as conn:
                    sql_query = _make_sql(cascade_parts)
                    try:
                        result = await conn.execute(text(sql_query))
                    except Exception as cond_err:
                        # 级联条件引用了不存在的字段，回退到无条件查询
                        if cascade_parts:
                            logger.warning(f"级联条件查询失败: {cond_err}，回退到无条件查询")
                            sql_query = _make_sql([])
                            result = await conn.execute(text(sql_query))
                        else:
                            raise
                    rows = result.fetchall()
                    options = [row[0] for row in rows if row and row[0] is not None]
                    return options
            finally:
                # 引擎是缓存复用的，不要 dispose()
                pass

        except Exception as e:
            logger.error(f"获取筛选器选项失败: {str(e)}")
            raise Exception(f"获取筛选器选项失败: {str(e)}")
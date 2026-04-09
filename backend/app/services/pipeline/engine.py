# backend/app/services/pipeline/engine.py
"""Pipeline 执行引擎 (PipelineEngine)

分步执行 SQL 逻辑的引擎。
核心特点：
1. 不生成巨大的 CTE，而是分步执行
2. 每步结果写入临时表
3. 支持前端点击节点预览数据
4. 分批流式处理 - 避免大数据量时卡死
5. 支持增量更新 - 通过水位线管理

执行流程：
Step 0: 源 SQL -> 临时表(step_0)
Step 1: 从临时表读取 step_0 -> 执行节点 1 的 SQL -> 临时表(step_1)
Step 2: 从临时表读取 step_1 -> 执行节点 2 的 SQL -> 临时表(step_2)
...以此类推
"""
import copy
import json
import logging
import re
import time
from typing import List, Dict, Any, Optional, Tuple, Set
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession, AsyncEngine
from sqlalchemy import text, update

from app.models.pipeline import DataPipeline, PipelineExecution
from app.services.pipeline.temp_table_manager import TempTableManager
from app.services.pipeline.watermark_manager import WatermarkManager

logger = logging.getLogger(__name__)


def _preview_value_to_column_type(v: Any) -> str:
    """根据驱动返回的 Python 值推断列类型，与前端 getDataTypeInfo 使用的名称对齐。"""
    if v is None:
        return "string"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int) and not isinstance(v, bool):
        return "int"
    if isinstance(v, float):
        return "decimal"
    if isinstance(v, Decimal):
        return "decimal"
    if isinstance(v, datetime):
        return "datetime"
    if isinstance(v, date):
        return "date"
    if isinstance(v, (bytes, bytearray)):
        return "string"
    return "string"


def _infer_preview_column_types(rows_raw: List[Any], num_cols: int) -> List[str]:
    """用前若干行非空单元格推断每列类型；无行或全空时退化为 string。"""
    if num_cols <= 0:
        return []
    if not rows_raw:
        return ["string"] * num_cols
    col_types: List[str] = []
    for i in range(num_cols):
        picked: Any = None
        for row in rows_raw[:50]:
            if len(row) <= i:
                continue
            cell = row[i]
            if cell is not None:
                picked = cell
                break
        col_types.append(_preview_value_to_column_type(picked))
    return col_types


# 与前端 nodeTypeRegistry LEGACY_TYPE_MAP 一致：预览 SQL 生成用规范类型
_PIPELINE_NODE_TYPE_CANON = {
    "transform": "filter",
    "merge": "join",
}


class PipelineEngine:
    """
    分步执行引擎

    执行流程：
    Step 0: 源 SQL -> 临时表(step_0)
    Step 1: 从临时表读取 step_0 -> 执行节点 1 的 SQL -> 临时表(step_1)
    Step 2: 从临时表读取 step_1 -> 执行节点 2 的 SQL -> 临时表(step_2)
    ...以此类推
    """

    def __init__(
        self,
        session: AsyncSession,
        data_source_engine: AsyncEngine,
        data_source_id: int
    ):
        """
        初始化执行引擎

        Args:
            session: SQLAlchemy 会话（用于更新执行记录）
            data_source_engine: 数据源数据库引擎
            data_source_id: 数据源 ID
        """
        self.session = session
        self.data_source_engine = data_source_engine
        self.data_source_id = data_source_id
        self.temp_manager: Optional[TempTableManager] = None
        self.watermark_manager: Optional[WatermarkManager] = None
        self._default_batch_size = 5000  # 默认批次大小

    async def run(
        self,
        pipeline: DataPipeline,
        execution: PipelineExecution,
        config: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        执行管道

        Args:
            pipeline: 管道配置
            execution: 执行记录
            config: 执行配置（可选，覆盖管道的默认配置）

        Returns:
            (success, error_message, result_summary)
        """
        start_time = time.time()
        logs = []
        completed_steps = []
        result_summary = {
            "total_steps": 0,
            "completed_steps": 0,
            "step_details": []
        }

        try:
            # 解析节点配置
            nodes = self._parse_nodes(pipeline.nodes or [])
            if not nodes:
                return False, "管道没有配置节点", result_summary

            result_summary["total_steps"] = len(nodes)

            # 创建临时表管理器和水位线管理器
            async with self.data_source_engine.connect() as conn:
                self.temp_manager = TempTableManager(conn, execution.id)
                self.watermark_manager = WatermarkManager(self.session)
                await self.temp_manager.create_json_temp_table()

                # 执行执行前清理（如果有）
                await self._cleanup_old_executions(pipeline.id)

                # 更新执行状态为 running
                await self._update_execution_status(
                    execution.id,
                    "running",
                    temp_table_name=self.temp_manager.json_table_name,
                    started_at=datetime.utcnow()
                )

                logs.append({"time": datetime.utcnow().isoformat(), "message": "开始执行管道"})

                # 按拓扑序执行节点
                sorted_nodes = self._topological_sort(nodes)
                if sorted_nodes is None:
                    return False, "管道配置存在循环依赖", result_summary

                # 构建 node_id -> step_id 映射表
                node_step_map: Dict[str, str] = {}
                step_idx = 0

                # 获取执行配置
                exec_config = config or pipeline.config or {}
                default_batch_size = exec_config.get("batch_size", self._default_batch_size)

                # 跨步骤累加进度（避免每步从 ORM 重置导致覆盖库中已有步骤）
                all_step_progress: Dict[str, Any] = dict(execution.step_progress or {})

                for node in sorted_nodes:
                    node_id = node.get("id") or f"node_{step_idx}"
                    step_id = f"step_{step_idx}"
                    node_name = node.get("name", f"步骤 {step_idx+1}")
                    node_sql = node.get("sql", "")
                    node_config = node.get("config", {}) or {}
                    upstream = node.get("upstream")

                    logs.append({
                        "time": datetime.utcnow().isoformat(),
                        "message": f"开始执行节点: {node_name} ({step_id})"
                    })

                    # 初始化步骤进度
                    all_step_progress[step_id] = {
                        "status": "running",
                        "rows": 0,
                        "started_at": datetime.utcnow().isoformat(),
                        "phase": "querying",
                        "phase_message": "正在执行 SQL 查询（数据量大时需较长时间）…",
                    }
                    await self._update_execution_status(
                        execution.id,
                        "running",
                        current_step_id=step_id,
                        current_step_rows=0,
                        step_progress=all_step_progress,
                    )

                    try:
                        # 获取上游的 step_id 列表
                        upstream_step_ids: List[str] = []
                        if upstream:
                            upstream_step_ids = [
                                node_step_map[uid]
                                for uid in upstream
                                if uid in node_step_map
                            ]
                        elif step_idx > 0:
                            # 旧数据兼容：如果没有 upstream，依赖前一个节点
                            upstream_step_ids = [f"step_{step_idx - 1}"]

                        canonical_type = PipelineEngine._canonical_pipeline_node_type(
                            str(node.get("type") or "")
                        )
                        merge_type = node.get("merge_type")  # 获取 merge 节点的合并类型

                        # 构建引用上游列式表的 SQL（关联节点会展开 SELECT *，避免两侧同名列导致 1060）
                        # UNION 类型的 merge 节点不展开 SELECT *
                        actual_sql = self._build_step_sql(
                            node_sql,
                            upstream_step_ids,
                            self.temp_manager._struct_tables,
                            canonical_type,
                            merge_type,
                        )

                        # 与预览折叠 SQL（build_chained_sql）一致：行筛选、列选、插入列（insertedColumns）
                        # 来自 config，而非写死在 node.sql。仅替换占位符而不合并 config 时，插入列不会进临时表/输出表。
                        if canonical_type != "output":
                            actual_sql = PipelineEngine._apply_row_filter(
                                actual_sql, node_config
                            )
                            actual_sql = PipelineEngine._apply_column_projection(
                                actual_sql, node_config, None
                            )

                        # 验证 SQL 安全性
                        if not self._validate_sql(actual_sql):
                            raise ValueError("SQL 语句包含不允许的操作")

                        # 处理增量更新（仅对 source 节点生效）
                        is_incremental = node_config.get("incremental", False)
                        if is_incremental and not upstream_step_ids:  # 仅 source 节点
                            actual_sql = await self._apply_incremental_condition(
                                actual_sql,
                                pipeline.id,
                                node_id,
                                node_config
                            )

                        if canonical_type == "output":
                            # 输出节点：写入用户配置的目标表，不再写入引擎列式临时表
                            target_plain = (node_config.get("targetTable") or "").strip()
                            quoted_tbl = PipelineEngine._validate_and_quote_table_name(target_plain)
                            if not quoted_tbl:
                                raise ValueError(
                                    "输出节点目标表名无效（仅允许字母、数字、下划线，长度 1-64）"
                                )
                            write_mode = str(node_config.get("writeMode") or "upsert").lower()
                            if write_mode not in ("replace", "append", "upsert"):
                                raise ValueError(
                                    f"不支持的写入模式: {write_mode}（应为 replace | append | upsert）"
                                )
                            select_sql = actual_sql.rstrip().rstrip(";")

                            # 先查出当前库中是否存在目标表
                            exist_res = await conn.execute(text(
                                "SELECT COUNT(*) FROM information_schema.TABLES "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tbl"
                            ), {"tbl": target_plain})
                            table_exists = exist_res.fetchone()[0] > 0

                            if not table_exists:
                                # 无论选择什么模式，表不存在时先建表
                                await conn.execute(
                                    text(f"CREATE TABLE {quoted_tbl} AS {select_sql}")
                                )
                                await conn.commit()
                                logs.append({
                                    "time": datetime.utcnow().isoformat(),
                                    "message": f"表 {target_plain} 不存在，已自动创建"
                                })
                            elif write_mode == "replace":
                                await conn.execute(text(f"DROP TABLE IF EXISTS {quoted_tbl}"))
                                await conn.commit()
                                await conn.execute(
                                    text(f"CREATE TABLE {quoted_tbl} AS {select_sql}")
                                )
                            elif write_mode == "upsert":
                                # Upsert：INSERT ... ON DUPLICATE KEY UPDATE（全量更新冲突行）
                                # 需要上游节点提供唯一键列
                                unique_key = (node_config.get("uniqueKey") or "").strip()
                                if not unique_key:
                                    raise ValueError(
                                        "Upsert 模式必须指定唯一键列（uniqueKey），请在节点配置中填写"
                                    )
                                safe_key = unique_key.replace("`", "").strip()
                                if not re.match(r"^[a-zA-Z0-9_]{1,64}$", safe_key):
                                    raise ValueError(
                                        f"唯一键列名不合法: {unique_key}"
                                    )
                                # 获取 SELECT 输出的所有列，构造 UPDATE SET 子句
                                src_cols = await self._fetch_mysql_table_columns(conn, target_plain)
                                update_clauses = [
                                    f"`{c.replace('`', '')}` = VALUES(`{c.replace('`', '')}`)"
                                    for c in src_cols
                                ]
                                upsert_sql = (
                                    f"INSERT INTO {quoted_tbl} {select_sql} "
                                    f"ON DUPLICATE KEY UPDATE {', '.join(update_clauses)}"
                                )
                                await conn.execute(text(upsert_sql))
                            else:
                                # append
                                await conn.execute(
                                    text(f"INSERT INTO {quoted_tbl} {select_sql}")
                                )
                            await conn.commit()
                            cnt_res = await conn.execute(
                                text(f"SELECT COUNT(*) FROM {quoted_tbl}")
                            )
                            row_count = cnt_res.fetchone()[0]
                            columns = await self._fetch_mysql_table_columns(conn, target_plain)
                        else:
                            # INSERT...SELECT 直接写入列式临时表（不经过 Python 逐行搬运）
                            row_count, columns = await self._execute_step_via_insert_select(
                                conn=conn,
                                sql=actual_sql,
                                step_id=step_id,
                                execution_id=execution.id,
                            )

                        # 更新 node_id -> step_id 映射
                        node_step_map[node_id] = step_id

                        # 记录完成
                        completed_steps.append({
                            "step_id": step_id,
                            "node_id": node_id,
                            "node_name": node_name,
                            "row_count": row_count,
                            "columns": columns,
                            "executed_at": datetime.utcnow().isoformat(),
                            "incremental": is_incremental
                        })

                        # 更新水位线（如果是增量源节点）
                        if is_incremental and not upstream_step_ids:
                            incremental_field = node_config.get("incrementalField")
                            if incremental_field and row_count > 0:
                                # 从列式表读取最大值（列式表直接可查）
                                if step_id in self.temp_manager._struct_tables:
                                    tbl_name, _ = self.temp_manager._struct_tables[step_id]
                                    safe_col = f"`{incremental_field.replace('`', '')}`"
                                    max_sql = f"SELECT MAX({safe_col}) FROM {tbl_name}"
                                else:
                                    max_sql = actual_sql
                                max_value = await self._get_max_value_from_select(
                                    conn, max_sql
                                )
                                if max_value is not None:
                                    await self.watermark_manager.update_watermark(
                                        pipeline.id,
                                        node_id,
                                        incremental_field,
                                        str(max_value)
                                    )
                                    logs.append({
                                        "time": datetime.utcnow().isoformat(),
                                        "message": f"水位线已更新: {incremental_field} = {max_value}"
                                    })

                        # 更新步骤进度为完成
                        all_step_progress[step_id] = {
                            "status": "completed",
                            "rows": row_count,
                            "completed_at": datetime.utcnow().isoformat(),
                        }

                        result_summary["step_details"].append({
                            "step_id": step_id,
                            "name": node_name,
                            "rows": row_count,
                            "status": "completed"
                        })

                        logs.append({
                            "time": datetime.utcnow().isoformat(),
                            "message": f"节点 {node_name} 执行完成，{row_count} 行"
                        })

                        step_idx += 1

                    except Exception as step_error:
                        error_msg = f"节点 {node_name} 执行失败: {str(step_error)}"
                        logs.append({
                            "time": datetime.utcnow().isoformat(),
                            "message": error_msg,
                            "level": "error"
                        })
                        logger.error(error_msg)

                        # 更新步骤进度为失败
                        all_step_progress[step_id] = {
                            "status": "failed",
                            "error": str(step_error),
                            "failed_at": datetime.utcnow().isoformat(),
                        }

                        # 更新执行状态为失败
                        await self._update_execution_status(
                            execution.id,
                            "failed",
                            error_message=str(step_error),
                            completed_at=datetime.utcnow(),
                            execution_time_ms=int((time.time() - start_time) * 1000),
                            completed_steps=completed_steps,
                            step_progress=all_step_progress,
                            logs=logs
                        )

                        return False, str(step_error), result_summary

                # 计算总行数
                total_rows = sum(step["row_count"] for step in completed_steps)
                execution_time_ms = int((time.time() - start_time) * 1000)

                # 更新执行状态为完成
                result_summary["completed_steps"] = len(completed_steps)
                result_summary["total_rows"] = total_rows

                await self._update_execution_status(
                    execution.id,
                    "completed",
                    completed_at=datetime.utcnow(),
                    execution_time_ms=execution_time_ms,
                    total_rows=total_rows,
                    completed_steps=completed_steps,
                    result_summary=result_summary,
                    step_progress=all_step_progress,
                    logs=logs
                )

                logs.append({
                    "time": datetime.utcnow().isoformat(),
                    "message": f"管道执行完成，总行数: {total_rows}，耗时: {execution_time_ms}ms"
                })

                # 清理持久表（成功时）
                try:
                    await self.temp_manager.cleanup_temp_table()
                except Exception as cleanup_err:
                    logger.warning(f"清理持久表失败（不影响结果）: {cleanup_err}")

                return True, "", result_summary

        except Exception as e:
            error_msg = f"管道执行失败: {str(e)}"
            logger.error(error_msg)

            await self._update_execution_status(
                execution.id,
                "failed",
                error_message=error_msg,
                completed_at=datetime.utcnow(),
                execution_time_ms=int((time.time() - start_time) * 1000),
                completed_steps=completed_steps,
                logs=logs
            )

            return False, error_msg, result_summary

        finally:
            # 无论如何都确保清理持久表
            if self.temp_manager:
                try:
                    await self.temp_manager.cleanup_temp_table()
                except Exception as cleanup_err:
                    logger.warning(f"finally: 清理持久表失败: {cleanup_err}")

    async def _execute_step_via_insert_select(
        self,
        conn,
        sql: str,
        step_id: str,
        execution_id: int,
        sample_rows: int = 5
    ) -> Tuple[int, List[str]]:
        """
        通过 INSERT...SELECT 直接写入列式临时表（不走 fetchmany）。

        流程：
        1. 发现源 SQL 的 schema（列名 + MySQL 类型）
        2. 创建列式临时表
        3. INSERT...SELECT 一次性写入
        4. 用 COUNT(*) 估算进度
        5. 标记完成

        Args:
            conn: 数据库连接
            sql: 要执行的 SELECT 语句
            step_id: 步骤 ID
            execution_id: 执行记录 ID
            sample_rows: schema 发现采样行数

        Returns:
            (total_rows, columns)
        """
        # 阶段 1: 报告"估算行数"
        sql_stripped = sql.rstrip().rstrip(';')
        has_union = re.search(r'\bUNION\b', sql_stripped, re.IGNORECASE)
        if has_union:
            # UNION SQL 本身已是最终结果，直接包装 COUNT，不需要外层子查询
            est_sql = f"SELECT COUNT(*) FROM ({sql_stripped}) AS _cnt"
        else:
            est_sql = f"SELECT COUNT(*) FROM ({sql_stripped}) AS _est"
        try:
            est_result = await conn.execute(text(est_sql))
            est_row = est_result.fetchone()
            estimated = est_row[0] if est_row else 0
            await self._update_step_progress(execution_id, step_id, 0, estimated=estimated)
        except Exception as e:
            logger.warning(f"估算行数失败: {e}")
            estimated = 0

        # 阶段 2: INSERT...SELECT
        row_count, columns = await self.temp_manager.insert_via_select(step_id, sql, sample_rows)

        # 阶段 3: 完成后更新进度
        await self._update_step_progress(execution_id, step_id, row_count)

        return row_count, columns

    async def _apply_incremental_condition(
        self,
        sql: str,
        pipeline_id: int,
        node_id: str,
        config: Dict[str, Any]
    ) -> str:
        """
        为 SQL 应用增量条件

        Args:
            sql: 原始 SQL
            pipeline_id: 管道 ID
            node_id: 节点 ID
            config: 节点配置

        Returns:
            应用了增量条件的 SQL
        """
        if not self.watermark_manager:
            return sql

        # 获取水位线
        watermark_value = await self.watermark_manager.get_watermark(pipeline_id, node_id)
        if not watermark_value:
            # 首次运行，没有水位线，返回原始 SQL（全量）
            logger.info(f"节点 {node_id} 首次运行，执行全量查询")
            return sql

        # 获取增量配置
        incremental_field = config.get("incrementalField")
        incremental_type = config.get("incrementalType", "gt")

        if not incremental_field:
            logger.warning(f"节点 {node_id} 启用了增量但未配置增量字段")
            return sql

        # 构建增量 SQL
        operator = ">" if incremental_type == "gt" else ">="
        return self.watermark_manager.build_incremental_sql(
            sql,
            incremental_field,
            watermark_value,
            operator
        )

    async def _get_max_value_from_select(
        self,
        conn,
        sql: str
    ) -> Optional[Any]:
        """
        从 SELECT 查询中取第一行第一列的值（用于水位线）

        Args:
            conn: 数据库连接
            sql: 直接可执行的 SELECT 语句

        Returns:
            值，没有数据则返回 None
        """
        try:
            result = await conn.execute(text(sql))
            row = result.fetchone()
            if row and row[0] is not None:
                val = row[0]
                if hasattr(val, "isoformat"):
                    return val.isoformat()
                return val
            return None
        except Exception as e:
            logger.error(f"获取最大值失败: {e}")
            return None

    async def _update_step_progress(
        self,
        execution_id: int,
        step_id: str,
        rows: int,
        estimated: int = 0
    ):
        """
        更新步骤进度

        Args:
            execution_id: 执行记录 ID
            step_id: 步骤 ID
            rows: 已处理的行数
            estimated: 估算总行数（用于显示进度百分比）
        """
        try:
            from sqlalchemy import select
            from app.models.pipeline import PipelineExecution

            stmt = select(PipelineExecution).where(PipelineExecution.id == execution_id)
            result = await self.session.execute(stmt)
            execution = result.scalar_one_or_none()

            if execution:
                step_progress = execution.step_progress or {}
                phase_message = ""
                if rows == 0 and estimated > 0:
                    phase = "estimating"
                    phase_message = f"估算中…约 {estimated:,} 行"
                else:
                    phase = "writing"
                    phase_message = f"写入中…{rows:,} 行"
                    if estimated > 0:
                        pct = min(100, int(rows / estimated * 100)) if estimated > 0 else 0
                        phase_message = f"写入中 {pct}%（{rows:,}/{estimated:,} 行）"

                if step_id in step_progress:
                    step_progress[step_id]["rows"] = rows
                    if estimated > 0:
                        step_progress[step_id]["estimated"] = estimated
                    step_progress[step_id]["phase"] = phase
                    step_progress[step_id]["phase_message"] = phase_message
                else:
                    step_progress[step_id] = {
                        "status": "running",
                        "rows": rows,
                        "phase": phase,
                        "phase_message": phase_message,
                    }
                    if estimated > 0:
                        step_progress[step_id]["estimated"] = estimated

                execution.current_step_id = step_id
                execution.current_step_rows = rows
                execution.step_progress = step_progress

                await self.session.commit()
        except Exception as e:
            logger.error(f"更新步骤进度失败: {e}")

    async def _check_cancelled(self, execution_id: int) -> bool:
        """
        检查执行是否被取消

        Args:
            execution_id: 执行记录 ID

        Returns:
            是否被取消
        """
        try:
            from sqlalchemy import select
            from app.models.pipeline import PipelineExecution

            stmt = select(PipelineExecution.status).where(PipelineExecution.id == execution_id)
            result = await self.session.execute(stmt)
            status = result.scalar_one_or_none()
            return status == "cancelled"
        except Exception as e:
            logger.error(f"检查取消状态失败: {e}")
            return False

    def _topological_sort(self, nodes: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
        """
        Kahn 算法拓扑排序

        Args:
            nodes: 节点配置列表

        Returns:
            排序后的节点列表，如果存在环返回 None
        """
        if not nodes:
            return []

        # 构建 node_id -> node 映射
        node_map: Dict[str, Dict[str, Any]] = {}
        for i, node in enumerate(nodes):
            node_id = node.get("id") or f"node_{i}"
            node_map[node_id] = node

        # 构建入度表和邻接表
        all_ids = set(node_map.keys())
        in_degree: Dict[str, int] = {nid: 0 for nid in all_ids}
        adjacency: Dict[str, List[str]] = {nid: [] for nid in all_ids}

        for node_id, node in node_map.items():
            upstream = node.get("upstream") or []
            for up_id in upstream:
                if up_id in all_ids:
                    in_degree[node_id] += 1
                    adjacency[up_id].append(node_id)

        # Kahn 算法
        queue = [nid for nid in all_ids if in_degree[nid] == 0]
        sorted_ids: List[str] = []

        while queue:
            current = queue.pop(0)
            sorted_ids.append(current)
            for neighbor in adjacency[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(sorted_ids) != len(all_ids):
            # 存在环
            logger.error("管道配置存在循环依赖")
            return None

        return [node_map[nid] for nid in sorted_ids]

    def _parse_nodes(self, nodes_config: Any) -> List[Dict[str, Any]]:
        """
        解析节点配置

        Args:
            nodes_config: JSON 格式的节点配置

        Returns:
            排序后的节点列表
        """
        if not nodes_config:
            return []

        if isinstance(nodes_config, str):
            try:
                nodes_config = json.loads(nodes_config)
            except json.JSONDecodeError:
                return []

        if not isinstance(nodes_config, list):
            return []

        # 按 order 排序
        sorted_nodes = sorted(
            nodes_config,
            key=lambda x: x.get("order", 999) if isinstance(x, dict) else 999
        )

        return [n for n in sorted_nodes if isinstance(n, dict) and n.get("sql")]

    @staticmethod
    def _expand_join_select_stars(
        sql: str,
        upstream_step_ids: List[str],
        struct_table_map: Dict[str, Tuple[str, List[str]]],
        on_right_cols: Optional[List[str]] = None,
    ) -> str:
        """
        将关联 SQL 中的 SELECT * 展开为显式列。

        LEFT JOIN 语义：结果 = 左表全部列 + 右表不含 ON 右表列的列。
        例如 ON a.id = b.ref_id → 右表的 ref_id 不出现在结果中（id 已来自左表）。

        若不传 on_right_cols，仅做向后兼容的去重（同名列只保留一个）。
        """
        if len(upstream_step_ids) < 2:
            return sql
        lc = struct_table_map.get(upstream_step_ids[0])
        rc = struct_table_map.get(upstream_step_ids[1])
        if not lc or not rc:
            return sql
        _, left_cols = lc
        _, right_cols = rc
        if not left_cols or not right_cols:
            return sql
        up = sql.upper()
        if " JOIN " not in up or " AS A " not in up or " AS B " not in up:
            return sql
        sel = PipelineEngine._join_explicit_select_list(left_cols, right_cols, on_right_cols)
        return re.sub(
            r"SELECT\s+\*\s+FROM\s+",
            f"SELECT {sel} FROM ",
            sql,
            flags=re.IGNORECASE,
        )

    @staticmethod
    def _join_explicit_select_list(
        left_cols: List[str],
        right_cols: List[str],
        on_right_cols: Optional[List[str]] = None,
    ) -> str:
        """
        生成 JOIN 结果的显式列列表。

        LEFT JOIN: 左表全列 + 右表列（排除右表 ON 列，因为左表 ON 列已在结果中）。
        无 on_right_cols 时：仅去重同名列（左表优先）。
        """
        left_set = set(left_cols)
        on_right_set = set(on_right_cols) if on_right_cols else set()
        parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
        for c in right_cols:
            if c not in left_set:
                # 排除右表 ON 列（左表对应列已在结果中）
                if c not in on_right_set:
                    parts.append(f"b.{PipelineEngine._safe_identifier(c)}")
        return ", ".join(parts)

    @staticmethod
    def _join_preview_allowed_sql_columns(
        join_type: str,
        left_cols: Optional[List[str]],
        right_cols: Optional[List[str]],
        on_right_cols: Optional[List[str]],
        symmetric_union_plan: Optional[List[Any]] = None,
    ) -> Optional[Set[str]]:
        """
        链式预览中，JOIN 内层子查询在「当前类型 + 列推断」下实际存在的列名集合。
        用于过滤 config.outputColumnKeys 中已失效的键（例如 Inner 时产生的 sum_星级_b
        在 Left Anti 下不存在）。

        若无法完整枚举（如 inner/left/right 且仅一侧列可知、另一侧为 a.* / b.*），返回 None
        表示不按白名单过滤。
        """
        jt = (join_type or "inner").lower()
        on_set = set(on_right_cols) if on_right_cols else set()

        if jt == "left_anti":
            return set(left_cols) if left_cols is not None else None
        if jt == "right_anti":
            return set(right_cols) if right_cols is not None else None
        if jt == "symmetric_diff":
            plan = symmetric_union_plan
            if isinstance(plan, list) and plan:
                outs: List[str] = []
                for row in plan:
                    if isinstance(row, dict):
                        o = str(row.get("out") or row.get("alias") or "").strip()
                        if o:
                            outs.append(o)
                if outs:
                    return set(outs)
            return None
        # FULL OUTER 两半 UNION 的列与 LEFT JOIN 结果一致，按 left 枚举可投影列
        if jt == "full":
            jt = "left"
        if jt not in ("inner", "left", "right"):
            return None

        if left_cols is not None and right_cols is not None:
            left_set = set(left_cols)
            names: List[str] = list(left_cols)
            for c in right_cols:
                if c not in left_set and c not in on_set:
                    names.append(c)
            return set(names)

        if left_cols is not None and right_cols is None and jt in ("left", "right") and on_right_cols:
            # LEFT/RIGHT JOIN：展开为左显式列 + 右表独有列（ON 列排除，加 _b 别名）
            names = list(left_cols)
            for c in (right_cols or []):
                if c not in on_set:
                    names.append(f"{c}_b")
            return set(names)

        return None

    def _build_step_sql(
        self,
        step_sql: str,
        upstream_step_ids: List[str],
        struct_table_map: Dict[str, Tuple[str, List[str]]],
        node_type: str = "",
        merge_type: Optional[str] = None,
    ) -> str:
        """
        构建实际执行的 SQL

        占位符替换规则：
        - {prev_table}: 替换为第一个上游节点的列式临时表
        - {upstream_table_0}, {upstream_table_1}, ...: 按索引引用上游临时表
        - {upstream_table_<step_id>}: 按 step_id 引用上游临时表
        - {prev_step_id}: 替换为第一个上游的 step_id

        Args:
            step_sql: 节点配置的 SQL
            upstream_step_ids: 上游节点的 step_id 列表
            struct_table_map: step_id -> (table_name, columns)
            node_type: 规范节点类型（如 join），用于关联节点展开 SELECT *
            merge_type: 合并类型（如 union, left_join 等），union 类型不展开 SELECT *

        Returns:
            实际执行的 SQL
        """
        if not step_sql:
            return ""

        sql = step_sql.strip()

        # 没有上游（source 节点），直接执行
        if not upstream_step_ids:
            return sql

        # 构建各上游的临时表引用（列式表直接引用，JSON 表走子查询）
        # 含统一别名 AS _up{i}，由下游替换时按需去掉以避免与 join SQL 的外层别名冲突。
        upstream_refs: List[str] = []
        for i, sid in enumerate(upstream_step_ids):
            if sid in struct_table_map:
                tbl_name, columns = struct_table_map[sid]
                safe_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in columns)
                upstream_refs.append(f"(SELECT {safe_cols} FROM {tbl_name}) AS _up{i}")
            else:
                upstream_refs.append(f"(SELECT data_json FROM {self.temp_manager.json_table_name} WHERE step_id = '{sid}') AS _up{i}")

        canonical_type = PipelineEngine._canonical_pipeline_node_type(node_type)
        is_union_merge = bool(
            merge_type and merge_type.lower() in ("union", "union all")
        )
        # 占位符替换前的模板快照（用于判断 JOIN 是否在占位符后紧跟 AS a/b）
        template_for_placeholders = sql

        def _upstream_ref_for_placeholder(placeholder: str, i: int) -> str:
            """JOIN 模板为 {upstream_table_0} AS a …，子查询不得再带 AS _up；UNION 等为 FROM {upstream_table_0}，须有别名。"""
            clean = re.sub(r"\s+AS\s+_\w+$", "", upstream_refs[i])
            if placeholder not in template_for_placeholders:
                return clean
            idx = template_for_placeholders.find(placeholder)
            tail = template_for_placeholders[
                idx + len(placeholder) : idx + len(placeholder) + 96
            ]
            if re.match(r"\s*AS\s+\w+", tail, re.I):
                return clean
            if clean.rstrip().endswith(")"):
                return f"{clean.rstrip()} AS _up{i}"
            return clean

        # 按索引替换
        for i in range(len(upstream_refs)):
            placeholder = f"{{upstream_table_{i}}}"
            if placeholder in sql:
                sql = sql.replace(
                    placeholder, _upstream_ref_for_placeholder(placeholder, i)
                )

        # 替换 {prev_table} 为第一个上游引用（含 AS _up0）
        if "{prev_table}" in sql:
            sql = sql.replace("{prev_table}", upstream_refs[0])

        # 替换 {prev_step_id}
        if "{prev_step_id}" in sql:
            sql = sql.replace("{prev_step_id}", upstream_step_ids[0])

        # 按 step_id 替换（与按索引替换同一套别名规则）
        for i, sid in enumerate(upstream_step_ids):
            placeholder = f"{{upstream_table_{sid}}}"
            if placeholder in sql:
                sql = sql.replace(
                    placeholder, _upstream_ref_for_placeholder(placeholder, i)
                )

        # 对于 JOIN 类型，需要展开 SELECT * 为显式列（避免同名列冲突）
        # 但对于 UNION 类型的 merge 节点，不展开 SELECT *，因为 UNION 按位置合并列
        if canonical_type == "join" and not is_union_merge:
            # 从 ON 子句中提取右表列（如 ON a.id = b.ref_id → ref_id）
            on_right_cols: List[str] = []
            on_match = re.search(r"\bON\s+(.+?)(?:\s+WHERE|\s+GROUP|\s+HAVING|\s+ORDER|\s+LIMIT|\s+UNION|$)", sql, re.IGNORECASE | re.DOTALL)
            if on_match:
                on_expr = on_match.group(1)
                # 匹配 b.col 或 "b"."col" 或 `b`.`col`
                right_col_pattern = re.compile(
                    r"\b(?:b\.)[`\"']?([a-zA-Z0-9_]+)[`\"']?|"
                    r"(?:b\) AS b\s*\.\s*([a-zA-Z0-9_]+))",
                    re.IGNORECASE
                )
                # 更直接地匹配 ON a.xxx = b.yyy 中的 b.xxx
                for m in re.finditer(r"b\.[`\"']?([a-zA-Z0-9_]+)[`\"']?", on_expr, re.IGNORECASE):
                    if m.group(1):
                        on_right_cols.append(m.group(1))
            sql = PipelineEngine._expand_join_select_stars(
                sql, upstream_step_ids, struct_table_map, on_right_cols if on_right_cols else None
            )

        # 没有占位符时：SQL 本身是 SELECT FROM 列式上游表（需要别名）
        if "{" not in sql:
            first_ref = upstream_refs[0]
            if sql.strip().upper().startswith("SELECT"):
                sql = f"SELECT * FROM ({sql}) AS _n"
            else:
                sql = f"SELECT * FROM ({sql}) AS _n"

        return sql

    def _validate_sql(self, sql: str) -> bool:
        """
        验证 SQL 安全性

        只允许 SELECT 语句

        Args:
            sql: SQL 语句

        Returns:
            是否安全
        """
        if not sql:
            return False

        sql_upper = sql.upper().strip()

        # 只允许 SELECT
        if not sql_upper.startswith("SELECT"):
            return False

        # 禁止的危险关键字
        dangerous_keywords = [
            "INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE",
            "ALTER", "CREATE", "GRANT", "REVOKE"
        ]

        for keyword in dangerous_keywords:
            # 确保是独立单词
            pattern = rf"\b{keyword}\b"
            if re.search(pattern, sql_upper):
                logger.warning(f"SQL 包含危险关键字: {keyword}")
                return False

        return True

    async def _update_execution_status(
        self,
        execution_id: int,
        status: str,
        **kwargs
    ):
        """
        更新执行记录状态

        Args:
            execution_id: 执行记录 ID
            status: 新状态
            **kwargs: 其他要更新的字段
        """
        try:
            update_values = {"status": status}
            update_values.update(kwargs)

            stmt = (
                update(PipelineExecution)
                .where(PipelineExecution.id == execution_id)
                .values(**update_values)
            )
            await self.session.execute(stmt)
            await self.session.commit()
        except Exception as e:
            logger.error(f"更新执行状态失败: {e}")
            # 不抛出异常，避免影响主流程

    async def _cleanup_old_executions(self, pipeline_id: int):
        """
        清理同一管道的旧执行记录中的临时表引用

        注意：MySQL TEMPORARY TABLE 在会话结束后自动清理，
        这里只是更新数据库记录

        Args:
            pipeline_id: 管道 ID
        """
        try:
            from sqlalchemy import select, and_

            # 查找同一管道下更早的已完成执行
            stmt = select(PipelineExecution).where(
                and_(
                    PipelineExecution.pipeline_id == pipeline_id,
                    PipelineExecution.status.in_(["completed", "failed"]),
                    PipelineExecution.id != self.temp_manager.exec_id if self.temp_manager else True
                )
            )
            result = await self.session.execute(stmt)
            old_executions = result.scalars().all()

            # 标记为已过期（让后台任务清理）
            for exec_record in old_executions:
                exec_record.status = "expired"

            await self.session.commit()
        except Exception as e:
            logger.warning(f"清理旧执行记录失败: {e}")

    @staticmethod
    def validate_pipeline_config(nodes: List[Dict[str, Any]]) -> Tuple[bool, str]:
        """
        验证管道配置

        Args:
            nodes: 节点配置列表

        Returns:
            (is_valid, error_message)
        """
        if not nodes:
            return False, "管道没有配置节点"

        if not isinstance(nodes, list):
            return False, "节点配置必须是数组格式"

        # 构建 node_id 集合并检查 upstream 引用
        all_ids = set()
        for i, node in enumerate(nodes):
            if not isinstance(node, dict):
                return False, f"节点 {i} 配置格式错误"
            if node.get("id"):
                all_ids.add(node["id"])

        for i, node in enumerate(nodes):
            if not node.get("name"):
                return False, f"节点 {i} 缺少名称"

            if not node.get("sql"):
                return False, f"节点 {node.get('name', i)} 缺少 SQL 语句"

            # 检查 SQL 安全性
            sql = node.get("sql", "").upper()
            dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE"]
            for kw in dangerous:
                if kw in sql:
                    return False, f"节点 {node.get('name', i)} 的 SQL 包含不允许的操作: {kw}"

            # 检查 upstream 引用的节点是否存在
            upstream = node.get("upstream") or []
            for up_id in upstream:
                if up_id not in all_ids:
                    return False, f"节点 '{node.get('name', i)}' 的上游节点 '{up_id}' 不存在"

            # 检查 merge_type（只允许 union / union all，关联用 join 节点）
            merge_type = node.get("merge_type")
            if merge_type and merge_type not in ('union', 'union all'):
                return False, f"节点 '{node.get('name', i)}' 的 merge_type 必须是 union | union all"

            # 输出节点：目标表与写入模式
            ntype = PipelineEngine._canonical_pipeline_node_type(str(node.get("type") or ""))
            if ntype == "output":
                cfg = node.get("config") or {}
                tt = str(cfg.get("targetTable") or "").strip()
                if not tt:
                    return False, f"节点 '{node.get('name', i)}' 为输出节点，请填写目标表名"
                if not re.match(r"^[a-zA-Z0-9_]{1,64}$", tt):
                    return False, f"节点 '{node.get('name', i)}' 的目标表名不合法"
                wm = str(cfg.get("writeMode") or "upsert").lower()
                if wm not in ("replace", "append", "upsert"):
                    return False, f"节点 '{node.get('name', i)}' 的 writeMode 必须是 replace | append | upsert"
                if wm == "upsert":
                    uk = str(cfg.get("uniqueKey") or "").strip()
                    if not uk:
                        return False, f"节点 '{node.get('name', i)}' 为 Upsert 模式，请填写唯一键列（uniqueKey）"
                    if not re.match(r"^[a-zA-Z0-9_]{1,64}$", uk):
                        return False, f"节点 '{node.get('name', i)}' 的唯一键列名不合法"

        # 拓扑排序检测环
        node_map = {node.get("id") or f"node_{i}": node for i, node in enumerate(nodes)}
        all_node_ids = set(node_map.keys())

        in_degree: Dict[str, int] = {nid: 0 for nid in all_node_ids}
        adjacency: Dict[str, List[str]] = {nid: [] for nid in all_node_ids}

        for node_id, node in node_map.items():
            for up_id in (node.get("upstream") or []):
                if up_id in all_node_ids:
                    in_degree[node_id] += 1
                    adjacency[up_id].append(node_id)

        queue = [nid for nid in all_node_ids if in_degree[nid] == 0]
        visited = 0

        while queue:
            current = queue.pop(0)
            visited += 1
            for neighbor in adjacency[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited != len(all_node_ids):
            return False, "管道配置存在循环依赖"

        return True, ""

    # ================================================================
    # 节点预览（用于无代码编辑器实时预览）
    # ================================================================

    @staticmethod
    def _safe_identifier(name: str) -> str:
        """安全地包裹表名/列名，避免 SQL 注入"""
        return f"`{name.replace('`', '``')}`"

    @staticmethod
    def _join_on_equality_sql(left_col: str, right_col: str) -> str:
        """ON 条件两侧统一 COLLATE，避免 MySQL 1267（utf8mb4_unicode_ci / utf8mb4_0900_ai_ci 混用）。"""
        la = f"a.{PipelineEngine._safe_identifier(left_col)}"
        rb = f"b.{PipelineEngine._safe_identifier(right_col)}"
        coll = "utf8mb4_unicode_ci"
        return f"{la} COLLATE {coll} = {rb} COLLATE {coll}"

    @staticmethod
    def _symmetric_diff_union_sql(
        left_ref: str,
        right_ref: str,
        on_clause: str,
        null_b: str,
        null_a: str,
        join_keys: List[Dict[str, Any]],
        plan: Optional[List[Dict[str, Any]]],
    ) -> str:
        """
        对称差 UNION ALL：两侧 SELECT * 会在 UNION 时因列隐含排序规则不一致触发 1267。
        用 CAST(... AS CHAR) COLLATE utf8mb4_unicode_ci 统一每列；列顺序/别名由 plan 指定。
        """
        coll = "utf8mb4_unicode_ci"
        rows: List[Dict[str, Any]] = []
        if plan:
            for p in plan:
                if not isinstance(p, dict):
                    continue
                out = str(p.get("out") or p.get("alias") or "").strip()
                lc = str(p.get("L") or p.get("leftCol") or "").strip()
                rc = str(p.get("R") or p.get("rightCol") or "").strip()
                if out or lc or rc:
                    if not out:
                        out = lc or rc or "col"
                    rows.append({"out": out, "L": lc, "R": rc})
        if not rows and join_keys:
            k0 = join_keys[0]
            if isinstance(k0, dict):
                lc = str(k0.get("leftCol", "") or "").strip()
                rc = str(k0.get("rightCol", "") or "").strip()
                if lc or rc:
                    rows.append({"out": lc or rc or "k", "L": lc, "R": rc})
        if not rows:
            return (
                f"SELECT a.* FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_b} "
                f"UNION ALL "
                f"SELECT b.* FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}"
            )

        def _cast_a(row: Dict[str, Any]) -> str:
            lc = str(row.get("L") or "").strip()
            out = str(row.get("out") or lc or "c").strip()
            safe_out = PipelineEngine._safe_identifier(out)
            if lc:
                expr = f"CAST(a.{PipelineEngine._safe_identifier(lc)} AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
            else:
                expr = f"CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
            return f"{expr} AS {safe_out}"

        def _cast_b(row: Dict[str, Any]) -> str:
            rc = str(row.get("R") or "").strip()
            out = str(row.get("out") or rc or "c").strip()
            safe_out = PipelineEngine._safe_identifier(out)
            if rc:
                expr = f"CAST(b.{PipelineEngine._safe_identifier(rc)} AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
            else:
                expr = f"CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
            return f"{expr} AS {safe_out}"

        sel_l = ", ".join(_cast_a(r) for r in rows)
        sel_r = ", ".join(_cast_b(r) for r in rows)
        return (
            f"SELECT {sel_l} FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_b} "
            f"UNION ALL "
            f"SELECT {sel_r} FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}"
        )

    @staticmethod
    def _validate_and_quote_table_name(name: str) -> Optional[str]:
        """校验 DDL 目标表名并返回反引号包裹标识符；不合法则返回 None。"""
        if not name or not isinstance(name, str):
            return None
        n = name.strip()
        if not re.match(r"^[a-zA-Z0-9_]{1,64}$", n):
            return None
        return PipelineEngine._safe_identifier(n)

    async def _fetch_mysql_table_columns(self, conn, table_name_plain: str) -> List[str]:
        """从 information_schema 读取当前库下表的列名顺序。"""
        stmt = text("""
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tbl
            ORDER BY ORDINAL_POSITION
        """)
        result = await conn.execute(stmt, {"tbl": table_name_plain})
        return [row[0] for row in result.fetchall()]

    @staticmethod
    def _build_filter_sql(
        table_ref: str,
        conditions: List[Dict[str, Any]],
        logic: str = "AND",
    ) -> str:
        """根据可视化配置构建 WHERE 子句"""
        if not conditions:
            return ""
        clauses = []
        for cond in conditions:
            col_name = str(cond.get("column", "") or "").strip()
            if not col_name:
                continue
            col = PipelineEngine._safe_identifier(col_name)
            op = str(cond.get("operator", "eq"))
            val = str(cond.get("value", ""))
            if op == "eq":
                clauses.append(f"{col} = '{val}'")
            elif op == "ne":
                clauses.append(f"{col} != '{val}'")
            elif op == "gt":
                clauses.append(f"{col} > '{val}'")
            elif op == "ge":
                clauses.append(f"{col} >= '{val}'")
            elif op == "lt":
                clauses.append(f"{col} < '{val}'")
            elif op == "le":
                clauses.append(f"{col} <= '{val}'")
            elif op == "contains":
                clauses.append(f"{col} LIKE '%{val}%'")
            elif op == "startsWith":
                clauses.append(f"{col} LIKE '{val}%'")
            elif op == "endsWith":
                clauses.append(f"{col} LIKE '%{val}'")
            elif op == "isNull":
                clauses.append(f"{col} IS NULL")
            elif op == "isNotNull":
                clauses.append(f"{col} IS NOT NULL")
            elif op == "in":
                items = ", ".join(f"'{v.strip()}'" for v in val.split(",") if v.strip())
                if not items:
                    continue
                clauses.append(f"{col} IN ({items})")
        if not clauses:
            return ""
        sep = f" {logic} "
        return f" WHERE {sep.join(clauses)}"

    @staticmethod
    def _aggregation_sql_fragment(agg: Dict[str, Any]) -> Optional[str]:
        """单条聚合配置 -> SELECT 片段；列无效时返回 None（避免生成非法 SQL）。"""
        fn = str(agg.get("func", "count") or "count").lower().strip()
        col_raw = agg.get("column")
        col = str(col_raw).strip() if col_raw is not None else ""
        alias_raw = agg.get("alias")
        alias = str(alias_raw).strip() if alias_raw else ""
        if not alias:
            alias = f"{fn}_{col}" if col else f"{fn}_col"

        if fn == "count_distinct":
            if not col:
                return None
            return (
                f"COUNT(DISTINCT {PipelineEngine._safe_identifier(col)}) "
                f"AS {PipelineEngine._safe_identifier(alias)}"
            )
        if fn == "count":
            if not col or col == "*":
                return f"COUNT(*) AS {PipelineEngine._safe_identifier(alias)}"
            return f"COUNT({PipelineEngine._safe_identifier(col)}) AS {PipelineEngine._safe_identifier(alias)}"

        if not col:
            return None
        sql_fn = {
            "sum": "SUM",
            "avg": "AVG",
            "max": "MAX",
            "min": "MIN",
        }.get(fn, fn.upper())
        return f"{sql_fn}({PipelineEngine._safe_identifier(col)}) AS {PipelineEngine._safe_identifier(alias)}"

    @staticmethod
    def _apply_row_filter(sql: str, config: Dict[str, Any]) -> str:
        """
        若 config 中含 rowFilterConditions，对已有 sql 包装 SELECT * FROM (...) WHERE ...
        等效于在下游前插入一个 filter 节点。
        """
        if not sql:
            return ""
        conditions = config.get("rowFilterConditions", [])
        if not conditions:
            return sql
        logic = config.get("rowFilterLogic", "AND")
        where = PipelineEngine._build_filter_sql(sql, conditions, logic)
        if not where:
            return sql
        return f"SELECT * FROM ({sql}) AS _r{where}"

    @staticmethod
    def _apply_column_projection(
        sql: str,
        config: Dict[str, Any],
        allowed_sql_columns: Optional[Set[str]] = None,
    ) -> str:
        """
        若 config 中含 outputColumnKeys，外层投影这些列。
        列名优先用 outputColumnKeys 中保存的原始列名；
        若含 renameMap 也支持别名映射。

        同时处理 insertedColumns，添加新计算的列。

        allowed_sql_columns 非空时，只保留「内层结果中确实存在」的列（按 renameMap 映射前的
        源列名校验），避免 JOIN 类型切换后仍引用旧列名导致 1054。
        """
        if not sql:
            return ""
        output_keys: List[str] = config.get("outputColumnKeys", [])
        rename_map: Dict[str, str] = config.get("renameMap", {})
        inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", [])

        safe_cols: List[str] = []

        # 当 outputColumnKeys 为空时，保留所有原有列（SELECT *）
        # 只有在有 allowed_sql_columns 限制时才需要过滤
        if not output_keys:
            # outputColumnKeys 为空，保留原有列 + insertedColumns
            if allowed_sql_columns is not None:
                # 有列限制时，只保留存在的列
                for col in allowed_sql_columns:
                    safe_cols.append(PipelineEngine._safe_identifier(col))
            # else: 不加任何列（外层 SELECT * 会处理）
        else:
            keys_use: List[str] = list(output_keys)
            if allowed_sql_columns is not None:
                keys_use = [
                    col
                    for col in output_keys
                    if str(rename_map.get(col, col)).strip() in allowed_sql_columns
                ]
            for col in keys_use:
                old_name = rename_map.get(col, col)
                if col != old_name:
                    safe_cols.append(f"{PipelineEngine._safe_identifier(old_name)} AS {PipelineEngine._safe_identifier(col)}")
                else:
                    safe_cols.append(PipelineEngine._safe_identifier(old_name))

        # 添加 insertedColumns 生成的新列
        has_inserted = False
        for col_config in inserted_columns:
            if not isinstance(col_config, dict):
                continue
            method = str(col_config.get("method", "")).strip().lower()
            source_column = str(col_config.get("sourceColumn", "")).strip()
            new_name = str(col_config.get("name", "")).strip()
            method_config = col_config.get("config", {})
            if not new_name:
                continue
            expr = PipelineEngine._build_single_inserted_column_expr(method, source_column, method_config)
            if expr:
                safe_cols.append(f"{expr} AS {PipelineEngine._safe_identifier(new_name)}")
                has_inserted = True

        if not safe_cols:
            return sql

        cols_str = ", ".join(safe_cols)
        # 如果 outputColumnKeys 为空且有 insertedColumns，需要 SELECT * + 新列
        if not output_keys and has_inserted:
            return f"SELECT *, {cols_str} FROM ({sql}) AS _ic"
        return f"SELECT {cols_str} FROM ({sql}) AS _p"

    # ================================================================
    # 预览用列名推断（用于 JOIN 展开）
    # ================================================================

    @staticmethod
    def _preview_infer_output_columns(
        node_type: str,
        config: Dict[str, Any],
        upstream_cols: Optional[List[List[str]]] = None,
        merge_type: Optional[str] = None,
    ) -> Optional[List[str]]:
        """
        根据节点类型和配置静态推断其输出列名。

        Returns:
            列名列表（顺序固定）；若无法静态推断（如 source 的 SELECT *），返回 None。

        upstream_cols: 按上游顺序排列的各上游节点的列名列表；用于 JOIN 等多输入节点。
        """
        canonical = PipelineEngine._canonical_pipeline_node_type(node_type)

        if canonical == "source":
            # 列选优先（与源节点实际投影一致）；否则用表结构缓存，供 JOIN 展开避免 b.* 重名
            keys = config.get("outputColumnKeys", []) or []
            if isinstance(keys, list) and keys:
                out = [str(k).strip() for k in keys if str(k).strip()]
                if out:
                    return out
            schema = config.get("sourceSchemaColumns", []) or []
            if isinstance(schema, list) and schema:
                out = [str(c).strip() for c in schema if str(c).strip()]
                return out if out else None
            return None

        if canonical == "filter":
            # filter 不改变列，直接透传上游
            if upstream_cols and upstream_cols[0] is not None:
                return list(upstream_cols[0])
            return None

        if canonical == "aggregate":
            group_by: List[str] = config.get("groupBy", []) or []
            raw_aggs: List[Any] = config.get("aggregations", []) or []
            parts: List[str] = []
            for c in group_by:
                if c := str(c).strip():
                    parts.append(c)
            for a in raw_aggs:
                if isinstance(a, dict):
                    alias = str(a.get("alias", "") or a.get("column", "")).strip()
                    if alias:
                        parts.append(alias)
            return parts if parts else None

        if canonical == "column_select":
            selected: List[Any] = config.get("selectedColumns", []) or []
            out: List[str] = []
            for sc in selected:
                to = str(sc.get("to", sc.get("from", "")) or "").strip()
                if to:
                    out.append(to)
            return out if out else None

        if canonical == "join":
            # UNION：若有 unionColumnPlan 可推断输出列名
            if merge_type and merge_type.lower() in ("union", "union all"):
                plan = config.get("unionColumnPlan")
                if isinstance(plan, list) and plan:
                    out_names: List[str] = []
                    for row in plan:
                        if not isinstance(row, dict):
                            continue
                        o = str(row.get("out") or "").strip()
                        if o:
                            out_names.append(o)
                    return out_names if out_names else None
                return None
            if not upstream_cols or len(upstream_cols) < 2:
                return None
            left_cols = upstream_cols[0]
            right_cols = upstream_cols[1]
            join_type = str(config.get("joinType", "inner")).lower()

            if join_type == "left_anti":
                return list(left_cols) if left_cols is not None else None
            if join_type == "right_anti":
                return list(right_cols) if right_cols is not None else None
            if join_type in ("full", "symmetric_diff"):
                return None
            if join_type not in ("inner", "left", "right"):
                return None

            if left_cols is None and right_cols is None:
                return None
            if left_cols is not None and right_cols is not None:
                # 两侧均可推断：全展开（左表全列 + 右表排除 ON 右列）
                on_right_cols: List[str] = []
                for k in config.get("joinKeys", []) or []:
                    if rc := str(k.get("rightCol", "") or "").strip():
                        on_right_cols.append(rc)
                on_set = set(on_right_cols)
                left_set = set(left_cols)
                out: List[str] = list(left_cols)
                for c in right_cols:
                    if c not in left_set and c not in on_set:
                        out.append(c)
                return out
            if left_cols is not None:
                # 仅左已知：右表用 a.*，列名无法静态确定
                return None
            # 仅右已知：左表用 b.*，列名无法静态确定
            return None

        if canonical == "output":
            if upstream_cols and upstream_cols[0] is not None:
                return list(upstream_cols[0])
            return None

        # 默认处理：透传上游列（如果有）
        base_cols: Optional[List[str]] = None
        if upstream_cols and upstream_cols[0] is not None:
            base_cols = list(upstream_cols[0])

        # 添加 insertedColumns 生成的列名
        inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", [])
        if inserted_columns and base_cols is not None:
            for col_config in inserted_columns:
                if isinstance(col_config, dict):
                    new_name = str(col_config.get("name", "")).strip()
                    if new_name:
                        base_cols.append(new_name)

        return base_cols

    # ================================================================
    # 插入新列 SQL 生成
    # ================================================================

    @staticmethod
    def _build_inserted_columns_sql(
        sql: str,
        config: Dict[str, Any],
        allowed_sql_columns: Optional[Set[str]] = None,
    ) -> str:
        """
        处理 insertedColumns 配置，为 SQL 添加新计算的列。

        insertedColumns 格式:
        [
            {
                "name": "新列名",
                "method": "calculation | split | function | lookup | rank | category | bin",
                "sourceColumn": "源列名",
                "config": { ... 方法特定配置 ... }
            }
        ]
        """
        inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", [])
        if not inserted_columns:
            return sql

        new_columns: List[str] = []
        for col_config in inserted_columns:
            if not isinstance(col_config, dict):
                continue
            method = str(col_config.get("method", "")).strip().lower()
            source_column = str(col_config.get("sourceColumn", "")).strip()
            new_name = str(col_config.get("name", "")).strip()
            method_config = col_config.get("config", {})

            if not new_name:
                continue

            # 生成列表达式
            expr = PipelineEngine._build_single_inserted_column_expr(
                method, source_column, method_config
            )
            if not expr:
                continue

            safe_expr = f"{expr} AS {PipelineEngine._safe_identifier(new_name)}"
            new_columns.append(safe_expr)

        if not new_columns:
            return sql

        # 检查是否已有 * 号需要展开
        if "SELECT *" in sql.upper() or "select *" in sql.lower():
            # 需要展开 * 号 - 将 insertedColumns 添加到列列表
            if allowed_sql_columns is not None:
                # 简单处理：在子查询上添加列
                new_cols_str = ", ".join(new_columns)
                return f"SELECT *, {new_cols_str} FROM ({sql}) AS _ic"
            else:
                # 保持原有 SQL，让外层处理
                new_cols_str = ", ".join(new_columns)
                return f"SELECT *, {new_cols_str} FROM ({sql}) AS _ic"

        # 已有具体列 - 在 SELECT 末尾添加新列
        # 找到 SELECT 和 FROM 之间的位置
        match = re.match(r"^(SELECT\s+)(.*?)(\s+FROM\s+)", sql, re.IGNORECASE | re.DOTALL)
        if match:
            existing_cols = match.group(2).strip()
            new_cols_str = ", ".join(new_columns)
            return f"SELECT {existing_cols}, {new_cols_str} FROM ({sql}) AS _ic"

        # 未能匹配，追加到末尾
        new_cols_str = ", ".join(new_columns)
        return f"SELECT *, {new_cols_str} FROM ({sql}) AS _ic"

    @staticmethod
    def _build_single_inserted_column_expr(
        method: str,
        source_column: str,
        method_config: Dict[str, Any],
    ) -> Optional[str]:
        """根据方法生成单个列的 SQL 表达式"""
        safe_source = PipelineEngine._safe_identifier(source_column)

        if method == "calculation":
            return PipelineEngine._build_calculation_expr(safe_source, method_config)
        elif method == "split":
            return PipelineEngine._build_split_expr(safe_source, method_config)
        elif method == "function":
            return PipelineEngine._build_function_expr(safe_source, method_config)
        elif method == "lookup":
            return PipelineEngine._build_lookup_expr(safe_source, method_config)
        elif method == "rank":
            return PipelineEngine._build_rank_expr(safe_source, method_config)
        elif method == "category":
            return PipelineEngine._build_category_expr(safe_source, method_config)
        elif method == "bin":
            return PipelineEngine._build_bin_expr(safe_source, method_config)
        else:
            return "NULL"

    @staticmethod
    def _build_calculation_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        计算列表达式
        config.expression: 计算表达式，如 "A + B" 或 "(A + B) * 1.1"
        空表达式返回 NULL 占位，保证列结构稳定
        """
        expression = config.get("expression", "")
        if not expression:
            return "NULL"
        return expression

    @staticmethod
    def _build_split_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        分列表达式
        split_type: delimiter | regex | fixed
        delimiter: 分隔符
        position: 提取第N部分
        """
        split_type = config.get("split_type", "delimiter")
        position = config.get("position", 1)

        if split_type == "delimiter":
            delimiter = config.get("delimiter", ",")
            if not delimiter:
                return f"NULL"
            # SUBSTRING_INDEX(str, delim, count) - count 为正数从左边取，负数从右边取
            # position 为 1 时取第一部分
            return f"SUBSTRING_INDEX({source_column}, '{delimiter}', {position})"
        elif split_type == "regex":
            regex = config.get("regex", "")
            if regex:
                # 使用 REGEXP_SUBSTR (MySQL 8.0+)
                return f"REGEXP_SUBSTR({source_column}, '{regex}')"
            return f"NULL"
        elif split_type == "fixed":
            # 固定宽度提取暂不支持
            return f"NULL"
        return f"NULL"

    @staticmethod
    def _build_function_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        函数表达式
        支持两种模式：
        1. 结构化配置: function_name + arguments（保留旧逻辑）
        2. 自由表达式: expression（直接透传到 SQL，列名用 `` 包裹）
        """
        expression = config.get("expression", "").strip()
        function_name = config.get("function_name", "").upper()
        arguments: List[Any] = config.get("arguments", [])

        # 优先使用自由表达式
        if expression:
            safe_source = PipelineEngine._safe_identifier(source_column)
            # 将占位符 # 替换为源列引用，#N 替换为第 N 个列名
            safe_expr = expression.strip()
            if safe_source:
                safe_expr = safe_expr.replace("``", safe_source)
            return safe_expr

        if not function_name:
            return "NULL"

        if function_name in ("CONCAT", "CONCAT_WS"):
            args_str = ", ".join(
                f"'{arg}'" if isinstance(arg, str) and not arg.startswith("`") else PipelineEngine._safe_identifier(str(arg))
                for arg in arguments
            )
            if function_name == "CONCAT_WS":
                return f"CONCAT_WS({args_str})"
            return f"CONCAT({args_str})"

        elif function_name == "SUBSTRING":
            if len(arguments) >= 2:
                start = arguments[1] if len(arguments) > 1 else 1
                length = arguments[2] if len(arguments) > 2 else None
                if length:
                    return f"SUBSTRING({source_column}, {start}, {length})"
                return f"SUBSTRING({source_column}, {start})"
            return f"SUBSTRING({source_column}, 1)"

        elif function_name in ("TRIM", "LTRIM", "RTRIM", "UPPER", "LOWER"):
            return f"{function_name}({source_column})"

        elif function_name in ("YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND"):
            return f"{function_name}({source_column})"

        elif function_name == "ROUND":
            decimals = arguments[0] if arguments else 0
            return f"ROUND({source_column}, {decimals})"

        elif function_name == "ABS":
            return f"ABS({source_column})"

        elif function_name == "IF":
            if len(arguments) >= 3:
                condition = arguments[0]
                true_val = arguments[1]
                false_val = arguments[2]
                return f"IF({condition}, '{true_val}', '{false_val}')"
            return "NULL"

        elif function_name == "COALESCE":
            args_str = ", ".join(
                f"'{arg}'" if isinstance(arg, str) else PipelineEngine._safe_identifier(str(arg))
                for arg in arguments
            )
            return f"COALESCE({args_str})"

        elif function_name == "CAST":
            target_type = arguments[0] if arguments else "CHAR"
            return f"CAST({source_column} AS {target_type})"

        elif function_name == "LENGTH":
            return f"LENGTH({source_column})"

        elif function_name == "CHAR_LENGTH":
            return f"CHAR_LENGTH({source_column})"

        elif function_name == "NOW":
            return "NOW()"

        elif function_name == "DATE":
            return f"DATE({source_column})"

        elif function_name == "DATE_FORMAT":
            format_str = arguments[0] if arguments else "%Y-%m-%d"
            return f"DATE_FORMAT({source_column}, '{format_str}')"

        else:
            # 通用函数调用
            if arguments:
                args_str = ", ".join(
                    f"'{arg}'" if isinstance(arg, str) else PipelineEngine._safe_identifier(str(arg))
                    for arg in arguments
                )
                return f"{function_name}({args_str})"
            return f"{function_name}({source_column})"

    @staticmethod
    def _build_lookup_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        查找替换表达式
        lookup_table: [{key: '北京', value: '北方'}, ...]
        default_value: 未匹配时的默认值
        """
        lookup_table: List[Dict[str, str]] = config.get("lookup_table", [])
        default_value = config.get("default_value", "")

        if not lookup_table:
            return "NULL"

        case_parts: List[str] = []
        for item in lookup_table:
            if isinstance(item, dict):
                key = str(item.get("key", "")).strip()
                value = str(item.get("value", "")).strip()
                if key:
                    # 转义单引号
                    key_escaped = key.replace("'", "''")
                    value_escaped = value.replace("'", "''")
                    case_parts.append(
                        f"WHEN {source_column} = '{key_escaped}' THEN '{value_escaped}'"
                    )

        if not case_parts:
            return "NULL"

        case_expr = " ".join(case_parts)
        if default_value:
            default_escaped = default_value.replace("'", "''")
            return f"CASE {case_expr} ELSE '{default_escaped}' END"
        else:
            return f"CASE {case_expr} ELSE {source_column} END"

    @staticmethod
    def _build_rank_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        排名表达式
        partition_by: [col1, col2] - 分区字段
        order_by: {column: 'col1', direction: 'desc'}
        rank_type: ROW_NUMBER | RANK | DENSE_RANK
        """
        partition_by: List[str] = config.get("partition_by", [])
        order_by: Dict[str, Any] = config.get("order_by", {})
        rank_type = config.get("rank_type", "ROW_NUMBER").upper()

        valid_rank_types = ("ROW_NUMBER", "RANK", "DENSE_RANK")
        if rank_type not in valid_rank_types:
            rank_type = "ROW_NUMBER"

        # 构建 PARTITION BY 子句
        if partition_by:
            partition_cols = [PipelineEngine._safe_identifier(col) for col in partition_by]
            partition_str = f"PARTITION BY {', '.join(partition_cols)}"
        else:
            partition_str = ""

        # 构建 ORDER BY 子句
        order_col = order_by.get("column", source_column)
        order_dir = str(order_by.get("direction", "desc")).upper()
        if order_dir not in ("ASC", "DESC"):
            order_dir = "DESC"
        order_str = f"ORDER BY {PipelineEngine._safe_identifier(order_col)} {order_dir}"

        window_clause = partition_str + " " + order_str if partition_str else order_str
        return f"{rank_type}() OVER ({window_clause})"

    @staticmethod
    def _build_category_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        分类分组表达式
        ranges: [{from: 0, to: 1000, label: '低', includeTo: false}, ...]
        default_label: 默认标签
        """
        ranges: List[Dict[str, Any]] = config.get("ranges", [])
        default_label = config.get("default_label", "其他")

        if not ranges:
            return "NULL"

        # 与字符串/CHAR 投影列比较时，统一转为 DECIMAL，避免区间全不匹配落到默认标签
        num_col = f"CAST({source_column} AS DECIMAL(38, 10))"

        case_parts: List[str] = []
        for item in ranges:
            if isinstance(item, dict):
                from_val = item.get("from")
                to_val = item.get("to")
                label = str(item.get("label", "")).strip()
                include_to = item.get("includeTo")
                if include_to is None:
                    include_to = item.get("include_to", False)
                include_to = bool(include_to)

                if label:
                    label_escaped = label.replace("'", "''")
                    if from_val is not None and to_val is not None:
                        if include_to:
                            case_parts.append(
                                f"WHEN {num_col} >= {from_val} AND {num_col} <= {to_val} THEN '{label_escaped}'"
                            )
                        else:
                            case_parts.append(
                                f"WHEN {num_col} >= {from_val} AND {num_col} < {to_val} THEN '{label_escaped}'"
                            )
                    elif from_val is not None:
                        case_parts.append(
                            f"WHEN {num_col} >= {from_val} THEN '{label_escaped}'"
                        )
                    elif to_val is not None:
                        if include_to:
                            case_parts.append(
                                f"WHEN {num_col} <= {to_val} THEN '{label_escaped}'"
                            )
                        else:
                            case_parts.append(
                                f"WHEN {num_col} < {to_val} THEN '{label_escaped}'"
                            )

        if not case_parts:
            return "NULL"

        case_expr = " ".join(case_parts)
        default_escaped = default_label.replace("'", "''")
        return f"CASE {case_expr} ELSE '{default_escaped}' END"

    @staticmethod
    def _build_bin_expr(source_column: str, config: Dict[str, Any]) -> Optional[str]:
        """
        区间提取表达式
        bin_type: fixed | custom
        bin_size: 区间大小
        custom_bins: [边界1, 边界2, ...]
        """
        bin_type = config.get("bin_type", "fixed")

        if bin_type == "fixed":
            bin_size = config.get("bin_size")
            if bin_size and float(bin_size) > 0:
                return f"FLOOR({source_column} / {bin_size}) * {bin_size}"
            return "NULL"

        elif bin_type == "custom":
            custom_bins: List[float] = config.get("custom_bins", [])
            if not custom_bins or len(custom_bins) < 2:
                return "NULL"

            case_parts: List[str] = []
            for i in range(len(custom_bins) - 1):
                from_val = custom_bins[i]
                to_val = custom_bins[i + 1]
                label = f"{from_val}-{to_val}"
                label_escaped = label.replace("'", "''")
                case_parts.append(
                    f"WHEN {source_column} >= {from_val} AND {source_column} < {to_val} THEN '{label_escaped}'"
                )

            if case_parts:
                case_expr = " ".join(case_parts)
                return f"CASE {case_expr} ELSE CAST({source_column} AS CHAR) END"
            return "NULL"

        return "NULL"

    @staticmethod
    def _extract_join_on_right_column_names_from_sql(sql: str) -> List[str]:
        """
        从 JOIN 的 ON 子句中提取右表列名（与 _build_step_sql 中逻辑一致，支持 `b`.`中文列`）。
        """
        if not sql:
            return []
        on_match = re.search(
            r"\bON\s+(.+?)(?:\s+WHERE|\s+GROUP|\s+HAVING|\s+ORDER|\s+LIMIT|\s+UNION|$)",
            sql,
            re.IGNORECASE | re.DOTALL,
        )
        if not on_match:
            return []
        on_expr = on_match.group(1)
        out: List[str] = []
        seen: Set[str] = set()
        # 反引号包裹的列名（含中文）
        for m in re.finditer(r"b\.`([^`]+)`", on_expr, re.IGNORECASE):
            c = (m.group(1) or "").strip()
            if c and c not in seen:
                seen.add(c)
                out.append(c)
        # b.ascii_col（无反引号）
        for m in re.finditer(r"\bb\.([a-zA-Z0-9_]+)\b", on_expr, re.IGNORECASE):
            c = (m.group(1) or "").strip()
            if c and c not in seen:
                seen.add(c)
                out.append(c)
        return out

    @staticmethod
    def _expand_join_select_for_preview(
        sql: str,
        left_cols: Optional[List[str]],
        right_cols: Optional[List[str]],
        on_right_cols: Optional[List[str]] = None,
        join_type: str = "inner",
    ) -> str:
        """
        将 JOIN SQL 中的 `SELECT * FROM (...) AS a ... JOIN ... AS b ON ...`
        替换为显式列列表。

        展开规则：
        - 两侧列均已知：左表全列 + 右表列（排除右表 ON 列及与左表同名的列）。
        - 仅右表列已知：`a.*` + 右表列（排除 ON 右列），右表列带 `{列名}_b` 别名以防与 a.* 同名。
        - 仅左表列已知（LEFT/RIGHT）：左显式列 + 右表独有列（排除 ON 右列加 _b）；INNER 用 b.*。
        - 两侧均未知：不做替换。
        """
        up = sql.upper()
        if " JOIN " not in up or " AS A " not in up or " AS B " not in up:
            return sql

        # 检查是否真的是 SELECT * 形态（必须以 SELECT * FROM ( 开头）
        if not re.search(r"^\s*SELECT\s+\*\s+FROM\s*\(", sql, re.IGNORECASE):
            return sql

        on_set = set(on_right_cols) if on_right_cols else set()

        if left_cols is not None and right_cols is not None:
            # 两侧列均已知：全展开
            sel = PipelineEngine._join_explicit_select_list(left_cols, right_cols, on_right_cols)
            return re.sub(
                r"SELECT\s+\*\s+FROM\s*\(",
                f"SELECT {sel} FROM (",
                sql,
                count=1,
                flags=re.IGNORECASE,
            )

        if left_cols is None and right_cols is not None:
            # 仅右表列已知：a.* + 右表显式列（排除 ON 右列）。
            # 左表列未知时 a.* 可能已含与右表同名的列（如物理列与聚合别名均叫 sum_星级），
            # 再写 b.`同名` 会导致派生表 Duplicate column name；右表列用后缀别名保证唯一。
            right_parts: List[str] = []
            for c in right_cols:
                if c not in on_set:
                    b_expr = f"b.{PipelineEngine._safe_identifier(c)}"
                    alias = PipelineEngine._safe_identifier(f"{c}_b")
                    right_parts.append(f"{b_expr} AS {alias}")
            sel = f"a.*, {', '.join(right_parts)}" if right_parts else "a.*"
            return re.sub(
                r"SELECT\s+\*\s+FROM\s*\(",
                f"SELECT {sel} FROM (",
                sql,
                count=1,
                flags=re.IGNORECASE,
            )

        if left_cols is not None and right_cols is None:
            # 仅左表列已知：LEFT/RIGHT JOIN 用左显式列 + 右显式列（排除 ON 右列，加 _b 别名），
            # 因为 b.* 会把 ON 列（如运营）也包进来与 a.运营 重复。
            # INNER JOIN 可直接用左显式列 + b.*（b.* 中同名列会被 inner 的 _join_explicit_select_list 排除）。
            if join_type in ("left", "right") and on_right_cols:
                # 展开为 a.col1, a.col2, ..., 右表独有列（含 ON 列加 _b 别名，但 ON 列本身排除）
                on_ex_set = set(on_right_cols)
                sel_parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
                for c in (right_cols or []):
                    if c not in on_ex_set:
                        sel_parts.append(
                            f"b.{PipelineEngine._safe_identifier(c)} AS {PipelineEngine._safe_identifier(c)}_b"
                        )
                sel = ", ".join(sel_parts)
            else:
                # INNER 且右列未知：直接用 b.*
                left_parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
                sel = f"{', '.join(left_parts)}, b.*"
            return re.sub(
                r"SELECT\s+\*\s+FROM\s*\(",
                f"SELECT {sel} FROM (",
                sql,
                count=1,
                flags=re.IGNORECASE,
            )

        # 两侧均未知：不展开
        return sql

    @staticmethod
    def _canonical_pipeline_node_type(node_type: str) -> str:
        if not node_type:
            return node_type
        return _PIPELINE_NODE_TYPE_CANON.get(node_type, node_type)

    @staticmethod
    def _source_table_name(config: Dict[str, Any]) -> str:
        """解析源表名：config.tableName / table_name，或节点 sql 字段中的 FROM `tbl`。"""
        for key in ("tableName", "table_name"):
            v = config.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        sql = config.get("sql")
        if isinstance(sql, str) and sql.strip():
            m = re.search(r"FROM\s+[`\"]?([a-zA-Z0-9_]+)[`\"]?", sql, re.IGNORECASE)
            if m:
                return m.group(1)
        return ""

    @staticmethod
    def _union_branches_from_plan(
        upstream_refs: List[Tuple[str, str]],
        plan: List[Any],
    ) -> List[str]:
        """按前端 unionColumnPlan 为每个上游生成分支 SELECT，列数与别名对齐（缺列用 NULL）。"""
        null_sql = (
            "CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci"
        )
        branches: List[str] = []
        for i, (ref, _) in enumerate(upstream_refs):
            parts: List[str] = []
            for row in plan:
                if not isinstance(row, dict):
                    continue
                out = str(row.get("out") or "").strip()
                if not out:
                    continue
                cols = row.get("cols")
                col_list = cols if isinstance(cols, list) else []
                raw = col_list[i] if i < len(col_list) else None
                src = str(raw).strip() if raw is not None and str(raw).strip() else ""
                if src:
                    parts.append(
                        f"{PipelineEngine._safe_identifier(src)} AS "
                        f"{PipelineEngine._safe_identifier(out)}"
                    )
                else:
                    parts.append(
                        f"{null_sql} AS {PipelineEngine._safe_identifier(out)}"
                    )
            if parts:
                branches.append(
                    f"SELECT {', '.join(parts)} FROM ({ref}) AS _um{i}"
                )
            else:
                branches.append(f"SELECT * FROM ({ref}) AS _um{i}")
        return branches

    @staticmethod
    def build_node_sql(
        node_type: str,
        config: Dict[str, Any],
        upstream_refs: Optional[List[Tuple[str, str]]] = None,
        # upstream_refs: List[Tuple[table_or_sql, alias]] for multi-input nodes
        apply_limit: bool = True,
        limit: int = 100,
        merge_type: Optional[str] = None,
    ) -> Tuple[str, List[str]]:
        """
        根据节点类型和可视化配置生成 SELECT SQL。

        Returns:
            (sql, list_of_column_names)
        """
        node_type = PipelineEngine._canonical_pipeline_node_type(node_type)
        _limit_clause = f" LIMIT {limit}" if apply_limit else ""

        table_name = PipelineEngine._source_table_name(config)

        if node_type == "source":
            tbl = PipelineEngine._safe_identifier(table_name) if table_name else "unknown_table"
            return f"SELECT * FROM {tbl}{_limit_clause}", []

        if node_type == "filter":
            conditions = config.get("conditions", [])
            logic = config.get("logic", "AND")
            if upstream_refs:
                ref, alias = upstream_refs[0]
                where = PipelineEngine._build_filter_sql(ref, conditions, logic)
                return f"SELECT * FROM ({ref}) AS t{where}{_limit_clause}", []
            return "", []

        if node_type == "aggregate":
            group_by = config.get("groupBy", []) or []
            raw_aggs = config.get("aggregations", []) or []
            if upstream_refs:
                ref, _ = upstream_refs[0]
                agg_parts: List[str] = []
                for a in raw_aggs:
                    if isinstance(a, dict):
                        frag = PipelineEngine._aggregation_sql_fragment(a)
                        if frag:
                            agg_parts.append(frag)
                if not agg_parts:
                    return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []
                gb = [str(c).strip() for c in group_by if str(c).strip()]
                select_parts = [
                    *[PipelineEngine._safe_identifier(c) for c in gb],
                    *agg_parts,
                ]
                group_str = ""
                if gb:
                    group_str = f" GROUP BY {', '.join(PipelineEngine._safe_identifier(c) for c in gb)}"
                return f"SELECT {', '.join(select_parts)} FROM ({ref}) AS t{group_str}{_limit_clause}", []

        # 处理 UNION 类型的 merge 节点（不展开 SELECT *；有 unionColumnPlan 时按映射对齐列）
        if node_type == "join" and merge_type and merge_type.lower() in ("union", "union all"):
            if upstream_refs and len(upstream_refs) >= 2:
                union_op = "UNION ALL" if merge_type.lower() == "union all" else "UNION"
                plan_raw = config.get("unionColumnPlan")
                if isinstance(plan_raw, list) and len(plan_raw) > 0:
                    branches = PipelineEngine._union_branches_from_plan(
                        upstream_refs, plan_raw
                    )
                    if branches:
                        union_sql = f"\n{union_op}\n".join(branches)
                        return f"{union_sql}{_limit_clause}", []
                select_parts = [f"SELECT * FROM ({ref})" for ref, _ in upstream_refs]
                union_sql = f"\n{union_op}\n".join(select_parts)
                return f"{union_sql}{_limit_clause}", []
            return "", []

        if node_type == "join":
            join_type = config.get("joinType", "inner")
            join_keys = config.get("joinKeys", [])
            jt_map = {
                "inner": "INNER JOIN",
                "left": "LEFT JOIN",
                "right": "RIGHT JOIN",
            }
            jt_sql = jt_map.get(join_type, "INNER JOIN")
            if upstream_refs and len(upstream_refs) >= 2:
                left_ref, _ = upstream_refs[0]
                right_ref, _ = upstream_refs[1]
                if join_keys:
                    on_parts = []
                    for k in join_keys:
                        if not isinstance(k, dict):
                            continue
                        lc = str(k.get("leftCol", "") or "").strip()
                        rc = str(k.get("rightCol", "") or "").strip()
                        if not lc or not rc:
                            continue
                        on_parts.append(PipelineEngine._join_on_equality_sql(lc, rc))
                    if not on_parts:
                        return f"SELECT * FROM ({left_ref}) AS a INNER JOIN ({right_ref}) AS b ON 1=0{_limit_clause}", []
                    on_clause = " AND ".join(on_parts)
                    if join_type == "left_anti":
                        rk0 = str(join_keys[0].get("rightCol", "") or "").strip()
                        null_b = f"b.{PipelineEngine._safe_identifier(rk0)} IS NULL" if rk0 else "1=0"
                        return (
                            f"SELECT a.* FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_b}{_limit_clause}",
                            [],
                        )
                    if join_type == "right_anti":
                        lk0 = str(join_keys[0].get("leftCol", "") or "").strip()
                        null_a = f"a.{PipelineEngine._safe_identifier(lk0)} IS NULL" if lk0 else "1=0"
                        return (
                            f"SELECT b.* FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}{_limit_clause}",
                            [],
                        )
                    if join_type == "symmetric_diff":
                        rk0 = str(join_keys[0].get("rightCol", "") or "").strip()
                        lk0 = str(join_keys[0].get("leftCol", "") or "").strip()
                        null_b = f"b.{PipelineEngine._safe_identifier(rk0)} IS NULL" if rk0 else "1=0"
                        null_a = f"a.{PipelineEngine._safe_identifier(lk0)} IS NULL" if lk0 else "1=0"
                        plan = config.get("symmetricUnionPlan")
                        plan_list = plan if isinstance(plan, list) else None
                        union_sql = PipelineEngine._symmetric_diff_union_sql(
                            left_ref, right_ref, on_clause, null_b, null_a, join_keys, plan_list
                        )
                        return f"{union_sql}{_limit_clause}", []
                    if join_type == "full":
                        # MySQL 8.0.31 前无 FULL OUTER JOIN，用 LEFT ∪ 右独有行 模拟
                        lk0 = str(join_keys[0].get("leftCol", "") or "").strip()
                        null_a = f"a.{PipelineEngine._safe_identifier(lk0)} IS NULL" if lk0 else "1=0"
                        fo_sql = (
                            f"SELECT * FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} "
                            f"UNION ALL "
                            f"SELECT * FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}"
                        )
                        return f"{fo_sql}{_limit_clause}", []
                    return (
                        f"SELECT * FROM ({left_ref}) AS a {jt_sql} ({right_ref}) AS b ON {on_clause}{_limit_clause}",
                        [],
                    )
                return f"SELECT * FROM ({left_ref}) AS a {jt_sql} ({right_ref}) AS b ON 1=0{_limit_clause}", []
            return "", []

        if node_type == "column_select":
            selected = config.get("selectedColumns", [])
            if upstream_refs:
                ref, _ = upstream_refs[0]
                if not selected:
                    return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []
                cols = [
                    (
                        f"{PipelineEngine._safe_identifier(sc.get('from', ''))} AS {PipelineEngine._safe_identifier(sc.get('to', sc.get('from', '')))}"
                        if sc.get("from") != sc.get("to")
                        else PipelineEngine._safe_identifier(sc.get("from", ""))
                    )
                    for sc in selected
                    if sc.get("from")
                ]
                return f"SELECT {', '.join(cols)} FROM ({ref}) AS t{_limit_clause}", []

        if node_type == "output":
            # Output 节点预览上游数据
            if upstream_refs:
                ref, _ = upstream_refs[0]
                return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []

        if node_type == "chart":
            # 数据可视化节点不产生 SQL，预览与表格展示均透传上游结果集
            if upstream_refs:
                ref, _ = upstream_refs[0]
                return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []

        return "", []

    @staticmethod
    def build_chained_sql(
        focus_node_id: str,
        graph_nodes: Dict[str, Dict[str, Any]],
        graph_edges: List[Dict[str, str]],
        limit: int = 100,
    ) -> str:
        """
        从 focus_node_id 出发，沿上游折叠整个子图，生成一条嵌套 SELECT SQL。

        仅在最外层加 LIMIT，内层子查询均不加 LIMIT（避免先截断再过滤导致数据丢失）。

        Args:
            focus_node_id: 要预览的节点 ID
            graph_nodes:   {node_id: {"type": str, "config": dict, "upstream": List[str]}}
            graph_edges:   [{"source": up_id, "target": down_id}, ...]
            limit:         最外层 LIMIT

        Returns:
            最终可执行的 SELECT SQL 字符串；出错时返回 ""
        """
        if not focus_node_id or focus_node_id not in graph_nodes:
            return ""

        # 1. 构建入边表 {down_id: [up_ids]}
        incoming: Dict[str, List[str]] = {}
        for e in graph_edges:
            src, tgt = e.get("source", ""), e.get("target", "")
            if src and tgt:
                incoming.setdefault(tgt, []).append(src)

        # 2. 反向 BFS：从 focus 沿入边收集所有祖先
        visited: Dict[str, bool] = {focus_node_id: True}
        queue = [focus_node_id]
        while queue:
            cur = queue.pop(0)
            for up_id in incoming.get(cur, []):
                if up_id not in visited:
                    visited[up_id] = True
                    queue.append(up_id)

        # 3. 拓扑排序（visited 集合内），源点入度 0 排在前
        in_degree: Dict[str, int] = {nid: 0 for nid in visited}
        adj: Dict[str, List[str]] = {nid: [] for nid in visited}   # up -> [downs]
        for e in graph_edges:
            src, tgt = e.get("source", ""), e.get("target", "")
            if src in visited and tgt in visited:
                in_degree[tgt] += 1
                adj[src].append(tgt)

        # Kahn 算法
        sorted_ids: List[str] = []
        zero_in = [nid for nid in visited if in_degree[nid] == 0]
        while zero_in:
            zero_in.sort()
            nid = zero_in.pop(0)
            sorted_ids.append(nid)
            for nb in adj[nid]:
                in_degree[nb] -= 1
                if in_degree[nb] == 0:
                    zero_in.append(nb)

        if len(sorted_ids) != len(visited):
            logger.warning(f"图存在环，无法完成拓扑排序（focus={focus_node_id}）")
            return ""

        # 4. 逐节点生成 SQL，维护 node_id -> sql 与 node_id -> output_columns
        # node_columns: None 表示无法静态推断（如 source 的 SELECT *）
        node_sqls: Dict[str, str] = {}
        node_columns: Dict[str, Optional[List[str]]] = {}

        for nid in sorted_ids:
            node = graph_nodes.get(nid, {})
            ntype = node.get("type", "")
            nconfig = node.get("config", {})
            nupstream = node.get("upstream", [])
            nmerge_type = node.get("merge_type")

            # 收集有效上游 ref（仅 visited 集合内）
            valid_ups = [u for u in nupstream if u in visited and u in node_sqls]
            refs: List[Tuple[str, str]] = []
            for u in valid_ups:
                if u not in refs:
                    refs.append((node_sqls[u], u))

            # 收集各上游的输出列（用于 JOIN 展开和下游推断）
            upstream_cols: List[Optional[List[str]]] = [
                node_columns.get(u) for u in valid_ups
            ]

            # INNER JOIN：若仅左表可推断列、右表不可（上游顺序常为「聚合→源表」），
            # 交换两侧子查询，使「列未知」在 AS a，便于展开为 a.* + b 显式列并排除 ON 右列（与执行语义一致）。
            canonical_pre = PipelineEngine._canonical_pipeline_node_type(ntype)
            if (
                canonical_pre == "join"
                and len(valid_ups) == 2
                and len(upstream_cols) == 2
                and nmerge_type not in ("union", "union all")
            ):
                jt_pre = str(nconfig.get("joinType", "inner")).lower()
                if jt_pre == "inner":
                    c0, c1 = upstream_cols[0], upstream_cols[1]
                    if c0 is not None and c1 is None:
                        valid_ups = [valid_ups[1], valid_ups[0]]
                        refs = [(node_sqls[u], u) for u in valid_ups]
                        upstream_cols = [c1, c0]

            # 生成当前节点核心 SQL（内层子查询不加 LIMIT）
            is_focus = (nid == focus_node_id)
            core_sql, _ = PipelineEngine.build_node_sql(
                ntype, nconfig, refs if refs else None, apply_limit=False, limit=limit,
                merge_type=nmerge_type
            )
            logger.debug(
                "build_chained node=%s type=%s core_sql=%s left_cols=%s right_cols=%s",
                nid, ntype,
                (core_sql[:200] + "...") if core_sql and len(core_sql) > 200 else (core_sql or "(empty)"),
                upstream_cols[0] if len(upstream_cols) > 0 else None,
                upstream_cols[1] if len(upstream_cols) > 1 else None,
            )

            # 对 JOIN 节点（inner/left/right）展开 SELECT *，避免 ON 列重复
            canonical = PipelineEngine._canonical_pipeline_node_type(ntype)
            if canonical == "join" and core_sql and len(upstream_cols) >= 2:
                join_type = str(nconfig.get("joinType", "inner")).lower()
                if join_type in ("inner", "left", "right") and nmerge_type not in ("union", "union all"):
                    on_right_cols: List[str] = []
                    for k in nconfig.get("joinKeys", []) or []:
                        if rc := str(k.get("rightCol", "") or "").strip():
                            on_right_cols.append(rc)
                    if not on_right_cols:
                        on_right_cols = PipelineEngine._extract_join_on_right_column_names_from_sql(core_sql)
                    core_sql = PipelineEngine._expand_join_select_for_preview(
                        core_sql,
                        upstream_cols[0],
                        upstream_cols[1],
                        on_right_cols if on_right_cols else None,
                        join_type=join_type,
                    )

            # 对当前节点 config 应用行筛选包装（等效于在下游前插 filter 节点）
            wrapped_sql = PipelineEngine._apply_row_filter(core_sql, nconfig)

            # JOIN：按当前类型与可推断列过滤 outputColumnKeys，避免切换 Anti / Inner 后引用旧列名
            allowed_proj: Optional[Set[str]] = None
            skip_proj = False  # 两侧列均未知时跳过列投影，避免 SELECT * + 选无效列 1054
            if canonical == "join" and len(upstream_cols) >= 2:
                jt_allow = str(nconfig.get("joinType", "inner")).lower()
                on_r: List[str] = []
                for k in nconfig.get("joinKeys", []) or []:
                    if rc := str(k.get("rightCol", "") or "").strip():
                        on_r.append(rc)
                if not on_r:
                    on_r = PipelineEngine._extract_join_on_right_column_names_from_sql(core_sql)
                lc0, rc1 = upstream_cols[0], upstream_cols[1]
                if lc0 is None and rc1 is None:
                    # 两侧均不可推断，投影无效列会导致 1054
                    skip_proj = True
                sym_plan = (
                    nconfig.get("symmetricUnionPlan")
                    if jt_allow == "symmetric_diff"
                    else None
                )
                allowed_proj = PipelineEngine._join_preview_allowed_sql_columns(
                    jt_allow,
                    lc0,
                    rc1,
                    on_r if on_r else None,
                    sym_plan,
                )
                if jt_allow == "symmetric_diff" and allowed_proj is None:
                    skip_proj = True
                elif jt_allow == "left_anti" and lc0 is None:
                    skip_proj = True
                elif jt_allow == "right_anti" and rc1 is None:
                    skip_proj = True

            if not skip_proj:
                wrapped_sql = PipelineEngine._apply_column_projection(
                    wrapped_sql, nconfig, allowed_proj
                )

            # 推断当前节点的输出列（用于下游 JOIN 展开）
            output_keys: List[str] = nconfig.get("outputColumnKeys", []) or []
            rename_nm: Dict[str, str] = dict(nconfig.get("renameMap") or {})
            if output_keys:
                if allowed_proj is not None:
                    eff = [
                        col
                        for col in output_keys
                        if str(rename_nm.get(col, col)).strip() in allowed_proj
                    ]
                    node_columns[nid] = eff if eff else PipelineEngine._preview_infer_output_columns(
                        ntype, nconfig, upstream_cols, nmerge_type
                    )
                elif canonical == "join" and len(upstream_cols) >= 2 and upstream_cols[0] is None and upstream_cols[1] is None:
                    # 两侧均不可推断时设为 None，避免下游引用无效列名（如 sum_级星_b）
                    node_columns[nid] = None
                else:
                    node_columns[nid] = list(output_keys)
            else:
                node_columns[nid] = PipelineEngine._preview_infer_output_columns(
                    ntype, nconfig, upstream_cols, nmerge_type
                )

            # 仅最外层（focus 节点）加 LIMIT
            if is_focus and wrapped_sql:
                wrapped_sql = f"{wrapped_sql} LIMIT {limit}"

            node_sqls[nid] = wrapped_sql

        return node_sqls.get(focus_node_id, "")

    @staticmethod
    def _graph_focus_without_output_column_keys(
        graph_nodes: Dict[str, Dict[str, Any]],
        focus_node_id: str,
    ) -> Dict[str, Dict[str, Any]]:
        """深拷贝图并在 focus 节点上去掉 outputColumnKeys，用于预览「全列」元数据查询。"""
        out = copy.deepcopy(graph_nodes)
        if focus_node_id not in out:
            return out
        node = out[focus_node_id]
        cfg = dict(node.get("config") or {})
        cfg.pop("outputColumnKeys", None)
        out[focus_node_id] = {**node, "config": cfg}
        return out

    async def preview_node(
        self,
        node_type: str,
        config: Dict[str, Any],
        limit: int = 100,
        graph_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
        graph_edges: Optional[List[Dict[str, str]]] = None,
        focus_node_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        对单个节点执行实时预览（不保存到临时表）。

        Args:
            node_type:       节点类型
            config:          节点可视化配置
            limit:           预览行数
            graph_nodes:     可选，全图节点（开启链式折叠模式）
            graph_edges:     可选，全图边
            focus_node_id:   可选，链式模式下当前要预览的节点 ID

        Returns:
            {"columns": [...], "column_types": [...], "rows": [...], "total": int,
             "has_more": bool, "sql_generated": str}
        """
        try:
            # 链式折叠模式：只要带了全图与 focus 就走折叠（edges 可为空列表）
            if graph_nodes is not None and focus_node_id:
                sql = PipelineEngine.build_chained_sql(
                    focus_node_id,
                    graph_nodes,
                    graph_edges or [],
                    limit,
                )
            else:
                # 单节点模式（兼容旧调用）
                sql, _ = self.build_node_sql(node_type, config, apply_limit=True, limit=limit)

            if not sql:
                return {
                    "columns": [],
                    "column_types": [],
                    "rows": [],
                    "total": 0,
                    "has_more": False,
                    "sql_generated": "",
                }

            async with self.data_source_engine.connect() as conn:
                result = await conn.execute(text(sql))
                rows_raw = result.fetchall()
                columns = list(result.keys()) if hasattr(result, "keys") and result.keys() else []
                col_types = _infer_preview_column_types(rows_raw, len(columns))

                data = []
                for row in rows_raw:
                    item = dict(zip(columns, row))
                    for k, v in list(item.items()):
                        if hasattr(v, "isoformat"):
                            item[k] = v.isoformat()
                    data.append(item)

                all_columns: Optional[List[str]] = None
                if (
                    graph_nodes is not None
                    and focus_node_id
                    and focus_node_id in graph_nodes
                ):
                    foc_cfg = graph_nodes[focus_node_id].get("config") or {}
                    out_keys = foc_cfg.get("outputColumnKeys") or []
                    if isinstance(out_keys, list) and len(out_keys) > 0:
                        g_clear = PipelineEngine._graph_focus_without_output_column_keys(
                            graph_nodes, focus_node_id
                        )
                        sql_full = PipelineEngine.build_chained_sql(
                            focus_node_id,
                            g_clear,
                            graph_edges or [],
                            limit=1,
                        )
                        if sql_full and sql_full.strip():
                            try:
                                r_meta = await conn.execute(text(sql_full))
                                all_columns = (
                                    list(r_meta.keys())
                                    if hasattr(r_meta, "keys") and r_meta.keys()
                                    else []
                                )
                            except Exception as meta_err:
                                logger.warning(
                                    "预览全列名查询失败（列选择 UI 将退化为当前投影列）: %s",
                                    meta_err,
                                )

                payload: Dict[str, Any] = {
                    "columns": columns,
                    "column_types": col_types,
                    "rows": data,
                    "total": len(data),
                    "has_more": len(data) >= limit,
                    "sql_generated": sql,
                }
                if all_columns is not None:
                    payload["all_columns"] = all_columns
                return payload
        except Exception as e:
            logger.error(f"节点预览失败: {e}")
            raise ValueError(f"预览失败: {str(e)}")

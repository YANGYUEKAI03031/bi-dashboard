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
import json
import logging
import re
import time
from typing import List, Dict, Any, Optional, Tuple
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

                        # 构建引用上游列式表的 SQL
                        actual_sql = self._build_step_sql(
                            node_sql,
                            upstream_step_ids,
                            self.temp_manager._struct_tables
                        )

                        # 验证 SQL 安全性
                        if not self._validate_sql(actual_sql):
                            raise ValueError("SQL 语句包含不允许的操作")

                        canonical_type = PipelineEngine._canonical_pipeline_node_type(
                            str(node.get("type") or "")
                        )

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
        try:
            est_sql = f"SELECT COUNT(*) FROM ({sql.rstrip().rstrip(';')}) AS _est"
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

    def _build_step_sql(
        self,
        step_sql: str,
        upstream_step_ids: List[str],
        struct_table_map: Dict[str, Tuple[str, List[str]]]
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
        upstream_refs: List[str] = []
        for i, sid in enumerate(upstream_step_ids):
            if sid in struct_table_map:
                tbl_name, columns = struct_table_map[sid]
                safe_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in columns)
                upstream_refs.append(f"(SELECT {safe_cols} FROM {tbl_name}) AS _up{i}")
            else:
                upstream_refs.append(f"(SELECT data_json FROM {self.temp_manager.json_table_name} WHERE step_id = '{sid}')")

        # 按索引替换
        for i in range(len(upstream_refs)):
            placeholder = f"{{upstream_table_{i}}}"
            if placeholder in sql:
                sql = sql.replace(placeholder, upstream_refs[i])

        # 替换 {prev_table} 为第一个上游引用
        if "{prev_table}" in sql:
            sql = sql.replace("{prev_table}", upstream_refs[0])

        # 替换 {prev_step_id}
        if "{prev_step_id}" in sql:
            sql = sql.replace("{prev_step_id}", upstream_step_ids[0])

        # 按 step_id 替换
        for i, sid in enumerate(upstream_step_ids):
            placeholder = f"{{upstream_table_{sid}}}"
            if placeholder in sql:
                sql = sql.replace(placeholder, upstream_refs[i])

        # 没有占位符时：SQL 本身是 SELECT FROM 列式上游表
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

            # 检查 merge_type
            merge_type = node.get("merge_type")
            if merge_type and merge_type not in ('union', 'left_join', 'right_join', 'full_join'):
                return False, f"节点 '{node.get('name', i)}' 的 merge_type 必须是 union | left_join | right_join | full_join"

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
    def _apply_column_projection(sql: str, config: Dict[str, Any]) -> str:
        """
        若 config 中含 outputColumnKeys，外层投影这些列。
        列名优先用 outputColumnKeys 中保存的原始列名；
        若含 renameMap 也支持别名映射。
        """
        if not sql:
            return ""
        output_keys: List[str] = config.get("outputColumnKeys", [])
        if not output_keys:
            return sql
        # 支持 renameMap: { newName: oldName }
        rename_map: Dict[str, str] = config.get("renameMap", {})
        safe_cols: List[str] = []
        for col in output_keys:
            old_name = rename_map.get(col, col)
            if col != old_name:
                safe_cols.append(f"{PipelineEngine._safe_identifier(old_name)} AS {PipelineEngine._safe_identifier(col)}")
            else:
                safe_cols.append(PipelineEngine._safe_identifier(col))
        if not safe_cols:
            return sql
        cols_str = ", ".join(safe_cols)
        return f"SELECT {cols_str} FROM ({sql}) AS _p"

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
    def build_node_sql(
        node_type: str,
        config: Dict[str, Any],
        upstream_refs: Optional[List[Tuple[str, str]]] = None,
        # upstream_refs: List[Tuple[table_or_sql, alias]] for multi-input nodes
        apply_limit: bool = True,
        limit: int = 100,
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

        if node_type == "join":
            join_type = config.get("joinType", "inner")
            join_keys = config.get("joinKeys", [])
            jt_sql = {
                "inner": "INNER JOIN",
                "left": "LEFT JOIN",
                "right": "RIGHT JOIN",
                "full": "FULL JOIN",
            }.get(join_type, "INNER JOIN")
            if upstream_refs and len(upstream_refs) >= 2:
                left_ref, _ = upstream_refs[0]
                right_ref, _ = upstream_refs[1]
                if join_keys:
                    on_clause = " AND ".join(
                        f"a.{PipelineEngine._safe_identifier(k.get('leftCol', ''))} = b.{PipelineEngine._safe_identifier(k.get('rightCol', ''))}"
                        for k in join_keys
                    )
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

        # 4. 逐节点生成 SQL，维护 node_id -> sql
        node_sqls: Dict[str, str] = {}
        for nid in sorted_ids:
            node = graph_nodes.get(nid, {})
            ntype = node.get("type", "")
            nconfig = node.get("config", {})
            nupstream = node.get("upstream", [])

            # 收集有效上游 ref（仅 visited 集合内）
            valid_ups = [u for u in nupstream if u in visited and u in node_sqls]
            refs: List[Tuple[str, str]] = []
            for u in valid_ups:
                if u not in refs:
                    refs.append((node_sqls[u], u))

            # 生成当前节点核心 SQL（内层子查询不加 LIMIT）
            is_focus = (nid == focus_node_id)
            core_sql, _ = PipelineEngine.build_node_sql(
                ntype, nconfig, refs if refs else None, apply_limit=False, limit=limit
            )

            # 对当前节点 config 应用行筛选包装（等效于在下游前插 filter 节点）
            wrapped_sql = PipelineEngine._apply_row_filter(core_sql, nconfig)

            # 对当前节点 config 应用列投影包装
            wrapped_sql = PipelineEngine._apply_column_projection(wrapped_sql, nconfig)

            # 仅最外层（focus 节点）加 LIMIT
            if is_focus and wrapped_sql:
                wrapped_sql = f"{wrapped_sql} LIMIT {limit}"

            node_sqls[nid] = wrapped_sql

        return node_sqls.get(focus_node_id, "")

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

                return {
                    "columns": columns,
                    "column_types": col_types,
                    "rows": data,
                    "total": len(data),
                    "has_more": len(data) >= limit,
                    "sql_generated": sql,
                }
        except Exception as e:
            logger.error(f"节点预览失败: {e}")
            raise ValueError(f"预览失败: {str(e)}")

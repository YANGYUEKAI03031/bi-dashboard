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
                
                # 维护 node_columns 字典，供下游 JOIN 展开使用（与 build_chained_sql 一致）
                node_columns: Dict[str, Optional[List[str]]] = {}
                # 维护上游客的 columnRenames，供 output 节点应用列重命名
                upstream_column_renames: Dict[str, Dict[str, str]] = {}  # node_id -> { original: renamed }

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
                            node_config,
                        )

                        # 与 build_chained_sql 保持完全一致的处理逻辑
                        # 核心原则：Pipeline 执行应复用预览折叠 SQL 的生成逻辑
                        # 关键：build_node_sql 已正确处理 insertedColumns，
                        #      _apply_column_projection 也会再次处理 insertedColumns，
                        #      但 aggregate 节点 build_node_sql 已包含 insertedColumns，不应重复处理
                        if canonical_type != "output":
                            node_has_own_sql = bool(node_sql)
                            
                            if canonical_type == "aggregate":
                                # aggregate：build_node_sql 已处理 insertedColumns，跳过 insertedColumns 处理
                                # 仅用 outputColumnKeys 过滤输出列（不传 insertedColumns）
                                wrapped = PipelineEngine._apply_row_filter(
                                    actual_sql, node_config
                                )
                                proj_cfg = {k: v for k, v in node_config.items()} if isinstance(node_config, dict) else {}
                                proj_cfg.pop("insertedColumns", None)
                                actual_sql = PipelineEngine._apply_column_projection(
                                    wrapped, proj_cfg, None, is_last_layer=True
                                )
                            elif not node_has_own_sql and node_config.get("insertedColumns"):
                                # 节点没有 SQL 但有 insertedColumns：build_node_sql 已生成完整 SQL，
                                # _apply_column_projection 也会处理 insertedColumns，跳过外层处理避免重复嵌套
                                pass
                            else:
                                # 有 SQL 的节点或普通节点：按正常流程处理
                                actual_sql = PipelineEngine._apply_row_filter(
                                    actual_sql, node_config
                                )
                                actual_sql = PipelineEngine._apply_column_projection(
                                    actual_sql, node_config, None, is_last_layer=True
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

                            # 收集上游客的输出列和重命名配置，用于正确投影列
                            # 策略1: 优先从 config.outputColumnKeys 获取（前端设置的列选择）
                            # 策略2: 从 node_columns 字典获取（执行引擎推断的输出列）
                            # 同时收集上游客的 columnRenames 用于列重命名
                            upstream_output_keys: List[str] = []
                            upstream_config: Dict[str, Any] = {}
                            upstream_renames: Dict[str, str] = {}  # {原始列名: 重命名后列名}

                            for up_id in (upstream or []):
                                # 策略1: 从 config.outputColumnKeys 获取
                                up_node = nodes_dict.get(up_id) if 'nodes_dict' in dir() else None
                                if up_node:
                                    up_cfg = up_node.get("config") or {}
                                    up_keys = up_cfg.get("outputColumnKeys", [])
                                    if up_keys:
                                        upstream_output_keys = list(up_keys)
                                        upstream_config = up_cfg
                                        break

                                # 策略2: 从 node_columns 字典获取（执行引擎推断的输出列）
                                if not upstream_output_keys and up_id in node_columns and node_columns[up_id]:
                                    upstream_output_keys = list(node_columns[up_id])

                                # 收集上游客的重命名映射（从 upstream_column_renames）
                                if up_id in upstream_column_renames:
                                    upstream_renames.update(upstream_column_renames[up_id])

                            # 构建最终要导出的 SQL
                            select_sql = actual_sql.rstrip().rstrip(";")

                            if upstream_output_keys:
                                # 收集所有重命名映射：{原始列名: 重命名后列名}
                                all_renames: Dict[str, str] = {}
                                # 从 upstream_config 的 renameMap 和 columnRenames
                                up_rename_map = upstream_config.get("renameMap", {}) if upstream_config else {}
                                up_column_renames = upstream_config.get("columnRenames", {}) if upstream_config else {}
                                all_renames.update(upstream_renames)
                                # 从当前节点自己的 columnRenames（优先级最高）
                                current_renames = node_config.get("columnRenames", {})
                                all_renames.update(current_renames)

                                logger.info(f"[OUTPUT] Using upstream output keys: {upstream_output_keys}")
                                logger.info(f"[OUTPUT] All renames: {all_renames}")

                                # 构建投影列列表
                                proj_cols: List[str] = []
                                for col in upstream_output_keys:
                                    # 查找该列是否有重命名
                                    if col in all_renames:
                                        new_name = all_renames[col]
                                        proj_cols.append(f"`{col.replace('`', '``')}` AS `{new_name.replace('`', '``')}`")
                                    else:
                                        proj_cols.append(f"`{col.replace('`', '``')}`")

                                proj_cols_str = ", ".join(proj_cols)

                                # 找到最内层 SELECT 的 FROM，替换列列表
                                # SQL 形态通常是: SELECT * FROM (...最内层子查询...) AS _up0) AS _n
                                # 我们需要找到最内层的 SELECT * 并替换
                                import re
                                # 匹配最内层的 SELECT * FROM (
                                inner_select_pattern = r'(SELECT\s+\*\s+FROM\s*\()'
                                match = re.search(inner_select_pattern, select_sql, re.IGNORECASE)
                                if match:
                                    select_sql = re.sub(
                                        inner_select_pattern,
                                        f"SELECT {proj_cols_str} FROM (",
                                        select_sql,
                                        count=1,
                                        flags=re.IGNORECASE
                                    )
                                    logger.info(f"[OUTPUT] Projected columns: {proj_cols_str[:200]}...")
                                else:
                                    # 如果没有找到 SELECT * FROM (，直接在开头加 SELECT
                                    logger.warning(f"[OUTPUT] Could not find SELECT * pattern, wrapping with subquery")
                                    select_sql = f"SELECT {proj_cols_str} FROM ({select_sql}) AS _proj"
                            else:
                                # 无 upstream_output_keys 时，应用当前节点的 columnRenames
                                current_renames = node_config.get("columnRenames", {})
                                if current_renames:
                                    select_sql = PipelineEngine._apply_column_renames(select_sql, current_renames)

                            logger.info(f"[OUTPUT DEBUG] Node: {node_name} ({node_id})")
                            logger.info(f"[OUTPUT DEBUG] Upstream IDs: {upstream}")
                            logger.info(f"[OUTPUT DEBUG] Upstream output keys: {upstream_output_keys}")
                            sql_preview = select_sql[:300] + "..." if len(select_sql) > 300 else select_sql
                            logger.info(f"[OUTPUT DEBUG] Final select_sql: {sql_preview}")

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
                                node_config=node_config,  # 传递节点配置以应用格式转换
                            )

                        # 更新 node_id -> step_id 映射
                        node_step_map[node_id] = step_id

                        # 推断当前节点输出列，供下游 JOIN 展开使用（与 build_chained_sql 一致）
                        output_keys = node_config.get("outputColumnKeys", []) or []
                        if output_keys:
                            node_columns[node_id] = list(output_keys)
                        else:
                            # 使用 _preview_infer_output_columns 推断列
                            upstream_cols_list: List[Optional[List[str]]] = []
                            for up_id in upstream:
                                if up_id in node_columns:
                                    upstream_node_col = node_columns[up_id]
                                    if upstream_node_col is not None:
                                        upstream_cols_list.append(upstream_node_col)
                                    else:
                                        upstream_cols_list.append(None)
                                else:
                                    upstream_cols_list.append(None)
                            inferred = PipelineEngine._preview_infer_output_columns(
                                canonical_type, node_config, upstream_cols_list, merge_type
                            )
                            node_columns[node_id] = inferred
                        
                        # 收集当前节点的 columnRenames，供下游节点使用
                        # upstream_column_renames[node_id] = { original: renamed }
                        collected_renames: Dict[str, str] = {}
                        for up_id in (upstream or []):
                            if up_id in upstream_column_renames:
                                collected_renames.update(upstream_column_renames[up_id])
                        # 当前节点自己的 columnRenames
                        current_renames = node_config.get("columnRenames", {})
                        if current_renames:
                            collected_renames.update(current_renames)
                        upstream_column_renames[node_id] = collected_renames
                        logger.info(f"[RENAME COLLECT] Node: {node_name} ({node_id}), type: {canonical_type}, "
                                   f"upstream: {upstream}, own renames: {current_renames}, "
                                   f"collected: {collected_renames}")

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
        node_config: Optional[Dict[str, Any]] = None,
        sample_rows: int = 5
    ) -> Tuple[int, List[str]]:
        """
        通过 INSERT...SELECT 直接写入列式临时表（不走 fetchmany）。

        流程：
        1. 发现源 SQL 的 schema（列名 + MySQL 类型）
        2. 根据 node_config.previewColumnFormats 应用格式转换
        3. 创建列式临时表
        4. INSERT...SELECT 一次性写入
        5. 用 COUNT(*) 估算进度
        6. 标记完成

        Args:
            conn: 数据库连接
            sql: 要执行的 SELECT 语句
            step_id: 步骤 ID
            execution_id: 执行记录 ID
            node_config: 节点配置，包含 previewColumnFormats
            sample_rows: schema 发现采样行数

        Returns:
            (total_rows, columns)
        """
        # 提取列格式配置
        column_formats: Optional[Dict[str, str]] = None
        if node_config and isinstance(node_config, dict):
            column_formats = node_config.get('previewColumnFormats')
            if column_formats and not isinstance(column_formats, dict):
                column_formats = None

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
        row_count, columns = await self.temp_manager.insert_via_select(
            step_id, sql, sample_rows, column_formats
        )

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

        # 过滤节点：有 SQL 或 insertedColumns 的节点保留
        # 无 SQL 且无 insertedColumns 的节点也保留（透传节点，不报错）
        return [
            n for n in sorted_nodes
            if isinstance(n, dict) and (
                n.get("sql") 
                or n.get("config", {}).get("insertedColumns")
                or n.get("upstream")  # 有上游引用的节点可以透传
            )
        ]

    @staticmethod
    def _expand_join_select_stars(
        sql: str,
        upstream_step_ids: List[str],
        struct_table_map: Dict[str, Tuple[str, List[str]]],
        on_right_cols: Optional[List[str]] = None,
        join_type: str = "inner",
    ) -> str:
        """
        将关联 SQL 中的 SELECT * 展开为显式列。

        LEFT/RIGHT JOIN 语义：结果 = 左/右表全部列 + 另一表不含 ON 列的列。
        例如 ON a.id = b.ref_id → 右表的 ref_id 不出现在结果中（id 已来自左表）。
        
        对于 LEFT/RIGHT JOIN，若只知一表列，另一表用 a.* / b.* + _b 后缀别名避免冲突。
        与 _expand_join_select_for_preview 逻辑保持一致。

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
        if not left_cols and not right_cols:
            return sql
        up = sql.upper()
        if " JOIN " not in up or " AS A " not in up or " AS B " not in up:
            return sql

        # 与 _expand_join_select_for_preview 保持一致的展开逻辑
        sel = PipelineEngine._join_explicit_select_list(
            left_cols, right_cols, on_right_cols, join_type
        )
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
        join_type: str = "inner",
    ) -> str:
        """
        生成 JOIN 结果的显式列列表。

        展开规则（与 _expand_join_select_for_preview 一致）：
        - 两侧列均已知：左表全列 + 右表列（排除右表 ON 列及与左表同名列）。
        - 仅右表列已知：a.* + 右表显式列（排除 ON 右列，右表列加 _b 后缀别名）。
        - 仅左表列已知：LEFT/RIGHT JOIN 用左显式列 + 右表显式列（排除 ON 右列，加 _b 别名）。
        - 两侧均未知：不展开。

        无 on_right_cols 时：左表全列 + 右表列（排除同名）。
        """
        left_set = set(left_cols) if left_cols else set()
        right_set = set(right_cols) if right_cols else set()
        on_right_set = set(on_right_cols) if on_right_cols else set()
        
        # 两侧列均已知
        if left_cols and right_cols:
            parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
            for c in right_cols:
                if c in on_right_set:
                    continue  # ON 列不添加（左表对应列已在结果中）
                if c in left_set:
                    # 同名列：添加递增后缀（如 _b, _c, _d...）
                    # 找出左表中已有该 base 的最大后缀
                    base = c
                    max_suffix = 0
                    # 匹配模式：base、base_b、base_c 等
                    suffix_pattern = re.compile(rf"^{re.escape(base)}(?:_([a-z]))?$")
                    for lc in left_cols:
                        m = suffix_pattern.match(lc)
                        if m:
                            suf = m.group(1)
                            if suf is None:
                                # 基础列本身（未加后缀），视为 suffix=0
                                max_suffix = max(max_suffix, 0)
                            else:
                                # 转换 a=1, b=2, c=3, ...
                                val = ord(suf) - ord('a') + 1
                                max_suffix = max(max_suffix, val)
                    # 下一个后缀
                    next_suffix = chr(ord('a') + max_suffix)
                    b_col = PipelineEngine._safe_identifier(c)
                    b_alias = PipelineEngine._safe_identifier(f"{c}_{next_suffix}")
                    parts.append(f"b.{b_col} AS {b_alias}")
                else:
                    parts.append(f"b.{PipelineEngine._safe_identifier(c)}")
            return ", ".join(parts)
        
        # 仅右表列已知
        if right_cols and not left_cols:
            right_parts = []
            for c in right_cols:
                if c not in on_right_set:
                    b_expr = f"b.{PipelineEngine._safe_identifier(c)}"
                    alias = PipelineEngine._safe_identifier(f"{c}_b")
                    right_parts.append(f"{b_expr} AS {alias}")
            sel = f"a.*, {', '.join(right_parts)}" if right_parts else "a.*"
            return sel
        
        # 仅左表列已知
        if left_cols and not right_cols:
            if join_type in ("left", "right") and on_right_cols:
                sel_parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
                for c in right_cols or []:
                    if c not in on_right_set:
                        sel_parts.append(
                            f"b.{PipelineEngine._safe_identifier(c)} AS {PipelineEngine._safe_identifier(c)}_b"
                        )
            else:
                # INNER 且右列未知：直接用 b.*
                sel_parts = [f"a.{PipelineEngine._safe_identifier(c)}" for c in left_cols]
                sel_parts.append("b.*")
            return ", ".join(sel_parts)
        
        # 两侧均未知：不展开
        return "a.*, b.*"

    @staticmethod
    def _build_sql_from_inserted_columns(
        upstream_refs: List[str],
        config: Dict[str, Any],
        node_type: str = "",
    ) -> str:
        """
        根据 insertedColumns 配置生成 SQL（用于没有原始 SQL 的节点）。

        Args:
            upstream_refs: 上游临时表引用列表（已经是完整的子查询，如 "(SELECT ... FROM tbl) AS alias"）
            config: 节点配置（包含 insertedColumns）
            node_type: 节点类型

        Returns:
            生成的 SQL
        """
        if not upstream_refs:
            return ""
        
        # 使用第一个上游作为主表（已经是完整子查询，不需要再加括号）
        ref = upstream_refs[0]

        inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", []) or []
        if not inserted_columns:
            return f"SELECT * FROM {ref}"

        # 构建初始可用列名列表（从上游 ref 中提取列名）
        inner_columns: List[str] = []
        if ref:
            cols_match = re.match(r"^SELECT\s+(.*?)\s+FROM\s+", ref, re.IGNORECASE | re.DOTALL)
            if cols_match:
                col_str = cols_match.group(1).strip()
                if col_str and col_str != "*":
                    inner_columns = [c.strip() for c in col_str.split(",")]

        # ================================================================
        # insertedColumns 分层处理（解决 MySQL 不允许同一层 SELECT 引用尚未定义的列别名）
        # ================================================================
        layers: List[List[Dict[str, Any]]] = []
        layer_available: List[List[str]] = []  # 每层的可用列集合

        for col_config in inserted_columns:
            if not isinstance(col_config, dict):
                continue
            method = str(col_config.get("method", "")).strip().lower()
            method_cfg = col_config.get("config", {})
            expression = str(method_cfg.get("expression", "")).strip()
            source_ref = expression or str(col_config.get("sourceColumn", "")).strip()
            new_name = str(col_config.get("name", "")).strip()
            if not new_name:
                continue

            # 检测该列是否引用了前面层的 insertedColumn 别名
            depends_on_layer = -1
            for li, avail in enumerate(layer_available):
                for prev_name in avail:
                    if len(prev_name) > len(source_ref):
                        continue
                    escaped = re.escape(prev_name)
                    if re.search(r"(?<![`\"\w])" + escaped + r"(?![`\"\w])", source_ref):
                        depends_on_layer = li
                        break
                if depends_on_layer >= 0:
                    break

            target_layer = depends_on_layer + 1

            while len(layers) <= target_layer:
                layers.append([])
                layer_available.append(list(inner_columns))
                if target_layer > 0:
                    for li in range(len(layers) - 1):
                        layer_available[target_layer].extend(layer_available[li])

            layers[target_layer].append(col_config)
            layer_available[target_layer].append(new_name)

        # 逐层生成嵌套子查询
        current_sql = f"SELECT * FROM {ref}"
        for layer_idx, layer_cols in enumerate(layers):
            if not layer_cols:
                continue

            # 当前层可用列 = 内层原始列 + 前面所有层的 insertedColumn 别名
            layer_all_avail: List[str] = list(inner_columns)
            for li in range(layer_idx):
                layer_all_avail.extend([c.get("name", "") for c in layers[li]])

            layer_new_cols: List[str] = []
            for cfg in layer_cols:
                method = str(cfg.get("method", "")).strip().lower()
                source_col = str(cfg.get("sourceColumn", "")).strip()
                new_nm = str(cfg.get("name", "")).strip()
                cfg_inner = cfg.get("config", {})
                expr = PipelineEngine._build_single_inserted_column_expr(
                    method, source_col, cfg_inner, layer_all_avail
                )
                if expr:
                    layer_new_cols.append(f"{expr} AS {PipelineEngine._safe_identifier(new_nm)}")
                    layer_all_avail.append(new_nm)

            if not layer_new_cols:
                continue

            layer_cols_str = ", ".join(layer_new_cols)
            is_last = (layer_idx == len(layers) - 1)
            if is_last:
                result = f"SELECT *, {layer_cols_str} FROM ({current_sql}) AS _ic"
                return PipelineEngine._apply_column_formats(result, config)
            else:
                current_sql = f"SELECT *, {layer_cols_str} FROM ({current_sql}) AS _layer{layer_idx}"

        return PipelineEngine._apply_column_formats(current_sql, config)

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
        
        # DEBUG: 打印输入参数
        print(f"[JOIN ALLOWED COLS] jt={jt}, left_cols={left_cols}, right_cols={right_cols}, on_right_cols={list(on_set)}")

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
                if c in on_set:
                    # ON 列不添加（左表对应列已在结果中）
                    continue
                if c not in left_set:
                    # 右表独有的列，直接添加
                    names.append(c)
                else:
                    # 同名列：计算递增后缀，与 _join_explicit_select_list 保持一致
                    base = c
                    max_suffix = 0
                    suffix_pattern = re.compile(rf"^{re.escape(base)}(?:_([a-z]))?$")
                    for lc in left_cols:
                        m = suffix_pattern.match(lc)
                        if m:
                            suf = m.group(1)
                            if suf is None:
                                max_suffix = max(max_suffix, 0)
                            else:
                                val = ord(suf) - ord('a') + 1
                                max_suffix = max(max_suffix, val)
                    next_suffix = chr(ord('a') + max_suffix)
                    names.append(f"{c}_{next_suffix}")
            result = set(names)
            return result

        if left_cols is not None and right_cols is None and jt in ("left", "right") and on_right_cols:
            # LEFT/RIGHT JOIN：左表全列 + 右表独有列（ON 列排除）
            # 注意：当 join 类型为 left/right 时，_expand_join_select_for_preview 会给右表独有列加 _b 后缀
            names = list(left_cols)
            for c in (right_cols or []):
                if c not in on_set:
                    names.append(f"{c}_b")  # 加 _b 后缀，与 _expand_join_select_for_preview 一致
            return set(names)

        return None

    def _build_step_sql(
        self,
        step_sql: str,
        upstream_step_ids: List[str],
        struct_table_map: Dict[str, Tuple[str, List[str]]],
        node_type: str = "",
        merge_type: Optional[str] = None,
        node_config: Optional[Dict[str, Any]] = None,
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
        config = node_config or {}
        canonical_type = PipelineEngine._canonical_pipeline_node_type(node_type)
        
        sql = (step_sql or "").strip()
        
        # 没有 SQL 且没有 insertedColumns 时，需要上游才能透传
        if not sql and not config.get("insertedColumns"):
            # 如果没有上游，只有 source 节点可以（直接执行自己的 SQL）
            # 其他节点没有 SQL 且没有上游，无法生成有效的 SELECT
            if not upstream_step_ids:
                if canonical_type == "source":
                    return sql
                return ""
            # 有上游但没有 SQL → 透传上游数据
            # 构建上游引用需要 struct_table_map 等，这些在后面处理
            pass  # 继续执行后面的透传逻辑

        # 没有上游（source 节点），直接执行
        if not upstream_step_ids:
            # source 节点没有上游，直接执行
            if canonical_type == "source":
                return sql
            # 非 source 节点没有上游（可能上游节点被过滤掉了）
            # 如果 SQL 包含占位符但没被替换，说明配置有问题
            if "{" in sql:
                raise ValueError(
                    f"节点 SQL 包含占位符（如 {{prev_table}}）但缺少有效的上游引用。"
                    f"请检查上游节点是否被正确配置。"
                )
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

        # 没有 SQL 但有 insertedColumns - 使用 insertedColumns 生成 SQL
        if not sql and config.get("insertedColumns"):
            return self._build_sql_from_inserted_columns(upstream_refs, config, node_type="")
        
        # column_select 节点：即使没有 SQL，也要根据 selectedColumns 投影列
        if not sql and canonical_type == "column_select":
            selected = config.get("selectedColumns", []) or []
            if selected:
                cols = [
                    (
                        f"{PipelineEngine._safe_identifier(sc.get('from', ''))} AS {PipelineEngine._safe_identifier(sc.get('to', sc.get('from', '')))}"
                        if sc.get("from") != sc.get("to")
                        else PipelineEngine._safe_identifier(sc.get("from", ""))
                    )
                    for sc in selected
                    if sc.get("from")
                ]
                if cols:
                    return f"SELECT {', '.join(cols)} FROM {upstream_refs[0]}"
        
        # 没有 SQL 也没有 insertedColumns - 直接使用上游临时表（透传）
        if not sql:
            # deduplicate 节点：即使没有 SQL，也要根据 dedupColumns 应用去重逻辑
            if canonical_type == "deduplicate":
                dedup_columns = config.get("dedupColumns", []) or []
                keep_mode = config.get("keepMode", "first")
                logger.info(f"[DEDUP STEP] deduplicate node, dedupColumns={dedup_columns}, keepMode={keep_mode}")
                if dedup_columns:
                    # 使用 ROW_NUMBER 实现去重
                    part_cols = ", ".join(PipelineEngine._safe_identifier(c) for c in dedup_columns)
                    order_col = PipelineEngine._safe_identifier(dedup_columns[0])
                    if keep_mode == "last":
                        dedup_sql = (
                            f"SELECT * FROM ("
                            f"SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY {order_col} DESC) AS _rn "
                            f"FROM {upstream_refs[0]}"
                            f") AS _dedup WHERE _rn = 1"
                        )
                    else:
                        dedup_sql = (
                            f"SELECT * FROM ("
                            f"SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY {order_col}) AS _rn "
                            f"FROM {upstream_refs[0]}"
                            f") AS _dedup WHERE _rn = 1"
                        )
                    logger.info(f"[DEDUP STEP] Generated dedup SQL: {dedup_sql[:200]}...")
                    return dedup_sql
                else:
                    # 无 dedupColumns 时返回 DISTINCT
                    logger.info(f"[DEDUP STEP] No dedupColumns, using DISTINCT")
                    result = f"SELECT DISTINCT * FROM {upstream_refs[0]}"
                    return PipelineEngine._apply_column_formats(result, config)
            
            # 其他节点直接透传
            result = f"SELECT * FROM {upstream_refs[0]}"
            # 应用 previewColumnFormats 格式转换
            return PipelineEngine._apply_column_formats(result, config)

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

        # INNER JOIN：若仅左表可推断列、右表不可（上游顺序常为「聚合→源表」），
        # 交换两侧子查询，使「列未知」在 AS a，便于展开为 a.* + b 显式列
        # 并排除 ON 右列（与 build_chained_sql 逻辑一致）
        lc_info = struct_table_map.get(upstream_step_ids[0]) if upstream_step_ids else None
        rc_info = struct_table_map.get(upstream_step_ids[1]) if len(upstream_step_ids) > 1 else None
        lc_cols = lc_info[1] if lc_info else None
        rc_cols = rc_info[1] if rc_info else None
        
        if canonical_type == "join" and not is_union_merge:
            jt_pre = str(node_config.get("joinType", "inner")).lower() if node_config else "inner"
            if jt_pre == "inner" and lc_cols and not rc_cols:
                # 左表列已知、右表列未知，交换两侧
                upstream_step_ids = upstream_step_ids[::-1]
                upstream_refs = upstream_refs[::-1]
                # 交换后重新获取
                lc_cols, rc_cols = rc_cols, lc_cols

        # 对于 JOIN 类型，需要展开 SELECT * 为显式列（避免同名列冲突）
        # 但对于 UNION 类型的 merge 节点，不展开 SELECT *，因为 UNION 按位置合并列
        if canonical_type == "join" and not is_union_merge:
            # 优先从 config.joinKeys 提取 rightCol（与 build_chained_sql 一致）
            # 回退从 SQL ON 子句提取
            on_right_cols: List[str] = []
            join_keys = node_config.get("joinKeys", []) if node_config else []
            if join_keys:
                for k in join_keys:
                    if isinstance(k, dict):
                        rc = str(k.get("rightCol", "") or "").strip()
                        if rc:
                            on_right_cols.append(rc)
            # 回退：从 ON 子句提取
            if not on_right_cols:
                on_match = re.search(r"\bON\s+(.+?)(?:\s+WHERE|\s+GROUP|\s+HAVING|\s+ORDER|\s+LIMIT|\s+UNION|$)", sql, re.IGNORECASE | re.DOTALL)
                if on_match:
                    on_expr = on_match.group(1)
                    for m in re.finditer(r"b\.[`\"']?([a-zA-Z0-9_]+)[`\"']?", on_expr, re.IGNORECASE):
                        if m.group(1):
                            on_right_cols.append(m.group(1))
            
            jt_pre = str(node_config.get("joinType", "inner")).lower() if node_config else "inner"
            sql = PipelineEngine._expand_join_select_stars(
                sql, upstream_step_ids, struct_table_map, 
                on_right_cols if on_right_cols else None, jt_pre
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
        
        # 预处理：移除外层括号和空白，便于验证包含子查询的 SQL
        # 例如 "(SELECT ... FROM ... WHERE step_id = 'xxx') AS _up0" 
        # 预处理后变为 "SELECT ... FROM ..."
        while sql_upper.startswith("(") and sql_upper.endswith(")"):
            sql_upper = sql_upper[1:-1].strip()

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

            # 节点可以没有任何特殊配置（没有 SQL，没有 insertedColumns）
            # 这种情况下节点会直接透传上游数据，不报错
            # has_sql = bool(node.get("sql"))
            # has_inserted = bool(node.get("config", {}).get("insertedColumns"))
            # if not has_sql and not has_inserted:
            #     return False, f"节点 {node.get('name', i)} 缺少 SQL 语句"

            # 检查 SQL 安全性（只有节点有 SQL 时才检查）
            sql = node.get("sql", "") or ""
            if sql:
                sql_upper = sql.upper()
                dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE"]
                for kw in dangerous:
                    if kw in sql_upper:
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
    def _extract_columns_from_select(sql: str) -> List[str]:
        """
        从 SELECT ... FROM (...) 中提取列名。
        用于确定当前作用域内可用的列名列表，以便 insertedColumns 表达式可以引用这些列。
        支持中文列名、复杂表达式和带 AS 别名的列。
        """
        sql_stripped = sql.strip()
        if not sql_stripped.upper().startswith("SELECT"):
            return []
        # 匹配 SELECT ... FROM（支持子查询嵌套）
        m = re.match(r"^SELECT\s+(.*?)(\s+FROM\s+)", sql_stripped, re.IGNORECASE | re.DOTALL)
        if not m:
            return []
        cols_str = m.group(1).strip()
        if cols_str == "*":
            return []  # 无法推断具体列名

        # 逐列解析（处理嵌套括号和 AS 别名）
        # 策略：遇到 AS 时，检查 AS 前是否为简单函数调用
        # - 简单函数调用如 SUM(x)、COUNT(x)：提取 AS 后的别名
        # - 简单列引用如 count_评价文本_1：提取列名本身（去掉 AS 别名）
        # - 其他表达式如 count_评价文本_1 + ...：提取 AS 后的别名
        cols: List[str] = []
        depth = 0
        buf = ""
        for ch in cols_str:
            if ch == "(":
                depth += 1
                buf += ch
            elif ch == ")":
                depth -= 1
                buf += ch
            elif ch == "," and depth == 0:
                col = buf.strip()
                # 从右向左找 AS 分隔别名（支持中文别名，用 \S+ 而非 \w+）
                as_match = re.match(r"^(.*?)\s+AS\s+(\S+)$", col, re.IGNORECASE)
                if as_match:
                    inner = as_match.group(1).strip()
                    # 检查最外层是否是简单函数调用（如 SUM(x)、COUNT(x)、MAX(x)）
                    fn_match = re.match(r"^\w+\([^)]*\)$", inner, re.IGNORECASE)
                    if fn_match:
                        # 函数调用 → 提取别名（如 SUM(x) AS sum_x → sum_x）
                        col = as_match.group(2)
                    else:
                        # 非函数调用 → 提取原始列名（如 count_评价文本_1 AS count_评价文本_1 → count_评价文本_1）
                        col = inner
                cols.append(col)
                buf = ""
            else:
                buf += ch
        if buf.strip():
            col = buf.strip()
            as_match = re.match(r"^(.*?)\s+AS\s+(\S+)$", col, re.IGNORECASE)
            if as_match:
                inner = as_match.group(1).strip()
                fn_match = re.match(r"^\w+\([^)]*\)$", inner, re.IGNORECASE)
                if fn_match:
                    col = as_match.group(2)
                else:
                    col = inner
            cols.append(col)

        return [c.strip() for c in cols if c.strip()]

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
    def _get_date_preset_expression(preset: str) -> tuple:
        """根据快捷日期选项获取开始和结束日期"""
        from datetime import datetime, timedelta
        from dateutil.relativedelta import relativedelta

        today = datetime.now().date()
        yesterday = today - timedelta(days=1)
        fmt = "%Y-%m-%d"

        presets = {
            "today": (today, today),
            "yesterday": (yesterday, yesterday),
            "last_7_days": (today - timedelta(days=6), today),
            "last_30_days": (today - timedelta(days=29), today),
            "this_month": (today.replace(day=1), (today + relativedelta(months=1) - timedelta(days=1))),
            "last_month": ((today - relativedelta(months=1)).replace(day=1),
                          (today - timedelta(days=today.day))),
            "this_year": (today.replace(month=1, day=1), today.replace(month=12, day=31)),
            "last_year": ((today.replace(year=today.year - 1, month=1, day=1)),
                         (today.replace(year=today.year - 1, month=12, day=31))),
            # 昨日基准的快捷选项
            "yesterday_last_7_days": (yesterday - timedelta(days=6), yesterday),
            "yesterday_last_30_days": (yesterday - timedelta(days=29), yesterday),
            "yesterday_last_90_days": (yesterday - timedelta(days=89), yesterday),
            "yesterday_last_month": ((yesterday - relativedelta(months=1)).replace(day=1),
                                    (yesterday - timedelta(days=yesterday.day))),
        }

        dates = presets.get(preset)
        if dates:
            return (dates[0].strftime(fmt), dates[1].strftime(fmt))
        return None

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

            # 日期快捷操作符
            if op == "preset":
                preset = str(cond.get("preset", ""))
                if preset:
                    dates = PipelineEngine._get_date_preset_expression(preset)
                    if dates:
                        clauses.append(f"{col} BETWEEN '{dates[0]}' AND '{dates[1]}'")
                continue

            if op == "before":
                preset = str(cond.get("preset", ""))
                if preset:
                    dates = PipelineEngine._get_date_preset_expression(preset)
                    if dates:
                        clauses.append(f"{col} < '{dates[0]}'")
                continue

            if op == "after":
                preset = str(cond.get("preset", ""))
                if preset:
                    dates = PipelineEngine._get_date_preset_expression(preset)
                    if dates:
                        clauses.append(f"{col} > '{dates[1]}'")
                continue

            if op == "between":
                range_start = str(cond.get("rangeStart", ""))
                range_end = str(cond.get("rangeEnd", ""))
                if range_start and range_end:
                    clauses.append(f"{col} BETWEEN '{range_start}' AND '{range_end}'")
                continue

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
    def _build_column_format_expr(col_expr: str, col_name: str, fmt: str) -> str:
        """
        根据预览格式生成 MySQL 表达式。

        Args:
            col_expr: 列表达式（如 '`col_name`' 或 'DATE(`col`) AS `col`'）
            col_name: 列名（用于别名）
            fmt: 预览格式（来自 previewColumnFormats）

        Returns:
            格式化后的表达式，如 'DATE(`col`) AS `col`'
        """
        if fmt == 'date':
            return f"DATE({col_expr}) AS {PipelineEngine._safe_identifier(col_name)}"
        elif fmt == 'datetime':
            # DATE() 在 MySQL 中返回 'YYYY-MM-DD' 格式
            # 对于 datetime 类型，需要保留时间部分，使用 CAST 转换为 DATE 会丢失时间
            # 使用 DATE(col) 只取日期部分（如果前端只需要日期）
            return f"DATE({col_expr}) AS {PipelineEngine._safe_identifier(col_name)}"
        elif fmt == 'percent':
            # 百分比格式：value * 100
            return f"({col_expr} * 100) AS {PipelineEngine._safe_identifier(col_name)}"
        elif fmt == 'number':
            # 数字格式：保持原样（已处理了）
            return col_expr
        elif fmt == 'string':
            # 文本格式：转换为字符串
            return f"CAST({col_expr} AS CHAR) AS {PipelineEngine._safe_identifier(col_name)}"
        # auto 或其他未知格式：保持原样
        return col_expr

    @staticmethod
    def _apply_column_formats(sql: str, config: Dict[str, Any]) -> str:
        """
        根据 previewColumnFormats 对 SELECT 列应用格式转换。
        这会在外层包装一个 SELECT，应用日期提取、百分比转换等。
        """
        formats: Dict[str, str] = config.get("previewColumnFormats", {})
        if not formats:
            return sql

        sql_stripped = sql.strip()
        if not sql_stripped.upper().startswith("SELECT"):
            return sql

        # 提取列名列表
        cols = PipelineEngine._extract_columns_from_select(sql_stripped)
        if not cols:
            return sql

        # 检查是否有需要格式化的列
        cols_to_format = [c for c in cols if c in formats]
        if not cols_to_format:
            return sql

        # 构建 SELECT 列表达式
        select_parts: List[str] = []
        for col in cols:
            safe_col = PipelineEngine._safe_identifier(col)
            fmt = formats.get(col)
            if fmt and fmt != 'auto':
                # 需要格式化的列
                expr = PipelineEngine._build_column_format_expr(safe_col, col, fmt)
                select_parts.append(expr)
            else:
                # 不需要格式化的列
                select_parts.append(safe_col)

        cols_str = ", ".join(select_parts)
        # 提取 FROM 及之后的部分
        m = re.search(r'(\s+FROM\s+.+)$', sql_stripped, re.IGNORECASE | re.DOTALL)
        if not m:
            return sql
        from_part = m.group(1)
        return f"SELECT {cols_str}{from_part}"

    @staticmethod
    def _apply_column_renames(
        sql: str,
        renames: Dict[str, str],
    ) -> str:
        """
        应用列重命名：将 SQL 中的原始列名替换为重命名后的列名（作为别名）。

        Args:
            sql: 原始 SQL
            renames: { original_column_name: renamed_column_name }

        Returns:
            重命名后的 SQL
        """
        if not sql or not renames:
            return sql

        sql_stripped = sql.strip()
        if not sql_stripped.upper().startswith("SELECT"):
            return sql

        # 提取列名列表（从最外层 SELECT ... FROM）
        cols = PipelineEngine._extract_columns_from_select(sql_stripped)
        # 去掉反引号，用于后续匹配
        cols = [c.replace('`', '') for c in cols]
        
        # 如果最外层是 SELECT *，需要深入到最内层子查询获取实际列名
        if not cols:
            cols = PipelineEngine._extract_columns_from_nested_select(sql_stripped)
        
        if not cols:
            return sql

        # 检查是否有需要重命名的列
        cols_to_rename = [c for c in cols if c in renames]
        if not cols_to_rename:
            return sql

        # 构建 SELECT 列表达式
        select_parts: List[str] = []
        for col in cols:
            safe_col = PipelineEngine._safe_identifier(col)
            new_name = renames.get(col)
            if new_name and new_name != col:
                safe_new = PipelineEngine._safe_identifier(new_name)
                select_parts.append(f"{safe_col} AS {safe_new}")
            else:
                select_parts.append(safe_col)

        cols_str = ", ".join(select_parts)
        
        # 如果最外层是 SELECT *，需要替换成 SELECT new_cols FROM (inner_sql)
        if sql_stripped.upper().startswith("SELECT *"):
            # 提取 FROM 及之后的部分
            m = re.search(r'(\s+FROM\s+.+)$', sql_stripped, re.IGNORECASE | re.DOTALL)
            if m:
                from_part = m.group(1)
                return f"SELECT {cols_str}{from_part}"
        
        # 普通情况：替换 SELECT ... 部分
        m = re.match(r'^SELECT\s+.*?(\s+FROM\s+.+)$', sql_stripped, re.IGNORECASE | re.DOTALL)
        if not m:
            return sql
        from_part = m.group(1)
        return f"SELECT {cols_str}{from_part}"
    
    @staticmethod
    def _extract_columns_from_nested_select(sql: str, max_depth: int = 10) -> List[str]:
        """
        从嵌套 SELECT 中提取最内层的实际列名。
        例如：SELECT * FROM (SELECT * FROM (SELECT a, b FROM t) AS x) AS y
        返回: ['a', 'b']
        """
        depth = 0
        for _ in range(max_depth):
            # 查找 SELECT ... FROM ( 模式
            m = re.search(r'SELECT\s+\*\s+FROM\s+\(', sql, re.IGNORECASE)
            if not m:
                # 没有 SELECT * FROM ( 了，提取当前层的列名
                cols = PipelineEngine._extract_columns_from_select(sql)
                # 去掉反引号用于匹配
                return [c.replace('`', '') for c in cols]
            depth += 1
            # 找到最内层子查询的位置
            # 需要匹配括号对
            start = m.end() - 1  # '(' 的位置
            depth_count = 1
            i = start + 1
            while i < len(sql) and depth_count > 0:
                if sql[i] == '(' and (i == 0 or sql[i-1] != '`'):
                    depth_count += 1
                elif sql[i] == ')' and (i == 0 or sql[i-1] != '`'):
                    depth_count -= 1
                i += 1
            # 提取最内层子查询
            inner = sql[start+1:i-1]
            # 在最内层子查询中找 SELECT 列名
            cols = PipelineEngine._extract_columns_from_select(inner)
            # 去掉反引号用于匹配
            cols = [c.replace('`', '') for c in cols]
            if cols:
                return cols
            # 如果最内层也是 SELECT *，继续往内找
            sql = inner
        return []

    @staticmethod
    def _apply_column_projection(
        sql: str,
        config: Dict[str, Any],
        allowed_sql_columns: Optional[Set[str]] = None,
        is_last_layer: bool = False,
    ) -> str:
        """
        若 config 中含 outputColumnKeys，外层投影这些列。
        列名优先用 outputColumnKeys 中保存的原始列名；
        若含 renameMap 也支持别名映射。

        同时处理 insertedColumns，添加新计算的列。
        insertedColumns 中后定义的列可以引用前面已定义的列（通过 all_available_columns 传递）。

        同时处理 previewColumnFormats，应用列格式转换（日期提取、百分比转换等）。

        allowed_sql_columns 非空时，只保留「内层结果中确实存在」的列，避免 JOIN 类型切换后
        仍引用旧列名导致 1054。
        """
        if not sql:
            return ""
        output_keys: List[str] = config.get("outputColumnKeys", [])
        rename_map: Dict[str, str] = config.get("renameMap", {})
        # 支持 columnRenames（前端存储的列重命名格式：{ original: renamed }）
        column_renames: Dict[str, str] = config.get("columnRenames", {})
        # 合并 renameMap 和 columnRenames（columnRenames 优先级更高，因为是后设置的重命名）
        for orig, renamed in column_renames.items():
            rename_map[renamed] = orig  # renameMap 格式是 { output_alias: original_name }
        inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", [])

        # 从内层 SQL 中提取列名列表，用于 insertedColumns 表达式中引用列
        # （支持中文列名、别名、前面生成的列等）
        inner_columns: List[str] = PipelineEngine._extract_columns_from_select(sql)
        # allowed_sql_columns 非空时，只使用在 allowed 中的列作为可用列
        if allowed_sql_columns is not None:
            inner_columns = [c for c in inner_columns if c in allowed_sql_columns]

        safe_cols: List[str] = []

        def _is_column_in_output(col: str) -> Optional[str]:
            """检查列是否应该出现在输出中。返回内层实际的列名（可能带后缀）"""
            original = str(rename_map.get(col, col)).strip()
            if allowed_sql_columns is not None:
                if original in allowed_sql_columns:
                    return original
                # 支持多级后缀：_b, _c, _d...（JOIN 右表同名列）
                import re
                pattern = rf"^{re.escape(original)}(?:_[a-z])+$"
                for allowed in allowed_sql_columns:
                    if re.match(pattern, allowed):
                        return allowed
                return None
            return original

        # 当 outputColumnKeys 为空时，保留所有原有列（SELECT *）
        if not output_keys:
            if allowed_sql_columns is not None:
                for col in allowed_sql_columns:
                    safe_cols.append(PipelineEngine._safe_identifier(col))
        else:
            keys_use: List[str] = list(output_keys)
            if allowed_sql_columns is not None:
                def _is_column_allowed(col: str) -> bool:
                    original = str(rename_map.get(col, col)).strip()
                    if original in allowed_sql_columns:
                        return True
                    # 支持多级后缀 _b, _c, _d 等
                    import re
                    pattern = rf"^{re.escape(original)}(?:_[a-z])*$"
                    for allowed in allowed_sql_columns:
                        if re.match(pattern, allowed):
                            return True
                    return False
                keys_use = [col for col in output_keys if _is_column_allowed(col)]
            for col in keys_use:
                old_name = rename_map.get(col, col)
                if col != old_name:
                    safe_cols.append(f"{PipelineEngine._safe_identifier(old_name)} AS {PipelineEngine._safe_identifier(col)}")
                else:
                    safe_cols.append(PipelineEngine._safe_identifier(old_name))

        # ================================================================
        # insertedColumns 分层处理
        # 原因：MySQL 不允许同一层 SELECT 列表中引用尚未定义的列别名。
        # 因此当 insertedColumn B 引用 insertedColumn A 时，需要将 B 放到下一层嵌套子查询中。
        # ================================================================
        has_inserted = False
        all_ic_names: List[str] = list(inner_columns)

        # 第一步：按依赖关系将 insertedColumns 分配到各层
        # layers[0] = 无依赖的列（可直接与内层列同层）
        # layers[N] = 依赖 layers[N-1] 中某个列的列
        layers: List[List[Dict[str, Any]]] = []
        # layer_available[i] = 第 i 层可用的列名集合（用于依赖检测）
        layer_available: List[List[str]] = []

        for col_config in inserted_columns:
            if not isinstance(col_config, dict):
                continue
            method = str(col_config.get("method", "")).strip().lower()
            method_cfg = col_config.get("config", {})
            expression = str(method_cfg.get("expression", "")).strip()
            source_ref = expression or str(col_config.get("sourceColumn", "")).strip()
            new_name = str(col_config.get("name", "")).strip()
            if not new_name:
                continue

            # 检测该列引用了前面哪个 insertedColumn 的别名（作为完整单词）
            depends_on_layer = -1  # -1 表示无依赖
            for li, avail in enumerate(layer_available):
                for prev_name in avail:
                    if len(prev_name) > len(source_ref):
                        continue
                    escaped = re.escape(prev_name)
                    if re.search(r"(?<![`\"\w])" + escaped + r"(?![`\"\w])", source_ref):
                        depends_on_layer = li
                        break
                if depends_on_layer >= 0:
                    break

            target_layer = depends_on_layer + 1

            # 确保层结构足够大
            while len(layers) <= target_layer:
                layers.append([])
                layer_available.append(list(inner_columns))
                # 每层初始时把前面所有层的别名也加入（供同层其他列引用）
                if target_layer > 0:
                    for li in range(len(layers) - 1):
                        layer_available[target_layer].extend(layer_available[li])

            layers[target_layer].append(col_config)
            layer_available[target_layer].append(new_name)
            has_inserted = True
            all_ic_names.append(new_name)

        if not has_inserted:
            # 没有 insertedColumns，但仍需检查是否有 previewColumnFormats
            return PipelineEngine._apply_column_formats(sql, config)

        # 第二步：逐层生成嵌套子查询
        # 最内层 = 内层列
        # 第0层 → SELECT *, {第0层新列} FROM (内层)
        # 第1层 → SELECT *, {第1层新列} FROM (第0层结果)
        # ...
        # 最外层 → SELECT {投影列} FROM (第N层结果)  或  SELECT *, {最外层新列} FROM (第N层结果)
        current_sql = sql
        for layer_idx, layer_cols in enumerate(layers):
            if not layer_cols:
                continue

            # 构建当前层可用的列名列表（内层列 + 前面所有层的 insertedColumn 别名）
            layer_all_avail: List[str] = list(inner_columns)
            for li in range(layer_idx):
                layer_all_avail.extend([c.get("name", "") for c in layers[li]])
            # 同层内前面已生成的列（供同层后续列引用，如同层 B 引用同层 A）
            layer_all_avail = list(layer_all_avail)

            layer_new_cols: List[str] = []
            for cfg in layer_cols:
                method = str(cfg.get("method", "")).strip().lower()
                source_col = str(cfg.get("sourceColumn", "")).strip()
                new_nm = str(cfg.get("name", "")).strip()
                cfg_inner = cfg.get("config", {})
                expr = PipelineEngine._build_single_inserted_column_expr(
                    method, source_col, cfg_inner, layer_all_avail
                )
                if expr:
                    layer_new_cols.append(f"{expr} AS {PipelineEngine._safe_identifier(new_nm)}")
                    layer_all_avail.append(new_nm)

            if not layer_new_cols:
                continue

            layer_cols_str = ", ".join(layer_new_cols)
            is_last_layer = (layer_idx == len(layers) - 1)

            if is_last_layer and output_keys:
                # 最外层且有 outputColumnKeys：做列投影
                proj_cols: List[str] = []
                for col in output_keys:
                    old_nm = str(rename_map.get(col, col)).strip()
                    if col != old_nm:
                        proj_cols.append(f"{PipelineEngine._safe_identifier(old_nm)} AS {PipelineEngine._safe_identifier(col)}")
                    else:
                        proj_cols.append(PipelineEngine._safe_identifier(old_nm))
                all_proj_str = ", ".join(proj_cols + layer_new_cols)
                current_sql = f"SELECT {all_proj_str} FROM ({current_sql}) AS _p"
            elif is_last_layer:
                # 最外层无 outputColumnKeys：SELECT *
                current_sql = f"SELECT *, {layer_cols_str} FROM ({current_sql}) AS _ic"
            else:
                # 中间层和第一层：始终 SELECT * + 当前层新列
                current_sql = f"SELECT *, {layer_cols_str} FROM ({current_sql}) AS _layer{layer_idx}"

        # 应用 previewColumnFormats 格式转换（日期提取、百分比转换等）
        current_sql = PipelineEngine._apply_column_formats(current_sql, config)

        return current_sql

    # ================================================================
    # 预览用列名推断（用于 JOIN 展开）
    # ================================================================

    @staticmethod
    def _split_select_columns(sql: str) -> List[str]:
        """
        将 SELECT ... FROM 之间的列表达式按顶层逗号分割。
        忽略括号内和字符串字面量内的逗号。
        """
        m = re.match(r"^SELECT\s+(.*?)\s+FROM\s+", sql, re.IGNORECASE | re.DOTALL)
        if not m:
            return []
        cols_str = m.group(1)
        parts: List[str] = []
        depth = 0
        in_str = False
        str_char = ""
        i = 0
        while i < len(cols_str):
            c = cols_str[i]
            is_escaped = i > 0 and cols_str[i - 1] == "\\"
            if c in ("'", '"', "`") and not is_escaped:
                if not in_str:
                    in_str = True
                    str_char = c
                elif c == str_char:
                    in_str = False
                    str_char = ""
            if not in_str:
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                elif c == "," and depth == 0:
                    parts.append(cols_str[:i].strip())
                    cols_str = cols_str[i + 1 :]
                    i = -1
            i += 1
        parts.append(cols_str.strip())
        return parts

    @staticmethod
    def _extract_sql_aliases(sql: str) -> List[str]:
        """
        从 SELECT 语句中提取每个列表达式的最终列名。
        格式为 'expr AS alias' 时取 alias；无 AS 时取最后一个标识符。
        支持 groupBy 列（无 AS）、聚合别名、反引号、中文列名等。
        """
        aliases: List[str] = []
        parts = PipelineEngine._split_select_columns(sql)
        for part in parts:
            part = part.strip()
            # 匹配末尾的 AS alias（忽略括号内的 AS）
            m = re.search(r"\bAS\s+([^\s,)]+)\s*$", part, re.IGNORECASE)
            if m:
                aliases.append(m.group(1).strip("`\"'"))
            else:
                # 无 AS：取最后一个标识符作为列名（如 groupBy 列）
                identifiers = re.findall(r"\b([a-zA-Z_\u4e00-\u9fff]\w*)\b", part)
                if identifiers:
                    aliases.append(identifiers[-1])
        return aliases

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
            # DEBUG: 打印输入
            print(f"[AGG INFER] node_type={node_type}, upstream_cols={upstream_cols}, aggregations={config.get('aggregations')}, insertedColumns={config.get('insertedColumns')}")
            
            # 优先从 node.sql 解析 AS 别名，这是实际执行的真实列名
            node_sql: str = config.get("sql", "") or ""
            if node_sql:
                aliases_from_sql = PipelineEngine._extract_sql_aliases(node_sql)
                if aliases_from_sql:
                    print(f"[AGG INFER] 从 SQL 解析别名: {aliases_from_sql}")
                    return aliases_from_sql

            group_by: List[str] = config.get("groupBy", []) or []
            raw_aggs: List[Any] = config.get("aggregations", []) or []
            inserted_columns: List[Dict[str, Any]] = config.get("insertedColumns", []) or []
            parts: List[str] = []

            # 如果有聚合配置，收集聚合输出列
            for c in group_by:
                if c := str(c).strip():
                    parts.append(c)
            for a in raw_aggs:
                if isinstance(a, dict):
                    alias = str(a.get("alias", "") or a.get("column", "")).strip()
                    if alias:
                        parts.append(alias)
            
            # 如果有 insertedColumns，添加新列名
            if inserted_columns:
                for col_config in inserted_columns:
                    if isinstance(col_config, dict):
                        new_name = str(col_config.get("name", "")).strip()
                        if new_name:
                            parts.append(new_name)
            
            print(f"[AGG INFER] parts={parts}, raw_aggs={raw_aggs}, inserted_columns={inserted_columns}")
            
            # 如果有输出列，返回；否则透传上游列
            if parts:
                # 重要：与 build_node_sql 保持一致
                # - 有聚合配置时：只返回 groupBy + 聚合别名 + insertedColumns（不含上游原始列）
                # - 无聚合但有 insertedColumns 时：返回上游列 + insertedColumns
                if not raw_aggs and inserted_columns and upstream_cols and upstream_cols[0] is not None:
                    # 无聚合但有 insertedColumns：输出列 = 上游列 + insertedColumns（与 SELECT *, {新列} 一致）
                    result = list(upstream_cols[0])
                    for col_config in inserted_columns:
                        if isinstance(col_config, dict):
                            new_name = str(col_config.get("name", "")).strip()
                            if new_name:
                                result.append(new_name)
                    print(f"[AGG INFER] no agg but has inserted, returning {len(result)} columns: {result}")
                    return result
                print(f"[AGG INFER] returning parts: {parts}")
                return parts
            if upstream_cols and upstream_cols[0] is not None:
                return list(upstream_cols[0])
            return None

        if canonical == "column_select":
            selected: List[Any] = config.get("selectedColumns", []) or []
            out: List[str] = []
            for sc in selected:
                to = str(sc.get("to", sc.get("from", "")) or "").strip()
                if to:
                    out.append(to)
            return out if out else None

        if canonical == "transpose":
            # 优先从 node.sql 解析 AS 别名，这是实际执行的真实列名
            node_sql: str = config.get("sql", "") or ""
            if node_sql:
                aliases_from_sql = PipelineEngine._extract_sql_aliases(node_sql)
                if aliases_from_sql:
                    return aliases_from_sql

            index_columns: List[str] = config.get("indexColumns", []) or []
            pivot_column: str = config.get("pivotColumn", "")
            pivot_values: List[str] = config.get("pivotValues", []) or []
            value_columns: List[Any] = config.get("valueColumns", []) or []
            out: List[str] = list(index_columns)
            for vc in value_columns:
                col_name = str(vc.get("column", "") or "").strip()
                agg = str(vc.get("aggMethod", "MAX") or "MAX").lower()
                for pv in pivot_values:
                    safe_pv = str(pv).replace(" ", "_").replace("-", "_")
                    out.append(f"{agg}_{col_name}_{safe_pv}")
            return out if out else None

        if canonical == "deduplicate":
            dedup_columns: List[str] = config.get("dedupColumns", []) or []
            print(f"[DEDUP INFER] dedupColumns={dedup_columns}, upstream_cols={upstream_cols}")
            # 去重后输出列与上游相同
            if upstream_cols and upstream_cols[0] is not None:
                result = list(upstream_cols[0])
                print(f"[DEDUP INFER] returning {len(result)} columns: {result}")
                return result
            print(f"[DEDUP INFER] upstream_cols is None, returning None")
            return None

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
                # 两侧均可推断：同名非 ON 列加递增后缀（_b, _c, _d...）
                # 与 _join_preview_allowed_sql_columns 和 _join_explicit_select_list 保持一致
                on_right_cols: List[str] = []
                for k in config.get("joinKeys", []) or []:
                    if rc := str(k.get("rightCol", "") or "").strip():
                        on_right_cols.append(rc)
                on_set = set(on_right_cols)
                left_set = set(left_cols)
                out: List[str] = list(left_cols)
                for c in right_cols:
                    if c in on_set:
                        continue  # ON 列不添加（左表对应列已在结果中）
                    if c not in left_set:
                        out.append(c)  # 右表独有的列
                    else:
                        # 同名列：计算递增后缀
                        base = c
                        max_suffix = 0
                        suffix_pattern = re.compile(rf"^{re.escape(base)}(?:_([a-z]))?$")
                        for lc in left_cols:
                            m = suffix_pattern.match(lc)
                            if m:
                                suf = m.group(1)
                                if suf is None:
                                    max_suffix = max(max_suffix, 0)
                                else:
                                    val = ord(suf) - ord('a') + 1
                                    max_suffix = max(max_suffix, val)
                        next_suffix = chr(ord('a') + max_suffix)
                        out.append(f"{c}_{next_suffix}")
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
        all_available_columns: Optional[List[str]] = None,
    ) -> Optional[str]:
        """根据方法生成单个列的 SQL 表达式

        Args:
            method: 方法名
            source_column: 源列名
            method_config: 方法配置
            all_available_columns: 当前作用域内所有可用的列名（用于自动包裹表达式中的列名）
        """
        if method == "calculation":
            expression = method_config.get("expression", "")
            if expression:
                return PipelineEngine._build_calculation_expr(
                    source_column, method_config, all_available_columns
                )
            else:
                return PipelineEngine._build_calculation_expr(
                    PipelineEngine._safe_identifier(source_column), method_config, all_available_columns
                )
        safe_source = PipelineEngine._safe_identifier(source_column)
        if method == "split":
            return PipelineEngine._build_split_expr(safe_source, method_config)
        if method == "function":
            return PipelineEngine._build_function_expr(safe_source, method_config, all_available_columns)
        if method == "lookup":
            return PipelineEngine._build_lookup_expr(safe_source, method_config)
        if method == "rank":
            return PipelineEngine._build_rank_expr(safe_source, method_config)
        if method == "category":
            return PipelineEngine._build_category_expr(safe_source, method_config)
        if method == "bin":
            return PipelineEngine._build_bin_expr(safe_source, method_config)
        return "NULL"

    @staticmethod
    def _build_calculation_expr(
        source_column: str,
        config: Dict[str, Any],
        all_available_columns: Optional[List[str]] = None,
    ) -> Optional[str]:
        """
        计算列表达式
        config.expression: 计算表达式，如 "A + B" 或 "(A + B) * 1.1"
        空表达式返回 NULL 占位，保证列结构稳定

        all_available_columns: 当前作用域内所有可用的列名（上游原有列 + 前面已生成的 insertedColumns）
        用于自动将表达式中的列名用反引号包裹，使 MySQL 能识别中文列名和别名引用。
        """
        expression = config.get("expression", "")
        if not expression:
            return "NULL"

        # 如果有可用列名，将表达式中匹配到的列名用反引号包裹
        # 避免：1) 中文列名需要反引号  2) 引用前面生成的列别名（如 count_评价文本_1）
        if all_available_columns:
            expr = expression
            # 按列名长度降序排列，优先匹配长列名，避免短列名先被替换导致长列名无法匹配
            # 例如："count_评价文本_1" 和 "评价文本" → 先匹配长的
            for col in sorted(all_available_columns, key=len, reverse=True):
                # 避免重复包裹（如果已经是反引号包裹的，跳过）
                if col.startswith("`"):
                    continue
                # 精确替换列名（作为完整单词，避免部分匹配，如 "总计" 匹配到 "总"）
                # 使用正则 \b 匹配单词边界
                escaped = re.escape(col)
                expr = re.sub(r'(?<![`"\'])(' + escaped + r')(?![`"\'])', r'`\1`', expr)
            return expr
        else:
            # all_available_columns 为空时，匹配表达式中所有标识符（包括中文列名）并加反引号
            expr = re.sub(r'([\w\u4e00-\u9fff]+)', r'`\1`', expression)
            return expr

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
    def _build_function_expr(
        source_column: str,
        config: Dict[str, Any],
        all_available_columns: Optional[List[str]] = None,
    ) -> Optional[str]:
        """
        函数表达式
        支持两种模式：
        1. 结构化配置: function_name + arguments（保留旧逻辑）
        2. 自由表达式: expression（直接透传到 SQL，列名用 `` 包裹，自动处理中文别名）

        all_available_columns: 当前作用域内所有可用的列名，用于自动包裹表达式中的列名。
        """
        expression = config.get("expression", "").strip()
        function_name = config.get("function_name", "").upper()
        arguments: List[Any] = config.get("arguments", [])

        # 优先使用自由表达式
        if expression:
            safe_source = PipelineEngine._safe_identifier(source_column)
            safe_expr = expression.strip()
            # 将占位符 `` 替换为源列引用
            if safe_source:
                safe_expr = safe_expr.replace("``", safe_source)
            # 自动包裹表达式中的列名（支持中文列名和前面生成的别名引用）
            if all_available_columns:
                for col in sorted(all_available_columns, key=len, reverse=True):
                    if col.startswith("`"):
                        continue
                    escaped = re.escape(col)
                    safe_expr = re.sub(r'(?<![`"\'])(' + escaped + r')(?![`"\'])', r'`\1`', safe_expr)
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
            inserted_cols: List[Dict[str, Any]] = config.get("insertedColumns", []) or []
            if upstream_refs:
                ref, _ = upstream_refs[0]
                agg_parts: List[str] = []
                for a in raw_aggs:
                    if isinstance(a, dict):
                        frag = PipelineEngine._aggregation_sql_fragment(a)
                        if frag:
                            agg_parts.append(frag)
                
                # 情况1: 有聚合配置 - 正常处理，同时附加 insertedColumns
                if agg_parts:
                    gb = [str(c).strip() for c in group_by if str(c).strip()]
                    select_parts = [
                        *[PipelineEngine._safe_identifier(c) for c in gb],
                        *agg_parts,
                    ]
                    # 构建 all_available_columns：上游列（从 ref 提取） + 聚合列别名
                    gb_cols = list(gb)
                    agg_aliases: List[str] = []
                    for a in raw_aggs:
                        if isinstance(a, dict):
                            alias = str(a.get("alias", "") or a.get("column", "")).strip()
                            if alias:
                                agg_aliases.append(alias)
                    all_avail: List[str] = list(gb_cols)
                    all_avail.extend(agg_aliases)
                    # 如果还有 insertedCols，也附加到聚合输出的末尾（INSERTED 列可引用聚合别名）
                    if inserted_cols:
                        for col_config in inserted_cols:
                            if not isinstance(col_config, dict):
                                continue
                            method = str(col_config.get("method", "")).strip().lower()
                            source_column = str(col_config.get("sourceColumn", "")).strip()
                            new_name = str(col_config.get("name", "")).strip()
                            method_config = col_config.get("config", {})
                            if not new_name:
                                continue
                            expr = PipelineEngine._build_single_inserted_column_expr(
                                method, source_column, method_config, all_avail
                            )
                            if expr:
                                select_parts.append(f"{expr} AS {PipelineEngine._safe_identifier(new_name)}")
                                all_avail.append(new_name)
                    group_str = ""
                    if gb:
                        group_str = f" GROUP BY {', '.join(PipelineEngine._safe_identifier(c) for c in gb)}"
                    return f"SELECT {', '.join(select_parts)} FROM ({ref}) AS t{group_str}{_limit_clause}", []

                # 情况2: 无聚合但有 insertedColumns - 使用 insertedColumns 生成列
                if inserted_cols:
                    # 生成 insertedColumns 的列表达式
                    new_cols: List[str] = []
                    # 从 ref 提取上游列名
                    upstream_cols: List[str] = []
                    if ref:
                        cols_match = re.match(r"^SELECT\s+(.*?)\s+FROM\s+", ref, re.IGNORECASE | re.DOTALL)
                        if cols_match:
                            col_str = cols_match.group(1).strip()
                            if col_str != "*":
                                upstream_cols = [c.strip() for c in col_str.split(",")]
                    all_avail: List[str] = list(upstream_cols)
                    for col_config in inserted_cols:
                        if not isinstance(col_config, dict):
                            continue
                        method = str(col_config.get("method", "")).strip().lower()
                        source_column = str(col_config.get("sourceColumn", "")).strip()
                        new_name = str(col_config.get("name", "")).strip()
                        method_config = col_config.get("config", {})
                        if not new_name:
                            continue
                        expr = PipelineEngine._build_single_inserted_column_expr(
                            method, source_column, method_config, all_avail
                        )
                        if expr:
                            new_cols.append(f"{expr} AS {PipelineEngine._safe_identifier(new_name)}")
                            all_avail.append(new_name)

                    if new_cols:
                        # 生成 SELECT * + 新列
                        cols_str = ", ".join(new_cols)
                        return f"SELECT *, {cols_str} FROM ({ref}) AS t{_limit_clause}", []

                # 情况3: 既无聚合也无 insertedColumns - 返回上游结果
                return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []

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

        if node_type == "transpose":
            index_columns = config.get("indexColumns", [])
            pivot_column = config.get("pivotColumn", "")
            pivot_values = config.get("pivotValues", [])
            value_columns = config.get("valueColumns", [])
            if upstream_refs:
                ref, _ = upstream_refs[0]
                if not index_columns or not pivot_column or not pivot_values or not value_columns:
                    return f"SELECT * FROM ({ref}) AS t{_limit_clause}", []
                index_sql = ", ".join(PipelineEngine._safe_identifier(c) for c in index_columns)
                case_parts: List[str] = []
                for vc in value_columns:
                    col = PipelineEngine._safe_identifier(vc.get("column", ""))
                    agg = vc.get("aggMethod", "MAX")
                    for pv in pivot_values:
                        safe_pv = str(pv).replace("'", "''")
                        safe_pv_col = safe_pv.replace(" ", "_").replace("-", "_")
                        col_name = vc.get("column", "")
                        alias = f"{agg.lower()}_{col_name}_{safe_pv_col}"
                        alias_sql = PipelineEngine._safe_identifier(alias)
                        case_parts.append(
                            f"{agg}(CASE WHEN {PipelineEngine._safe_identifier(pivot_column)} = '{safe_pv}' THEN {col} END) AS {alias_sql}"
                        )
                select_sql = f"{index_sql}, {', '.join(case_parts)}"
                return f"SELECT {select_sql} FROM ({ref}) AS t GROUP BY {index_sql}{_limit_clause}", []

        if node_type == "deduplicate":
            dedup_columns = config.get("dedupColumns", []) or []
            keep_mode = config.get("keepMode", "first")
            logger.info(f"[DEDUP] node_type=deduplicate, dedupColumns={dedup_columns}, keepMode={keep_mode}")
            if upstream_refs:
                ref, _ = upstream_refs[0]
                if not dedup_columns:
                    # 无指定列时返回 DISTINCT
                    return f"SELECT DISTINCT * FROM ({ref}) AS t{_limit_clause}", []
                # 使用 ROW_NUMBER 实现去重
                part_cols = ", ".join(PipelineEngine._safe_identifier(c) for c in dedup_columns)
                # MySQL 8.0+ 不支持 ORDER BY 位置指示(ORDER BY 1)，使用第一个去重列保持稳定排序
                order_col = PipelineEngine._safe_identifier(dedup_columns[0])
                logger.info(f"[DEDUP] Using PARTITION BY {part_cols} ORDER BY {order_col}")
                if keep_mode == "last":
                    # 留末条：逆序排序
                    dedup_sql = (
                        f"SELECT * FROM ("
                        f"SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY {order_col} DESC) AS _rn "
                        f"FROM ({ref}) AS t"
                        f") AS _dedup WHERE _rn = 1"
                    )
                else:
                    # 留首条（默认）
                    dedup_sql = (
                        f"SELECT * FROM ("
                        f"SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY {order_col}) AS _rn "
                        f"FROM ({ref}) AS t"
                        f") AS _dedup WHERE _rn = 1"
                    )
                return f"{dedup_sql}{_limit_clause}", []

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
            logger.debug(f"[CHAINED] node={nid}, type={ntype}, upstream_cols={upstream_cols}")
            
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
            
            # 处理没有 SQL 但有 insertedColumns 的节点
            if not node.get("sql") and nconfig.get("insertedColumns"):
                # 构建上游 refs（用于 insertedColumns 生成 SQL）
                upstream_refs_for_ic: List[str] = []
                for i, u in enumerate(valid_ups):
                    if u in node_columns and node_columns[u] is not None:
                        cols = node_columns[u]
                        safe_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in cols)
                        upstream_refs_for_ic.append(f"(SELECT {safe_cols} FROM ({node_sqls[u]}) AS _up{i}) AS _upi{i}")
                    else:
                        upstream_refs_for_ic.append(f"(SELECT * FROM ({node_sqls[u]}) AS _up{i}) AS _upi{i}")
                
                core_sql = PipelineEngine._build_sql_from_inserted_columns(
                    upstream_refs_for_ic, nconfig, node_type=ntype
                )
            else:
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
                    logger.debug(f"[JOIN EXPAND] join_type={join_type}, on_right_cols={on_right_cols}, upstream_cols[0]={upstream_cols[0]}, upstream_cols[1]={upstream_cols[1]}")
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

            # 输出节点：当没有 outputColumnKeys 时，应该使用上游节点的输出列来投影
            # 避免 SELECT * 返回过多列，导致预览和预期不一致
            output_keys: List[str] = nconfig.get("outputColumnKeys", []) or []
            if canonical == "output" and not output_keys and upstream_cols and upstream_cols[0] is not None:
                output_keys = list(upstream_cols[0])
            
            # JOIN：跳过列投影，直接保留内层展开的所有列
            # 因为 _expand_join_select_for_preview 已经将 SELECT * 展开为显式列列表
            # aggregate 节点：build_node_sql 已经生成了完整 SQL（包含 insertedColumns），
            #   _apply_column_projection 不应再处理 insertedColumns（会重复）
            # 输出节点：需要应用列投影来限制输出列数
            effective_output_keys = list(output_keys) if output_keys else []
            if canonical == "output" and effective_output_keys:
                # 导出节点使用上游列进行投影
                output_proj_cfg = dict(nconfig) if isinstance(nconfig, dict) else {}
                output_proj_cfg["outputColumnKeys"] = effective_output_keys
                wrapped_sql = PipelineEngine._apply_column_projection(
                    wrapped_sql, output_proj_cfg, allowed_proj, is_last_layer=True
                )
            elif not skip_proj:
                if canonical == "aggregate":
                    # aggregate：build_node_sql 已处理 insertedColumns，跳过 insertedColumns 处理
                    # 仅用 outputColumnKeys 过滤输出列（不传 insertedColumns）
                    proj_cfg = {k: v for k, v in nconfig.items()} if isinstance(nconfig, dict) else {}
                    proj_cfg.pop("insertedColumns", None)
                    wrapped_sql = PipelineEngine._apply_column_projection(
                        wrapped_sql, proj_cfg, allowed_proj, is_last_layer=True
                    )
                else:
                    wrapped_sql = PipelineEngine._apply_column_projection(
                        wrapped_sql, nconfig, allowed_proj, is_last_layer=True
                    )

            # 推断当前节点的输出列（用于下游 JOIN 展开）
            rename_nm: Dict[str, str] = dict(nconfig.get("renameMap") or {})
            print(f"[BUILD SQL] node={nid}, type={ntype}, joinType={nconfig.get('joinType')}, output_keys={output_keys}, upstream_cols={upstream_cols}, allowed_proj={allowed_proj}")
            
            # JOIN 节点：当无 outputColumnKeys 时，直接用 allowed_proj 作为输出列
            # allowed_proj 已经包含了 _b 后缀的列（如 avg_星级_b），比静态推断更准确
            if output_keys:
                if allowed_proj is not None:
                    # 检查列名或其带后缀版本(_b, _c...)是否在 allowed_proj 中
                    import re
                    def _col_in_allowed(col: str) -> bool:
                        original = str(rename_nm.get(col, col)).strip()
                        if original in allowed_proj:
                            return True
                        pattern = rf"^{re.escape(original)}(?:_[a-z])?$"
                        for allowed in allowed_proj:
                            if re.match(pattern, allowed):
                                return True
                        return False
                    
                    eff = [col for col in output_keys if _col_in_allowed(col)]
                    node_columns[nid] = eff if eff else PipelineEngine._preview_infer_output_columns(
                        ntype, nconfig, upstream_cols, nmerge_type
                    )
                elif canonical == "join" and len(upstream_cols) >= 2 and upstream_cols[0] is None and upstream_cols[1] is None:
                    # 两侧均不可推断时设为 None，避免下游引用无效列名（如 sum_级星_b）
                    node_columns[nid] = None
                else:
                    node_columns[nid] = list(output_keys)
            else:
                # 无 outputColumnKeys 时：JOIN 节点用 allowed_proj（包含 _b 后缀），其他用静态推断
                if canonical == "join" and allowed_proj is not None:
                    # 将 allowed_proj 转为有序列表，保持一致性
                    # allowed_proj 已经是完整的展开后列名集合（包含 _b 后缀）
                    node_columns[nid] = sorted(allowed_proj, key=lambda x: x)
                else:
                    inferred = PipelineEngine._preview_infer_output_columns(
                        ntype, nconfig, upstream_cols, nmerge_type
                    )
                    node_columns[nid] = inferred

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
                    # 当 focus_node 配置了 outputColumnKeys 时，查询全列以便列选择器展示
                    # 或者当 outputColumnKeys 为空（未限制列，全选模式）时，也需要查询全列
                    if isinstance(out_keys, list):
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
                            print(f"[ALL COLS SQL] sql_full: {sql_full[:500]}")
                            try:
                                r_meta = await conn.execute(text(sql_full))
                                all_columns = (
                                    list(r_meta.keys())
                                    if hasattr(r_meta, "keys") and r_meta.keys()
                                    else []
                                )
                                print(f"[ALL COLS] all_columns: {all_columns}")
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

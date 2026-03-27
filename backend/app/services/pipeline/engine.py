# backend/app/services/pipeline/engine.py
"""Pipeline 执行引擎 (PipelineEngine)

分步执行 SQL 逻辑的引擎。
核心特点：
1. 不生成巨大的 CTE，而是分步执行
2. 每步结果写入临时表
3. 支持前端点击节点预览数据

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
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession, AsyncEngine
from sqlalchemy import text, update

from app.models.pipeline import DataPipeline, PipelineExecution
from app.services.pipeline.temp_table_manager import TempTableManager

logger = logging.getLogger(__name__)


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

            # 创建临时表管理器
            async with self.data_source_engine.connect() as conn:
                self.temp_manager = TempTableManager(conn, execution.id)
                await self.temp_manager.create_temp_table()

                # 执行执行前清理（如果有）
                await self._cleanup_old_executions(pipeline.id)

                # 更新执行状态为 running
                await self._update_execution_status(
                    execution.id,
                    "running",
                    temp_table_name=self.temp_manager.temp_table_name,
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

                for node in sorted_nodes:
                    node_id = node.get("id") or f"node_{step_idx}"
                    step_id = f"step_{step_idx}"
                    node_name = node.get("name", f"步骤 {step_idx+1}")
                    node_sql = node.get("sql", "")
                    upstream = node.get("upstream")

                    logs.append({
                        "time": datetime.utcnow().isoformat(),
                        "message": f"开始执行节点: {node_name} ({step_id})"
                    })

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

                        # 构建实际执行的 SQL
                        actual_sql = self._build_step_sql(
                            node_sql,
                            upstream_step_ids,
                            self.temp_manager.temp_table_name
                        )

                        # 验证 SQL 安全性
                        if not self._validate_sql(actual_sql):
                            raise ValueError("SQL 语句包含不允许的操作")

                        # 执行查询
                        query_result = await conn.execute(text(actual_sql))
                        rows = query_result.fetchall()
                        columns = list(query_result.keys()) if query_result.keys() else []

                        # 转换为字典列表
                        data = []
                        for row in rows:
                            item = dict(zip(columns, row))
                            # JSON 序列化友好：date/datetime 统一转 ISO 字符串
                            for k, v in list(item.items()):
                                if isinstance(v, (datetime, type(None).__class__)):
                                    if hasattr(v, 'isoformat'):
                                        item[k] = v.isoformat()
                            data.append(item)

                        # 写入临时表
                        row_count = await self.temp_manager.insert_step_data(step_id, data)

                        # 更新 node_id -> step_id 映射
                        node_step_map[node_id] = step_id

                        # 记录完成
                        completed_steps.append({
                            "step_id": step_id,
                            "node_id": node_id,
                            "node_name": node_name,
                            "row_count": row_count,
                            "columns": columns,
                            "executed_at": datetime.utcnow().isoformat()
                        })

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

                        # 更新执行状态为失败
                        await self._update_execution_status(
                            execution.id,
                            "failed",
                            error_message=str(step_error),
                            completed_at=datetime.utcnow(),
                            execution_time_ms=int((time.time() - start_time) * 1000),
                            completed_steps=completed_steps,
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
                    logs=logs
                )

                logs.append({
                    "time": datetime.utcnow().isoformat(),
                    "message": f"管道执行完成，总行数: {total_rows}，耗时: {execution_time_ms}ms"
                })

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
        temp_table_name: str
    ) -> str:
        """
        构建实际执行的 SQL

        占位符替换规则：
        - {prev_table}: 替换为第一个上游节点的临时表子查询
        - {upstream_table_0}, {upstream_table_1}, ...: 按索引引用上游临时表
        - {upstream_table_<step_id>}: 按 step_id 引用上游临时表
        - {prev_step_id}: 替换为第一个上游的 step_id

        Args:
            step_sql: 节点配置的 SQL
            upstream_step_ids: 上游节点的 step_id 列表
            temp_table_name: 临时表名

        Returns:
            实际执行的 SQL
        """
        if not step_sql:
            return ""

        sql = step_sql.strip()

        # 如果没有上游节点（source 节点），直接执行
        if not upstream_step_ids:
            return sql

        # 构建各上游的临时表引用
        upstream_refs: List[str] = []
        for i, sid in enumerate(upstream_step_ids):
            upstream_refs.append(f"(SELECT data_json FROM {temp_table_name} WHERE step_id = '{sid}')")

        # 按索引替换 {upstream_table_0}, {upstream_table_1}, ...
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

        # 如果没有占位符，假设 SQL 是完整的 SELECT
        if "{" not in sql:
            first_ref = upstream_refs[0]
            if sql.strip().upper().startswith("SELECT"):
                sql = f"SELECT * FROM ({sql}) AS prev_data"
            else:
                sql = f"SELECT * FROM ({sql}) AS prev_data"

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
            col = PipelineEngine._safe_identifier(str(cond.get("column", "")))
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
                clauses.append(f"{col} IN ({items})")
        if not clauses:
            return ""
        sep = f" {logic} "
        return f" WHERE {sep.join(clauses)}"

    @staticmethod
    def build_node_sql(
        node_type: str,
        config: Dict[str, Any],
        upstream_refs: Optional[List[Tuple[str, str]]] = None,
        # upstream_refs: List[Tuple[table_or_sql, alias]] for multi-input nodes
    ) -> Tuple[str, List[str]]:
        """
        根据节点类型和可视化配置生成 SELECT SQL。

        Returns:
            (sql, list_of_column_names)
        """
        table_name = config.get("tableName", "")
        limit = 100

        if node_type == "source":
            tbl = PipelineEngine._safe_identifier(table_name) if table_name else "unknown_table"
            return f"SELECT * FROM {tbl} LIMIT {limit}", []

        if node_type == "filter":
            conditions = config.get("conditions", [])
            logic = config.get("logic", "AND")
            if upstream_refs:
                ref, alias = upstream_refs[0]
                where = PipelineEngine._build_filter_sql(ref, conditions, logic)
                return f"SELECT * FROM ({ref}) AS t{where} LIMIT {limit}", []
            return "", []

        if node_type == "aggregate":
            group_by = config.get("groupBy", [])
            aggregations = config.get("aggregations", [])
            if upstream_refs:
                ref, _ = upstream_refs[0]
                if not aggregations:
                    return f"SELECT * FROM ({ref}) AS t LIMIT {limit}", []
                def _agg_alias(agg):
                    fn = agg.get("func", "count")
                    col = agg.get("column", "x")
                    alias = agg.get("alias", f"{fn}_{col}")
                    return f"{fn.upper()}({PipelineEngine._safe_identifier(col)}) AS {PipelineEngine._safe_identifier(alias)}"

                select_parts = [
                    *[PipelineEngine._safe_identifier(c) for c in group_by],
                    *[_agg_alias(agg) for agg in aggregations],
                ]
                group_str = ""
                if group_by:
                    group_str = f" GROUP BY {', '.join(PipelineEngine._safe_identifier(c) for c in group_by)}"
                return f"SELECT {', '.join(select_parts)} FROM ({ref}) AS t{group_str} LIMIT {limit}", []

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
                        f"SELECT * FROM ({left_ref}) AS a {jt_sql} ({right_ref}) AS b ON {on_clause} LIMIT {limit}",
                        [],
                    )
                return f"SELECT * FROM ({left_ref}) AS a {jt_sql} ({right_ref}) AS b ON 1=0 LIMIT {limit}", []
            return "", []

        if node_type == "column_select":
            selected = config.get("selectedColumns", [])
            if upstream_refs:
                ref, _ = upstream_refs[0]
                if not selected:
                    return f"SELECT * FROM ({ref}) AS t LIMIT {limit}", []
                cols = [
                    (
                        f"{PipelineEngine._safe_identifier(sc.get('from', ''))} AS {PipelineEngine._safe_identifier(sc.get('to', sc.get('from', '')))}"
                        if sc.get("from") != sc.get("to")
                        else PipelineEngine._safe_identifier(sc.get("from", ""))
                    )
                    for sc in selected
                    if sc.get("from")
                ]
                return f"SELECT {', '.join(cols)} FROM ({ref}) AS t LIMIT {limit}", []

        if node_type == "output":
            # Output 节点预览上游数据
            if upstream_refs:
                ref, _ = upstream_refs[0]
                return f"SELECT * FROM ({ref}) AS t LIMIT {limit}", []

        return "", []

    async def preview_node(
        self,
        node_type: str,
        config: Dict[str, Any],
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        对单个节点执行实时预览（不保存到临时表）。

        Args:
            node_type: 节点类型
            config: 节点可视化配置
            limit: 预览行数

        Returns:
            {"columns": [...], "column_types": [...], "rows": [...], "total": int,
             "has_more": bool, "sql_generated": str}
        """
        try:
            sql, _ = self.build_node_sql(node_type, config)
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
                col_types = []
                for col in columns:
                    col_types.append("string")

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

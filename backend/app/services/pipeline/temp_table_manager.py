# backend/app/services/pipeline/temp_table_manager.py
"""临时表管理器 (TempTableManager)

用于管理 Pipeline 执行过程中的临时表。
核心功能：
1. 创建带 step_id 和 data_json 的临时表（JSON 模式，用于预览）
2. 创建结构化临时表（列式存储，用于 INSERT...SELECT）
3. 通过 INSERT...SELECT 直接写入，不走 Python fetchmany
4. 查询指定 step 的数据用于预览
5. 自动清理

特点：
- 使用 MySQL TEMPORARY TABLE，会话级自动清理，零污染
- 支持两种存储模式：JSON（预览兼容）和列式（性能优先）
"""
import json
import logging
import re
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy import text

logger = logging.getLogger(__name__)

# MySQL 类型推断：Python 类型 -> MySQL 类型
_TYPE_MAP: Dict[str, str] = {
    "bool":       "TINYINT(1)",
    "int":        "BIGINT",
    "float":      "DOUBLE",
    "str":        "TEXT",
    "datetime":   "DATETIME(3)",
    "date":       "DATE",
    "list":       "JSON",
    "dict":       "JSON",
}


def _infer_mysql_type(value: Any) -> str:
    """从 Python 值推断 MySQL 列类型"""
    if value is None:
        return "TEXT"
    t = type(value).__name__
    return _TYPE_MAP.get(t, "TEXT")


def _validate_step_id(step_id: str) -> str:
    """
    验证并返回安全的 step_id。
    只允许字母、数字、下划线。
    """
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', step_id):
        raise ValueError(f"Invalid step_id: {step_id}")
    return step_id


def _validate_identifier(identifier: str) -> str:
    """
    验证并返回安全的 SQL 标识符。
    支持字母、数字、下划线、中文等 Unicode 字符。
    """
    if not identifier:
        raise ValueError(f"Invalid SQL identifier: empty")
    # 支持 Unicode 字母（包括中文）+ 数字 + 下划线
    if not re.match(r'^[\w\u4e00-\u9fff][\w\u4e00-\u9fff0-9]*$', identifier, re.UNICODE):
        raise ValueError(f"Invalid SQL identifier: {identifier}")
    return identifier


def _serialize_value(value: Any) -> str:
    """将 Python 值序列化为 MySQL 兼容的 SQL 字面量"""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        return f"'{value.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}'"
    if isinstance(value, date):
        return f"'{value.isoformat()}'"
    s = json.dumps(value, ensure_ascii=False, default=str)
    escaped = s.replace("'", "\\'")
    return f"'{escaped}'"


# 格式 -> (MySQL 类型, CAST 表达式模板)
_FORMAT_TYPE_MAP: Dict[str, Tuple[str, str]] = {
    "date":      ("DATE",           "CAST(`{col}` AS DATE)"),
    "datetime":  ("DATETIME(3)",    "CAST(`{col}` AS DATETIME(3))"),
    "number":    ("DECIMAL(20,4)",  "CAST(`{col}` AS DECIMAL(20,4))"),
    "percent":   ("DECIMAL(20,4)",  "(`{col}` * 100)"),
    "string":    ("TEXT",           "CAST(`{col}` AS CHAR)"),
}


def _build_cast_expression(col: str, format: str) -> Tuple[str, str]:
    """
    根据格式生成 CAST 表达式和 MySQL 列类型。

    Returns:
        (cast_expr, mysql_type)
    """
    # 验证列名防止 SQL 注入
    safe_col = _validate_identifier(col)
    entry = _FORMAT_TYPE_MAP.get(format)
    if entry:
        mysql_type, expr_template = entry
        return expr_template.format(col=safe_col), mysql_type
    # 自动格式不做转换，使用原列
    return f"`{safe_col}`", "TEXT"


class TempTableManager:
    """
    临时表管理器

    功能：
    1. 创建临时表（JSON 模式和列式模式）
    2. 通过 INSERT...SELECT 直接写入（列式模式）
    3. 分批写入数据（JSON 模式，用于预览兼容）
    4. 查询指定 step 的数据用于预览
    5. 自动清理
    """

    def __init__(self, connection: AsyncConnection, exec_id: int):
        """
        初始化临时表管理器

        Args:
            connection: SQLAlchemy 异步数据库连接（必须使用同一数据源）
            exec_id: 执行记录 ID，用于生成临时表名
        """
        self.connection = connection
        self.exec_id = exec_id
        self._json_table_name = f"tmp_pipeline_{exec_id}_json"
        self._json_created = False
        # 列式表：step_id -> (table_name, columns)，持久表跨连接可访问
        self._struct_tables: Dict[str, Tuple[str, List[str]]] = {}

    def _safe_table_name(self, name: str) -> str:
        """
        验证并包裹表名，只允许 tmp_pipeline_ / pipeline_json_ 前缀的合法表名。
        防止 SQL 注入攻击。
        """
        if not name:
            raise ValueError("表名不能为空")
        # 白名单: 只允许项目约定前缀的表名
        safe_pattern = r'^(tmp_pipeline_\d+_\d+|tmp_pipeline_\d+_json|pipeline_json_\d+)$'
        if not re.match(safe_pattern, name):
            raise ValueError(f"非法表名: {name}")
        # 用反引号包裹，内部转义反引号
        return f"`{name.replace('`', '``')}`"

    @property
    def json_table_name(self) -> str:
        return self._json_table_name

    async def rebuild_struct_index(self):
        """
        从数据库元数据重建列式表索引（pipeline_service.py 新建 Manager 时调用）。

        持久表命名：tmp_pipeline_{exec_id}_<idx>，扫描 information_schema.tables 还原映射。
        """
        try:
            result = await self.connection.execute(text("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                AND table_name LIKE :pattern
                AND table_name NOT LIKE :json_pattern
            """), {"pattern": f"tmp_pipeline_{self.exec_id}_%", "json_pattern": f"%_json"})
            rows = result.fetchall()
            for row in rows:
                tbl = row[0]
                # step 编号 -> step_0, step_1, ...
                suffix = tbl.split("_")[-1]
                if suffix.isdigit():
                    step_id = f"step_{suffix}"
                else:
                    continue
                # 读取列名
                col_result = await self.connection.execute(text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                    AND table_name = :tbl
                    ORDER BY ordinal_position
                """), {"tbl": tbl})
                cols = [r[0] for r in col_result.fetchall()]
                if cols:
                    self._struct_tables[step_id] = (tbl, cols)
                    logger.info(f"重建列式表索引: {step_id} -> {tbl} ({len(cols)} 列)")
        except Exception as e:
            logger.warning(f"重建列式表索引失败: {e}")

    async def create_json_temp_table(self) -> str:
        """
        创建 JSON 模式临时表（仅用于预览，不存真实数据）

        表结构：step_id + row_index + data_json（兼容旧逻辑）
        """
        if self._json_created:
            return self._json_table_name

        create_sql = f"""
        CREATE TABLE IF NOT EXISTS {self._safe_table_name(self._json_table_name)} (
            step_id VARCHAR(50) NOT NULL,
            row_index INT NOT NULL,
            data_json JSON NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_step_id (step_id),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
        try:
            await self.connection.execute(text(create_sql))
            await self.connection.commit()
            self._json_created = True
            logger.info(f"创建 JSON 临时表: {self._json_table_name}")
            return self._json_table_name
        except Exception as e:
            logger.error(f"创建 JSON 临时表失败: {e}")
            raise

    async def insert_step_data(
        self,
        step_id: str,
        data: List[Dict[str, Any]],
        batch_size: int = 1000
    ) -> int:
        """
        将 step 结果写入 JSON 临时表（兼容旧调用，用于预览数据）

        Args:
            step_id: 步骤标识
            data: 行数据列表
            batch_size: 每批写入的行数

        Returns:
            写入的行数
        """
        # 验证 step_id 防止 SQL 注入
        safe_step_id = _validate_step_id(step_id)

        if not data:
            logger.info(f"步骤 {safe_step_id} 无数据，跳过写入")
            return 0

        if not self._json_created:
            await self.create_json_temp_table()

        total_inserted = 0
        row_index = 0

        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            values_list = []

            for row in batch:
                data_json = json.dumps(row, ensure_ascii=False, default=str)
                escaped_json = data_json.replace("'", "\\'")
                values_list.append(f"({row_index}, '{escaped_json}')")
                row_index += 1

            # 使用参数化查询防止 SQL 注入
            placeholders = ", ".join(f"(:step_id, {idx}, :data{idx})" for idx in range(len(values_list)))
            insert_sql = f"""
            INSERT INTO {self._safe_table_name(self._json_table_name)} (step_id, row_index, data_json)
            VALUES {placeholders}
            """
            # 构建参数字典
            params = {"step_id": safe_step_id}
            for idx in range(len(values_list)):
                params[f"data{idx}"] = values_list[idx].split(", ", 1)[1]  # 去掉 row_index 部分
            # 简化：直接用 VALUES 列表，但 step_id 用参数
            values_sql = ", ".join(f"(:step_id, {i}, :data{i})" for i in range(len(batch)))
            insert_sql = f"""
            INSERT INTO {self._safe_table_name(self._json_table_name)} (step_id, row_index, data_json)
            VALUES {values_sql}
            """
            batch_params = {"step_id": safe_step_id}
            for i, row in enumerate(batch):
                batch_params[f"data{i}"] = json.dumps(row, ensure_ascii=False, default=str).replace("'", "\\'")
            try:
                await self.connection.execute(text(insert_sql), batch_params)
                total_inserted += len(batch)
            except Exception as e:
                logger.error(f"插入数据失败 (step={safe_step_id}): {e}")
                raise

        await self.connection.commit()
        logger.info(f"步骤 {safe_step_id} 写入 {total_inserted} 行数据到 JSON 临时表")
        return total_inserted

    async def query_step_preview(
        self,
        step_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        查询指定 step 的数据用于预览（优先从列式表读，无则回退 JSON 表）

        Args:
            step_id: 步骤标识
            limit: 返回行数限制
            offset: 偏移量

        Returns:
            {"step_id": str, "columns": List[str], "rows": List[Dict], "total": int, "has_more": bool}
        """
        # 优先查列式临时表（直接从结构化列读取）
        if step_id in self._struct_tables:
            tbl_name, columns = self._struct_tables[step_id]
            try:
                # 查总数
                safe_tbl = self._safe_table_name(tbl_name)
                count_res = await self.connection.execute(
                    text(f"SELECT COUNT(*) FROM {safe_tbl}")
                )
                total = count_res.fetchone()[0]

                if total == 0:
                    return {"step_id": step_id, "columns": [], "rows": [], "total": 0, "has_more": False}

                # 查数据
                safe_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in columns)
                data_res = await self.connection.execute(
                    text(f"SELECT {safe_cols} FROM {safe_tbl} LIMIT :limit OFFSET :offset"),
                    {"limit": limit, "offset": offset}
                )
                rows = data_res.fetchall()
                parsed = [dict(zip(columns, r)) for r in rows]
                # datetime -> ISO
                for row in parsed:
                    for k, v in list(row.items()):
                        if hasattr(v, "isoformat"):
                            row[k] = v.isoformat()

                return {
                    "step_id": step_id,
                    "columns": columns,
                    "rows": parsed,
                    "total": total,
                    "has_more": (offset + limit) < total
                }
            except Exception as e:
                logger.warning(f"列式表预览失败，回退 JSON 表: {e}")

        # 回退 JSON 持久表（直接查 DB，不依赖 _json_created flag）
        try:
            json_exists = await self.connection.execute(text("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_name = :tname
            """), {"tname": self._json_table_name})
            json_exists_row = json_exists.fetchone()
            if not json_exists_row or json_exists_row[0] == 0:
                return {"step_id": step_id, "columns": [], "rows": [], "total": 0, "has_more": False}

            count_sql = f"SELECT COUNT(*) FROM {self._safe_table_name(self._json_table_name)} WHERE step_id = :step_id"
            count_result = await self.connection.execute(text(count_sql), {"step_id": step_id})
            count_row = count_result.fetchone()
            total = count_row[0] if count_row else 0

            if total == 0:
                return {"step_id": step_id, "columns": [], "rows": [], "total": 0, "has_more": False}

            query_sql = f"""
            SELECT data_json
            FROM {self._safe_table_name(self._json_table_name)}
            WHERE step_id = :step_id
            ORDER BY row_index
            LIMIT :limit OFFSET :offset
            """
            result = await self.connection.execute(
                text(query_sql),
                {"step_id": step_id, "limit": limit, "offset": offset}
            )
            rows = result.fetchall()

            parsed_rows = []
            columns_set = set()
            for row in rows:
                try:
                    data = json.loads(row[0])
                    parsed_rows.append(data)
                    if isinstance(data, dict):
                        columns_set.update(data.keys())
                except json.JSONDecodeError as e:
                    logger.warning(f"JSON 解析失败: {e}")
                    continue

            columns = list(columns_set)
            return {
                "step_id": step_id,
                "columns": columns,
                "rows": parsed_rows,
                "total": total,
                "has_more": (offset + limit) < total
            }
        except Exception as e:
            logger.error(f"预览失败: {e}")
            return {"step_id": step_id, "columns": [], "rows": [], "total": 0, "has_more": False, "error": str(e)}

    async def discover_schema_from_sql(
        self,
        sql: str,
        sample_rows: int = 5
    ) -> Tuple[List[str], List[str]]:
        """
        通过 LIMIT sample_rows 发现 SQL 结果的列名和类型

        Args:
            sql: 待执行的 SELECT 语句
            sample_rows: 采样行数

        Returns:
            (columns: List[col_name], col_types: List[ mysql_type ])
        """
        # 对于包含 UNION 的 SQL，不套 SELECT * FROM (...) AS _t，避免
        # "Every derived table must have its own alias" 错误（UNION 本身已含 derived tables）
        sql_stripped = sql.rstrip().rstrip(';')
        has_union = re.search(r'\bUNION\b', sql_stripped, re.IGNORECASE)
        if has_union:
            wrapped = f"{sql_stripped} LIMIT {sample_rows}"
        else:
            wrapped = f"SELECT * FROM ({sql_stripped}) AS _t LIMIT {sample_rows}"
        try:
            result = await self.connection.execute(text(wrapped))
            columns = list(result.keys()) if result.keys() else []
            col_types: List[str] = []
            rows = result.fetchall()
            for col_name in columns:
                sample = None
                for row in rows:
                    v = getattr(row, col_name, None)
                    if v is not None:
                        sample = v
                        break
                col_types.append(_infer_mysql_type(sample))
            logger.info(f"Schema 发现: {columns} -> {col_types}")
            return columns, col_types
        except Exception as e:
            logger.warning(f"Schema 发现失败: {e}，回退为 TEXT 列")
            # 回退时同样处理 UNION 情况
            if has_union:
                fallback_wrapped = f"{sql_stripped} LIMIT 1"
            else:
                fallback_wrapped = f"SELECT * FROM ({sql_stripped}) AS _t LIMIT 1"
            result = await self.connection.execute(text(fallback_wrapped))
            fallback_cols = list(result.keys()) if result.keys() else []
            return fallback_cols, ["TEXT"] * len(fallback_cols)

    async def insert_via_select(
        self,
        step_id: str,
        sql: str,
        sample_rows: int = 5,
        column_formats: Optional[Dict[str, str]] = None
    ) -> Tuple[int, List[str]]:
        """
        直接通过 INSERT...SELECT 写入列式临时表，不走 Python 逐行搬运。

        流程：
        1. 发现源 SQL 的 schema（列名 + MySQL 类型）
        2. 根据 column_formats 应用格式转换（CAST）
        3. 创建列式临时表（使用正确的类型）
        4. INSERT...SELECT 一次性写入
        5. 返回行数

        Args:
            step_id: 步骤标识（如 'step_0'）
            sql: SELECT 语句
            sample_rows: schema 发现采样行数
            column_formats: 列格式配置 {col_name: format_type}，format_type 为 'date'|'datetime'|'number'|'percent'|'string'

        Returns:
            (row_count, columns)
        """
        # Step 1: 发现 schema
        columns, col_types = await self.discover_schema_from_sql(sql, sample_rows)
        if not columns:
            logger.warning(f"步骤 {step_id} 无列信息，跳过写入")
            return 0, []

        # Step 2: 应用格式转换，确定最终列类型
        final_col_types: List[str] = []
        if column_formats:
            for col in columns:
                fmt = column_formats.get(col)
                if fmt:
                    _, mysql_type = _build_cast_expression(col, fmt)
                    final_col_types.append(mysql_type)
                else:
                    final_col_types.append(col_types[columns.index(col)] if columns.index(col) < len(col_types) else "TEXT")
        else:
            final_col_types = col_types

        # Step 3: 创建列式持久表（跨连接可访问）
        tbl_name = f"tmp_pipeline_{self.exec_id}_{step_id.replace('step_', '')}"
        col_defs = ", ".join(
            f"`{c.replace('`', '``')}` {ct}" for c, ct in zip(columns, final_col_types)
        )
        create_sql = f"""
        CREATE TABLE IF NOT EXISTS {self._safe_table_name(tbl_name)} (
            {col_defs}
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
        try:
            await self.connection.execute(text(create_sql))
            await self.connection.commit()
        except Exception as e:
            logger.error(f"创建列式表失败: {e}")
            raise

        # 立即注册，即使后续 INSERT...SELECT 失败也能被 cleanup_temp_table 清理
        self._struct_tables[step_id] = (tbl_name, columns)

        # Step 4: 构建带 CAST 的 SELECT 列表
        safe_sql = sql.rstrip().rstrip(';')
        select_exprs: List[str] = []
        for col in columns:
            if column_formats and col in column_formats:
                cast_expr, _ = _build_cast_expression(col, column_formats[col])
                select_exprs.append(f"{cast_expr} AS `{col.replace('`', '``')}`")
            else:
                select_exprs.append(f"`{col.replace('`', '``')}`")
        
        # INSERT 时使用原列名列表（表创建时已用正确类型）
        safe_cols = ", ".join(f"`{c.replace('`', '``')}`" for c in columns)
        if column_formats:
            insert_sql = f"INSERT INTO {self._safe_table_name(tbl_name)} ({safe_cols}) SELECT {', '.join(select_exprs)} FROM ({safe_sql}) AS _src"
        else:
            insert_sql = f"INSERT INTO {self._safe_table_name(tbl_name)} ({safe_cols}) {safe_sql}"

        # 调试：记录生成的 SQL 前 500 字符
        debug_sql = insert_sql[:500] + "..." if len(insert_sql) > 500 else insert_sql
        logger.info(f"[DEBUG INSERT] step={step_id}, tbl={tbl_name}, sql={debug_sql}")

        try:
            result = await self.connection.execute(text(insert_sql))
            await self.connection.commit()
            row_count = result.rowcount if result.rowcount and result.rowcount > 0 else 0
            logger.info(f"[DEBUG INSERT] result.rowcount={result.rowcount}, row_count={row_count}")
            if row_count == 0:
                count_res = await self.connection.execute(text(f"SELECT COUNT(*) FROM {self._safe_table_name(tbl_name)}"))
                row_count = count_res.fetchone()[0]
                logger.info(f"[DEBUG INSERT] After COUNT: row_count={row_count}")
        except Exception as e:
            logger.error(f"INSERT...SELECT 失败 (step={step_id}): {e}")
            raise

        logger.info(f"步骤 {step_id} INSERT...SELECT 完成: {row_count} 行, 格式转换: {column_formats}")
        return row_count, columns

    async def get_row_count(self, step_id: str) -> int:
        """获取指定步骤的行数（优先列式表，无则查 JSON 表）"""
        if step_id in self._struct_tables:
            tbl_name = self._struct_tables[step_id][0]
            try:
                res = await self.connection.execute(text(f"SELECT COUNT(*) FROM {self._safe_table_name(tbl_name)}"))
                return res.fetchone()[0]
            except Exception as e:
                logger.warning(f"列式表行数查询失败: {e}")

        if not self._json_created:
            return 0
        res = await self.connection.execute(
            text(f"SELECT COUNT(*) FROM {self._safe_table_name(self._json_table_name)} WHERE step_id = :step_id"),
            {"step_id": step_id}
        )
        row = res.fetchone()
        return row[0] if row else 0

    async def drop_struct_table(self, step_id: str):
        """删除指定步骤的列式持久表"""
        if step_id not in self._struct_tables:
            return
        tbl_name = self._struct_tables[step_id][0]
        try:
            await self.connection.execute(text(f"DROP TABLE IF EXISTS {self._safe_table_name(tbl_name)}"))
            await self.connection.commit()
        except Exception as e:
            logger.warning(f"删除列式表 {tbl_name} 失败: {e}")
        del self._struct_tables[step_id]

    async def get_all_steps(self) -> List[Dict[str, Any]]:
        """
        获取所有步骤摘要（优先列式表，无则查 JSON 表）
        """
        result: List[Dict[str, Any]] = []
        # 优先列式表
        for step_id, (tbl_name, columns) in self._struct_tables.items():
            try:
                res = await self.connection.execute(text(f"SELECT COUNT(*) FROM {self._safe_table_name(tbl_name)}"))
                count = res.fetchone()[0]
                result.append({"step_id": step_id, "row_count": count, "columns": columns, "mode": "struct"})
            except Exception as e:
                logger.warning(f"获取步骤 {step_id} 信息失败: {e}")
        # 回退 JSON 表（直接查 DB，不依赖 _json_created flag）
        try:
            json_exists = await self.connection.execute(text("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_name = :tname
            """), {"tname": self._json_table_name})
            json_exists_count = json_exists.fetchone()[0]
            if json_exists_count > 0:
                rows = (await self.connection.execute(text(f"""
                    SELECT step_id, COUNT(*) as row_count, MIN(created_at) as created_at
                    FROM {self._safe_table_name(self._json_table_name)}
                    GROUP BY step_id
                    ORDER BY created_at
                """))).fetchall()
                for row in rows:
                    sid = row[0]
                    if not any(s["step_id"] == sid for s in result):
                        result.append({
                            "step_id": sid,
                            "row_count": row[1],
                            "created_at": row[2].isoformat() if row[2] else None,
                            "mode": "json"
                        })
        except Exception as e:
            logger.warning(f"获取 JSON 步骤信息失败: {e}")
        return result

    async def cleanup_temp_table(self):
        """
        删除所有临时表（MySQL TEMPORARY TABLE 会话结束自动清理，这里显式清理）。
        兜底：扫描 information_schema 清理所有前缀匹配的表，防止异常路径下遗漏。
        """
        # 1. 先删已注册到 _struct_tables 的表
        for step_id, (tbl_name, _) in list(self._struct_tables.items()):
            try:
                await self.connection.execute(text(f"DROP TABLE IF EXISTS {self._safe_table_name(tbl_name)}"))
            except Exception as e:
                logger.warning(f"删除列式表 {tbl_name} 失败: {e}")
        self._struct_tables.clear()
        # 列式表 DROP 需提交，否则连接关闭时回滚，库中会残留 tmp_pipeline_* 表
        try:
            await self.connection.commit()
        except Exception as e:
            logger.warning(f"提交列式临时表删除失败: {e}")

        # 2. 兜底：扫描所有 tmp_pipeline_{exec_id}_* 表清理（防止异常路径下表已创建但未注册）
        try:
            res = await self.connection.execute(text("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_name LIKE :pattern
                  AND table_name NOT LIKE :json_pattern
            """), {"pattern": f"tmp_pipeline_{self.exec_id}_%", "json_pattern": f"%_json"})
            orphans = [r[0] for r in res.fetchall()]
            for tbl in orphans:
                try:
                    await self.connection.execute(text(f"DROP TABLE IF EXISTS `{tbl}`"))
                    logger.info(f"兜底清理孤立临时表: {tbl}")
                except Exception as e:
                    logger.warning(f"兜底删除表 {tbl} 失败: {e}")
            if orphans:
                await self.connection.commit()
        except Exception as e:
            logger.warning(f"兜底扫描临时表失败: {e}")

        if not self._json_created:
            return
        drop_sql = f"DROP TABLE IF EXISTS {self._safe_table_name(self._json_table_name)}"
        try:
            await self.connection.execute(text(drop_sql))
            await self.connection.commit()
            logger.info(f"JSON 临时表已清理: {self._json_table_name}")
        except Exception as e:
            logger.warning(f"清理 JSON 临时表失败: {e}")
        finally:
            self._json_created = False

    async def truncate_step(self, step_id: str):
        """
        清空指定步骤的数据（列式表 + JSON 表）
        """
        if step_id in self._struct_tables:
            tbl_name = self._struct_tables[step_id][0]
            try:
                await self.connection.execute(text(f"TRUNCATE TABLE {self._safe_table_name(tbl_name)}"))
                await self.connection.commit()
            except Exception:
                await self.drop_struct_table(step_id)

        if self._json_created:
            await self.connection.execute(
                text(f"DELETE FROM {self._safe_table_name(self._json_table_name)} WHERE step_id = :step_id"),
                {"step_id": step_id}
            )
            await self.connection.commit()
        logger.info(f"步骤 {step_id} 数据已清空")

    async def get_step_schema(self, step_id: str) -> List[Dict[str, str]]:
        """
        获取指定 step 的字段模式（优先列式表，无则回退 JSON 表首行推断）
        """
        if step_id in self._struct_tables:
            columns = self._struct_tables[step_id][1]
            return [{"name": c, "type": "string"} for c in columns]

        if not self._json_created:
            return []
        query_sql = f"SELECT data_json FROM {self._safe_table_name(self._json_table_name)} WHERE step_id = :step_id LIMIT 1"
        result = await self.connection.execute(text(query_sql), {"step_id": step_id})
        row = result.fetchone()
        if not row:
            return []
        try:
            data = json.loads(row[0])
            if isinstance(data, dict):
                schema = []
                for key, value in data.items():
                    if isinstance(value, bool):
                        field_type = "boolean"
                    elif isinstance(value, int):
                        field_type = "integer"
                    elif isinstance(value, float):
                        field_type = "float"
                    elif isinstance(value, dict):
                        field_type = "object"
                    elif isinstance(value, list):
                        field_type = "array"
                    else:
                        field_type = "string"
                    schema.append({"name": key, "type": field_type})
                return schema
        except json.JSONDecodeError:
            pass
        return []

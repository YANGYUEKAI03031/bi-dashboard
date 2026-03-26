# backend/app/services/pipeline/temp_table_manager.py
"""临时表管理器 (TempTableManager)

用于管理 Pipeline 执行过程中的临时表。
核心功能：
1. 创建带 step_id 和 data_json 的临时表
2. 分步写入中间结果
3. 查询指定 step 的数据用于预览
4. 自动清理

特点：
- 使用 MySQL TEMPORARY TABLE，会话级自动清理，零污染
- 数据以 JSON 格式存储，兼容任意结构
"""
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy import text

logger = logging.getLogger(__name__)


class TempTableManager:
    """
    临时表管理器

    功能：
    1. 创建带 step_id 和 data_json 的临时表
    2. 分步写入中间结果
    3. 查询指定 step 的数据用于预览
    4. 自动清理
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
        self.temp_table_name = f"tmp_pipeline_{exec_id}"
        self._created = False

    async def create_temp_table(self) -> str:
        """
        创建临时表

        表结构：
        - step_id: 步骤标识（如 'step_0', 'step_1'）
        - row_index: 行号
        - data_json: 完整的行数据（JSON 格式）

        Returns:
            临时表名
        """
        if self._created:
            return self.temp_table_name

        create_sql = f"""
        CREATE TEMPORARY TABLE IF NOT EXISTS {self.temp_table_name} (
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
            self._created = True
            logger.info(f"创建临时表成功: {self.temp_table_name}")
            return self.temp_table_name
        except Exception as e:
            logger.error(f"创建临时表失败: {e}")
            raise

    async def insert_step_data(
        self,
        step_id: str,
        data: List[Dict[str, Any]],
        batch_size: int = 1000
    ) -> int:
        """
        将 step 结果写入临时表

        Args:
            step_id: 步骤标识
            data: 行数据列表
            batch_size: 每批写入的行数

        Returns:
            写入的行数
        """
        if not data:
            logger.info(f"步骤 {step_id} 无数据，跳过写入")
            return 0

        if not self._created:
            await self.create_temp_table()

        total_inserted = 0
        row_index = 0

        # 分批插入
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            values_list = []

            for row in batch:
                # 将行数据转为 JSON
                data_json = json.dumps(row, ensure_ascii=False, default=str)
                # 转义单引号防止 SQL 注入
                escaped_json = data_json.replace("'", "\\'")
                values_list.append(f"('{step_id}', {row_index}, '{escaped_json}')")
                row_index += 1

            insert_sql = f"""
            INSERT INTO {self.temp_table_name} (step_id, row_index, data_json)
            VALUES {', '.join(values_list)}
            """

            try:
                await self.connection.execute(text(insert_sql))
                total_inserted += len(batch)
            except Exception as e:
                logger.error(f"插入数据失败 (step={step_id}): {e}")
                raise

        await self.connection.commit()
        logger.info(f"步骤 {step_id} 写入 {total_inserted} 行数据到临时表")
        return total_inserted

    async def query_step_preview(
        self,
        step_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        查询指定 step 的数据用于预览

        Args:
            step_id: 步骤标识
            limit: 返回行数限制
            offset: 偏移量

        Returns:
            {
                "step_id": str,
                "columns": List[str],
                "rows": List[Dict],
                "total": int,
                "has_more": bool
            }
        """
        # 先获取总数
        count_sql = f"""
        SELECT COUNT(*) as total
        FROM {self.temp_table_name}
        WHERE step_id = :step_id
        """
        count_result = await self.connection.execute(text(count_sql), {"step_id": step_id})
        count_row = count_result.fetchone()
        total = count_row[0] if count_row else 0

        if total == 0:
            return {
                "step_id": step_id,
                "columns": [],
                "rows": [],
                "total": 0,
                "has_more": False
            }

        # 获取数据
        query_sql = f"""
        SELECT data_json
        FROM {self.temp_table_name}
        WHERE step_id = :step_id
        ORDER BY row_index
        LIMIT :limit OFFSET :offset
        """
        result = await self.connection.execute(
            text(query_sql),
            {"step_id": step_id, "limit": limit, "offset": offset}
        )
        rows = result.fetchall()

        # 解析 JSON 数据
        parsed_rows = []
        columns_set = set()

        for row in rows:
            try:
                data = json.loads(row[0])
                parsed_rows.append(data)
                # 收集所有字段
                if isinstance(data, dict):
                    columns_set.update(data.keys())
            except json.JSONDecodeError as e:
                logger.warning(f"JSON 解析失败: {e}")
                continue

        # 确定列顺序（按首次出现顺序）
        columns = list(columns_set)

        return {
            "step_id": step_id,
            "columns": columns,
            "rows": parsed_rows,
            "total": total,
            "has_more": (offset + limit) < total
        }

    async def get_step_schema(self, step_id: str) -> List[Dict[str, str]]:
        """
        获取指定 step 的字段模式（从第一条记录推断）

        Args:
            step_id: 步骤标识

        Returns:
            字段列表 [{"name": "field1", "type": "string"}, ...]
        """
        query_sql = f"""
        SELECT data_json
        FROM {self.temp_table_name}
        WHERE step_id = :step_id
        LIMIT 1
        """
        result = await self.connection.execute(text(query_sql), {"step_id": step_id})
        row = result.fetchone()

        if not row:
            return []

        try:
            data = json.loads(row[0])
            if isinstance(data, dict):
                # 推断字段类型
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

    async def get_step_row_count(self, step_id: str) -> int:
        """
        获取指定步骤的行数

        Args:
            step_id: 步骤标识

        Returns:
            行数
        """
        count_sql = f"""
        SELECT COUNT(*) as total
        FROM {self.temp_table_name}
        WHERE step_id = :step_id
        """
        result = await self.connection.execute(text(count_sql), {"step_id": step_id})
        row = result.fetchone()
        return row[0] if row else 0

    async def get_all_steps(self) -> List[Dict[str, Any]]:
        """
        获取所有步骤的摘要信息

        Returns:
            步骤列表 [{"step_id": "step_0", "row_count": 1000, "created_at": ...}, ...]
        """
        query_sql = f"""
        SELECT
            step_id,
            COUNT(*) as row_count,
            MIN(created_at) as created_at
        FROM {self.temp_table_name}
        GROUP BY step_id
        ORDER BY created_at
        """
        result = await self.connection.execute(text(query_sql))
        rows = result.fetchall()

        return [
            {
                "step_id": row[0],
                "row_count": row[1],
                "created_at": row[2].isoformat() if row[2] else None
            }
            for row in rows
        ]

    async def cleanup_temp_table(self):
        """
        删除临时表

        注意：MySQL TEMPORARY TABLE 在会话结束时也会自动删除，
        但显式删除可以立即释放资源
        """
        if not self._created:
            return

        drop_sql = f"DROP TEMPORARY TABLE IF EXISTS {self.temp_table_name}"

        try:
            await self.connection.execute(text(drop_sql))
            await self.connection.commit()
            logger.info(f"临时表已清理: {self.temp_table_name}")
        except Exception as e:
            logger.warning(f"清理临时表失败: {e}")
        finally:
            self._created = False

    async def truncate_step(self, step_id: str):
        """
        清空指定步骤的数据（用于重新执行）

        Args:
            step_id: 步骤标识
        """
        delete_sql = f"""
        DELETE FROM {self.temp_table_name}
        WHERE step_id = :step_id
        """
        await self.connection.execute(text(delete_sql), {"step_id": step_id})
        await self.connection.commit()
        logger.info(f"步骤 {step_id} 数据已清空")

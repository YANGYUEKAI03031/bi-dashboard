# backend/app/services/pipeline/watermark_manager.py
"""水位线管理器 - 管理增量更新的水位线

用于追踪每个管道节点的增量进度，避免重复拉取全量数据。
"""
import re
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pipeline import PipelineWatermark

logger = logging.getLogger(__name__)


class WatermarkManager:
    """管理增量更新的水位线"""

    def __init__(self, session: AsyncSession):
        """
        初始化水位线管理器

        Args:
            session: SQLAlchemy 会话
        """
        self.session = session

    async def get_watermark(
        self,
        pipeline_id: int,
        node_id: str
    ) -> Optional[str]:
        """
        获取当前水位线值

        Args:
            pipeline_id: 管道 ID
            node_id: 节点 ID

        Returns:
            水位线值（字符串），如果没有则返回 None
        """
        try:
            stmt = select(PipelineWatermark).where(
                and_(
                    PipelineWatermark.pipeline_id == pipeline_id,
                    PipelineWatermark.node_id == node_id
                )
            )
            result = await self.session.execute(stmt)
            watermark = result.scalar_one_or_none()

            if watermark:
                return watermark.last_value
            return None
        except Exception as e:
            logger.error(f"获取水位线失败: pipeline_id={pipeline_id}, node_id={node_id}, error={e}")
            return None

    async def get_watermark_record(
        self,
        pipeline_id: int,
        node_id: str
    ) -> Optional[PipelineWatermark]:
        """
        获取水位线记录

        Args:
            pipeline_id: 管道 ID
            node_id: 节点 ID

        Returns:
            PipelineWatermark 记录
        """
        try:
            stmt = select(PipelineWatermark).where(
                and_(
                    PipelineWatermark.pipeline_id == pipeline_id,
                    PipelineWatermark.node_id == node_id
                )
            )
            result = await self.session.execute(stmt)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"获取水位线记录失败: {e}")
            return None

    async def update_watermark(
        self,
        pipeline_id: int,
        node_id: str,
        watermark_field: str,
        value: str
    ) -> bool:
        """
        更新水位线

        Args:
            pipeline_id: 管道 ID
            node_id: 节点 ID
            watermark_field: 增量字段名
            value: 新的水位线值

        Returns:
            是否成功
        """
        try:
            # 查找现有记录
            stmt = select(PipelineWatermark).where(
                and_(
                    PipelineWatermark.pipeline_id == pipeline_id,
                    PipelineWatermark.node_id == node_id
                )
            )
            result = await self.session.execute(stmt)
            watermark = result.scalar_one_or_none()

            if watermark:
                # 更新现有记录
                watermark.last_value = value
                watermark.last_processed_at = datetime.utcnow()
            else:
                # 创建新记录
                watermark = PipelineWatermark(
                    pipeline_id=pipeline_id,
                    node_id=node_id,
                    watermark_field=watermark_field,
                    last_value=value,
                    last_processed_at=datetime.utcnow()
                )
                self.session.add(watermark)

            await self.session.commit()
            logger.info(f"水位线已更新: pipeline_id={pipeline_id}, node_id={node_id}, value={value}")
            return True

        except Exception as e:
            logger.error(f"更新水位线失败: {e}")
            await self.session.rollback()
            return False

    async def delete_watermark(
        self,
        pipeline_id: int,
        node_id: str
    ) -> bool:
        """
        删除水位线记录

        Args:
            pipeline_id: 管道 ID
            node_id: 节点 ID

        Returns:
            是否成功
        """
        try:
            stmt = select(PipelineWatermark).where(
                and_(
                    PipelineWatermark.pipeline_id == pipeline_id,
                    PipelineWatermark.node_id == node_id
                )
            )
            result = await self.session.execute(stmt)
            watermark = result.scalar_one_or_none()

            if watermark:
                await self.session.delete(watermark)
                await self.session.commit()
                logger.info(f"水位线已删除: pipeline_id={pipeline_id}, node_id={node_id}")

            return True
        except Exception as e:
            logger.error(f"删除水位线失败: {e}")
            await self.session.rollback()
            return False

    async def get_all_watermarks(
        self,
        pipeline_id: int
    ) -> List[Dict[str, Any]]:
        """
        获取管道所有节点的水位线

        Args:
            pipeline_id: 管道 ID

        Returns:
            水位线列表
        """
        try:
            stmt = select(PipelineWatermark).where(
                PipelineWatermark.pipeline_id == pipeline_id
            )
            result = await self.session.execute(stmt)
            watermarks = result.scalars().all()

            return [
                {
                    "node_id": w.node_id,
                    "watermark_field": w.watermark_field,
                    "last_value": w.last_value,
                    "last_processed_at": w.last_processed_at.isoformat() if w.last_processed_at else None
                }
                for w in watermarks
            ]
        except Exception as e:
            logger.error(f"获取所有水位线失败: {e}")
            return []

    def build_incremental_sql(
        self,
        original_sql: str,
        watermark_field: str,
        watermark_value: str,
        operator: str = ">"
    ) -> str:
        """
        为 SQL 添加增量条件

        自动分析原 SQL，添加 WHERE 子句过滤已处理的数据。

        Args:
            original_sql: 原始 SQL
            watermark_field: 增量字段名
            watermark_value: 水位线值
            operator: 比较操作符，默认 ">"

        Returns:
            添加了增量条件的 SQL
        """
        if not original_sql or not watermark_field or not watermark_value:
            return original_sql

        # 安全处理字段名
        safe_field = self._safe_identifier(watermark_field)

        # 格式化值
        formatted_value = self._format_watermark_value(watermark_value)

        # 判断操作符
        op = ">" if operator == "gt" else ">="

        # 构建增量条件
        incremental_condition = f"{safe_field} {op} {formatted_value}"

        # 转换为大写查找
        sql_upper = original_sql.upper().strip()

        # 检查是否已有 WHERE 子句
        if " WHERE " in sql_upper:
            # 已有 WHERE，追加条件
            # 找到 WHERE 的位置（不区分大小写）
            where_pos = sql_upper.find(" WHERE ")
            # 在 WHERE 后插入条件
            original_sql = (
                original_sql[:where_pos + 7] +  # 保留 "WHERE "
                "(" + incremental_condition + ") AND "
                + original_sql[where_pos + 7:]
            )
        elif " GROUP BY " in sql_upper:
            # 有 GROUP BY 但没有 WHERE，在 GROUP BY 前添加
            group_pos = sql_upper.find(" GROUP BY ")
            original_sql = (
                original_sql[:group_pos]
                + " WHERE " + incremental_condition
                + original_sql[group_pos:]
            )
        elif " ORDER BY " in sql_upper:
            # 有 ORDER BY 但没有 WHERE，在 ORDER BY 前添加
            order_pos = sql_upper.find(" ORDER BY ")
            original_sql = (
                original_sql[:order_pos]
                + " WHERE " + incremental_condition
                + original_sql[order_pos:]
            )
        elif " LIMIT " in sql_upper:
            # 有 LIMIT 但没有 WHERE，在 LIMIT 前添加
            limit_pos = sql_upper.find(" LIMIT ")
            original_sql = (
                original_sql[:limit_pos]
                + " WHERE " + incremental_condition
                + original_sql[limit_pos:]
            )
        else:
            # 没有 WHERE，直接追加
            original_sql = original_sql + " WHERE " + incremental_condition

        return original_sql

    def _safe_identifier(self, name: str) -> str:
        """安全地包裹标识符"""
        # 移除反引号后重新包裹
        safe_name = name.replace("`", "")
        return f"`{safe_name}`"

    def _format_watermark_value(self, value: str) -> str:
        """格式化水位线值"""
        if not value:
            return "NULL"

        # 尝试检测值类型
        # 如果是数字，保持原样
        try:
            float(value)
            return value
        except ValueError:
            pass

        # 如果是日期时间格式，加引号
        # 常见格式: 2024-01-01, 2024-01-01 12:00:00, 2024-01-01T12:00:00
        date_patterns = [
            r"^\d{4}-\d{2}-\d{2}$",  # 2024-01-01
            r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$",  # 2024-01-01 12:00:00
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}",  # ISO 格式
        ]

        for pattern in date_patterns:
            if re.match(pattern, value):
                return f"'{value}'"

        # 如果是纯数字字符串，保持原样
        if value.isdigit():
            return value

        # 其他情况加引号
        return f"'{value}'"

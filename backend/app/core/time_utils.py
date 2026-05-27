# backend/app/core/time_utils.py
"""
时间工具模块

提供：
- utc_now(): 返回带时区的当前 UTC 时间（替代已废弃的 datetime.utcnow()）
"""

from datetime import UTC, datetime


def utc_now() -> datetime:
    """
    获取当前 UTC 时间（带时区信息）。

    替代已废弃的 datetime.utcnow()，返回的 datetime 对象包含 tzinfo，
    避免 Python 3.12+ 的 DeprecationWarning。

    Returns:
        datetime: 当前 UTC 时间，带 timezone 信息
    """
    return datetime.now(UTC)

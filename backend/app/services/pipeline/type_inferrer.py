# backend/app/services/pipeline/type_inferrer.py
"""
Pipeline 类型推断模块

包含：
- Python 值到列类型的推断
- 预览数据列类型推断
- Pipeline 节点类型规范映射
"""
from typing import Any, List
from datetime import datetime, date
from decimal import Decimal


def preview_value_to_column_type(v: Any) -> str:
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


def infer_preview_column_types(rows_raw: List[Any], num_cols: int) -> List[str]:
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
        col_types.append(preview_value_to_column_type(picked))
    return col_types


# 与前端 nodeTypeRegistry LEGACY_TYPE_MAP 一致：预览 SQL 生成用规范类型
PIPELINE_NODE_TYPE_CANON = {
    "transform": "filter",
    "merge": "join",
}

# app/schemas/data_source.py
from typing import Any

from pydantic import BaseModel


class DataSource(BaseModel):
    id: str
    name: str
    type: str


class ColumnInfo(BaseModel):
    name: str
    type: str
    is_nullable: bool
    default_value: str | None


class TableInfo(BaseModel):
    name: str
    columns: list[ColumnInfo]


class QueryRequest(BaseModel):
    data_source_id: str
    query: str


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int

# app/schemas/data_source.py
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class DataSource(BaseModel):
    id: str
    name: str
    type: str

class ColumnInfo(BaseModel):
    name: str
    type: str
    is_nullable: bool
    default_value: Optional[str]

class TableInfo(BaseModel):
    name: str
    columns: List[ColumnInfo]

class QueryRequest(BaseModel):
    data_source_id: str
    query: str

class QueryResponse(BaseModel):
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
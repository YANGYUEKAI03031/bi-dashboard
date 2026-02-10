from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class ChartConfig(BaseModel):
    title: str
    type: str
    xAxis: Dict[str, str]
    yAxis: Dict[str, str]
    series: List[Dict[str, str]]
    dataBinding: Dict[str, Any]
    styling: Dict[str, Any]
    description: Optional[str] = None

class ChartCreate(BaseModel):
    name: str
    description: Optional[str] = None
    chart_type: str
    config: ChartConfig
    data_source_id: int
    table_name: str  # 改为表名

class ChartUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    chart_type: Optional[str] = None
    config: Optional[ChartConfig] = None
    table_name: Optional[str] = None

class ChartDatabaseResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    chart_type: str
    config: Dict[str, Any]
    data_source_id: int
    table_name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# 添加别名以兼容现有代码
ChartResponse = ChartDatabaseResponse
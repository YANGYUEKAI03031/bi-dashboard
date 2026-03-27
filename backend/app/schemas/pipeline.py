# backend/app/schemas/pipeline.py
"""数据管道 (Pipeline) Schema 定义"""
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, List
from datetime import datetime


class PipelineNodeCreate(BaseModel):
    """管道节点配置 - 创建时"""
    id: Optional[str] = None  # 节点ID，如 "step_1"
    name: str = Field(..., description="节点名称")
    type: str = Field(default="transform", description="节点类型: source | transform | output | merge")
    sql: str = Field(..., description="SQL 语句")
    order: int = Field(..., description="执行顺序")
    upstream: Optional[List[str]] = Field(default=None, description="上游节点 ID 列表")
    position: Optional[Dict[str, float]] = Field(default=None, description="画布坐标 {x, y}")
    merge_type: Optional[str] = Field(default=None, description="合并类型: union | left_join | right_join | full_join")
    config: Optional[Dict[str, Any]] = None  # 节点额外配置

    @validator('upstream', always=True)
    def validate_upstream(cls, v, values):
        if v is None:
            return None
        # 禁止自引用
        node_id = values.get('id')
        if node_id and node_id in v:
            raise ValueError(f"节点 '{node_id}' 不能将自己作为上游")
        return v

    @validator('merge_type')
    def validate_merge_type(cls, v):
        if v is not None and v not in ('union', 'left_join', 'right_join', 'full_join'):
            raise ValueError("merge_type 必须是 union | left_join | right_join | full_join")
        return v


class PipelineNodeResponse(BaseModel):
    """管道节点配置 - 响应时"""
    id: str
    name: str
    type: str
    sql: str
    order: int
    upstream: Optional[List[str]] = None
    position: Optional[Dict[str, float]] = None
    merge_type: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class PipelineCreate(BaseModel):
    """创建管道请求"""
    name: str = Field(..., min_length=1, max_length=255, description="管道名称")
    description: Optional[str] = Field(None, description="管道描述")
    source_data_source_id: int = Field(..., description="源数据源 ID")
    nodes: List[PipelineNodeCreate] = Field(..., min_items=1, description="节点配置列表")
    variables: Optional[Dict[str, Any]] = Field(default_factory=dict, description="全局变量")
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, description="执行配置")
    is_public: bool = Field(default=False, description="是否公开")

    @validator('nodes')
    def validate_nodes(cls, nodes):
        if not nodes:
            return nodes

        # 构建节点 ID 集合
        node_ids = set()
        for node in nodes:
            if node.id:
                node_ids.add(node.id)

        # 校验 upstream 引用的节点都存在
        for node in nodes:
            if node.upstream:
                for upstream_id in node.upstream:
                    if upstream_id not in node_ids:
                        raise ValueError(f"节点 '{node.id}' 的上游节点 '{upstream_id}' 不存在于管道中")

        # 检测环（Kahn 算法简化版）
        all_upstream = {node.id: set(node.upstream) if node.upstream else set() for node in nodes if node.id}
        remaining = set(all_upstream.keys())
        removed_count = 0
        while remaining:
            # 找到没有入边的节点
            has_incoming = any(node_id in ups for ups in all_upstream.values() for node_id in remaining)
            # 实际上我们需要找的是没有上游依赖的节点
            zero_in = [nid for nid in remaining if not all_upstream.get(nid)]
            if not zero_in:
                raise ValueError(f"管道配置存在循环依赖，环中的节点可能在: {remaining}")
            for nid in zero_in:
                remaining.discard(nid)
                removed_count += 1

        return nodes


class PipelineUpdate(BaseModel):
    """更新管道请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    nodes: Optional[List[PipelineNodeCreate]] = None
    variables: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None
    source_data_source_id: Optional[int] = Field(
        None, description="管道级业务数据源；可与源节点 config 中的选择同步"
    )


class PipelineResponse(BaseModel):
    """管道响应"""
    id: int
    name: str
    description: Optional[str]
    source_data_source_id: int
    nodes: List[Dict[str, Any]]  # JSON 格式
    variables: Optional[Dict[str, Any]]
    config: Optional[Dict[str, Any]]
    is_active: bool
    created_by: int
    is_public: bool
    created_at: datetime
    updated_at: datetime

    @validator('nodes', pre=True)
    def parse_nodes(cls, v):
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return []
        return v or []

    class Config:
        from_attributes = True


class PipelineListResponse(BaseModel):
    """管道列表响应"""
    items: List[PipelineResponse]
    total: int
    skip: int
    limit: int


class ExecutionResponse(BaseModel):
    """执行记录响应"""
    id: int
    pipeline_id: int
    status: str  # pending | running | completed | failed | cancelled | expired
    temp_table_name: Optional[str]
    completed_steps: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]]
    result_summary: Optional[Dict[str, Any]]
    error_message: Optional[str]
    total_rows: int
    execution_time_ms: Optional[int]
    logs: List[Dict[str, Any]]
    retention_minutes: int
    expires_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    @validator('completed_steps', 'logs', pre=True)
    def parse_json_list(cls, v):
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return []
        return v or []

    @validator('result_summary', pre=True)
    def parse_json_dict(cls, v):
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return None
        return v

    class Config:
        from_attributes = True


class ExecutionListResponse(BaseModel):
    """执行记录列表响应"""
    items: List[ExecutionResponse]
    total: int


class StepPreviewResponse(BaseModel):
    """步骤预览响应"""
    step_id: str
    columns: List[str]
    rows: List[Dict[str, Any]]
    total: int
    has_more: bool


class StepSchemaResponse(BaseModel):
    """步骤字段模式响应"""
    step_id: str
    schema: List[Dict[str, str]]  # [{"name": "field1", "type": "string"}, ...]


class RunPipelineResponse(BaseModel):
    """触发运行响应"""
    execution_id: int
    pipeline_id: int
    status: str
    message: str


class PipelineStatsResponse(BaseModel):
    """管道统计响应"""
    pipeline_id: int
    total_executions: int
    successful_executions: int
    failed_executions: int
    avg_execution_time_ms: Optional[float]
    last_execution: Optional[datetime]


class NodePreviewRequest(BaseModel):
    """节点预览请求 - 用于无代码编辑器的实时预览"""
    node_type: str = Field(..., description="节点类型: source | filter | aggregate | join | column_select | output")
    config: Dict[str, Any] = Field(default_factory=dict, description="节点可视化配置 JSON")
    source_data_source_id: int = Field(..., description="管道级业务数据源 ID")
    # 可选的已完成上游节点预览（用于 join 等多输入节点）
    upstream_previews: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="上游节点预览结果列表，每个元素含 node_id, columns, rows"
    )
    limit: int = Field(default=100, ge=1, le=500, description="预览行数限制")


class NodePreviewResponse(BaseModel):
    """节点预览响应"""
    columns: List[str]
    column_types: List[str] = Field(default_factory=list, description="列类型列表")
    rows: List[Dict[str, Any]]
    total: int
    has_more: bool
    sql_generated: str = Field(default="", description="实际生成的 SQL（调试用）")

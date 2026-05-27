# backend/app/models/pipeline.py
"""数据管道 (Pipeline) 数据模型

用于管理 ETL/ELT 数据处理管道的配置和执行记录。
核心特点：
- 逻辑在数据库（SQL 分步执行）
- 点击节点预览数据（临时表快照）
- 零污染存储（MySQL TEMPORARY TABLE）
"""

from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.time_utils import utc_now
from app.db.base import Base

# 节点结构存于 DataPipeline.nodes（JSON），类型见 app.schemas.pipeline.PipelineNodeCreate


class DataPipeline(Base):
    """数据管道配置"""

    __tablename__ = "data_pipelines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_data_source_id = Column(Integer, ForeignKey("databases.id"), nullable=False)

    # 节点配置 (JSON 格式)
    # 格式: [
    #   {
    #     "id": "step_1",
    #     "name": "提取数据",
    #     "type": "source",        # source | transform | output
    #     "sql": "SELECT * FROM orders WHERE create_time >= '2024-01-01'",
    #     "order": 1
    #   },
    #   {
    #     "id": "step_2",
    #     "name": "数据清洗",
    #     "type": "transform",
    #     "sql": "SELECT order_id, amount, status FROM {prev_table}",
    #     "order": 2
    #   }
    # ]
    nodes = Column(JSON, nullable=True, default=list)

    # 全局变量配置（可选）
    variables = Column(JSON, nullable=True, default=dict)

    # 执行配置
    config = Column(JSON, nullable=True, default=dict)

    # 状态
    is_active = Column(Boolean, default=True)

    # 权限
    created_by = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    is_public = Column(Boolean, default=False)

    # 时间戳
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    def __repr__(self):
        return f"<DataPipeline(id={self.id}, name='{self.name}')>"


class PipelineExecution(Base):
    """管道执行记录"""

    __tablename__ = "pipeline_executions"

    id = Column(Integer, primary_key=True, index=True)
    pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=False)

    # 执行状态: pending | running | completed | failed | cancelled
    status = Column(String(50), default="pending")

    # 临时表名（会话级临时表，连接断开自动清理）
    # 注意：MySQL TEMPORARY TABLE 只在当前会话可见
    # 由于我们使用同一数据源的连接执行，临时表可被访问
    temp_table_name = Column(String(255), nullable=True)

    # 已完成的步骤列表
    completed_steps = Column(JSON, nullable=True, default=list)

    # 执行配置
    config = Column(JSON, nullable=True, default=dict)

    # 执行结果摘要
    result_summary = Column(JSON, nullable=True)

    # 错误信息
    error_message = Column(Text, nullable=True)

    # 执行统计
    total_rows = Column(Integer, default=0)
    execution_time_ms = Column(Integer, nullable=True)

    # 进度跟踪字段
    current_step_id = Column(String(50), nullable=True)  # 当前正在执行的步骤
    current_step_rows = Column(Integer, default=0)  # 当前步骤已处理行数
    current_step_total_rows = Column(Integer, nullable=True)  # 当前步骤预估总行数
    step_progress = Column(JSON, nullable=True)  # 各步骤进度详情 {"step_0": {"status": "running", "rows": 5000}, ...}

    # 执行日志
    logs = Column(JSON, nullable=True, default=list)

    # 生命周期管理
    # 保留时间（分钟），执行完成后保留多久供预览
    retention_minutes = Column(Integer, default=60)
    expires_at = Column(DateTime, nullable=True)

    # 时间戳
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # 关系
    pipeline = relationship("DataPipeline", backref="executions")

    def __repr__(self):
        return f"<PipelineExecution(id={self.id}, pipeline_id={self.pipeline_id}, status='{self.status}')>"


class PipelineWatermark(Base):
    """管道节点水位线 - 用于增量更新"""

    __tablename__ = "pipeline_watermarks"

    id = Column(Integer, primary_key=True, index=True)
    pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=False)
    node_id = Column(String(100), nullable=False)  # 节点 ID
    watermark_field = Column(String(100), nullable=False)  # 增量字段名
    last_value = Column(String(255), nullable=True)  # 上次处理的最大值
    last_processed_at = Column(DateTime, default=utc_now)

    # 关系
    pipeline = relationship("DataPipeline", backref="watermarks")

    def __repr__(self):
        return f"<PipelineWatermark(pipeline_id={self.pipeline_id}, node_id='{self.node_id}', last_value='{self.last_value}')>"


class PipelineDependency(Base):
    """管道依赖关系"""

    __tablename__ = "pipeline_dependencies"

    id = Column(Integer, primary_key=True, index=True)
    pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=False)
    depends_on_pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=False)
    depends_on_node_id = Column(String(100), nullable=True)  # 可选：依赖特定节点输出
    created_at = Column(DateTime, default=utc_now)

    # 关系
    pipeline = relationship("DataPipeline", foreign_keys=[pipeline_id], backref="dependencies")
    depends_on_pipeline = relationship("DataPipeline", foreign_keys=[depends_on_pipeline_id])

    def __repr__(self):
        return f"<PipelineDependency(pipeline_id={self.pipeline_id}, depends_on={self.depends_on_pipeline_id})>"


class PipelineTrigger(Base):
    """管道触发器配置 - 用于数据变更自动触发"""

    __tablename__ = "pipeline_triggers"

    id = Column(Integer, primary_key=True, index=True)
    pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=False, unique=True)

    # 监控目标
    source_table = Column(String(255), nullable=False)  # 监控的源表名
    watermark_field = Column(String(128), nullable=False)  # 高水位字段（updated_at / id）

    # 调度策略
    poll_interval_seconds = Column(Integer, default=300)  # 轮询间隔（默认 5 分钟）

    # 状态
    enabled = Column(Boolean, default=True)
    last_check_at = Column(DateTime, nullable=True)
    last_watermark_value = Column(String(255), nullable=True)  # 存储上次 MAX(updated_at)
    last_row_count = Column(BigInteger, nullable=True)  # 存储上次行数（用于检测删除）

    # 时间戳
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now)

    def __repr__(self):
        return f"<PipelineTrigger(pipeline_id={self.pipeline_id}, watermark_field='{self.watermark_field}', enabled={self.enabled})>"

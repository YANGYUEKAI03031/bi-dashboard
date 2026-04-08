# backend/app/models/visualization.py
from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class VisualizationCard(Base):
    """图表实体 - 对应现有数据库表结构"""
    __tablename__ = "visualization_cards"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    
    # 图表类型
    chart_type = Column(String(50), nullable=False)
    
    # 新添加的字段
    dataset_query = Column(JSON)  # 包含SQL查询、数据源、参数等
    visualization_settings = Column(JSON)  # 颜色、轴设置、标题、交互等配置
    
    # 现有字段（需要处理默认值问题）
    config = Column(JSON, default=lambda: {})  # 添加默认值
    query_sql = Column(Text)  # 可能需要默认值
    
    # 适配现有表结构的字段名
    data_source_id = Column(Integer, ForeignKey("databases.id"), nullable=False)  # 原来的 database_id
    created_by = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)  # 原来的 creator_id
    
    # 其他字段
    table_name = Column(String(255), nullable=True)  # 新增：存储实际查询的表名
    is_public = Column(Boolean, default=False)
    archived = Column(Boolean, default=False)
    public_uuid = Column(String(36))  # 公开分享标识
    cache_enabled = Column(Boolean, default=True)
    cache_duration = Column(Integer, default=3600)  # 缓存时长（秒）
    last_cached_at = Column(DateTime, nullable=True)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 管道图表节点关联字段
    pipeline_id = Column(Integer, ForeignKey("data_pipelines.id"), nullable=True)
    focus_node_id = Column(String(64), nullable=True)  # 对应 chart 节点的 id 字段
    synced_at = Column(DateTime, nullable=True)  # 最近同步时间

    # 关系
    database = relationship("Database", back_populates="visualization_cards")
    creator = relationship("User", back_populates="created_visualizations")
    pipeline = relationship("DataPipeline", foreign_keys=[pipeline_id])

class Database(Base):
    """数据库连接配置模型"""
    __tablename__ = "databases"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    engine = Column(String(50), nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    username = Column(String(100), nullable=False)
    password = Column(String(255), nullable=False)
    database_name = Column(String(100), nullable=False)
    description = Column(Text)
    
    # 连接状态
    is_active = Column(Boolean, default=True)
    last_connected = Column(DateTime)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    visualization_cards = relationship("VisualizationCard", back_populates="database")
    
    def __repr__(self):
        return f"<Database(id={self.id}, name='{self.name}', engine='{self.engine}')>"
# backend/app/models/visualization.py
from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class VisualizationCard(Base):
    """图表实体 - 对应Metabase的Card"""
    __tablename__ = "visualization_cards"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    
    # 图表类型 - 对应Metabase的display字段
    chart_type = Column(String(50), nullable=False)  # bar, line, pie, scatter, etc.
    
    # 核心数据查询配置 - 对应Metabase的dataset_query
    dataset_query = Column(JSON)  # 包含SQL查询、数据源、参数等
    
    # 可视化配置 - 对应Metabase的visualization_settings
    visualization_settings = Column(JSON)  # 颜色、轴设置、标题、交互等配置
    
    # 数据源关联
    database_id = Column(Integer, ForeignKey("databases.id"), nullable=False)
    
    # 权限和状态管理
    creator_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    is_public = Column(Boolean, default=False)
    archived = Column(Boolean, default=False)
    public_uuid = Column(String(36))  # 公开分享标识
    
    # 缓存设置
    cache_enabled = Column(Boolean, default=True)
    cache_duration = Column(Integer, default=3600)  # 缓存时长（秒）
    last_cached_at = Column(DateTime, nullable=True)
    cached_data = Column(JSON, nullable=True)
    
    # 时间戳 - 对应Metabase的时间跟踪
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    database = relationship("Database", back_populates="visualization_cards")
    creator = relationship("User", back_populates="created_visualizations")

class Database(Base):
    """数据库连接配置模型 - 对应Metabase的Database"""
    __tablename__ = "databases"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    engine = Column(String(50), nullable=False)  # mysql, postgresql, etc.
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    username = Column(String(100), nullable=False)
    password = Column(String(255), nullable=False)  # 应该加密存储
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
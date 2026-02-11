# backend/app/models/dashboard.py
from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class Dashboard(Base):
    """仪表板实体"""
    __tablename__ = "dashboards"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    
    # 布局配置
    layout = Column(JSON)  # 存储卡片位置信息
    settings = Column(JSON)  # 仪表板级别设置
    
    # 权限管理
    creator_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    is_public = Column(Boolean, default=False)
    archived = Column(Boolean, default=False)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    creator = relationship("User", back_populates="created_dashboards")
    dashboard_cards = relationship("DashboardCard", back_populates="dashboard", cascade="all, delete-orphan")
    tabs = relationship("DashboardTab", back_populates="dashboard", cascade="all, delete-orphan")

class DashboardCard(Base):
    """仪表板卡片 - 对应Metabase的DashboardCard"""
    __tablename__ = "dashboard_cards"
    
    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False)
    chart_id = Column(Integer, ForeignKey("visualization_cards.id"), nullable=False)
    
    # 位置和尺寸信息
    card_row = Column(Integer, default=0)
    card_col = Column(Integer, default=0)
    size_x = Column(Integer, default=6)
    size_y = Column(Integer, default=4)
    
    # 仪表板级别的可视化设置（可覆盖原设置）
    visualization_settings = Column(JSON)
    
    # 参数映射配置
    parameter_mappings = Column(JSON)
    
    # 标签页支持
    dashboard_tab_id = Column(Integer, ForeignKey("dashboard_tabs.id"))
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    dashboard = relationship("Dashboard", back_populates="dashboard_cards")
    chart = relationship("VisualizationCard")
    tab = relationship("DashboardTab")

class DashboardTab(Base):
    """仪表板标签页"""
    __tablename__ = "dashboard_tabs"
    
    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False)
    name = Column(String(100), nullable=False)
    position = Column(Integer, default=0)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    dashboard = relationship("Dashboard", back_populates="tabs")
    dashboard_cards = relationship("DashboardCard", back_populates="tab")
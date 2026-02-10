# app/models/visualization.py
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class VisualizationCard(Base):
    __tablename__ = "visualization_cards"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    chart_type = Column(String(50), nullable=False)
    config = Column(JSON, nullable=False)
    data_source_id = Column(Integer, ForeignKey("data_sources.id"), nullable=False)
    query_sql = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系定义
    creator = relationship("User", back_populates="visualization_cards")
    data_source = relationship("DataSource", back_populates="visualization_cards")
    
    def __repr__(self):
        return f"<VisualizationCard(id={self.id}, name='{self.name}')>"

class DataSource(Base):
    __tablename__ = "data_sources"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    connection_config = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系定义
    visualization_cards = relationship("VisualizationCard", back_populates="data_source")
# app/models/user.py
from sqlalchemy import Column, Integer, String
from app.db.base import Base
from sqlalchemy.orm import relationship

class User(Base):
    __tablename__ = "useraccount"  # 注意：表名应为 useraccount

    userID = Column(Integer, primary_key=True, index=True)
    accountname = Column(String, unique=True, index=True)  # 对应 username
    password = Column(String)  # 对应 password
    state = Column(Integer)  # 对应 is_active 或 status
    
    # 关系定义
    created_visualizations = relationship("VisualizationCard", back_populates="creator")
    created_dashboards = relationship("Dashboard", back_populates="creator")
    created_report_pages = relationship("ReportPage", back_populates="creator")
    def __repr__(self):
        return f"<User(userID={self.userID}, accountname={self.accountname})>"
# app/models/user.py
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "useraccount"

    userID = Column(Integer, primary_key=True, autoincrement=True)
    accountname = Column(String, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)  # bcrypt 哈希
    state = Column(Integer)

    # 关系定义
    created_visualizations = relationship("VisualizationCard", back_populates="creator")
    created_dashboards = relationship("Dashboard", back_populates="creator")
    created_report_pages = relationship("ReportPage", back_populates="creator")

    def __repr__(self):
        return f"<User(userID={self.userID}, accountname={self.accountname})>"

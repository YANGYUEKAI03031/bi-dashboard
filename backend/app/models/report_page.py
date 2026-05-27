# backend/app/models/report_page.py
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.time_utils import utc_now
from app.db.base import Base


class ReportPage(Base):
    """报表页实体"""

    __tablename__ = "report_pages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    icon = Column(String(50))  # 图标（可选）
    order_index = Column(Integer, default=0)  # 排序索引

    # 权限管理
    creator_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    is_active = Column(Boolean, default=True)

    # 时间戳
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # 关系
    creator = relationship("User", back_populates="created_report_pages")
    report_page_dashboards = relationship(
        "ReportPageDashboard", back_populates="report_page", cascade="all, delete-orphan"
    )


class ReportPageDashboard(Base):
    """报表页与仪表盘的关联表"""

    __tablename__ = "report_page_dashboards"

    id = Column(Integer, primary_key=True, index=True)
    report_page_id = Column(Integer, ForeignKey("report_pages.id"), nullable=False)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False)
    order_index = Column(Integer, default=0)  # 在报表页中的排序

    # 时间戳
    created_at = Column(DateTime, default=utc_now)

    # 关系
    report_page = relationship("ReportPage", back_populates="report_page_dashboards")
    dashboard = relationship("Dashboard")

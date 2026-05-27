# backend/app/models/dashboard.py
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.time_utils import utc_now
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
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # 关系
    creator = relationship("User", back_populates="created_dashboards")
    dashboard_cards = relationship("DashboardCard", back_populates="dashboard", cascade="all, delete-orphan")
    tabs = relationship("DashboardTab", back_populates="dashboard", cascade="all, delete-orphan")
    filters = relationship("DashboardFilter", back_populates="dashboard", cascade="all, delete-orphan")


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
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # 关系
    dashboard = relationship("Dashboard", back_populates="dashboard_cards")
    chart = relationship("VisualizationCard")
    tab = relationship("DashboardTab")
    filter_bindings = relationship("DashboardFilterBinding", back_populates="card", cascade="all, delete-orphan")


class DashboardTab(Base):
    """仪表板标签页"""

    __tablename__ = "dashboard_tabs"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False)
    name = Column(String(100), nullable=False)
    position = Column(Integer, default=0)

    # 时间戳
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # 关系
    dashboard = relationship("Dashboard", back_populates="tabs")
    dashboard_cards = relationship("DashboardCard", back_populates="tab")
    filters = relationship("DashboardFilter", back_populates="tab", cascade="all, delete-orphan")


class DashboardFilter(Base):
    """仪表盘筛选器"""

    __tablename__ = "dashboard_filters"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False)
    dashboard_tab_id = Column(Integer, ForeignKey("dashboard_tabs.id"))

    # 筛选器配置
    name = Column(String(100), nullable=False)  # 筛选器名称
    filter_type = Column(
        String(50), nullable=False
    )  # 筛选器类型: date_range, date_relative, select, multi_select, input
    field_name = Column(String(100), nullable=False)  # 关联字段名，用于匹配图表SQL
    field_label = Column(String(100))  # 显示标签

    # 数据配置
    data_source_id = Column(Integer, ForeignKey("databases.id"))  # 数据源ID（用于获取选项）
    options_table = Column(String(100))  # 选项来源表
    options_field = Column(String(100))  # 选项来源字段
    options_sql = Column(Text)  # 自定义SQL获取选项

    # 默认值
    default_value = Column(JSON)

    # 位置
    position = Column(Integer, default=0)

    # 时间戳
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # 关系
    dashboard = relationship("Dashboard", back_populates="filters")
    tab = relationship("DashboardTab", back_populates="filters")
    bindings = relationship("DashboardFilterBinding", back_populates="filter", cascade="all, delete-orphan")


class DashboardFilterBinding(Base):
    """筛选器与图表卡片的绑定关系"""

    __tablename__ = "dashboard_filter_bindings"

    id = Column(Integer, primary_key=True, index=True)
    filter_id = Column(Integer, ForeignKey("dashboard_filters.id"), nullable=False)
    card_id = Column(Integer, ForeignKey("dashboard_cards.id"), nullable=False)

    # 参数名映射：筛选器的参数名 -> 图表SQL中的参数名
    param_name = Column(String(100), nullable=False)

    # 时间戳
    created_at = Column(DateTime, default=utc_now)

    # 关系
    filter = relationship("DashboardFilter", back_populates="bindings")
    card = relationship("DashboardCard", back_populates="filter_bindings")

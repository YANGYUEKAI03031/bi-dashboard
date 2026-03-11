# app/models/permission.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base
import enum


class RoleEnum(str, enum.Enum):
    """用户角色"""
    ADMIN = "admin"
    USER = "user"


class UserRole(Base):
    """用户角色表"""
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False, unique=True)
    role = Column(String(20), default=RoleEnum.USER.value, nullable=False)  # admin 或 user
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    user = relationship("User", backref="user_role")


class ResourceTypeEnum(str, enum.Enum):
    """资源类型"""
    CHART = "chart"
    DASHBOARD = "dashboard"
    REPORT_PAGE = "report_page"


class ReportPagePermission(Base):
    """报表查看权限表 - 控制谁能看哪些报表"""
    __tablename__ = "report_page_permissions"

    id = Column(Integer, primary_key=True, index=True)
    report_page_id = Column(Integer, ForeignKey("report_pages.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    can_view = Column(Boolean, default=True)  # 是否可以查看
    can_edit = Column(Boolean, default=False)  # 是否可以编辑（包括图表、仪表盘）
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 关系
    report_page = relationship("ReportPage", backref="permissions")
    user = relationship("User")


class ModificationLog(Base):
    """修改记录表 - 记录谁在什么时候对什么资源做了什么操作"""
    __tablename__ = "modification_logs"

    id = Column(Integer, primary_key=True, index=True)
    
    # 操作者
    user_id = Column(Integer, ForeignKey("useraccount.userID"), nullable=False)
    
    # 资源信息
    resource_type = Column(String(20), nullable=False)  # chart, dashboard, report_page
    resource_id = Column(Integer, nullable=False)
    resource_name = Column(String(255))  # 资源名称（方便展示）
    
    # 操作类型
    action = Column(String(50), nullable=False)  # create, update, delete, view
    
    # 修改详情（JSON格式存储修改前后的变化）
    changes = Column(Text)  # JSON: {"old": {...}, "new": {...}}
    
    # 时间
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系
    user = relationship("User", backref="modification_logs")

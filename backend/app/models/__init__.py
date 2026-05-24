# backend/app/models/__init__.py
"""Database models package."""

# User models
from app.models.user import User

# Permission models
from app.models.permission import UserRole, RoleEnum, ReportPagePermission, ModificationLog

# Visualization models
from app.models.visualization import (
    VisualizationCard,
    Database,
)

# Dashboard models
from app.models.dashboard import (
    Dashboard,
    DashboardCard,
    DashboardTab,
    DashboardFilter,
    DashboardFilterBinding,
)

# Pipeline models
from app.models.pipeline import (
    DataPipeline,
    PipelineExecution,
    PipelineWatermark,
    PipelineDependency,
    PipelineTrigger,
)

# Report page models
from app.models.report_page import ReportPage, ReportPageDashboard

# Data source models
from app.models.data_source import ProcessedDataset

# Re-export Base for migrations
from app.db.base import Base

__all__ = [
    # Base
    "Base",
    # User
    "User",
    # Permission
    "UserRole",
    "RoleEnum",
    "ReportPagePermission",
    "ModificationLog",
    # Visualization
    "VisualizationCard",
    "Database",
    # Dashboard
    "Dashboard",
    "DashboardCard",
    "DashboardTab",
    "DashboardFilter",
    "DashboardFilterBinding",
    # Pipeline
    "DataPipeline",
    "PipelineExecution",
    "PipelineWatermark",
    "PipelineDependency",
    "PipelineTrigger",
    # Report page
    "ReportPage",
    "ReportPageDashboard",
    # Data source
    "ProcessedDataset",
]

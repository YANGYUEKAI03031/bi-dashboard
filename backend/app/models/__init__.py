# backend/app/models/__init__.py
"""Database models package."""

# User models
# Re-export Base for migrations
from app.db.base import Base

# Dashboard models
from app.models.dashboard import (
    Dashboard,
    DashboardCard,
    DashboardFilter,
    DashboardFilterBinding,
    DashboardTab,
)

# Data source models
from app.models.data_source import ProcessedDataset

# Permission models
from app.models.permission import ModificationLog, ReportPagePermission, RoleEnum, UserRole

# Pipeline models
from app.models.pipeline import (
    DataPipeline,
    PipelineDependency,
    PipelineExecution,
    PipelineTrigger,
    PipelineWatermark,
)

# Report page models
from app.models.report_page import ReportPage, ReportPageDashboard
from app.models.user import User

# Visualization models
from app.models.visualization import (
    Database,
    VisualizationCard,
)

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

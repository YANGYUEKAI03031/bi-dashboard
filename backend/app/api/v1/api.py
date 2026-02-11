from fastapi import APIRouter
from app.api.v1 import auth, charts, dashboards, datasources

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(charts.router, prefix="/visualization", tags=["charts"])
api_router.include_router(dashboards.router, prefix="/dashboards", tags=["dashboards"])
api_router.include_router(datasources.router, prefix="/visualization", tags=["datasources"])
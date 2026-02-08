# app/api/v1/api.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.data_chain import router as data_chain_router
# 注册数据链路由

api_router = APIRouter()

# 注册认证路由
api_router.include_router(auth_router, prefix="/auth", tags=["认证"])
api_router.include_router(data_chain_router, prefix="/data", tags=["数据链"])
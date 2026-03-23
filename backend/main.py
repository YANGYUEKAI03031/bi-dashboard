# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.core.config import settings
from app.api.v1.api import api_router
from app.db.session import engine
from app.db.base import Base
from fastapi.middleware.cors import CORSMiddleware
# 创建FastAPI应用实例
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="BI仪表板后端API服务",
    version=settings.PROJECT_VERSION,
    debug=settings.DEBUG
)

# 添加CORS中间件 - 允许所有来源（内网部署使用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含API路由（只调用一次）
app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_event():
    """应用启动时的初始化"""
    print("应用正在启动...")
    # 注意：在生产环境中，建议手动运行init_mysql_db.py来初始化数据库
    # 这里可以添加其他启动时需要执行的任务


# 根路径端点
@app.get("/")
async def root():
    """
    API根路径
    返回欢迎信息
    """
    return {
        "message": "欢迎使用BI Dashboard API!", 
        "version": settings.PROJECT_VERSION,
        "docs": "/docs"
    }


# 健康检查端点
@app.get("/health")
async def health_check():
    """
    健康检查端点
    用于监控服务状态
    """
    return {
        "status": "healthy",
        "service": "bi-dashboard-api",
        "version": settings.PROJECT_VERSION
    }


if __name__ == "__main__":
    # 运行开发服务器
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
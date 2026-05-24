# app/main_optimized.py
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import logging
import traceback
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.cache import cache_service
from app.services.realtime_sync import realtime_service
from app.api.v1.api import api_router
from app.exceptions import AppException

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def _init_database_tables():
    """在 uvicorn 事件循环内执行数据库初始化（表由 init_mysql_db.py 创建，此处仅做健康检查）"""
    pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时执行
    logger.info("Starting application...")

    # 初始化数据库增强表（在 uvicorn 事件循环内执行，避免事件循环冲突）
    await _init_database_tables()

    # 启动 Pipeline 触发调度器
    from app.core.scheduler import init_scheduler
    init_scheduler()
    logger.info("Pipeline 触发调度器已启动")

    # 连接缓存服务
    await cache_service.connect()

    # 启动实时同步服务
    await realtime_service.start()

    yield

    # 关闭时执行
    logger.info("Shutting down application...")

    # 关闭调度器
    from app.core.scheduler import shutdown_scheduler
    shutdown_scheduler()

    # 停止实时同步服务
    await realtime_service.stop()

    # 断开缓存连接
    await cache_service.disconnect()


# 创建FastAPI应用
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    lifespan=lifespan
)


# ============================================
# 全局异常处理器（必须在 app 创建后注册）
# ============================================

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """处理自定义应用异常"""
    logger.warning(f"AppException: [{exc.code}] {exc.message}", exc_info=False)
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """处理 FastAPI HTTPException（保持原有格式兼容）"""
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": f"HTTP_{exc.status_code}",
            "message": str(exc.detail),
            "details": {},
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """处理所有未捕获的异常（防止堆栈泄露）"""
    error_id = f"ERR-{id(exc):08x}"
    logger.error(f"Unhandled exception {error_id}: {exc}", exc_info=True)

    if settings.DEBUG:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "code": "INTERNAL_ERROR",
                "message": str(exc),
                "details": {
                    "error_id": error_id,
                    "traceback": traceback.format_exc(),
                },
            },
        )
    else:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "code": "INTERNAL_ERROR",
                "message": "服务器内部错误，请联系管理员",
                "details": {"error_id": error_id},
            },
        )


# 配置CORS - 允许所有来源（内网部署使用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含API路由
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    """健康检查端点"""
    db_healthy = await check_database_health()
    cache_healthy = cache_service.connected

    return {
        "status": "healthy" if (db_healthy and cache_healthy) else "unhealthy",
        "database": "connected" if db_healthy else "disconnected",
        "cache": "connected" if cache_healthy else "disconnected",
        "timestamp": "2026-02-04T13:07:02"
    }


@app.get("/stats")
async def get_system_stats():
    """获取系统统计信息"""
    return {
        "active_connections": len(realtime_service.connections),
        "monitored_tables": list(realtime_service.watchers.keys()),
        "cache_status": cache_service.connected,
        "uptime": "running"
    }


async def check_database_health():
    """检查数据库连接健康状态"""
    try:
        from app.db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            result = await session.execute("SELECT 1")
            return result.scalar() == 1
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False


if __name__ == "__main__":
    uvicorn.run(
        "app.main_optimized:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="info"
    )

"""Pipeline 触发调度器 - APScheduler 定时调度

每分钟执行一次 poll_pipeline_triggers()，由 TriggerScheduler 内部判断各 trigger 的轮询间隔条件。
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

# 全局调度器实例
scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")


async def poll_pipeline_triggers() -> int:
    """
    Pipeline 触发轮询任务

    Returns:
        本次触发的 pipeline 数量
    """
    from app.db.session import AsyncSessionLocal
    from app.services.pipeline.trigger_scheduler import TriggerScheduler

    logger.info("=== 触发器轮询任务开始 ===")

    triggered = 0
    try:
        async with AsyncSessionLocal() as db:
            svc = TriggerScheduler(db)
            triggered = await svc.poll_all_triggers()

            if triggered:
                logger.info(f"Pipeline 触发轮询完成，本次触发 {triggered} 条")

    except Exception as e:
        logger.error(f"Pipeline 触发轮询出错: {e}", exc_info=True)

    logger.info(f"=== 触发器轮询任务结束，返回 {triggered} ===")
    return triggered


def init_scheduler() -> AsyncIOScheduler:
    """
    初始化并返回调度器

    Returns:
        已启动的调度器实例
    """
    # 每 1 分钟执行一次，由 TriggerScheduler 内部判断各 trigger 的 poll_interval_seconds 条件
    scheduler.add_job(
        poll_pipeline_triggers,
        IntervalTrigger(minutes=1),
        id="pipeline_trigger_poll",
        replace_existing=True,
        misfire_grace_time=60,  # 允许最多延迟 60 秒
    )

    scheduler.start()
    logger.info("Pipeline 触发调度器已启动（每 1 分钟轮询一次）")

    return scheduler


def shutdown_scheduler() -> None:
    """关闭调度器"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Pipeline 触发调度器已关闭")

# test_trigger.py - Pipeline 触发器测试脚本
"""快速测试触发器轮询是否正常工作"""
import asyncio
from app.db.session import AsyncSessionLocal

# 先导入所有模型，避免 SQLAlchemy relationship 加载错误
from app.models.user import User
from app.models.dashboard import Dashboard, DashboardCard, DashboardTab, DashboardFilter, DashboardFilterBinding
from app.models.visualization import VisualizationCard, Database
from app.models.report_page import ReportPage, ReportPageDashboard
from app.models.permission import UserRole, ReportPagePermission, ModificationLog
from app.models.pipeline import DataPipeline, PipelineExecution, PipelineWatermark, PipelineTrigger

from app.services.pipeline.trigger_scheduler import TriggerScheduler


async def test_trigger():
    """执行一次轮询测试"""
    print("=" * 50)
    print("Pipeline 触发器轮询测试")
    print("=" * 50)

    async with AsyncSessionLocal() as db:
        scheduler = TriggerScheduler(db)

        # 执行一次轮询
        print("\n正在执行轮询...")
        triggered_count = await scheduler.poll_all_triggers()

        print(f"\n轮询完成！")
        print(f"本次触发数量: {triggered_count}")

        # 关闭引擎
        await scheduler.close_all_engines()

        return triggered_count


async def test_specific_trigger(pipeline_id: int):
    """测试指定管道的触发器"""
    print("=" * 50)
    print(f"测试 Pipeline {pipeline_id} 的触发器")
    print("=" * 50)

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        from app.models.pipeline import PipelineTrigger, DataPipeline

        # 获取 pipeline
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            print(f"Pipeline {pipeline_id} 不存在！")
            return

        # 获取触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if not trigger:
            print(f"Pipeline {pipeline_id} 未配置触发器！")
            print(f"提示: POST /api/v1/pipeline/{pipeline_id}/trigger 创建触发器")
            return

        scheduler = TriggerScheduler(db)

        # 测试查询当前水位
        print(f"\n触发器配置:")
        print(f"  源表: {trigger.source_table}")
        print(f"  监控字段: {trigger.watermark_field}")
        print(f"  轮询间隔: {trigger.poll_interval_seconds} 秒")
        print(f"  启用状态: {'是' if trigger.enabled else '否'}")
        print(f"  上次水位值: {trigger.last_watermark_value}")
        print(f"  上次检查时间: {trigger.last_check_at}")

        # 查询当前 MAX 值
        current_max = await scheduler._get_current_max_value(trigger, pipeline.source_data_source_id)
        print(f"\n当前源表 MAX({trigger.watermark_field}): {current_max}")

        # 判断是否有新数据
        has_new = scheduler._has_new_data(trigger, current_max) if current_max else False
        print(f"是否有新数据: {'是' if has_new else '否'}")

        # 检查 pipeline 是否在运行
        is_running = await scheduler._is_pipeline_running(pipeline_id)
        print(f"Pipeline 是否正在运行: {'是' if is_running else '否'}")

        # 关闭引擎
        await scheduler.close_all_engines()


async def list_all_pipelines():
    """列出所有 pipeline 及其触发器状态"""
    print("=" * 60)
    print("所有 Pipeline 及触发器状态")
    print("=" * 60)

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        from app.models.pipeline import DataPipeline, PipelineTrigger

        # 查询所有 pipeline
        stmt = select(DataPipeline).order_by(DataPipeline.id)
        result = await db.execute(stmt)
        pipelines = result.scalars().all()

        print(f"\n总共 {len(pipelines)} 个 Pipeline:\n")
        print(f"{'ID':<5} {'名称':<30} {'触发器':<10} {'启用':<6}")
        print("-" * 55)

        for p in pipelines:
            trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == p.id)
            trigger_result = await db.execute(trigger_stmt)
            trigger = trigger_result.scalar_one_or_none()

            if trigger:
                trigger_info = f"✓ {trigger.source_table}"
                enabled = "是" if trigger.enabled else "否"
            else:
                trigger_info = "✗ 未配置"
                enabled = "-"

            print(f"{p.id:<5} {p.name[:28]:<30} {trigger_info:<10} {enabled:<6}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        if sys.argv[1] == "--list":
            asyncio.run(list_all_pipelines())
        else:
            pipeline_id = int(sys.argv[1])
            asyncio.run(test_specific_trigger(pipeline_id))
    else:
        asyncio.run(test_trigger())

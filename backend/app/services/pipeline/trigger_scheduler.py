"""Pipeline 触发调度器 - 定时轮询源表高水位，有新数据时触发 Pipeline 运行

核心逻辑：
1. 每分钟由 APScheduler 调度 poll_all_triggers()
2. 对每个 enabled=True 的 trigger，执行 SELECT MAX(watermark_field), COUNT(*) FROM source_table
3. 同时监控 MAX(updated_at) 变化 和 COUNT(*) 变化，任一有变化则触发
4. 触发成功后更新 last_watermark_value 和 last_row_count

安全说明：
- SELECT MAX()/COUNT() 查的是已提交数据行，不存在 binlog 的事务未提交问题
- 防并发：检查 pipeline 是否正在运行，若正在运行则跳过本次触发
"""
import logging
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession, AsyncEngine, create_async_engine

from app.models.pipeline import PipelineTrigger, PipelineExecution, DataPipeline
from app.models.visualization import Database

logger = logging.getLogger(__name__)


def _build_mysql_url(db_model: Database) -> str:
    """根据 Database 记录构建异步 MySQL 连接 URL"""
    return (
        f"mysql+aiomysql://{db_model.username}:{db_model.password}"
        f"@{db_model.host}:{db_model.port}/{db_model.database_name}"
    )


def _run_pipeline_in_thread(pipeline_id: int, execution_id: int, source_data_url: str):
    """在线程中运行异步 pipeline 执行"""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select, update
    from app.core.config import settings
    from app.services.pipeline_service import PipelineService
    from app.services.pipeline.engine import PipelineEngine
    from app.models.pipeline import PipelineExecution

    async def _async_run():
        app_engine = None
        data_source_engine = None

        try:
            app_engine = create_async_engine(
                settings.DATABASE_URL,
                pool_size=3,
                max_overflow=5,
                pool_recycle=1800,
                pool_pre_ping=True,
            )
            data_source_engine = create_async_engine(
                source_data_url,
                pool_size=3,
                max_overflow=5,
                pool_recycle=1800,
                pool_pre_ping=True,
            )
            SessionLocal = sessionmaker(
                app_engine, class_=AsyncSession, expire_on_commit=False
            )

            async with SessionLocal() as session:
                service = PipelineService(session)
                pipeline = await service.get_pipeline(pipeline_id)
                execution = await service.get_execution(execution_id)

                if not pipeline or not execution:
                    logger.error(
                        f"管道或执行记录不存在: pipeline={pipeline_id}, execution={execution_id}"
                    )
                    return

                # 更新状态为 running
                await session.execute(
                    update(PipelineExecution)
                    .where(PipelineExecution.id == execution_id)
                    .values(status="running")
                )
                await session.commit()

                pipeline_engine = PipelineEngine(
                    session, data_source_engine, pipeline.source_data_source_id
                )

                success, error_msg, result_summary = await pipeline_engine.run(
                    pipeline=pipeline,
                    execution=execution,
                    config=pipeline.config,
                )

                # 更新最终状态
                final_status = "completed" if success else "failed"
                await session.execute(
                    update(PipelineExecution)
                    .where(PipelineExecution.id == execution_id)
                    .values(
                        status=final_status,
                        error_message=error_msg if not success else None,
                    )
                )
                await session.commit()

                logger.info(
                    f"触发器后台执行完成: pipeline={pipeline_id}, execution={execution_id}, success={success}"
                )

                # 成功后同步图表
                if success and pipeline.nodes:
                    try:
                        from app.services.pipeline_chart_sync_service import PipelineChartSyncService
                        sync_svc = PipelineChartSyncService(session)
                        nodes_list = pipeline.nodes if isinstance(pipeline.nodes, list) else []
                        count, _ = await sync_svc.sync_pipeline_charts(
                            pipeline_id=pipeline_id,
                            nodes=nodes_list,
                        )
                        logger.info(f"图表同步完成: {count} 条")
                    except Exception as sync_err:
                        logger.warning(f"图表同步失败: {sync_err}")

        except Exception as e:
            logger.error(f"触发器后台执行管道失败: {e}")
            try:
                if app_engine:
                    async with app_engine.connect() as conn:
                        await conn.execute(
                            update(PipelineExecution)
                            .where(PipelineExecution.id == execution_id)
                            .values(status="failed", error_message=str(e))
                        )
                        await conn.commit()
            except:
                pass
        finally:
            if app_engine:
                await app_engine.dispose()
            if data_source_engine:
                await data_source_engine.dispose()

    # 创建新的 event loop 来运行异步函数
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_async_run())
    finally:
        loop.close()


class TriggerScheduler:
    """轮询所有 PipelineTrigger，满足条件时触发对应 Pipeline 运行"""

    def __init__(self, db: AsyncSession):
        """
        Args:
            db: 数据库会话
        """
        self.db = db
        # 缓存数据源 engine，避免重复创建
        self._engine_cache: Dict[int, AsyncEngine] = {}

    async def _get_data_source_engine(self, data_source_id: int) -> Optional[AsyncEngine]:
        """获取数据源的连接引擎，带缓存"""
        if data_source_id in self._engine_cache:
            return self._engine_cache[data_source_id]

        # 从数据库获取数据源信息
        db_model = await self.db.get(Database, data_source_id)
        if not db_model or not db_model.is_active:
            logger.warning(f"数据源 {data_source_id} 不存在或已停用")
            return None

        if (db_model.engine or "").lower() != "mysql":
            logger.warning(f"数据源 {data_source_id} 类型 {db_model.engine} 暂不支持")
            return None

        try:
            db_url = _build_mysql_url(db_model)
            engine = create_async_engine(db_url, pool_pre_ping=True)
            self._engine_cache[data_source_id] = engine
            return engine
        except Exception as e:
            logger.error(f"创建数据源 {data_source_id} 引擎失败: {e}")
            return None

    async def close_all_engines(self) -> None:
        """关闭所有缓存的引擎"""
        for engine in self._engine_cache.values():
            await engine.dispose()
        self._engine_cache.clear()

    async def poll_all_triggers(self) -> int:
        """
        扫描所有 enabled=True 的触发器，返回本次触发的 pipeline 数量
        """
        triggered_count = 0

        try:
            # 1. 查询所有 enabled=True 的 trigger
            triggers = await self._get_enabled_triggers()

            if not triggers:
                logger.info("当前没有启用的触发器")
                return 0

            logger.info(f"轮询 {len(triggers)} 个触发器...")

            for trigger in triggers:
                try:
                    triggered = await self._process_trigger(trigger)
                    if triggered:
                        triggered_count += 1
                except Exception as e:
                    logger.error(f"处理 trigger {trigger.id} 失败: {e}", exc_info=True)

            if triggered_count > 0:
                logger.info(f"本次轮询完成，共触发 {triggered_count} 个 pipeline")
            else:
                logger.debug(f"本次轮询完成，无触发")

        except Exception as e:
            logger.error(f"轮询触发器失败: {e}", exc_info=True)
        finally:
            # 确保关闭所有缓存的引擎
            await self.close_all_engines()

        return triggered_count

    async def _get_enabled_triggers(self) -> list[PipelineTrigger]:
        """获取所有启用的触发器"""
        stmt = select(PipelineTrigger).where(PipelineTrigger.enabled == True)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _process_trigger(self, trigger: PipelineTrigger) -> bool:
        """
        处理单个触发器
        Returns:
            是否触发了 pipeline 运行
        """
        # 1. 检查是否满足轮询间隔
        if not self._should_poll(trigger):
            return False

        # 1.5 记录本次检查时间（每次轮询都记录）
        await self._record_check_time(trigger)

        # 2. 获取 pipeline 信息
        pipeline = await self._get_pipeline(trigger.pipeline_id)
        if not pipeline:
            logger.warning(f"Pipeline {trigger.pipeline_id} 不存在，跳过 trigger {trigger.id}")
            return False

        # 3. 从源库查询 MAX 和行数
        current_max, current_count = await self._get_source_metrics(trigger, pipeline.source_data_source_id)
        if current_max is None:
            logger.warning(f"查询源表 {trigger.source_table} 指标失败")
            return False

        logger.info(
            f"触发器 {trigger.id} 检查: {trigger.source_table}.{trigger.watermark_field} "
            f"MAX={current_max}, COUNT={current_count}, "
            f"上次水位={trigger.last_watermark_value}, 上次行数={trigger.last_row_count}"
        )

        # 4. 检查是否有变更
        has_changes, needs_init = self._has_new_data(trigger, current_max, current_count)

        if not has_changes:
            if needs_init:
                logger.info(f"触发器 {trigger.id} 初始化/补充记录行数: MAX={current_max}, COUNT={current_count}")
                await self._update_trigger_state(trigger, current_max, current_count)
            return False

        # 5. 检查 pipeline 是否正在运行
        if await self._is_pipeline_running(trigger.pipeline_id):
            logger.info(f"Pipeline {trigger.pipeline_id} 正在运行，本次轮询跳过")
            return False

        # 6. 触发 pipeline 运行
        old_watermark = trigger.last_watermark_value
        old_count = trigger.last_row_count
        execution = await self._trigger_pipeline_run(trigger.pipeline_id)

        # 7. 更新触发器状态
        await self._update_trigger_state(trigger, current_max, current_count)

        logger.info(
            f"触发 Pipeline {trigger.pipeline_id}: "
            f"{trigger.source_table} MAX {old_watermark} -> {current_max}, "
            f"COUNT {old_count} -> {current_count}, "
            f"execution_id={execution.id if execution else 'N/A'}"
        )

        return True

    def _should_poll(self, trigger: PipelineTrigger) -> bool:
        """检查是否满足轮询间隔"""
        if trigger.last_check_at is None:
            logger.info(f"触发器 {trigger.id} 首次检查，执行轮询")
            return True

        elapsed = (datetime.utcnow() - trigger.last_check_at).total_seconds()
        can_poll = elapsed >= trigger.poll_interval_seconds
        if not can_poll:
            remaining = trigger.poll_interval_seconds - elapsed
            logger.info(f"触发器 {trigger.id} 距上次检查 {elapsed:.0f}秒，还需等待 {remaining:.0f}秒")
        return can_poll

    async def _record_check_time(self, trigger: PipelineTrigger) -> None:
        """记录本次检查时间（只更新 last_check_at）"""
        now = datetime.utcnow()
        stmt = (
            update(PipelineTrigger)
            .where(PipelineTrigger.id == trigger.id)
            .values(last_check_at=now)
        )
        await self.db.execute(stmt)
        await self.db.commit()
        trigger.last_check_at = now

    async def _get_pipeline(self, pipeline_id: int) -> Optional[DataPipeline]:
        """获取 pipeline 信息"""
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_source_metrics(
        self,
        trigger: PipelineTrigger,
        data_source_id: int
    ) -> tuple[Optional[str], Optional[int]]:
        """
        从源库查询 MAX(watermark_field) 和 COUNT(*)

        Returns:
            (max_watermark, row_count) - 任意一个为 None 表示查询失败
        """
        engine = await self._get_data_source_engine(data_source_id)
        if engine is None:
            return None, None

        try:
            safe_table = trigger.source_table.replace("`", "")
            safe_field = trigger.watermark_field.replace("`", "")

            sql = f"SELECT MAX(`{safe_field}`), COUNT(*) FROM `{safe_table}`"

            async with engine.connect() as conn:
                result = await conn.execute(text(sql))
                row = result.fetchone()

                if row:
                    max_value = row[0]
                    row_count = row[1]

                    # 转换 MAX 值为字符串
                    if max_value is not None and hasattr(max_value, 'isoformat'):
                        max_value = max_value.isoformat()
                    elif max_value is not None:
                        max_value = str(max_value)
                    else:
                        max_value = None

                    return max_value, int(row_count) if row_count is not None else 0

                return None, 0

        except Exception as e:
            logger.error(f"查询源表 {trigger.source_table} 指标失败: {e}", exc_info=True)
            return None, None
        finally:
            await engine.dispose()

    def _has_new_data(
        self,
        trigger: PipelineTrigger,
        current_max: Optional[str],
        current_count: int
    ) -> tuple[bool, bool]:
        """
        检查是否有数据变更（新增/更新/删除）

        Returns:
            (has_changes, needs_init) - needs_init 表示需要初始化行数记录
        """
        # 首次运行：水位和行数都是 None
        if trigger.last_watermark_value is None and trigger.last_row_count is None:
            return False, True

        # 初始化行数：如果已有水位但没有行数，先初始化行数
        if trigger.last_row_count is None:
            return False, True

        # 检查 MAX(updated_at) 变化
        max_changed = current_max is not None and current_max != trigger.last_watermark_value

        # 检查 COUNT(*) 变化（检测删除）
        count_changed = current_count != trigger.last_row_count

        return max_changed or count_changed, False

    async def _is_pipeline_running(self, pipeline_id: int) -> bool:
        """检查 pipeline 是否正在运行"""
        stmt = select(PipelineExecution).where(
            PipelineExecution.pipeline_id == pipeline_id,
            PipelineExecution.status == "running"
        )
        result = await self.db.execute(stmt)
        running = result.scalar_one_or_none()
        return running is not None

    async def _trigger_pipeline_run(self, pipeline_id: int) -> Optional[PipelineExecution]:
        """触发 pipeline 运行，创建执行记录并启动后台任务"""
        try:
            # 创建执行记录
            execution = PipelineExecution(
                pipeline_id=pipeline_id,
                status="pending",
            )
            self.db.add(execution)
            await self.db.commit()
            await self.db.refresh(execution)

            # 启动后台执行任务
            await self._start_pipeline_execution(pipeline_id, execution.id)

            return execution

        except Exception as e:
            logger.error(f"创建执行记录失败: {e}", exc_info=True)
            await self.db.rollback()
            return None

    async def _start_pipeline_execution(self, pipeline_id: int, execution_id: int):
        """启动 pipeline 后台执行"""
        try:
            from app.models.visualization import Database
            import asyncio

            # 获取数据源 URL
            pipeline_stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
            result = await self.db.execute(pipeline_stmt)
            pipeline = result.scalar_one_or_none()

            if not pipeline:
                logger.error(f"Pipeline {pipeline_id} 不存在")
                return

            ds_stmt = select(Database).where(Database.id == pipeline.source_data_source_id)
            ds_result = await self.db.execute(ds_stmt)
            db_model = ds_result.scalar_one_or_none()

            if not db_model:
                logger.error(f"数据源 {pipeline.source_data_source_id} 不存在")
                return

            source_data_url = _build_mysql_url(db_model)

            # 在独立线程中启动后台任务（避免 event loop 嵌套问题）
            loop = asyncio.get_event_loop()
            loop.run_in_executor(
                None,
                _run_pipeline_in_thread,
                pipeline_id,
                execution_id,
                source_data_url,
            )
            logger.info(f"已启动 pipeline {pipeline_id} 后台执行，execution_id={execution_id}")

        except Exception as e:
            logger.error(f"启动 pipeline 执行失败: {e}", exc_info=True)

    async def _update_trigger_state(
        self,
        trigger: PipelineTrigger,
        watermark_value: str,
        row_count: int
    ) -> None:
        """更新触发器状态（水位、行数、时间）"""
        logger.info(f"更新触发器 {trigger.id} 状态: MAX={watermark_value}, COUNT={row_count}")

        now = datetime.utcnow()
        stmt = (
            update(PipelineTrigger)
            .where(PipelineTrigger.id == trigger.id)
            .values(
                last_watermark_value=watermark_value,
                last_row_count=row_count,
                last_check_at=now,
            )
        )
        result = await self.db.execute(stmt)
        await self.db.commit()

        trigger.last_watermark_value = watermark_value
        trigger.last_row_count = row_count
        trigger.last_check_at = now

        logger.info(f"更新完成，影响行数: {result.rowcount}")

    async def check_source_table_index(
        self,
        data_source_id: int,
        source_table: str,
        watermark_field: str
    ) -> tuple[bool, str]:
        """
        检查源表监控字段是否有索引

        Returns:
            (has_index, message)
        """
        engine = await self._get_data_source_engine(data_source_id)
        if engine is None:
            return False, f"数据源 {data_source_id} 的 engine 不存在"

        try:
            sql = f"SHOW INDEX FROM `{source_table}` WHERE Column_name = '{watermark_field}'"

            async with engine.connect() as conn:
                result = await conn.execute(text(sql))
                rows = result.fetchall()

                if rows:
                    return True, f"字段 '{watermark_field}' 已建立索引"
                else:
                    return False, (
                        f"源表 '{source_table}' 的字段 '{watermark_field}' 未建立索引，"
                        f"轮询时会进行全表扫描，建议执行："
                        f"ALTER TABLE {source_table} ADD INDEX idx_{watermark_field} ({watermark_field});"
                    )

        except Exception as e:
            logger.error(f"检查索引失败: {e}")
            return False, f"检查索引时出错: {str(e)}"

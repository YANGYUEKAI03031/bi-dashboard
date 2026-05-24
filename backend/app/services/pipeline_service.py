# backend/app/services/pipeline_service.py
"""数据管道 (Pipeline) 服务层"""
import json
import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession, AsyncEngine
from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.exc import SQLAlchemyError

from app.core.time_utils import utc_now

from app.models.pipeline import DataPipeline, PipelineExecution
from app.models.visualization import Database
from app.services.pipeline.temp_table_manager import TempTableManager
from app.services.pipeline.engine import PipelineEngine
from app.core.security import get_current_user_id

logger = logging.getLogger(__name__)


class PipelineService:
    """数据管道服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== Pipeline CRUD ====================

    async def _assert_pipeline_business_data_source(self, source_data_source_id: int) -> None:
        """
        管道必须使用「业务库」：按 ID 升序后的第一个已激活数据源视为系统默认库，禁止作为管道源。
        与数据源管理页「首条不可删」的约定一致。
        """
        stmt_default = (
            select(Database.id)
            .where(Database.is_active == True)  # noqa: E712
            .order_by(Database.id.asc())
            .limit(1)
        )
        res_default = await self.db.execute(stmt_default)
        default_id = res_default.scalar_one_or_none()
        if default_id is not None and int(source_data_source_id) == int(default_id):
            raise ValueError("管道须使用业务数据源，不能使用系统默认数据源")

        stmt_ok = select(Database.id).where(
            Database.id == source_data_source_id,
            Database.is_active == True,  # noqa: E712
        )
        res_ok = await self.db.execute(stmt_ok)
        if res_ok.scalar_one_or_none() is None:
            raise ValueError("数据源不存在或已禁用")

    async def create_pipeline(
        self,
        name: str,
        source_data_source_id: int,
        nodes: List[Dict[str, Any]],
        user_id: int,
        description: Optional[str] = None,
        variables: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
        is_public: bool = False
    ) -> DataPipeline:
        """创建新管道"""
        try:
            await self._assert_pipeline_business_data_source(source_data_source_id)

            pipeline = DataPipeline(
                name=name,
                description=description,
                source_data_source_id=source_data_source_id,
                nodes=nodes,
                variables=variables or {},
                config=config or {},
                is_active=True,
                created_by=user_id,
                is_public=is_public
            )

            self.db.add(pipeline)
            await self.db.commit()
            await self.db.refresh(pipeline)

            logger.info(f"创建管道成功: {name} (ID: {pipeline.id})")
            return pipeline

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建管道失败: {e}")
            raise Exception(f"创建管道失败: {str(e)}")

    async def get_pipeline(self, pipeline_id: int) -> Optional[DataPipeline]:
        """获取管道详情"""
        try:
            stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()
        except SQLAlchemyError as e:
            logger.error(f"获取管道失败: {e}")
            raise Exception(f"获取管道失败: {str(e)}")

    async def get_user_pipelines(
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 100,
        include_public: bool = True
    ) -> Tuple[List[DataPipeline], int]:
        """获取用户可访问的管道列表"""
        try:
            # 构建查询条件
            conditions = []
            if include_public:
                conditions.append(
                    (DataPipeline.created_by == user_id) | (DataPipeline.is_public == True)
                )
            else:
                conditions.append(DataPipeline.created_by == user_id)

            # 获取总数
            count_stmt = select(func.count(DataPipeline.id)).where(and_(*conditions))
            count_result = await self.db.execute(count_stmt)
            total = count_result.scalar() or 0

            # 获取列表
            stmt = (
                select(DataPipeline)
                .where(and_(*conditions))
                .where(DataPipeline.is_active == True)
                .order_by(DataPipeline.updated_at.desc())
                .offset(skip)
                .limit(limit)
            )
            result = await self.db.execute(stmt)
            pipelines = list(result.scalars().all())

            return pipelines, total

        except SQLAlchemyError as e:
            logger.error(f"获取管道列表失败: {e}")
            raise Exception(f"获取管道列表失败: {str(e)}")

    async def update_pipeline(
        self,
        pipeline_id: int,
        user_id: int,
        **update_fields
    ) -> Optional[DataPipeline]:
        """更新管道"""
        try:
            pipeline = await self.get_pipeline(pipeline_id)
            if not pipeline:
                return None

            # 权限检查：仅创建者可以更新
            if pipeline.created_by != user_id:
                raise PermissionError("无权限更新此管道")

            # 更新字段
            allowed_fields = {
                'name', 'description', 'nodes', 'variables',
                'config', 'is_active', 'is_public', 'source_data_source_id',
            }
            update_data = {}

            for key, value in update_fields.items():
                if key in allowed_fields and value is not None:
                    if key == 'nodes' and isinstance(value, list):
                        update_data[key] = value
                    elif key != 'nodes':
                        update_data[key] = value

            if update_data:
                # 检测被删除的 chart 节点和 output 节点
                deleted_chart_nodes = []
                deleted_output_nodes = []  # {node_id: target_table_name}
                if 'nodes' in update_fields:
                    old_nodes = getattr(pipeline, 'nodes', []) or []
                    if isinstance(old_nodes, str):
                        import json
                        try:
                            old_nodes = json.loads(old_nodes)
                        except json.JSONDecodeError:
                            old_nodes = []
                    old_chart_ids = {n.get('id') for n in old_nodes if n.get('type') == 'chart'}
                    new_chart_ids = {n.get('id') for n in update_fields['nodes'] if n.get('type') == 'chart'}
                    deleted_chart_nodes = list(old_chart_ids - new_chart_ids)

                    # 检测被删除的 output 节点及其目标表
                    old_output_nodes = {
                        n.get('id'): n.get('config', {}).get('targetTable', '')
                        for n in old_nodes if n.get('type') == 'output'
                    }
                    new_output_ids = {n.get('id') for n in update_fields['nodes'] if n.get('type') == 'output'}
                    for node_id, target_table in old_output_nodes.items():
                        if node_id not in new_output_ids and target_table:
                            deleted_output_nodes.append({'node_id': node_id, 'target_table': target_table})

                update_data['updated_at'] = utc_now()
                stmt = (
                    update(DataPipeline)
                    .where(DataPipeline.id == pipeline_id)
                    .values(**update_data)
                )
                await self.db.execute(stmt)
                await self.db.commit()
                await self.db.refresh(pipeline)

                # 归档被删除的 chart 节点关联的图表
                if deleted_chart_nodes:
                    try:
                        from app.services.chart_service import ChartService
                        chart_service = ChartService(self.db)
                        for node_id in deleted_chart_nodes:
                            await chart_service.archive_chart_by_node(pipeline_id, node_id)
                            logger.info(f"更新管道时归档已删除节点的图表: pipeline_id={pipeline_id}, node_id={node_id}")
                    except Exception as archive_err:
                        logger.warning(f"更新管道时归档图表失败: {archive_err}")

                # 删除被删除的 output 节点对应的目标表
                if deleted_output_nodes:
                    logger.info(f"=== 检测到 {len(deleted_output_nodes)} 个 OUTPUT 节点被删除 ===")
                    try:
                        from sqlalchemy import text
                        from app.services.chart_service import _get_db_engine
                        source_ds_id = pipeline.source_data_source_id
                        if source_ds_id:
                            db_model = await self.db.get(Database, source_ds_id)
                            if db_model:
                                engine = await _get_db_engine(db_model)
                                async with engine.connect() as conn:
                                    for item in deleted_output_nodes:
                                        target_table = item['target_table']
                                        node_id = item['node_id']
                                        logger.info(f"准备删除 OUTPUT 节点目标表: pipeline_id={pipeline_id}, node_id={node_id}, table={target_table}")
                                        try:
                                            check_res = await conn.execute(text(
                                                "SELECT COUNT(*) FROM information_schema.TABLES "
                                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tbl"
                                            ), {"tbl": target_table})
                                            if check_res.fetchone()[0] > 0:
                                                await conn.execute(text(f"DROP TABLE IF EXISTS `{target_table}`"))
                                                await conn.commit()
                                                logger.info(f"✅ 删除 OUTPUT 节点时清理目标表成功: pipeline_id={pipeline_id}, node_id={node_id}, table={target_table}")
                                            else:
                                                logger.warning(f"⚠️ OUTPUT 节点目标表不存在: table={target_table}")
                                        except Exception as drop_err:
                                            logger.error(f"❌ 删除 OUTPUT 节点时清理目标表失败: pipeline_id={pipeline_id}, node_id={node_id}, table={target_table}, error={drop_err}")
                            else:
                                logger.warning(f"⚠️ 数据源不存在，无法清理 OUTPUT 节点目标表: source_data_source_id={source_ds_id}")
                        else:
                            logger.warning(f"⚠️ 管道没有配置数据源，无法清理 OUTPUT 节点目标表")
                    except Exception as drop_err:
                        logger.error(f"❌ 删除 OUTPUT 节点时清理目标表失败: {drop_err}")
                else:
                    logger.info(f"=== 没有检测到被删除的 OUTPUT 节点 ===")

            logger.info(f"更新管道成功: {pipeline.name} (ID: {pipeline.id})")
            return pipeline

        except PermissionError:
            raise
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新管道失败: {e}")
            raise Exception(f"更新管道失败: {str(e)}")

    async def delete_pipeline(self, pipeline_id: int, user_id: int) -> bool:
        """删除管道（软删除）"""
        try:
            pipeline = await self.get_pipeline(pipeline_id)
            if not pipeline:
                return False

            # 权限检查：仅创建者可以删除
            if pipeline.created_by != user_id:
                raise PermissionError("无权限删除此管道")

            # 软删除
            stmt = (
                update(DataPipeline)
                .where(DataPipeline.id == pipeline_id)
                .values(is_active=False, updated_at=utc_now())
            )
            await self.db.execute(stmt)
            await self.db.commit()

            # 归档该 pipeline 所有关联的图表
            try:
                from app.services.chart_service import ChartService
                chart_service = ChartService(self.db)
                archived_count = await chart_service.archive_charts_by_pipeline(pipeline_id)
                logger.info(f"删除管道时归档图表: pipeline_id={pipeline_id}, archived_count={archived_count}")
            except Exception as archive_err:
                logger.warning(f"删除管道时归档图表失败: {archive_err}")

            logger.info(f"删除管道成功: {pipeline.name} (ID: {pipeline.id})")
            return True

        except PermissionError:
            raise
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除管道失败: {e}")
            raise Exception(f"删除管道失败: {str(e)}")

    # ==================== Execution 管理 ====================

    async def create_execution(
        self,
        pipeline_id: int,
        config: Optional[Dict[str, Any]] = None
    ) -> PipelineExecution:
        """创建执行记录"""
        try:
            execution = PipelineExecution(
                pipeline_id=pipeline_id,
                status="pending",
                config=config or {},
                retention_minutes=60,
                logs=[]
            )

            self.db.add(execution)
            await self.db.commit()
            await self.db.refresh(execution)

            return execution

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建执行记录失败: {e}")
            raise Exception(f"创建执行记录失败: {str(e)}")

    async def get_execution(self, execution_id: int) -> Optional[PipelineExecution]:
        """获取执行记录"""
        try:
            stmt = select(PipelineExecution).where(PipelineExecution.id == execution_id)
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()
        except SQLAlchemyError as e:
            logger.error(f"获取执行记录失败: {e}")
            raise Exception(f"获取执行记录失败: {str(e)}")

    async def get_pipeline_executions(
        self,
        pipeline_id: int,
        skip: int = 0,
        limit: int = 20
    ) -> Tuple[List[PipelineExecution], int]:
        """获取管道的执行历史"""
        try:
            # 获取总数
            count_stmt = select(func.count(PipelineExecution.id)).where(
                PipelineExecution.pipeline_id == pipeline_id
            )
            count_result = await self.db.execute(count_stmt)
            total = count_result.scalar() or 0

            # 获取列表
            stmt = (
                select(PipelineExecution)
                .where(PipelineExecution.pipeline_id == pipeline_id)
                .order_by(PipelineExecution.started_at.desc())
                .offset(skip)
                .limit(limit)
            )
            result = await self.db.execute(stmt)
            executions = list(result.scalars().all())

            return executions, total

        except SQLAlchemyError as e:
            logger.error(f"获取执行历史失败: {e}")
            raise Exception(f"获取执行历史失败: {str(e)}")

    async def get_latest_execution(self, pipeline_id: int) -> Optional[PipelineExecution]:
        """获取管道最新的执行记录"""
        try:
            stmt = (
                select(PipelineExecution)
                .where(PipelineExecution.pipeline_id == pipeline_id)
                .order_by(PipelineExecution.started_at.desc())
                .limit(1)
            )
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()
        except SQLAlchemyError as e:
            logger.error(f"获取最新执行记录失败: {e}")
            raise Exception(f"获取执行记录失败: {str(e)}")

    async def cancel_execution(self, execution_id: int, user_id: int) -> bool:
        """取消执行"""
        try:
            execution = await self.get_execution(execution_id)
            if not execution:
                return False

            # 只能取消 pending 或 running 状态的执行
            if execution.status not in ["pending", "running"]:
                raise ValueError(f"无法取消状态为 {execution.status} 的执行")

            execution.status = "cancelled"
            execution.completed_at = utc_now()
            execution.logs = (execution.logs or []) + [{
                "time": utc_now().isoformat(),
                "message": f"执行被用户 {user_id} 取消"
            }]

            await self.db.commit()
            return True

        except (SQLAlchemyError, ValueError) as e:
            await self.db.rollback()
            logger.error(f"取消执行失败: {e}")
            raise

    async def cleanup_expired_executions(self):
        """清理过期的执行记录"""
        try:
            # 查找过期的执行记录
            now = utc_now()
            stmt = select(PipelineExecution).where(
                and_(
                    PipelineExecution.expires_at < now,
                    PipelineExecution.status == "completed"
                )
            )
            result = await self.db.execute(stmt)
            expired = list(result.scalars().all())

            for exec_record in expired:
                exec_record.status = "expired"

            await self.db.commit()
            logger.info(f"标记 {len(expired)} 条过期执行记录")

            return len(expired)

        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"清理过期执行记录失败: {e}")
            raise

    # ==================== 预览和查询 ====================

    async def get_step_preview(
        self,
        execution_id: int,
        step_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """获取步骤预览数据"""
        try:
            execution = await self.get_execution(execution_id)
            if not execution:
                raise ValueError("执行记录不存在")

            if execution.status not in ["completed", "running"]:
                raise ValueError(f"执行状态为 {execution.status}，无法预览")

            if not execution.temp_table_name:
                raise ValueError("执行记录没有关联临时表")

            # 获取数据源信息
            pipeline = await self.get_pipeline(execution.pipeline_id)
            if not pipeline:
                raise ValueError("管道不存在")

            db_model = await self.db.get(Database, pipeline.source_data_source_id)
            if not db_model:
                raise ValueError("数据源不存在")

            # 创建数据源引擎
            engine = await self._create_db_engine(db_model)

            try:
                async with engine.connect() as conn:
                    temp_manager = TempTableManager(conn, execution_id)
                    await temp_manager.rebuild_struct_index()

                    # 检查持久表是否存在（JSON 或列式）
                    check_sql = f"""
                    SELECT COUNT(*) FROM information_schema.tables
                    WHERE table_schema = DATABASE()
                    AND (table_name = '{temp_manager.json_table_name}'
                         OR table_name LIKE 'tmp_pipeline_{execution_id}_%')
                    """
                    result = await conn.execute(check_sql)
                    count = result.scalar()

                    if count == 0:
                        raise ValueError("临时表不存在或已过期")

                    # 获取预览数据（优先从列式表读，无则回退 JSON 表）
                    preview = await temp_manager.query_step_preview(step_id, limit, offset)
                    return preview

            finally:
                await engine.dispose()

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"获取步骤预览失败: {e}")
            raise Exception(f"获取步骤预览失败: {str(e)}")

    async def get_step_schema(
        self,
        execution_id: int,
        step_id: str
    ) -> Dict[str, Any]:
        """获取步骤字段模式"""
        try:
            execution = await self.get_execution(execution_id)
            if not execution:
                raise ValueError("执行记录不存在")

            if not execution.temp_table_name:
                raise ValueError("执行记录没有关联临时表")

            pipeline = await self.get_pipeline(execution.pipeline_id)
            if not pipeline:
                raise ValueError("管道不存在")

            db_model = await self.db.get(Database, pipeline.source_data_source_id)
            if not db_model:
                raise ValueError("数据源不存在")

            engine = await self._create_db_engine(db_model)

            try:
                async with engine.connect() as conn:
                    temp_manager = TempTableManager(conn, execution_id)
                    schema = await temp_manager.get_step_schema(step_id)

                    return {
                        "step_id": step_id,
                        "schema": schema
                    }

            finally:
                await engine.dispose()

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"获取步骤模式失败: {e}")
            raise Exception(f"获取步骤模式失败: {str(e)}")

    async def get_all_steps_info(self, execution_id: int) -> List[Dict[str, Any]]:
        """获取所有步骤的摘要信息"""
        try:
            execution = await self.get_execution(execution_id)
            if not execution:
                raise ValueError("执行记录不存在")

            if not execution.temp_table_name:
                raise ValueError("执行记录没有关联临时表")

            pipeline = await self.get_pipeline(execution.pipeline_id)
            if not pipeline:
                raise ValueError("管道不存在")

            db_model = await self.db.get(Database, pipeline.source_data_source_id)
            if not db_model:
                raise ValueError("数据源不存在")

            engine = await self._create_db_engine(db_model)

            try:
                async with engine.connect() as conn:
                    temp_manager = TempTableManager(conn, execution_id)
                    await temp_manager.rebuild_struct_index()

                    # 检查持久表是否存在
                    check_sql = f"""
                    SELECT COUNT(*) FROM information_schema.tables
                    WHERE table_schema = DATABASE()
                    AND (table_name = '{temp_manager.json_table_name}'
                         OR table_name LIKE 'tmp_pipeline_{execution_id}_%')
                    """
                    result = await conn.execute(check_sql)
                    count = result.scalar()

                    if count == 0:
                        return []

                    steps_info = await temp_manager.get_all_steps()
                    return steps_info

            finally:
                await engine.dispose()

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"获取步骤信息失败: {e}")
            raise Exception(f"获取步骤信息失败: {str(e)}")

    # ==================== 辅助方法 ====================

    async def _create_db_engine(self, db_model: Database) -> AsyncEngine:
        """创建数据源数据库引擎"""
        from sqlalchemy.ext.asyncio import create_async_engine

        db_url = (
            f"mysql+aiomysql://{db_model.username}:{db_model.password}"
            f"@{db_model.host}:{db_model.port}/{db_model.database_name}"
        )

        engine = create_async_engine(
            db_url,
            pool_size=5,
            max_overflow=10,
            pool_recycle=3600,
            pool_pre_ping=True,
        )

        return engine

    async def get_pipeline_stats(self, pipeline_id: int) -> Dict[str, Any]:
        """获取管道统计信息"""
        try:
            # 获取执行统计
            count_stmt = select(func.count(PipelineExecution.id)).where(
                PipelineExecution.pipeline_id == pipeline_id
            )
            total_result = await self.db.execute(count_stmt)
            total = total_result.scalar() or 0

            success_stmt = select(func.count(PipelineExecution.id)).where(
                and_(
                    PipelineExecution.pipeline_id == pipeline_id,
                    PipelineExecution.status == "completed"
                )
            )
            success_result = await self.db.execute(success_stmt)
            successful = success_result.scalar() or 0

            failed_stmt = select(func.count(PipelineExecution.id)).where(
                and_(
                    PipelineExecution.pipeline_id == pipeline_id,
                    PipelineExecution.status == "failed"
                )
            )
            failed_result = await self.db.execute(failed_stmt)
            failed = failed_result.scalar() or 0

            # 平均执行时间
            avg_stmt = select(func.avg(PipelineExecution.execution_time_ms)).where(
                and_(
                    PipelineExecution.pipeline_id == pipeline_id,
                    PipelineExecution.status == "completed"
                )
            )
            avg_result = await self.db.execute(avg_stmt)
            avg_time = avg_result.scalar()

            # 最后执行时间
            last_stmt = select(PipelineExecution.started_at).where(
                PipelineExecution.pipeline_id == pipeline_id
            ).order_by(PipelineExecution.started_at.desc()).limit(1)
            last_result = await self.db.execute(last_stmt)
            last_exec = last_result.scalar_one_or_none()

            return {
                "pipeline_id": pipeline_id,
                "total_executions": total,
                "successful_executions": successful,
                "failed_executions": failed,
                "avg_execution_time_ms": float(avg_time) if avg_time else None,
                "last_execution": last_exec
            }

        except SQLAlchemyError as e:
            logger.error(f"获取管道统计失败: {e}")
            raise Exception(f"获取管道统计失败: {str(e)}")

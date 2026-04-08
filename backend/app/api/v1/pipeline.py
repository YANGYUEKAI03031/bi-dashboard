# backend/app/api/v1/pipeline.py
"""数据管道 (Pipeline) API 接口

核心端点：
- POST /pipeline/ - 创建管道
- GET /pipeline/ - 获取管道列表
- GET /pipeline/{id} - 获取管道详情
- PUT /pipeline/{id} - 更新管道
- DELETE /pipeline/{id} - 删除管道
- POST /pipeline/{id}/run - 触发 ETL 运行（后台任务）
- GET /pipeline/{id}/executions - 获取执行历史
- GET /pipeline/{id}/preview/{step_id} - 预览节点数据
- GET /pipeline/{id}/stats - 获取管道统计
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi import Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import logging

from app.db.session import get_db
from app.services.pipeline_service import PipelineService
from app.services.pipeline.engine import PipelineEngine
from app.services.pipeline.temp_table_manager import TempTableManager
from app.services.pipeline_chart_sync_service import PipelineChartSyncService
from app.schemas.pipeline import (
    PipelineCreate, PipelineUpdate, PipelineResponse,
    PipelineListResponse, ExecutionResponse, ExecutionListResponse,
    StepPreviewResponse, StepSchemaResponse, RunPipelineResponse,
    PipelineStatsResponse, NodePreviewRequest, NodePreviewResponse
)
from app.core.security import get_current_user_id
from app.models.pipeline import DataPipeline, PipelineExecution, PipelineWatermark
from app.models.visualization import Database

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
logger = logging.getLogger(__name__)


# ==================== Pipeline CRUD ====================

@router.post("/", response_model=PipelineResponse, status_code=201)
async def create_pipeline(
    pipeline_data: PipelineCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建新管道"""
    try:
        service = PipelineService(db)

        # 验证管道配置
        nodes_dict = [n.dict() for n in pipeline_data.nodes]
        is_valid, error_msg = PipelineEngine.validate_pipeline_config(nodes_dict)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

        pipeline = await service.create_pipeline(
            name=pipeline_data.name,
            source_data_source_id=pipeline_data.source_data_source_id,
            nodes=nodes_dict,
            user_id=user_id,
            description=pipeline_data.description,
            variables=pipeline_data.variables,
            config=pipeline_data.config,
            is_public=pipeline_data.is_public
        )

        # 创建成功后，同步 chart 节点到 visualization_cards
        try:
            sync_service = PipelineChartSyncService(db)
            count, _ = await sync_service.sync_pipeline_charts(
                pipeline_id=pipeline.id,
                nodes=nodes_dict,
                user_id=user_id,
            )
            logger.info(f"管道 {pipeline.id} 创建时图表同步完成: {count} 条")
        except Exception as sync_err:
            logger.warning(f"创建时图表同步失败（不影响管道创建）: {sync_err}")

        return PipelineResponse.model_validate(pipeline)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建管道API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=PipelineListResponse)
async def get_pipelines(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取管道列表"""
    try:
        service = PipelineService(db)
        pipelines, total = await service.get_user_pipelines(
            user_id=user_id,
            skip=skip,
            limit=limit,
            include_public=True
        )

        return PipelineListResponse(
            items=[PipelineResponse.model_validate(p) for p in pipelines],
            total=total,
            skip=skip,
            limit=limit
        )

    except Exception as e:
        logger.error(f"获取管道列表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取管道详情"""
    try:
        service = PipelineService(db)
        pipeline = await service.get_pipeline(pipeline_id)

        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        return PipelineResponse.model_validate(pipeline)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取管道详情API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{pipeline_id}", response_model=PipelineResponse)
async def update_pipeline(
    pipeline_id: int,
    update_data: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新管道"""
    try:
        service = PipelineService(db)

        # 验证管道配置（如果有节点更新）
        if update_data.nodes is not None:
            nodes_dict = [n.dict() for n in update_data.nodes]
            is_valid, error_msg = PipelineEngine.validate_pipeline_config(nodes_dict)
            if not is_valid:
                raise HTTPException(status_code=400, detail=error_msg)

        # 构建更新字段
        update_fields = {}
        if update_data.name is not None:
            update_fields['name'] = update_data.name
        if update_data.description is not None:
            update_fields['description'] = update_data.description
        if update_data.nodes is not None:
            update_fields['nodes'] = [n.dict() for n in update_data.nodes]
        if update_data.variables is not None:
            update_fields['variables'] = update_data.variables
        if update_data.config is not None:
            update_fields['config'] = update_data.config
        if update_data.is_active is not None:
            update_fields['is_active'] = update_data.is_active
        if update_data.is_public is not None:
            update_fields['is_public'] = update_data.is_public
        if update_data.source_data_source_id is not None:
            await service._assert_pipeline_business_data_source(update_data.source_data_source_id)
            update_fields['source_data_source_id'] = update_data.source_data_source_id

        pipeline = await service.update_pipeline(pipeline_id, user_id, **update_fields)

        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 节点有更新时，同步 chart 节点到 visualization_cards
        if update_data.nodes is not None:
            try:
                sync_service = PipelineChartSyncService(db)
                count, summaries = await sync_service.sync_pipeline_charts(
                    pipeline_id=pipeline_id,
                    nodes=[n.dict() for n in update_data.nodes],
                    user_id=user_id,
                )
                logger.info(f"管道 {pipeline_id} 图表同步完成: {count} 条")
            except Exception as sync_err:
                logger.warning(f"管道图表同步失败（不影响管道保存）: {sync_err}")

        return PipelineResponse.model_validate(pipeline)

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新管道API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """删除管道"""
    try:
        service = PipelineService(db)
        success = await service.delete_pipeline(pipeline_id, user_id)

        if not success:
            raise HTTPException(status_code=404, detail="管道不存在")

        return {"message": "管道删除成功"}

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除管道API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 执行管理 ====================

@router.post("/{pipeline_id}/run", response_model=RunPipelineResponse)
async def run_pipeline(
    pipeline_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    触发 ETL 运行

    管道将在后台异步执行，立即返回执行记录 ID。
    使用 GET /pipeline/{pipeline_id}/preview/{step_id} 查看执行进度和预览数据。
    """
    try:
        service = PipelineService(db)

        # 获取管道
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限执行此管道")

        # 获取数据源
        db_model = await db.get(Database, pipeline.source_data_source_id)
        if not db_model:
            raise HTTPException(status_code=400, detail="数据源不存在")

        # 创建执行记录
        execution = await service.create_execution(pipeline_id)

        # 后台任务必须用应用库会话读写管道/执行记录；数据源引擎仅用于在业务库执行 SQL
        source_data_url = (
            f"mysql+aiomysql://{db_model.username}:{db_model.password}"
            f"@{db_model.host}:{db_model.port}/{db_model.database_name}"
        )
        background_tasks.add_task(
            _run_pipeline_background,
            pipeline_id=pipeline_id,
            execution_id=execution.id,
            source_data_url=source_data_url,
        )

        return RunPipelineResponse(
            execution_id=execution.id,
            pipeline_id=pipeline_id,
            status="pending",
            message="管道已加入执行队列，请通过 GET /pipeline/executions/{execution_id} 查看进度"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"触发管道运行API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _run_pipeline_background(
    pipeline_id: int,
    execution_id: int,
    source_data_url: str,
):
    """
    后台执行管道的任务

    注意：应用元数据（data_pipelines / pipeline_executions）在 settings.DATABASE_URL；
    管道 SQL 在数据源库执行，需单独的引擎。
    """
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from app.core.config import settings

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

            pipeline_engine = PipelineEngine(
                session, data_source_engine, pipeline.source_data_source_id
            )

            success, error_msg, result_summary = await pipeline_engine.run(
                pipeline=pipeline,
                execution=execution,
                config=pipeline.config,
            )

            logger.info(
                f"管道执行完成: pipeline={pipeline_id}, execution={execution_id}, success={success}"
            )

            # 执行成功后，同步 chart 节点配置到 visualization_cards
            if success and pipeline.nodes:
                try:
                    from app.db.session import get_db
                    from app.core.security import get_current_user_id
                    async with SessionLocal() as sync_session:
                        sync_svc = PipelineChartSyncService(sync_session)
                        nodes_list = pipeline.nodes if isinstance(pipeline.nodes, list) else []
                        count, _ = await sync_svc.sync_pipeline_charts(
                            pipeline_id=pipeline_id,
                            nodes=nodes_list,
                        )
                        logger.info(
                            f"管道 {pipeline_id} 执行后图表同步完成: {count} 条"
                        )
                except Exception as sync_err:
                    logger.warning(f"执行后图表同步失败（不影响执行结果）: {sync_err}")

    except Exception as e:
        logger.error(f"后台执行管道失败: {e}")
    finally:
        if app_engine:
            await app_engine.dispose()
        if data_source_engine:
            await data_source_engine.dispose()


@router.get("/{pipeline_id}/executions", response_model=ExecutionListResponse)
async def get_pipeline_executions(
    pipeline_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取管道的执行历史"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        executions, total = await service.get_pipeline_executions(
            pipeline_id=pipeline_id,
            skip=skip,
            limit=limit
        )

        return ExecutionListResponse(
            items=[ExecutionResponse.model_validate(e) for e in executions],
            total=total
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取执行历史API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{pipeline_id}/executions/latest", response_model=ExecutionResponse)
async def get_latest_execution(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取管道最新的执行记录"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise HTTPException(status_code=404, detail="暂无执行记录")

        return ExecutionResponse.model_validate(execution)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取最新执行记录API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{pipeline_id}/stats", response_model=PipelineStatsResponse)
async def get_pipeline_stats(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取管道统计信息"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        stats = await service.get_pipeline_stats(pipeline_id)
        return PipelineStatsResponse(**stats)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取管道统计API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 预览接口 ====================

@router.get("/{pipeline_id}/preview/{step_id}", response_model=StepPreviewResponse)
async def preview_step(
    pipeline_id: int,
    step_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    预览节点数据

    从临时表中查询指定步骤的数据返回给前端展示。
    """
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise HTTPException(status_code=404, detail="暂无执行记录")

        # 获取预览数据
        preview = await service.get_step_preview(
            execution_id=execution.id,
            step_id=step_id,
            limit=limit,
            offset=offset
        )

        return StepPreviewResponse(**preview)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"预览节点数据API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{pipeline_id}/schema/{step_id}", response_model=StepSchemaResponse)
async def get_step_schema(
    pipeline_id: int,
    step_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    获取步骤字段模式

    返回步骤的字段名和类型推断结果。
    """
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise HTTPException(status_code=404, detail="暂无执行记录")

        # 获取字段模式
        schema_info = await service.get_step_schema(
            execution_id=execution.id,
            step_id=step_id
        )

        return StepSchemaResponse(**schema_info)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取步骤模式API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{pipeline_id}/steps")
async def get_all_steps(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    获取所有步骤摘要

    返回所有步骤的基本信息（ID、行数、创建时间）。
    """
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise HTTPException(status_code=404, detail="暂无执行记录")

        # 获取所有步骤信息
        steps_info = await service.get_all_steps_info(execution.id)

        return {"steps": steps_info}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取所有步骤API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 执行记录操作 ====================

@router.post("/executions/{execution_id}/cancel")
async def cancel_execution(
    execution_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """取消正在执行的管道"""
    try:
        service = PipelineService(db)
        success = await service.cancel_execution(execution_id, user_id)

        if not success:
            raise HTTPException(status_code=404, detail="执行记录不存在")

        return {"message": "执行已取消"}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"取消执行API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/executions/{execution_id}", response_model=ExecutionResponse)
async def get_execution(
    execution_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取执行记录详情"""
    try:
        service = PipelineService(db)
        execution = await service.get_execution(execution_id)

        if not execution:
            raise HTTPException(status_code=404, detail="执行记录不存在")

        # 获取管道检查权限
        pipeline = await service.get_pipeline(execution.pipeline_id)
        if pipeline and not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此执行记录")

        return ExecutionResponse.model_validate(execution)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取执行记录API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/executions/{execution_id}/progress")
async def get_execution_progress(
    execution_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    获取执行进度（用于前端轮询）

    返回当前步骤、已处理行数、各步骤进度详情。
    """
    try:
        from sqlalchemy import select

        # 获取执行记录
        stmt = select(PipelineExecution).where(PipelineExecution.id == execution_id)
        result = await db.execute(stmt)
        execution = result.scalar_one_or_none()

        if not execution:
            raise HTTPException(status_code=404, detail="执行记录不存在")

        # 获取管道检查权限
        pipeline_stmt = select(DataPipeline).where(DataPipeline.id == execution.pipeline_id)
        pipeline_result = await db.execute(pipeline_stmt)
        pipeline = pipeline_result.scalar_one_or_none()

        if pipeline and not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此执行记录")

        # 计算总进度
        total_steps = len(execution.completed_steps) if execution.completed_steps else 0
        step_progress = execution.step_progress or {}
        current_step = execution.current_step_id
        current_rows = execution.current_step_rows or 0

        # 估算总行数（从已完成步骤和当前步骤推算）
        total_rows = execution.total_rows or 0
        if current_rows > 0:
            # 如果当前步骤正在运行，使用预估的总进度百分比
            estimated_total = total_rows if total_rows > 0 else None
        else:
            estimated_total = total_rows if total_rows > 0 else None

        return {
            "execution_id": execution_id,
            "status": execution.status,
            "current_step_id": current_step,
            "current_step_rows": current_rows,
            "total_rows": estimated_total,
            "step_progress": step_progress,
            "completed_steps": execution.completed_steps,
            "started_at": execution.started_at.isoformat() if execution.started_at else None,
            "completed_at": execution.completed_at.isoformat() if execution.completed_at else None,
            "execution_time_ms": execution.execution_time_ms,
            "error_message": execution.error_message
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取执行进度API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 节点实时预览（无代码编辑器用）====================

async def _get_data_source_engine(db: AsyncSession, data_source_id: int):
    """根据 data_source_id 获取数据源引擎和 Database 记录"""
    from sqlalchemy import select
    from app.models.visualization import Database
    stmt = select(Database).where(Database.id == data_source_id, Database.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    db_model = result.scalar_one_or_none()
    if not db_model:
        raise ValueError(f"数据源 {data_source_id} 不存在或未激活")
    url = (
        f"mysql+aiomysql://{db_model.username}:{db_model.password}"
        f"@{db_model.host}:{db_model.port}/{db_model.database_name}"
    )
    from sqlalchemy.ext.asyncio import create_async_engine
    return db_model, create_async_engine(url, pool_pre_ping=True)


@router.post("/preview", response_model=NodePreviewResponse)
async def preview_node(
    request: NodePreviewRequest,
    db: AsyncSession = Depends(get_db),
    _: int = Depends(get_current_user_id),
):
    """
    根据节点类型和可视化配置实时预览数据。

    用于无代码编辑器中，用户配置节点后实时查看预览效果。
    不依赖已保存的管道，直接从业务数据源拉取。

    支持两种模式：
    - 单节点模式（不传 graph_nodes）：仅预览当前节点，不依赖上游。
    - 链式折叠模式（传入 graph_nodes / graph_edges / focus_node_id）：
      后端沿上游折叠子图，生成嵌套 SELECT，可预览连线场景。
    """
    try:
        db_model, engine = await _get_data_source_engine(db, request.source_data_source_id)

        # 构建图节点字典（用于折叠）
        graph_nodes_dict: Optional[Dict[str, Dict[str, Any]]] = None
        if request.graph_nodes is not None:
            graph_nodes_dict = {}
            for gn in request.graph_nodes:
                # 每个 GraphNodeSchema 有 id / type / config / merge_type
                node_dict: Dict[str, Any] = {
                    "type": gn.type,
                    "config": gn.config,
                    "upstream": [],   # upstream 从边推导
                }
                if gn.merge_type:
                    node_dict["merge_type"] = gn.merge_type
                graph_nodes_dict[gn.id] = node_dict
            # 从边信息补充 upstream
            if request.graph_edges:
                for e in request.graph_edges:
                    tgt = e.target
                    src = e.source
                    if tgt in (graph_nodes_dict or {}) and src:
                        if "upstream" not in graph_nodes_dict[tgt]:
                            graph_nodes_dict[tgt]["upstream"] = []
                        graph_nodes_dict[tgt]["upstream"].append(src)

        previewer = PipelineEngine(session=db, data_source_engine=engine, data_source_id=request.source_data_source_id)
        result = await previewer.preview_node(
            node_type=request.node_type,
            config=request.config or {},
            limit=request.limit,
            graph_nodes=graph_nodes_dict,
            graph_edges=[e.model_dump() for e in request.graph_edges] if request.graph_edges else None,
            focus_node_id=request.focus_node_id,
        )
        return NodePreviewResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"节点预览API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 水位线管理 ====================

@router.get("/{pipeline_id}/watermarks")
async def get_pipeline_watermarks(
    pipeline_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    获取管道所有节点的水位线

    用于查看增量更新进度。
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        # 获取所有水位线
        wm_stmt = select(PipelineWatermark).where(PipelineWatermark.pipeline_id == pipeline_id)
        wm_result = await db.execute(wm_stmt)
        watermarks = wm_result.scalars().all()

        return {
            "pipeline_id": pipeline_id,
            "watermarks": [
                {
                    "node_id": w.node_id,
                    "watermark_field": w.watermark_field,
                    "last_value": w.last_value,
                    "last_processed_at": w.last_processed_at.isoformat() if w.last_processed_at else None
                }
                for w in watermarks
            ]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取水位线API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{pipeline_id}/watermarks/{node_id}")
async def delete_watermark(
    pipeline_id: int,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """
    删除指定节点的水位线

    删除后下次执行将执行全量查询。
    """
    try:
        from sqlalchemy import select, and_

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise HTTPException(status_code=404, detail="管道不存在")

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise HTTPException(status_code=403, detail="无权限访问此管道")

        # 删除水位线
        wm_stmt = select(PipelineWatermark).where(
            and_(
                PipelineWatermark.pipeline_id == pipeline_id,
                PipelineWatermark.node_id == node_id
            )
        )
        wm_result = await db.execute(wm_stmt)
        watermark = wm_result.scalar_one_or_none()

        if watermark:
            await db.delete(watermark)
            await db.commit()

        return {"message": "水位线已删除，下次执行将执行全量查询"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除水位线API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


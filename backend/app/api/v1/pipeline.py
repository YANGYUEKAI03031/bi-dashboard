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

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user_id
from app.exceptions import (
    AppException,
    DatabaseException,
    PermissionDeniedException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.session import get_db
from app.models.pipeline import DataPipeline, PipelineExecution, PipelineTrigger, PipelineWatermark
from app.models.visualization import Database
from app.schemas.pipeline import (
    ExecutionListResponse,
    ExecutionResponse,
    NodePreviewRequest,
    NodePreviewResponse,
    PipelineCreate,
    PipelineListResponse,
    PipelineResponse,
    PipelineStatsResponse,
    PipelineUpdate,
    RunPipelineResponse,
    StepPreviewResponse,
    StepSchemaResponse,
)
from app.services.pipeline.engine import PipelineEngine
from app.services.pipeline.validator import validate_pipeline_config
from app.services.pipeline_chart_sync_service import PipelineChartSyncService
from app.services.pipeline_service import PipelineService

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
logger = logging.getLogger(__name__)


# ==================== Pipeline CRUD ====================


@router.post("/", response_model=PipelineResponse, status_code=201)
async def create_pipeline(
    pipeline_data: PipelineCreate, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """创建新管道"""
    try:
        service = PipelineService(db)

        # 验证管道配置
        nodes_dict = [n.dict() for n in pipeline_data.nodes]
        is_valid, error_msg = validate_pipeline_config(nodes_dict)
        if not is_valid:
            raise ValidationException("request", error_msg)

        pipeline = await service.create_pipeline(
            name=pipeline_data.name,
            source_data_source_id=pipeline_data.source_data_source_id,
            nodes=nodes_dict,
            user_id=user_id,
            description=pipeline_data.description,
            variables=pipeline_data.variables,
            config=pipeline_data.config,
            is_public=pipeline_data.is_public,
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

    except AppException:
        raise
    except Exception as e:
        logger.error(f"创建管道API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/", response_model=PipelineListResponse)
async def get_pipelines(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """获取管道列表"""
    try:
        service = PipelineService(db)
        pipelines, total = await service.get_user_pipelines(
            user_id=user_id, skip=skip, limit=limit, include_public=True
        )

        return PipelineListResponse(
            items=[PipelineResponse.model_validate(p) for p in pipelines], total=total, skip=skip, limit=limit
        )

    except Exception as e:
        logger.error(f"获取管道列表API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """获取管道详情"""
    try:
        service = PipelineService(db)
        pipeline = await service.get_pipeline(pipeline_id)

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        return PipelineResponse.model_validate(pipeline)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取管道详情API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.put("/{pipeline_id}", response_model=PipelineResponse)
async def update_pipeline(
    pipeline_id: int,
    update_data: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """更新管道"""
    try:
        service = PipelineService(db)

        # 验证管道配置（如果有节点更新）
        if update_data.nodes is not None:
            nodes_dict = [n.dict() for n in update_data.nodes]
            is_valid, error_msg = validate_pipeline_config(nodes_dict)
            if not is_valid:
                raise ValidationException("request", error_msg)

        # 构建更新字段
        update_fields = {}
        if update_data.name is not None:
            update_fields["name"] = update_data.name
        if update_data.description is not None:
            update_fields["description"] = update_data.description
        if update_data.nodes is not None:
            update_fields["nodes"] = [n.dict() for n in update_data.nodes]
        if update_data.variables is not None:
            update_fields["variables"] = update_data.variables
        if update_data.config is not None:
            update_fields["config"] = update_data.config
        if update_data.is_active is not None:
            update_fields["is_active"] = update_data.is_active
        if update_data.is_public is not None:
            update_fields["is_public"] = update_data.is_public
        if update_data.source_data_source_id is not None:
            await service._assert_pipeline_business_data_source(update_data.source_data_source_id)
            update_fields["source_data_source_id"] = update_data.source_data_source_id

        pipeline = await service.update_pipeline(pipeline_id, user_id, **update_fields)

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

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
        raise PermissionDeniedException(str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"更新管道API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """删除管道"""
    try:
        service = PipelineService(db)
        success = await service.delete_pipeline(pipeline_id, user_id)

        if not success:
            raise ResourceNotFoundException("管道", pipeline_id)

        return {"message": "管道删除成功"}

    except PermissionError as e:
        raise PermissionDeniedException(str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"删除管道API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


# ==================== 执行管理 ====================


@router.post("/{pipeline_id}/run", response_model=RunPipelineResponse)
async def run_pipeline(
    pipeline_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
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
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("执行此管道")

        # 获取数据源
        db_model = await db.get(Database, pipeline.source_data_source_id)
        if not db_model:
            raise ResourceNotFoundException("数据源")

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
            message="管道已加入执行队列，请通过 GET /pipeline/executions/{execution_id} 查看进度",
        )

    except AppException:
        raise
    except Exception as e:
        logger.error(f"触发管道运行API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


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
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
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
        SessionLocal = sessionmaker(app_engine, class_=AsyncSession, expire_on_commit=False)

        async with SessionLocal() as session:
            service = PipelineService(session)

            pipeline = await service.get_pipeline(pipeline_id)
            execution = await service.get_execution(execution_id)

            if not pipeline or not execution:
                logger.error(f"管道或执行记录不存在: pipeline={pipeline_id}, execution={execution_id}")
                return

            pipeline_engine = PipelineEngine(session, data_source_engine, pipeline.source_data_source_id)

            success, error_msg, result_summary = await pipeline_engine.run(
                pipeline=pipeline,
                execution=execution,
                config=pipeline.config,
            )

            logger.info(f"管道执行完成: pipeline={pipeline_id}, execution={execution_id}, success={success}")

            # 执行成功后，同步 chart 节点配置到 visualization_cards
            if success and pipeline.nodes:
                try:
                    async with SessionLocal() as sync_session:
                        sync_svc = PipelineChartSyncService(sync_session)
                        nodes_list = pipeline.nodes if isinstance(pipeline.nodes, list) else []
                        count, _ = await sync_svc.sync_pipeline_charts(
                            pipeline_id=pipeline_id,
                            nodes=nodes_list,
                        )
                        logger.info(f"管道 {pipeline_id} 执行后图表同步完成: {count} 条")
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
    user_id: int = Depends(get_current_user_id),
):
    """获取管道的执行历史"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        executions, total = await service.get_pipeline_executions(pipeline_id=pipeline_id, skip=skip, limit=limit)

        return ExecutionListResponse(items=[ExecutionResponse.model_validate(e) for e in executions], total=total)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取执行历史API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}/executions/latest", response_model=ExecutionResponse)
async def get_latest_execution(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """获取管道最新的执行记录"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise ResourceNotFoundException("执行记录")

        return ExecutionResponse.model_validate(execution)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取最新执行记录API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}/stats", response_model=PipelineStatsResponse)
async def get_pipeline_stats(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """获取管道统计信息"""
    try:
        service = PipelineService(db)

        # 检查管道存在
        pipeline = await service.get_pipeline(pipeline_id)
        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        stats = await service.get_pipeline_stats(pipeline_id)
        return PipelineStatsResponse(**stats)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取管道统计API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


# ==================== 预览接口 ====================


@router.get("/{pipeline_id}/preview/{step_id}", response_model=StepPreviewResponse)
async def preview_step(
    pipeline_id: int,
    step_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
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
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise ResourceNotFoundException("执行记录")

        # 获取预览数据
        preview = await service.get_step_preview(execution_id=execution.id, step_id=step_id, limit=limit, offset=offset)

        return StepPreviewResponse(**preview)

    except ValueError as e:
        raise ValidationException("input", str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"预览节点数据API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}/schema/{step_id}", response_model=StepSchemaResponse)
async def get_step_schema(
    pipeline_id: int, step_id: str, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
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
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise ResourceNotFoundException("执行记录")

        # 获取字段模式
        schema_info = await service.get_step_schema(execution_id=execution.id, step_id=step_id)

        return StepSchemaResponse(**schema_info)

    except ValueError as e:
        raise ValidationException("input", str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取步骤模式API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}/steps")
async def get_all_steps(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
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
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取最新执行记录
        execution = await service.get_latest_execution(pipeline_id)
        if not execution:
            raise ResourceNotFoundException("执行记录")

        # 获取所有步骤信息
        steps_info = await service.get_all_steps_info(execution.id)

        return {"steps": steps_info}

    except ValueError as e:
        raise ValidationException("input", str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取所有步骤API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


# ==================== 执行记录操作 ====================


@router.post("/executions/{execution_id}/cancel")
async def cancel_execution(
    execution_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """取消正在执行的管道"""
    try:
        service = PipelineService(db)
        success = await service.cancel_execution(execution_id, user_id)

        if not success:
            raise ResourceNotFoundException("执行记录", execution_id)

        return {"message": "执行已取消"}

    except ValueError as e:
        raise ValidationException("input", str(e))
    except AppException:
        raise
    except Exception as e:
        logger.error(f"取消执行API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/executions/{execution_id}", response_model=ExecutionResponse)
async def get_execution(
    execution_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """获取执行记录详情"""
    try:
        service = PipelineService(db)
        execution = await service.get_execution(execution_id)

        if not execution:
            raise ResourceNotFoundException("执行记录", execution_id)

        # 获取管道检查权限
        pipeline = await service.get_pipeline(execution.pipeline_id)
        if pipeline and not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此执行记录")

        return ExecutionResponse.model_validate(execution)

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取执行记录API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.get("/executions/{execution_id}/progress")
async def get_execution_progress(
    execution_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
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
            raise ResourceNotFoundException("执行记录", execution_id)

        # 获取管道检查权限
        pipeline_stmt = select(DataPipeline).where(DataPipeline.id == execution.pipeline_id)
        pipeline_result = await db.execute(pipeline_stmt)
        pipeline = pipeline_result.scalar_one_or_none()

        if pipeline and not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此执行记录")

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
            "error_message": execution.error_message,
        }

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取执行进度API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


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
        graph_nodes_dict: Dict[str, Dict[str, Any]] | None = None
        if request.graph_nodes is not None:
            graph_nodes_dict = {}
            for gn in request.graph_nodes:
                # 每个 GraphNodeSchema 有 id / type / config / merge_type
                node_dict: Dict[str, Any] = {
                    "type": gn.type,
                    "config": gn.config,
                    "upstream": [],  # upstream 从边推导
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
        raise ValidationException("input", str(e))
    except Exception as e:
        logger.error(f"节点预览API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


# ==================== 水位线管理 ====================


@router.get("/{pipeline_id}/watermarks")
async def get_pipeline_watermarks(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
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
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

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
                    "last_processed_at": w.last_processed_at.isoformat() if w.last_processed_at else None,
                }
                for w in watermarks
            ],
        }

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取水位线API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.delete("/{pipeline_id}/watermarks/{node_id}")
async def delete_watermark(
    pipeline_id: int, node_id: str, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """
    删除指定节点的水位线

    删除后下次执行将执行全量查询。
    """
    try:
        from sqlalchemy import and_, select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 删除水位线
        wm_stmt = select(PipelineWatermark).where(
            and_(PipelineWatermark.pipeline_id == pipeline_id, PipelineWatermark.node_id == node_id)
        )
        wm_result = await db.execute(wm_stmt)
        watermark = wm_result.scalar_one_or_none()

        if watermark:
            await db.delete(watermark)
            await db.commit()

        return {"message": "水位线已删除，下次执行将执行全量查询"}

    except AppException:
        raise
    except Exception as e:
        logger.error(f"删除水位线API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


# ==================== 触发器管理 ====================


class TriggerCreateRequest(BaseModel):
    """创建/更新触发器请求"""

    source_table: str  # 监控的源表名
    watermark_field: str  # 高水位字段（updated_at / id）
    poll_interval_seconds: int = 300  # 轮询间隔（默认 5 分钟）
    enabled: bool = True  # 是否启用


class TriggerResponse(BaseModel):
    """触发器响应"""

    id: int
    pipeline_id: int
    source_table: str
    watermark_field: str
    poll_interval_seconds: int
    enabled: bool
    last_check_at: str | None
    last_watermark_value: str | None
    created_at: str
    updated_at: str


@router.post("/{pipeline_id}/trigger", response_model=TriggerResponse)
async def create_or_update_trigger(
    pipeline_id: int,
    trigger_data: TriggerCreateRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """
    创建或更新管道触发器

    如果已存在则更新，不存在则创建。
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("配置此管道")

        # 查找现有触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if trigger:
            # 更新
            trigger.source_table = trigger_data.source_table
            trigger.watermark_field = trigger_data.watermark_field
            trigger.poll_interval_seconds = trigger_data.poll_interval_seconds
            trigger.enabled = trigger_data.enabled
        else:
            # 创建
            trigger = PipelineTrigger(
                pipeline_id=pipeline_id,
                source_table=trigger_data.source_table,
                watermark_field=trigger_data.watermark_field,
                poll_interval_seconds=trigger_data.poll_interval_seconds,
                enabled=trigger_data.enabled,
            )
            db.add(trigger)

        await db.commit()
        await db.refresh(trigger)

        return TriggerResponse(
            id=trigger.id,
            pipeline_id=trigger.pipeline_id,
            source_table=trigger.source_table,
            watermark_field=trigger.watermark_field,
            poll_interval_seconds=trigger.poll_interval_seconds,
            enabled=trigger.enabled,
            last_check_at=trigger.last_check_at.isoformat() if trigger.last_check_at else None,
            last_watermark_value=trigger.last_watermark_value,
            created_at=trigger.created_at.isoformat() if trigger.created_at else "",
            updated_at=trigger.updated_at.isoformat() if trigger.updated_at else "",
        )

    except AppException:
        raise
    except Exception as e:
        logger.error(f"创建/更新触发器API错误: {str(e)}")
        await db.rollback()
        raise DatabaseException("操作失败", original_error=e)


@router.get("/{pipeline_id}/trigger", response_model=Optional[TriggerResponse])
async def get_trigger(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """
    获取管道触发器配置
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if not trigger:
            return None

        return TriggerResponse(
            id=trigger.id,
            pipeline_id=trigger.pipeline_id,
            source_table=trigger.source_table,
            watermark_field=trigger.watermark_field,
            poll_interval_seconds=trigger.poll_interval_seconds,
            enabled=trigger.enabled,
            last_check_at=trigger.last_check_at.isoformat() if trigger.last_check_at else None,
            last_watermark_value=trigger.last_watermark_value,
            created_at=trigger.created_at.isoformat() if trigger.created_at else "",
            updated_at=trigger.updated_at.isoformat() if trigger.updated_at else "",
        )

    except AppException:
        raise
    except Exception as e:
        logger.error(f"获取触发器API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.delete("/{pipeline_id}/trigger")
async def delete_trigger(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """
    删除管道触发器
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("删除此管道触发器")

        # 删除触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if trigger:
            await db.delete(trigger)
            await db.commit()

        return {"message": "触发器已删除"}

    except AppException:
        raise
    except Exception as e:
        logger.error(f"删除触发器API错误: {str(e)}")
        await db.rollback()
        raise DatabaseException("操作失败", original_error=e)


@router.post("/{pipeline_id}/trigger/check-index")
async def check_trigger_index(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """
    检查触发器配置的字段是否有索引

    用于在保存触发器前提示用户是否需要建索引。
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if not trigger:
            raise ResourceNotFoundException("触发器", pipeline_id)

        # 检查索引
        from app.services.pipeline.trigger_scheduler import TriggerScheduler

        scheduler = TriggerScheduler(db)
        has_index, message = await scheduler.check_source_table_index(
            pipeline.source_data_source_id, trigger.source_table, trigger.watermark_field
        )

        return {
            "has_index": has_index,
            "message": message,
        }

    except AppException:
        raise
    except Exception as e:
        logger.error(f"检查索引API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)


@router.post("/{pipeline_id}/trigger/test")
async def test_trigger(
    pipeline_id: int, db: AsyncSession = Depends(get_db), user_id: int = Depends(get_current_user_id)
):
    """
    测试触发器配置

    立即执行一次轮询，返回当前水位值。
    """
    try:
        from sqlalchemy import select

        # 检查管道存在
        stmt = select(DataPipeline).where(DataPipeline.id == pipeline_id)
        result = await db.execute(stmt)
        pipeline = result.scalar_one_or_none()

        if not pipeline:
            raise ResourceNotFoundException("管道", pipeline_id)

        # 权限检查
        if not pipeline.is_public and pipeline.created_by != user_id:
            raise PermissionDeniedException("访问此管道")

        # 获取触发器
        trigger_stmt = select(PipelineTrigger).where(PipelineTrigger.pipeline_id == pipeline_id)
        trigger_result = await db.execute(trigger_stmt)
        trigger = trigger_result.scalar_one_or_none()

        if not trigger:
            raise ResourceNotFoundException("触发器", pipeline_id)

        # 执行一次轮询
        from app.services.pipeline.trigger_scheduler import TriggerScheduler

        scheduler = TriggerScheduler(db)
        current_max = await scheduler._get_current_max_value(trigger, pipeline.source_data_source_id)

        return {
            "source_table": trigger.source_table,
            "watermark_field": trigger.watermark_field,
            "current_max_value": current_max,
            "last_watermark_value": trigger.last_watermark_value,
            "has_new_data": scheduler._has_new_data(trigger, current_max) if current_max else False,
        }

    except AppException:
        raise
    except Exception as e:
        logger.error(f"测试触发器API错误: {str(e)}")
        raise DatabaseException("操作失败", original_error=e)

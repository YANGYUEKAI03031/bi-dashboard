# backend/app/api/v1/charts.py
# backend/app/api/v1/charts.py
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import logging
import json
import asyncio

from app.db.session import get_db
from app.services.chart_service import ChartService
from app.schemas.chart import ChartCreate, ChartUpdate, ChartResponse
from app.core.security import get_current_user_id

router = APIRouter(prefix="/charts", tags=["charts"])
logger = logging.getLogger(__name__)

@router.post("/", response_model=ChartResponse)
async def create_chart(
    chart_data: ChartCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """创建新图表"""
    try:
        service = ChartService(db)
        chart = await service.create_chart(chart_data, user_id)
        
        # 转换为响应模型 - 处理字段名映射
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,  # 字段名映射
            "creator_id": chart.created_by,  # 字段名映射
            "table_name": chart.table_name,  # 新增：表名字段
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)
        
    except Exception as e:
        logger.error(f"创建图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{chart_id}", response_model=ChartResponse)
async def get_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取图表详情"""
    try:
        service = ChartService(db)
        chart = await service.get_chart(chart_id, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
            
        # 转换为响应模型
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,
            "creator_id": chart.created_by,
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[ChartResponse])
async def get_user_charts(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取用户的所有图表"""
    try:
        service = ChartService(db)
        charts = await service.get_user_charts(user_id, skip, limit)
        
        # 转换为响应模型列表
        response_list = []
        for chart in charts:
            response_data = {
                "table_name": chart.table_name,  # 新增：表名字段
                "id": chart.id,
                "name": chart.name,
                "description": chart.description,
                "chart_type": chart.chart_type,
                "dataset_query": chart.dataset_query,
                "visualization_settings": chart.visualization_settings,
                "database_id": chart.data_source_id,
                "creator_id": chart.created_by,
                "table_name": chart.table_name,  # 新增：表名字段
                "is_public": chart.is_public,
                "archived": chart.archived,
                "cache_enabled": chart.cache_enabled,
                "cache_duration": chart.cache_duration,
                "created_at": chart.created_at,
                "updated_at": chart.updated_at
            }
            response_list.append(ChartResponse(**response_data))
        
        return response_list
        
    except Exception as e:
        logger.error(f"获取图表列表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{chart_id}", response_model=ChartResponse)
async def update_chart(
    chart_id: int,
    update_data: ChartUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """更新图表"""
    try:
        service = ChartService(db)
        chart = await service.update_chart(chart_id, update_data, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")

        # 转换为响应模型
        response_data = {
            "id": chart.id,
            "name": chart.name,
            "description": chart.description,
            "chart_type": chart.chart_type,
            "dataset_query": chart.dataset_query,
            "visualization_settings": chart.visualization_settings,
            "database_id": chart.data_source_id,
            "creator_id": chart.created_by,
            "is_public": chart.is_public,
            "archived": chart.archived,
            "cache_enabled": chart.cache_enabled,
            "cache_duration": chart.cache_duration,
            "created_at": chart.created_at,
            "updated_at": chart.updated_at
        }
        
        return ChartResponse(**response_data)

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{chart_id}")
async def delete_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """删除图表"""
    try:
        service = ChartService(db)
        success = await service.delete_chart(chart_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="图表不存在")
        
        return {"message": "图表删除成功"}
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除图表API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{chart_id}/query", response_model=dict)
async def execute_chart_query(
    chart_id: int,
    filter_params: Optional[dict] = Body(default=None),  # 接收筛选器参数
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """执行图表查询并返回数据"""
    try:
        service = ChartService(db)
        chart = await service.get_chart(chart_id, user_id)
        
        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")
        
        # 执行查询（带筛选器参数）
        query_result = await service.execute_chart_query(chart, filter_params if filter_params else {})
        
        return {
            "data": query_result,
            "columns": list(query_result[0].keys()) if query_result else [],
            "row_count": len(query_result)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"执行图表查询API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-query", response_model=dict)
async def execute_batch_chart_query(
    requests: List[dict],  # [{chart_id: 1, filter_params: {...}}, ...]
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
    concurrency: int = Query(4, ge=1, le=16, description="并发执行的图表数量上限")
):
    """批量执行多个图表查询，一次请求返回所有图表数据（支持并发）"""
    try:
        service = ChartService(db)

        # ========== 阶段 A：串行查询 chart 元数据（必须用 AsyncSession）==========
        chart_tasks = []
        for req in requests:
            chart_id = req.get("chart_id")
            filter_params = req.get("filter_params", {})
            if not chart_id:
                chart_tasks.append({
                    "chart_id": chart_id,
                    "error": "chart_id is required",
                    "filter_params": filter_params,
                    "chart": None,
                    "status": "error"
                })
                continue
            chart_tasks.append({
                "chart_id": chart_id,
                "filter_params": filter_params,
                "chart": None,
                "status": "pending"
            })

        # 串行把所有 chart 对象查出来（复用 AsyncSession）
        for task in chart_tasks:
            if task["status"] == "error":
                continue
            try:
                chart = await service.get_chart(task["chart_id"], user_id)
                if not chart:
                    task["error"] = "图表不存在"
                    task["status"] = "error"
                    continue
                task["chart"] = chart
            except Exception as e:
                logger.error(f"查询图表 {task['chart_id']} 元数据失败: {str(e)}")
                task["error"] = str(e)
                task["status"] = "error"

        # ========== 阶段 B：并发执行 SQL 查询（每个用独立 DB 连接）==========
        # Semaphore 限制并发数，避免 DB 连接池耗尽
        semaphore = asyncio.Semaphore(concurrency)

        async def execute_single_chart(task: dict):
            async with semaphore:
                if task["status"] == "error":
                    return task

                chart = task["chart"]
                filter_params = task.get("filter_params") or {}
                try:
                    query_result = await service.execute_chart_query(chart, filter_params)
                    task["data"] = query_result
                    task["columns"] = list(query_result[0].keys()) if query_result else []
                    task["row_count"] = len(query_result)
                    task["status"] = "done"
                except Exception as e:
                    logger.error(f"图表 {task['chart_id']} SQL 执行失败: {str(e)}")
                    task["error"] = str(e)
                    task["data"] = []
                    task["status"] = "error"
                return task

        # 并发执行所有图表的 SQL
        results = await asyncio.gather(*[execute_single_chart(t) for t in chart_tasks])

        # 转换为 API 响应格式
        final_results = []
        for r in results:
            final_results.append({
                "chart_id": r["chart_id"],
                "data": r.get("data", []),
                "columns": r.get("columns", []),
                "row_count": r.get("row_count", 0),
                "error": r.get("error")
            })

        return {"results": final_results}

    except Exception as e:
        logger.error(f"批量图表查询API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/filter-options")
async def get_filter_options(
    data_source_id: int,
    table_name: str,
    field_name: str,
    limit: int = Query(100, ge=1, le=1000),
    filter_conditions: Optional[str] = None,  # JSON 字符串，级联筛选条件
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """获取筛选器的选项列表（支持级联条件 filter_conditions=JSON）"""
    try:
        service = ChartService(db)
        conditions = json.loads(filter_conditions) if filter_conditions else None
        options = await service.get_filter_options(data_source_id, table_name, field_name, limit, conditions)
        return {"options": options}
    except Exception as e:
        logger.error(f"获取筛选器选项API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/filter-options-from-chart/{chart_id}")
async def get_filter_options_from_chart(
    chart_id: int,
    field_name: str,
    limit: int = Query(100, ge=1, le=1000),
    filter_conditions: Optional[str] = None,  # JSON 字符串，级联筛选条件
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id)
):
    """从图表的SQL查询中获取筛选器选项（自动提取表名和字段名，支持级联条件）"""
    try:
        service = ChartService(db)
        chart = await service.get_chart(chart_id, user_id)

        if not chart:
            raise HTTPException(status_code=404, detail="图表不存在")

        # 优先使用图表创建/更新时解析好的表名（更可靠）
        table_name = getattr(chart, "table_name", None)

        # 解析SQL获取表名（兜底）
        dataset_query = chart.dataset_query
        if isinstance(dataset_query, str):
            dataset_query = json.loads(dataset_query)

        sql_query = dataset_query.get('native', {}).get('query', '')
        if not sql_query:
            raise HTTPException(status_code=400, detail="图表SQL查询为空")

        if not table_name:
            import re
            from_match = re.search(
                r"\bFROM\s+"
                r"(?:(?:`(?P<schema_bt>[^`]+)`|(?P<schema>\w+))\s*\.\s*)?"
                r"(?:`(?P<table_bt>[^`]+)`|(?P<table>\w+))",
                sql_query,
                re.IGNORECASE,
            )
            if not from_match:
                raise HTTPException(status_code=400, detail="无法从SQL中提取表名（请在筛选器中显式配置选项来源表/字段）")

            schema = from_match.group("schema_bt") or from_match.group("schema")
            table = from_match.group("table_bt") or from_match.group("table")
            table_name = f"{schema}.{table}" if schema else table

        # 解析级联条件
        conditions = json.loads(filter_conditions) if filter_conditions else None

        # 获取筛选器选项（传入级联条件）
        options = await service.get_filter_options(chart.data_source_id, table_name, field_name, limit, conditions)
        return {
            "options": options,
            "data_source_id": chart.data_source_id,
            "table_name": table_name,
            "field_name": field_name
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"从图表获取筛选器选项API错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
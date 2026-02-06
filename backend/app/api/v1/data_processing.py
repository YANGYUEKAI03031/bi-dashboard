from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import sqlite3
from sqlalchemy import create_engine, text
import json
import time

router = APIRouter(prefix="/data-processing", tags=["data-processing"])

class FilterCondition(BaseModel):
    field: str
    operator: str
    value: str
    logic: str = "AND"

class FilterOperation(BaseModel):
    conditions: List[FilterCondition]
    join_logic: str = "AND"

class AggregationConfig(BaseModel):
    field: str
    function: str  # COUNT, SUM, AVG, MIN, MAX
    alias: str

class AggregateOperation(BaseModel):
    group_by: List[str]
    aggregations: List[AggregationConfig]

class TransformOperation(BaseModel):
    type: str  # formula, rename, cast
    field: str
    expression: Optional[str] = None
    new_field: Optional[str] = None

class ProcessingOperation(BaseModel):
    id: str
    type: str  # filter, aggregate, transform
    config: Dict[str, Any]

class ProcessDataRequest(BaseModel):
    input_data: Dict[str, Any]  # 可以是数据库查询结果或其他数据源
    operations: List[ProcessingOperation]
    connection_info: Optional[Dict[str, Any]] = None

class ProcessDataResponse(BaseModel):
    success: bool
    processed_data: List[Dict[str, Any]]
    row_count: int
    column_names: List[str]
    execution_time: float

@router.post("/process", response_model=ProcessDataResponse)
async def process_data(request: ProcessDataRequest):
    """处理数据的主要API端点"""
    start_time = time.time()
    
    try:
        # 获取输入数据
        if request.connection_info:
            # 从数据库获取数据
            df = await _get_data_from_database(request.connection_info)
        else:
            # 使用传入的数据
            df = pd.DataFrame(request.input_data.get('data', []))
        
        # 按顺序执行处理操作
        for operation in request.operations:
            df = await _execute_operation(df, operation)
        
        # 转换为响应格式
        processed_data = df.to_dict('records')
        column_names = list(df.columns) if len(df) > 0 else []
        
        execution_time = time.time() - start_time
        
        return ProcessDataResponse(
            success=True,
            processed_data=processed_data,
            row_count=len(processed_data),
            column_names=column_names,
            execution_time=execution_time
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"数据处理失败: {str(e)}")

async def _get_data_from_database(connection_info: Dict[str, Any]) -> pd.DataFrame:
    """从数据库获取数据"""
    try:
        # 根据连接信息创建数据库连接
        if connection_info.get('type') == 'mysql':
            connection_string = f"mysql+pymysql://{connection_info['username']}:{connection_info['password']}@{connection_info['host']}:{connection_info['port']}/{connection_info['database']}"
        elif connection_info.get('type') == 'postgresql':
            connection_string = f"postgresql://{connection_info['username']}:{connection_info['password']}@{connection_info['host']}:{connection_info['port']}/{connection_info['database']}"
        else:
            raise ValueError(f"不支持的数据库类型: {connection_info.get('type')}")
        
        engine = create_engine(connection_string)
        
        query = connection_info.get('query', 'SELECT * FROM your_table LIMIT 1000')
        
        with engine.connect() as conn:
            result = conn.execute(text(query))
            df = pd.DataFrame(result.fetchall(), columns=result.keys())
            
        return df
        
    except Exception as e:
        raise Exception(f"数据库连接失败: {str(e)}")

async def _execute_operation(df: pd.DataFrame, operation: ProcessingOperation) -> pd.DataFrame:
    """执行单个处理操作"""
    try:
        if operation.type == 'filter':
            return await _apply_filter(df, FilterOperation(**operation.config))
        elif operation.type == 'aggregate':
            return await _apply_aggregation(df, AggregateOperation(**operation.config))
        elif operation.type == 'transform':
            return await _apply_transform(df, TransformOperation(**operation.config))
        else:
            raise ValueError(f"不支持的操作类型: {operation.type}")
            
    except Exception as e:
        raise Exception(f"执行操作 {operation.id} 失败: {str(e)}")

async def _apply_filter(df: pd.DataFrame, filter_op: FilterOperation) -> pd.DataFrame:
    """应用筛选操作"""
    if not filter_op.conditions:
        return df
    
    # 构建筛选条件
    condition_strings = []
    for condition in filter_op.conditions:
        field = condition.field
        operator = condition.operator
        value = condition.value
        
        # 处理不同操作符
        if operator == '=':
            condition_str = f"`{field}` == '{value}'"
        elif operator == '!=':
            condition_str = f"`{field}` != '{value}'"
        elif operator == '>':
            condition_str = f"`{field}` > '{value}'"
        elif operator == '<':
            condition_str = f"`{field}` < '{value}'"
        elif operator == '>=':
            condition_str = f"`{field}` >= '{value}'"
        elif operator == '<=':
            condition_str = f"`{field}` <= '{value}'"
        elif operator == 'LIKE':
            condition_str = f"`{field}`.str.contains('{value}', na=False)"
        elif operator == 'NOT LIKE':
            condition_str = f"~(`{field}`.str.contains('{value}', na=False))"
        else:
            continue
            
        condition_strings.append(condition_str)
    
    # 组合条件
    if filter_op.join_logic.upper() == 'AND':
        combined_condition = ' & '.join(condition_strings)
    else:
        combined_condition = ' | '.join(condition_strings)
    
    # 应用筛选
    filtered_df = df.query(combined_condition) if condition_strings else df
    return filtered_df

async def _apply_aggregation(df: pd.DataFrame, agg_op: AggregateOperation) -> pd.DataFrame:
    """应用聚合操作"""
    if not agg_op.group_by and not agg_op.aggregations:
        return df
    
    # 准备聚合函数映射
    agg_functions = {}
    agg_columns = {}
    
    for agg in agg_op.aggregations:
        if agg.function.upper() == 'COUNT':
            agg_functions[agg.field] = 'count'
            agg_columns[agg.alias or f"{agg.field}_count"] = (agg.field, 'count')
        elif agg.function.upper() == 'SUM':
            agg_functions[agg.field] = 'sum'
            agg_columns[agg.alias or f"{agg.field}_sum"] = (agg.field, 'sum')
        elif agg.function.upper() == 'AVG':
            agg_functions[agg.field] = 'mean'
            agg_columns[agg.alias or f"{agg.field}_avg"] = (agg.field, 'mean')
        elif agg.function.upper() == 'MIN':
            agg_functions[agg.field] = 'min'
            agg_columns[agg.alias or f"{agg.field}_min"] = (agg.field, 'min')
        elif agg.function.upper() == 'MAX':
            agg_functions[agg.field] = 'max'
            agg_columns[agg.alias or f"{agg.field}_max"] = (agg.field, 'max')
    
    # 执行聚合
    if agg_op.group_by:
        # 分组聚合
        grouped = df.groupby(agg_op.group_by).agg(agg_functions)
        grouped = grouped.reset_index()
        # 重命名列
        if agg_columns:
            grouped.columns = agg_op.group_by + [alias for alias in agg_columns.keys()]
        return grouped
    else:
        # 全局聚合
        agg_result = df.agg(agg_functions)
        # 转换为DataFrame
        result_df = pd.DataFrame([agg_result.to_dict()])
        # 重命名列
        if agg_columns:
            result_df.columns = [alias for alias in agg_columns.keys()]
        return result_df

async def _apply_transform(df: pd.DataFrame, transform_op: TransformOperation) -> pd.DataFrame:
    """应用转换操作"""
    if transform_op.type == 'formula':
        # 公式转换
        if transform_op.expression and transform_op.new_field:
            try:
                # 安全地执行表达式（这里需要更安全的实现）
                df[transform_op.new_field] = df.eval(transform_op.expression)
            except Exception as e:
                raise Exception(f"公式计算失败: {str(e)}")
                
    elif transform_op.type == 'rename':
        # 重命名字段
        if transform_op.field and transform_op.new_field:
            df = df.rename(columns={transform_op.field: transform_op.new_field})
            
    elif transform_op.type == 'cast':
        # 类型转换
        if transform_op.field and transform_op.expression:
            try:
                if transform_op.expression.lower() == 'int':
                    df[transform_op.field] = pd.to_numeric(df[transform_op.field], errors='coerce').astype('Int64')
                elif transform_op.expression.lower() == 'float':
                    df[transform_op.field] = pd.to_numeric(df[transform_op.field], errors='coerce')
                elif transform_op.expression.lower() == 'str':
                    df[transform_op.field] = df[transform_op.field].astype(str)
                elif transform_op.expression.lower() == 'datetime':
                    df[transform_op.field] = pd.to_datetime(df[transform_op.field], errors='coerce')
            except Exception as e:
                raise Exception(f"类型转换失败: {str(e)}")
    
    return df
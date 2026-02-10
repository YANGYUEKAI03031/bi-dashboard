# backend/app/api/v1/python_execution.py
"""
Python代码执行API路由
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import aiomysql
import logging
from app.services.python_executor import python_executor
from app.core.config import settings
from app.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/python", tags=["python-execution"])

class PythonExecuteRequest(BaseModel):
    code: str
    table_name: str
    limit: Optional[int] = 1000

class PythonExecuteResponse(BaseModel):
    success: bool
    output: str
    data: Optional[Any] = None
    error: Optional[str] = None
    variables: Optional[List[str]] = None

async def get_table_data(table_name: str, limit: int = 1000) -> List[Dict]:
    """
    从MySQL数据库获取表数据
    """
    connection = None
    try:
        # 建立数据库连接
        connection = await aiomysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            db=settings.MYSQL_DATABASE,
            charset='utf8mb4',
            autocommit=True
        )
        
        cursor = await connection.cursor(aiomysql.DictCursor)
        
        # 查询数据
        query = f"SELECT * FROM `{table_name}` LIMIT {limit}"
        await cursor.execute(query)
        data = await cursor.fetchall()
        
        # 转换数据类型
        processed_data = []
        for row in data:
            processed_row = {}
            for key, value in row.items():
                # 处理datetime类型
                if hasattr(value, 'isoformat'):
                    processed_row[key] = value.isoformat()
                else:
                    processed_row[key] = value
            processed_data.append(processed_row)
        
        return processed_data
        
    except Exception as e:
        logger.error(f"获取表数据失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取数据失败: {str(e)}")
    finally:
        if connection:
            connection.close()

@router.post("/execute", response_model=PythonExecuteResponse)
async def execute_python_code(request: PythonExecuteRequest):
    """
    执行Python代码处理数据库表数据
    
    Args:
        request: 包含代码和表名的请求体
        
    Returns:
        Python执行结果
    """
    try:
        # 验证表名是否存在
        table_exists = await validate_table_exists(request.table_name)
        if not table_exists:
            raise HTTPException(status_code=404, detail=f"表 '{request.table_name}' 不存在")
        
        # 获取表数据
        data = await get_table_data(request.table_name, request.limit)
        
        if not data:
            return PythonExecuteResponse(
                success=True,
                output="表为空",
                data=[],
                variables=[]
            )
        
        # 执行Python代码
        result = python_executor.execute_code(request.code, data)
        
        logger.info(f"Python代码执行完成 - 表: {request.table_name}, 成功: {result['success']}")
        
        return PythonExecuteResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Python执行错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")

async def validate_table_exists(table_name: str) -> bool:
    """
    验证表是否存在
    """
    connection = None
    try:
        connection = await aiomysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            db=settings.MYSQL_DATABASE,
            charset='utf8mb4'
        )
        
        cursor = await connection.cursor()
        await cursor.execute("SHOW TABLES LIKE %s", (table_name,))
        result = await cursor.fetchone()
        return result is not None
        
    except Exception as e:
        logger.error(f"验证表存在性失败: {str(e)}")
        return False
    finally:
        if connection:
            connection.close()
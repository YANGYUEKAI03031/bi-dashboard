from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import aiomysql
import asyncio
from app.core.config import settings
from app.db.session import get_db
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/database", tags=["database"])

class DatabaseConnectionInfo(BaseModel):
    host: str = "localhost"
    port: int = 3306
    username: str = "root"
    password: str
    database: str

class QueryRequest(BaseModel):
    sql: str
    connection_info: Optional[DatabaseConnectionInfo] = None

class TablePreviewRequest(BaseModel):
    table_name: str
    limit: int = 100
    connection_info: Optional[DatabaseConnectionInfo] = None

class QueryResponse(BaseModel):
    success: bool
    data: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    error: Optional[str] = None

class TableInfo(BaseModel):
    name: str
    rows: Optional[int] = None
    size_mb: Optional[float] = None

class DatabaseInfoResponse(BaseModel):
    success: bool
    tables: List[TableInfo]
    database_name: str
    error: Optional[str] = None

async def get_database_connection(connection_info: DatabaseConnectionInfo = None):
    """获取数据库连接"""
    if connection_info is None:
        # 使用默认配置
        connection_info = DatabaseConnectionInfo(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            username=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            database=settings.MYSQL_DATABASE
        )
    
    try:
        connection = await aiomysql.connect(
            host=connection_info.host,
            port=connection_info.port,
            user=connection_info.username,
            password=connection_info.password,
            db=connection_info.database,
            charset='utf8mb4',
            autocommit=True
        )
        return connection
    except Exception as e:
        logger.error(f"数据库连接失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"数据库连接失败: {str(e)}")

@router.get("/tables", response_model=DatabaseInfoResponse)
async def get_database_tables(connection_info: DatabaseConnectionInfo = None):
    """获取数据库中的所有表"""
    connection = None
    try:
        connection = await get_database_connection(connection_info)
        cursor = await connection.cursor()
        
        # 获取表列表
        await cursor.execute("SHOW TABLES")
        tables = await cursor.fetchall()
        
        table_infos = []
        for table_row in tables:
            table_name = table_row[0]
            
            # 获取表的基本信息
            try:
                await cursor.execute(f"SELECT COUNT(*) FROM `{table_name}`")
                row_count = (await cursor.fetchone())[0]
                
                await cursor.execute(f"""
                    SELECT ROUND(((data_length + index_length) / 1024 / 1024), 2) 
                    FROM information_schema.tables 
                    WHERE table_schema = DATABASE() AND table_name = %s
                """, (table_name,))
                size_result = await cursor.fetchone()
                size_mb = float(size_result[0]) if size_result and size_result[0] else 0.0
                
                table_infos.append(TableInfo(
                    name=table_name,
                    rows=row_count,
                    size_mb=size_mb
                ))
            except Exception as e:
                logger.warning(f"获取表 {table_name} 信息失败: {str(e)}")
                table_infos.append(TableInfo(name=table_name))
        
        await cursor.close()
        
        return DatabaseInfoResponse(
            success=True,
            tables=table_infos,
            database_name=connection_info.database if connection_info else settings.MYSQL_DATABASE
        )
        
    except Exception as e:
        logger.error(f"获取表列表失败: {str(e)}")
        return DatabaseInfoResponse(
            success=False,
            tables=[],
            database_name="",
            error=str(e)
        )
    finally:
        if connection:
            connection.close()

@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    """执行SQL查询"""
    connection = None
    try:
        connection = await get_database_connection(request.connection_info)
        cursor = await connection.cursor(aiomysql.DictCursor)
        
        await cursor.execute(request.sql)
        results = await cursor.fetchall()
        
        # 获取列名
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        
        await cursor.close()
        
        return QueryResponse(
            success=True,
            data=[dict(row) for row in results],
            columns=columns,
            row_count=len(results)
        )
        
    except Exception as e:
        logger.error(f"查询执行失败: {str(e)}")
        return QueryResponse(
            success=False,
            data=[],
            columns=[],
            row_count=0,
            error=str(e)
        )
    finally:
        if connection:
            connection.close()

@router.post("/table-preview/{table_name}", response_model=QueryResponse)
async def get_table_preview(table_name: str, request: TablePreviewRequest):
    """获取表的预览数据"""
    connection = None
    try:
        connection = await get_database_connection(request.connection_info)
        cursor = await connection.cursor(aiomysql.DictCursor)
        
        # 验证表名安全性（简单验证，实际应该更严格）
        if not table_name.replace('_', '').replace('-', '').isalnum():
            raise HTTPException(status_code=400, detail="无效的表名")
        
        sql = f"SELECT * FROM `{table_name}` LIMIT {request.limit}"
        await cursor.execute(sql)
        results = await cursor.fetchall()
        
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        
        await cursor.close()
        
        return QueryResponse(
            success=True,
            data=[dict(row) for row in results],
            columns=columns,
            row_count=len(results)
        )
        
    except Exception as e:
        logger.error(f"获取表预览失败: {str(e)}")
        return QueryResponse(
            success=False,
            data=[],
            columns=[],
            row_count=0,
            error=str(e)
        )
    finally:
        if connection:
            connection.close()

@router.get("/table-schema/{table_name}")
async def get_table_schema(table_name: str, connection_info: DatabaseConnectionInfo = None):
    """获取表结构信息"""
    connection = None
    try:
        connection = await get_database_connection(connection_info)
        cursor = await connection.cursor()
        
        await cursor.execute(f"DESCRIBE `{table_name}`")
        schema_info = await cursor.fetchall()
        
        columns = []
        for row in schema_info:
            columns.append({
                "field": row[0],
                "type": row[1],
                "null": row[2],
                "key": row[3],
                "default": row[4],
                "extra": row[5]
            })
        
        await cursor.close()
        
        return {
            "success": True,
            "table_name": table_name,
            "columns": columns
        }
        
    except Exception as e:
        logger.error(f"获取表结构失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取表结构失败: {str(e)}")
    finally:
        if connection:
            connection.close()
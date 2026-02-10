from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import aiomysql
import asyncpg
from app.core.config import settings
import logging

router = APIRouter(prefix="/visualization/datasources", tags=["visualization-datasources"])
logger = logging.getLogger(__name__)

class DataSourceConfig(BaseModel):
    name: str
    type: str  # mysql, postgresql
    host: str
    port: int
    username: str
    password: str
    database: str
    is_active: bool = True

class TestConnectionRequest(BaseModel):
    type: str
    host: str
    port: int
    username: str
    password: str
    database: str

class QueryRequest(BaseModel):
    sql: str
    datasource_type: str
    connection_config: Optional[Dict[str, Any]] = None

class QueryResponse(BaseModel):
    success: bool
    data: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    execution_time: float
    error: Optional[str] = None

class TableInfo(BaseModel):
    name: str
    rows: Optional[int] = None
    columns: Optional[List[str]] = None

class ColumnInfo(BaseModel):
    name: str
    type: str
    is_nullable: bool = True

async def get_database_connection(config: Dict[str, Any]):
    """获取数据库连接"""
    try:
        if config.get('type', 'mysql') == 'mysql':
            connection = await aiomysql.connect(
                host=config["host"],
                port=config.get("port", 3306),
                user=config["username"],
                password=config["password"],
                db=config["database"],
                autocommit=True,
                charset='utf8mb4'
            )
        elif config.get('type') == 'postgresql':
            connection = await asyncpg.connect(
                host=config["host"],
                port=config.get("port", 5432),
                user=config["username"],
                password=config["password"],
                database=config["database"]
            )
        else:
            raise ValueError(f"不支持的数据库类型: {config.get('type')}")
        
        return connection
    except Exception as e:
        logger.error(f"数据库连接失败: {str(e)}")
        raise Exception(f"数据库连接失败: {str(e)}")

@router.get("/", response_model=List[DataSourceConfig])
async def get_visualization_datasources():
    """获取可视化专用的数据源列表"""
    try:
        # 返回默认配置的数据源
        default_sources = [
            DataSourceConfig(
                name=f"默认MySQL ({settings.MYSQL_DATABASE})",
                type="mysql",
                host=settings.MYSQL_HOST,
                port=settings.MYSQL_PORT,
                username=settings.MYSQL_USER,
                password=settings.MYSQL_PASSWORD,
                database=settings.MYSQL_DATABASE
            )
        ]
        return default_sources
    except Exception as e:
        logger.error(f"获取数据源列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test-connection")
async def test_database_connection(request: TestConnectionRequest):
    """测试数据库连接"""
    try:
        connection = await get_database_connection(request.dict())
        
        # 执行简单查询测试连接
        if request.type == 'mysql':
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT 1")
        else:  # postgresql
            await connection.fetchval("SELECT 1")
        
        connection.close()
        return {"success": True, "message": "连接成功"}
        
    except Exception as e:
        logger.error(f"连接测试失败: {str(e)}")
        return {"success": False, "message": f"连接失败: {str(e)}"}

@router.get("/{datasource_type}/tables", response_model=List[TableInfo])
async def get_tables(datasource_type: str):
    """获取表列表"""
    try:
        # 使用默认配置
        config = {
            "type": datasource_type,
            "host": settings.MYSQL_HOST,
            "port": settings.MYSQL_PORT,
            "username": settings.MYSQL_USER,
            "password": settings.MYSQL_PASSWORD,
            "database": settings.MYSQL_DATABASE
        }
        
        connection = await get_database_connection(config)
        tables = []
        
        if datasource_type == 'mysql':
            async with connection.cursor(aiomysql.DictCursor) as cursor:
                # 获取所有表名
                await cursor.execute("SHOW TABLES")
                tables_result = await cursor.fetchall()
                
                table_prefix = f"Tables_in_{settings.MYSQL_DATABASE}"
                
                for table_row in tables_result:
                    table_name = table_row[table_prefix]
                    
                    # 获取表行数
                    await cursor.execute(f"SELECT COUNT(*) as row_count FROM `{table_name}`")
                    count_result = await cursor.fetchone()
                    
                    # 获取列名
                    await cursor.execute(f"DESCRIBE `{table_name}`")
                    columns_result = await cursor.fetchall()
                    columns = [col['Field'] for col in columns_result]
                    
                    tables.append(TableInfo(
                        name=table_name,
                        rows=count_result['row_count'] if count_result else 0,
                        columns=columns
                    ))
        else:
            # PostgreSQL实现...
            pass
            
        connection.close()
        return tables
        
    except Exception as e:
        logger.error(f"获取表列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{datasource_type}/tables/{table_name}/columns", response_model=List[ColumnInfo])
async def get_table_columns(datasource_type: str, table_name: str):
    """获取表的列信息"""
    try:
        config = {
            "type": datasource_type,
            "host": settings.MYSQL_HOST,
            "port": settings.MYSQL_PORT,
            "username": settings.MYSQL_USER,
            "password": settings.MYSQL_PASSWORD,
            "database": settings.MYSQL_DATABASE
        }
        
        connection = await get_database_connection(config)
        columns = []
        
        if datasource_type == 'mysql':
            async with connection.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(f"DESCRIBE `{table_name}`")
                columns_result = await cursor.fetchall()
                
                for col in columns_result:
                    columns.append(ColumnInfo(
                        name=col['Field'],
                        type=col['Type'],
                        is_nullable=col['Null'] == 'YES'
                    ))
        else:
            # PostgreSQL实现...
            pass
            
        connection.close()
        return columns
        
    except Exception as e:
        logger.error(f"获取列信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：执行真实数据库查询
@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    """执行数据库查询并返回真实数据"""
    import time
    start_time = time.time()
    
    try:
        # 使用默认配置或传入的配置
        if request.connection_config:
            config = request.connection_config
        else:
            config = {
                "type": request.datasource_type,
                "host": settings.MYSQL_HOST,
                "port": settings.MYSQL_PORT,
                "username": settings.MYSQL_USER,
                "password": settings.MYSQL_PASSWORD,
                "database": settings.MYSQL_DATABASE
            }
        
        connection = await get_database_connection(config)
        
        # 安全检查：只允许SELECT查询
        query_upper = request.sql.strip().upper()
        if not query_upper.startswith('SELECT'):
            raise ValueError("只允许执行SELECT查询")
        
        data = []
        columns = []
        row_count = 0
        
        if request.datasource_type == 'mysql':
            async with connection.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(request.sql)
                results = await cursor.fetchall()
                
                # 获取列名
                if cursor.description:
                    columns = [desc[0] for desc in cursor.description]
                
                # 转换数据格式
                data = [dict(row) for row in results]
                row_count = len(data)
        else:
            # PostgreSQL实现...
            pass
            
        connection.close()
        
        execution_time = time.time() - start_time
        
        return QueryResponse(
            success=True,
            data=data,
            columns=columns,
            row_count=row_count,
            execution_time=execution_time
        )
        
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"查询执行失败: {str(e)}")
        return QueryResponse(
            success=False,
            data=[],
            columns=[],
            row_count=0,
            execution_time=execution_time,
            error=str(e)
        )
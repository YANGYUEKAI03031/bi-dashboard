from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Any, Optional
from app.db.session import get_db
from app.core.config import settings
from pydantic import BaseModel
import logging

router = APIRouter(tags=["visualization-datasources"])

logger = logging.getLogger(__name__)

# 使用Pydantic模型替代普通类
class ColumnInfo(BaseModel):
    name: str
    type: str
    is_nullable: bool
    default_value: Optional[str] = None

class TableInfo(BaseModel):
    name: str
    columns: List[ColumnInfo] = []

@router.get("/", response_model=List[Dict[str, str]])
async def get_visualization_datasources():
    """获取可视化专用的数据源列表"""
    try:
        datasources = []
        
        # 检查MySQL配置
        if settings.MYSQL_HOST and settings.MYSQL_DATABASE:
            datasources.append({
                "id": "mysql_datasource",
                "name": f"MySQL - {settings.MYSQL_DATABASE}",
                "type": "mysql",
                "host": settings.MYSQL_HOST,
                "port": str(settings.MYSQL_PORT),
                "database": settings.MYSQL_DATABASE
            })
        
        logger.info(f"返回 {len(datasources)} 个数据源")
        return datasources
        
    except Exception as e:
        logger.error(f"获取数据源列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取数据源列表失败: {str(e)}")

@router.get("/{datasource_type}/tables", response_model=List[TableInfo])
async def get_tables(datasource_type: str, db: Session = Depends(get_db)):
    """获取指定数据源的表列表"""
    try:
        # 验证数据源类型
        if datasource_type != 'mysql':
            raise HTTPException(status_code=400, detail=f"不支持的数据源类型: {datasource_type}")
        
        # 使用现有的SQLAlchemy会话查询表信息
        result = await db.execute(text("SHOW TABLES"))
        tables = result.fetchall()
        
        table_infos = []
        for table in tables:
            table_name = table[0]
            
            # 使用反引号包围表名以避免关键字冲突
            describe_result = await db.execute(text(f"DESCRIBE `{table_name}`"))
            columns_info = describe_result.fetchall()
            
            columns = []
            for col_info in columns_info:
                columns.append(ColumnInfo(
                    name=col_info[0],
                    type=col_info[1],
                    is_nullable=col_info[2] == 'YES',
                    default_value=col_info[4]
                ))
            
            table_infos.append(TableInfo(name=table_name, columns=columns))
        
        return table_infos
            
    except Exception as e:
        logger.error(f"获取表列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取表列表失败: {str(e)}")

@router.get("/{datasource_type}/tables/{table_name}/columns", response_model=List[ColumnInfo])
async def get_table_columns(datasource_type: str, table_name: str, db: Session = Depends(get_db)):
    """获取指定表的列信息"""
    try:
        # 验证数据源类型
        if datasource_type != 'mysql':
            raise HTTPException(status_code=400, detail=f"不支持的数据源类型: {datasource_type}")
        
        # 使用反引号包围表名以避免关键字冲突
        result = await db.execute(text(f"DESCRIBE `{table_name}`"))
        columns_info = result.fetchall()
        
        columns = []
        for col_info in columns_info:
            columns.append(ColumnInfo(
                name=col_info[0],
                type=col_info[1],
                is_nullable=col_info[2] == 'YES',
                default_value=col_info[4]
            ))
        
        return columns
            
    except Exception as e:
        logger.error(f"获取列信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取列信息失败: {str(e)}")

@router.post("/query")
async def execute_query(query_request: Dict[str, Any], db: Session = Depends(get_db)):
    """执行SQL查询"""
    try:
        sql_query = query_request.get("query")
        
        if not sql_query:
            raise HTTPException(status_code=400, detail="查询语句不能为空")
        
        # 使用现有的SQLAlchemy会话执行查询
        result = await db.execute(text(sql_query))
        rows = result.fetchall()
        
        # 获取列名
        if result.keys():
            column_names = list(result.keys())
        else:
            # 如果没有列信息，创建默认列名
            column_names = [f"column_{i}" for i in range(len(rows[0]) if rows else 0)]
        
        # 格式化结果
        result_rows = []
        for row in rows:
            row_dict = {}
            for i, value in enumerate(row):
                col_name = column_names[i] if i < len(column_names) else f"column_{i}"
                row_dict[col_name] = value
            result_rows.append(row_dict)
        
        return {
            "columns": column_names,
            "rows": result_rows,
            "row_count": len(result_rows)
        }
        
    except Exception as e:
        logger.error(f"查询执行失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"查询执行失败: {str(e)}")
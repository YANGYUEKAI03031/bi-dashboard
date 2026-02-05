# backend/app/api/v1/data_chain.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import logging
from typing import List, Dict, Any
from datetime import datetime, date

from app.db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/tables")
async def get_database_tables(db: AsyncSession = Depends(get_db)):
    """获取数据库中除useraccount外的所有表（使用实际行数）"""
    try:
        logger.info("开始获取数据库表列表...")
        
        # 先获取表基本信息
        basic_query = text("""
        SELECT 
            t.TABLE_NAME as table_name,
            t.CREATE_TIME as create_time,
            (SELECT COUNT(*) 
             FROM INFORMATION_SCHEMA.COLUMNS c
             WHERE c.TABLE_SCHEMA = DATABASE() 
             AND c.TABLE_NAME = t.TABLE_NAME) as column_count
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_NAME != 'useraccount'
        AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME
        """)
        
        basic_result = await db.execute(basic_query)
        basic_rows = basic_result.fetchall()
        
        # 逐个获取实际行数
        tables = []
        for row in basic_rows:
            table_name = row[0]
            try:
                # 获取实际行数
                count_query = text(f"SELECT COUNT(*) FROM `{table_name}`")
                count_result = await db.execute(count_query)
                actual_count = count_result.scalar()
                
                table_info = {
                    "name": str(table_name),
                    "rows": int(actual_count) if actual_count is not None else 0,
                    "columns": int(row[2]) if row[2] is not None else 0,
                    "created_at": str(row[1]) if row[1] else ""
                }
                tables.append(table_info)
                logger.debug(f"表 {table_name}: {actual_count} 行")
                
            except Exception as e:
                logger.warning(f"获取表 {table_name} 行数失败: {e}")
                # 出错时使用0作为行数
                tables.append({
                    "name": str(table_name),
                    "rows": 0,
                    "columns": int(row[2]) if row[2] is not None else 0,
                    "created_at": str(row[1]) if row[1] else ""
                })
        
        logger.info(f"成功获取到 {len(tables)} 个表的实际行数")
        return {"tables": tables}
        
    except Exception as e:
        logger.error(f"获取表列表时发生错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取表列表失败: {str(e)}")

@router.get("/table/{table_name}/preview")
async def get_table_preview(table_name: str, db: AsyncSession = Depends(get_db)):
    """获取指定表的前10行数据预览"""
    try:
        logger.info(f"开始预览表: {table_name}")
        
        # 验证表名安全性
        if table_name == 'useraccount' or not table_name.replace('_', '').isalnum():
            raise HTTPException(status_code=400, detail="无效的表名")
        
        # 检查表是否存在
        check_query = text("""
        SELECT COUNT(*) 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = :table_name
        """)
        
        check_result = await db.execute(check_query, {"table_name": table_name})
        count = check_result.scalar()
        
        if count == 0:
            raise HTTPException(status_code=404, detail="表不存在")
        
        logger.info(f"表 {table_name} 存在")
        
        # 获取表的列信息
        columns_query = text("""
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table_name
        ORDER BY ORDINAL_POSITION
        """)
        
        columns_result = await db.execute(columns_query, {"table_name": table_name})
        columns = columns_result.fetchall()
        
        if not columns:
            return {
                "table_name": table_name,
                "columns": [],
                "rows": [],
                "total_rows": 0
            }
        
        logger.info(f"表 {table_name} 有 {len(columns)} 列")
        
        # 获取实际行数
        count_query = text(f"SELECT COUNT(*) FROM `{table_name}`")
        count_result = await db.execute(count_query)
        total_rows = count_result.scalar()
        
        # 选择前5个非文本列进行预览
        preview_columns = []
        text_columns_skipped = 0
        
        for col in columns:
            col_name, data_type = col[0], col[1]
            if data_type.lower() not in ['text', 'tinytext', 'mediumtext', 'longtext', 'blob', 'tinyblob', 'mediumblob', 'longblob']:
                preview_columns.append(col_name)
            else:
                text_columns_skipped += 1
        
        # 如果没有非文本列，就选择前5列
        if not preview_columns:
            preview_columns = [col[0] for col in columns[:5]]
        else:
            preview_columns = preview_columns[:5]
        
        logger.info(f"预览列: {preview_columns}")
        
        # 构建安全的查询
        escaped_columns = [f"`{col}`" for col in preview_columns]
        select_clause = ", ".join(escaped_columns)
        data_query = text(f"SELECT {select_clause} FROM `{table_name}` LIMIT 10")
        
        data_result = await db.execute(data_query)
        raw_rows = data_result.fetchall()
        
        # 处理数据
        processed_rows = []
        for row in raw_rows:
            row_dict = {}
            if isinstance(row, (list, tuple)):
                row_data = dict(zip(preview_columns, row))
            else:
                row_data = row
            
            for col_name in preview_columns:
                try:
                    if isinstance(row_data, dict):
                        value = row_data.get(col_name)
                    else:
                        value = getattr(row_data, col_name, None)
                    
                    if value is None:
                        row_dict[col_name] = None
                    elif isinstance(value, (datetime, date)):
                        row_dict[col_name] = str(value)
                    elif isinstance(value, (int, float, str, bool)):
                        row_dict[col_name] = value
                    else:
                        row_dict[col_name] = str(value)
                        
                except Exception as e:
                    logger.warning(f"处理字段 {col_name} 时出错: {e}")
                    row_dict[col_name] = "[处理错误]"
            
            processed_rows.append(row_dict)
        
        result = {
            "table_name": table_name,
            "columns": [{"name": col[0], "type": col[1]} for col in columns],
            "rows": processed_rows,
            "total_rows": int(total_rows) if total_rows is not None else 0
        }
        
        if text_columns_skipped > 0:
            result["warning"] = f"跳过了 {text_columns_skipped} 个文本类型的列"
        
        logger.info(f"成功预览表 {table_name}，返回 {len(processed_rows)} 行数据，总计 {total_rows} 行")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"预览表 {table_name} 时发生错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取表数据预览失败: {str(e)}")

@router.post("/table/{table_name}/analyze")
async def start_table_analysis(table_name: str, db: AsyncSession = Depends(get_db)):
    """开始对指定表进行数据分析"""
    try:
        # 验证表名
        if table_name == 'useraccount' or not table_name.replace('_', '').isalnum():
            raise HTTPException(status_code=400, detail="无效的表名")
        
        # 检查表是否存在
        check_query = text("""
        SELECT COUNT(*) 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = :table_name
        """)
        
        check_result = await db.execute(check_query, {"table_name": table_name})
        if check_result.scalar() == 0:
            raise HTTPException(status_code=404, detail="表不存在")
        
        # 获取表的实际行数和列数
        stats_query = text(f"""
        SELECT 
            COUNT(*) as total_rows,
            (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name) as total_columns
        FROM `{table_name}`
        """)
        
        stats_result = await db.execute(stats_query, {"table_name": table_name})
        stats = stats_result.fetchone()
        
        # 分析步骤定义
        analysis_steps = [
            {
                "id": 1,
                "name": "数据概览",
                "description": "获取表的基本信息和数据分布",
                "status": "pending"
            },
            {
                "id": 2,
                "name": "数据质量检查",
                "description": "检查缺失值、重复值和异常值",
                "status": "pending"
            },
            {
                "id": 3,
                "name": "统计分析",
                "description": "计算基本统计指标",
                "status": "pending"
            },
            {
                "id": 4,
                "name": "可视化准备",
                "description": "准备图表数据和配置",
                "status": "pending"
            }
        ]
        
        return {
            "table_name": table_name,
            "basic_stats": {
                "total_rows": int(stats[0]),
                "total_columns": int(stats[1])
            },
            "analysis_steps": analysis_steps,
            "status": "started"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"启动分析失败 {table_name}: {e}")
        raise HTTPException(status_code=500, detail="启动分析失败")

@router.get("/table/{table_name}/columns")
async def get_table_columns(table_name: str, db: AsyncSession = Depends(get_db)):
    """获取表的列信息"""
    try:
        columns_query = text("""
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT,
            CHARACTER_MAXIMUM_LENGTH,
            NUMERIC_PRECISION,
            NUMERIC_SCALE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table_name
        ORDER BY ORDINAL_POSITION
        """)
        
        result = await db.execute(columns_query, {"table_name": table_name})
        columns = []
        
        for row in result.fetchall():
            columns.append({
                "name": row[0],
                "data_type": row[1],
                "is_nullable": row[2] == 'YES',
                "default": row[3],
                "max_length": row[4],
                "precision": row[5],
                "scale": row[6]
            })
        
        return {"columns": columns}
        
    except Exception as e:
        logger.error(f"获取列信息失败 {table_name}: {e}")
        raise HTTPException(status_code=500, detail="获取列信息失败")
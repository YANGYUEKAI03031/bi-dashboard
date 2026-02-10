# backend/app/api/v1/data_analyzer.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import logging
from typing import List, Dict, Any

from app.db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/datasets")
async def get_datasets(db: AsyncSession = Depends(get_db)):
    """获取所有数据集（表）信息"""
    try:
        logger.info("开始获取数据集列表...")
        
        # 先测试数据库连接
        try:
            test_result = await db.execute(text("SELECT 1"))
            logger.info("数据库连接正常")
        except Exception as conn_error:
            logger.error(f"数据库连接测试失败: {conn_error}")
            raise HTTPException(status_code=500, detail=f"数据库连接失败: {str(conn_error)}")
        
        # 获取所有表的基本信息
        query = text("""
        SELECT 
            t.TABLE_NAME as name,
            t.TABLE_ROWS as row_count,
            t.CREATE_TIME as created_at,
            (SELECT COUNT(*) 
             FROM INFORMATION_SCHEMA.COLUMNS c
             WHERE c.TABLE_SCHEMA = DATABASE() 
             AND c.TABLE_NAME = t.TABLE_NAME) as column_count
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_NAME NOT IN ('useraccount', 'alembic_version')
        AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME
        """)
        
        result = await db.execute(query)
        rows = result.fetchall()
        logger.info(f"查询到 {len(rows)} 张表")
        
        # 获取每张表的列名
        datasets = []
        for i, row in enumerate(rows):
            table_name = row[0]
            logger.debug(f"处理表 {i+1}/{len(rows)}: {table_name}")
            try:
                # 获取列名
                columns_query = text("""
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = :table_name 
                ORDER BY ORDINAL_POSITION
                """)
                
                columns_result = await db.execute(columns_query, {"table_name": table_name})
                columns = [col[0] for col in columns_result.fetchall()]
                logger.debug(f"表 {table_name} 有 {len(columns)} 列")
                
                dataset_info = {
                    "id": table_name,
                    "name": table_name,
                    "table_name": table_name,
                    "columns": columns,
                    "row_count": int(row[1]) if row[1] is not None else 0,
                    "created_at": str(row[2]) if row[2] else ""
                }
                datasets.append(dataset_info)
                
            except Exception as e:
                logger.warning(f"获取表 {table_name} 列信息失败: {e}")
                datasets.append({
                    "id": table_name,
                    "name": table_name,
                    "table_name": table_name,
                    "columns": [],
                    "row_count": int(row[1]) if row[1] is not None else 0,
                    "created_at": str(row[2]) if row[2] else ""
                })
        
        logger.info(f"成功获取到 {len(datasets)} 个数据集")
        return {"datasets": datasets, "total_tables": len(datasets)}
        
    except Exception as e:
        logger.error(f"获取数据集列表时发生错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取数据集失败: {str(e)}")

@router.get("/datasets/{dataset_id}/data")
async def get_dataset_data(dataset_id: str, limit: int = 1000, db: AsyncSession = Depends(get_db)):
    """获取特定数据集的数据"""
    try:
        logger.info(f"开始获取数据集 {dataset_id} 的数据，限制: {limit}")
        
        # 验证表名安全性
        if not dataset_id.replace('_', '').replace('-', '').isalnum():
            raise HTTPException(status_code=400, detail="无效的数据集ID")
        
        # 检查表是否存在
        check_query = text("""
        SELECT COUNT(*) 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = :table_name
        """)
        
        check_result = await db.execute(check_query, {"table_name": dataset_id})
        count = check_result.scalar()
        logger.info(f"表 {dataset_id} 存在性检查: {count}")
        
        if count == 0:
            raise HTTPException(status_code=404, detail="数据集不存在")
        
        # 测试简单查询
        try:
            test_query = text("SELECT COUNT(*) FROM `" + dataset_id + "`")
            test_result = await db.execute(test_query)
            total_count = test_result.scalar()
            logger.info(f"表 {dataset_id} 总行数: {total_count}")
        except Exception as test_error:
            logger.error(f"测试查询失败: {test_error}")
            raise HTTPException(status_code=500, detail=f"表查询测试失败: {str(test_error)}")
        
        # 获取数据
        data_query = text(f"SELECT * FROM `{dataset_id}` LIMIT :limit")
        data_result = await db.execute(data_query, {"limit": limit})
        rows = data_result.fetchall()
        logger.info(f"获取到 {len(rows)} 行数据")
        
        # 获取列名
        columns = [desc[0] for desc in data_result.cursor.description] if data_result.cursor.description else []
        logger.info(f"列名: {columns}")
        
        # 转换为字典格式
        data_list = []
        for i, row in enumerate(rows):
            row_dict = {}
            for j, col_name in enumerate(columns):
                row_dict[col_name] = str(row[j]) if row[j] is not None else None
            data_list.append(row_dict)
            if i < 3:  # 只记录前3行用于调试
                logger.debug(f"行 {i}: {row_dict}")
        
        logger.info(f"成功获取 {len(data_list)} 行数据")
        return {
            "success": True,
            "data": data_list,
            "columns": columns,
            "row_count": len(data_list),
            "total_count": total_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取数据集数据失败 {dataset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取数据失败: {str(e)}")

@router.get("/datasets/{dataset_id}/columns")
async def get_dataset_columns(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """获取数据集的列信息"""
    try:
        logger.info(f"获取表 {dataset_id} 的列信息")
        
        # 获取列详细信息
        columns_query = text("""
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT,
            COLUMN_KEY,
            EXTRA,
            COLUMN_COMMENT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table_name
        ORDER BY ORDINAL_POSITION
        """)
        
        result = await db.execute(columns_query, {"table_name": dataset_id})
        columns = result.fetchall()
        logger.info(f"获取到 {len(columns)} 列信息")
        
        column_details = []
        for col in columns:
            column_details.append({
                "name": col[0],
                "type": col[1],
                "nullable": col[2] == 'YES',
                "default": col[3],
                "primary_key": col[4] == 'PRI',
                "extra": col[5],
                "comment": col[6] or ""
            })
        
        return {
            "success": True,
            "columns": column_details
        }
        
    except Exception as e:
        logger.error(f"获取列信息失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取列信息失败: {str(e)}")
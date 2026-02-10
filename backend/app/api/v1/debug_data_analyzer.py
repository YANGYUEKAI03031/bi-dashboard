# debug_data_analyzer.py - 放在backend目录下
import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def test_database_connection():
    """测试数据库连接和基本查询"""
    try:
        print("🔍 测试数据库连接...")
        
        # 创建引擎
        engine = create_async_engine(settings.DATABASE_URL, echo=True)
        
        async with engine.connect() as conn:
            # 测试基本连接
            result = await conn.execute(text("SELECT 1 as test"))
            print(f"✅ 连接测试: {result.fetchone()}")
            
            # 获取所有表
            print("\n📋 获取所有表...")
            tables_query = text("""
            SELECT 
                TABLE_NAME,
                TABLE_ROWS,
                CREATE_TIME
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME NOT IN ('useraccount', 'alembic_version')
            AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
            """)
            
            tables_result = await conn.execute(tables_query)
            tables = tables_result.fetchall()
            print(f"找到 {len(tables)} 张表:")
            
            for table in tables:
                print(f"  - {table[0]} ({table[1]} 行, 创建时间: {table[2]})")
                
                # 获取列信息
                try:
                    columns_query = text("""
                    SELECT COLUMN_NAME, DATA_TYPE 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = :table_name 
                    ORDER BY ORDINAL_POSITION
                    """)
                    
                    columns_result = await conn.execute(columns_query, {"table_name": table[0]})
                    columns = columns_result.fetchall()
                    print(f"    列: {[f'{col[0]}({col[1]})' for col in columns]}")
                    
                    # 测试数据查询
                    if len(columns) > 0:
                        data_query = text(f"SELECT * FROM `{table[0]}` LIMIT 3")
                        data_result = await conn.execute(data_query)
                        data_rows = data_result.fetchall()
                        print(f"    前3行数据: {len(data_rows)} 行")
                        
                except Exception as e:
                    print(f"    ❌ 获取表 {table[0]} 信息失败: {e}")
            
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_database_connection())
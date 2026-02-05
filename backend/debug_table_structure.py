# backend/debug_table_structure.py
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def analyze_table_structure(table_name="pinjia"):
    """详细分析表结构和数据"""
    try:
        print(f"🔍 分析表 '{table_name}' 的详细信息...")
        
        # 创建独立的引擎进行调试
        engine = create_async_engine(
            settings.DATABASE_URL,
            echo=True,  # 显示SQL语句
            pool_pre_ping=True
        )
        
        async with engine.connect() as conn:
            # 1. 检查表是否存在
            print("\n1. 检查表是否存在...")
            check_query = """
            SELECT 
                TABLE_NAME,
                TABLE_ROWS,
                TABLE_TYPE,
                ENGINE,
                ROW_FORMAT
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = :table_name
            """
            
            result = await conn.execute(text(check_query), {"table_name": table_name})
            table_info = result.fetchone()
            
            if not table_info:
                print(f"❌ 表 '{table_name}' 不存在")
                # 列出所有表
                list_query = """
                SELECT TABLE_NAME, TABLE_ROWS 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
                """
                result = await conn.execute(text(list_query))
                tables = result.fetchall()
                print("📋 可用的表:")
                for table in tables:
                    print(f"  - {table[0]} ({table[1]} 行)")
                return False
            
            print(f"✅ 表存在: {table_info}")
            
            # 2. 获取详细的列信息
            print("\n2. 获取列信息...")
            columns_query = """
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE,
                COLUMN_KEY,
                EXTRA
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = :table_name
            ORDER BY ORDINAL_POSITION
            """
            
            result = await conn.execute(text(columns_query), {"table_name": table_name})
            columns = result.fetchall()
            
            print(f"📋 列信息 ({len(columns)} 列):")
            for col in columns:
                print(f"  - {col[0]} ({col[1]}) {'[KEY]' if col[7] == 'PRI' else ''} {'[NULL]' if col[2] == 'YES' else ''}")
            
            # 3. 检查实际行数
            print("\n3. 检查实际数据行数...")
            try:
                count_query = f"SELECT COUNT(*) FROM `{table_name}`"
                result = await conn.execute(text(count_query))
                actual_count = result.scalar()
                print(f"📊 实际行数: {actual_count}")
                print(f"📊 元数据行数: {table_info[1]}")
            except Exception as e:
                print(f"⚠️  无法获取实际行数: {e}")
            
            # 4. 尝试获取前几行数据
            print("\n4. 尝试获取数据预览...")
            if columns:
                # 只选择非BLOB类型的列进行预览
                safe_columns = []
                for col in columns:
                    col_name, data_type = col[0], col[1]
                    # 避免BLOB、TEXT等大字段
                    if not any(keyword in data_type.upper() for keyword in ['BLOB', 'TEXT', 'JSON']):
                        safe_columns.append(f"`{col_name}`")
                
                if safe_columns:
                    # 限制列数避免问题
                    preview_columns = safe_columns[:5]
                    preview_query = f"SELECT {', '.join(preview_columns)} FROM `{table_name}` LIMIT 3"
                    
                    print(f"执行预览查询: {preview_query}")
                    result = await conn.execute(text(preview_query))
                    rows = result.fetchall()
                    
                    print(f"📊 预览数据 ({len(rows)} 行):")
                    for i, row in enumerate(rows):
                        print(f"  行{i+1}: {row}")
                else:
                    print("⚠️  没有找到适合预览的安全列")
            
            await engine.dispose()
            return True
            
    except Exception as e:
        print(f"❌ 分析过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_api_endpoints():
    """测试API端点"""
    import requests
    
    base_url = "http://localhost:8000/api/v1/data"
    
    print("\n🧪 测试API端点...")
    
    # 测试表预览
    table_name = "pinjia"
    print(f"测试表预览: {table_name}")
    
    try:
        response = requests.get(f"{base_url}/table/{table_name}/preview")
        print(f"状态码: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print("✅ 预览成功:")
            print(f"  表名: {data['table_name']}")
            print(f"  列数: {len(data['columns'])}")
            print(f"  行数: {data['total_rows']}")
            if data['rows']:
                print("  数据示例:")
                for i, row in enumerate(data['rows'][:2]):
                    print(f"    {i+1}: {str(row)[:100]}...")
        else:
            print(f"❌ 预览失败: {response.status_code}")
            print(f"错误详情: {response.text}")
            
    except Exception as e:
        print(f"❌ API请求失败: {e}")

if __name__ == "__main__":
    print("=" * 60)
    print("🔍 表结构和数据调试工具")
    print("=" * 60)
    
    # 分析表结构
    success = asyncio.run(analyze_table_structure("pinjia"))
    
    if success:
        # 测试API
        asyncio.run(test_api_endpoints())
    
    print("\n" + "=" * 60)
    print("调试完成")
    print("=" * 60)
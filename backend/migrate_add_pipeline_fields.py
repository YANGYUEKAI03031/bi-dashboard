# migrate_add_pipeline_fields.py
"""添加 pipeline_executions 表缺失字段的迁移脚本"""
import asyncio
import aiomysql
from app.core.config import settings


async def add_missing_columns():
    """添加缺失的列"""
    try:
        connection = await aiomysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            db=settings.MYSQL_DATABASE,
            autocommit=True
        )
        
        async with connection.cursor() as cursor:
            # 检查并添加 current_step_id
            await cursor.execute("""
                SELECT COUNT(*) FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = 'pipeline_executions' AND column_name = 'current_step_id'
            """, (settings.MYSQL_DATABASE,))
            result = await cursor.fetchone()
            if result[0] == 0:
                await cursor.execute("""
                    ALTER TABLE pipeline_executions 
                    ADD COLUMN current_step_id VARCHAR(50) NULL AFTER execution_time_ms
                """)
                print("[OK] Added current_step_id column")
            else:
                print("[SKIP] current_step_id column already exists")
            
            # 检查并添加 current_step_rows
            await cursor.execute("""
                SELECT COUNT(*) FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = 'pipeline_executions' AND column_name = 'current_step_rows'
            """, (settings.MYSQL_DATABASE,))
            result = await cursor.fetchone()
            if result[0] == 0:
                await cursor.execute("""
                    ALTER TABLE pipeline_executions 
                    ADD COLUMN current_step_rows INT DEFAULT 0 AFTER current_step_id
                """)
                print("[OK] Added current_step_rows column")
            else:
                print("[SKIP] current_step_rows column already exists")
            
            # 检查并添加 current_step_total_rows
            await cursor.execute("""
                SELECT COUNT(*) FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = 'pipeline_executions' AND column_name = 'current_step_total_rows'
            """, (settings.MYSQL_DATABASE,))
            result = await cursor.fetchone()
            if result[0] == 0:
                await cursor.execute("""
                    ALTER TABLE pipeline_executions 
                    ADD COLUMN current_step_total_rows INT NULL AFTER current_step_rows
                """)
                print("[OK] Added current_step_total_rows column")
            else:
                print("[SKIP] current_step_total_rows column already exists")
            
            # 检查并添加 step_progress
            await cursor.execute("""
                SELECT COUNT(*) FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = 'pipeline_executions' AND column_name = 'step_progress'
            """, (settings.MYSQL_DATABASE,))
            result = await cursor.fetchone()
            if result[0] == 0:
                await cursor.execute("""
                    ALTER TABLE pipeline_executions 
                    ADD COLUMN step_progress JSON NULL AFTER current_step_total_rows
                """)
                print("[OK] Added step_progress column")
            else:
                print("[SKIP] step_progress column already exists")
            
        connection.close()
        print("\nMigration completed!")
        
    except Exception as e:
        print(f"Migration failed: {e}")
        raise


async def main():
    print(f"Starting migration for MySQL database ({settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE})...")
    await add_missing_columns()


if __name__ == "__main__":
    asyncio.run(main())

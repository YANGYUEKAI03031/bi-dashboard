# launch_server.py - Updated for C:\redis installation with database initialization
import os
import sys
import subprocess
import time
import asyncio
from pathlib import Path

# 添加项目路径到Python路径
project_path = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_path)

# 设置环境变量
os.environ['PYTHONPATH'] = project_path

# Redis安装路径
REDIS_PATH = r"E:\bi-dashboard\backend\redis"
REDIS_SERVER = os.path.join(REDIS_PATH, "redis-server.exe")
REDIS_CLI = os.path.join(REDIS_PATH, "redis-cli.exe")

def check_redis_installed():
    """检查Redis是否已安装"""
    return os.path.exists(REDIS_SERVER)

def is_redis_running():
    """检查Redis是否正在运行"""
    try:
        import redis
        r = redis.Redis(host='localhost', port=6379, decode_responses=True)
        r.ping()
        return True
    except:
        return False

def start_redis():
    """启动Redis服务"""
    if not check_redis_installed():
        print("⚠️  Redis未找到，请确认Redis已安装在:", REDIS_PATH)
        return False
    
    if is_redis_running():
        print("✅ Redis已在运行")
        return True
    
    # 尝试启动Redis
    try:
        print("🔄 正在启动Redis服务...")
        print(f"   Redis路径: {REDIS_SERVER}")
        
        # Windows环境下启动Redis
        if os.name == 'nt':  # Windows
            try:
                # 启动Redis服务器
                redis_process = subprocess.Popen(
                    [REDIS_SERVER],
                    cwd=REDIS_PATH,  # 在Redis目录中运行
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                
                # 等待Redis启动
                time.sleep(3)
                
                # 验证是否启动成功
                if is_redis_running():
                    print("✅ Redis启动成功")
                    return True
                else:
                    print("❌ Redis启动失败 - 无法连接到服务器")
                    return False
                    
            except Exception as e:
                print(f"❌ Redis启动失败: {e}")
                return False
        else:  # Linux/Mac
            try:
                subprocess.run(['redis-server', '--daemonize', 'yes'], check=True)
                time.sleep(2)
                print("✅ Redis启动成功")
                return True
            except subprocess.CalledProcessError:
                print("❌ Redis启动失败")
                return False
                
    except ImportError:
        print("⚠️  未安装redis-python包，请运行: pip install redis")
        return False
    except Exception as e:
        print(f"❌ Redis启动异常: {e}")
        return False

async def init_database_tables():
    """初始化增强的数据处理表"""
    try:
        from sqlalchemy import text
        from app.db.session import engine
        import logging
        
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(__name__)
        
        async with engine.begin() as conn:
            logger.info("Creating enhanced data processing tables...")
            
            # 创建工作流执行记录表
            await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workflow_executions (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                workflow_id VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
                config JSON NOT NULL,
                result JSON,
                error TEXT,
                started_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_workflow_executions_status (status),
                INDEX idx_workflow_executions_created (created_at)
            )
            """))
            
            # 创建批处理任务记录表
            await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS batch_tasks (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(100) NOT NULL,
                priority INTEGER DEFAULT 2,
                status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
                config JSON NOT NULL,
                result JSON,
                error TEXT,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 3,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                INDEX idx_batch_tasks_status (status),
                INDEX idx_batch_tasks_type (type),
                INDEX idx_batch_tasks_priority (priority)
            )
            """))
            
            # 创建缓存配置表
            await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cache_configs (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                cache_key VARCHAR(255) NOT NULL UNIQUE,
                strategy VARCHAR(50) NOT NULL,  -- ttl, duration, schedule
                config JSON NOT NULL,
                refresh_automatically BOOLEAN DEFAULT FALSE,
                invalidated_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_cache_configs_strategy (strategy),
                INDEX idx_cache_configs_invalidated (invalidated_at)
            )
            """))
            
            # 创建处理后的数据集表（ProcessedDataset对应的表）
            await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS processed_datasets (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                data_source_id INTEGER NOT NULL,
                processing_steps JSON,
                result_schema JSON,
                row_count INTEGER DEFAULT 0,
                storage_path VARCHAR(500),
                is_cached BOOLEAN DEFAULT FALSE,
                cache_expires_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_processed_datasets_name (name),
                INDEX idx_processed_datasets_data_source (data_source_id)
            )
            """))
            
            logger.info("Enhanced tables created successfully!")
            return True
            
    except Exception as e:
        print(f"❌ 数据库初始化失败: {e}")
        return False

def main():
    """主启动函数"""
    import sys
    import uvicorn

    # 修复 Windows 上 aiomysql + asyncio 的兼容问题：
    # Python 3.8+ 在 Windows 默认使用 ProactorEventLoop，aiomysql 需要 SelectorEventLoop
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    print("🚀 启动BI仪表板后端服务...")
    print(f"🔍 Redis安装路径: {REDIS_PATH}")

    # 注意：数据库表初始化已移至 FastAPI lifespan（main_optimized.py），
    # 这样确保所有 DB 操作都在 uvicorn 的事件循环内运行，避免事件循环冲突。
    
    # 尝试启动Redis
    redis_started = start_redis()
    if not redis_started:
        print("⚠️  Redis启动失败，应用将以降级模式运行")
        print("💡 提示: 缓存和部分实时功能可能受限")
    
    print("📍 访问地址: http://localhost:8000")
    print("📊 API文档: http://localhost:8000/docs")
    
    uvicorn.run(
        "app.main_optimized:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

# 启动服务器
if __name__ == "__main__":
    main()
# launch_server.py - Updated for C:\redis installation
import os
import sys
import subprocess
import time
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

# 启动服务器
if __name__ == "__main__":
    import uvicorn
    from app.main_optimized import app
    
    print("🚀 启动BI仪表板后端服务...")
    print(f"🔍 Redis安装路径: {REDIS_PATH}")
    
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
#!/bin/bash
# ============================================
#  BI Dashboard - Linux/macOS 启动脚本
#  本地开发模式
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  BI Dashboard 启动脚本"
echo "============================================"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未找到 Python3，请先安装 Python 3.11+"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装"
    exit 1
fi

echo "[1/3] 检查后端依赖..."
cd "$PROJECT_DIR/backend"
if [ ! -d "venv" ]; then
    echo "      创建虚拟环境..."
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt --quiet

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "[警告] .env 文件不存在，正在复制模板..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[警告] 请编辑 .env 文件配置数据库连接"
    fi
fi

echo ""
echo "[2/3] 检查前端依赖..."
cd "$PROJECT_DIR/frontend/bi-dashboard"
if [ ! -d "node_modules" ]; then
    echo "      安装前端依赖..."
    npm install
fi

echo ""
echo "[3/3] 启动服务..."
echo "============================================"
echo "  服务即将启动："
echo "  - 后端: http://127.0.0.1:8000"
echo "  - 前端: http://localhost:3000"
echo "  - API:  http://127.0.0.1:8000/api/v1"
echo "============================================"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 启动后端
cd "$PROJECT_DIR/backend"
source venv/bin/activate
nohup python -m uvicorn app.main_optimized:app --host 127.0.0.1 --port 8000 --reload > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "后端已启动 (PID: $BACKEND_PID)"

# 等待后端启动
sleep 3

# 启动前端
cd "$PROJECT_DIR/frontend/bi-dashboard"
nohup npm start > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "前端已启动 (PID: $FRONTEND_PID)"

echo ""
echo "服务已启动！"
echo "按任意键退出（服务将继续在后台运行）..."
read -n 1 -s

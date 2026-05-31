#!/bin/bash
# ============================================
#  BI Dashboard - Linux/macOS 生产部署脚本
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  BI Dashboard 生产部署脚本"
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

echo ""
echo "============================================"
echo "  生产部署配置检查"
echo "============================================"
echo ""

# 检查后端配置
cd "$PROJECT_DIR/backend"
if [ ! -f ".env" ]; then
    echo "[错误] .env 文件不存在！"
    echo "请复制 .env.example 为 .env 并配置"
    exit 1
fi

# 检查生产模式
if ! grep -q "ENVIRONMENT=production" .env; then
    echo "[警告] .env 中未设置 ENVIRONMENT=production"
    echo "建议在生产部署前修改 .env 中的 ENVIRONMENT=production"
    echo ""
fi

# 检查前端构建
cd "$PROJECT_DIR/frontend/bi-dashboard"
if [ ! -d "build" ]; then
    echo "[提示] 前端未构建，正在构建..."
    if [ ! -f ".env.production" ]; then
        echo "[警告] 缺少 .env.production，将使用 .env 中的配置"
    fi
    npm run build
fi

echo ""
echo "[1/3] 安装后端依赖..."
cd "$PROJECT_DIR/backend"
if [ ! -d "venv" ]; then
    echo "      创建虚拟环境..."
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt --quiet

echo ""
echo "[2/3] 检查 nginx..."
if ! command -v nginx &> /dev/null; then
    echo "[警告] 未找到 nginx，请确保已安装 nginx"
    echo "可从 https://nginx.org/en/download.html 下载"
    echo ""
    echo "跳过 nginx，直接启动后端..."
    SKIP_NGINX=true
else
    echo "      启动 nginx..."
    cd "$SCRIPT_DIR"
    nginx -c "$SCRIPT_DIR/nginx.conf"
fi

echo ""
echo "[3/3] 启动后端服务..."
cd "$PROJECT_DIR/backend"
source venv/bin/activate

# 生产模式不启用 reload，使用多 worker
nohup python -m uvicorn app.main_optimized:app --host 0.0.0.0 --port 8000 --workers 4 > backend.log 2>&1 &
BACKEND_PID=$!
echo "后端已启动 (PID: $BACKEND_PID)"

echo ""
echo "============================================"
echo "  服务已启动！"
echo "============================================"
if [ "$SKIP_NGINX" = true ]; then
    echo "  - 后端: http://localhost:8000"
    echo "  - API:  http://localhost:8000/api/v1"
else
    echo "  - 前端: http://localhost"
    echo "  - 后端: http://localhost:8000"
    echo "  - API:  http://localhost/api/v1"
fi
echo "  - 健康检查: http://localhost/health"
echo "============================================"
echo ""

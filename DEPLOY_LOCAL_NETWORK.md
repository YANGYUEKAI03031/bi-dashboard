# BI Dashboard 本地网络部署指南

## 项目概述

- **前端**: React + Ant Design + ECharts (Create React App)
- **后端**: FastAPI + SQLAlchemy + MySQL + Redis
- **默认端口**: 前端 3000, 后端 8000

---

## 一、准备工作

### 1.1 确保依赖已安装

**后端 (Python 虚拟环境):**
```bash
cd e:\bi-dashboard\backend
venv\Scripts\activate
pip install -r requirements.txt
```

**前端:**
```bash
cd e:\bi-dashboard\frontend\bi-dashboard
npm install
```

### 1.2 配置环境变量

**后端 `.env` (如不存在需创建):**
```env
DATABASE_URL=mysql+aiomysql://用户名:密码@localhost:3306/bi_dashboard
REDIS_HOST=localhost
REDIS_PORT=6379
SECRET_KEY=your-secret-key-here
DEBUG=false
```

**前端 `.env` (修改现有文件):**
```env
REACT_APP_API_URL=http://你的电脑IP:8000/api/v1
REACT_APP_WS_URL=ws://你的电脑IP:8000
```

> **重要**: 将 `你的电脑IP` 替换为实际局域网 IP (如 `192.168.1.100`)

---

## 二、后端部署

### 2.1 启动后端服务

```bash
cd e:\bi-dashboard\backend
venv\Scripts\activate
python launch_server.py
```

后端已配置 `host="0.0.0.0"`，会自动监听所有网络接口。

**验证后端运行:**
- 本机访问: http://localhost:8000/docs
- 局域网访问: http://192.168.x.x:8000/docs

---

## 三、前端部署 (方式一: 开发模式)

如果只是临时使用局域网访问:

```bash
cd e:\bi-dashboard\frontend\bi-dashboard

# Windows
set HOST=0.0.0.0
set PORT=3000
set WATCHPACK_POLLING=true
npm start

# PowerShell
$env:HOST="0.0.0.0"
$env:PORT="3000"
npm start
```

然后局域网用户可通过 `http://你的IP:3000` 访问。

---

## 四、前端部署 (方式二: 生产构建 - 推荐)

### 4.1 构建生产版本

```bash
cd e:\bi-dashboard\frontend\bi-dashboard
npm run build
```

这会在 `build` 文件夹生成静态文件。

### 4.2 使用 serve 静态服务器

```bash
# 全局安装 serve
npm install -g serve

# 启动静态服务器 (监听所有接口)
serve -s build -l 3000 -n
```

### 4.3 使用 Nginx (生产环境推荐)

下载 Nginx for Windows: https://nginx.org/en/download.html

**配置 `nginx.conf`:**

```nginx
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    # 前端静态文件服务
    server {
        listen 80;
        server_name localhost;

        # 前端文件目录
        root e:/bi-dashboard/frontend/bi-dashboard/build;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        # API 反向代理到后端
        location /api/ {
            proxy_pass http://127.0.0.1:8000/api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_cache_bypass $http_upgrade;
        }

        # WebSocket 支持
        location /ws/ {
            proxy_pass http://127.0.0.1:8000/ws/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }
    }
}
```

**启动 Nginx:**
```bash
# 解压 nginx 到 e:\nginx
# 配置文件放在 e:\nginx\conf\nginx.conf

# 启动
e:\nginx\nginx.exe

# 重新加载配置
e:\nginx\nginx.exe -s reload

# 停止
e:\nginx\nginx.exe -s stop
```

---

## 五、查找电脑局域网 IP

### Windows:

```powershell
# 方法1
ipconfig

# 方法2 - 找 IPv4 地址
ipconfig | findstr "IPv4"
```

通常显示为 `192.168.x.x` 或 `10.0.x.x`

---

## 六、一键启动脚本

创建 `deploy_local.bat`:

```batch
@echo off
title BI Dashboard 部署

echo ========================================
echo   BI Dashboard 本地网络部署
echo ========================================

REM 启动后端 (新窗口)
echo [1/3] 启动后端服务...
start "BI-Backend" cmd /k "cd /d e:\bi-dashboard\backend && venv\Scripts\activate && python launch_server.py"

REM 等待后端启动
timeout /t 5

REM 启动前端
echo [2/3] 启动前端服务...
start "BI-Frontend" cmd /k "cd /d e:\bi-dashboard\frontend\bi-dashboard && npm start"

echo [3/3] 获取本机IP...
ipconfig | findstr "IPv4"

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo 后端 API: http://localhost:8000/docs
echo 前端地址: http://localhost:3000
echo.
echo 局域网访问 (替换 YOUR_IP):
echo   http://YOUR_IP:3000
echo ========================================
pause
```

---

## 七、访问地址汇总

| 服务 | 本机访问 | 局域网访问 |
|------|----------|------------|
| 前端 | http://localhost:3000 | http://192.168.x.x:3000 |
| 后端 API | http://localhost:8000 | http://192.168.x.x:8000 |
| API 文档 | http://localhost:8000/docs | http://192.168.x.x:8000/docs |
| 健康检查 | http://localhost:8000/health | http://192.168.x.x:8000/health |

---

## 八、注意事项

1. **防火墙设置**: 确保 Windows 防火墙允许 3000 和 8000 端口的入站连接
2. **MySQL 权限**: 确保 MySQL 允许远程连接
3. **CORS 配置**: 后端 `BACKEND_CORS_ORIGINS` 需要包含前端地址
4. **网络**: 所有客户端电脑需在同一局域网内

---

## 九、常见问题

### Q: 局域网无法访问?
```powershell
# 检查防火墙规则
netsh advfirewall firewall show rule name=all | findstr "3000\|8000"

# 添加防火墙规则 (管理员权限)
netsh advfirewall firewall add rule name="BI Dashboard Frontend" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="BI Dashboard Backend" dir=in action=allow protocol=TCP localport=8000
```

### Q: API 请求失败?
检查浏览器控制台网络请求，确认 `.env` 中 `REACT_APP_API_URL` 配置正确。

### Q: WebSocket 连接失败?
确保 Nginx/代理配置了 WebSocket 支持。

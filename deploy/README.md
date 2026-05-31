# BI Dashboard 部署指南

## 目录结构

```
deploy/
├── README.md              # 本文件
├── nginx.conf             # Nginx 配置文件
├── start-dev.bat         # Windows 本地开发启动脚本
├── start-dev.sh          # Linux/macOS 本地开发启动脚本
├── start-prod.bat         # Windows 生产部署启动脚本
└── start-prod.sh         # Linux/macOS 生产部署脚本
```

## 快速开始

### 本地开发

**Windows:**
```bash
cd deploy
start-dev.bat
```

**Linux/macOS:**
```bash
cd deploy
chmod +x start-dev.sh
./start-dev.sh
```

### 生产部署

1. **配置环境变量**
   ```bash
   cd ../backend
   cp .env.example .env
   # 编辑 .env，设置生产环境的数据库、密钥等
   ```

2. **配置前端 API 地址**
   ```bash
   cd ../frontend/bi-dashboard
   # 编辑 .env.production 或直接修改 .env 中的 REACT_APP_API_BASE_URL
   ```

3. **运行部署脚本**

   **Windows:**
   ```bash
   cd deploy
   start-prod.bat
   ```

   **Linux/macOS:**
   ```bash
   cd deploy
   chmod +x start-prod.sh
   ./start-prod.sh
   ```

## 生产部署检查清单

### 1. 环境变量配置

修改 `backend/.env`:

```env
# 数据库配置
MYSQL_HOST=your-mysql-host
MYSQL_PORT=3306
MYSQL_USER=your-app-user        # 不要用 root！
MYSQL_PASSWORD=your-strong-password
MYSQL_DATABASE=bi_dashboard

# 安全密钥（必须重新生成！）
SECRET_KEY=<生成一个强密钥>
ENCRYPTION_KEY=<生成一个 Fernet 密钥>

# CORS 配置（必须修改为你的域名）
BACKEND_CORS_ORIGINS=["https://your-domain.com"]

# 生产模式
DEBUG=False
ENVIRONMENT=production
```

**生成密钥:**
```bash
# SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(32))"

# ENCRYPTION_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. 前端配置

修改 `frontend/bi-dashboard/.env`:

```env
REACT_APP_API_BASE_URL=https://your-backend-domain.com/api/v1
```

或创建 `.env.production`:

```env
REACT_APP_API_BASE_URL=https://your-backend-domain.com/api/v1
```

### 3. Nginx 配置

修改 `nginx.conf` 中的域名和 SSL 证书路径:

```nginx
# HTTPS server 块中配置你的域名
server_name your-domain.com;

# SSL 证书路径
ssl_certificate /etc/nginx/ssl/cert.pem;
ssl_certificate_key /etc/nginx/ssl/key.pem;
```

### 4. 数据库

- 创建专用数据库用户（不要用 root）
- 设置强密码
- 确保数据库网络可访问

### 5. Redis（可选）

如果使用 Redis，添加密码:

```env
REDIS_PASSWORD=your-redis-password
```

## Nginx + HTTPS 配置

生产环境建议使用 HTTPS。配置步骤:

1. 安装 nginx
2. 获取 SSL 证书（Let's Encrypt 免费证书推荐）
3. 修改 `nginx.conf` 取消 HTTPS 相关配置的注释
4. 重启 nginx

## 端口说明

| 端口 | 服务 | 说明 |
|------|------|------|
| 80   | Nginx | HTTP 入口 |
| 443  | Nginx | HTTPS 入口 |
| 3000 | React | 前端开发服务器 |
| 8000 | FastAPI | 后端 API |

## 常见问题

### 1. CORS 错误
确保 `backend/.env` 中的 `BACKEND_CORS_ORIGINS` 包含前端访问的域名。

### 2. 数据库连接失败
检查 `backend/.env` 中的 MySQL 配置是否正确。

### 3. 前端 API 请求失败
检查 `frontend/bi-dashboard/.env` 中的 `REACT_APP_API_BASE_URL` 是否正确。

### 4. nginx 启动失败
检查 nginx 配置文件语法:
```bash
nginx -t -c /path/to/nginx.conf
```

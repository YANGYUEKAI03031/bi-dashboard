@echo off
chcp 65001 >nul
REM ============================================
REM  BI Dashboard - Windows 生产部署启动脚本
REM  使用 nginx 反向代理
REM ============================================

echo ============================================
echo   BI Dashboard 生产部署脚本
echo ============================================
echo.

REM 检查 Python
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    pause
    exit /b 1
)

REM 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装
    pause
    exit /b 1
)

echo.
echo ============================================
echo   生产部署配置检查
echo ============================================
echo.

REM 检查后端配置
cd /d "%~dp0..\backend"
if not exist ".env" (
    echo [错误] .env 文件不存在！
    echo 请复制 .env.example 为 .env 并配置
    pause
    exit /b 1
)

REM 检查生产配置
findstr /C:"ENVIRONMENT=production" .env >nul
if %ERRORLEVEL% neq 0 (
    echo [警告] .env 中未设置 ENVIRONMENT=production
    echo 建议在生产部署前修改 .env 中的 ENVIRONMENT=production
    echo.
)

REM 检查前端构建
cd /d "%~dp0..\frontend\bi-dashboard"
if not exist "build" (
    echo [提示] 前端未构建，正在构建...
    if not exist ".env.production" (
        echo [警告] 缺少 .env.production，将使用 .env 中的配置
    )
    call npm run build
)

echo.
echo [1/3] 检查后端依赖...
cd /d "%~dp0..\backend"
if not exist "venv" (
    echo       创建虚拟环境...
    python -m venv venv
)
call venv\Scripts\activate
pip install -r requirements.txt

echo.
echo [2/3] 检查 nginx...
where nginx >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [警告] 未找到 nginx，请确保已安装 nginx
    echo 可从 https://nginx.org/en/download.html 下载
    echo.
    echo 跳过 nginx，直接启动后端和前端...
    echo.
    goto skip_nginx
)

echo       启动 nginx...
cd /d "%~dp0"
start "BI-Nginx" cmd /c "nginx -c %~dp0nginx.conf -g ""daemon off;"""

:skip_nginx
echo.
echo [3/3] 启动后端服务...
cd /d "%~dp0..\backend"
call venv\Scripts\activate

REM 生产模式不启用 reload
start "BI-Backend-Prod" cmd /c "python -m uvicorn app.main_optimized:app --host 0.0.0.0 --port 8000 --workers 4"

echo.
echo ============================================
echo   服务已启动！
echo ============================================
echo   - 前端: http://localhost
echo   - 后端: http://localhost:8000
echo   - API:  http://localhost/api/v1
echo   - 健康检查: http://localhost/health
echo ============================================
echo.
echo 按任意键退出此窗口（服务将继续运行）
pause >nul

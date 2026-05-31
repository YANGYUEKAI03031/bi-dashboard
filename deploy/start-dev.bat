@echo off
chcp 65001 >nul
REM ============================================
REM  BI Dashboard - Windows 启动脚本
REM  本地开发模式
REM ============================================

echo ============================================
echo   BI Dashboard 启动脚本
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

echo [1/3] 检查后端依赖...
cd /d "%~dp0..\backend"
if not exist "venv" (
    echo       创建虚拟环境...
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)

REM 检查 .env 文件
if not exist ".env" (
    echo [警告] .env 文件不存在，正在复制模板...
    if exist ".env.example" (
        copy .env.example .env
        echo [警告] 请编辑 .env 文件配置数据库连接
    )
)

echo.
echo [2/3] 检查前端依赖...
cd /d "%~dp0..\frontend\bi-dashboard"
if not exist "node_modules" (
    echo       安装前端依赖...
    npm install
)

echo.
echo [3/3] 启动服务...
echo ============================================
echo   服务即将启动：
echo   - 后端: http://127.0.0.1:8000
echo   - 前端: http://localhost:3000
echo   - API:  http://127.0.0.1:8000/api/v1
echo ============================================
echo.
echo 按 Ctrl+C 停止服务
echo.

REM 启动后端
cd /d "%~dp0..\backend"
call venv\Scripts\activate
start "BI-Backend" cmd /c "python -m uvicorn app.main_optimized:app --host 127.0.0.1 --port 8000 --reload"

REM 等待后端启动
timeout /t 3 /nobreak >nul

REM 启动前端
cd /d "%~dp0..\frontend\bi-dashboard"
start "BI-Frontend" cmd /c "npm start"

echo.
echo 服务已启动！
pause

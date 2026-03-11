# app/api/v1/auth.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import LoginRequest, ChangePasswordRequest
import logging
from app.core.security import create_access_token, get_current_user_id

router = APIRouter()

logger = logging.getLogger(__name__)

def _is_user_enabled(state) -> bool:
    """
    兼容 MySQL/驱动返回的 state 类型：
    - 期望：1=启用，0=禁用
    - 兼容：'1'/'0'、None 等
    """
    if state is None:
        return False
    try:
        return int(state) == 1
    except Exception:
        return str(state).strip() == "1"

@router.post("/login")
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    username = request.username
    password = request.password

    logger.info(f"Received login request: username={username}, password={password}")

    # 查询用户
    result = await db.execute(select(User).where(User.accountname == username))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning("User not found")
        raise HTTPException(status_code=400, detail="用户名或密码错误")

    logger.info(f"Found user: {user.accountname}, stored password: {user.password}")

    # state：1=启用，其他=禁用（兼容字符串/整数）
    if not _is_user_enabled(user.state):
        logger.warning("User account is disabled")
        raise HTTPException(status_code=403, detail="账户已被禁用，无法登录")

    if user.password != password:
        logger.warning("Password mismatch")
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    
    # 修正：使用用户ID而不是用户名创建token
    access_token = create_access_token(data={"sub": str(user.userID)})
    
    return {
        "success": True,
        "token": access_token,
        "message": "登录成功",
        "user": {
            "id": user.userID,
            "username": user.accountname,
            "full_name": user.accountname
        }
    }

# 添加获取当前用户信息的端点
@router.get("/me")
async def get_current_user(current_user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """获取当前认证用户的信息"""
    try:
        result = await db.execute(select(User).where(User.userID == current_user_id))
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 账户已禁用则拒绝，前端会收到 403 并清除登录状态
        if not _is_user_enabled(user.state):
            raise HTTPException(status_code=403, detail="账户已被禁用")

        return {
            "id": user.userID,
            "username": user.accountname,
            "full_name": user.accountname,
            "email": None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail="获取用户信息失败")


@router.put("/me/password")
async def change_password(
    body: ChangePasswordRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """修改当前登录用户密码（仅登录后可用）"""
    if not body.old_password or not body.new_password:
        raise HTTPException(status_code=400, detail="原密码和新密码不能为空")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码长度至少 6 位")
    result = await db.execute(select(User).where(User.userID == current_user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not _is_user_enabled(user.state):
        raise HTTPException(status_code=403, detail="账户已被禁用")
    if user.password != body.old_password:
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password = body.new_password
    await db.commit()
    return {"message": "密码已修改"}
# app/api/v1/auth.py
import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import assign_password, check_password, create_access_token, get_current_user_id
from app.db.session import get_db
from app.exceptions import (
    AuthenticationException,
    DatabaseException,
    PermissionDeniedException,
    ResourceNotFoundException,
    ValidationException,
)
from app.models.user import User
from app.schemas.user import ChangePasswordRequest, LoginRequest
from app.services.permission_service import PermissionService

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

    logger.info("Received login request for username=%s", username)

    # 查询用户
    result = await db.execute(select(User).where(User.accountname == username))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning("Login failed: user not found (username=%s)", username)
        raise ValidationException("username", "用户名或密码错误")

    logger.info("User found for login: username=%s, user_id=%s", user.accountname, user.userID)

    # state：1=启用，其他=禁用（兼容字符串/整数）
    if not _is_user_enabled(user.state):
        logger.warning("User account is disabled")
        raise PermissionDeniedException("登录（账户已禁用）")

    if not check_password(password, user):
        logger.warning("Login failed: password mismatch (username=%s)", username)
        raise ValidationException("password", "用户名或密码错误")

    # 修正：使用用户ID而不是用户名创建token
    access_token = create_access_token(data={"sub": str(user.userID)})

    # 获取用户角色
    permission_service = PermissionService(db)
    user_role = await permission_service.get_user_role(user.userID)
    is_admin = await permission_service.is_admin(user.userID)

    return {
        "success": True,
        "token": access_token,
        "message": "登录成功",
        "user": {
            "id": user.userID,
            "username": user.accountname,
            "full_name": user.accountname,
            "role": user_role,
            "is_admin": is_admin,
        },
    }


# 添加获取当前用户信息的端点
@router.get("/me")
async def get_current_user(current_user_id: int = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """获取当前认证用户的信息"""
    try:
        result = await db.execute(select(User).where(User.userID == current_user_id))
        user = result.scalar_one_or_none()

        if not user:
            raise ResourceNotFoundException("用户", current_user_id)

        # 账户已禁用则拒绝，前端会收到 403 并清除登录状态
        if not _is_user_enabled(user.state):
            raise PermissionDeniedException("访问（账户已禁用）")

        return {"id": user.userID, "username": user.accountname, "full_name": user.accountname, "email": None}
    except Exception as e:
        logger.error(f"获取用户信息失败: {str(e)}")
        raise DatabaseException("获取用户信息失败", original_error=e)


@router.put("/me/password")
async def change_password(
    body: ChangePasswordRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """修改当前登录用户密码（仅登录后可用）"""
    if not body.old_password or not body.new_password:
        raise ValidationException("password", "原密码和新密码不能为空")
    if len(body.new_password) < 6:
        raise ValidationException("new_password", "新密码长度至少 6 位")
    result = await db.execute(select(User).where(User.userID == current_user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ResourceNotFoundException("用户", current_user_id)
    if not _is_user_enabled(user.state):
        raise PermissionDeniedException("修改密码（账户已禁用）")
    if not check_password(body.old_password, user):
        raise ValidationException("old_password", "原密码错误")
    assign_password(user, body.new_password)
    await db.commit()
    return {"message": "密码已修改"}


@router.post("/logout")
async def logout(current_user_id: int = Depends(get_current_user_id)):
    """登出（JWT 无状态，客户端清除 token 即可）"""
    logger.info("User logged out: user_id=%s", current_user_id)
    return {"success": True, "message": "已登出"}

# app/api/v1/auth.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.future import select
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import LoginRequest
import logging
from app.core.security import create_access_token, get_current_user_id

router = APIRouter()

logger = logging.getLogger(__name__)

@router.post("/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    username = request.username
    password = request.password

    logger.info(f"Received login request: username={username}, password={password}")

    # 查询用户
    result = await db.execute(select(User).filter(User.accountname == username))
    user = result.scalars().first()

    if not user:
        logger.warning("User not found")
        raise HTTPException(status_code=400, detail="用户名或密码错误")

    logger.info(f"Found user: {user.accountname}, stored password: {user.password}")

    if user.state != '1':
        logger.warning("User account is disabled")
        raise HTTPException(status_code=400, detail="账户已被禁用")

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
async def get_current_user(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    """获取当前认证用户的信息"""
    try:
        result = await db.execute(select(User).filter(User.userID == current_user_id))
        user = result.scalars().first()
        
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        return {
            "id": user.userID,
            "username": user.accountname,
            "full_name": user.accountname,
            "email": None
        }
    except Exception as e:
        logger.error(f"获取用户信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail="获取用户信息失败")
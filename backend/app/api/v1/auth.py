# app/api/v1/auth.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.future import select
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import LoginRequest  # 导入模型
import logging
from app.core.security import create_access_token  # 添加导入

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
    # 在验证成功后添加：
    access_token = create_access_token(data={"sub": user.accountname})
    
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

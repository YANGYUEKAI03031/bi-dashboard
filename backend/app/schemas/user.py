# app/schemas/user.py
from pydantic import BaseModel
from typing import Optional, Literal

class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    accountname: str
    password: str
    state: Optional[int] = 1  # 1=启用, 0=禁用
    role: Optional[Literal["admin", "user"]] = "user"


class CreateUserResponse(BaseModel):
    user_id: int
    accountname: str
    state: int
    role: str
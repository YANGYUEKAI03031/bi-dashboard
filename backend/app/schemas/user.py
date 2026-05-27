# app/schemas/user.py
from typing import Literal

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    accountname: str
    password: str
    state: int | None = 1  # 1=启用, 0=禁用
    role: Literal["admin", "user"] | None = "user"


class CreateUserResponse(BaseModel):
    user_id: int
    accountname: str
    state: int
    role: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

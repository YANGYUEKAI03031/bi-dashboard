# app/schemas/user.py
from pydantic import BaseModel

class LoginRequest(BaseModel):
    username: str
    password: str
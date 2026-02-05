# app/models/user.py
from sqlalchemy import Column, Integer, String
from app.db.base import Base

class User(Base):
    __tablename__ = "useraccount"  # 注意：表名应为 useraccount

    userID = Column(Integer, primary_key=True, index=True)
    accountname = Column(String, unique=True, index=True)  # 对应 username
    password = Column(String)  # 对应 password
    state = Column(Integer)  # 对应 is_active 或 status

    def __repr__(self):
        return f"<User(userID={self.userID}, accountname={self.accountname})>"
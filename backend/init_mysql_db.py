# init_mysql_db.py
"""MySQL数据库初始化脚本"""
import asyncio
import aiomysql
from app.core.config import settings  # <-- Add this import
from sqlalchemy.future import select  # <-- Add this import


async def create_database():
    """创建数据库"""
    try:
        # 连接到MySQL服务器（不指定数据库）
        connection = await aiomysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            autocommit=True
        )
        
        async with connection.cursor() as cursor:
            # 创建数据库
            await cursor.execute(f"CREATE DATABASE IF NOT EXISTS {settings.MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            print(f"数据库 '{settings.MYSQL_DATABASE}' 创建成功或已存在")
            
        connection.close()
        
    except Exception as e:
        print(f"创建数据库时出错: {e}")
        raise

async def init_tables():
    """初始化表结构"""
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.db.base import Base
    from app.models.user import User
    from app.models.dashboard import Dashboard, DashboardCard, DashboardTab, DashboardFilter, DashboardFilterBinding
    from app.models.visualization import VisualizationCard, Database
    from app.models.report_page import ReportPage, ReportPageDashboard
    from app.models.permission import UserRole, ReportPagePermission, ModificationLog
    from app.models.pipeline import DataPipeline, PipelineExecution, PipelineTrigger
    
    # 构建不包含数据库名的URL用于创建引擎
    db_url = f"mysql+aiomysql://{settings.MYSQL_USER}:{settings.MYSQL_PASSWORD}@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE}"
    
    engine = create_async_engine(db_url, echo=True)
    
    async with engine.begin() as conn:
        # 创建所有表
        await conn.run_sync(Base.metadata.create_all)
        print("所有表创建完成")

async def create_default_users():
    """创建默认用户并设置管理员角色"""
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.models.user import User
    from app.models.permission import UserRole, RoleEnum
    from app.core.security import get_password_hash

    db_url = f"mysql+aiomysql://{settings.MYSQL_USER}:{settings.MYSQL_PASSWORD}@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE}"
    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        from sqlalchemy.future import select
        result = await session.execute(select(User))
        existing_users = result.scalars().all()

        if not existing_users:
            admin_user = User(
                userID=1,
                accountname="admin",
                password="123456",  # 当前项目登录逻辑为明文比对（auth.py）
                state=1
            )
            session.add(admin_user)
            await session.flush()

            # 为 admin 用户设置管理员角色
            admin_role = UserRole(user_id=1, role=RoleEnum.ADMIN.value)
            session.add(admin_role)

            await session.commit()
            print("默认用户创建成功并设置为管理员")
        else:
            # 确保 userID=1 为启用状态且为管理员
            result = await session.execute(select(User).where(User.userID == 1))
            user_one = result.scalar_one_or_none()
            if user_one and user_one.state != 1:
                user_one.state = 1
                await session.commit()
                print("已启用 userID=1 账号")

            result = await session.execute(select(UserRole).where(UserRole.user_id == 1))
            existing_role = result.scalar_one_or_none()
            if not existing_role:
                admin_role = UserRole(user_id=1, role=RoleEnum.ADMIN.value)
                session.add(admin_role)
                await session.commit()
                print("已为 userID=1 用户添加管理员角色")
            else:
                print("用户已存在，跳过创建")

async def main():
    """主初始化函数"""
    print("开始初始化MySQL数据库...")
    
    # 1. 创建数据库
    await create_database()
    
    # 2. 初始化表结构
    await init_tables()
    
    # 3. 创建默认用户
    await create_default_users()
    
    print("MySQL数据库初始化完成！")

if __name__ == "__main__":
    asyncio.run(main())
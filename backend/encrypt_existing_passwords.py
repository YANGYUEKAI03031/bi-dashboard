"""
数据源密码加密迁移脚本

用途：将 databases 表中已有的明文密码加密存储。

使用方式：
1. 确保 backend/.env 中已配置 ENCRYPTION_KEY
2. 运行：python encrypt_existing_passwords.py
3. 验证：检查 databases 表中 password 字段是否以 gAAAAA 开头

注意事项：
- 此脚本仅执行一次，迁移完成后即可删除
- 建议先备份数据库
"""
import sys
import os

# 添加 backend 到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, update

from app.core.config import settings
from app.core.crypto import encrypt_password, decrypt_password
from app.models.visualization import Database

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def migrate_passwords():
    """迁移所有数据源密码为加密格式"""
    # 构建数据库连接 URL
    db_url = (
        f"mysql+aiomysql://{settings.MYSQL_USER}:{settings.MYSQL_PASSWORD}"
        f"@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE}"
    )

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as session:
            # 查询所有数据源
            result = await session.execute(select(Database))
            databases = result.scalars().all()

            if not databases:
                logger.info("没有找到任何数据源，跳过迁移")
                return

            logger.info(f"找到 {len(databases)} 个数据源，开始迁移...")

            migrated_count = 0
            already_encrypted = 0
            failed_count = 0

            for db_record in databases:
                current_password = db_record.password

                if not current_password:
                    logger.warning(f"数据源 ID={db_record.id} 密码为空，跳过")
                    continue

                # 检查是否已经是加密格式
                if _is_encrypted(current_password):
                    logger.info(f"数据源 ID={db_record.id} ({db_record.name}) 已是加密格式，跳过")
                    already_encrypted += 1
                    continue

                # 加密密码
                try:
                    encrypted = encrypt_password(current_password)
                    db_record.password = encrypted
                    migrated_count += 1
                    logger.info(f"数据源 ID={db_record.id} ({db_record.name}) 密码加密完成")

                    # 验证加密后能解密
                    decrypted = decrypt_password(encrypted)
                    if decrypted != current_password:
                        logger.error(f"验证失败：解密后密码不匹配，ID={db_record.id}")
                        failed_count += 1
                    else:
                        logger.debug(f"验证通过：ID={db_record.id}")

                except Exception as e:
                    logger.error(f"加密失败，ID={db_record.id}: {e}")
                    failed_count += 1

            # 提交所有更改
            await session.commit()

            # 打印汇总
            logger.info("=" * 50)
            logger.info("迁移完成")
            logger.info(f"  - 已迁移: {migrated_count} 个")
            logger.info(f"  - 已是加密: {already_encrypted} 个")
            logger.info(f"  - 失败: {failed_count} 个")
            logger.info("=" * 50)

            if migrated_count > 0:
                logger.info("密码加密迁移成功！请重启后端服务使更改生效。")

    finally:
        await engine.dispose()


def _is_encrypted(password: str) -> bool:
    """检查密码是否已经是加密格式"""
    import base64

    if not password:
        return False

    try:
        decoded = base64.b64decode(password)
        # Fernet token 格式: 版本(1) + 时间戳(8) + IV(16) + HMAC(32) + 有效载荷
        # 总长度至少 18 字节
        if len(decoded) < 18:
            return False
        # 版本字节应该是 0x80 (128)
        if decoded[0] != 0x80:
            return False
        return True
    except Exception:
        return False


if __name__ == "__main__":
    # 检查 ENCRYPTION_KEY 是否配置
    if not settings.ENCRYPTION_KEY:
        logger.error("错误：ENCRYPTION_KEY 未配置")
        logger.error("请在 backend/.env 中添加 ENCRYPTION_KEY")
        logger.error("生成方法：python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
        sys.exit(1)

    logger.info("开始数据源密码加密迁移...")
    logger.info(f"数据库: {settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{settings.MYSQL_DATABASE}")
    asyncio.run(migrate_passwords())

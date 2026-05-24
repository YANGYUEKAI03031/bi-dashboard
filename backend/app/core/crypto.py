"""
加密工具模块

提供 Fernet 对称加密功能，用于保护敏感数据（如数据源密码）。

使用方式：
1. 首次运行时自动生成密钥，保存到 .env 的 ENCRYPTION_KEY
2. 已有数据可通过 migrate_encrypt_passwords.py 迁移
"""
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings

logger = logging.getLogger(__name__)

_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    """获取 Fernet 实例（延迟初始化）"""
    global _fernet
    if _fernet is None:
        key = settings.ENCRYPTION_KEY
        if not key:
            raise ValueError(
                "ENCRYPTION_KEY 未配置。请在 backend/.env 中设置 "
                "ENCRYPTION_KEY=$(python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")"
            )
        try:
            _fernet = Fernet(key.encode())
        except Exception as e:
            raise ValueError(f"ENCRYPTION_KEY 格式无效: {e}")
    return _fernet


def encrypt_password(plain_password: str) -> str:
    """
    加密密码

    Args:
        plain_password: 明文密码

    Returns:
        加密后的密码（base64 编码的 Fernet 格式）

    Raises:
        ValueError: 加密失败时
    """
    if not plain_password:
        return ""

    try:
        f = _get_fernet()
        encrypted = f.encrypt(plain_password.encode("utf-8"))
        return encrypted.decode("utf-8")
    except Exception as e:
        logger.error(f"密码加密失败: {e}")
        raise ValueError(f"密码加密失败: {e}")


def decrypt_password(encrypted_password: str) -> str:
    """
    解密密码

    Args:
        encrypted_password: 加密后的密码

    Returns:
        明文密码

    Raises:
        ValueError: 解密失败时
    """
    if not encrypted_password:
        return ""

    # 检查是否是明文密码（未加密）
    # Fernet 加密后的内容以特定模式开头，如果不符合则视为明文
    # 这样可以支持双轨：同时处理加密和未加密的数据
    if _is_plaintext(encrypted_password):
        return encrypted_password

    try:
        f = _get_fernet()
        decrypted = f.decrypt(encrypted_password.encode("utf-8"))
        return decrypted.decode("utf-8")
    except InvalidToken:
        # 尝试作为明文处理
        logger.warning("密码解密失败，尝试作为明文处理")
        return encrypted_password
    except Exception as e:
        logger.error(f"密码解密失败: {e}")
        # 出错时返回原文，避免系统无法启动
        return encrypted_password


def _is_plaintext(password: str) -> bool:
    """
    判断密码是否为明文（未加密）

    启发式判断：
    1. Fernet 加密后的字符串以 'gAAAAA' 开头（这是 Fernet 的特征）
    2. 如果不以 'gAAAAA' 开头，很可能是明文
    """
    if not password:
        return True

    # Fernet 加密后的字符串以 'gAAAAA' 开头
    if password.startswith("gAAAAA"):
        return False

    # 其他情况视为明文
    return True


def get_or_create_encryption_key() -> str:
    """
    获取或创建加密密钥

    Returns:
        Fernet 加密密钥
    """
    existing_key = settings.ENCRYPTION_KEY
    if existing_key:
        return existing_key

    # 生成新密钥
    new_key = Fernet.generate_key()
    logger.warning(
        "ENCRYPTION_KEY 已生成。请在 backend/.env 中设置:\n"
        "ENCRYPTION_KEY=%s",
        new_key.decode(),
    )
    return new_key.decode()

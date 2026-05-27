"""
自定义异常模块

提供统一的异常层次结构，便于：
1. 全局异常处理和日志记录
2. 区分业务异常和技术异常
3. 前端错误展示的标准化

异常层次结构：
    AppException (基类)
    ├── BusinessException (业务异常)
    │   ├── ResourceNotFoundException
    │   ├── ResourceExistsException
    │   ├── PermissionDeniedException
    │   └── ValidationException
    └── SystemException (系统异常)
        ├── DatabaseException
        ├── ExternalServiceException
        └── ConfigurationException
"""

from typing import Any

from fastapi import HTTPException, status


class AppException(Exception):
    """
    应用异常基类

    所有自定义异常的父类，提供通用属性和方法。
    """

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ):
        self.message = message
        self.code = code or self.__class__.__name__
        self.details = details or {}
        self.status_code = status_code or self._default_status_code()
        super().__init__(message)

    def _default_status_code(self) -> int:
        """子类可覆盖的默认状态码"""
        return status.HTTP_500_INTERNAL_SERVER_ERROR

    def to_http_exception(self) -> HTTPException:
        """转换为 FastAPI HTTPException"""
        return HTTPException(
            status_code=self.status_code,
            detail={
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        )

    def to_dict(self) -> dict[str, Any]:
        """转换为字典（用于日志或响应）"""
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


# ============================================
# 业务异常（4xx 错误）
# ============================================


class BusinessException(AppException):
    """业务异常基类（4xx 错误）"""

    def _default_status_code(self) -> int:
        return status.HTTP_400_BAD_REQUEST


class ResourceNotFoundException(BusinessException):
    """资源不存在"""

    def __init__(self, resource: str, identifier: Any = None):
        details = {"resource": resource}
        if identifier is not None:
            details["identifier"] = str(identifier)
        super().__init__(
            message=f"{resource} 不存在",
            code="RESOURCE_NOT_FOUND",
            details=details,
            status_code=status.HTTP_404_NOT_FOUND,
        )


class ResourceExistsException(BusinessException):
    """资源已存在（如用户名重复）"""

    def __init__(self, resource: str, identifier: Any = None):
        details = {"resource": resource}
        if identifier is not None:
            details["identifier"] = str(identifier)
        super().__init__(
            message=f"{resource} 已存在",
            code="RESOURCE_EXISTS",
            details=details,
            status_code=status.HTTP_409_CONFLICT,
        )


class PermissionDeniedException(BusinessException):
    """权限不足"""

    def __init__(self, action: str = "执行此操作"):
        super().__init__(
            message=f"权限不足，无法 {action}",
            code="PERMISSION_DENIED",
            details={"action": action},
            status_code=status.HTTP_403_FORBIDDEN,
        )


class ValidationException(BusinessException):
    """数据验证失败"""

    def __init__(self, field: str, reason: str):
        super().__init__(
            message=f"字段 {field} 验证失败: {reason}",
            code="VALIDATION_ERROR",
            details={"field": field, "reason": reason},
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


class AuthenticationException(BusinessException):
    """认证失败"""

    def __init__(self, reason: str = "认证失败"):
        super().__init__(
            message=reason,
            code="AUTHENTICATION_FAILED",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


# ============================================
# 系统异常（5xx 错误）
# ============================================


class SystemException(AppException):
    """系统异常基类（5xx 错误）"""

    def _default_status_code(self) -> int:
        return status.HTTP_500_INTERNAL_SERVER_ERROR


class DatabaseException(SystemException):
    """数据库操作异常"""

    def __init__(self, message: str = "数据库操作失败", original_error: Exception | None = None):
        details = {}
        if original_error:
            details["original_error"] = str(original_error)
        super().__init__(
            message=message,
            code="DATABASE_ERROR",
            details=details,
        )


class ExternalServiceException(SystemException):
    """外部服务调用异常"""

    def __init__(self, service: str, message: str = "服务调用失败"):
        super().__init__(
            message=f"{service} 调用失败: {message}",
            code="EXTERNAL_SERVICE_ERROR",
            details={"service": service},
        )


class ConfigurationException(SystemException):
    """配置错误"""

    def __init__(self, config_key: str, reason: str = "配置无效"):
        super().__init__(
            message=f"配置项 {config_key} {reason}",
            code="CONFIGURATION_ERROR",
            details={"config_key": config_key},
        )


# ============================================
# 便捷的 HTTPException 转换函数
# ============================================


def http_exception_from_app_exception(exc: AppException) -> HTTPException:
    """将 AppException 转换为 HTTPException（保持原有响应格式兼容）"""
    return exc.to_http_exception()

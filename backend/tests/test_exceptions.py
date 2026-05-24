"""
Tests for custom exceptions module.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


class TestExceptions:
    """Tests for exceptions.py"""

    def test_resource_not_found_exception(self):
        """ResourceNotFoundException should have correct format"""
        from app.exceptions import ResourceNotFoundException

        exc = ResourceNotFoundException("用户", 123)
        assert exc.message == "用户 不存在"
        assert exc.code == "RESOURCE_NOT_FOUND"
        assert exc.status_code == 404
        assert exc.details["resource"] == "用户"
        assert exc.details["identifier"] == "123"

    def test_resource_exists_exception(self):
        """ResourceExistsException should have correct format"""
        from app.exceptions import ResourceExistsException

        exc = ResourceExistsException("用户名", "admin")
        assert exc.message == "用户名 已存在"
        assert exc.code == "RESOURCE_EXISTS"
        assert exc.status_code == 409

    def test_permission_denied_exception(self):
        """PermissionDeniedException should have correct format"""
        from app.exceptions import PermissionDeniedException

        exc = PermissionDeniedException("删除数据")
        assert exc.code == "PERMISSION_DENIED"
        assert exc.status_code == 403

    def test_validation_exception(self):
        """ValidationException should have correct format"""
        from app.exceptions import ValidationException

        exc = ValidationException("email", "格式不正确")
        assert exc.code == "VALIDATION_ERROR"
        assert exc.status_code == 422
        assert exc.details["field"] == "email"
        assert exc.details["reason"] == "格式不正确"

    def test_to_http_exception(self):
        """AppException should convert to HTTPException correctly"""
        from app.exceptions import ResourceNotFoundException
        from fastapi import HTTPException

        exc = ResourceNotFoundException("图表", 42)
        http_exc = exc.to_http_exception()

        assert isinstance(http_exc, HTTPException)
        assert http_exc.status_code == 404
        assert http_exc.detail["code"] == "RESOURCE_NOT_FOUND"
        assert http_exc.detail["message"] == "图表 不存在"

    def test_to_dict(self):
        """AppException should convert to dict correctly"""
        from app.exceptions import ValidationException

        exc = ValidationException("name", "太长")
        d = exc.to_dict()

        assert d["code"] == "VALIDATION_ERROR"
        assert d["message"] == "字段 name 验证失败: 太长"
        assert d["details"]["field"] == "name"

    def test_exception_string(self):
        """Exception should have readable string representation"""
        from app.exceptions import DatabaseException

        exc = DatabaseException("连接失败")
        s = str(exc)

        assert "DATABASE_ERROR" in s
        assert "连接失败" in s

    def test_business_exception_defaults(self):
        """BusinessException should default to 400 status"""
        from app.exceptions import BusinessException

        exc = BusinessException("测试错误")
        assert exc.status_code == 400

    def test_system_exception_defaults(self):
        """SystemException should default to 500 status"""
        from app.exceptions import SystemException

        exc = SystemException("系统错误")
        assert exc.status_code == 500

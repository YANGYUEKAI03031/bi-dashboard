"""
Unit tests for SQL injection prevention.

These tests verify that the security fixes in chart_service.py and
temp_table_manager.py properly prevent SQL injection attacks.

Run with: pytest backend/tests/test_sql_injection.py -v
"""
import pytest
import sys
import os

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Import the functions we're testing
from app.services.chart_service import (
    _sql_escape_sql_string,
    _quote_sql_identifier,
    _quote_result_column,
    _quote_mysql_identifier,
    _normalize_identifier_part,
    _metric_filter_rule_dict_sql,
)
from app.services.pipeline.temp_table_manager import (
    _validate_step_id,
    _validate_identifier,
    _build_cast_expression,
)


# ============================================================================
# Tests for chart_service.py
# ============================================================================

class TestSqlEscapeSqlString:
    """Tests for _sql_escape_sql_string function."""

    def test_normal_string(self):
        """Normal strings should pass through unchanged (except escaping)."""
        assert _sql_escape_sql_string("广东") == "广东"
        assert _sql_escape_sql_string("Hello") == "Hello"

    def test_single_quote_escaping(self):
        """Single quotes must be escaped with doubling."""
        assert _sql_escape_sql_string("O'Brien") == "O''Brien"
        assert _sql_escape_sql_string("it's") == "it''s"
        assert _sql_escape_sql_string("'") == "''"
        assert _sql_escape_sql_string("''") == "''''"

    def test_backslash_escaping(self):
        """Backslashes must be escaped."""
        assert _sql_escape_sql_string("path\\to\\file") == "path\\\\to\\\\file"
        assert _sql_escape_sql_string("\\") == "\\\\"

    def test_combined_escaping(self):
        """Both single quotes and backslashes must be escaped."""
        result = _sql_escape_sql_string("O'Brien\\path")
        assert result == "O''Brien\\\\path"

    def test_sql_injection_attempts(self):
        """SQL injection attempts should be neutralized by escaping single quotes."""
        # Basic injection - single quote is escaped to double quote
        assert _sql_escape_sql_string("'; DROP TABLE users;--") == "''; DROP TABLE users;--"
        # OR injection - single quotes escaped
        assert _sql_escape_sql_string("' OR '1'='1") == "'' OR ''1''=''1"
        # UNION injection
        assert _sql_escape_sql_string("' UNION SELECT *") == "'' UNION SELECT *"
        # Key: single quote becomes double quote (MySQL escaping), backslash also escaped
        result = _sql_escape_sql_string("test' OR '1'='1\\")
        assert "''" in result  # Single quotes are escaped

    def test_empty_string(self):
        """Empty strings should be handled gracefully."""
        assert _sql_escape_sql_string("") == ""
        assert _sql_escape_sql_string(None) == ""

    def test_numeric_string(self):
        """Numeric strings should pass through."""
        assert _sql_escape_sql_string("12345") == "12345"


class TestQuoteSqlIdentifier:
    """Tests for _quote_sql_identifier function."""

    def test_normal_identifier(self):
        """Normal identifiers should be quoted."""
        assert _quote_sql_identifier("user_name") == "`user_name`"
        assert _quote_sql_identifier("column1") == "`column1`"
        assert _quote_sql_identifier("支付日期") == "`支付日期`"

    def test_backtick_escaping(self):
        """Backticks in identifiers must be escaped."""
        assert _quote_sql_identifier("col`name") == "`col``name`"
        assert _quote_sql_identifier("``") == "``````"  # escaped backtick

    def test_whitespace_handling(self):
        """Whitespace should be trimmed."""
        assert _quote_sql_identifier("  user_name  ") == "`user_name`"

    def test_empty_identifier(self):
        """Empty identifiers should return just a backtick."""
        assert _quote_sql_identifier("") == "`"
        assert _quote_sql_identifier("   ") == "`"

    def test_sql_injection_attempts(self):
        """SQL injection via identifiers should be neutralized."""
        # Note: _quote_sql_identifier only escapes backticks
        # The identifier is NOT executed as SQL, it's treated as a column name
        # So these tests verify proper backtick escaping
        result = _quote_sql_identifier("col`; DROP TABLE users;--")
        assert "`" in result
        assert result == "`col``; DROP TABLE users;--`"


class TestQuoteResultColumn:
    """Tests for _quote_result_column function."""

    def test_normal_column(self):
        """Normal column names should be quoted."""
        assert _quote_result_column("user_name") == "`user_name`"

    def test_qualified_column(self):
        """Qualified names (t.col) should extract just the column name."""
        assert _quote_result_column("t.user_name") == "`user_name`"
        assert _quote_result_column("schema.table.col") == "`col`"
        assert _quote_result_column("db.table.column_name") == "`column_name`"

    def test_backtick_escaping(self):
        """Backticks must be escaped."""
        assert _quote_result_column("col`name") == "`col``name`"

    def test_empty_column(self):
        """Empty column names should raise ValueError."""
        with pytest.raises(ValueError, match="empty"):
            _quote_result_column("")
        with pytest.raises(ValueError, match="empty"):
            _quote_result_column("   ")


class TestQuoteMysqlIdentifier:
    """Tests for _quote_mysql_identifier function."""

    def test_simple_identifier(self):
        """Simple identifiers should be quoted."""
        assert _quote_mysql_identifier("table_name") == "`table_name`"

    def test_qualified_identifier(self):
        """Qualified identifiers (db.table) should quote each segment."""
        assert _quote_mysql_identifier("db.table_name") == "`db`.`table_name`"
        assert _quote_mysql_identifier("schema.table.column") == "`schema`.`table`.`column`"

    def test_whitespace_handling(self):
        """Whitespace around dots should be handled."""
        assert _quote_mysql_identifier("db . table") == "`db`.`table`"
        assert _quote_mysql_identifier("db. table") == "`db`.`table`"

    def test_backtick_escaping(self):
        """Backticks in identifiers must be escaped."""
        assert _quote_mysql_identifier("db`x.table") == "`db``x`.`table`"
        # Test complex escaping
        result = _quote_mysql_identifier("db.`ta`ble")
        assert "``" in result  # Backticks are escaped
        assert "`db`" in result

    def test_empty_identifier(self):
        """Empty identifiers should raise ValueError."""
        with pytest.raises(ValueError):
            _quote_mysql_identifier("")
        with pytest.raises(ValueError):
            _quote_mysql_identifier("   ")


class TestNormalizeIdentifierPart:
    """Tests for _normalize_identifier_part function."""

    def test_normal_part(self):
        """Normal parts should pass through."""
        assert _normalize_identifier_part("user_name") == "user_name"
        assert _normalize_identifier_part("col") == "col"

    def test_quoted_part(self):
        """Parts surrounded by backticks should be unquoted."""
        assert _normalize_identifier_part("`user_name`") == "user_name"
        assert _normalize_identifier_part("``") == ""


class TestMetricFilterRuleDictSql:
    """Tests for _metric_filter_rule_dict_sql function."""

    def test_eq_operator(self):
        """EQ operator should generate correct SQL."""
        result = _metric_filter_rule_dict_sql({
            "field": "region",
            "op": "eq",
            "value": "广东"
        })
        assert result == "`region` = '广东'"

    def test_eq_with_injection(self):
        """EQ operator should escape SQL injection in values."""
        result = _metric_filter_rule_dict_sql({
            "field": "region",
            "op": "eq",
            "value": "' OR '1'='1"
        })
        # Should NOT allow the injection
        assert "' OR '1'='1'" not in result
        assert "'' OR ''1''=''1" in result

    def test_neq_operator(self):
        """NEQ operator should work correctly."""
        result = _metric_filter_rule_dict_sql({
            "field": "status",
            "op": "neq",
            "value": "deleted"
        })
        assert result == "`status` <> 'deleted'"

    def test_gt_operator(self):
        """GT operator should work correctly."""
        result = _metric_filter_rule_dict_sql({
            "field": "amount",
            "op": "gt",
            "value": "100"
        })
        assert result == "`amount` > '100'"

    def test_contains_operator(self):
        """Contains operator should use LOCATE function."""
        result = _metric_filter_rule_dict_sql({
            "field": "name",
            "op": "contains",
            "value": "test"
        })
        assert "LOCATE" in result
        assert "`name`" in result

    def test_contains_with_injection(self):
        """Contains should escape SQL injection properly."""
        result = _metric_filter_rule_dict_sql({
            "field": "name",
            "op": "contains",
            "value": "'; DROP TABLE users;--"
        })
        # The SQL injection string IS in the result, but single quotes are escaped
        # This makes it safe - the whole thing is treated as a literal search string
        # The semicolon and other SQL keywords are inside a quoted string, so they're harmless
        assert "'';" in result or "'\\" in result  # Quotes are escaped
        assert "LOCATE" in result  # LOCATE function is used (safe)

    def test_is_null_operator(self):
        """IS NULL operator should work correctly."""
        result = _metric_filter_rule_dict_sql({
            "field": "deleted_at",
            "op": "is_null",
            "value": None
        })
        assert "IS NULL" in result or "IS NULL OR" in result

    def test_empty_field(self):
        """Empty field should return None."""
        result = _metric_filter_rule_dict_sql({
            "field": "",
            "op": "eq",
            "value": "test"
        })
        assert result is None

    def test_field_with_special_chars(self):
        """Field with special characters should be properly quoted."""
        result = _metric_filter_rule_dict_sql({
            "field": "field`name",
            "op": "eq",
            "value": "test"
        })
        assert "`field``name`" in result


# ============================================================================
# Tests for temp_table_manager.py
# ============================================================================

class TestValidateStepId:
    """Tests for _validate_step_id function."""

    def test_valid_step_ids(self):
        """Valid step_ids should pass validation."""
        assert _validate_step_id("step_0") == "step_0"
        assert _validate_step_id("step_1") == "step_1"
        assert _validate_step_id("step_123") == "step_123"
        assert _validate_step_id("my_step") == "my_step"
        assert _validate_step_id("_private_step") == "_private_step"

    def test_invalid_step_id_sql_injection(self):
        """SQL injection attempts should be rejected."""
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step_0; DROP TABLE users")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step_0' OR '1'='1")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step_0--")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step_0 UNION SELECT")

    def test_invalid_step_id_special_chars(self):
        """Special characters should be rejected."""
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step.0")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step/0")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step@0")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("step 0")

    def test_invalid_step_id_starts_with_number(self):
        """Step IDs starting with numbers should be rejected."""
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("0step")
        with pytest.raises(ValueError, match="Invalid step_id"):
            _validate_step_id("123")


class TestValidateIdentifier:
    """Tests for _validate_identifier function."""

    def test_valid_identifiers(self):
        """Valid identifiers should pass validation."""
        assert _validate_identifier("user_name") == "user_name"
        assert _validate_identifier("column1") == "column1"
        assert _validate_identifier("_private") == "_private"
        assert _validate_identifier("CamelCase") == "CamelCase"

    def test_invalid_identifier_sql_injection(self):
        """SQL injection attempts should be rejected."""
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("name; DROP TABLE")
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("name' OR '1'='1")
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("name--comment")

    def test_invalid_identifier_special_chars(self):
        """Special characters should be rejected."""
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("field.name")
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("field-name")
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_identifier("field name")


class TestBuildCastExpression:
    """Tests for _build_cast_expression function."""

    def test_date_format(self):
        """Date format should produce correct CAST expression."""
        expr, col_type = _build_cast_expression("created_at", "date")
        assert "CAST" in expr
        assert "AS DATE" in expr
        assert col_type == "DATE"

    def test_datetime_format(self):
        """Datetime format should produce correct CAST expression."""
        expr, col_type = _build_cast_expression("timestamp", "datetime")
        assert "CAST" in expr
        assert "AS DATETIME" in expr
        assert col_type == "DATETIME(3)"

    def test_number_format(self):
        """Number format should produce correct CAST expression."""
        expr, col_type = _build_cast_expression("amount", "number")
        assert "CAST" in expr
        assert "AS DECIMAL" in expr
        assert col_type == "DECIMAL(20,4)"

    def test_string_format(self):
        """String format should produce correct CAST expression."""
        expr, col_type = _build_cast_expression("name", "string")
        assert "CAST" in expr
        assert "AS CHAR" in expr
        assert col_type == "TEXT"

    def test_auto_format(self):
        """Auto format should return plain column reference."""
        expr, col_type = _build_cast_expression("field", "auto")
        assert expr == "`field`"
        assert col_type == "TEXT"

    def test_injection_in_column_name(self):
        """SQL injection in column names should be blocked."""
        # This should raise ValueError because of special characters
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _build_cast_expression("field; DROP TABLE", "string")
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _build_cast_expression("field' OR '1'='1", "date")


# ============================================================================
# Integration-style tests (comparing old vs new behavior)
# ============================================================================

class TestSecurityComparison:
    """
    These tests verify that the new code is more secure than naive string concatenation.
    """

    def test_value_injection_vs_old_concatenation(self):
        """
        OLD (vulnerable): f"WHERE region = '{value}'"
        NEW (safe): f"WHERE region = '{_sql_escape_sql_string(value)}'"

        With value = "' OR '1'='1":
        - OLD: WHERE region = '' OR '1'='1'  -> INJECTION!
        - NEW: WHERE region = ''' OR ''1''=''1' -> Safe
        """
        malicious_value = "' OR '1'='1"
        safe_value = _sql_escape_sql_string(malicious_value)

        # The safe value should contain escaped quotes
        assert "''" in safe_value or "'\\''" in safe_value
        # It should NOT be injectable as a WHERE clause
        assert safe_value.count("'") % 2 == 0 or "\\" in safe_value

    def test_identifier_vs_old_concatenation(self):
        """
        OLD (vulnerable): f"SELECT {column} FROM ..."
        NEW (safe): f"SELECT {_quote_sql_identifier(column)} FROM ..."

        With column = "col`; DROP TABLE users;--":
        - OLD: SELECT col; DROP TABLE users;-- FROM ... -> INJECTION!
        - NEW: SELECT `col``; DROP TABLE users;--` FROM ... -> Safe (treated as literal column name)
        """
        malicious_column = "col`; DROP TABLE users;--"
        safe_column = _quote_sql_identifier(malicious_column)

        # Should contain escaped backticks
        assert "``" in safe_column
        # The whole thing should be wrapped in backticks, treating it as a single column name
        assert safe_column.startswith("`")
        assert safe_column.endswith("`")
        # The backtick escaping makes the SQL keywords part of a literal identifier
        # (This is safe because MySQL will look for a column literally named "col`; DROP TABLE users;--")

    def test_step_id_vs_old_concatenation(self):
        """
        OLD (vulnerable): f"SELECT * FROM tmp_{step_id}"
        NEW (safe): validate step_id first

        With step_id = "0; DELETE FROM users":
        - OLD: SELECT * FROM tmp_0; DELETE FROM users -> INJECTION!
        - NEW: ValueError raised -> Blocked!
        """
        malicious_step_id = "0; DELETE FROM users"

        with pytest.raises(ValueError):
            _validate_step_id(malicious_step_id)


# ============================================================================
# Summary test report
# ============================================================================

def test_summary_report(capsys):
    """Print a summary of all security tests."""
    print("\n" + "="*70)
    print("SQL INJECTION PREVENTION TESTS SUMMARY")
    print("="*70)
    print("\nFunctions tested:")
    print("  - _sql_escape_sql_string: Escapes single quotes and backslashes")
    print("  - _quote_sql_identifier: Quotes and escapes column/table names")
    print("  - _quote_result_column: Handles qualified column names (t.col)")
    print("  - _quote_mysql_identifier: Handles db.table.column format")
    print("  - _metric_filter_rule_dict_sql: Generates safe WHERE clauses")
    print("  - _validate_step_id: Whitelist validation for step IDs")
    print("  - _validate_identifier: Whitelist validation for identifiers")
    print("  - _build_cast_expression: Safe CAST expressions")
    print("\n" + "="*70)

# backend/app/services/pipeline/sql_expressions.py
"""
SQL 表达式构建工具模块

从 engine.py 提取的 SQL 构建函数，便于维护和测试。
"""

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


# ============================================================
# 基础工具函数
# ============================================================


def _safe_identifier(name: str) -> str:
    """安全地包裹表名/列名，白名单校验"""
    raw = (name or "").strip()
    if not raw:
        raise ValueError("标识符不能为空")
    # 支持点号分隔 schema.table，以及反引号包裹的标识符
    clean = raw.replace("`", "").strip()
    # MySQL 允许标识符以字母、下划线、中文开头，也可以数字开头
    # 第一个正则：允许字母、下划线、中文开头
    # 第二个正则：允许数字开头（MySQL 允许，但需要反引号包裹）
    if not re.match(r"^[a-zA-Z_\u4e00-\u9fff][\w\u4e00-\u9fff.]*$", clean):
        if not re.match(r"^\d[\w\u4e00-\u9fff.]*$", clean):
            raise ValueError(f"非法标识符: {name}")
    parts = [p for p in clean.split(".") if p]
    escaped = [p.replace("`", "``") for p in parts]
    return ".".join(f"`{p}`" for p in escaped)


def _escape_sql_string(value: str) -> str:
    """转义SQL字符串值中的特殊字符，防止SQL注入"""
    return (value or "").replace("\\", "\\\\").replace("'", "''")


def _escape_like_value(value: str) -> str:
    """转义LIKE模式中的特殊字符（%、_、反斜杠）"""
    escaped = _escape_sql_string(value)
    return escaped.replace("%", "\\%").replace("_", "\\_")


def _split_select_columns(sql: str) -> list[str]:
    """将 SELECT ... FROM 之间的列表达式按顶层逗号分割（处理字符串字面量）"""
    m = re.match(r"^SELECT\s+(.*?)\s+FROM\s+", sql, re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    cols_str = m.group(1)
    parts: list[str] = []
    depth = 0
    in_str = False
    str_char = ""
    i = 0
    while i < len(cols_str):
        c = cols_str[i]
        is_escaped = i > 0 and cols_str[i - 1] == "\\"
        if c in ("'", '"', "`") and not is_escaped:
            if not in_str:
                in_str = True
                str_char = c
            elif c == str_char:
                in_str = False
                str_char = ""
        if not in_str:
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            elif c == "," and depth == 0:
                parts.append(cols_str[:i].strip())
                cols_str = cols_str[i + 1 :]
                i = -1
        i += 1
    parts.append(cols_str.strip())
    return parts


def _extract_columns_from_select(sql: str) -> list[str]:
    """从 SELECT ... FROM (...) 中提取列名（支持复杂表达式和 AS 别名）"""
    sql_stripped = sql.strip()
    if not sql_stripped.upper().startswith("SELECT"):
        return []
    m = re.match(r"^SELECT\s+(.*?)(\s+FROM\s+)", sql_stripped, re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    cols_str = m.group(1).strip()
    if cols_str == "*":
        return []

    cols: list[str] = []
    depth = 0
    buf = ""
    for ch in cols_str:
        if ch == "(":
            depth += 1
            buf += ch
        elif ch == ")":
            depth -= 1
            buf += ch
        elif ch == "," and depth == 0:
            col = buf.strip()
            as_match = re.match(r"^(.*?)\s+AS\s+(\S+)$", col, re.IGNORECASE)
            if as_match:
                inner = as_match.group(1).strip()
                fn_match = re.match(r"^\w+\([^)]*\)$", inner, re.IGNORECASE)
                if fn_match:
                    col = as_match.group(2)
                else:
                    col = inner
            cols.append(col)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        col = buf.strip()
        as_match = re.match(r"^(.*?)\s+AS\s+(\S+)$", col, re.IGNORECASE)
        if as_match:
            inner = as_match.group(1).strip()
            fn_match = re.match(r"^\w+\([^)]*\)$", inner, re.IGNORECASE)
            if fn_match:
                col = as_match.group(2)
            else:
                col = inner
        cols.append(col)

    return [c.strip() for c in cols if c.strip()]


def _extract_columns_from_nested_select(sql: str, max_depth: int = 10) -> list[str]:
    """递归从嵌套 SELECT 提取列名"""
    if max_depth <= 0:
        return []
    cols = _extract_columns_from_select(sql)
    if cols:
        return cols
    m = re.search(r"\(\s*SELECT\s+", sql, re.IGNORECASE)
    if m:
        depth = 0
        start = -1
        for i, ch in enumerate(sql):
            if ch == "(":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0 and start != -1:
                    inner = sql[start + 1 : i]
                    return _extract_columns_from_nested_select(f"SELECT {inner}", max_depth - 1)
    return []


def _extract_sql_aliases(sql: str) -> list[str]:
    """从 SELECT 语句中提取每个列表达式的最终列名"""
    aliases: list[str] = []
    parts = _split_select_columns(sql)
    for part in parts:
        part = part.strip()
        m = re.search(r"\bAS\s+([^\s,)]+)\s*$", part, re.IGNORECASE)
        if m:
            aliases.append(m.group(1).strip("`\"'"))
        else:
            identifiers = re.findall(r"\b([a-zA-Z_\u4e00-\u9fff]\w*)\b", part)
            if identifiers:
                aliases.append(identifiers[-1])
    return aliases


def source_table_name(config: dict[str, Any]) -> str:
    """解析源表名：config.tableName / table_name，或节点 sql 字段中的 FROM `tbl`"""
    for key in ("tableName", "table_name"):
        v = config.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    sql = config.get("sql")
    if isinstance(sql, str) and sql.strip():
        m = re.search(r"FROM\s+[`\"]?([a-zA-Z0-9_]+)[`\"]?", sql, re.IGNORECASE)
        if m:
            return m.group(1)
    return ""


# ============================================================
# JOIN 相关函数
# ============================================================


def join_on_equality_sql(left_col: str, right_col: str) -> str:
    """ON 条件两侧统一 COLLATE，避免 MySQL 1267 错误"""
    la = f"a.{_safe_identifier(left_col)}"
    rb = f"b.{_safe_identifier(right_col)}"
    coll = "utf8mb4_unicode_ci"
    return f"{la} COLLATE {coll} = {rb} COLLATE {coll}"


def join_explicit_select_list(
    left_cols: list[str] | None,
    right_cols: list[str] | None,
    on_right_cols: list[str] | None = None,
) -> str:
    """生成 JOIN 的显式列选择列表，自动处理同名列冲突"""
    if left_cols is None and right_cols is None:
        return "*"
    if left_cols is None:
        return "*"
    if right_cols is None:
        return ", ".join(f"a.{_safe_identifier(c)}" for c in left_cols)

    on_set = set(on_right_cols) if on_right_cols else set()
    parts: list[str] = []

    for c in left_cols:
        parts.append(f"a.{_safe_identifier(c)}")

    for c in right_cols:
        if c in on_set:
            continue
        if c not in left_cols:
            parts.append(f"b.{_safe_identifier(c)}")
        else:
            base = c
            max_suffix = 0
            suffix_pattern = re.compile(rf"^{re.escape(base)}(?:_([a-z]))?$")
            for lc in left_cols:
                m = suffix_pattern.match(lc)
                if m:
                    suf = m.group(1)
                    if suf is None:
                        max_suffix = max(max_suffix, 0)
                    else:
                        val = ord(suf) - ord("a") + 1
                        max_suffix = max(max_suffix, val)
            next_suffix = chr(ord("a") + max_suffix)
            b_alias = _safe_identifier(f"{c}_{next_suffix}")
            parts.append(f"b.{_safe_identifier(c)} AS {b_alias}")

    return ", ".join(parts)


def extract_join_on_right_column_names_from_sql(sql: str) -> list[str]:
    """从 JOIN SQL 中提取 ON 条件的右表列名"""
    result: list[str] = []
    pattern = r"ON\s+[a-z]\.([^=\s]+)\s*=\s*[a-z]\.([^=\s]+)"
    for m in re.finditer(pattern, sql, re.IGNORECASE):
        result.append(m.group(2))
    return result


def expand_join_select_stars(
    sql: str,
    left_cols: list[str] | None,
    right_cols: list[str] | None,
    on_right_cols: list[str] | None = None,
) -> str:
    """将 JOIN SQL 中的 SELECT * 展开为显式列列表"""
    left_parts: list[str] = []
    if left_cols:
        left_parts = [f"a.{_safe_identifier(c)}" for c in left_cols]

    if right_cols is None or (left_cols is None and right_cols is None):
        return sql

    on_set = set(on_right_cols) if on_right_cols else set()
    right_parts: list[str] = []
    for c in right_cols:
        if c in on_set:
            continue
        if left_cols is None or c not in left_cols:
            right_parts.append(f"b.{_safe_identifier(c)}")
        else:
            right_parts.append(f"b.{_safe_identifier(c)} AS {_safe_identifier(c)}_b")

    if not left_parts and not right_parts:
        return sql

    all_parts = left_parts + right_parts
    select_clause = ", ".join(all_parts)

    pattern = (
        r"SELECT\s+\*\s+FROM\s+\((.+?)\)\s+AS\s+[ab]\s+(INNER|LEFT|RIGHT|FULL|OUTER)?\s*JOIN\s+\((.+?)\)\s+AS\s+[ab]"
    )

    def make_replacement(m):
        g1, g2, g3 = m.group(1), m.group(2), m.group(3)
        join_type = g2 or ""
        return f"SELECT {select_clause} FROM ({g1}) AS a {join_type} JOIN ({g3}) AS b"

    result = re.sub(pattern, make_replacement, sql, flags=re.IGNORECASE | re.DOTALL)

    if result == sql:
        pattern2 = r"SELECT\s+\*\s+FROM\s+\((.+?)\)\s+AS\s+[ab]"

        def make_replacement2(m):
            g1 = m.group(1)
            return f"SELECT {select_clause} FROM ({g1}) AS a"

        result = re.sub(pattern2, make_replacement2, sql, flags=re.IGNORECASE)

    return result


def join_preview_allowed_sql_columns(
    join_type: str,
    left_cols: list[str] | None,
    right_cols: list[str] | None,
    on_right_cols: list[str] | None,
    symmetric_union_plan: list[Any] | None = None,
) -> set[str] | None:
    """计算 JOIN 预览中实际可用的列名集合"""
    jt = (join_type or "inner").lower()
    on_set = set(on_right_cols) if on_right_cols else set()

    if jt == "left_anti":
        return set(left_cols) if left_cols is not None else None
    if jt == "right_anti":
        return set(right_cols) if right_cols is not None else None
    if jt == "symmetric_diff":
        plan = symmetric_union_plan
        if isinstance(plan, list) and plan:
            outs: list[str] = []
            for row in plan:
                if isinstance(row, dict):
                    o = str(row.get("out") or row.get("alias") or "").strip()
                    if o:
                        outs.append(o)
            if outs:
                return set(outs)
        return None
    if jt == "full":
        jt = "left"
    if jt not in ("inner", "left", "right"):
        return None

    if left_cols is not None and right_cols is not None:
        left_set = set(left_cols)
        names: list[str] = list(left_cols)
        for c in right_cols:
            if c in on_set:
                continue
            if c not in left_set:
                names.append(c)
            else:
                base = c
                max_suffix = 0
                suffix_pattern = re.compile(rf"^{re.escape(base)}(?:_([a-z]))?$")
                for lc in left_cols:
                    m = suffix_pattern.match(lc)
                    if m:
                        suf = m.group(1)
                        if suf is None:
                            max_suffix = max(max_suffix, 0)
                        else:
                            val = ord(suf) - ord("a") + 1
                            max_suffix = max(max_suffix, val)
                next_suffix = chr(ord("a") + max_suffix)
                names.append(f"{c}_{next_suffix}")
        return set(names)

    if left_cols is not None and right_cols is None and jt in ("left", "right") and on_right_cols:
        names = list(left_cols)
        for c in right_cols or []:
            if c not in on_set:
                names.append(f"{c}_b")
        return set(names)

    return None


def symmetric_diff_union_sql(
    left_ref: str,
    right_ref: str,
    on_clause: str,
    null_b: str,
    null_a: str,
    join_keys: list[dict[str, Any]],
    plan: list[dict[str, Any]] | None,
) -> str:
    """对称差 UNION ALL：两侧 SELECT * 统一 COLLATE 避免 MySQL 1267 错误"""
    coll = "utf8mb4_unicode_ci"
    rows: list[dict[str, Any]] = []
    if plan:
        for p in plan:
            if not isinstance(p, dict):
                continue
            out = str(p.get("out") or p.get("alias") or "").strip()
            lc = str(p.get("L") or p.get("leftCol") or "").strip()
            rc = str(p.get("R") or p.get("rightCol") or "").strip()
            if out or lc or rc:
                if not out:
                    out = lc or rc or "col"
                rows.append({"out": out, "L": lc, "R": rc})
    if not rows and join_keys:
        k0 = join_keys[0]
        if isinstance(k0, dict):
            lc = str(k0.get("leftCol", "") or "").strip()
            rc = str(k0.get("rightCol", "") or "").strip()
            if lc or rc:
                rows.append({"out": lc or rc or "k", "L": lc, "R": rc})
    if not rows:
        return (
            f"SELECT a.* FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_b} "
            f"UNION ALL "
            f"SELECT b.* FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}"
        )

    def _cast_a(row: dict[str, Any]) -> str:
        lc = str(row.get("L") or "").strip()
        out = str(row.get("out") or lc or "c").strip()
        safe_out = _safe_identifier(out)
        if lc:
            expr = f"CAST(a.{_safe_identifier(lc)} AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
        else:
            expr = f"CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
        return f"{expr} AS {safe_out}"

    def _cast_b(row: dict[str, Any]) -> str:
        rc = str(row.get("R") or "").strip()
        out = str(row.get("out") or rc or "c").strip()
        safe_out = _safe_identifier(out)
        if rc:
            expr = f"CAST(b.{_safe_identifier(rc)} AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
        else:
            expr = f"CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE {coll}"
        return f"{expr} AS {safe_out}"

    sel_l = ", ".join(_cast_a(r) for r in rows)
    sel_r = ", ".join(_cast_b(r) for r in rows)
    return (
        f"SELECT {sel_l} FROM ({left_ref}) AS a LEFT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_b} "
        f"UNION ALL "
        f"SELECT {sel_r} FROM ({left_ref}) AS a RIGHT JOIN ({right_ref}) AS b ON {on_clause} WHERE {null_a}"
    )


# ============================================================
# 日期快捷选项
# ============================================================


def get_date_preset_expression(preset: str) -> tuple[str, str] | None:
    """根据快捷日期选项获取开始和结束日期（SQL 格式）"""
    from datetime import UTC, datetime, timedelta

    from dateutil.relativedelta import relativedelta

    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    fmt = "%Y-%m-%d"

    presets = {
        "today": (today, today),
        "yesterday": (yesterday, yesterday),
        "last_7_days": (today - timedelta(days=6), today),
        "last_30_days": (today - timedelta(days=29), today),
        "this_month": (today.replace(day=1), (today + relativedelta(months=1) - timedelta(days=1))),
        "last_month": ((today - relativedelta(months=1)).replace(day=1), (today - timedelta(days=today.day))),
        "this_year": (today.replace(month=1, day=1), today.replace(month=12, day=31)),
        "last_year": (
            (today.replace(year=today.year - 1, month=1, day=1)),
            (today.replace(year=today.year - 1, month=12, day=31)),
        ),
        "yesterday_last_7_days": (yesterday - timedelta(days=6), yesterday),
        "yesterday_last_30_days": (yesterday - timedelta(days=29), yesterday),
        "yesterday_last_90_days": (yesterday - timedelta(days=89), yesterday),
        "yesterday_last_month": (
            (yesterday - relativedelta(months=1)).replace(day=1),
            (yesterday - timedelta(days=yesterday.day)),
        ),
    }

    dates = presets.get(preset)
    if dates:
        return (dates[0].strftime(fmt), dates[1].strftime(fmt))
    return None


# ============================================================
# 过滤和聚合
# ============================================================


def build_filter_sql(
    table_ref: str,
    conditions: list[dict[str, Any]],
    logic: str = "AND",
) -> str:
    """根据可视化配置构建 WHERE 子句"""
    if not conditions:
        return ""
    clauses = []
    for cond in conditions:
        col_name = str(cond.get("column", "") or "").strip()
        if not col_name:
            continue
        col = _safe_identifier(col_name)
        op = str(cond.get("operator", "eq"))
        val = str(cond.get("value", ""))

        if op == "preset":
            preset = str(cond.get("preset", ""))
            if preset:
                dates = get_date_preset_expression(preset)
                if dates:
                    d0 = _escape_sql_string(str(dates[0]))
                    d1 = _escape_sql_string(str(dates[1]))
                    clauses.append(f"{col} BETWEEN '{d0}' AND '{d1}'")
            continue

        if op == "before":
            preset = str(cond.get("preset", ""))
            if preset:
                dates = get_date_preset_expression(preset)
                if dates:
                    d0 = _escape_sql_string(str(dates[0]))
                    clauses.append(f"{col} < '{d0}'")
            continue

        if op == "after":
            preset = str(cond.get("preset", ""))
            if preset:
                dates = get_date_preset_expression(preset)
                if dates:
                    d1 = _escape_sql_string(str(dates[1]))
                    clauses.append(f"{col} > '{d1}'")
            continue

        if op == "between":
            range_start = str(cond.get("rangeStart", ""))
            range_end = str(cond.get("rangeEnd", ""))
            if range_start and range_end:
                s = _escape_sql_string(range_start)
                e = _escape_sql_string(range_end)
                clauses.append(f"{col} BETWEEN '{s}' AND '{e}'")
            continue

        ev = _escape_sql_string(val)
        if op == "eq":
            clauses.append(f"{col} = '{ev}'")
        elif op == "ne":
            clauses.append(f"{col} != '{ev}'")
        elif op == "gt":
            clauses.append(f"{col} > '{ev}'")
        elif op == "ge":
            clauses.append(f"{col} >= '{ev}'")
        elif op == "lt":
            clauses.append(f"{col} < '{ev}'")
        elif op == "le":
            clauses.append(f"{col} <= '{ev}'")
        elif op == "contains":
            escaped = _escape_like_value(val)
            clauses.append(f"{col} LIKE '%{escaped}%' ESCAPE '\\\\'")
        elif op == "startsWith":
            escaped = _escape_like_value(val)
            clauses.append(f"{col} LIKE '{escaped}%' ESCAPE '\\\\'")
        elif op == "endsWith":
            escaped = _escape_like_value(val)
            clauses.append(f"{col} LIKE '%{escaped}' ESCAPE '\\\\'")
        elif op == "isNull":
            clauses.append(f"{col} IS NULL")
        elif op == "isNotNull":
            clauses.append(f"{col} IS NOT NULL")
        elif op == "in":
            items = ", ".join(f"'{_escape_sql_string(v.strip())}'" for v in val.split(",") if v.strip())
            if not items:
                continue
            clauses.append(f"{col} IN ({items})")
    if not clauses:
        return ""
    sep = f" {logic} "
    return f" WHERE {sep.join(clauses)}"


def aggregation_sql_fragment(agg: dict[str, Any]) -> str | None:
    """单条聚合配置 -> SELECT 片段"""
    fn = str(agg.get("func", "count") or "count").lower().strip()
    col_raw = agg.get("column")
    col = str(col_raw).strip() if col_raw is not None else ""
    alias_raw = agg.get("alias")
    alias = str(alias_raw).strip() if alias_raw else ""
    if not alias:
        alias = f"{fn}_{col}" if col else f"{fn}_col"

    if fn == "count_distinct":
        if not col:
            return None
        return f"COUNT(DISTINCT {_safe_identifier(col)}) AS {_safe_identifier(alias)}"
    if fn == "count":
        if not col or col == "*":
            return f"COUNT(*) AS {_safe_identifier(alias)}"
        return f"COUNT({_safe_identifier(col)}) AS {_safe_identifier(alias)}"

    if not col:
        return None
    sql_fn = {
        "sum": "SUM",
        "avg": "AVG",
        "max": "MAX",
        "min": "MIN",
    }.get(fn, fn.upper())
    return f"{sql_fn}({_safe_identifier(col)}) AS {_safe_identifier(alias)}"


def apply_row_filter(sql: str, config: dict[str, Any]) -> str:
    """若 config 中含 rowFilterConditions，对已有 sql 包装 SELECT * FROM (...) WHERE ..."""
    if not sql:
        return ""
    conditions = config.get("rowFilterConditions", [])
    if not conditions:
        return sql
    logic = config.get("rowFilterLogic", "AND")
    where = build_filter_sql(sql, conditions, logic)
    if not where:
        return sql
    return f"SELECT * FROM ({sql}) AS _r{where}"


# ============================================================
# 列格式和重命名
# ============================================================


def build_column_format_expr(col_expr: str, col_name: str, fmt: str) -> str:
    """根据预览格式生成 MySQL 表达式"""
    safe_name = _safe_identifier(col_name)
    if fmt == "date" or fmt == "datetime":
        return f"DATE({col_expr}) AS {safe_name}"
    elif fmt == "percent":
        return f"({col_expr} * 100) AS {safe_name}"
    elif fmt == "number":
        return f"{col_expr} AS {safe_name}"
    elif fmt == "string":
        return f"CAST({col_expr} AS CHAR) AS {safe_name}"
    return col_expr


def apply_column_formats(sql: str, config: dict[str, Any]) -> str:
    """根据 previewColumnFormats 对 SELECT 列应用格式转换"""
    formats: dict[str, str] = config.get("previewColumnFormats", {})
    if not formats:
        return sql

    sql_stripped = sql.strip()
    if not sql_stripped.upper().startswith("SELECT"):
        return sql

    cols = _extract_columns_from_select(sql_stripped)
    if not cols:
        return sql

    cols_to_format = [c for c in cols if c in formats]
    if not cols_to_format:
        return sql

    select_parts: list[str] = []
    for col in cols:
        safe_col = _safe_identifier(col)
        fmt = formats.get(col)
        if fmt and fmt != "auto":
            expr = build_column_format_expr(safe_col, col, fmt)
            select_parts.append(expr)
        else:
            select_parts.append(safe_col)

    cols_str = ", ".join(select_parts)
    m = re.search(r"(\s+FROM\s+.+)$", sql_stripped, re.IGNORECASE | re.DOTALL)
    if not m:
        return sql
    from_part = m.group(1)
    return f"SELECT {cols_str}{from_part}"


def apply_column_renames(sql: str, renames: dict[str, str]) -> str:
    """应用列重命名映射"""
    if not renames:
        return sql

    sql_stripped = sql.strip()
    if not sql_stripped.upper().startswith("SELECT"):
        return sql

    cols = _extract_columns_from_select(sql_stripped)
    if not cols:
        return sql

    # 检查是否有需要重命名的列
    cols_to_rename = [c for c in cols if c in renames]
    if not cols_to_rename:
        return sql

    select_parts: list[str] = []
    current_renames: dict[str, str] = {}

    for col in cols:
        if col in renames:
            new_name = renames[col]
            safe_old = _safe_identifier(col)
            safe_new = _safe_identifier(new_name)
            select_parts.append(f"{safe_old} AS {safe_new}")
            current_renames[col] = new_name
        else:
            select_parts.append(_safe_identifier(col))

    cols_str = ", ".join(select_parts)
    m = re.search(r"(\s+FROM\s+.+)$", sql_stripped, re.IGNORECASE | re.DOTALL)
    if not m:
        return sql
    from_part = m.group(1)

    # 更新 renames 用于后续处理
    config = dict(renames)
    config.update(current_renames)

    result = f"SELECT {cols_str}{from_part}"

    # 递归处理子查询中的重命名
    inner_m = re.search(r"FROM\s+\((.+)\)\s+AS\s+(\S+)", result, re.IGNORECASE | re.DOTALL)
    if inner_m:
        inner_sql = inner_m.group(1).strip()
        inner_alias = inner_m.group(2)
        if "SELECT" in inner_sql.upper():
            inner_result = apply_column_renames(inner_sql, config)
            result = result.replace(f"({inner_sql}) AS {inner_alias}", f"({inner_result}) AS {inner_alias}")

    return result


# ============================================================
# 列投影
# ============================================================


def apply_column_projection(
    sql: str,
    config: dict[str, Any],
    allowed_proj: set[str] | None = None,
    is_last_layer: bool = False,
) -> str:
    """根据 outputColumnKeys 和 insertedColumns 应用列投影"""
    if not sql:
        return sql

    sql_stripped = sql.strip()
    if not sql_stripped.upper().startswith("SELECT"):
        return sql

    output_keys: list[str] = config.get("outputColumnKeys", []) or []
    inserted_cols: list[dict[str, Any]] = config.get("insertedColumns", []) or []
    rename_map: dict[str, str] = dict(config.get("renameMap") or {})

    # 检查是否有需要处理的
    if not output_keys and not inserted_cols and not rename_map:
        return sql

    # 获取当前 SQL 的列
    cols = _extract_columns_from_select(sql_stripped)
    if not cols:
        return sql

    select_parts: list[str] = []
    seen_aliases: set[str] = set()
    new_cols_added: list[str] = []

    def _is_column_in_output(col: str) -> str | None:
        """检查列是否在输出中，返回输出时的列名"""
        if col in output_keys:
            return rename_map.get(col, col)
        for ok in output_keys:
            if ok == col or ok.rstrip("_b").rstrip("_c") == col.rstrip("_b").rstrip("_c"):
                return rename_map.get(ok, ok)
        return None

    def _is_column_allowed(col: str) -> bool:
        """检查列是否在 allowed_proj 白名单中"""
        if allowed_proj is None:
            return True
        if col in allowed_proj:
            return True
        for allowed in allowed_proj:
            if col.rstrip("_b").rstrip("_c") == allowed.rstrip("_b").rstrip("_c"):
                return True
        return False

    # 处理 outputColumnKeys
    for col in cols:
        out_col = _is_column_in_output(col)
        if out_col is not None:
            if _is_column_allowed(col):
                if out_col != col:
                    select_parts.append(f"{_safe_identifier(col)} AS {_safe_identifier(out_col)}")
                    seen_aliases.add(out_col)
                else:
                    select_parts.append(_safe_identifier(col))
                    seen_aliases.add(col)

    # 处理 insertedColumns（生成新列）
    all_available = list(cols) + new_cols_added
    for col_config in inserted_cols:
        if not isinstance(col_config, dict):
            continue
        method = str(col_config.get("method", "")).strip().lower()
        source_column = str(col_config.get("sourceColumn", "")).strip()
        new_name = str(col_config.get("name", "")).strip()
        method_config = col_config.get("config", {})

        if not new_name:
            continue

        expr = build_single_inserted_column_expr(method, source_column, method_config, all_available)
        if expr:
            select_parts.append(f"{expr} AS {_safe_identifier(new_name)}")
            new_cols_added.append(new_name)
            all_available.append(new_name)

    if not select_parts:
        return sql

    cols_str = ", ".join(select_parts)
    m = re.search(r"(\s+FROM\s+.+)$", sql_stripped, re.IGNORECASE | re.DOTALL)
    if not m:
        return sql
    from_part = m.group(1)
    return f"SELECT {cols_str}{from_part}"


# ============================================================
# Inserted Columns 构建
# ============================================================


def build_single_inserted_column_expr(
    method: str,
    source_column: str,
    method_config: dict[str, Any],
    all_available_columns: list[str],
) -> str | None:
    """构建单条 insertedColumn 的 SQL 表达式"""
    if not method:
        return None

    safe_source = _safe_identifier(source_column)

    if method == "calculation":
        return build_calculation_expr(safe_source, method_config, all_available_columns)
    elif method == "split":
        return build_split_expr(safe_source, method_config)
    elif method == "function":
        return build_function_expr(safe_source, method_config, all_available_columns)
    elif method == "lookup":
        return build_lookup_expr(safe_source, method_config)
    elif method == "rank":
        return build_rank_expr(safe_source, method_config)
    elif method == "category":
        return build_category_expr(safe_source, method_config)
    elif method == "bin":
        return build_bin_expr(safe_source, method_config)

    return None


def build_calculation_expr(
    source_column: str,
    method_config: dict[str, Any],
    all_available_columns: list[str],
) -> str | None:
    """构建计算表达式"""
    expression = method_config.get("expression", "")
    if not expression:
        return None

    col_pattern = r"\b([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\b"
    matches = re.findall(col_pattern, expression)
    sql_formula = expression
    for col in matches:
        if col in all_available_columns:
            sql_formula = sql_formula.replace(col, _safe_identifier(col))
    return f"({sql_formula})"


def build_split_expr(source_column: str, method_config: dict[str, Any]) -> str | None:
    """构建字符串分割表达式"""
    delimiter = str(method_config.get("delimiter", ",")).strip()
    index = int(method_config.get("index", 0))
    safe_delim = delimiter.replace("'", "''")
    return f"SUBSTRING_INDEX({source_column}, '{safe_delim}', {index + 1})"


def build_function_expr(
    source_column: str,
    method_config: dict[str, Any],
    all_available_columns: list[str],
) -> str | None:
    """构建通用函数表达式"""
    func_name = str(method_config.get("function", "")).strip().upper()
    args = method_config.get("args", [])

    sql_args: list[str] = []
    for arg in args:
        if isinstance(arg, str) and arg in all_available_columns:
            sql_args.append(_safe_identifier(arg))
        elif isinstance(arg, str):
            safe_arg = arg.replace("'", "''")
            sql_args.append(f"'{safe_arg}'")
        else:
            sql_args.append(str(arg))

    func_map = {
        "UPPER": "UPPER",
        "LOWER": "LOWER",
        "TRIM": "TRIM",
        "LENGTH": "LENGTH",
        "CONCAT": "CONCAT",
        "SUBSTRING": "SUBSTRING",
        "ROUND": "ROUND",
        "ABS": "ABS",
        "DATE": "DATE",
        "YEAR": "YEAR",
        "MONTH": "MONTH",
        "DAY": "DAY",
        "IFNULL": "IFNULL",
        "COALESCE": "COALESCE",
        "NULLIF": "NULLIF",
        "IF": "IF",
        "CASE": "CASE",
    }

    mysql_func = func_map.get(func_name, func_name)

    if mysql_func in ("CONCAT", "IF"):
        return f"{mysql_func}({', '.join(sql_args)})"
    elif mysql_func in ("CASE",):
        return f"{mysql_func} {args[0] if args else ''}"
    else:
        arg_str = ", ".join(sql_args) if sql_args else source_column
        return f"{mysql_func}({arg_str})"


def build_lookup_expr(source_column: str, method_config: dict[str, Any]) -> str | None:
    """构建查找表达式"""
    lookup_map = method_config.get("map", {})
    when_parts: list[str] = []

    for key, value in lookup_map.items():
        safe_key = str(key).replace("'", "''")
        safe_value = str(value).replace("'", "''")
        when_parts.append(f"WHEN {source_column} = '{safe_key}' THEN '{safe_value}'")

    if when_parts:
        return f"CASE {' '.join(when_parts)} ELSE {source_column} END"
    return None


def build_rank_expr(source_column: str, method_config: dict[str, Any]) -> str | None:
    """构建排名表达式"""
    order_by = method_config.get("orderBy", "asc")
    partition_by = method_config.get("partitionBy", "")
    rank_type = method_config.get("rankType", "rank")

    order_dir = "ASC" if order_by.lower() == "asc" else "DESC"

    if partition_by:
        partition_cols = [_safe_identifier(col) for col in partition_by.split(",") if col.strip()]
        partition_str = f"PARTITION BY {', '.join(partition_cols)}" if partition_cols else ""
    else:
        partition_str = ""

    rank_fn = {
        "rank": "RANK()",
        "dense_rank": "DENSE_RANK()",
        "row_number": "ROW_NUMBER()",
        "percent_rank": "PERCENT_RANK()",
        "cume_dist": "CUME_DIST()",
    }.get(rank_type, "RANK()")

    if partition_str:
        return f"{rank_fn} OVER ({partition_str} ORDER BY {source_column} {order_dir})"
    return f"{rank_fn} OVER (ORDER BY {source_column} {order_dir})"


def build_category_expr(source_column: str, method_config: dict[str, Any]) -> str | None:
    """构建分类表达式"""
    categories = method_config.get("categories", [])

    when_parts: list[str] = []
    for cat in categories:
        if not isinstance(cat, dict):
            continue
        label = str(cat.get("label", "")).strip()
        condition = cat.get("condition", {})
        condition_type = str(condition.get("type", "")).strip().lower()

        if condition_type == "range":
            min_val = condition.get("min")
            max_val = condition.get("max")
            conditions = []
            if min_val is not None:
                conditions.append(f"{source_column} >= {min_val}")
            if max_val is not None:
                conditions.append(f"{source_column} <= {max_val}")
            if conditions:
                when_parts.append(f"WHEN {' AND '.join(conditions)} THEN '{label}'")
        elif condition_type == "value":
            value = condition.get("value", "")
            when_parts.append(f"WHEN {source_column} = '{value}' THEN '{label}'")

    if when_parts:
        return f"CASE {' '.join(when_parts)} ELSE {source_column} END"
    return None


def build_bin_expr(source_column: str, method_config: dict[str, Any]) -> str | None:
    """构建分箱表达式"""
    bin_type = method_config.get("binType", "fixed")
    bin_count = int(method_config.get("binCount", 5))
    bin_width = float(method_config.get("binWidth", 1))
    custom_bins = method_config.get("customBins", [])

    if bin_type == "fixed" and bin_width > 0:
        width = float(bin_width)
        when_parts = []
        for i in range(bin_count):
            start = i * width
            end = (i + 1) * width
            when_parts.append(f"WHEN {source_column} >= {start} AND {source_column} < {end} THEN {start}")
        if when_parts:
            return f"CASE {' '.join(when_parts)} ELSE {source_column} END"

    elif bin_type == "quantile":
        return f"NTILE({bin_count}) OVER (ORDER BY {source_column})"

    elif bin_type == "custom" and custom_bins:
        when_parts = []
        for i, cb in enumerate(custom_bins):
            if not isinstance(cb, dict):
                continue
            min_val = cb.get("min")
            max_val = cb.get("max")
            label = cb.get("label", str(min_val))
            conditions = []
            if min_val is not None:
                conditions.append(f"{source_column} >= {min_val}")
            if max_val is not None:
                conditions.append(f"{source_column} < {max_val}")
            if conditions:
                when_parts.append(f"WHEN {' AND '.join(conditions)} THEN '{label}'")
        if when_parts:
            return f"CASE {' '.join(when_parts)} ELSE {source_column} END"

    return None


# ============================================================
# UNION 分支
# ============================================================


def union_branches_from_plan(
    upstream_refs: list[tuple[str, str]],
    plan: list[Any],
) -> list[str]:
    """根据 unionColumnPlan 构建 UNION 分支 SQL"""
    branches: list[str] = []
    for i, (ref, alias) in enumerate(upstream_refs):
        if isinstance(plan, list) and i < len(plan):
            row = plan[i]
            if isinstance(row, dict):
                cols = row.get("columns") or row.get("cols")
                if isinstance(cols, list) and cols:
                    parts = [f"{_safe_identifier(src)} AS {_safe_identifier(out)}" for src, out in cols]
                    branches.append(f"SELECT {', '.join(parts)} FROM ({ref}) AS _um{i}")
                    continue
        branches.append(f"SELECT * FROM ({ref}) AS _um{i}")
    return branches

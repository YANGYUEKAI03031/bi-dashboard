# backend/app/services/pipeline/validator.py
"""
Pipeline 验证模块

包含：
- 拓扑排序（Kahn 算法）
- SQL 安全性验证
- 管道配置验证
- 表名验证与格式化
"""
import re
import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


def topological_sort(nodes: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """
    Kahn 算法拓扑排序

    Args:
        nodes: 节点配置列表

    Returns:
        排序后的节点列表，如果存在环返回 None
    """
    if not nodes:
        return []

    # 构建 node_id -> node 映射
    node_map: Dict[str, Dict[str, Any]] = {}
    for i, node in enumerate(nodes):
        node_id = node.get("id") or f"node_{i}"
        node_map[node_id] = node

    # 构建入度表和邻接表
    all_ids = set(node_map.keys())
    in_degree: Dict[str, int] = {nid: 0 for nid in all_ids}
    adjacency: Dict[str, List[str]] = {nid: [] for nid in all_ids}

    for node_id, node in node_map.items():
        upstream = node.get("upstream") or []
        for up_id in upstream:
            if up_id in all_ids:
                in_degree[node_id] += 1
                adjacency[up_id].append(node_id)

    # Kahn 算法
    queue = [nid for nid in all_ids if in_degree[nid] == 0]
    sorted_ids: List[str] = []

    while queue:
        current = queue.pop(0)
        sorted_ids.append(current)
        for neighbor in adjacency[current]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_ids) != len(all_ids):
        # 存在环
        logger.error("管道配置存在循环依赖")
        return None

    return [node_map[nid] for nid in sorted_ids]


def validate_sql(sql: str) -> bool:
    """
    验证 SQL 安全性

    只允许 SELECT 语句

    Args:
        sql: SQL 语句

    Returns:
        是否安全
    """
    if not sql:
        return False

    sql_upper = sql.upper().strip()
    
    # 预处理：移除外层括号和空白，便于验证包含子查询的 SQL
    # 例如 "(SELECT ... FROM ... WHERE step_id = 'xxx') AS _up0" 
    # 预处理后变为 "SELECT ... FROM ..."
    while sql_upper.startswith("(") and sql_upper.endswith(")"):
        sql_upper = sql_upper[1:-1].strip()

    # 只允许 SELECT
    if not sql_upper.startswith("SELECT"):
        return False

    # 禁止的危险关键字
    dangerous_keywords = [
        "INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE",
        "ALTER", "CREATE", "GRANT", "REVOKE"
    ]

    for keyword in dangerous_keywords:
        # 确保是独立单词
        pattern = rf"\b{keyword}\b"
        if re.search(pattern, sql_upper):
            logger.warning(f"SQL 包含危险关键字: {keyword}")
            return False

    return True


def validate_pipeline_config(nodes: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """
    验证管道配置

    Args:
        nodes: 节点配置列表

    Returns:
        (is_valid, error_message)
    """
    if not nodes:
        return False, "管道没有配置节点"

    if not isinstance(nodes, list):
        return False, "节点配置必须是数组格式"

    # 构建 node_id 集合并检查 upstream 引用
    all_ids = set()
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            return False, f"节点 {i} 配置格式错误"
        if node.get("id"):
            all_ids.add(node["id"])

    for i, node in enumerate(nodes):
        if not node.get("name"):
            return False, f"节点 {i} 缺少名称"

        # 检查 SQL 安全性（只有节点有 SQL 时才检查）
        sql = node.get("sql", "") or ""
        if sql:
            sql_upper = sql.upper()
            dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE"]
            for kw in dangerous:
                if kw in sql_upper:
                    return False, f"节点 {node.get('name', i)} 的 SQL 包含不允许的操作: {kw}"

        # 检查 upstream 引用的节点是否存在
        upstream = node.get("upstream") or []
        for up_id in upstream:
            if up_id not in all_ids:
                return False, f"节点 '{node.get('name', i)}' 的上游节点 '{up_id}' 不存在"

        # 检查 merge_type（只允许 union / union all，关联用 join 节点）
        merge_type = node.get("merge_type")
        if merge_type and merge_type not in ('union', 'union all'):
            return False, f"节点 '{node.get('name', i)}' 的 merge_type 必须是 union | union all"

        # 输出节点：目标表与写入模式
        from app.services.pipeline.engine import PipelineEngine
        ntype = PipelineEngine._canonical_pipeline_node_type(str(node.get("type") or ""))
        if ntype == "output":
            cfg = node.get("config") or {}
            tt = str(cfg.get("targetTable") or "").strip()
            if not tt:
                return False, f"节点 '{node.get('name', i)}' 为输出节点，请填写目标表名"
            if not re.match(r"^[a-zA-Z0-9_]{1,64}$", tt):
                return False, f"节点 '{node.get('name', i)}' 的目标表名不合法"
            wm = str(cfg.get("writeMode") or "upsert").lower()
            if wm not in ("replace", "append", "upsert"):
                return False, f"节点 '{node.get('name', i)}' 的 writeMode 必须是 replace | append | upsert"
            if wm == "upsert":
                uk = str(cfg.get("uniqueKey") or "").strip()
                if not uk:
                    return False, f"节点 '{node.get('name', i)}' 为 Upsert 模式，请填写唯一键列（uniqueKey）"
                if not re.match(r"^[a-zA-Z0-9_]{1,64}$", uk):
                    return False, f"节点 '{node.get('name', i)}' 的唯一键列名不合法"

    # 拓扑排序检测环
    node_map = {node.get("id") or f"node_{i}": node for i, node in enumerate(nodes)}
    all_node_ids = set(node_map.keys())

    in_degree: Dict[str, int] = {nid: 0 for nid in all_node_ids}
    adjacency: Dict[str, List[str]] = {nid: [] for nid in all_node_ids}

    for node_id, node in node_map.items():
        upstream = node.get("upstream") or []
        for up_id in upstream:
            if up_id in all_node_ids:
                in_degree[node_id] += 1
                adjacency[up_id].append(node_id)

    # Kahn 算法检测环
    queue = [nid for nid in all_node_ids if in_degree[nid] == 0]
    sorted_ids: List[str] = []

    while queue:
        current = queue.pop(0)
        sorted_ids.append(current)
        for neighbor in adjacency[current]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_ids) != len(all_node_ids):
        return False, "管道配置存在循环依赖"

    return True, ""


def validate_and_quote_table_name(name: str) -> Optional[str]:
    """
    验证并格式化表名

    Args:
        name: 原始表名

    Returns:
        加了反引号的表名，如果无效则返回 None
    """
    if not name:
        return None

    # 只允许字母、数字、下划线
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name):
        logger.warning(f"表名包含非法字符: {name}")
        return None

    # 长度限制
    if len(name) > 64:
        logger.warning(f"表名过长: {name}")
        return None

    return f"`{name}`"

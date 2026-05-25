# backend/app/services/pipeline/graph_builder.py
"""
Pipeline 图构建辅助模块

包含图拓扑处理相关辅助函数，用于构建链式 SQL。
"""
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


def graph_focus_without_output_column_keys(
    graph_nodes: Dict[str, Dict[str, Any]],
    focus_node_id: str,
) -> Dict[str, Dict[str, Any]]:
    """
    返回 graph_nodes 的一个浅拷贝，但 focus_node 的 config 中清除 outputColumnKeys。
    用于查询全列（列选择 UI 需要）。
    """
    result = {nid: dict(nd) for nid, nd in graph_nodes.items()}
    if focus_node_id in result:
        foc = dict(result[focus_node_id])
        cfg = dict(foc.get("config", {}))
        if "outputColumnKeys" in cfg:
            cfg = dict(cfg)
            cfg.pop("outputColumnKeys", None)
            foc["config"] = cfg
        result[focus_node_id] = foc
    return result


def build_incoming_edges(graph_edges: List[Dict[str, str]]) -> Dict[str, List[str]]:
    """
    从 graph_edges 构建入边表 {down_id: [up_ids]}。
    
    Args:
        graph_edges: [{"source": up_id, "target": down_id}, ...]
    
    Returns:
        入边表字典
    """
    incoming: Dict[str, List[str]] = {}
    for e in graph_edges:
        src, tgt = e.get("source", ""), e.get("target", "")
        if src and tgt:
            incoming.setdefault(tgt, []).append(src)
    return incoming


def collect_ancestors(
    focus_node_id: str,
    incoming: Dict[str, List[str]]
) -> Dict[str, bool]:
    """
    反向 BFS：从 focus 沿入边收集所有祖先节点。
    
    Args:
        focus_node_id: 焦点节点 ID
        incoming: 入边表
    
    Returns:
        包含所有祖先节点的集合（包含 focus_node_id 自身）
    """
    visited: Dict[str, bool] = {focus_node_id: True}
    queue = [focus_node_id]
    while queue:
        cur = queue.pop(0)
        for up_id in incoming.get(cur, []):
            if up_id not in visited:
                visited[up_id] = True
                queue.append(up_id)
    return visited


def topological_sort_subgraph(
    visited: Dict[str, bool],
    graph_edges: List[Dict[str, str]],
) -> Optional[List[str]]:
    """
    对子图进行拓扑排序（Kahn 算法）。
    
    Args:
        visited: 节点集合
        graph_edges: 边列表
    
    Returns:
        排序后的节点 ID 列表；如果存在环返回 None
    """
    in_degree: Dict[str, int] = {nid: 0 for nid in visited}
    adj: Dict[str, List[str]] = {nid: [] for nid in visited}   # up -> [downs]
    
    for e in graph_edges:
        src, tgt = e.get("source", ""), e.get("target", "")
        if src in visited and tgt in visited:
            in_degree[tgt] += 1
            adj[src].append(tgt)
    
    sorted_ids: List[str] = []
    zero_in = [nid for nid in visited if in_degree[nid] == 0]
    
    while zero_in:
        zero_in.sort()
        nid = zero_in.pop(0)
        sorted_ids.append(nid)
        for nb in adj[nid]:
            in_degree[nb] -= 1
            if in_degree[nb] == 0:
                zero_in.append(nb)
    
    if len(sorted_ids) != len(visited):
        return None
    
    return sorted_ids

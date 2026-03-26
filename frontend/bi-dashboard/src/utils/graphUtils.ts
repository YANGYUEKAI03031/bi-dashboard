export interface GraphNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface MergeConfig {
  upstream_ids: string[];
  merge_type: 'union' | 'left_join' | 'right_join' | 'full_join';
  output_name?: string;
}

/**
 * DFS 检测环，返回环中的节点 ID 列表，无环返回 null
 */
export function detectCycle(nodes: GraphNode[], edges: GraphEdge[]): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const parent: Record<string, string | null> = {};
  let cycleNodes: string[] = [];

  for (const node of nodes) {
    color[node.id] = WHITE;
    parent[node.id] = null;
  }

  function dfs(nodeId: string): boolean {
    color[nodeId] = GRAY;
    const neighbors = edges
      .filter(e => e.source === nodeId)
      .map(e => e.target);
    for (const neighbor of neighbors) {
      if (color[neighbor] === GRAY) {
        let curr: string | null = nodeId;
        cycleNodes = [neighbor];
        while (curr !== null && curr !== neighbor) {
          cycleNodes.unshift(curr);
          curr = parent[curr];
        }
        cycleNodes.unshift(neighbor);
        return true;
      }
      if (color[neighbor] === WHITE) {
        parent[neighbor] = nodeId;
        if (dfs(neighbor)) return true;
      }
    }
    color[nodeId] = BLACK;
    return false;
  }

  for (const node of nodes) {
    if (color[node.id] === WHITE) {
      if (dfs(node.id)) return cycleNodes;
    }
  }
  return null;
}

/**
 * Kahn 算法拓扑排序，返回节点 ID 顺序数组
 */
export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const allIds = new Set(nodes.map(n => n.id));
  const inDegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};

  for (const id of allIds) {
    inDegree[id] = 0;
    adjacency[id] = [];
  }

  for (const edge of edges) {
    if (allIds.has(edge.source) && allIds.has(edge.target)) {
      adjacency[edge.source].push(edge.target);
      inDegree[edge.target]++;
    }
  }

  const queue: string[] = [];
  for (const id of allIds) {
    if (inDegree[id] === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency[current]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * 根据 nodes 中的 upstream 字段自动构建 edges
 */
export function buildEdgesFromUpstream(nodes: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    const upstream = (node.data.pipelineNode as Record<string, unknown> | undefined)?.upstream as string[] | undefined || [];
    for (const upId of upstream) {
      edges.push({
        id: `${upId}-${node.id}`,
        source: upId,
        target: node.id,
      });
    }
  }
  return edges;
}

/**
 * React Flow nodes 转换为 PipelineNode[]（用于 API 提交）
 */
export function nodesToPipelineNodes(
  nodes: GraphNode[],
  positions?: Record<string, { x: number; y: number }>
): Array<Record<string, unknown>> {
  return nodes.map((node, idx) => ({
    ...(node.data.pipelineNode as Record<string, unknown>),
    order: idx,
    position: positions?.[node.id] ?? node.position ?? { x: 0, y: 0 },
  }));
}

/**
 * PipelineNode[] 转换为 React Flow nodes
 */
export function pipelineNodesToNodes(
  pipelineNodes: Array<Record<string, unknown>>,
  positions?: Record<string, { x: number; y: number }>
): GraphNode[] {
  return pipelineNodes.map((node, i) => {
    const id = (node.id as string) || `node_${i}`;
    return {
      id,
      type: 'pipelineNode',
      position: positions?.[id] ?? ((node.position as { x: number; y: number }) ?? { x: 0, y: 0 }),
      data: { pipelineNode: node },
    };
  });
}

/**
 * 自动布局：DAG 按层级从上到下排列
 */
export function autoLayoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: 'TB' | 'LR' = 'TB'
): GraphNode[] {
  const allIds = new Set(nodes.map(n => n.id));
  const inDegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};

  for (const id of allIds) {
    inDegree[id] = 0;
    adjacency[id] = [];
  }

  for (const edge of edges) {
    if (allIds.has(edge.source) && allIds.has(edge.target)) {
      adjacency[edge.source].push(edge.target);
      inDegree[edge.target]++;
    }
  }

  const queue: string[] = [];
  const layer: Record<string, number> = {};
  for (const id of allIds) {
    if (inDegree[id] === 0) {
      queue.push(id);
      layer[id] = 0;
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextLayer = layer[current] + 1;
    for (const neighbor of adjacency[current]) {
      inDegree[neighbor]--;
      if (!queue.includes(neighbor) && inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
      layer[neighbor] = Math.max(layer[neighbor] || 0, nextLayer);
    }
  }

  let maxLayer = Math.max(...Object.values(layer), 0);
  for (const id of allIds) {
    if (layer[id] === undefined) layer[id] = maxLayer + 1;
  }

  const layerCount: Record<number, string[]> = {};
  for (const [id, l] of Object.entries(layer)) {
    if (!layerCount[l]) layerCount[l] = [];
    layerCount[l].push(id);
  }

  const nodeWidth = direction === 'LR' ? 220 : 300;
  const nodeHeight = direction === 'LR' ? 120 : 100;
  const gapX = 80;
  const gapY = 100;

  const result: GraphNode[] = [];
  for (const [l, ids] of Object.entries(layerCount)) {
    const layerIdx = parseInt(l);
    ids.forEach((id, i) => {
      const node = nodes.find(n => n.id === id);
      if (node) {
        result.push({
          ...node,
          position: direction === 'TB'
            ? { x: i * (nodeWidth + gapX), y: layerIdx * (nodeHeight + gapY) }
            : { x: layerIdx * (nodeWidth + gapX), y: i * (nodeHeight + gapY) },
        });
      }
    });
  }

  return result;
}

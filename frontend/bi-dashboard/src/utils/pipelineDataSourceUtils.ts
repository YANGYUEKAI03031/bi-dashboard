import type { PipelineNode } from '../services/pipelineService';

/**
 * 预览 API 使用的业务库 ID：源节点优先用 config.source_data_source_id，否则管道级。
 */
export function resolvePreviewDataSourceId(
  pipelineNode: PipelineNode | undefined,
  pipelineDataSourceId?: number | null
): number | undefined {
  if (!pipelineNode) return pipelineDataSourceId ?? undefined;
  if (pipelineNode.type === 'source') {
    const cid = pipelineNode.config?.source_data_source_id;
    if (cid !== undefined && cid !== null && cid !== '') {
      const n = Number(cid);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }
  return pipelineDataSourceId ?? undefined;
}

/**
 * 从图中第一个「数据源」源节点读取业务库 ID（写入 config.source_data_source_id）。
 */
export function getFirstSourceDataSourceId(nodes: PipelineNode[]): number | null {
  for (const n of nodes) {
    if (n.type !== 'source') continue;
    const raw = n.config?.source_data_source_id;
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return null;
}

/**
 * 编辑管道时：若源节点尚未保存过数据源，用管道级 ID 回填，便于选表。
 */
export function hydrateSourceNodesWithPipelineDataSource(
  nodes: PipelineNode[],
  pipelineSourceId: number
): PipelineNode[] {
  return nodes.map((n) => {
    if (n.type !== 'source') return n;
    const cfg = { ...(n.config || {}) };
    const raw = cfg.source_data_source_id;
    if (raw !== undefined && raw !== null && raw !== '') return n;
    return {
      ...n,
      config: { ...cfg, source_data_source_id: pipelineSourceId },
    };
  });
}

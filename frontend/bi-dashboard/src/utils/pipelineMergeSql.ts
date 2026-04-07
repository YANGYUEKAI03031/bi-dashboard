/**
 * 合并节点（纵向 concat）持久化 SQL：与 PipelineEngine 占位符 {upstream_table_0}… 一致。
 */

export interface UnionColumnPlanRow {
  /** 稳定 key，供 React 列表 */
  id: string;
  /** 输出列名（UNION 各分支统一别名） */
  out: string;
  /** 与上游顺序对齐：第 i 个上游取哪一列；空串/缺省表示填 NULL */
  cols: Array<string | null | undefined>;
}

const NULL_SQL =
  'CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci';

function escIdent(name: string): string {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

/** 前端 config.merge_type：union_all | union */
export function buildMergePersistedSql(
  mergeType: 'union' | 'union_all',
  upstreamCount: number,
  plan: UnionColumnPlanRow[] | null | undefined
): string {
  const op = mergeType === 'union' ? 'UNION' : 'UNION ALL';
  const branches: string[] = [];

  for (let i = 0; i < upstreamCount; i++) {
    if (plan && plan.length > 0) {
      const parts: string[] = [];
      for (const row of plan) {
        const out = String(row.out || '').trim();
        if (!out) continue;
        const raw =
          row.cols && i < row.cols.length ? row.cols[i] : undefined;
        const src =
          raw !== null && raw !== undefined && String(raw).trim()
            ? String(raw).trim()
            : null;
        if (src) {
          parts.push(`${escIdent(src)} AS ${escIdent(out)}`);
        } else {
          parts.push(`${NULL_SQL} AS ${escIdent(out)}`);
        }
      }
      branches.push(
        parts.length > 0
          ? `SELECT ${parts.join(', ')} FROM {upstream_table_${i}}`
          : `SELECT * FROM {upstream_table_${i}}`
      );
    } else {
      branches.push(`SELECT * FROM {upstream_table_${i}}`);
    }
  }
  return branches.join(`\n${op}\n`);
}

/** 传给后端的 merge_type 字符串 */
export function mergeTypeConfigToBackend(configMergeType: string | undefined): string {
  const s = String(configMergeType || 'union_all').toLowerCase().trim();
  if (s === 'union') return 'union';
  return 'union all';
}

/** 预览请求 graph_nodes 上的 merge_type */
export function mergeTypeForPreviewApi(pn: {
  merge_type?: string;
  config?: Record<string, unknown>;
}): string | undefined {
  const fromTop = pn.merge_type;
  const fromCfg = pn.config?.merge_type as string | undefined;
  const raw = fromTop ?? fromCfg;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  return mergeTypeConfigToBackend(String(raw));
}
